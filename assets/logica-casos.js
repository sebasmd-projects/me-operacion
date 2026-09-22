/* =====================================================================
   logica-casos.js · Reglas de negocio del cierre masivo de casos
   ---------------------------------------------------------------------
   Solo lo propio de ESTA herramienta: lectura del Excel, mapeo de
   columnas, armado del título nuevo, búsqueda del ticket y PATCH de
   cierre.

   Lo que comparte con las demás herramientas NO está aquí:
     · marco visual, sesión, registro, tablas, import/export → me-ui.js
     · Keycloak, auth y llamadas al CM                       → me-api.js
     · enganche entre esta lógica y el shell                 → me-casos-puente.js

   v3.2 · El PATCH manda la lista de adjuntos VACÍA, igual que el frontend
          del CM. El gateway exige un "mime-type" que él mismo no guarda
          (el GET del ticket devuelve el adjunto sin esa clave), así que
          enviar la lista siempre daba 422. Con el arreglo vacío pasa y el
          ticket conserva sus adjuntos. Se completan además las
          características que el frontend envía siempre (CARACS_MINIMAS).

   v3.0 · La columna «Favorable» decide QUÉ se hace, no solo si se hace:

            Sí            → cierre: título + «/ Favorable»,   estado final y nota
            No            → cierre: título + «/ Desfavorable», estado final y nota
            vacío + nota  → SOLO nota: no se toca el título ni el estado
            vacío sin nota→ no se envía nada (queda «omitido»)

          accionDe() es quien decide, y todo lo demás (título, PATCH,
          botones, informe, exportación) se cuelga de esa decisión.

   v2.1 · /case/search dejó de responder con el envoltorio
          { tickets:[…], assets:{ Ticket:{…} } } y ahora devuelve un
          arreglo plano de tickets. Se normalizan las dos formas
          (normalizarBusqueda) y se guarda la respuesta cruda en cada
          fila para poder verla desde el botón «Ver».
===================================================================== */
"use strict";

/* El CM responde en inglés para esta herramienta (los estados TMF llegan
   como resolved / closed / cancelled). Es lo único que cambia respecto al
   resto: los endpoints y el token son los mismos de me-api.js. */
MEAPI.configurar({ locale: "en" });

/* Todas las rutas de esta herramienta cuelgan de /api/v1: se antepone aquí
   una sola vez para no repetirlo en cada llamada. */
const apiFetch = (ruta, opciones) => MEAPI.api("/api/v1" + ruta, opciones);
const auth = MEAPI.auth;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* El registro es el del shell: mismo formato y colores en las 4 herramientas. */
function log(txt, nivel) {
    MEUI.log(txt, nivel === "e" ? "err" : nivel === "w" ? "warn" : nivel === "s" ? "ok" : (nivel || "info"));
}
const esc = MEUI.esc;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* =====================================================================
   LECTURA DEL ARCHIVO (SheetJS)
===================================================================== */
function indiceALetras(i) {
    let s = "";
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
}

function valorCelda(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) {
        const p = (x) => String(x).padStart(2, "0");
        const fecha = v.getFullYear() + "-" + p(v.getMonth() + 1) + "-" + p(v.getDate());
        const hora = v.getHours() || v.getMinutes() || v.getSeconds()
            ? " " + p(v.getHours()) + ":" + p(v.getMinutes()) + ":" + p(v.getSeconds()) : "";
        return fecha + hora;
    }
    return String(v).trim();
}

async function leerLibro(file) {
    if (typeof XLSX === "undefined")
        throw new Error("No cargó la librería XLSX (SheetJS). Revisa la conexión al CDN.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    return { wb: wb, hojas: wb.SheetNames.map(n => ({ nombre: n })) };
}

function leerHoja(libro, indice) {
    const hoja = libro.wb.Sheets[libro.hojas[indice].nombre];
    const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "", blankrows: true });
    return matriz.map(f => f.map(valorCelda));
}

/* =====================================================================
   MODELO
===================================================================== */
let libro = null;            // libro abierto
let matrizHoja = [];         // matriz cruda de la hoja elegida
let encabezados = [];        // títulos de columna del archivo
let filas = [];              // filas de trabajo
let dataTable = null;
let tablaRep = null;
let secuencia = 0;
let cancelado = false, pausado = false, corriendo = false;
let modoSimulacion = false;

const CAMPOS = [
    { k: "numeroCaso", t: "Número de caso", req: true, pistas: ["numero de caso", "n de caso", "numero caso", "caso", "case number", "ticketnumber"] },
    { k: "tituloExcel", t: "Título del caso", pistas: ["titulo del caso", "titulo", "asunto", "title"] },
    { k: "favorable", t: "Favorable / Desfavorable", pistas: ["favorable", "resultado", "concepto"] },
    { k: "nota", t: "Nota de cierre", pistas: ["notas", "nota", "nota de resolucion", "observacion", "observaciones"] },
    { k: "descripcion", t: "Descripción", pistas: ["descripcion", "detalle"] },
    { k: "msisdn", t: "MSISDN", pistas: ["msisdn", "linea", "numero de linea", "telefono"] },
    { k: "imsi", t: "IMSI", pistas: ["imsi"] },
    { k: "subscriptionId", t: "ID de suscripción", pistas: ["id de suscripcion", "subscriptionid", "suscripcion"] },
    { k: "creadoEn", t: "Creado en", pistas: ["creado en", "fecha de creacion", "created at"] },
    { k: "creadoPorExcel", t: "Creado por", pistas: ["creado por", "created by", "agente"] },
    { k: "estadoExcel", t: "Estado (archivo)", pistas: ["estado", "state", "status"] },
    { k: "modificadoExcel", t: "Modificado", pistas: ["modificado", "updated"] },
    { k: "ticketExcel", t: "Ticket externo", pistas: ["ticket", "msid", "jira"] },
];
let mapeo = {};   // campo -> índice de columna del archivo (-1 = sin usar)

const normaliza = MEUI.normalizar;

/* Estados en los que el caso YA está cerrado: no se vuelve a tocar. El CM
   usa los de TMF (resolved / closed / cancelled); se aceptan también sus
   equivalentes en español por si el API los devuelve traducidos. */
const ESTADOS_CERRADOS = ["resolved", "closed", "cancelled", "canceled", "resuelto",
    "cerrado", "cancelado", "solucionado", "anulado"];

function esEstadoCerrado(v) {
    const s = normaliza(v);
    if (!s) return false;
    return ESTADOS_CERRADOS.some(e => s === e || s.startsWith(e));
}

function normalizarFavorable(v) {
    const s = normaliza(v);
    if (!s) return "";
    if (["si", "s", "1", "true", "favorable", "x", "positivo", "procede"].includes(s)) return "favorable";
    if (["no", "n", "0", "false", "desfavorable", "negativo", "no procede"].includes(s)) return "desfavorable";
    if (s.startsWith("favor")) return "favorable";
    if (s.startsWith("desfavor")) return "desfavorable";
    return "";
}

/* ---------------------------------------------------------------------
   QUÉ SE HACE CON CADA FILA · la regla central de la herramienta

     "cierre" → hay resultado (favorable o desfavorable): se cambia el
                título, se pone el estado final y se agrega la nota.
     "nota"   → no hay resultado pero sí nota: se agrega SOLO la nota;
                el título y el estado quedan exactamente como están.
     ""       → ni resultado ni nota: no hay nada que enviar.
--------------------------------------------------------------------- */
function accionDe(f) {
    if (!f) return "";
    if (f.resultado === "favorable" || f.resultado === "desfavorable") return "cierre";
    return String(f.nota || "").trim() ? "nota" : "";
}

const ETIQUETA_ACCION = { cierre: "Cierre", nota: "Solo nota" };

/* Estados en los que la fila ya recibió su PATCH y no se vuelve a enviar. */
const ESTADOS_HECHOS = ["cerrado", "nota agregada"];

function opciones() {
    return {
        estado: $("#cfgEstado").value,
        sep: $("#cfgSep").value || " | ",
        txtFav: $("#cfgTxtFav").value.trim() || "favorable",
        txtDesf: $("#cfgTxtDesf").value.trim() || "desfavorable",
        noteType: $("#cfgNoteType").value.trim(),
        noteSub: $("#cfgNoteSub").value.trim(),
        hilos: Math.max(1, Math.min(16, parseInt($("#cfgHilos").value, 10) || 4)),
        reintentos: Math.max(0, parseInt($("#cfgReintentos").value, 10) || 0),
        perPage: Math.max(1, parseInt($("#cfgPerPage").value, 10) || 10),
        varios: $("#cfgTraerVarios").checked,
        creador: $("#cfgCreador").checked,
        agregarResultado: $("#cfgAgregarResultado").checked,
        // Estas dos son condiciones del proceso, no preferencias: no se
        // muestran ni se pueden apagar desde la página.
        exacto: true,        // solo tickets cuyo número coincida exacto
        exigirNota: true,    // sin nota no se cierra (y sin nota ni resultado no se envía nada)
        simular: modoSimulacion,
    };
}

function textoResultado(fila) {
    const o = opciones();
    if (fila.resultado === "favorable") return o.txtFav;
    if (fila.resultado === "desfavorable") return o.txtDesf;
    return "";
}

// Quita del final un "| favorable" o "| desfavorable" puesto en un cierre
// anterior, para no encadenar dos resultados en el mismo título.
function baseTitulo(t) {
    const o = opciones();
    const escapar = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sep = escapar(o.sep.trim() || "|");
    const re = new RegExp("\\s*" + sep + "\\s*(" + escapar(o.txtFav) + "|" + escapar(o.txtDesf) + ")\\s*$", "i");
    let base = String(t || "").replace(re, "").trim();
    // También se quita un separador suelto al final ("... /MSID-341850 /"),
    // para no terminar con "titulo / / Favorable".
    if (o.sep.trim()) base = base.replace(new RegExp("(?:\\s*" + sep + ")+\\s*$"), "").trim();
    return base;
}

