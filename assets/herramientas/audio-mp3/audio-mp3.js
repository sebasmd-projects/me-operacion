/* ==========================================================================
   Convertir audio a MP3 · lógica + interfaz (un solo archivo por herramienta)
   Secciones:
     1. Configuración y constantes
     2. Reglas de negocio (nombres, decodificación, codificación MP3, ZIP)
     3. Interfaz (render, eventos y enganche con MEUI)
   ========================================================================== */
(function (global) {
  "use strict";

  /* ======================================================================
     1. Configuración y constantes
     ====================================================================== */
  // Etiqueta y color de insignia por estado de cada archivo.
  const ESTADOS = {
    pendiente: ["Pendiente", "warning"],
    decodificando: ["Leyendo", "info"],
    codificando: ["Convirtiendo", "primary"],
    listo: ["Listo", "success"],
    error: ["Error", "danger"]
  };
  // Extensiones aceptadas aunque el navegador no informe un tipo MIME audio/*.
  const EXTENSIONES_AUDIO = new Set(["aac", "flac", "m4a", "mp3", "mp4", "oga", "ogg", "opus", "wav", "webm"]);
  const FRECUENCIA_SALIDA = 44100;   // Hz a los que se normaliza todo audio antes de codificar
  const BITRATE_POR_DEFECTO = 128;   // kbps si el selector no trae un valor válido
  const TAMANO_BLOQUE_MP3 = 1152;    // muestras por bloque que recibe el codificador
  const TIEMPO_BLOQUE_MS = 16;       // tiempo máximo antes de devolver el control a la interfaz
  const MUESTRAS_POR_PAUSA = 65536; // muestras PCM entre pausas de preparación
  const ETIQUETAS_SHELL = ["Audio", "MP3", "Local"];

  // Estado de la herramienta: lista de archivos y bandera de conversión en curso.
  const estado = { archivos: [], convirtiendo: false, secuencia: 0 };

  /* ======================================================================
     2. Reglas de negocio
     ====================================================================== */
  function extension(nombre) {
    const partes = String(nombre).split(".");
    return partes.length > 1 ? partes.pop().toLowerCase() : "";
  }

  function nombreBase(nombre) {
    const base = String(nombre).replace(/\.[^.]+$/, "").trim() || "audio";
    return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "audio";
  }

  function nombreDisponible(nombreOriginal) {
    const baseOriginal = nombreBase(nombreOriginal);
    const base = /^mp3-/i.test(baseOriginal) ? baseOriginal : `mp3-${baseOriginal}`;
    const ocupados = new Set(estado.archivos.map((item) => item.nombreSalida.toLocaleLowerCase("es")));
    let candidato = `${base}.mp3`;
    let numero = 2;
    while (ocupados.has(candidato.toLocaleLowerCase("es"))) candidato = `${base}-${numero++}.mp3`;
    return candidato;
  }

  function validarArchivo(archivo) {
    return archivo?.type?.startsWith("audio/") || EXTENSIONES_AUDIO.has(extension(archivo?.name));
  }

  function agregar(archivos) {
    let agregados = 0;
    let omitidos = 0;
    Array.from(archivos || []).forEach((archivo) => {
      const repetido = estado.archivos.some((item) => item.archivo.name === archivo.name
        && item.archivo.size === archivo.size && item.archivo.lastModified === archivo.lastModified);
      if (!validarArchivo(archivo) || repetido) {
        omitidos += 1;
        return;
      }
      estado.archivos.push({
        id: `audio-${Date.now()}-${++estado.secuencia}`,
        archivo,
        nombreSalida: nombreDisponible(archivo.name),
        estado: "pendiente",
        progreso: 0,
        blob: null,
        url: "",
        duracion: NaN,
        error: ""
      });
      agregados += 1;
    });
    if (agregados) registrar(`${agregados} archivo${agregados === 1 ? " agregado" : "s agregados"}.`, "success");
    if (omitidos) registrar(`${omitidos} archivo${omitidos === 1 ? " omitido" : "s omitidos"} por formato no compatible o duplicado.`, "warning");
    renderizar();
  }

  async function normalizarAudio(buffer) {
    const canales = Math.min(2, Math.max(1, buffer.numberOfChannels));
    const frecuencia = FRECUENCIA_SALIDA;
    const contexto = new OfflineAudioContext(canales, Math.ceil(buffer.duration * frecuencia), frecuencia);
    const fuente = contexto.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(contexto.destination);
    fuente.start(0);
    return contexto.startRendering();
  }

  async function canalEntero16(canal) {
    const resultado = new Int16Array(canal.length);
    for (let i = 0; i < canal.length; i += 1) {
      const valor = Math.max(-1, Math.min(1, canal[i]));
      resultado[i] = valor < 0 ? valor * 0x8000 : valor * 0x7fff;
      if ((i + 1) % MUESTRAS_POR_PAUSA === 0) await siguientePintado();
    }
    return resultado;
  }

  async function codificarMp3(buffer, bitrate, progreso) {
    const canales = Math.min(2, buffer.numberOfChannels);
    const izquierdo = await canalEntero16(buffer.getChannelData(0));
    const derecho = canales === 2 ? await canalEntero16(buffer.getChannelData(1)) : null;
    const codificador = new global.lamejs.Mp3Encoder(canales, buffer.sampleRate, bitrate);
    const bloques = [];
    const tamanoBloque = TAMANO_BLOQUE_MP3;
    let ultimaPausa = performance.now();

    for (let inicio = 0; inicio < izquierdo.length; inicio += tamanoBloque) {
      const fin = Math.min(inicio + tamanoBloque, izquierdo.length);
      const bloque = canales === 2
        ? codificador.encodeBuffer(izquierdo.subarray(inicio, fin), derecho.subarray(inicio, fin))
        : codificador.encodeBuffer(izquierdo.subarray(inicio, fin));
      if (bloque.length) bloques.push(new Int8Array(bloque));
      const porcentaje = Math.min(99, Math.round((fin / izquierdo.length) * 100));
      if (performance.now() - ultimaPausa >= TIEMPO_BLOQUE_MS) {
        progreso(porcentaje);
        await siguientePintado();
        ultimaPausa = performance.now();
      }
    }
    const final = codificador.flush();
    if (final.length) bloques.push(new Int8Array(final));
    progreso(100);
    return new Blob(bloques, { type: "audio/mpeg" });
  }

  async function convertir(item, bitrate, contexto) {
    item.estado = "decodificando";
    item.error = "";
    actualizarFila(item);
    renderizarResumen();
    try {
      const datos = await item.archivo.arrayBuffer();
      const decodificado = await contexto.decodeAudioData(datos.slice(0));
      item.duracion = decodificado.duration;
      const normalizado = await normalizarAudio(decodificado);
      item.estado = "codificando";
      actualizarFila(item);
      renderizarResumen();
      item.blob = await codificarMp3(normalizado, bitrate, (valor) => {
        item.progreso = valor;
        actualizarFila(item);
      });
      item.url = URL.createObjectURL(item.blob);
      item.estado = "listo";
      registrar(`${item.archivo.name} → ${item.nombreSalida}`, "success");
    } catch (error) {
      item.estado = "error";
      item.error = /decode|encoding|media/i.test(error?.message || "")
        ? "El navegador no pudo decodificar este audio."
        : (error?.message || "No fue posible convertir el archivo.");
      registrar(`No se pudo convertir ${item.archivo.name}: ${item.error}`, "danger");
    }
    actualizarFila(item);
    renderizarResumen();
  }

  async function convertirPendientes(soloFallidas = false) {
    if (estado.convirtiendo) return;
    if (!global.lamejs?.Mp3Encoder) {
      registrar("No se cargó el codificador MP3. Verifica la conexión e intenta recargar.", "danger");
      return;
    }
    const pendientes = estado.archivos.filter((item) => (soloFallidas !== true && item.estado === "pendiente") || item.estado === "error");
    if (!pendientes.length) return;
    estado.convirtiendo = true;
    renderizar();
    MEUI.progreso.iniciar(pendientes.length, "Convertir audios");
    let contexto;
    try {
      contexto = new (global.AudioContext || global.webkitAudioContext)();
      const bitrate = Number($("#audio-bitrate").value) || BITRATE_POR_DEFECTO;
      registrar(`Conversión iniciada: ${pendientes.length} archivo${pendientes.length === 1 ? "" : "s"} a ${bitrate} kbps.`, "info");
      let hechos = 0;
      for (const item of pendientes) {
        await convertir(item, bitrate, contexto);
        MEUI.progreso.avanzar(++hechos, item.archivo.name);
      }
      const fallidas = pendientes.filter(item => item.estado === "error").length;
      MEUI.progreso.fin({ fallidas, reintentar: () => convertirPendientes(true),
        mensaje: fallidas ? `Conversión finalizada: ${fallidas} fallidas` : "Conversión finalizada" });
      registrar("Conversión finalizada.", fallidas ? "warning" : "success");
    } catch (error) {
      MEUI.progreso.fin({ fallidas: pendientes.length });
      registrar(`No se pudo convertir: ${error?.message || error}`, "danger");
    } finally {
      if (contexto) await contexto.close().catch(() => {});
      estado.convirtiendo = false;
      renderizar();
    }
  }

  function marcaTiempo() {
    const fecha = new Date();
    const parte = (numero) => String(numero).padStart(2, "0");
    return `${fecha.getFullYear()}${parte(fecha.getMonth() + 1)}${parte(fecha.getDate())}_${parte(fecha.getHours())}${parte(fecha.getMinutes())}${parte(fecha.getSeconds())}`;
  }

  function descargarBlob(blob, nombre) {
    if (global.MEUI?.descargar) global.MEUI.descargar(blob, nombre);
    else {
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(blob);
      enlace.download = nombre;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
    }
  }

  function descargar(id) {
    const item = estado.archivos.find((archivo) => archivo.id === id);
    if (item?.blob) descargarBlob(item.blob, item.nombreSalida);
  }

  async function descargarTodo() {
    const listos = estado.archivos.filter((item) => item.blob);
    if (!listos.length) return;
    if (listos.length === 1) {
      descargar(listos[0].id);
      return;
    }
    if (!global.JSZip) {
      registrar("No se cargó el generador ZIP. Descarga cada MP3 desde su fila.", "danger");
      return;
    }
    const boton = $("#audio-descargar-todo");
    boton.disabled = true;
    boton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Preparando ZIP';
    MEUI.progreso.iniciar(1, "Preparar ZIP de audios");
    try {
      const zip = new global.JSZip();
      listos.forEach((item) => zip.file(item.nombreSalida, item.blob));
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      MEUI.progreso.fin({ fallidas: 0, mensaje: "ZIP preparado" });
      descargarBlob(blob, `audios_mp3_${marcaTiempo()}.zip`);
      registrar(`ZIP preparado con ${listos.length} archivos MP3.`, "success");
    } catch (error) {
      MEUI.progreso.fin({ fallidas: 1 });
      registrar(`No se pudo crear el ZIP: ${error?.message || error}`, "danger");
    } finally {
      boton.innerHTML = '<i class="bi bi-download me-1"></i> Descargar resultados';
      renderizar();
    }
  }

  function eliminar(id) {
    if (estado.convirtiendo) return;
    const indice = estado.archivos.findIndex((item) => item.id === id);
    if (indice < 0) return;
    if (estado.archivos[indice].url) URL.revokeObjectURL(estado.archivos[indice].url);
    estado.archivos.splice(indice, 1);
    renderizar();
  }

  function limpiar() {
    if (estado.convirtiendo) return;
    estado.archivos.forEach((item) => item.url && URL.revokeObjectURL(item.url));
    estado.archivos.length = 0;
    renderizar();
    registrar("Lista de audios limpiada.", "info");
  }

  /* ======================================================================
     3. Interfaz: utilidades de render, eventos y enganche con MEUI
     ====================================================================== */
  const $ = (selector) => document.querySelector(selector);
  const escapar = (valor) => String(valor ?? "").replace(/[&<>'"]/g, (caracter) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;"
  })[caracter]);

  function registrar(mensaje, tipo) {
    if (global.MEUI?.log) global.MEUI.log(mensaje, tipo || "info");
  }

  function formatoTamano(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const unidades = ["B", "KB", "MB", "GB"];
    const indice = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);
    return `${(bytes / Math.pow(1024, indice)).toFixed(indice ? 1 : 0)} ${unidades[indice]}`;
  }

  function formatoDuracion(segundos) {
    if (!Number.isFinite(segundos)) return "";
    const minutos = Math.floor(segundos / 60);
    const resto = Math.round(segundos % 60).toString().padStart(2, "0");
    return `${minutos}:${resto}`;
  }

  function insignia(item) {
    const [texto, color] = ESTADOS[item.estado] || ESTADOS.pendiente;
    const detalle = item.estado === "error" ? `<div class="small text-danger mt-1">${escapar(item.error)}</div>` : "";
    const avance = item.estado === "codificando" ? ` · ${item.progreso}%` : "";
    return `<span class="badge text-bg-${color}">${texto}${avance}</span>${detalle}`;
  }

  function fila(item) {
    const salida = item.blob
      ? `<div class="audio-file-name fw-semibold">${escapar(item.nombreSalida)}</div><div class="small text-body-secondary mb-1">${formatoTamano(item.blob.size)}${Number.isFinite(item.duracion) ? ` · ${formatoDuracion(item.duracion)}` : ""}</div><audio class="audio-preview" controls preload="metadata" src="${escapar(item.url)}"></audio>`
      : `<span class="text-body-secondary">${escapar(item.nombreSalida)}</span>`;
    return `<tr data-audio-id="${escapar(item.id)}">
      <td class="text-end text-nowrap">
        ${item.blob ? `<button class="btn btn-sm btn-success" type="button" data-audio-accion="descargar" title="Descargar"><i class="bi bi-download"></i></button>` : ""}
        <button class="btn btn-sm btn-outline-danger" type="button" data-audio-accion="eliminar" title="Eliminar" ${estado.convirtiendo ? "disabled" : ""}><i class="bi bi-x-lg"></i></button>
      </td>
      <td><div class="audio-file-name fw-semibold">${escapar(item.archivo.name)}</div><div class="small text-body-secondary">${escapar(extension(item.archivo.name).toUpperCase() || item.archivo.type || "Audio")} · ${formatoTamano(item.archivo.size)}</div></td>
      <td>${insignia(item)}</td>
      <td>${salida}</td>

    </tr>`;
  }

  // Cada fila conserva su identidad; las conversiones listas mantienen audio y descarga.
  const filas = new Map();

  function actualizarFila(item) {
    const plantilla = document.createElement("template");
    plantilla.innerHTML = fila(item);
    const nueva = plantilla.content.firstElementChild;
    const anterior = filas.get(item.id);
    if (anterior) {
      anterior.replaceChildren(...nueva.childNodes);
    } else {
      filas.set(item.id, nueva);
      $("#audio-lista").appendChild(nueva);
    }
  }

  function renderizar() {
    const vigentes = new Set(estado.archivos.map(item => item.id));
    filas.forEach((elemento, id) => {
      if (!vigentes.has(id)) {
        elemento.remove();
        filas.delete(id);
      }
    });
    if (estado.archivos.length) {
      $("#audio-vacio")?.remove();
      estado.archivos.forEach(item => {
        if (!filas.has(item.id)) actualizarFila(item);
      });
    } else if (!$("#audio-vacio")) {
      $("#audio-lista").innerHTML = '<tr id="audio-vacio"><td colspan="4" class="text-center text-body-secondary py-5">Selecciona audios para comenzar.</td></tr>';
    }
    document.querySelectorAll('[data-audio-accion="eliminar"]').forEach(boton => {
      boton.disabled = estado.convirtiendo;
    });
    renderizarResumen();
  }

  function renderizarResumen() {
    const total = estado.archivos.length;
    const pendientes = estado.archivos.filter((item) => item.estado === "pendiente" || item.estado === "error").length;
    const listos = estado.archivos.filter((item) => item.estado === "listo").length;
    const errores = estado.archivos.filter((item) => item.estado === "error").length;
    $("#audio-total").textContent = total;
    $("#audio-pendientes").textContent = pendientes;
    $("#audio-listos").textContent = listos;
    $("#audio-errores").textContent = errores;

    const etiqueta = $("#audio-estado-general");
    etiqueta.textContent = estado.convirtiendo ? "Convirtiendo" : total ? `${listos} de ${total} listos` : "Sin archivos";
    etiqueta.className = `badge text-bg-${estado.convirtiendo ? "primary" : listos && listos === total ? "success" : "secondary"}`;
    $("#audio-convertir").disabled = estado.convirtiendo || !pendientes;
    $("#audio-descargar-todo").disabled = estado.convirtiendo || !listos;
    $("#audio-limpiar").disabled = estado.convirtiendo || !total;
    $("#audio-bitrate").disabled = estado.convirtiendo;
  }

  function siguientePintado() {
    // También avanza en pestañas ocultas, donde requestAnimationFrame puede detenerse.
    return new Promise((resolver) => setTimeout(resolver, 0));
  }

  document.addEventListener("DOMContentLoaded", () => {
    global.MEUI?.init({
      app: "audio-mp3",
      sesiones: [],
      etiquetas: ETIQUETAS_SHELL
    });

    const entrada = document.querySelector("#audio-input");
    const zona = document.querySelector("#audio-drop");
    if (!entrada || !zona) return;

    MEUI.zonaArchivo(zona, { texto: "Arrastra uno o varios audios o haz clic para elegirlos", alElegir: (archivo, archivos) => {
      agregar(archivos);
      entrada.value = "";
    } });

    document.querySelector("#audio-convertir").addEventListener("click", convertirPendientes);
    document.querySelector("#audio-descargar-todo").addEventListener("click", descargarTodo);
    document.querySelector("#audio-limpiar").addEventListener("click", limpiar);
    document.querySelector("#audio-lista").addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-audio-accion]");
      const fila = evento.target.closest("[data-audio-id]");
      if (!boton || !fila) return;
      if (boton.dataset.audioAccion === "descargar") descargar(fila.dataset.audioId);
      if (boton.dataset.audioAccion === "eliminar") eliminar(fila.dataset.audioId);
    });

    renderizar();
  });
})(window);
