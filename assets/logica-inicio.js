/* =====================================================================
   logica-inicio.js · Portada — catálogo de herramientas y entregables
   ---------------------------------------------------------------------
   AQUÍ se registran los proyectos y sus archivos. Si un archivo se
   renombra o se mueve, se cambia en PROYECTOS y la portada queda al día:
   es el único lugar donde viven esas rutas.
===================================================================== */
"use strict";

/* =====================================================================
   1 · CATÁLOGO
===================================================================== */
const PROYECTOS = [
    {
        id: "prepagadas",
        numero: 1,
        nombre: "Prepagadas · SIME ⇄ CM",
        descripcion: "Verificación cruzada de líneas prepagadas y alta de suscripciones en SIME.",
        estado: "Operación",
        abrir: "herramientas/reporte_prepagadas.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta. El marcado va aparte de la lógica.",
                archivos: [
                    { nombre: "reporte_prepagadas.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/reporte_prepagadas.html" },
                    { nombre: "logica-prepagadas.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-prepagadas.js" },
                    { nombre: "me-prepagadas-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-prepagadas-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Cómo se usa, qué consulta y qué reglas aplica.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/reporte-prepagadas/README.md" }
                ]
            }
        ]
    },
    {
        id: "casos",
        numero: 2,
        nombre: "Cierre masivo de casos",
        descripcion: "Búsqueda del ticket de cada caso y cierre por lotes en el CM, con simulación previa.",
        estado: "Operación",
        abrir: "herramientas/reporte_casos_masivos.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { nombre: "reporte_casos_masivos.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/reporte_casos_masivos.html" },
                    { nombre: "logica-casos.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-casos.js" },
                    { nombre: "me-casos-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-casos-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Reglas del cierre y qué se envía al CM.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/cerrar-casos/README.md" }
                ]
            }
        ]
    },
    {
        id: "tipificacion",
        numero: 3,
        nombre: "Exportar casos · Tipificación",
        descripcion: "Descarga masiva de casos del CRM por rango de fechas y estados.",
        estado: "Operación",
        abrir: "herramientas/export_tipificacion.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { nombre: "export_tipificacion.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/export_tipificacion.html" },
                    { nombre: "logica-tipificacion.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-tipificacion.js" },
                    { nombre: "me-tipificacion-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-tipificacion-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Filtros, límite de 10.000 casos y división por fechas.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/reporte-tipificacion/README.md" }
                ]
            }
        ]
    },
    {
        id: "ajustes",
        numero: 4,
        nombre: "Ajustes y paquetes",
        descripcion: "Consulta y exportación de ajustes de dinero y de paquetes, con catálogos editables.",
        estado: "Operación",
        abrir: "herramientas/export_ajustes.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { nombre: "export_ajustes.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/export_ajustes.html" },
                    { nombre: "logica-ajustes.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-ajustes.js" },
                    { nombre: "me-ajustes-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-ajustes-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Catálogos de códigos y significado de cada columna.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/reporte-ajustes/README.md" }
                ]
            }
        ]
    },
    {
        id: "hlr-hss",
        numero: 5,
        nombre: "HLR/HSS · Claro y Tigo",
        descripcion: "Antes tres herramientas separadas (Validador QDN · Claro, Consulta QDN · Tigo y ¿En qué HLR está?), ahora una sola con pestañas. Tigo y Ambos son de solo lectura; Claro además opera la línea (bloqueo, desbloqueo, conciliación) con doble confirmación.",
        estado: "Operación",
        abrir: "herramientas/hlr_hss.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Cada pestaña reusa, sin cambios de lógica, el motor de la herramienta que reemplaza (envuelto en su propio IIFE para poder convivir en una sola página).",
                archivos: [
                    { nombre: "hlr_hss.html", tipo: "HTML · marcado + pestañas", icono: "bi-filetype-html", ruta: "herramientas/hlr_hss.html" },
                    { nombre: "logica-hlr-hss-tigo.js", tipo: "JS · motor Tigo", icono: "bi-filetype-js", ruta: "assets/logica-hlr-hss-tigo.js" },
                    { nombre: "logica-hlr-hss-claro.js", tipo: "JS · motor Claro (consulta + operaciones)", icono: "bi-filetype-js", ruta: "assets/logica-hlr-hss-claro.js" },
                    { nombre: "logica-hlr-hss-ambos.js", tipo: "JS · motor Ambos (cruce)", icono: "bi-filetype-js", ruta: "assets/logica-hlr-hss-ambos.js" },
                    { nombre: "me-hlr-hss-puente.js", tipo: "JS · interruptor de pestañas", icono: "bi-filetype-js", ruta: "assets/me-hlr-hss-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Por qué se fusionaron las tres, cómo funciona el interruptor de pestañas, y las reglas de negocio de cada motor (con enlace a la doc original de cada uno).",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/hlr-hss/README.md" }
                ]
            }
        ]
    },
    {
        id: "portabilidad-tigo",
        numero: 6,
        nombre: "Validador Portabilidad · Tigo",
        descripcion: "Consulta individual y masiva por MSISDN contra el HLR de Tigo (autogestión), con el marco de negocio de portabilidad: Creada / Sin perfil (pendiente) / Residuo en Tigo.",
        estado: "Operación",
        abrir: "herramientas/validador_portabilidad_tigo.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta. Comparte motor con «Consulta QDN · Tigo»; cambia el catálogo de RETCODE a etiquetas de negocio.",
                archivos: [
                    { nombre: "validador_portabilidad_tigo.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/validador_portabilidad_tigo.html" },
                    { nombre: "logica-portabilidad-tigo.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-portabilidad-tigo.js" },
                    { nombre: "me-portabilidad-tigo-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-portabilidad-tigo-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Qué significa cada RETCODE en el proceso de portabilidad y validaciones de coherencia.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/portabilidad-tigo/README.md" }
                ]
            }
        ]
    },
    {
        id: "rechazo",
        numero: 7,
        nombre: "Generar archivo de rechazo",
        descripcion: "Arma el soporte PDF de un rechazo de portabilidad (FC titularidad, Línea Suspendida o Línea Desactivada) con los datos del CM, vista previa del documento real y el nombre según la convención de la plataforma.",
        estado: "Operación",
        abrir: "herramientas/generar_rechazo.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta. Reemplaza las tres macros de Excel: el PDF pesa 12-35 KB en vez de 217 KB porque no incrusta fuentes, que era lo que hacía que la plataforma truncara el archivo.",
                archivos: [
                    { nombre: "generar_rechazo.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/generar_rechazo.html" },
                    { nombre: "logica-rechazo.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-rechazo.js" },
                    { nombre: "me-rechazo-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-rechazo-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Campos de cada causal, convención del nombre, qué se trae del CM y por qué se dejó el Excel.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/generar-rechazo/README.md" }
                ]
            }
        ]
    },
    {
        id: "consumos",
        numero: 8,
        nombre: "Consumos y Paquetes · CM",
        descripcion: "Datos de la línea, paquetes activos (uso y balance), movimientos (compras, paquetes, recurrencias) e histórico de consumo (llamadas, datos y SMS) por rango de fechas, con tabla paginada, gráficas y exportación. No consulta SIME ni recurrencias/ciclos.",
        estado: "Operación",
        abrir: "herramientas/reporte_consumos.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta. El histórico se trae por línea, al abrir su detalle, no en la consulta masiva.",
                archivos: [
                    { nombre: "reporte_consumos.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/reporte_consumos.html" },
                    { nombre: "logica-consumos.js", tipo: "JS · reglas de negocio", icono: "bi-filetype-js", ruta: "assets/logica-consumos.js" },
                    { nombre: "me-consumos-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-consumos-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Endpoints, criterio de clasificación del histórico (Datos/Voz/SMS) y riesgos.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/reporte-consumos/README.md" }
                ]
            }
        ]
    },
    {
        id: "audio-mp3",
        numero: 9,
        nombre: "Convertir audio a MP3",
        descripcion: "Convierte uno o varios audios —inicialmente OGG y M4A— a MP3 real en el navegador, sin subirlos a un servidor. Conserva el nombre con el prefijo mp3- y agrupa los lotes en un ZIP.",
        estado: "Operación",
        abrir: "herramientas/convertir_audio_mp3.html",
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: "Archivos de la herramienta. La decodificación y codificación ocurren localmente en el navegador.",
                archivos: [
                    { nombre: "convertir_audio_mp3.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "herramientas/convertir_audio_mp3.html" },
                    { nombre: "logica-audio-mp3.js", tipo: "JS · conversión y nombres", icono: "bi-filetype-js", ruta: "assets/logica-audio-mp3.js" },
                    { nombre: "me-audio-mp3-puente.js", tipo: "JS · enganche con el shell", icono: "bi-filetype-js", ruta: "assets/me-audio-mp3-puente.js" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Formatos, operación por lotes, privacidad y convención mp3-*.mp3.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/audio-mp3/README.md" }
                ]
            }
        ]
    },
    {
        id: "base",
        numero: 0,
        nombre: "Base compartida",
        descripcion: "Lo que usan las cuatro herramientas: diseño, shell y acceso al CM. Un cambio aquí las afecta a todas.",
        estado: "Común",
        abrir: null,
        entregables: [
            {
                nombre: "Inicio", tipo: "codigo",
                descripcion: "Esta misma página: el catálogo y las descargas.",
                archivos: [
                    { nombre: "index.html", tipo: "HTML · marcado", icono: "bi-filetype-html", ruta: "index.html" },
                    { nombre: "logica-inicio.js", tipo: "JS · catálogo y descargas", icono: "bi-filetype-js", ruta: "assets/logica-inicio.js" }
                ]
            },
            {
                nombre: "Sistema y acceso", tipo: "codigo",
                descripcion: "Marco visual, sesión, tablas, exportación y llamadas al CM.",
                archivos: [
                    { nombre: "me-ui.css", tipo: "CSS · sistema de diseño", icono: "bi-filetype-css", ruta: "assets/me-ui.css" },
                    { nombre: "me-ui.js", tipo: "JS · shell, tablas y exportación", icono: "bi-filetype-js", ruta: "assets/me-ui.js" },
                    { nombre: "me-api.js", tipo: "JS · Keycloak y llamadas al CM", icono: "bi-filetype-js", ruta: "assets/me-api.js" }
                ]
            },
            {
                nombre: "Lanzador", tipo: "codigo",
                descripcion: "Abre las herramientas con la sesión de SIME y las credenciales del CM.",
                archivos: [
                    { nombre: "dame click.bat", tipo: "BAT · lanzador", icono: "bi-terminal", ruta: "dame click.bat" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Cómo funciona la base común, el lanzador y la API de los módulos.",
                archivos: [
                    { nombre: "README.md", tipo: "Markdown", icono: "bi-markdown", ruta: "doc/lanzador/README.md" }
                ]
            }
        ]
    }
];

/* =====================================================================
   2 · UTILIDADES
===================================================================== */
const esc = MEUI.esc;
const idSeguro = v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const archivosDe = p => p.entregables.flatMap(e => e.archivos);
const TODOS = () => PROYECTOS.flatMap(archivosDe);

/* Las rutas se resuelven contra la carpeta de esta página, no contra el
   dominio: así funciona igual en file:///…/Herramientas/ que publicada en
   https://…/me/ (donde la URL termina en «/» y no en «index.html»). */
const BASE = new URL(".", location.href);
const url = ruta => new URL(ruta, BASE).href;

/* Sirve para actualizar la copia local: se pide siempre al servidor, nunca
   a la caché, o se bajaría la versión vieja de los archivos. */
async function pedir(ruta) {
    const r = await fetch(url(ruta) + (location.protocol === "file:" ? "" : "?_=" + Date.now()),
        { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} al pedir ${ruta}`);
    // Algunos servidores responden 200 con una página de error en vez de 404:
    // si un .js o un .md llega como HTML, no es el archivo que se pidió.
    const tipo = (r.headers.get("content-type") || "").toLowerCase();
    if (tipo.includes("text/html") && !/\.html?$/i.test(ruta))
        throw new Error(`El servidor devolvió una página HTML en vez de ${ruta} (¿ruta equivocada?)`);
    return r;
}

async function traerTexto(ruta) { return (await pedir(ruta)).text(); }

async function traerBytes(ruta) { return new Uint8Array(await (await pedir(ruta)).arrayBuffer()); }

/* =====================================================================
   DISPONIBILIDAD
   Publicada en un servidor, la carpeta puede no tener todos los archivos
   (o el servidor puede negarse a entregar un .bat). En vez de fallar sin
   explicación al descargar, se comprueba antes y se dice cuál falta.
===================================================================== */
const noDisponibles = new Map();   // ruta -> motivo

async function verificarDisponibilidad(boton) {
    const tarea = async () => {
        noDisponibles.clear();
        const vistos = new Set();
        const lista = TODOS().filter(a => !vistos.has(a.ruta) && vistos.add(a.ruta));
        for (const a of lista) {
            try { await pedir(a.ruta); }
            catch (e) { noDisponibles.set(a.ruta, e.message); }
        }
        pintarDisponibilidad();
        if (noDisponibles.size) {
            MEUI.log(`${noDisponibles.size} de ${lista.length} archivos no están disponibles en esta ubicación:`, "warn");
            noDisponibles.forEach((motivo, ruta) => MEUI.log(`  · ${ruta} — ${motivo}`, "warn"));
            MEUI.toast(noDisponibles.size + " archivos no disponibles. Mira el registro.", "warn");
        } else {
            MEUI.log(`Los ${lista.length} archivos están disponibles.`, "ok");
        }
        return noDisponibles.size;
    };
    return boton ? MEUI.conSpinner(boton, "Verificando…", tarea) : tarea();
}

/* Marca en la interfaz lo que no se pudo leer y bloquea su descarga. */
function pintarDisponibilidad() {
    document.querySelectorAll("[data-bajar]").forEach(b => {
        const falta = noDisponibles.has(b.dataset.bajar);
        b.disabled = falta;
        b.title = falta ? noDisponibles.get(b.dataset.bajar) : "";
    });
    document.querySelectorAll("[data-archivo]").forEach(el => {
        const falta = noDisponibles.has(el.dataset.archivo);
        el.querySelector("[data-estado]").innerHTML = falta
            ? '<span class="badge badge-falta">no disponible aquí</span>' : "";
    });
    document.querySelectorAll("[data-zip]").forEach(b => {
        const p = PROYECTOS.find(x => x.id === b.dataset.zip);
        if (!p) return;
        const faltan = archivosDe(p).filter(a => noDisponibles.has(a.ruta)).length;
        b.title = faltan
            ? `${faltan} de ${archivosDe(p).length} archivos no están disponibles en esta ubicación`
            : `Descargar los ${archivosDe(p).length} archivos de este proyecto`;
        b.classList.toggle("btn-falta", faltan > 0);
    });
}

/* =====================================================================
   3 · EMPAQUETADO ZIP (sin comprimir, sin librerías)
   Se guardan los bytes tal cual: sirve igual para texto y para binarios.
===================================================================== */
const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function armarZip(entradas) {
    const enc = new TextEncoder();
    const partes = [], central = [];
    let offset = 0;
    entradas.forEach(a => {
        const nombre = enc.encode(a.nombre);
        const datos = a.datos;
        const crc = crc32(datos);

        const lh = new Uint8Array(30 + nombre.length);
        const dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
        dv.setUint32(14, crc, true); dv.setUint32(18, datos.length, true); dv.setUint32(22, datos.length, true);
        dv.setUint16(26, nombre.length, true);
        lh.set(nombre, 30);
        partes.push(lh, datos);

        const ch = new Uint8Array(46 + nombre.length);
        const dc = new DataView(ch.buffer);
        dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true);
        dc.setUint16(8, 0x0800, true);
        dc.setUint32(16, crc, true); dc.setUint32(20, datos.length, true); dc.setUint32(24, datos.length, true);
        dc.setUint16(28, nombre.length, true); dc.setUint32(42, offset, true);
        ch.set(nombre, 46);
        central.push(ch);
        offset += lh.length + datos.length;
    });
    const tamCentral = central.reduce((s, c) => s + c.length, 0);
    const fin = new Uint8Array(22);
    const df = new DataView(fin.buffer);
    df.setUint32(0, 0x06054b50, true);
    df.setUint16(8, entradas.length, true); df.setUint16(10, entradas.length, true);
    df.setUint32(12, tamCentral, true); df.setUint32(16, offset, true);
    return new Blob(partes.concat(central, [fin]), { type: "application/zip" });
}

const sello = () => new Date().toISOString().slice(0, 10);

async function descargarPaquete(archivos, nombreZip, boton) {
    await MEUI.conSpinner(boton, "Empaquetando…", async () => {
        const entradas = [];
        const fallos = [];
        for (const a of archivos) {
            try { entradas.push({ nombre: a.ruta, datos: await traerBytes(a.ruta) }); }
            catch (e) {
                fallos.push(a.ruta);
                noDisponibles.set(a.ruta, e.message);
                MEUI.log("✖ " + e.message, "err");
            }
        }
        if (!entradas.length) {
            MEUI.toast("No se pudo leer ningún archivo.", "err");
            return;
        }
        MEUI.descargar(armarZip(entradas), `${nombreZip}_${sello()}.zip`);
        MEUI.log(`Paquete ${nombreZip}: ${entradas.length} archivo(s) empaquetados.`, fallos.length ? "warn" : "ok");
        if (fallos.length) {
            MEUI.log(`Quedaron fuera ${fallos.length}: ${fallos.join(", ")}`, "warn");
            pintarDisponibilidad();
        }
        MEUI.toast(entradas.length + " archivos empaquetados" +
            (fallos.length ? ` · ${fallos.length} sin descargar` : "."), fallos.length ? "warn" : "ok");
    });
}

async function descargarUno(ruta, nombre, boton) {
    await MEUI.conSpinner(boton, "…", async () => {
        try {
            const datos = await traerBytes(ruta);
            MEUI.descargar(new Blob([datos]), nombre);
            MEUI.log("Descargado: " + ruta, "ok");
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            MEUI.toast("No se pudo descargar " + nombre, "err");
        }
    });
}

/* =====================================================================
   4 · PINTADO
===================================================================== */
function htmlArchivoCodigo(archivo) {
    const id = idSeguro(archivo.ruta);
    return `
    <article class="archivo" data-archivo="${esc(archivo.ruta)}">
      <header class="archivo-cab">
        <div class="min-w-0">
          <div class="archivo-nombre"><i class="bi ${esc(archivo.icono)}"></i> ${esc(archivo.nombre)}
            <span data-estado></span></div>
          <div class="archivo-tipo">${esc(archivo.tipo)}</div>
        </div>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-me-line" data-expandir="${id}" title="Ver el archivo completo">
            <i class="bi bi-arrows-expand"></i> Expandir</button>
          <button class="btn btn-sm btn-me-line" data-copiar="${id}">
            <i class="bi bi-clipboard"></i> Copiar</button>
          <button class="btn btn-sm btn-me-line" data-bajar="${esc(archivo.ruta)}"
                  data-nombre="${esc(archivo.nombre)}">
            <i class="bi bi-download"></i> Descargar</button>
        </div>
      </header>
      <div class="archivo-cuerpo">
        <pre id="${id}" class="codigo" data-origen="${esc(archivo.ruta)}"><code>Cargando…</code></pre>
      </div>
    </article>`;
}

function htmlArchivoDoc(archivo, proyecto) {
    return `
    <article class="archivo" data-archivo="${esc(archivo.ruta)}">
      <header class="archivo-cab">
        <div class="min-w-0">
          <div class="archivo-nombre"><i class="bi ${esc(archivo.icono)}"></i> ${esc(archivo.nombre)}
            <span data-estado></span></div>
          <div class="archivo-tipo">${esc(archivo.tipo)} · documentación del proyecto</div>
        </div>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-me" data-doc="${esc(archivo.ruta)}"
                  data-titulo="${esc(proyecto.nombre)}">
            <i class="bi bi-book"></i> Ver documentación</button>
          <button class="btn btn-sm btn-me-line" data-bajar="${esc(archivo.ruta)}"
                  data-nombre="${esc(archivo.nombre)}">
            <i class="bi bi-download"></i> Descargar</button>
        </div>
      </header>
    </article>`;
}

function htmlEntregable(entregable, proyecto) {
    const cuerpo = entregable.archivos.map(a =>
        entregable.tipo === "doc" ? htmlArchivoDoc(a, proyecto) : htmlArchivoCodigo(a)).join("");
    return `
    <section class="entregable">
      <div class="entregable-cab">
        <div class="min-w-0">
          <h3 class="entregable-titulo">${esc(entregable.nombre)}</h3>
          <p class="entregable-desc">${esc(entregable.descripcion)}</p>
        </div>
        <span class="badge ${entregable.tipo === "doc" ? "badge-doc" : "badge-codigo"}">
          ${entregable.tipo === "doc" ? "Documentación" : "Código"}</span>
      </div>
      <div class="entregable-cuerpo">${cuerpo}</div>
    </section>`;
}

function htmlProyecto(p) {
    const id = idSeguro(p.id);
    const n = archivosDe(p).length;
    return `
    <article class="proyecto">
      <div class="proyecto-cab" role="button" tabindex="0"
           data-plegar="proyecto-${id}" aria-expanded="false" aria-controls="proyecto-${id}">
        <div class="proyecto-n">${p.numero || '<i class="bi bi-boxes"></i>'}</div>
        <div class="flex-grow-1 min-w-0">
          <h2 class="proyecto-titulo">${esc(p.nombre)}</h2>
          <p class="proyecto-desc">${esc(p.descripcion)}</p>
        </div>
        <span class="badge ${p.estado === "Común" ? "badge-comun" : "badge-operacion"} d-none d-md-inline-block">
          ${esc(p.estado)}</span>
        <div class="d-flex gap-1 proyecto-acciones">
          ${p.abrir ? `<a class="btn btn-sm btn-me" href="${esc(p.abrir)}">
                          <i class="bi bi-box-arrow-up-right"></i> Abrir</a>` : ""}
          <button class="btn btn-sm btn-me-line" data-zip="${esc(p.id)}"
                  title="Descargar los ${n} archivos de este proyecto">
            <i class="bi bi-file-zip"></i> Descargar</button>
        </div>
        <i class="bi bi-chevron-down proyecto-flecha"></i>
      </div>
      <div id="proyecto-${id}" class="collapse">
        <div class="proyecto-cuerpo">
          ${p.entregables.map(e => htmlEntregable(e, p)).join("")}
        </div>
      </div>
    </article>`;
}

function pintar() {
    document.getElementById("proyectos").innerHTML = PROYECTOS.map(htmlProyecto).join("");
    document.getElementById("kpiProyectos").textContent = PROYECTOS.filter(p => p.abrir).length;
    document.getElementById("kpiEntregables").textContent =
        PROYECTOS.reduce((t, p) => t + p.entregables.length, 0);
    document.getElementById("kpiArchivos").textContent = TODOS().length;
}

/* Carga perezosa: el código se trae cuando se abre el proyecto, no al
   entrar a la portada (son varios cientos de KB). */
function cargarCodigoVisible(contenedor) {
    contenedor.querySelectorAll("pre.codigo[data-origen]:not([data-cargado])").forEach(async pre => {
        pre.dataset.cargado = "1";
        try {
            const txt = await traerTexto(pre.dataset.origen);
            pre.textContent = txt;
            const lineas = txt.split("\n").length;
            const cab = pre.closest(".archivo").querySelector(".archivo-tipo");
            cab.textContent += ` · ${lineas.toLocaleString("es-CO")} líneas`;
        } catch (e) {
            pre.textContent = "No se pudo cargar el archivo.\n\n" + e.message +
                "\n\nSi abriste la portada con doble clic, el navegador bloquea la lectura de " +
                "archivos vecinos: ábrela con dame click.bat.";
            pre.classList.add("codigo-error");
        }
    });
}

document.addEventListener("shown.bs.collapse", ev => {
    if (ev.target.id && ev.target.id.startsWith("proyecto-")) cargarCodigoVisible(ev.target);
});

/* =====================================================================
   5 · ACCIONES
===================================================================== */
document.addEventListener("click", async ev => {
    // --- expandir / contraer el bloque de código (por defecto, 10 líneas)
    const exp = ev.target.closest("[data-expandir]");
    if (exp) {
        const pre = document.getElementById(exp.dataset.expandir);
        const abierto = pre.classList.toggle("codigo-completo");
        exp.innerHTML = abierto
            ? '<i class="bi bi-arrows-collapse"></i> Contraer'
            : '<i class="bi bi-arrows-expand"></i> Expandir';
        return;
    }

    // --- copiar el código
    const cop = ev.target.closest("[data-copiar]");
    if (cop) {
        const pre = document.getElementById(cop.dataset.copiar);
        try {
            await navigator.clipboard.writeText(pre.textContent);
            const antes = cop.innerHTML;
            cop.innerHTML = '<i class="bi bi-check-lg"></i> Copiado';
            cop.classList.add("btn-me");
            setTimeout(() => { cop.innerHTML = antes; cop.classList.remove("btn-me"); }, 1600);
        } catch (e) { MEUI.toast("No se pudo copiar.", "err"); }
        return;
    }

    // --- descargar un archivo suelto
    const baja = ev.target.closest("[data-bajar]");
    if (baja) { descargarUno(baja.dataset.bajar, baja.dataset.nombre, baja); return; }

    // --- descargar un proyecto completo
    const zip = ev.target.closest("[data-zip]");
    if (zip) {
        const p = PROYECTOS.find(x => x.id === zip.dataset.zip);
        if (p) descargarPaquete(archivosDe(p), "herramientas_" + p.id, zip);
        return;
    }

    // --- ver la documentación en el modal
    const doc = ev.target.closest("[data-doc]");
    if (doc) { abrirDoc(doc.dataset.doc, doc.dataset.titulo); return; }

    // --- plegar / desplegar la tarjeta (los botones de arriba no la pliegan)
    const cab = ev.target.closest("[data-plegar]");
    if (cab && !ev.target.closest("button, a")) {
        bootstrap.Collapse.getOrCreateInstance(document.getElementById(cab.dataset.plegar)).toggle();
    }
});

// Enter y Espacio sobre la cabecera hacen lo mismo que el clic
document.addEventListener("keydown", ev => {
    const cab = ev.target.closest && ev.target.closest("[data-plegar]");
    if (!cab || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    bootstrap.Collapse.getOrCreateInstance(document.getElementById(cab.dataset.plegar)).toggle();
});

// La flecha sigue al estado real del panel
["shown.bs.collapse", "hidden.bs.collapse"].forEach(evt =>
    document.addEventListener(evt, ev => {
        const cab = document.querySelector(`[data-plegar="${ev.target.id}"]`);
        if (cab) cab.setAttribute("aria-expanded", evt === "shown.bs.collapse" ? "true" : "false");
    }));

document.getElementById("btnVerificar").addEventListener("click", ev =>
    verificarDisponibilidad(ev.currentTarget));

document.getElementById("btnTodo").addEventListener("click", ev => {
    // Sin repetidos: me-ui, me-api y el .bat están en la lista una sola vez.
    const vistos = new Set(), lista = [];
    TODOS().forEach(a => { if (!vistos.has(a.ruta)) { vistos.add(a.ruta); lista.push(a); } });
    descargarPaquete(lista, "herramientas_operacion", ev.currentTarget);
});

async function abrirDoc(ruta, titulo) {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("modalDoc"));
    document.getElementById("modalDocTitulo").textContent = titulo || "Documentación";
    document.getElementById("modalDocBajar").dataset.bajar = ruta;
    document.getElementById("modalDocBajar").dataset.nombre = "README.md";
    const cuerpo = document.getElementById("modalDocCuerpo");
    cuerpo.innerHTML = '<div class="text-center p-4 me-hint"><span class="me-spin"></span> Cargando…</div>';
    modal.show();
    try {
        const txt = await traerTexto(ruta);
        cuerpo.innerHTML = (typeof marked !== "undefined")
            ? marked.parse(txt)
            : "<pre>" + esc(txt) + "</pre>";
    } catch (e) {
        cuerpo.innerHTML = `<div class="alert alert-danger mb-0">${esc(e.message)}<br>
      <small>Si abriste la portada con doble clic, el navegador bloquea la lectura de archivos
      vecinos: ábrela con <code>dame click.bat</code>.</small></div>`;
    }
}

/* Los chips de sesión de la cabecera llevan a la herramienta que sí puede
   iniciar sesión: la portada no consulta nada por sí misma. */
document.addEventListener("me:sesion-iniciar", e => {
    location.href = e.detail.clave === "sime" ? "reporte_prepagadas.html" : "reporte_casos_masivos.html";
});

/* =====================================================================
   6 · ARRANQUE
===================================================================== */
pintar();
MEUI.log(`Catálogo listo: ${PROYECTOS.length} proyectos · ${TODOS().length} archivos.`, "ok");

if (location.protocol === "file:") {
    MEUI.log("Abierta desde el disco. Si el código o los README no cargan, ábrela con dame click.bat: "
        + "con doble clic el navegador bloquea la lectura de los archivos vecinos.", "warn");
} else {
    MEUI.log(`Publicada en ${location.origin}${BASE.pathname} · comprobando los archivos…`);
    verificarDisponibilidad();
}
