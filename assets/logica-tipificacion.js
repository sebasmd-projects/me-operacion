/* =====================================================================
   logica-tipificacion.js · Exportador de casos del CRM
   ---------------------------------------------------------------------
   Solo lo propio de ESTA herramienta: armado de la consulta, división del
   rango de fechas cuando choca con el límite de Elasticsearch, paginación
   y enriquecimiento de los tickets con los "assets" de la respuesta.

   Lo compartido NO está aquí:
     · marco visual, tablas, registro, exportación → me-ui.js
     · Keycloak, auth y GET autenticado            → me-api.js
     · enganche con el shell                       → me-tipificacion-puente.js
===================================================================== */
"use strict";

/* Este API responde en inglés (nombres de estado y prioridad). */
MEAPI.configurar({ locale: "en" });

const auth = MEAPI.auth;
const getJson = MEAPI.getJson;   // acepta ruta relativa: antepone el apiBase

const $ = (id) => document.getElementById(id);

const LIMITE_ES = 10000;  // ventana máxima de Elasticsearch (page * per_page)
const MAX_DIAS = 31;      // rango de fechas máximo permitido

/* Columnas que van primero en la salida; el resto se agrega detrás. */
const COLS_FRONT = [
    "number", "title", "state", "priority", "group", "owner", "owner_email",
    "customer", "customer_email", "organization",
    "created_at", "updated_at", "close_at",
    "category1", "category2", "category3", "category4", "category5",
    "msisdn", "imsi", "callerid", "externalid", "subscriptionid",
    "ticket_type", "ticket_orgin", "severity", "description",
    "created_by", "updated_by", "id",
];

let cancelado = false;
let ultimoExport = null;        // { registros, filas, cols, base }
let totalAcumulado = 0;         // casos descargados hasta ahora
let totalEstimado = 0;          // suma de counts conocidos (solo para la barra)
let estadosTS = null;
let tablaResultados = null, tablaPreview = null;

const log = (msg, cls) => MEUI.log(msg, cls === "err" ? "err" : cls === "warn" ? "warn" : cls === "ok" ? "ok" : "info");

/* =====================================================================
   PROGRESO
===================================================================== */
function actualizarProgreso() {
    $("badgeCount").textContent = totalAcumulado;
    if (totalEstimado > 0) {
        const pct = Math.min(100, Math.round(totalAcumulado / totalEstimado * 100));
        $("pbar").style.width = pct + "%";
        $("pbar").textContent = pct + "%";
    }
}

function setBusy(b) {
    $("btnPreview").disabled = b;
    $("btnCancel").classList.toggle("d-none", !b);
    if (b) MEUI.ocupado($("btnRun"), "Descargando…");
    else { MEUI.libre($("btnRun")); $("pbar").style.width = "0%"; $("pbar").textContent = ""; }
}

/* =====================================================================
   FECHAS
===================================================================== */
function diasEntre(a, b) {          // días de diferencia entre fechas ISO
    return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}