function calcularTituloNuevo(fila) {
    const o = opciones();
    // Sin resultado NO hay cierre: el título se deja tal cual está en el CM.
    // Ni siquiera se le quita un resultado anterior, porque eso ya sería
    // modificarlo.
    if (!fila.resultado) return fila.tituloActual || fila.tituloExcel || "";
    const base = baseTitulo(fila.tituloActual || fila.tituloExcel || "");
    if (!o.agregarResultado) return base;
    const res = textoResultado(fila);
    return res ? (base + o.sep + res) : base;
}

// Recalcula los títulos automáticos; los editados a mano se respetan.
function recalcularTitulos() {
    filas.forEach(f => { if (!f.tituloNuevoManual) { f.tituloNuevo = calcularTituloNuevo(f); } });
    if (dataTable) dataTable.rows().invalidate("data").draw(false);
    refrescarResultados();
}

function refrescarTitulo(fila) {
    if (!fila.tituloNuevoManual) fila.tituloNuevo = calcularTituloNuevo(fila);
}

/* =====================================================================
   CARGA DEL ARCHIVO
===================================================================== */
async function cargarArchivo(f) {
    if (!f) return;
    try {
        log("Leyendo " + f.name + " (" + (f.size / 1024).toFixed(0) + " KB)…");
        libro = await leerLibro(f);
        const sel = $("#selHoja");
        sel.innerHTML = "";
        libro.hojas.forEach((h, i) => {
            const op = document.createElement("option");
            op.value = String(i); op.textContent = h.nombre;
            sel.appendChild(op);
        });
        sel.disabled = false;
        $("#btnCargarHoja").disabled = false;
        $("#btnAutoMapeo").disabled = false;
        $("#infoArchivo").classList.remove("d-none");
        $("#infoArchivo").innerHTML = "<b>" + esc(f.name) + "</b> · " + (f.size / 1024).toFixed(0) +
            " KB · hojas: " + libro.hojas.map(h => "<span class='me-mono'>" + esc(h.nombre) + "</span>").join(", ");
        MEUI.resumenPaso(2, f.name + " · " + libro.hojas.length + " hoja(s)");
        log("✔ Archivo leído: " + libro.hojas.length + " hoja(s).", "ok");
        mostrarHoja(0);
    } catch (e) {
        log("✖ No se pudo leer el archivo: " + e.message, "err");
        MEUI.toast("No se pudo leer el archivo.", "err");
    }
}

/* Elegir archivo: clic, teclado o arrastrar y soltar sobre la zona. */
$("#inpArchivo").addEventListener("change", ev => cargarArchivo(ev.target.files[0]));
$("#dropzone").addEventListener("click", () => $("#inpArchivo").click());
$("#dropzone").addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#inpArchivo").click(); }
});
["dragover", "dragenter"].forEach(ev => $("#dropzone").addEventListener(ev, e => {
    e.preventDefault(); $("#dropzone").classList.add("drag");
}));
["dragleave", "drop"].forEach(ev => $("#dropzone").addEventListener(ev, e => {
    e.preventDefault(); $("#dropzone").classList.remove("drag");
}));
$("#dropzone").addEventListener("drop", e => cargarArchivo(e.dataTransfer.files[0]));

$("#selHoja").addEventListener("change", () => mostrarHoja(parseInt($("#selHoja").value, 10)));
$("#inpFilaTitulos").addEventListener("change", () => mostrarHoja(parseInt($("#selHoja").value, 10)));
$("#btnAutoMapeo").addEventListener("click", () => { autoMapear(); pintarMapeo(); });

function mostrarHoja(indice) {
    if (!libro) return;
    matrizHoja = leerHoja(libro, indice);
    const filaTit = Math.max(1, parseInt($("#inpFilaTitulos").value, 10) || 1) - 1;
    encabezados = (matrizHoja[filaTit] || []).map((h, i) => String(h || "").trim() || ("Columna " + indiceALetras(i)));
    const cuerpo = matrizHoja.slice(filaTit + 1).filter(f => f.some(c => String(c || "").trim() !== ""));
    log("Hoja «" + libro.hojas[indice].nombre + "»: " + encabezados.length + " columnas, " + cuerpo.length + " filas con datos.");
    pintarVistaPrevia(cuerpo);
    autoMapear();
    pintarMapeo();
}

