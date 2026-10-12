/* =====================================================================
   assets/herramientas/inicio/inicio.js · Portada — tarjetas, Backlog y descargas
   ---------------------------------------------------------------------
   Esta página NO tiene datos propios de las herramientas: nombre, icono,
   descripción, estado, rutas y archivos salen de ME_CATALOGO
   (assets/base/catalogo.js), la misma fuente que el menú lateral y la
   cabecera de cada herramienta. Una herramienta nueva aparece aquí al
   agregarla al catálogo, sin tocar este archivo.
===================================================================== */
"use strict";

/* =====================================================================
   1 · BACKLOG (vista armada desde el catálogo)
===================================================================== */
const ICONO_POR_EXTENSION = {
    html: "bi-filetype-html", js: "bi-filetype-js", css: "bi-filetype-css",
    md: "bi-markdown", bat: "bi-terminal"
};

/* { ruta, tipo } del catálogo → archivo del Backlog (con nombre e icono). */
function archivoDelBacklog(a) {
    const nombre = a.ruta.split("/").pop();
    const extension = nombre.split(".").pop().toLowerCase();
    return { nombre, tipo: a.tipo, icono: ICONO_POR_EXTENSION[extension] || "bi-file-earmark", ruta: a.ruta };
}

/* Una herramienta del catálogo → proyecto del Backlog: su código y su doc. */
function proyectoDeHerramienta(h, numero) {
    return {
        id: h.id,
        icono: h.icono,
        numero,
        nombre: h.nombre,
        descripcion: h.descripcion,
        estado: h.estado,
        abrir: h.html,
        entregables: [
            {
                nombre: "Código", tipo: "codigo",
                descripcion: h.codigo.descripcion,
                archivos: [{ ruta: h.html, tipo: h.tipoHtml || "HTML · marcado" }, ...h.codigo.archivos]
                    .map(archivoDelBacklog)
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: h.docDescripcion,
                archivos: [archivoDelBacklog({ ruta: h.doc, tipo: "Markdown" })]
            }
        ]
    };
}

/* La base compartida no es una herramienta: sin número ni «Abrir». */
function proyectoDeLaBase(b) {
    return {
        id: b.id,
        numero: 0,
        nombre: b.nombre,
        descripcion: b.descripcion,
        estado: b.estado,
        abrir: null,
        entregables: b.entregables.map(e => ({ ...e, archivos: e.archivos.map(archivoDelBacklog) }))
    };
}

/* Las herramientas en el orden del catálogo (el de las tarjetas) y, al final, la base. */
const BACKLOG = ME_CATALOGO.herramientas
    .filter(h => h.enInicio !== false)
    .map((h, i) => proyectoDeHerramienta(h, i + 1))
    .concat(proyectoDeLaBase(ME_CATALOGO.base));

/* =====================================================================
   2 · UTILIDADES
===================================================================== */
const esc = MEUI.esc;
const idSeguro = v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const archivosDe = p => p.entregables.flatMap(e => e.archivos);
const TODOS = () => BACKLOG.flatMap(archivosDe);

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
        const p = BACKLOG.find(x => x.id === b.dataset.zip);
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
    <article class="proyecto" data-herramienta="${esc(p.id)}">
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

/* Accesos directos: una tarjeta por herramienta con ruta «abrir», en el orden del catálogo. */
function htmlAcceso(p) {
    return `
      <a class="acceso" data-herramienta="${esc(p.id)}" href="${esc(p.abrir)}" title="${esc(p.descripcion)}">
        <i class="bi ${esc(p.icono || "bi-app")}" aria-hidden="true"></i>
        <span class="acceso-nombre">${esc(p.nombre)}</span>
      </a>`;
}

function pintar() {
    document.getElementById("accesos").innerHTML =
        BACKLOG.filter(p => p.abrir).map(htmlAcceso).join("");
    document.getElementById("proyectos").innerHTML = BACKLOG.map(htmlProyecto).join("");
    const aviso = document.createElement("p");
    aviso.id = "inicioSinHerramientas";
    aviso.setAttribute("role", "status");
    aviso.hidden = true;
    document.getElementById("accesos").after(aviso);
    document.getElementById("kpiProyectos").textContent = BACKLOG.filter(p => p.abrir).length;
    document.getElementById("kpiEntregables").textContent =
        BACKLOG.reduce((t, p) => t + p.entregables.length, 0);
    document.getElementById("kpiArchivos").textContent = TODOS().length;
}

/* El catálogo decide las coincidencias; la portada solo cambia visibilidad.
   La base compartida vuelve al Backlog al limpiar la consulta. */
document.addEventListener("me:buscar", e => {
    const { texto, ids } = e.detail;
    const coincidencias = new Set(ids);
    const consulta = texto.trim();
    document.querySelectorAll("#accesos [data-herramienta], #proyectos [data-herramienta]")
        .forEach(el => { el.hidden = !!consulta && !coincidencias.has(el.dataset.herramienta); });
    const aviso = document.getElementById("inicioSinHerramientas");
    aviso.hidden = !consulta || ids.length > 0;
    aviso.textContent = aviso.hidden ? "" : `Sin herramientas para “${texto}”`;
});

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
        const p = BACKLOG.find(x => x.id === zip.dataset.zip);
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
    location.href = ME_CATALOGO.obtener(e.detail.clave === "sime" ? "prepagadas" : "casos").html;
});

/* =====================================================================
   6 · ARRANQUE
===================================================================== */
pintar();
MEUI.log(`Catálogo listo: ${BACKLOG.length} proyectos · ${TODOS().length} archivos.`, "ok");

if (location.protocol === "file:") {
    MEUI.log("Abierta desde el disco. Si el código o los README no cargan, ábrela con dame click.bat: "
        + "con doble clic el navegador bloquea la lectura de los archivos vecinos.", "warn");
} else {
    MEUI.log(`Publicada en ${location.origin}${BASE.pathname} · comprobando los archivos…`);
    verificarDisponibilidad();
}