function sumarDias(fecha, n) {
    const d = new Date(fecha + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
const hoyISO = () => new Date().toISOString().slice(0, 10);

/* =====================================================================
   CONSULTA
===================================================================== */
function buildQuery(stateIds, dateFrom, dateTo) {
    const estados = stateIds.map(s => `"${s}"`).join(" OR ");
    let q = `state_id:(${estados})`;
    if (dateFrom && dateTo) q += ` AND created_at:["${dateFrom}" TO "${dateTo}"]`;
    return q;
}

function searchPage(query, page, perPage, sortBy, orderBy) {
    return getJson("/api/v1/case/search", {
        query, page, per_page: perPage, sort_by: sortBy, order_by: orderBy,
    });
}

/* Cuenta los casos con una petición mínima (per_page=1). OJO: este número
   se usa SOLO para estimar el progreso y pre-dividir rangos. La descarga
   real nunca depende de él. */
async function contarCasos(query, sortBy, orderBy) {
    const payload = await searchPage(query, 1, 1, sortBy, orderBy);
    const n = payload && payload.tickets_count;
    if (typeof n === "number") return n;
    const num = Number(n);
    return Number.isFinite(num) && String(n).trim() !== "" ? num : null;
}

function pageIds(payload) {
    if (payload && Array.isArray(payload.tickets)) return payload.tickets;
    if (Array.isArray(payload)) return payload;
    return [];
}

function mergeAssets(store, payload) {
    const assets = payload && payload.assets;
    if (!assets || typeof assets !== "object") return;
    for (const [tipo, mapa] of Object.entries(assets)) {
        if (mapa && typeof mapa === "object") {
            store[tipo] = Object.assign(store[tipo] || {}, mapa);
        }
    }
}

function nombreUser(u) {
    if (!u || typeof u !== "object") return null;
    const nom = `${(u.firstname || "").trim()} ${(u.lastname || "").trim()}`.trim();
    return nom || u.login || u.email || null;
}

/* Cambia los *_id por sus nombres, usando los "assets" que vienen en la
   misma respuesta: así no hace falta una consulta por usuario o grupo. */
function enrich(ticket, store) {
    const users = store.User || {}, groups = store.Group || {},
        orgs = store.Organization || {}, states = store.TicketState || {},
        prios = store.TicketPriority || {};
    const uname = id => nombreUser(users[String(id)]);
    const uemail = id => { const u = users[String(id)]; return u ? u.email : null; };

    const t = { ...ticket };
    t.owner = uname(t.owner_id); t.owner_email = uemail(t.owner_id);
    t.customer = uname(t.customer_id); t.customer_email = uemail(t.customer_id);
    t.created_by = uname(t.created_by_id); t.updated_by = uname(t.updated_by_id);
    const g = groups[String(t.group_id)]; t.group = g ? g.name : null;
    const o = orgs[String(t.organization_id)]; t.organization = o ? o.name : null;
    const s = states[String(t.state_id)]; t.state = s ? s.name : t.state_id;
    const pr = prios[String(t.priority_id)]; t.priority = pr ? pr.name : t.priority_id;
    return t;
}

/* =====================================================================
   MOTOR DE DESCARGA

   Pide páginas en lotes paralelos y SIGUE pidiendo hasta que el API
   devuelva una página corta o vacía. No confía en tickets_count para
   decidir cuántas páginas existen; ese número solo alimenta la barra de
   progreso y la pre-división de rangos.

   Devuelve { ids, truncado }: truncado = true cuando se alcanzó la ventana
   de Elasticsearch (page * per_page >= 10.000) y la última página seguía
   llena, es decir, quedaron datos inaccesibles en esa consulta.
===================================================================== */
const maxPagES = perPage => Math.max(1, Math.floor(LIMITE_ES / perPage));

async function descargarPaginas(query, cfg, store, startPage, endPage, etiqueta = "") {
    const tope = Math.min(endPage || Infinity, maxPagES(cfg.perPage));
    const ids = [];
    let page = startPage;
    let paginaCorta = false;

    while (!paginaCorta && page <= tope) {
        if (cancelado) throw new Error("Cancelado por el usuario.");

        // Lote de hasta "concurrencia" páginas en paralelo
        const fin = Math.min(page + cfg.concurrencia - 1, tope);
        const lote = [];
        for (let p = page; p <= fin; p++) lote.push(p);

        const resultados = new Map();
        let errorLote = null;
        await Promise.all(lote.map(async p => {
            try {
                const payload = await searchPage(query, p, cfg.perPage, cfg.sortBy, cfg.orderBy);
                resultados.set(p, pageIds(payload));
                mergeAssets(store, payload);
            } catch (e) { errorLote = errorLote || e; }
        }));
        if (errorLote) throw errorLote;

        // Reensamblar en orden de página
        for (const p of lote) {
            const pids = resultados.get(p) || [];
            ids.push(...pids);
            totalAcumulado += pids.length;
            log(`  ${etiqueta}página ${p}  (+${pids.length})  →  ${totalAcumulado} acumulados`);
            if (pids.length < cfg.perPage) paginaCorta = true;   // fin de los datos
        }
        if (totalEstimado && totalAcumulado > totalEstimado) totalEstimado = totalAcumulado;
        actualizarProgreso();
        page = fin + 1;
    }

    const truncado = !paginaCorta && page > maxPagES(cfg.perPage);
    return { ids, truncado };
}

/* Modo "todas las páginas": recorre el rango de fechas y lo divide en
   sub-rangos cuando choca con la ventana de 10.000. */
async function descargarRangoFechas(cfg, store) {
    const ids = [];

    async function dividir(from, to) {
        const mitad = sumarDias(from, Math.floor(diasEntre(from, to) / 2));
        log(`  ${from}..${to}: supera el límite de ${LIMITE_ES}; ` +
            `dividiendo en ${from}..${mitad} y ${sumarDias(mitad, 1)}..${to}`, "warn");
        await procesar(from, mitad);
        await procesar(sumarDias(mitad, 1), to);
    }

    async function procesar(from, to) {
        if (cancelado) throw new Error("Cancelado por el usuario.");
        const q = buildQuery(cfg.estados, from, to);

        // Conteo previo: solo estimación + pre-división (si es confiable)
        const count = await contarCasos(q, cfg.sortBy, cfg.orderBy);

        if (count !== null && count >= LIMITE_ES && from !== to) {
            await dividir(from, to);
            return;
        }
        if (count !== null) {
            log(`  ${from}..${to}: ${count} caso(s) en el API (descargando hasta agotar las páginas)`);
            totalEstimado += Math.min(count, LIMITE_ES);
            actualizarProgreso();
        } else {
            log(`  ${from}..${to}: el API no informa tickets_count; ` +
                `se descargará hasta que llegue una página vacía`, "warn");
        }

        const r = await descargarPaginas(q, cfg, store, 1, null, `[${from}..${to}] `);

        // Si el conteo mintió y chocamos con la ventana de ES aún con datos por traer
        if (r.truncado && from !== to) {
            log(`  ${from}..${to}: se alcanzó la ventana de ${LIMITE_ES} y aún había datos`, "warn");
            totalAcumulado -= r.ids.length;
            totalEstimado = Math.max(0, totalEstimado - r.ids.length);
            actualizarProgreso();
            await dividir(from, to);
            return;
        }
        if (r.truncado) {
            log(`  ${from}: más de ${LIMITE_ES} casos en un solo día; ` +
                `solo se pueden traer los primeros ${LIMITE_ES}`, "warn");
        }
        if (count !== null && r.ids.length > count) {
            log(`  (aviso: el API reportaba ${count} casos pero llegaron ${r.ids.length})`, "warn");
        }
        ids.push(...r.ids);
    }

    await procesar(cfg.dateFrom, cfg.dateTo);
    return ids;
}

/* Modos "una página" y "rango de páginas" sobre la consulta completa
   (sin división de fechas). */
async function descargarPaginasEspecificas(cfg, store) {
    const q = buildQuery(cfg.estados, cfg.dateFrom, cfg.dateTo);
    const mp = maxPagES(cfg.perPage);

    const count = await contarCasos(q, cfg.sortBy, cfg.orderBy);
    if (count !== null) {
        const efectivo = Math.min(count, LIMITE_ES);
        const totalPag = Math.ceil(efectivo / cfg.perPage) || 0;
        log(`  Consulta completa: el API reporta ${count} casos (~${totalPag} páginas)`);
        if (count > LIMITE_ES) {
            log(`  (ojo: por el límite de ${LIMITE_ES} solo son accesibles las primeras ${mp} ` +
                `páginas; para todo el rango usa «Todas las páginas», que divide por fechas)`, "warn");
        }
        const fin = Math.min(cfg.endPage || Math.max(totalPag, cfg.startPage), mp);
        totalEstimado += Math.max(0, Math.min(
            (fin - cfg.startPage + 1) * cfg.perPage,
            efectivo - (cfg.startPage - 1) * cfg.perPage));
        actualizarProgreso();
    }
    if (cfg.startPage > mp) {
        log(`  La página ${cfg.startPage} no es accesible (máximo ${mp} por la ventana de ${LIMITE_ES}).`, "warn");
        return [];
    }

    const r = await descargarPaginas(q, cfg, store, cfg.startPage, cfg.endPage, "");
    if (r.truncado) {
        log(`  Se alcanzó la ventana de ${LIMITE_ES}; para traer todo el rango usa «Todas las páginas».`, "warn");
    }
    return r.ids;
}

/* =====================================================================
   SALIDA
===================================================================== */
function flatten(obj, prefix = "", out = {}) {
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) flatten(v, `${prefix}${k}.`, out);
    } else if (Array.isArray(obj)) {
        out[prefix.slice(0, -1)] = JSON.stringify(obj);
    } else {
        out[prefix.slice(0, -1)] = obj;
    }
    return out;
}