function pintarVistaPrevia(cuerpo) {
    const cont = $("#vistaPrevia");
    const muestras = cuerpo.slice(0, 12);
    let html = '<table class="table table-sm table-bordered mb-1"><thead class="table-light"><tr><th>#</th>' +
        encabezados.map(h => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>";
    muestras.forEach((f, i) => {
        html += "<tr><td>" + (i + 1) + "</td>" +
            encabezados.map((_, c) => '<td title="' + esc(f[c] || "") + '">' + esc(f[c] || "") + "</td>").join("") + "</tr>";
    });
    html += "</tbody></table><div class='me-hint'>Mostrando " + muestras.length + " de " + cuerpo.length + " filas.</div>";
    cont.innerHTML = html;
}

function autoMapear() {
    mapeo = {};
    const normHead = encabezados.map(normaliza);
    CAMPOS.forEach(campo => {
        let idx = -1;
        for (const pista of campo.pistas) {
            idx = normHead.findIndex(h => h === pista);
            if (idx >= 0) break;
        }
        if (idx < 0) {
            for (const pista of campo.pistas) {
                idx = normHead.findIndex(h => h.includes(pista));
                if (idx >= 0) break;
            }
        }
        mapeo[campo.k] = idx;
    });
}

function pintarMapeo() {
    const cont = $("#mapeo");
    cont.innerHTML = "";
    CAMPOS.forEach(campo => {
        const col = document.createElement("div");
        col.className = "col-12";
        const opts = ['<option value="-1">— sin usar —</option>'].concat(
            encabezados.map((h, i) => '<option value="' + i + '"' + (mapeo[campo.k] === i ? " selected" : "") + ">" +
                esc(h) + "</option>")).join("");
        col.innerHTML = '<div class="input-group input-group-sm">' +
            '<span class="input-group-text" style="min-width:190px">' + esc(campo.t) +
            (campo.req ? ' <span class="text-danger ms-1">*</span>' : "") + "</span>" +
            '<select class="form-select" data-campo="' + campo.k + '">' + opts + "</select></div>";
        cont.appendChild(col);
    });
    cont.querySelectorAll("select[data-campo]").forEach(s => {
        s.addEventListener("change", () => { mapeo[s.dataset.campo] = parseInt(s.value, 10); });
    });
}

$("#btnCargarHoja").addEventListener("click", () => {
    if (!libro) return;
    if (mapeo.numeroCaso === undefined || mapeo.numeroCaso < 0) {
        MEUI.toast("Indica qué columna tiene el número de caso.", "warn");
        return;
    }
    const filaTit = Math.max(1, parseInt($("#inpFilaTitulos").value, 10) || 1) - 1;
    const cuerpo = matrizHoja.slice(filaTit + 1).filter(f => f.some(c => String(c || "").trim() !== ""));

    filas = [];
    secuencia = 0;
    cuerpo.forEach(f => {
        const numero = String(f[mapeo.numeroCaso] || "").trim();
        if (!numero) return;
        filas.push(nuevaFila(numero, f));
    });
    filas.forEach((f, i) => f.n = i + 1);

    construirTabla();
    const cierres = filas.filter(f => accionDe(f) === "cierre").length;
    const notas = filas.filter(f => accionDe(f) === "nota").length;
    const nada = filas.length - cierres - notas;
    log("✔ " + filas.length + " casos cargados: " + cierres + " para cerrar, " + notas +
        " solo con nota y " + nada + " sin resultado ni nota.", "ok");
    MEUI.resumenPaso(2, filas.length + " casos cargados");
    // Ya está el archivo: el paso se cierra y el trabajo pasa a la tabla.
    MEUI.abrirPaso(2, false);
    MEUI.abrirPaso(4, true);
});

function valorDe(f, campo) {
    const i = mapeo[campo];
    return (i === undefined || i < 0) ? "" : String(f[i] || "").trim();
}

function nuevaFila(numero, f) {
    const fila = {
        __id: ++secuencia,
        n: 0,
        sel: false,   // nada viene marcado: el usuario elige qué trabajar
        oculta: false,
        original: f.slice(),
        numeroCaso: numero,
        tituloExcel: valorDe(f, "tituloExcel"),
        resultado: normalizarFavorable(valorDe(f, "favorable")),
        favorableCrudo: valorDe(f, "favorable"),
        nota: valorDe(f, "nota"),
        descripcion: valorDe(f, "descripcion"),
        msisdn: valorDe(f, "msisdn"),
        imsi: valorDe(f, "imsi"),
        subscriptionId: valorDe(f, "subscriptionId"),
        creadoEn: valorDe(f, "creadoEn"),
        creadoPorExcel: valorDe(f, "creadoPorExcel"),
        estadoExcel: valorDe(f, "estadoExcel"),
        modificadoExcel: valorDe(f, "modificadoExcel"),
        ticketExcel: valorDe(f, "ticketExcel"),
        ticketId: "",
        estadoCM: "",
        yaCerrado: false,
        tituloActual: "",
        tituloNuevo: "",
        tituloNuevoManual: false,
        estadoProceso: "pendiente",
        mensaje: "",
        http: "",
        creadoPorCM: "",
        procesadoEn: "",
        busquedaRaw: null,   // respuesta cruda de /case/search (para diagnosticar)
        assetTicket: null,
        ticketRaw: null,
        historial: null,
        cuerpoPatch: null,
        respuestaPatch: null,
    };
    fila.tituloNuevo = calcularTituloNuevo(fila);
    return fila;
}

/* =====================================================================
   TABLA DE TRABAJO
===================================================================== */
const COLUMNAS = [
    {
        t: '<input type="checkbox" class="form-check-input chk-todas" title="Marcar o desmarcar lo visible">',
        k: "sel", orden: false, buscar: false, def: true,
        txt: f => f.sel ? "1" : "0",
        render: f => '<input type="checkbox" class="form-check-input chk-fila" data-id="' + f.__id + '"' + (f.sel ? " checked" : "") + ">"
    },
    { t: "#", k: "n", txt: f => String(f.n) },
    { t: "Nº caso", k: "numeroCaso", def: true, txt: f => f.numeroCaso, render: f => '<span class="me-mono">' + esc(f.numeroCaso) + "</span>" },
    { t: "Ticket", k: "ticketId", def: true, txt: f => f.ticketId, render: f => '<span class="me-mono">' + esc(f.ticketId) + "</span>" },
    {
        t: "Estado", k: "estadoProceso", def: true, txt: f => f.estadoProceso,
        render: f => '<span data-est="' + f.__id + '">' + insigniaEstado(f) + "</span>"
    },
    {
        t: "Acción", k: "accion", def: true, orden: false, txt: f => ETIQUETA_ACCION[accionDe(f)] || "sin acción",
        render: f => '<span data-acc="' + f.__id + '">' + insigniaAccion(f) + "</span>"
    },
    {
        t: "Resultado", k: "resultado", def: true, txt: f => f.resultado || "sin definir",
        render: f => '<select class="form-select form-select-sm celda-edit" style="min-width:130px" data-id="' + f.__id +
            '" data-campo="resultado" title="Sin resultado el caso no se cierra: solo se agrega la nota.">' +
            '<option value=""' + (f.resultado ? "" : " selected") + ">— solo nota —</option>" +
            '<option value="favorable"' + (f.resultado === "favorable" ? " selected" : "") + ">Favorable</option>" +
            '<option value="desfavorable"' + (f.resultado === "desfavorable" ? " selected" : "") + ">Desfavorable</option>" +
            "</select>"
    },
    {
        t: "Título actual (CM)", k: "tituloActual", txt: f => f.tituloActual,
        render: f => '<span class="me-txt-corto" title="' + esc(f.tituloActual) + '">' + esc(f.tituloActual) + "</span>"
    },
    {
        t: "Título nuevo", k: "tituloNuevo", def: true, txt: f => f.tituloNuevo,
        render: f => '<input class="form-control form-control-sm celda-edit ancha' +
            (f.tituloNuevoManual && f.resultado ? " editada" : "") + '"' +
            (f.resultado ? "" : ' readonly title="Sin resultado el título no se toca: el ticket queda como está."') +
            ' data-id="' + f.__id + '" data-campo="tituloNuevo" value="' + esc(f.tituloNuevo) + '">'
    },
    {
        t: "Nota de cierre", k: "nota", def: true, txt: f => f.nota,
        render: f => '<input class="form-control form-control-sm celda-edit ancha' + (faltaNota(f) ? " falta" : "") +
            '" data-id="' + f.__id + '" data-campo="nota" value="' + esc(f.nota) + '"' +
            (faltaNota(f) ? ' title="Con resultado hay que escribir la nota de cierre."' : "") + ">"
    },
    {
        t: "Mensaje", k: "mensaje", def: true, txt: f => f.mensaje,
        render: f => '<span data-msg="' + f.__id + '" class="me-txt-corto" title="' + esc(f.mensaje) + '">' + esc(f.mensaje) + "</span>"
    },
    { t: "Estado en el CM", k: "estadoCM", txt: f => f.estadoCM },
    { t: "Favorable (archivo)", k: "favorableCrudo", txt: f => f.favorableCrudo },
    { t: "Título (archivo)", k: "tituloExcel", txt: f => f.tituloExcel, render: f => '<span class="me-txt-corto" title="' + esc(f.tituloExcel) + '">' + esc(f.tituloExcel) + "</span>" },
    { t: "MSISDN", k: "msisdn", def: true, txt: f => f.msisdn },
    { t: "IMSI", k: "imsi", txt: f => f.imsi },
    { t: "Suscripción", k: "subscriptionId", txt: f => f.subscriptionId },
    { t: "Estado (archivo)", k: "estadoExcel", def: true, txt: f => f.estadoExcel },
    { t: "Creado en", k: "creadoEn", txt: f => f.creadoEn },
    { t: "Creado por (archivo)", k: "creadoPorExcel", txt: f => f.creadoPorExcel, render: f => '<span class="me-txt-corto" title="' + esc(f.creadoPorExcel) + '">' + esc(f.creadoPorExcel) + "</span>" },
    { t: "Creado por (CM)", k: "creadoPorCM", txt: f => f.creadoPorCM },
    { t: "Ticket externo", k: "ticketExcel", txt: f => f.ticketExcel },
    { t: "Procesado", k: "procesadoEn", txt: f => f.procesadoEn },
    {
        t: "Acciones", k: "acciones", def: true, orden: false, buscar: false, txt: () => "",
        render: f => '<div class="btn-group btn-group-sm">' +
            '<button class="btn btn-me-line btn-ver" data-id="' + f.__id + '" type="button">Ver</button>' +
            '<button class="btn btn-me-line btn-ocultar" data-id="' + f.__id + '" type="button">' +
            (f.oculta ? "Mostrar" : "Ocultar") + "</button></div>"
    },
];

/* Falta la nota solo cuando la fila SÍ va a cerrarse: en modo «solo nota»
   la nota es justamente lo que hace que exista la fila. */
function faltaNota(f) {
    return accionDe(f) === "cierre" && !String(f.nota || "").trim();
}

function insigniaEstado(f) {
    const mapa = {
        pendiente: "secondary", buscando: "info", preparado: "primary", cerrando: "warning",
        anotando: "warning", cerrado: "success", simulado: "success",
        "nota agregada": "success", "nota simulada": "success", "nota sin cambios": "secondary",
        error: "danger", omitido: "dark", "sin ticket": "danger", "ya cerrado": "info",
    };
    const color = mapa[f.estadoProceso] || "secondary";
    return '<span class="badge badge-est text-bg-' + color + '">' + esc(f.estadoProceso) + "</span>";
}

function insigniaAccion(f) {
    const a = accionDe(f);
    if (a === "cierre") return '<span class="badge badge-est text-bg-dark">Cierre</span>';
    if (a === "nota") return '<span class="badge badge-est text-bg-info" ' +
        'title="Sin resultado: solo se agrega la nota, el título y el estado quedan igual.">Solo nota</span>';
    return '<span class="badge badge-est text-bg-light text-muted border" ' +
        'title="Sin resultado y sin nota: no hay nada que enviar al CM.">sin acción</span>';
}

function construirTabla() {
    if (dataTable) { dataTable.destroy(); $("#tablaCasos").innerHTML = ""; }
    MEUI.prepararTabla("#tablaCasos");
    $("#tablaCasos").innerHTML = "<thead><tr>" + COLUMNAS.map(c => "<th>" + c.t + "</th>").join("") +
        "</tr></thead><tbody></tbody>";

    dataTable = MEUI.tabla("#tablaCasos", {
        data: filas,
        pageLength: 25,
        lengthMenu: [10, 25, 50, 100, 250],
        order: [[1, "asc"]],
        columns: COLUMNAS.map(c => ({
            title: c.t,
            orderable: c.orden !== false,
            searchable: c.buscar !== false,
            visible: c.def === true,
            data: null,
            render: (d, type, f) => type === "display"
                ? (c.render ? c.render(f) : esc(c.txt(f)))
                : c.txt(f),
        })),
        createdRow: (tr, f) => { if (f.oculta) tr.classList.add("fila-oculta"); },
        language: Object.assign({}, MEUI.idiomaTabla, {
            lengthMenu: "Mostrar _MENU_ casos",
            info: "Mostrando _START_–_END_ de _TOTAL_ casos",
            infoEmpty: "Sin casos", emptyTable: "Carga un archivo para empezar"
        })
    });

    pintarMenuColumnas();
    refrescarEstadosArchivo();
    refrescarEstadosFiltro();
    actualizarContadores();
    construirTablaResultados();
    MEUI.mostrarSiHayDatos("#tablaCasos", { vacio: "#msgVacioCasos", tabla: dataTable });
}

/* Filtro propio: filas ocultas, estado, acción, resultado, selección y texto. */
DataTable.ext.search.push(function (settings, datos, indice, fila) {
    if (settings.nTable.id !== "tablaCasos") return true;
    const f = fila || filas[indice];
    if (!f) return true;
    if (f.oculta && !$("#chkVerOcultas").checked) return false;
    const est = $("#fEstado").value;
    if (est && f.estadoProceso !== est) return false;
    const estArch = $("#fEstadoArchivo").value;
    if (estArch && f.estadoExcel !== estArch) return false;
    const acc = $("#fAccion").value;
    if (acc === "__nada" && accionDe(f)) return false;
    if (acc && acc !== "__nada" && accionDe(f) !== acc) return false;
    const fav = $("#fFavorable").value;
    if (fav === "__vacio" && f.resultado) return false;
    if (fav && fav !== "__vacio" && f.resultado !== fav) return false;
    const sel = $("#fSel").value;
    if (sel === "si" && !f.sel) return false;
    if (sel === "no" && f.sel) return false;
    const txt = normaliza($("#fTexto").value);
    if (txt) {
        const todo = normaliza([f.numeroCaso, f.ticketId, f.tituloActual, f.tituloNuevo, f.tituloExcel,
        f.mensaje, f.nota, f.msisdn, f.imsi, f.subscriptionId, f.creadoPorExcel, f.creadoPorCM, f.ticketExcel].join(" "));
        if (!todo.includes(txt)) return false;
    }
    return true;
});

["fEstado", "fEstadoArchivo", "fAccion", "fFavorable", "fSel", "chkVerOcultas"].forEach(id =>
    $("#" + id).addEventListener("change", () => redibujar()));
$("#fTexto").addEventListener("input", () => redibujar());
$("#btnLimpiarFiltros").addEventListener("click", () => {
    $("#fEstado").value = ""; $("#fEstadoArchivo").value = ""; $("#fAccion").value = "";
    $("#fFavorable").value = ""; $("#fSel").value = ""; $("#fTexto").value = "";
    $("#chkVerOcultas").checked = false;
    if (dataTable) dataTable.search("");
    redibujar();
});

/* DataTables cachea lo que ya pintó: para que las casillas y los selects
   reflejen el modelo hay que invalidar las filas antes de redibujar. */
function redibujar(reRender) {
    if (dataTable) {
        if (reRender) dataTable.rows().invalidate("data");
        dataTable.draw(false);
    }
    actualizarContadores();
    sincronizarCasillaTodas();
}

function sincronizarCasillaTodas() {
    if (!dataTable) return;
    const vis = filasVisibles();
    const todas = vis.length > 0 && vis.every(f => f.sel);
    const algunas = vis.some(f => f.sel);
    $$(".chk-todas").forEach(c => {
        c.checked = todas;
        c.indeterminate = !todas && algunas;
    });
}

/* Los estados que trae el archivo (Escalado, Cerrado, …). Se preselecciona
   "Escalado", que es lo que normalmente se va a cerrar. */
function refrescarEstadosArchivo() {
    const sel = $("#fEstadoArchivo");
    const actual = sel.value;
    const estados = Array.from(new Set(filas.map(f => f.estadoExcel).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">Todos</option>' +
        estados.map(e => '<option value="' + esc(e) + '">' + esc(e) + "</option>").join("");
    if (actual && estados.includes(actual)) { sel.value = actual; return; }
    const escalado = estados.find(e => normaliza(e) === "escalado");
    sel.value = escalado || "";
}

function refrescarEstadosFiltro() {
    const sel = $("#fEstado");
    const actual = sel.value;
    const estados = Array.from(new Set(filas.map(f => f.estadoProceso))).sort();
    sel.innerHTML = '<option value="">Todos</option>' +
        estados.map(e => '<option value="' + esc(e) + '">' + esc(e) + "</option>").join("");
    sel.value = estados.includes(actual) ? actual : "";
}

function pintarMenuColumnas() {
    const cont = $("#menuColumnas");
    cont.innerHTML = COLUMNAS.map((c, i) => {
        const etiqueta = c.k === "sel" ? "Selección" : String(c.t).replace(/<[^>]*>/g, "");
        return '<div class="form-check"><input class="form-check-input chk-col" type="checkbox"' +
            (c.def === true ? " checked" : "") + ' id="col' + i + '" data-col="' + i +
            '"><label class="form-check-label small" for="col' + i + '">' + esc(etiqueta) + "</label></div>";
    }).join("");
    cont.querySelectorAll(".chk-col").forEach(chk => {
        chk.addEventListener("change", () => {
            dataTable.column(parseInt(chk.dataset.col, 10)).visible(chk.checked);
            MEUI.ajustarTablas();
        });
    });
}

/* =====================================================================
   TABLA DEL INFORME
   Misma fuente de datos que la tabla de trabajo, pero de solo lectura y
   con filtros PROPIOS: lo que se filtre aquí no afecta a la otra.
===================================================================== */
const COLUMNAS_REP = [
    { t: "#", txt: f => String(f.n) },
    { t: "Nº caso", txt: f => f.numeroCaso, render: f => '<span class="me-mono">' + esc(f.numeroCaso) + "</span>" },
    { t: "Ticket", txt: f => f.ticketId, render: f => '<span class="me-mono">' + esc(f.ticketId) + "</span>" },
    { t: "Estado del proceso", txt: f => f.estadoProceso, render: f => insigniaEstado(f) },
    { t: "Acción", txt: f => ETIQUETA_ACCION[accionDe(f)] || "sin acción", render: f => insigniaAccion(f) },
    { t: "Estado en el CM", txt: f => f.estadoCM },
    { t: "Se cerró", txt: f => (f.estadoProceso === "cerrado" ? "Sí" : "No") },
    { t: "Nota agregada", txt: f => (ESTADOS_HECHOS.includes(f.estadoProceso) ? "Sí" : "No") },
    { t: "Resultado", txt: f => f.resultado || "sin definir" },
    { t: "Título anterior", txt: f => f.tituloActual, render: f => corto(f.tituloActual) },
    { t: "Título nuevo", txt: f => (f.resultado ? f.tituloNuevo : "(sin cambio)"), render: f => corto(f.resultado ? f.tituloNuevo : "(sin cambio)") },
    { t: "Nota enviada", txt: f => f.nota, render: f => corto(f.nota) },
    { t: "Mensaje", txt: f => f.mensaje, render: f => corto(f.mensaje) },
    { t: "HTTP", txt: f => String(f.http || "") },
    { t: "Procesado", txt: f => f.procesadoEn },
    { t: "Estado (archivo)", txt: f => f.estadoExcel },
    { t: "MSISDN", txt: f => f.msisdn },
    {
        t: "Detalle", orden: false, buscar: false, txt: () => "",
        render: f => '<button class="btn btn-sm btn-me-line btn-ver" data-id="' + f.__id + '" type="button">Ver</button>'
    },
];

const corto = (v) => '<span class="me-txt-corto" title="' + esc(v) + '">' + esc(v) + "</span>";

function construirTablaResultados() {
    if (tablaRep) { tablaRep.destroy(); $("#tablaResultados").innerHTML = ""; }
    MEUI.prepararTabla("#tablaResultados");
    $("#tablaResultados").innerHTML = "<thead><tr>" +
        COLUMNAS_REP.map(c => "<th>" + c.t + "</th>").join("") + "</tr></thead><tbody></tbody>";

    tablaRep = MEUI.tabla("#tablaResultados", {
        data: filas,
        pageLength: 25,
        lengthMenu: [10, 25, 50, 100, 250],
        columns: COLUMNAS_REP.map(c => ({
            title: c.t,
            orderable: c.orden !== false,
            searchable: c.buscar !== false,
            data: null,
            render: (d, type, f) => type === "display"
                ? (c.render ? c.render(f) : esc(c.txt(f)))
                : c.txt(f),
        })),
        language: Object.assign({}, MEUI.idiomaTabla, {
            lengthMenu: "Mostrar _MENU_ casos",
            info: "Mostrando _START_–_END_ de _TOTAL_ casos",
            infoEmpty: "Sin casos", emptyTable: "Todavía no hay casos cargados"
        })
    });

    pintarMenuColumnasRep();
    refrescarFiltrosRep();
}

/* Filtros propios del informe (prefijo r*). */
DataTable.ext.search.push(function (settings, datos, indice, fila) {
    if (settings.nTable.id !== "tablaResultados") return true;
    const f = fila || filas[indice];
    if (!f) return true;
    const est = $("#rEstado").value;
    if (est && f.estadoProceso !== est) return false;
    const estCm = $("#rEstadoCM").value;
    if (estCm && (f.estadoCM || "(sin dato)") !== estCm) return false;
    const acc = $("#rAccion").value;
    if (acc === "__nada" && accionDe(f)) return false;
    if (acc && acc !== "__nada" && accionDe(f) !== acc) return false;
    const fav = $("#rFavorable").value;
    if (fav === "__vacio" && f.resultado) return false;
    if (fav && fav !== "__vacio" && f.resultado !== fav) return false;
    const txt = normaliza($("#rTexto").value);
    if (txt) {
        const todo = normaliza([f.numeroCaso, f.ticketId, f.estadoCM, f.tituloActual, f.tituloNuevo,
        f.nota, f.mensaje, f.msisdn, f.estadoExcel].join(" "));
        if (!todo.includes(txt)) return false;
    }
    return true;
});

["rEstado", "rEstadoCM", "rAccion", "rFavorable"].forEach(id =>
    $("#" + id).addEventListener("change", () => { if (tablaRep) tablaRep.draw(false); }));
$("#rTexto").addEventListener("input", () => { if (tablaRep) tablaRep.draw(false); });
$("#btnLimpiarFiltrosRep").addEventListener("click", () => {
    $("#rEstado").value = ""; $("#rEstadoCM").value = ""; $("#rAccion").value = "";
    $("#rFavorable").value = ""; $("#rTexto").value = "";
    if (tablaRep) { tablaRep.search(""); tablaRep.draw(false); }
});

function refrescarFiltrosRep() {
    const llenar = (sel, valores) => {
        const actual = sel.value;
        sel.innerHTML = '<option value="">Todos</option>' +
            valores.map(v => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
        sel.value = valores.includes(actual) ? actual : "";
    };
    llenar($("#rEstado"), Array.from(new Set(filas.map(f => f.estadoProceso))).sort());
    llenar($("#rEstadoCM"), Array.from(new Set(filas.map(f => f.estadoCM || "(sin dato)"))).sort());
}

function pintarMenuColumnasRep() {
    const cont = $("#menuColumnasRep");
    cont.innerHTML = COLUMNAS_REP.map((c, i) =>
        '<div class="form-check"><input class="form-check-input chk-col-rep" type="checkbox" checked id="colr' + i +
        '" data-col="' + i + '"><label class="form-check-label small" for="colr' + i + '">' +
        esc(c.t) + "</label></div>").join("");
    cont.querySelectorAll(".chk-col-rep").forEach(chk => {
        chk.addEventListener("change", () => {
            tablaRep.column(parseInt(chk.dataset.col, 10)).visible(chk.checked);
            MEUI.ajustarTablas();
        });
    });
}

/* Se llama al terminar cada tanda: el informe refleja lo que acaba de pasar. */
function refrescarResultados() {
    if (!tablaRep) return;
    refrescarFiltrosRep();
    tablaRep.rows().invalidate("data").draw(false);
    MEUI.mostrarSiHayDatos("#tablaResultados", { vacio: "#msgVacioRep", tabla: tablaRep });
}

/* =====================================================================
   EDICIÓN EN LA TABLA Y ACCIONES POR FILA
===================================================================== */
const porId = (id) => filas.find(f => f.__id === parseInt(id, 10));

document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains("chk-fila")) {
        const f = porId(el.dataset.id);
        if (f) { f.sel = el.checked; actualizarContadores(); sincronizarCasillaTodas(); }
    }
    if (el.classList && el.classList.contains("chk-todas")) {
        const marcar = el.checked;
        dataTable.rows({ search: "applied" }).indexes().toArray().forEach(i => { filas[i].sel = marcar; });
        redibujar(true);
    }
    if (el.classList && el.classList.contains("celda-edit") && el.dataset.campo === "resultado") {
        const f = porId(el.dataset.id);
        if (f) {
            f.resultado = el.value;
            // Al quedarse sin resultado la fila pasa a «solo nota»: un título
            // editado a mano ya no aplica, porque el título no se va a tocar.
            if (!f.resultado) f.tituloNuevoManual = false;
            refrescarTitulo(f);
            refrescarFila(f);
            actualizarContadores();
        }
    }
});

document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el.classList || !el.classList.contains("celda-edit")) return;
    const f = porId(el.dataset.id);
    if (!f) return;
    if (el.dataset.campo === "tituloNuevo") {
        if (!f.resultado) { el.value = f.tituloNuevo; return; }   // sin resultado no se edita
        f.tituloNuevo = el.value; f.tituloNuevoManual = true; el.classList.add("editada");
    } else if (el.dataset.campo === "nota") {
        // La nota decide si una fila sin resultado tiene algo que enviar:
        // hay que repintar acción, estado del campo y botones.
        f.nota = el.value;
        el.classList.toggle("falta", faltaNota(f));
        refrescarFila(f);
        actualizarContadores();
    }
});

document.addEventListener("click", (ev) => {
    const ver = ev.target.closest(".btn-ver");
    if (ver) { abrirDetalle(porId(ver.dataset.id)); return; }
    const oc = ev.target.closest(".btn-ocultar");
    if (oc) {
        const f = porId(oc.dataset.id);
        if (f) { f.oculta = !f.oculta; redibujar(true); }
    }
});

$("#btnMarcarVisibles").addEventListener("click", () => marcarVisibles(true));
$("#btnDesmarcarVisibles").addEventListener("click", () => marcarVisibles(false));
function marcarVisibles(v) {
    if (!dataTable) return;
    dataTable.rows({ search: "applied" }).indexes().toArray().forEach(i => { filas[i].sel = v; });
    redibujar(true);
}
$("#btnOcultarSel").addEventListener("click", () => { filasVisibles().forEach(f => { if (f.sel) f.oculta = true; }); redibujar(true); });
$("#btnOcultarNoSel").addEventListener("click", () => { filasVisibles().forEach(f => { if (!f.sel) f.oculta = true; }); redibujar(true); });
$("#btnRestaurarOcultas").addEventListener("click", () => { filas.forEach(f => f.oculta = false); redibujar(true); });

function filasVisibles() {
    if (!dataTable) return [];
    return dataTable.rows({ search: "applied" }).indexes().toArray().map(i => filas[i]);
}