function columnas(filas) {
    const vistos = new Set(), presentes = [];
    for (const fila of filas)
        for (const c of Object.keys(fila))
            if (!vistos.has(c)) { vistos.add(c); presentes.push(c); }
    const front = COLS_FRONT.filter(c => vistos.has(c));
    const resto = presentes.filter(c => !front.includes(c));
    return [...front, ...resto];
}

function sinDatos() {
    if (!ultimoExport || !ultimoExport.filas.length) {
        MEUI.toast("Todavía no hay casos descargados.", "warn");
        return true;
    }
    return false;
}

$("dlCsv").addEventListener("click", () => {
    if (sinDatos()) return;
    const { filas, cols, base } = ultimoExport;
    MEUI.exportarCSV(cols, filas.map(f => cols.map(c => f[c] ?? "")), base);
});
$("dlXlsx").addEventListener("click", () => {
    if (sinDatos()) return;
    const { filas, cols, base } = ultimoExport;
    MEUI.exportarXLSX(cols, filas.map(f => cols.map(c => f[c] ?? "")), base, "casos");
});
$("dlJson").addEventListener("click", () => {
    if (sinDatos()) return;
    MEUI.exportarJSON(ultimoExport.registros, ultimoExport.base);
});

/* =====================================================================
   VALIDACIÓN DEL FORMULARIO
   Cada error abre el paso donde está el campo y hace foco en él: así no
   hay que adivinar qué falta.
===================================================================== */
function limpiarValidacion() {
    document.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
    document.querySelectorAll(".ts-invalid").forEach(el => el.classList.remove("ts-invalid"));
}

function marcarInvalido(el, msg, paso, invalids) {
    el.classList.add("is-invalid");
    const fb = el.parentElement && el.parentElement.querySelector(".invalid-feedback");
    if (fb && msg) fb.textContent = msg;
    invalids.push({ el, paso });
}

function mostrarPrimerError(invalids) {
    if (!invalids.length) return;
    const { el, paso } = invalids[0];
    MEUI.abrirPaso(paso, true);
    setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        try { el.focus({ preventScroll: true }); } catch (e) { }
    }, 250);
}

function validarYLeer() {
    limpiarValidacion();
    const invalids = [];

    // ---- Autenticación: token O usuario+clave ----
    auth.username = $("username").value.trim() || null;
    auth.password = $("password").value || null;
    const tokenManual = $("token").value.trim();
    if (tokenManual) {
        // Token pegado a mano: sirve cuando Keycloak no permite direct grant.
        auth.token = tokenManual;
        auth.refreshToken = $("refreshToken").value.trim() || null;
        auth.expiresAt = null;
        MEUI.sesion.set("cm", { usuario: "token manual" });
    }
    if (!auth.token && !(auth.username && auth.password)) {
        const enPestanaToken = document.querySelector("#authTabs .nav-link.active")
            ?.dataset.bsTarget === "#tabToken";
        if (enPestanaToken) marcarInvalido($("token"), null, 1, invalids);
        else {
            if (!auth.username) marcarInvalido($("username"), null, 1, invalids);
            if (!auth.password) marcarInvalido($("password"), null, 1, invalids);
        }
    }

    // ---- Fechas: obligatorias, en orden y de máximo MAX_DIAS ----
    let dateFrom = null, dateTo = null;
    if ($("hoy").checked) {
        dateFrom = dateTo = hoyISO();
    } else {
        dateFrom = $("desde").value || null;
        dateTo = $("hasta").value || null;
        if (!dateFrom) marcarInvalido($("desde"), "Indica la fecha inicial (o marca «Solo lo de hoy»).", 2, invalids);
        if (!dateTo) marcarInvalido($("hasta"), "Indica la fecha final (o marca «Solo lo de hoy»).", 2, invalids);
        if (dateFrom && dateTo) {
            if (dateTo < dateFrom) {
                marcarInvalido($("hasta"), "«Hasta» debe ser igual o posterior a «Desde».", 2, invalids);
            } else if (diasEntre(dateFrom, dateTo) + 1 > MAX_DIAS) {
                marcarInvalido($("hasta"),
                    `El rango máximo es de ${MAX_DIAS} días; divide la consulta en varios meses.`, 2, invalids);
            }
        }
    }

    // ---- Estados ----
    const estados = (estadosTS ? estadosTS.getValue() : []).map(s => String(s).trim()).filter(Boolean);
    const invalidosNum = estados.filter(s => !/^\d+$/.test(s));
    if (!estados.length || invalidosNum.length) {
        estadosTS.wrapper.classList.add("ts-invalid");
        $("fbEstados").textContent = !estados.length
            ? "Indica al menos un state_id."
            : `Solo se aceptan números de estado (revisa: ${invalidosNum.join(", ")}).`;
        invalids.push({ el: estadosTS.control_input, paso: 2 });
    }

    // ---- Paginación ----
    const perPage = parseInt($("perPage").value, 10);
    if (!perPage || perPage < 1 || perPage > 100) marcarInvalido($("perPage"), null, 2, invalids);
    const concurrencia = parseInt($("concurrencia").value, 10);
    if (!concurrencia || concurrencia < 1 || concurrencia > 10) marcarInvalido($("concurrencia"), null, 2, invalids);

    // ---- Modo de páginas ----
    const mode = document.querySelector('input[name="pageMode"]:checked').value;
    let startPage = 1, endPage = null;
    if (mode === "one") {
        const p = parseInt($("pageOne").value, 10);
        if (!p || p < 1) marcarInvalido($("pageOne"), null, 3, invalids);
        else startPage = endPage = p;
    } else if (mode === "range") {
        const f = parseInt($("pageFrom").value, 10) || 1;
        const t = parseInt($("pageTo").value, 10) || null;
        if (f < 1) marcarInvalido($("pageFrom"), null, 3, invalids);
        if (t && t < f) marcarInvalido($("pageTo"), null, 3, invalids);
        startPage = f; endPage = t;
    }

    if (invalids.length) {
        mostrarPrimerError(invalids);
        log("Revisa los campos marcados en rojo antes de continuar.", "err");
        return null;
    }

    return {
        estados, dateFrom, dateTo,
        perPage: perPage || 100,
        concurrencia: concurrencia || 1,
        sortBy: $("sortBy").value.trim() || "title",
        orderBy: $("orderBy").value,
        startPage, endPage, mode
    };
}