function refrescarFila(f) {
    // Actualización puntual: se tocan solo las celdas del proceso para no
    // perder el foco de lo que el usuario esté escribiendo en otra fila.
    const est = document.querySelector('[data-est="' + f.__id + '"]');
    if (est) est.innerHTML = insigniaEstado(f);
    const acc = document.querySelector('[data-acc="' + f.__id + '"]');
    if (acc) acc.innerHTML = insigniaAccion(f);
    const msg = document.querySelector('[data-msg="' + f.__id + '"]');
    if (msg) { msg.textContent = f.mensaje; msg.title = f.mensaje; }
    const tit = document.querySelector('input[data-id="' + f.__id + '"][data-campo="tituloNuevo"]');
    if (tit) {
        // Sin resultado el título es de solo lectura: el ticket conserva el suyo.
        tit.readOnly = !f.resultado;
        tit.title = f.resultado ? "" : "Sin resultado el título no se toca: el ticket queda como está.";
        tit.classList.toggle("editada", !!(f.tituloNuevoManual && f.resultado));
        if (!f.tituloNuevoManual && tit.value !== f.tituloNuevo) tit.value = f.tituloNuevo;
    }
    const nota = document.querySelector('input[data-id="' + f.__id + '"][data-campo="nota"]');
    if (nota) nota.classList.toggle("falta", faltaNota(f));
}

/* Los botones del paso 4 se habilitan solo cuando su acción tiene sentido.
   Así no se puede cerrar sin haber buscado, ni reintentar en mitad de una
   tanda. El título explica por qué está deshabilitado. */
function actualizarBotones() {
    const marcadas = filas.filter(f => f.sel && !f.oculta);
    const porBuscar = marcadas.filter(f => !f.ticketId && !ESTADOS_HECHOS.includes(f.estadoProceso)).length;
    // Listas para enviar: tienen ticket, no están cerradas en el CM y tienen
    // algo que hacer (cerrar, o al menos agregar la nota).
    const listas = marcadas.filter(f => f.ticketId && !f.yaCerrado &&
        !ESTADOS_HECHOS.includes(f.estadoProceso) && f.estadoProceso !== "nota sin cambios" && accionDe(f));
    const cierres = listas.filter(f => accionDe(f) === "cierre").length;
    const notas = listas.length - cierres;
    const fallidos = filas.filter(f => !f.yaCerrado &&
        (f.estadoProceso === "error" || f.estadoProceso === "sin ticket" || f.estadoProceso === "omitido")).length;

    const poner = (id, activo, motivo, listo) => {
        const b = $("#" + id);
        if (!b || b.dataset.meOcupado) return;   // si está con spinner, no se toca
        b.disabled = !activo;
        b.title = activo ? listo : motivo;
    };

    poner("btnBuscar", !corriendo && porBuscar > 0,
        corriendo ? "Hay una tanda en curso" : "Marca en la tabla los casos que quieras buscar",
        porBuscar + " caso(s) marcados por buscar");
    poner("btnCerrar", !corriendo && listas.length > 0,
        corriendo ? "Hay una tanda en curso" : "Primero busca los tickets: solo se envía lo que ya se consultó en el CM",
        cierres + " para cerrar · " + notas + " solo con nota");
    poner("btnReintentar", !corriendo && fallidos > 0,
        corriendo ? "Hay una tanda en curso" : "No hay casos con error",
        fallidos + " caso(s) con error");
}

function actualizarContadores() {
    const total = filas.length;
    const sel = filas.filter(f => f.sel && !f.oculta).length;
    const ok = filas.filter(f => f.estadoProceso === "cerrado" || f.estadoProceso === "simulado").length;
    const notas = filas.filter(f => f.estadoProceso === "nota agregada" || f.estadoProceso === "nota simulada").length;
    const err = filas.filter(f => f.estadoProceso === "error" || f.estadoProceso === "sin ticket").length;
    const prep = filas.filter(f => f.estadoProceso === "preparado").length;
    const pend = filas.filter(f => f.estadoProceso === "pendiente").length;
    $("#cTotal").textContent = total; $("#cSel").textContent = sel;
    $("#cOk").textContent = ok; $("#cErr").textContent = err;
    $("#cNota").textContent = notas;
    $("#cPrep").textContent = prep; $("#cPend").textContent = pend;
    $("#cYa").textContent = filas.filter(f => f.yaCerrado).length;
    $("#numOcultas").textContent = filas.filter(f => f.oculta).length;
    $("#resumenSeleccion").textContent = sel + " de " + total + " marcadas · " +
        (dataTable ? dataTable.rows({ search: "applied" }).count() : 0) + " visibles";
    actualizarBotones();
}

function abrirDetalle(f) {
    if (!f) return;
    $("#modalTitulo").textContent = "Caso " + f.numeroCaso + (f.ticketId ? " · ticket " + f.ticketId : "");
    const bloque = (titulo, obj) => '<h6 class="mt-3">' + esc(titulo) +
        "</h6><pre class='me-mono small bg-light border rounded p-2' style='max-height:280px;overflow:auto'>" +
        esc(obj === null || obj === undefined ? "(sin datos)" : (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2))) + "</pre>";
    const accion = accionDe(f);
    $("#modalCuerpo").innerHTML =
        '<div class="row small"><div class="col-md-6"><b>Acción:</b> ' +
        esc(ETIQUETA_ACCION[accion] || "sin acción") +
        (accion === "nota" ? " — el título y el estado del ticket no se modifican" : "") + "</div>" +
        '<div class="col-md-6"><b>Resultado:</b> ' + esc(f.resultado || "sin definir") + "</div>" +
        '<div class="col-md-6"><b>Título actual:</b> ' + esc(f.tituloActual) + "</div>" +
        '<div class="col-md-6"><b>Título nuevo:</b> ' + esc(f.resultado ? f.tituloNuevo : "(sin cambio)") + "</div>" +
        '<div class="col-md-6"><b>Estado del proceso:</b> ' + esc(f.estadoProceso) + " " + esc(f.mensaje) + "</div>" +
        '<div class="col-md-6"><b>Estado en el CM:</b> ' + esc(f.estadoCM || "(sin dato)") + "</div></div>" +
        bloque("Cuerpo del PATCH", f.cuerpoPatch) +
        bloque("Respuesta del PATCH", f.respuestaPatch) +
        bloque("Ticket en el CM", f.ticketRaw) +
        bloque("Resultado de la búsqueda", f.assetTicket) +
        // Respuesta tal cual la devolvió /case/search: si el API vuelve a
        // cambiar de forma, aquí se ve sin abrir la consola del navegador.
        bloque("Respuesta cruda de /case/search", f.busquedaRaw) +
        bloque("Historial", f.historial) +
        bloque("Fila del archivo", f.original);
    bootstrap.Modal.getOrCreateInstance($("#modalDetalle")).show();
}

/* =====================================================================
   PROCESO: BUSCAR Y CERRAR
===================================================================== */
$("#btnModoSim").addEventListener("click", () => {
    modoSimulacion = !modoSimulacion;
    pintarModoSim();
    log(modoSimulacion ? "Simulación activada: no se envía ningún PATCH."
        : "⚠ Simulación desactivada: los cierres y las notas se envían al CM.", modoSimulacion ? "info" : "warn");
});

function pintarModoSim() {
    const b = $("#btnModoSim");
    b.innerHTML = (modoSimulacion ? '<i class="bi bi-shield-check"></i> Simulación: ON'
        : '<i class="bi bi-exclamation-triangle"></i> Simulación: OFF');
    b.className = "btn btn-sm " + (modoSimulacion ? "btn-me-line" : "btn-warning");
    $("#avisoReal").classList.toggle("d-none", modoSimulacion);
}