// Quitar la marca de error apenas el usuario corrige el campo
document.addEventListener("input", e => {
    if (e.target.classList && e.target.classList.contains("is-invalid"))
        e.target.classList.remove("is-invalid");
});

/* =====================================================================
   RESÚMENES EN LOS PASOS
===================================================================== */
function actualizarResumenes() {
    const user = $("username").value.trim();
    const tok = $("token").value.trim();
    MEUI.resumenPaso(1, tok ? "token manual" : (user || ""));

    let fechas = "";
    if ($("hoy").checked) fechas = "hoy";
    else if ($("desde").value && $("hasta").value) fechas = `${$("desde").value} → ${$("hasta").value}`;
    const nEst = estadosTS ? estadosTS.getValue().length : 0;
    MEUI.resumenPaso(2, [fechas, nEst ? `${nEst} estado(s)` : ""].filter(Boolean).join(" · "));

    const mode = document.querySelector('input[name="pageMode"]:checked').value;
    MEUI.resumenPaso(3, mode === "all" ? "todas"
        : mode === "one" ? `página ${$("pageOne").value || "?"}`
            : `${$("pageFrom").value || 1} → ${$("pageTo").value || "fin"}`);
}
["username", "token", "desde", "hasta", "pageOne", "pageFrom", "pageTo"]
    .forEach(id => $(id).addEventListener("input", actualizarResumenes));