async function enParalelo(items, n, fn) {
    let i = 0;
    const trabajador = async () => {
        while (true) {
            if (cancelado) return;
            while (pausado && !cancelado) await sleep(200);
            const k = i++;
            if (k >= items.length) return;
            try { await fn(items[k]); } catch (e) { /* cada fn maneja su error */ }
            progreso.hechos++;
            pintarProgreso();
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, trabajador));
}

const progreso = { total: 0, hechos: 0, inicio: 0 };
function pintarProgreso() {
    const p = progreso.total ? Math.round(progreso.hechos * 100 / progreso.total) : 0;
    const barra = $("#barra");
    barra.style.width = p + "%";
    barra.textContent = p + "% (" + progreso.hechos + "/" + progreso.total + ")";
    const transcurrido = (Date.now() - progreso.inicio) / 1000;
    if (progreso.hechos > 0 && progreso.hechos < progreso.total) {
        const resta = Math.round(transcurrido / progreso.hechos * (progreso.total - progreso.hechos));
        $("#chipTiempo").textContent = "Faltan ~" + resta + "s";
    } else {
        $("#chipTiempo").textContent = transcurrido.toFixed(0) + "s";
    }
    actualizarContadores();
}

function iniciarTanda(total) {
    cancelado = false; pausado = false; corriendo = true;
    progreso.total = total; progreso.hechos = 0; progreso.inicio = Date.now();
    $("#btnPausa").disabled = false; $("#btnCancelar").disabled = false;
    $("#btnPausa").textContent = "Pausar";
    actualizarBotones();
    pintarProgreso();
}

function terminarTanda(nombre) {
    corriendo = false;
    $("#btnPausa").disabled = true; $("#btnCancelar").disabled = true;
    refrescarEstadosFiltro();
    if (dataTable) dataTable.rows().invalidate("data").draw(false);
    refrescarResultados();
    actualizarContadores();
    log((cancelado ? "■ " + nombre + " cancelado" : "✔ " + nombre + " terminado") +
        " · " + progreso.hechos + "/" + progreso.total + " en " +
        ((Date.now() - progreso.inicio) / 1000).toFixed(1) + "s", cancelado ? "warn" : "ok");
    MEUI.toast((cancelado ? "Cancelado: " : "Listo: ") + progreso.hechos + " de " + progreso.total,
        cancelado ? "warn" : "ok");
}

$("#btnPausa").addEventListener("click", () => {
    pausado = !pausado;
    $("#btnPausa").textContent = pausado ? "Reanudar" : "Pausar";
    log(pausado ? "Proceso en pausa." : "Proceso reanudado.", "warn");
});
$("#btnCancelar").addEventListener("click", () => {
    cancelado = true; pausado = false;
    log("Cancelando lo que falta…", "warn");
});

/* ---------- Paso 1: buscar el ticket de cada caso ----------

   /case/search puede responder de dos formas y las dos se aceptan:

     A) arreglo plano de tickets  (forma actual del gateway)
        [ { "id":3692641, "number":"9069764", "title":"…", … }, … ]

     B) envoltorio con índice de assets  (forma anterior)
        { "tickets":[3692641],
          "assets": { "Ticket": { "3692641": { … } } } }

   normalizarBusqueda() deja las dos en la misma estructura interna:
     { ids: ["3692641"], assets: { "3692641": {…ticket…} } }
   que es lo que esperan el filtro de número exacto y prepararTicket().
*/
function normalizarBusqueda(datos) {
    const assets = {};
    let ids = [];

    // Forma A · arreglo plano
    if (Array.isArray(datos)) {
        datos.forEach(t => {
            if (!t || t.id === undefined || t.id === null) return;
            const id = String(t.id);
            assets[id] = t;
            ids.push(id);
        });
        return { ids: ids, assets: assets, forma: "arreglo" };
    }

    if (!datos || typeof datos !== "object") return { ids: [], assets: {}, forma: "desconocida" };

    // Forma B · envoltorio { tickets, assets:{ Ticket } }
    const mapa = (datos.assets && datos.assets.Ticket) || {};
    Object.keys(mapa).forEach(k => { assets[String(k)] = mapa[k]; });
    if (Array.isArray(datos.tickets)) ids = datos.tickets.map(String);
    else ids = Object.keys(mapa);

    // Variante: el arreglo viene envuelto en una propiedad ({ tickets:[{…}] },
    // { data:[…] }, { results:[…] }). Si trae objetos en vez de ids, se
    // reutiliza la rama A.
    if (!Object.keys(assets).length) {
        const lista = [datos.tickets, datos.data, datos.results, datos.items]
            .find(v => Array.isArray(v) && v.length && typeof v[0] === "object");
        if (lista) return normalizarBusqueda(lista);
    }

    return { ids: ids, assets: assets, forma: "envoltorio" };
}

async function buscarUno(f, o, extras) {
    f.estadoProceso = "buscando"; f.mensaje = ""; refrescarFila(f);
    try {
        const datos = await apiFetch("/case/search", {
            params: {
                query: '"' + f.numeroCaso + '"',
                page: 1, per_page: o.perPage, sort_by: "title", order_by: "asc",
            }
        });
        f.busquedaRaw = datos;

        const encontrado = normalizarBusqueda(datos);
        const assets = encontrado.assets;
        let ids = encontrado.ids;

        if (o.exacto) {
            const exactos = ids.filter(id => assets[id] &&
                String(assets[id].number || "").trim() === String(f.numeroCaso).trim());
            if (exactos.length) ids = exactos;
            else if (ids.length) {
                f.mensaje = "Ningún ticket con el número exacto (se encontraron " + ids.length + ")";
                ids = [];
            }
        }
        if (!ids.length) {
            f.estadoProceso = "sin ticket";
            f.mensaje = f.mensaje || "La búsqueda no devolvió tickets";
            refrescarFila(f);
            log("✖ Caso " + f.numeroCaso + ": " + f.mensaje +
                (encontrado.forma === "desconocida"
                    ? " · el API respondió con una forma no reconocida (mírala en «Ver»)" : ""), "err");
            return;
        }
        const usados = o.varios ? ids : [ids[0]];
        // El primero se queda en esta fila; los demás se agregan como filas nuevas.
        await prepararTicket(f, usados[0], assets[usados[0]], o);
        for (let i = 1; i < usados.length; i++) {
            const copia = clonarFila(f);
            await prepararTicket(copia, usados[i], assets[usados[i]], o);
            extras.push(copia);
        }
        if (usados.length > 1) log("Caso " + f.numeroCaso + ": " + usados.length + " tickets.", "warn");
    } catch (e) {
        f.estadoProceso = "error";
        f.mensaje = e.message;
        f.http = e.status || "";
        refrescarFila(f);
        log("✖ Búsqueda del caso " + f.numeroCaso + ": " + e.message, "err");
    }
}

function clonarFila(f) {
    const c = Object.assign({}, f);
    c.__id = ++secuencia;
    c.ticketId = ""; c.tituloActual = ""; c.ticketRaw = null; c.assetTicket = null;
    c.estadoCM = ""; c.yaCerrado = false;
    c.historial = null; c.cuerpoPatch = null; c.respuestaPatch = null;
    c.tituloNuevoManual = false;
    return c;
}

async function prepararTicket(f, id, asset, o) {
    f.ticketId = String(id);
    f.assetTicket = asset || null;
    let leyoTicket = false;
    try {
        const t = await apiFetch("/troubleTicket/" + encodeURIComponent(id) + "/");
        f.ticketRaw = t;
        leyoTicket = true;
        f.tituloActual = (t && (t.name || t.title)) || (asset && asset.title) || "";
        f.estadoCM = String((t && (t.status || t.state)) || (asset && (asset.state || asset.status)) || "").trim();
    } catch (e) {
        f.ticketRaw = null;
        f.tituloActual = (asset && asset.title) || "";
        f.estadoCM = String((asset && (asset.state || asset.status)) || "").trim();
        f.mensaje = "No se pudo leer el ticket: " + e.message;
        log("⚠ Ticket " + id + ": " + e.message, "warn");
    }
    if (o.creador) {
        try {
            const h = await apiFetch("/caseManagement/ticket_history/" + encodeURIComponent(id));
            f.historial = h;
            const lista = (h && h.history) || [];
            const creado = lista.find(x => x.type === "created") || lista[0];
            if (creado && creado.created_by_id) {
                const u = await apiFetch("/caseManagement/users/" + creado.created_by_id);
                const usuario = (u && (u.user || u)) || {};
                f.creadoPorCM = [usuario.firstname, usuario.lastname].filter(Boolean).join(" ") +
                    (usuario.email ? " (" + usuario.email + ")" : "");
            }
        } catch (e) {
            log("⚠ Historial del ticket " + id + ": " + e.message, "warn");
        }
    }
    refrescarTitulo(f);

    // Si en el CM ya figura resolved / closed / cancelled, se saca del proceso:
    // queda desmarcado y con el motivo, pero sigue en el informe. Tampoco se le
    // agrega la nota: un ticket cerrado no se vuelve a tocar desde aquí.
    if (esEstadoCerrado(f.estadoCM)) {
        f.yaCerrado = true;
        f.sel = false;
        f.estadoProceso = "ya cerrado";
        f.mensaje = "No se toca: en el CM ya figura como " + f.estadoCM;
        refrescarFila(f);
        log("↷ Caso " + f.numeroCaso + " (ticket " + f.ticketId + ") omitido: ya está " + f.estadoCM + ".", "warn");
        return;
    }

    // Sin GET del ticket no hay estado confiable. Para un cierre es un aviso;
    // para «solo nota» es bloqueante, porque el PATCH tendría que reenviar el
    // mismo estado y no sabemos cuál es.
    if (!leyoTicket && !f.estadoCM) {
        log("⚠ Caso " + f.numeroCaso + " (ticket " + f.ticketId + "): no se pudo confirmar el estado " +
            "actual en el CM. Revísalo antes de enviarlo.", "warn");
    }

    if (f.estadoProceso !== "error") f.estadoProceso = "preparado";
    refrescarFila(f);
}

$("#btnBuscar").addEventListener("click", () => tandaBuscar());

async function tandaBuscar() {
    if (corriendo) return;
    const o = opciones();
    // Solo se trabaja sobre las filas MARCADAS y visibles: ocultar una fila
    // es también una forma de sacarla del proceso.
    const objetivo = filas.filter(f => f.sel && !f.oculta && !f.ticketId &&
        !ESTADOS_HECHOS.includes(f.estadoProceso));
    if (!objetivo.length) { MEUI.toast("No hay casos marcados pendientes de búsqueda.", "warn"); return; }
    log("▶ Buscando " + objetivo.length + " casos con " + o.hilos + " peticiones en paralelo…");
    iniciarTanda(objetivo.length);
    const extras = [];
    await enParalelo(objetivo, o.hilos, (f) => buscarUno(f, o, extras));
    if (extras.length) {
        // Se agregan en el MISMO arreglo (no se reemplaza) para que DataTables
        // y el filtro propio sigan apuntando a la misma fuente de datos.
        extras.forEach(e => filas.push(e));
        filas.forEach((f, i) => f.n = i + 1);
        dataTable.rows.add(extras);
        if (tablaRep) tablaRep.rows.add(extras);
        log("Se agregaron " + extras.length + " filas por casos con varios tickets.", "warn");
    }
    terminarTanda("Búsqueda");
}

/* ---------- Paso 2: PATCH de cierre o de nota ---------- */
function prioridadDesde(asset, ticket) {
    if (ticket && ticket.priority) return ticket.priority;
    const mapa = { 1: "Low", 2: "Normal", 3: "High" };
    return (asset && mapa[asset.priority_id]) || "Normal";
}

function carac(nombre, valor) {
    return {
        "@type": "StringCharacteristic", name: nombre,
        value: String(valor === null || valor === undefined ? "" : valor), valueType: "string"
    };
}

/* ---------------------------------------------------------------------
   ADJUNTOS · el CM valida en el PATCH un «mime-type» que él mismo NO
   guarda: el GET del ticket devuelve los adjuntos sin esa propiedad, así
   que mandar la lista siempre termina en

     422 "Attachment needs 'mime-type' param for attachment with index '0'"

   sin importar cómo se escriba la clave. El propio frontend del CM manda
   el arreglo VACÍO y el PATCH pasa; los adjuntos del ticket quedan como
   estaban, porque la lista vacía significa «no los toques».
--------------------------------------------------------------------- */
function sinAdjuntos(cuerpo) {
    cuerpo.attachment = [];
    return cuerpo;
}

/* Características que el frontend del CM envía siempre, aunque vayan
   vacías. Se agregan solo si el ticket no las trae: si ya tienen valor,
   se respeta el que hay. */
const CARACS_MINIMAS = ["category4", "category5", "complaintAnswer",
    "resolutionType", "resolution", "resolutionDescription"];

function asegurarCaracteristicas(cuerpo) {
    if (!Array.isArray(cuerpo.troubleTicketCharacteristic)) cuerpo.troubleTicketCharacteristic = [];
    const hay = new Set(cuerpo.troubleTicketCharacteristic.map(c => c && c.name));
    CARACS_MINIMAS.forEach(n => { if (!hay.has(n)) cuerpo.troubleTicketCharacteristic.push(carac(n, "")); });
    return cuerpo;
}

function construirPatch(f, o) {
    const t = f.ticketRaw && typeof f.ticketRaw === "object" ? JSON.parse(JSON.stringify(f.ticketRaw)) : null;
    const a = f.assetTicket || {};
    const ahora = new Date().toISOString();
    const nota = {
        "@type": "Note",
        text: f.nota || "",
        noteType: o.noteType,
        noteSubType: o.noteSub,
        date: ahora,
        isNew: true,
    };

    let cuerpo;
    if (t) {
        cuerpo = t;
        cuerpo["@type"] = "TroubleTicket";
        cuerpo.id = String(f.ticketId);
        if (!Array.isArray(cuerpo.troubleTicketCharacteristic)) cuerpo.troubleTicketCharacteristic = [];
        if (!Array.isArray(cuerpo.relatedParty) || !cuerpo.relatedParty.length) {
            cuerpo.relatedParty = [{ "@type": "RelatedPartyRefOrPartyRoleRef", role: a.user_type || "account" }];
        }
    } else {
        // Sin GET del ticket se arma con lo que trajo la búsqueda.
        cuerpo = {
            "@type": "TroubleTicket",
            attachment: [],
            creationDate: a.created_at || ahora,
            description: a.description || "",
            expectedResolutionDate: a.expected_resolution_date || "",
            id: String(f.ticketId),
            lastUpdate: a.updated_at || ahora,
            name: f.tituloActual,
            priority: prioridadDesde(a, null),
            relatedParty: [{ "@type": "RelatedPartyRefOrPartyRoleRef", role: a.user_type || "account" }],
            severity: a.severity || "Normal",
            ticketType: a.ticket_type || "",
            troubleTicketCharacteristic: [
                carac("ticketNumber", a.number || f.numeroCaso),
                carac("groupId", a.group_id),
                carac("ownerId", a.owner_id),
                carac("createdById", a.created_by_id),
                carac("msisdn", a.msisdn || f.msisdn),
                carac("IMSI", a.imsi || f.imsi),
                carac("subscriptionId", a.subscriptionid || f.subscriptionId),
                carac("externalId", a.externalid || ""),
                carac("callerId", a.callerid || ""),
                carac("stateCode", a.state_code || ""),
                carac("category1", a.category1 || ""),
                carac("category2", a.category2 || ""),
                carac("category3", a.category3 || ""),
                carac("category4", a.category4 || ""),
                carac("category5", a.category5 || ""),
                carac("complaintAnswer", a.complaint_answer || ""),
                carac("ticketOrigin", a.ticket_orgin || ""),
            ],
        };
    }

    if (accionDe(f) === "cierre") {
        // Con resultado: título nuevo y estado final.
        cuerpo.name = f.tituloNuevo;
        cuerpo.status = o.estado;
    } else {
        // Solo nota: se reenvía el ticket como está. El título vuelve a ser el
        // que tiene el CM y el estado se conserva; si no se conoce, se quita
        // del cuerpo antes que arriesgarse a moverlo.
        cuerpo.name = (t && (t.name || t.title)) || f.tituloActual || cuerpo.name;
        const actual = f.estadoCM || (t && (t.status || t.state)) || "";
        if (actual) cuerpo.status = actual; else delete cuerpo.status;
    }

    cuerpo.note = [nota];
    if (!cuerpo.priority) cuerpo.priority = prioridadDesde(a, t);
    if (!cuerpo.severity) cuerpo.severity = a.severity || "Normal";

    // Los adjuntos van de últimos: la forma depende de la variante que el
    // gateway haya aceptado hasta ahora. Se anota en la fila para el reintento.
    // Igual que el frontend del CM: la lista de adjuntos va vacía y las
    // características que él siempre manda se completan si faltan.
    sinAdjuntos(cuerpo);
    asegurarCaracteristicas(cuerpo);
    return cuerpo;
}

/* «Solo nota» no toca ni título ni estado: si el texto que se va a mandar
   es exactamente el mismo que ya tiene el ticket, no hay nada que cambiar
   y reenviarlo sería un PATCH inútil. */
function notaYaExiste(f) {
    const notas = (f.ticketRaw && Array.isArray(f.ticketRaw.note)) ? f.ticketRaw.note : [];
    const texto = String(f.nota || "").trim();
    if (!texto) return false;
    return notas.some(n => String((n && n.text) || "").trim() === texto);
}

async function cerrarUno(f, o) {
    if (f.yaCerrado || esEstadoCerrado(f.estadoCM)) {
        f.yaCerrado = true; f.sel = false;
        f.estadoProceso = "ya cerrado";
        f.mensaje = "No se toca: en el CM ya figura como " + (f.estadoCM || "cerrado");
        refrescarFila(f); return;
    }
    if (!f.ticketId) {
        f.estadoProceso = "omitido"; f.mensaje = "Sin ticket: primero hay que buscarlo";
        refrescarFila(f); return;
    }

    const accion = accionDe(f);
    if (!accion) {
        f.estadoProceso = "omitido";
        f.mensaje = "Sin resultado y sin nota: no hay nada que enviar";
        refrescarFila(f); return;
    }
    if (accion === "cierre" && o.exigirNota && !String(f.nota || "").trim()) {
        f.estadoProceso = "omitido"; f.mensaje = "Falta la nota de cierre";
        refrescarFila(f); return;
    }
    // Para agregar solo la nota hay que reenviar el mismo estado: sin estado
    // confiable el PATCH podría moverlo, así que no se envía.
    if (accion === "nota" && !f.estadoCM) {
        f.estadoProceso = "omitido";
        f.mensaje = "No se pudo leer el estado actual del ticket: la nota no se envía";
        refrescarFila(f); return;
    }
    // Nota idéntica a la que ya tiene el ticket y sin cambio de estado:
    // no se envía nada, se deja constancia de que no se modificó.
    if (accion === "nota" && notaYaExiste(f)) {
        f.estadoProceso = "nota sin cambios";
        f.mensaje = "No se modifica: la nota ya existe en el ticket, sin cambios";
        f.procesadoEn = new Date().toLocaleString("es-CO");
        refrescarFila(f);
        log("↷ Ticket " + f.ticketId + " (caso " + f.numeroCaso + "): la nota ya existe, no se modifica.", "warn");
        return;
    }

    f.estadoProceso = (accion === "cierre") ? "cerrando" : "anotando";
    f.mensaje = ""; refrescarFila(f);
    f.cuerpoPatch = construirPatch(f, o);

    if (o.simular) {
        f.estadoProceso = (accion === "cierre") ? "simulado" : "nota simulada";
        f.mensaje = "Simulación: no se envió el PATCH";
        f.procesadoEn = new Date().toLocaleString("es-CO");
        refrescarFila(f);
        return;
    }

    let ultimo = null;
    for (let intento = 0; intento <= o.reintentos; intento++) {
        if (cancelado) { f.estadoProceso = "omitido"; f.mensaje = "Cancelado"; refrescarFila(f); return; }
        try {
            const resp = await apiFetch("/troubleTicket/" + encodeURIComponent(f.ticketId), {
                method: "PATCH",
                headers: { "Content-Type": "text/plain;charset=UTF-8" },
                body: JSON.stringify(f.cuerpoPatch),
            });
            f.respuestaPatch = resp;
            f.http = 200;
            if (accion === "cierre") {
                f.estadoProceso = "cerrado";
                f.tituloActual = f.tituloNuevo;
                f.mensaje = "Cerrado como " + o.estado + " · " + (textoResultado(f) || "sin resultado");
                log("✔ Ticket " + f.ticketId + " (caso " + f.numeroCaso + ") cerrado.", "ok");
            } else {
                f.estadoProceso = "nota agregada";
                f.mensaje = "Nota agregada · sigue en " + f.estadoCM + " y con el mismo título";
                log("✎ Ticket " + f.ticketId + " (caso " + f.numeroCaso + "): nota agregada sin cerrar.", "ok");
            }
            f.procesadoEn = new Date().toLocaleString("es-CO");
            refrescarFila(f);
            return;
        } catch (e) {
            ultimo = e;
            if (intento < o.reintentos) {
                log("⚠ Ticket " + f.ticketId + ": " + e.message + " — reintentando…", "warn");
                await sleep(600 * (intento + 1));
            }
        }
    }
    f.estadoProceso = "error";
    f.http = (ultimo && ultimo.status) || "";
    f.mensaje = ultimo ? ultimo.message : "Error desconocido";
    f.procesadoEn = new Date().toLocaleString("es-CO");
    refrescarFila(f);
    log("✖ Ticket " + f.ticketId + " (caso " + f.numeroCaso + "): " + f.mensaje, "err");
}