/* =====================================================================
   TABLAS
===================================================================== */
function renderTabla(cual, filas) {
    const sel = cual === "preview" ? "#previewTable" : "#resultsTable";
    let dt = cual === "preview" ? tablaPreview : tablaResultados;
    if (dt) { dt.destroy(); dt = null; }
    const tabla = document.querySelector(sel);
    tabla.innerHTML = "";
    MEUI.prepararTabla(sel);

    if (filas.length) {
        const columns = Object.keys(filas[0]).map(c => ({ title: c, data: c, defaultContent: "" }));
        dt = MEUI.tabla(sel, {
            data: filas, columns,
            pageLength: cual === "preview" ? 25 : 15,
            language: Object.assign({}, MEUI.idiomaTabla, {
                lengthMenu: "Mostrar _MENU_ filas",
                info: "Mostrando _START_–_END_ de _TOTAL_ filas",
                infoEmpty: "Sin filas"
            })
        });
    }
    if (cual === "preview") tablaPreview = dt; else tablaResultados = dt;
    MEUI.mostrarSiHayDatos(sel, { vacio: cual === "preview" ? "#previewVacio" : "#resultsVacio", tabla: dt });
    return dt;
}

/* =====================================================================
   ACCIONES
===================================================================== */
$("btnCancel").addEventListener("click", () => { cancelado = true; log("Cancelando…", "warn"); });

$("btnPreview").addEventListener("click", async () => {
    cancelado = false;
    const cfg = validarYLeer();
    if (!cfg) return;
    await MEUI.conSpinner($("btnPreview"), "Consultando…", async () => {
        try {
            setBusy(true);
            const q = buildQuery(cfg.estados, cfg.dateFrom, cfg.dateTo);
            log("Query: " + q);
            const payload = await searchPage(q, cfg.startPage, cfg.perPage, cfg.sortBy, cfg.orderBy);
            const ids = pageIds(payload);
            const store = {}; mergeAssets(store, payload);
            if (typeof payload.tickets_count === "number")
                log(`Total de casos reportado por el API: ${payload.tickets_count}`, "ok");
            log(`Ids en la página ${cfg.startPage}: ${ids.length}`, "ok");
            log(`Assets disponibles: ${Object.keys(store).join(", ") || "ninguno"}`);

            const filas = ids.length
                ? Object.entries(enrich((store.Ticket || {})[String(ids[0])] || { id: ids[0] }, store))
                    .map(([campo, valor]) => ({
                        Campo: campo,
                        Valor: valor !== null && typeof valor === "object" ? JSON.stringify(valor) : valor
                    }))
                : [];
            renderTabla("preview", filas);
            const tab = document.querySelector('[data-bs-target="#panePreview"]');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
        } catch (e) { log(String(e.message || e), "err"); }
        finally { setBusy(false); }
    });
});