$("#btnCerrar").addEventListener("click", () => tandaCerrar());

async function tandaCerrar() {
    if (corriendo) return;
    const o = opciones();
    // Se envían ÚNICAMENTE los casos marcados y visibles que tengan algo que
    // hacer: cerrar (con resultado) o agregar la nota (sin resultado).
    const objetivo = filas.filter(f => f.sel && !f.oculta && f.ticketId && !f.yaCerrado &&
        !ESTADOS_HECHOS.includes(f.estadoProceso) && f.estadoProceso !== "nota sin cambios" && accionDe(f));
    if (!objetivo.length) {
        MEUI.toast("No hay casos marcados con ticket listo para enviar.", "warn");
        log("Marca las filas que quieras trabajar y, si hace falta, corre primero «Buscar tickets». " +
            "Una fila sin resultado y sin nota no tiene nada que enviar.", "warn");
        return;
    }
    const cierres = objetivo.filter(f => accionDe(f) === "cierre").length;
    const notas = objetivo.length - cierres;
    if (!o.simular) {
        const ok = confirm("Se van a cerrar " + cierres + " ticket(s) en el CM como «" + o.estado + "»" +
            (notas ? " y agregar la nota a " + notas + " ticket(s) sin cambiarles el título ni el estado" : "") +
            ".\n\nEsta acción no se deshace desde aquí.\n\n¿Continuar?");
        if (!ok) return;
    }
    log("▶ " + (o.simular ? "Simulando" : "Enviando") + ": " + cierres + " cierre(s) y " +
        notas + " nota(s) sin cierre…");
    iniciarTanda(objetivo.length);
    await enParalelo(objetivo, o.hilos, (f) => cerrarUno(f, o));
    terminarTanda(o.simular ? "Simulación" : "Envío");
}

$("#btnReintentar").addEventListener("click", async () => {
    const fallidos = filas.filter(f => !f.yaCerrado &&
        (f.estadoProceso === "error" || f.estadoProceso === "sin ticket" || f.estadoProceso === "omitido"));
    if (!fallidos.length) { MEUI.toast("No hay casos con error para reintentar.", "warn"); return; }
    fallidos.forEach(f => { f.sel = true; f.oculta = false; if (!f.ticketId) f.estadoProceso = "pendiente"; });
    redibujar(true);
    // Solo se vuelve a BUSCAR. El cierre se lanza aparte, después de revisar:
    // encadenarlo aquí sería un cierre automático sin revisión previa.
    await tandaBuscar();
    if (!cancelado) log("Revisa los casos recuperados y usa «Cerrar casos» cuando estén listos.", "warn");
});

/* =====================================================================
   EXPORTACIÓN
   El separador y el formato los pone me-ui.js: mismo criterio que en las
   otras herramientas.
===================================================================== */
const COLS_RESULTADO = [
    ["Nº caso", f => f.numeroCaso],
    ["Ticket", f => f.ticketId],
    ["Acción", f => ETIQUETA_ACCION[accionDe(f)] || "sin acción"],
    ["Título anterior", f => f.tituloActual],
    ["Título nuevo", f => (f.resultado ? f.tituloNuevo : "(sin cambio)")],
    ["Resultado", f => f.resultado],
    ["Favorable (archivo)", f => f.favorableCrudo],
    ["Nota enviada", f => f.nota],
    ["Estado del proceso", f => f.estadoProceso],
    ["Estado en el CM", f => f.estadoCM],
    ["Se cerró", f => (f.estadoProceso === "cerrado" ? "Si" : "No")],
    ["Nota agregada", f => (ESTADOS_HECHOS.includes(f.estadoProceso) ? "Si" : "No")],
    ["HTTP", f => f.http],
    ["Mensaje", f => f.mensaje],
    ["Creado por (CM)", f => f.creadoPorCM],
    ["Procesado", f => f.procesadoEn],
];

function filasParaExportar() {
    const alcance = $("#expAlcance").value;
    if (alcance === "todas") return filas;
    if (alcance === "marcadas") return filas.filter(f => f.sel);
    if (alcance === "cerradas") return filas.filter(f => f.estadoProceso === "cerrado");
    if (alcance === "notas") return filas.filter(f => f.estadoProceso === "nota agregada" ||
        f.estadoProceso === "nota simulada");
    if (alcance === "yacerradas") return filas.filter(f => f.yaCerrado);
    if (alcance === "error") return filas.filter(f => f.estadoProceso === "error" ||
        f.estadoProceso === "sin ticket" || f.estadoProceso === "omitido");
    if (alcance === "filtradas") return filasVisibles();
    // Por defecto: exactamente lo que muestra la tabla del informe.
    if (!tablaRep) return filas;
    return tablaRep.rows({ search: "applied" }).indexes().toArray().map(i => filas[i]);
}

function matrizExportacion() {
    const incluirOriginal = $("#expOriginal").checked && encabezados.length;
    const cabecera = COLS_RESULTADO.map(c => c[0])
        .concat(incluirOriginal ? encabezados.map(h => "Archivo · " + h) : []);
    const cuerpo = filasParaExportar().map(f => {
        const base = COLS_RESULTADO.map(c => c[1](f));
        return incluirOriginal ? base.concat(encabezados.map((_, i) => (f.original && f.original[i]) || "")) : base;
    });
    return { cabecera: cabecera, cuerpo: cuerpo };
}

$("#btnExportXlsx").addEventListener("click", () => {
    const m = matrizExportacion();
    if (!m.cuerpo.length) { MEUI.toast("No hay filas para exportar con ese alcance.", "warn"); return; }
    MEUI.exportarXLSX(m.cabecera, m.cuerpo, "cierre_casos", "Cierre masivo");
});

$("#btnExportCsv").addEventListener("click", () => {
    const m = matrizExportacion();
    if (!m.cuerpo.length) { MEUI.toast("No hay filas para exportar con ese alcance.", "warn"); return; }
    MEUI.exportarCSV(m.cabecera, m.cuerpo, "cierre_casos");
});

$("#btnExportJson").addEventListener("click", () => {
    const datos = filasParaExportar().map(f => ({
        numeroCaso: f.numeroCaso, ticketId: f.ticketId, accion: accionDe(f) || "ninguna",
        tituloAnterior: f.tituloActual,
        tituloNuevo: f.resultado ? f.tituloNuevo : null,
        resultado: f.resultado, favorableArchivo: f.favorableCrudo, nota: f.nota,
        estadoProceso: f.estadoProceso, estadoCM: f.estadoCM, yaCerrado: f.yaCerrado,
        http: f.http, mensaje: f.mensaje,
        procesadoEn: f.procesadoEn, cuerpoPatch: f.cuerpoPatch, respuestaPatch: f.respuestaPatch,
    }));
    if (!datos.length) { MEUI.toast("No hay filas para exportar con ese alcance.", "warn"); return; }
    MEUI.exportarJSON(datos, "cierre_casos");
});

/* =====================================================================
   ARRANQUE
===================================================================== */
/* Preferencias de las reglas de cierre (nada sensible). Los endpoints del
   CM viven en me-api.js: son fijos y no se editan desde la página. */
const PREFS = ["cfgEstado", "cfgSep", "cfgTxtFav", "cfgTxtDesf", "cfgNoteType", "cfgNoteSub",
    "cfgHilos", "cfgReintentos", "cfgPerPage"];

function guardarPrefs() {
    try { PREFS.forEach(id => localStorage.setItem("ccm_" + id, $("#" + id).value)); } catch (e) { }
}

(function inicio() {
    try {
        PREFS.forEach(id => {
            const v = localStorage.getItem("ccm_" + id);
            if (v !== null && v !== "") $("#" + id).value = v;
        });
    } catch (e) { }
    PREFS.forEach(id => $("#" + id).addEventListener("change", guardarPrefs));

    // Cambiar separador, textos o el interruptor del sufijo vuelve a armar los
    // títulos que NO se hayan editado a mano en la tabla.
    ["cfgSep", "cfgTxtFav", "cfgTxtDesf", "cfgAgregarResultado"].forEach(id =>
        $("#" + id).addEventListener("change", recalcularTitulos));

    pintarModoSim();
    actualizarBotones();
    log("La simulación está encendida: revisa los cuerpos del PATCH antes de apagarla.", "warn");
    log("Regla del archivo: «Sí» cierra como favorable, «No» como desfavorable y la casilla vacía "
        + "solo agrega la nota, sin cambiar el título ni el estado.", "info");
    construirTabla();
})();