$("btnRun").addEventListener("click", async () => {
    cancelado = false;
    totalAcumulado = 0; totalEstimado = 0;
    $("badgeCount").textContent = "0";
    $("pbar").style.width = "0%";
    $("chipTiempo").textContent = "—";
    const cfg = validarYLeer();
    if (!cfg) return;
    try {
        setBusy(true);
        log("Rango de fechas: " + cfg.dateFrom + " → " + cfg.dateTo);
        log("Estados: " + cfg.estados.join(", ") +
            " | por página: " + cfg.perPage + " | paralelo: x" + cfg.concurrencia);
        log("Páginas: " + (cfg.mode === "all" ? "todas" : cfg.startPage + " → " + (cfg.endPage || "fin")));

        const store = {};
        const t0 = performance.now();
        const ids = (cfg.mode === "all")
            ? await descargarRangoFechas(cfg, store)
            : await descargarPaginasEspecificas(cfg, store);

        // Registros completos, en orden, sin duplicados y enriquecidos
        const ticketsMap = store.Ticket || {};
        const registros = [];
        const vistos = new Set();
        let faltantes = 0, duplicados = 0;
        for (const tid of ids) {
            const key = String(tid);
            if (vistos.has(key)) { duplicados++; continue; }
            vistos.add(key);
            const t = ticketsMap[key];
            if (!t) { faltantes++; registros.push({ id: tid, _sin_detalle_en_assets: true }); }
            else registros.push(enrich(t, store));
        }
        if (faltantes) log(`  (aviso: ${faltantes} ids no traían detalle en assets)`, "warn");
        if (duplicados) log(`  (se descartaron ${duplicados} ids duplicados entre páginas)`, "warn");

        const seg = ((performance.now() - t0) / 1000).toFixed(1);
        log(`Listo: ${registros.length} casos en ${seg}s`, "ok");
        $("pbar").style.width = "100%";
        $("chipTiempo").textContent = seg + " s";

        let base = `casos_export_${cfg.dateFrom}_a_${cfg.dateTo}`;
        if (cfg.mode === "one") base += `_pag${cfg.startPage}`;
        else if (cfg.mode === "range") base += `_pag${cfg.startPage}-${cfg.endPage || "fin"}`;

        const filas = registros.map(r => flatten(r));
        const cols = columnas(filas);
        ultimoExport = { registros, filas, cols, base };

        renderTabla("resultados", filas);
        $("badgeCount").textContent = registros.length;
        $("colsCount").textContent = cols.length;
        $("resultsInfo").textContent = `${registros.length} casos · ${cols.length} columnas`;
        const tab = document.querySelector('[data-bs-target="#paneResultados"]');
        if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
        log("Usa CSV / Excel / JSON para guardar los archivos.", "ok");
        MEUI.toast(registros.length + " casos descargados.", "ok");
    } catch (e) {
        log(String(e.message || e), "err");
        MEUI.toast("La descarga falló. Mira el registro.", "err");
    }
    finally { setBusy(false); }
});

/* =====================================================================
   ARRANQUE DE LOS CONTROLES
===================================================================== */
document.querySelectorAll('input[name="pageMode"]').forEach(r => {
    r.addEventListener("change", () => {
        const mode = document.querySelector('input[name="pageMode"]:checked').value;
        $("pageOne").disabled = mode !== "one";
        $("pageFrom").disabled = mode !== "range";
        $("pageTo").disabled = mode !== "range";
        actualizarResumenes();
    });
});
$("hoy").addEventListener("change", e => {
    $("desde").disabled = e.target.checked;
    $("hasta").disabled = e.target.checked;
    actualizarResumenes();
});

// "Ordenar por": selector con buscador
COLS_FRONT.forEach(col => {
    const option = document.createElement("option");
    option.value = col; option.textContent = col;
    if (col === "title") option.selected = true;
    $("sortBy").appendChild(option);
});
new TomSelect("#sortBy", {
    create: false, maxItems: 1, searchField: ["text", "value"], placeholder: "Buscar campo…"
});

// Estados: etiquetas editables con los valores por defecto 13, 10, 12
estadosTS = new TomSelect("#estados", {
    create: v => /^\d+$/.test(v.trim()) ? { value: v.trim(), text: v.trim() } : false,
    persist: false,
    createOnBlur: true,
    options: ["13", "10", "12"].map(v => ({ value: v, text: v })),
    items: ["13", "10", "12"],
    placeholder: "Ej: 13",
    plugins: ["remove_button"],
    onChange: () => { estadosTS.wrapper.classList.remove("ts-invalid"); actualizarResumenes(); }
});

// Fechas por defecto: hoy
$("desde").value = hoyISO();
$("hasta").value = hoyISO();
actualizarResumenes();