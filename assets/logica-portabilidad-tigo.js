/* =====================================================================
   logica-portabilidad-tigo.js · Validador de portabilidad HLR/HSS Tigo
   ---------------------------------------------------------------------
   Valida por MSISDN si la línea quedó CREADA en el HLR de Tigo tras un
   proceso de portabilidad, consultando el mismo endpoint que usaba
   CheckPortabilidad.html (autogestión HLR), pero con:

     · concurrencia real controlada (no secuencial),
     · reintentos SOLO por timeout,
     · parseo del volcado de texto `perfilHLR` (comando HLR tipo USCDB)
       en secciones + pares CAMPO=VALOR, para un detalle categorizado,
     · tabla, KPIs, filtros y exportación con el mismo shell (me-ui.js).

   Autenticación: header fijo `X-Api-Key` (no hay OAuth como en QDN/CM).

   IMPORTANTE — sobre la interpretación de bloqueos/restricciones:
   El formato de `perfilHLR` es un volcado de un comando propietario del
   HLR (Huawei/ZTE) sin documentación pública. Solo se dispone de UNA
   respuesta real exitosa de referencia, así que la detección de
   bloqueos (sección 3 de este archivo) es una HEURÍSTICA best-effort:
   se muestra siempre el valor crudo junto a la interpretación, y el
   detalle completo (todas las secciones) queda disponible sin filtrar.
===================================================================== */

/* ---------------------------------------------------------------------
   1 · AMBIENTE Y ENDPOINT
--------------------------------------------------------------------- */
const AMBIENTE_TIGO = {
    // El gateway se llama "qa", pero detrás hay UN SOLO HLR/HSS: la
    // respuesta es de PRODUCCIÓN. No existe un HLR de pruebas.
    etiqueta: "Gateway QA · HLR/HSS de producción",
    base_url: "https://tulioqa.grupo-exito.com/apimew/api/v1/autogestion/HLR/consulta",
    api_key: "5tVBWu5xdItBcC/4x9ohCBoEQTZ+PCiTpinT1hT+1eeiOCmq7dr+CZgZprcklYN4FJmPJBHoE1C6gkEYA2pqfA=="
};

const cfgTigo = Object.assign({}, AMBIENTE_TIGO, {
    timeoutMs: 30000,
    reintentos: 2,
    concurrencia: 8
});

/* ---------------------------------------------------------------------
   1b · ESTADO DE LA LÍNEA EN EL CM (Optiva) — el diferencial frente a
   consultar el HLR de Tigo a secas: el RETCODE 3001 ("sin perfil") no
   prueba por sí solo que el número sea de Móvil Éxito (ver doc §2.1);
   hay que cruzarlo con el estado en el CM. Mismo servicio y mismo
   criterio de "cuenta activa más reciente" que usan Prepagadas/Consumos
   (ver assets/logica-consumos.js, sección 2-3).

   Es OPCIONAL a propósito: sin sesión del CM, auth.token es null y esta
   función no intenta nada — la herramienta sigue funcionando igual,
   solo que la columna "Estado ME" queda vacía. No se fuerza el login.
--------------------------------------------------------------------- */
const auth = MEAPI.auth;
const getJson = MEAPI.getJson;
const ESTADOS_CM = { 1: "Activa", 2: "Desactivada", 3: "Disponible", 4: "Bloqueada" };

/**
 * Estado de una línea en el CM. Devuelve:
 *   null                              -> sin sesión del CM (no se consultó)
 *   { pertenece: false }              -> el CM no tiene esa línea
 *   { pertenece: true, estado: "..." } -> estado de la cuenta más reciente
 *   { pertenece: null, error: "..." }  -> la consulta falló (se avisa y sigue)
 */
async function estadoCM(msisdn) {
    if (!auth.token) return null;
    try {
        const data = await getJson(`${MEAPI.CONFIG.apiBase}/api/v1/subscribers`, { msisdnList: msisdn, offset: 0, limit: 10 });
        const lista = data?.subscriberResponseList || [];
        if (!lista.length) return { pertenece: false };

        // Varias cuentas (BAN) -> la activa más reciente; si ninguna está
        // activa, la última creada. Mismo criterio que Prepagadas/Consumos.
        const porFecha = (a, b) => Number(b?.profile?.created || 0) - Number(a?.profile?.created || 0);
        const activos = lista.filter(s => s?.status?.state === 1).sort(porFecha);
        const sub = activos[0] || lista.slice().sort(porFecha)[0];
        const codigo = sub?.status?.state;
        return { pertenece: true, estado: ESTADOS_CM[codigo] || (codigo != null ? `Estado ${codigo}` : null) };
    } catch (e) {
        MEUI.log(`⚠ CM ${msisdn}: no se pudo consultar el estado (${e.message})`, "warn");
        return { pertenece: null, error: e.message };
    }
}

/* ---------------------------------------------------------------------
   2 · PARSEO DE perfilHLR (comando HLR: secciones "..." + CAMPO = VALOR)
--------------------------------------------------------------------- */
function parsearPerfilHLR(texto) {
    const secciones = [];
    let actual = { nombre: "Identidad", items: [] };
    secciones.push(actual);
    let retcode = null, retmsg = "";

    String(texto || "").split(/\r?\n/).forEach(cruda => {
        const l = cruda.trim();
        if (!l) return;

        const mSec = l.match(/^"(.+)"$/);
        if (mSec) { actual = { nombre: mSec[1], items: [] }; secciones.push(actual); return; }

        // Líneas de cabecera/eco del comando USCDB: se descartan.
        if (/^\+\+\+/.test(l) || /^PGW\b/.test(l) || /^%%/.test(l) || /^---/.test(l)
            || /^There is together/i.test(l)) return;

        const mRet = l.match(/^RETCODE\s*=\s*(\d+)\s*(.*)$/i);
        if (mRet) { retcode = mRet[1]; retmsg = mRet[2] || ""; return; }

        const mKV = l.match(/^(\S+)\s*=\s*(.*)$/);
        if (mKV) actual.items.push({ clave: mKV[1], valor: mKV[2] });
        else actual.items.push({ texto: l });
    });

    return { secciones: secciones.filter(s => s.items.length), retcode, retmsg };
}

function buscarSeccion(secciones, nombre) {
    return secciones.find(s => s.nombre.toLowerCase() === nombre.toLowerCase()) || null;
}
function valorClave(seccion, clave) {
    if (!seccion) return null;
    const it = seccion.items.find(i => i.clave === clave);
    return it ? it.valor : null;
}

/* ---------------------------------------------------------------------
   3 · BLOQUEOS / RESTRICCIONES (heurística — ver nota al inicio del archivo)
--------------------------------------------------------------------- */
const CAMPOS_LOCK_BOOL = ["GPRSLOCK", "EPSLOCK", "NON3GPPLOCK", "CSUPLLCK", "PSUPLLCK"];

function calcularBloqueos(secciones) {
    const activos = [];
    const lock = buscarSeccion(secciones, "LOCK");
    if (lock) {
        ["IC", "OC"].forEach(k => {
            const v = valorClave(lock, k);
            if (v === "TRUE") activos.push({ etiqueta: "Bloqueo " + (k === "IC" ? "llamadas entrantes" : "llamadas salientes"), origen: "LOCK." + k, valor: v });
        });
        CAMPOS_LOCK_BOOL.forEach(k => {
            const v = valorClave(lock, k);
            if (v === "TRUE") activos.push({ etiqueta: k, origen: "LOCK." + k, valor: v });
        });
    }
    const sablock = buscarSeccion(secciones, "SABLOCK");
    if (sablock) {
        ["IC", "OC"].forEach(k => {
            const v = valorClave(sablock, k);
            if (v === "TRUE") activos.push({ etiqueta: "SABLOCK " + k, origen: "SABLOCK." + k, valor: v });
        });
    }
    // Campos ODB (Operator Determined Barring) que sí mapean a categorías
    // estándar de barring (3GPP TS 23.015): SS, PB1-4, OC/IC, ROAM, RCF, ECT,
    // POS. Otros campos "ODB*" del volcado (ODBENTE, ODBINFO, ODBPOSTYPE,
    // ODBENTEROAM, ODBINFOROAM, ODBDECT, ODBMECT) NO tienen un mapeo de
    // barring confiable sin documentación del fabricante — se dejan FUERA
    // del resumen a propósito para no marcar falsos positivos; siguen
    // visibles en la sección "ODB Data" del detalle crudo.
    const CAMPOS_ODB_BARRING = ["ODBSS", "ODBOC", "ODBIC", "ODBPB1", "ODBPB2", "ODBPB3", "ODBPB4",
        "ODBROAM", "ODBRCF", "ODBECT", "ODBPOS"];
    const odb = buscarSeccion(secciones, "ODB Data");
    if (odb) {
        odb.items.forEach(it => {
            if (!it.clave || CAMPOS_ODB_BARRING.indexOf(it.clave) < 0) return;
            const v = String(it.valor || "").toUpperCase();
            const sinRestriccion = v === "FALSE" || v.indexOf("NOB") === 0;
            if (!sinRestriccion) activos.push({ etiqueta: it.clave, origen: "ODB Data." + it.clave, valor: it.valor });
        });
    }
    return activos;
}

const TIPOS_DESVIO = ["CFU", "CFB", "CFNRY", "CFNRC", "CFD"];
function desviosConfigurados(textoOriginal) {
    return TIPOS_DESVIO.filter(t => new RegExp(`\\b${t}\\s*=\\s*PROV\\b`).test(textoOriginal || ""));
}

/* ---------------------------------------------------------------------
   4 · CATÁLOGO DE RETCODE -> ESTADO DE NEGOCIO
--------------------------------------------------------------------- */
const RETCODES = {
    // El proceso avanza en cadena: 1033 -> (Tigo depura) -> 3001 -> (se crea
    // el perfil) -> 0.
    //
    // 0     -> ya tiene perfil en el HLR: portación completada.
    // 3001  -> "Subscriber not defined": la línea NO tiene perfil en el HLR.
    //          Por sí solo NO prueba que el número sea de Móvil Éxito; hay
    //          que cruzarlo con el estado en ME (Optiva):
    //            · activa en ME pero sin perfil -> se escala a Optiva;
    //            · inactiva en ME -> sin perfil es lo esperado;
    //            · el número no es de Móvil Éxito (puede ser un Port Out).
    // 1033  -> "Number threshold exceeded": la línea era de Tigo y se portó a
    //          Móvil Éxito, pero Tigo no la eliminó de su HLR/HSS. Ese
    //          residuo bloquea la creación: se escala a Tigo y, una vez
    //          depurado, la consulta pasa a responder 3001.
    "0": { estado: "CREADA", etiqueta: "Creada" },
    "3001": { estado: "SIN_PERFIL", etiqueta: "Sin perfil (pendiente de creación)" },
    "1033": { estado: "RESIDUO_TIGO", etiqueta: "Residuo en Tigo (escalar a Tigo)" }
};

/* ---------------------------------------------------------------------
   5 · CONSULTA (fetch, timeout, reintentos SOLO por timeout)
--------------------------------------------------------------------- */
async function consultarUnaVez(linea, cfg) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    const t0 = performance.now();
    try {
        const r = await fetch(cfg.base_url, {
            method: "POST", signal: controlador.signal,
            headers: { "Content-Type": "application/json", "X-Api-Key": cfg.api_key },
            body: JSON.stringify({
                TransactionID: String(Date.now()) + Math.floor(Math.random() * 1000),
                FechaConsulta: new Date().toISOString(),
                Linea: linea
            })
        });
        const ms = Math.round(performance.now() - t0);
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
        return { ok: r.ok, status: r.status, cuerpo, texto, ms };
    } finally {
        clearTimeout(temporizador);
    }
}

function procesarRespuestaTigo(msisdn, cuerpo, meta) {
    const perfil = cuerpo.perfilHLR || "";
    const errores = Array.isArray(cuerpo.error) ? cuerpo.error : [];
    const textoOrigen = perfil || errores[0] || "";
    const { secciones, retcode, retmsg } = parsearPerfilHLR(textoOrigen);

    const catalogo = RETCODES[retcode] || null;
    let estadoProceso = catalogo ? catalogo.estado : (retcode ? "ERROR_RETCODE" : "ERROR");

    const identidad = buscarSeccion(secciones, "Identidad");

    /* ---- coherencia: la respuesta debe hablar de la línea consultada -----
       Sin esta validación un servicio que devuelva siempre el mismo perfil
       (o un stub de QA) haría que TODAS las líneas salgan como "Creada".
       Se compara el ISDN del perfil contra el MSISDN que se pidió. */
    const inconsistencias = [];
    const isdnPerfil = String(valorClave(identidad, "ISDN") || "").replace(/\D/g, "");
    const pedido = lineaTigo(msisdn).replace(/\D/g, "");
    if (isdnPerfil && isdnPerfil !== pedido) {
        inconsistencias.push(`El HLR respondió con el perfil de ${isdnPerfil}, no de ${pedido}.`);
    }
    if (retcode === "0" && !perfil.trim()) {
        inconsistencias.push("RETCODE 0 pero la respuesta no trae perfil HLR.");
    }
    if (retcode === "0" && perfil.trim() && !isdnPerfil) {
        inconsistencias.push("El perfil no trae ISDN: no se puede confirmar a qué línea corresponde.");
    }
    if (errores.length && perfil.trim()) {
        inconsistencias.push("La respuesta trae perfil y además errores: " +
            String(errores[0]).replace(/\s+/g, " ").slice(0, 160));
    }
    if (inconsistencias.length) estadoProceso = "INCONSISTENTE";
    const bloqueosActivos = perfil ? calcularBloqueos(secciones) : [];
    const roamOdb = buscarSeccion(secciones, "ODB Data");
    const roamValor = valorClave(roamOdb, "ODBROAM");
    const desvios = perfil ? desviosConfigurados(perfil) : [];

    return {
        msisdn, linea: cuerpo.linea || msisdn,
        estadoProceso, inconsistencias,
        retcode, retmsg,
        transaccionId: cuerpo.transaccionID, fechaHora: cuerpo.fechaHora,
        intentos: meta.intentos, ms: meta.ms, httpStatus: meta.httpStatus,
        resumen: {
            imsi: valorClave(identidad, "IMSI") || "—",
            imei: valorClave(identidad, "IMEI") || "—",
            isdn: valorClave(identidad, "ISDN") || "—",
            hlrsn: valorClave(identidad, "HLRSN") || "—",
            cardType: valorClave(identidad, "CardType") || "—",
            roaming: roamValor ? (roamValor.toUpperCase() === "NOBAR" ? "Sin restricción" : roamValor) : "—",
            // "PROV" = provisionado/configurado en el perfil, no necesariamente
            // desviando llamadas ahora mismo (para eso hay que leer STATUS en
            // el detalle de "SS Data": PROV | REG | ACT).
            desvios: desvios.length ? "Provisionados: " + desvios.join(", ") : (perfil ? "Ninguno" : "—")
        },
        bloqueosActivos,
        secciones,
        raw: cuerpo
    };
}

function filaError(msisdn, estadoProceso, detalle, meta) {
    return {
        msisdn, estadoProceso, detalle: detalle || "",
        intentos: (meta && meta.intentos) || 0, ms: (meta && meta.ms) || null,
        httpStatus: meta && meta.httpStatus,
        resumen: {}, bloqueosActivos: [], secciones: [],
        raw: (meta && meta.raw) || null
    };
}

/** Arma el valor `Linea` tal como lo espera Tigo (con indicativo 57). */
function lineaTigo(msisdn) {
    return msisdn.indexOf("57") === 0 ? msisdn : "57" + msisdn;
}

async function consultarConReintentos(msisdn, cfg) {
    let intentos = 0;
    const linea = lineaTigo(msisdn);

    while (true) {
        intentos++;
        let resp;
        try {
            resp = await consultarUnaVez(linea, cfg);
        } catch (e) {
            const esTimeout = e && e.name === "AbortError";
            if (esTimeout && intentos < cfg.reintentos + 1) continue;
            if (esTimeout) return filaError(msisdn, "TIMEOUT", "Se agotaron los reintentos por timeout.", { intentos });
            return filaError(msisdn, "ERROR", "Error de comunicación: " + (e.message || e), { intentos });
        }

        if (!resp.ok) {
            const msg = (resp.cuerpo && (resp.cuerpo.mensaje || resp.cuerpo.message))
                || (resp.texto || "").slice(0, 200) || ("HTTP " + resp.status);
            return filaError(msisdn, "ERROR", msg, { intentos, httpStatus: resp.status, raw: resp.cuerpo });
        }
        if (!resp.cuerpo) {
            return filaError(msisdn, "ERROR", "La respuesta no es JSON válido.", { intentos, httpStatus: resp.status, raw: resp.texto });
        }

        return procesarRespuestaTigo(msisdn, resp.cuerpo, { intentos, ms: resp.ms, httpStatus: resp.status });
    }
}

/* ---------------------------------------------------------------------
   6 · CONCURRENCIA
--------------------------------------------------------------------- */
async function ejecutarPool(items, limite, worker) {
    let i = 0;
    const total = items.length;
    const n = Math.max(1, Math.min(limite || 8, total || 1));
    const ejecutores = Array.from({ length: n }, async () => {
        while (i < total) {
            const idx = i++;
            await worker(items[idx], idx);
        }
    });
    await Promise.all(ejecutores);
}

/* ---------------------------------------------------------------------
   7 · ENTRADA: MSISDN individual y masivo (pegar / CSV / Excel)
--------------------------------------------------------------------- */
function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }

function parseMsisdns(texto) {
    const vistos = new Set(), orden = [], invalidas = [];
    let total = 0, duplicados = 0;
    String(texto || "").split(/[\s,;|\t\r\n]+/).forEach(bruto => {
        const crudo = String(bruto).trim();
        if (!crudo) return;
        total++;
        const num = soloDigitos(crudo);
        if (num.length < 7 || num.length > 15) { invalidas.push(crudo); return; }
        if (vistos.has(num)) { duplicados++; return; }
        vistos.add(num); orden.push(num);
    });
    return { lineas: orden, invalidas, total, duplicados };
}

let lineasArchivo = null;
function obtenerLineas() {
    if (lineasArchivo && lineasArchivo.lineas && lineasArchivo.lineas.length) return lineasArchivo;
    const el = MEUI.$("#inputLineas");
    return el ? parseMsisdns(el.value) : { lineas: [], invalidas: [], total: 0, duplicados: 0 };
}

/* ---------------------------------------------------------------------
   8 · ESTADO DE LA HERRAMIENTA
--------------------------------------------------------------------- */
let filas = [];
let dataTable = null;
let corriendo = false;
const filtros = { proceso: new Set(), bloqueo: new Set() };
const columnas = ["msisdn", "estado", "estadoCm", "retcode", "imsi", "imei", "card", "bloqueos", "roaming", "desvios", "detalle"];
const ETIQUETA_COLUMNA = {
    msisdn: "MSISDN", estado: "Estado", estadoCm: "Estado ME", retcode: "RETCODE", imsi: "IMSI", imei: "IMEI",
    card: "Tipo SIM", bloqueos: "Bloqueos", roaming: "Roaming", desvios: "Desvíos", detalle: "Detalle"
};
const columnasOcultas = new Set();

const ETIQUETA_ESTADO = {
    CREADA: "Creada", SIN_PERFIL: "Sin perfil (pendiente)", RESIDUO_TIGO: "Residuo en Tigo",
    INCONSISTENTE: "Revisar respuesta",
    ERROR_RETCODE: "Error (RETCODE)", ERROR: "Error", TIMEOUT: "Timeout",
    INVALID: "Inválida", EN_COLA: "En cola", PROCESSING: "Consultando"
};

/** Celda de "Estado ME": "—" sin sesión del CM, "No está en el CM" si el
 *  CM no tiene la línea, o el estado (Activa/Desactivada/...) si sí. */
function celdaEstadoCM(f) {
    if (!f.cm) return `<span class="text-muted">—</span>`;
    if (f.cm.pertenece === false) return `<span class="badge-estado neutro">No está en el CM</span>`;
    if (f.cm.pertenece === null) return `<span class="badge-estado err" title="${MEUI.esc(f.cm.error || '')}">Error CM</span>`;
    if (!f.cm.estado) return `<span class="text-muted">—</span>`;
    return `<span class="badge-estado ${f.cm.estado === "Activa" ? "ok" : "off"}">${MEUI.esc(f.cm.estado)}</span>`;
}

function textoBloqueos(f) {
    const n = (f.bloqueosActivos || []).length;
    return n ? `⚠ ${n} restricción${n > 1 ? "es" : ""}` : "Sin restricciones";
}

/* ---------------------------------------------------------------------
   9 · CONSULTA MASIVA
--------------------------------------------------------------------- */
function actualizarProgreso(hechas, total) {
    const wrap = MEUI.$("#progresoWrap");
    if (!wrap) return;
    wrap.style.display = total ? "" : "none";
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    const c = { CREADA: 0, SIN_PERFIL: 0, RESIDUO_TIGO: 0, TIMEOUT: 0, ERROR: 0, ERROR_RETCODE: 0, INVALID: 0, INCONSISTENTE: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    MEUI.$("#progresoTexto").textContent =
        `Procesando: ${hechas} / ${total}  ·  Creadas ${c.CREADA}  ·  Sin perfil ${c.SIN_PERFIL}  ·  ` +
        `Residuo Tigo ${c.RESIDUO_TIGO}  ·  Timeout ${c.TIMEOUT}  ·  Errores ${c.ERROR + c.ERROR_RETCODE}`;
    MEUI.$("#progresoPct").textContent = pct + "%";
    MEUI.$("#progresoBar").style.width = pct + "%";
}

async function consultar() {
    if (corriendo) return;
    const entrada = obtenerLineas();
    if (!entrada.lineas.length) { MEUI.toast("No hay líneas válidas para consultar.", "warn"); return; }
    MEUI.log(`Registros recibidos: ${entrada.total}  ·  MSISDN válidos: ${entrada.lineas.length}  ·  ` +
        `Inválidos: ${entrada.invalidas.length}  ·  Duplicados: ${entrada.duplicados}`, "info");

    corriendo = true;
    const btn = MEUI.$("#btnConsultar");
    if (btn) btn.disabled = true;

    filas = entrada.lineas.map(m => ({ msisdn: m, estadoProceso: "EN_COLA", resumen: {}, cm: null }));
    entrada.invalidas.forEach(v => filas.push(filaError(v, "INVALID", "MSISDN con formato inválido.")));
    render();

    const cfg = cfgTigo;
    const concurrencia = Math.max(1, Math.min(15, Number(MEUI.$("#cfgConcurrencia").value) || 8));
    cfg.concurrencia = concurrencia;

    let hechas = 0, ultimoRender = 0;
    const total = entrada.lineas.length;
    const porMsisdn = new Map(filas.map(f => [f.msisdn, f]));

    await ejecutarPool(entrada.lineas, concurrencia, async (msisdn) => {
        const fila = porMsisdn.get(msisdn);
        fila.estadoProceso = "PROCESSING";
        // Tigo (HLR) y CM corren EN PARALELO por línea: son servicios
        // distintos y no hay que esperar al uno para pedir el otro.
        const [resultado, cm] = await Promise.all([
            consultarConReintentos(msisdn, cfg),
            estadoCM(msisdn)
        ]);
        Object.assign(fila, resultado);
        fila.cm = cm;
        hechas++;
        actualizarProgreso(hechas, total);
        const ahora = performance.now();
        if (ahora - ultimoRender > 400 || hechas === total) { ultimoRender = ahora; render(); }
    });

    corriendo = false;
    if (btn) btn.disabled = false;
    render();

    const c = { CREADA: 0, SIN_PERFIL: 0, RESIDUO_TIGO: 0, TIMEOUT: 0, ERROR: 0, ERROR_RETCODE: 0, INVALID: 0, INCONSISTENTE: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    MEUI.log(`Resultado — Total: ${filas.length}  ·  Creadas: ${c.CREADA}  ·  Sin perfil: ${c.SIN_PERFIL}  ·  ` +
        `Residuo en Tigo: ${c.RESIDUO_TIGO}  ·  Timeout: ${c.TIMEOUT}  ·  Errores: ${c.ERROR + c.ERROR_RETCODE}  ·  ` +
        `Inválidas: ${c.INVALID}`, "ok");
    MEUI.toast(`Consulta terminada: ${filas.length} líneas procesadas.`, "ok");
}

/* ---------------------------------------------------------------------
   10 · FILTROS Y KPIs
--------------------------------------------------------------------- */
const PROCESOS_FALLIDOS = ["ERROR", "ERROR_RETCODE", "TIMEOUT", "INVALID"];

function filaPasaFiltros(f) {
    if (filtros.proceso.size) {
        // "FALLIDAS" agrupa todo lo que no dejó un resultado utilizable.
        const agrupado = filtros.proceso.has("FALLIDAS")
            && PROCESOS_FALLIDOS.indexOf(f.estadoProceso) >= 0;
        if (!agrupado && !filtros.proceso.has(f.estadoProceso)) return false;
    }
    if (filtros.bloqueo.size) {
        const con = (f.bloqueosActivos || []).length > 0;
        if (filtros.bloqueo.has("CON") && !con) return false;
        if (filtros.bloqueo.has("SIN") && con) return false;
    }
    return true;
}

function pintarFiltro(ul, dim, opciones) {
    if (!ul) return;
    ul.innerHTML = opciones.map(([valor, etiqueta, n]) => `
        <li class="form-check px-2">
            <input class="form-check-input" type="checkbox" value="${MEUI.esc(valor)}"
                id="f_${dim}_${MEUI.esc(valor)}" ${filtros[dim].has(valor) ? "checked" : ""}>
            <label class="form-check-label" for="f_${dim}_${MEUI.esc(valor)}">${MEUI.esc(etiqueta)} <small class="text-muted">(${n})</small></label>
        </li>`).join("") || `<li class="px-2 text-muted small">Sin datos aún.</li>`;
    ul.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
        if (chk.checked) filtros[dim].add(chk.value); else filtros[dim].delete(chk.value);
        render();
    }));
}

function actualizarFiltros() {
    const cont = v => filas.filter(f => f.estadoProceso === v).length;
    const estados = [...new Set(filas.map(f => f.estadoProceso))].sort();
    pintarFiltro(MEUI.$("#fEstado"), "proceso", estados.map(v => [v, ETIQUETA_ESTADO[v] || v, cont(v)]));

    const con = filas.filter(f => (f.bloqueosActivos || []).length).length;
    const sin = filas.length - con;
    pintarFiltro(MEUI.$("#fBloqueo"), "bloqueo", [["CON", "Con restricciones", con], ["SIN", "Sin restricciones", sin]]);
}

function actualizarKPIs() {
    const c = { CREADA: 0, SIN_PERFIL: 0, RESIDUO_TIGO: 0, TIMEOUT: 0, ERROR: 0, ERROR_RETCODE: 0, INVALID: 0, INCONSISTENTE: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    MEUI.$("#kpiCreadas").textContent = c.CREADA;
    MEUI.$("#kpiSinPerfil").textContent = c.SIN_PERFIL;
    MEUI.$("#kpiResiduoTigo").textContent = c.RESIDUO_TIGO;
    MEUI.$("#kpiRevisar").textContent = c.INCONSISTENTE;
    MEUI.$("#kpiErrores").textContent = c.ERROR + c.ERROR_RETCODE + c.TIMEOUT + c.INVALID;
}

function alternarKpi(el) {
    const dim = el.dataset.fdim, val = el.dataset.fval;
    const activo = el.classList.toggle("kpi-activo");
    MEUI.$$(`.me-kpi[data-fdim="${dim}"]`).forEach(o => { if (o !== el) o.classList.remove("kpi-activo"); });
    filtros[dim].clear();
    if (activo) filtros[dim].add(val);
    render();
}

function limpiarFiltros() {
    Object.values(filtros).forEach(s => s.clear());
    MEUI.$$(".me-kpi.kpi-activo").forEach(k => k.classList.remove("kpi-activo"));
    render();
}

/* ---------------------------------------------------------------------
   11 · COLUMNAS
--------------------------------------------------------------------- */
function pintarMenuColumnas() {
    const ul = MEUI.$("#menuColumnas");
    if (!ul) return;
    ul.innerHTML = columnas.map((c, i) => `
        <li class="form-check px-2">
            <input class="form-check-input" type="checkbox" data-col="${i}"
                id="col_${c}" ${columnasOcultas.has(c) ? "" : "checked"}>
            <label class="form-check-label" for="col_${c}">${ETIQUETA_COLUMNA[c]}</label>
        </li>`).join("");
    ul.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
        const c = columnas[Number(chk.dataset.col)];
        if (chk.checked) columnasOcultas.delete(c); else columnasOcultas.add(c);
        if (dataTable) { dataTable.column(Number(chk.dataset.col)).visible(chk.checked); MEUI.ajustarTablas(); }
    }));
}

/* ---------------------------------------------------------------------
   12 · TABLA
--------------------------------------------------------------------- */
function celdaEstado(f) {
    const e = f.estadoProceso;
    const cls = { CREADA: "ok", SIN_PERFIL: "off", RESIDUO_TIGO: "warn", TIMEOUT: "warn", INCONSISTENTE: "warn",
        ERROR: "err", ERROR_RETCODE: "err", INVALID: "err", EN_COLA: "neutro", PROCESSING: "info" }[e] || "neutro";
    return `<span class="badge-estado ${cls}">${MEUI.esc(ETIQUETA_ESTADO[e] || e)}</span>`;
}

function construirDataTable() {
    dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
        data: [],
        columns: [
            { data: "msisdn", title: "MSISDN", render: v => `<span class="me-mono">${MEUI.esc(v)}</span>` },
            { data: null, title: "Estado", render: f => celdaEstado(f) },
            { data: null, title: "Estado ME", render: f => celdaEstadoCM(f) },
            { data: null, title: "RETCODE", render: f => MEUI.esc(f.retcode || "—") },
            { data: null, title: "IMSI", render: f => MEUI.esc((f.resumen && f.resumen.imsi) || "—") },
            { data: null, title: "IMEI", render: f => MEUI.esc((f.resumen && f.resumen.imei) || "—") },
            { data: null, title: "Tipo SIM", render: f => MEUI.esc((f.resumen && f.resumen.cardType) || "—") },
            {
                data: null, title: "Bloqueos", render: f => f.estadoProceso === "CREADA"
                    ? `<span class="${(f.bloqueosActivos || []).length ? "chip-bloqueo activo" : "chip-bloqueo"}">${MEUI.esc(textoBloqueos(f))}</span>`
                    : "—"
            },
            { data: null, title: "Roaming", render: f => MEUI.esc((f.resumen && f.resumen.roaming) || "—") },
            { data: null, title: "Desvíos", render: f => MEUI.esc((f.resumen && f.resumen.desvios) || "—") },
            {
                data: null, title: "Detalle", orderable: false, className: "col-accion",
                render: f => `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                    title="Ver detalle completo">👁</button>`
            }
        ]
    }));
    dataTable.on("click", "button.btn-detalle", function (e) {
        e.stopPropagation();
        abrirDetalle(this.dataset.msisdn);
    });
    dataTable.on("click", "tbody tr", function () {
        const fila = dataTable.row(this).data();
        if (fila && fila.msisdn) abrirDetalle(fila.msisdn);
    });
    MEUI.registrarTabla(dataTable);
}

function render() {
    MEUI.prepararTabla("#tablaResultados");
    if (!dataTable) construirDataTable();
    const visibles = filas.filter(filaPasaFiltros);
    dataTable.clear();
    dataTable.rows.add(visibles);
    dataTable.draw(false);
    actualizarKPIs();
    actualizarFiltros();
    pintarMenuColumnas();
    MEUI.mostrarSiHayDatos("#tablaResultados", { vacio: "#msgVacio", tabla: dataTable });
    MEUI.resumenPaso(2, filas.length ? `${filas.length} líneas consultadas` : "");
    MEUI.ajustarTablas();
}

/* ---------------------------------------------------------------------
   13 · MODAL DE DETALLE
--------------------------------------------------------------------- */
function filaDe(msisdn) { return filas.find(f => f.msisdn === msisdn); }

function gridSeccion(seccion) {
    if (!seccion || !seccion.items.length) return `<p class="me-hint mb-0">Sin datos.</p>`;
    return `<dl class="dl-grid mb-0">` + seccion.items.map(it => it.clave
        ? `<dt>${MEUI.esc(it.clave)}</dt><dd>${MEUI.esc(it.valor === "" ? "—" : it.valor)}</dd>`
        : `<dt class="text-muted">—</dt><dd>${MEUI.esc(it.texto)}</dd>`
    ).join("") + `</dl>`;
}

function abrirDetalle(msisdn) {
    const f = filaDe(msisdn);
    if (!f) return;
    MEUI.$("#mdMsisdn").textContent = f.msisdn;
    MEUI.$("#mdImsi").textContent = (f.resumen && f.resumen.imsi) || "—";
    MEUI.$("#mdImei").textContent = (f.resumen && f.resumen.imei) || "—";

    if (f.estadoProceso === "INVALID" || f.estadoProceso === "TIMEOUT" || f.estadoProceso === "ERROR") {
        MEUI.$("#mdResumen").innerHTML = `<div class="alert alert-warning mb-0">
            <b>${MEUI.esc(ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso)}</b> — ${MEUI.esc(f.detalle || "Sin detalle adicional.")}
            ${f.intentos ? `<div class="me-hint mt-1">Intentos realizados: ${f.intentos}</div>` : ""}
        </div>`;
        MEUI.$("#mdCategorias").innerHTML = "";
        MEUI.$("#mdTecnico").innerHTML = "";
        MEUI.$("#mdJson").textContent = f.raw ? JSON.stringify(f.raw, null, 2) : "(sin respuesta)";
        new bootstrap.Modal("#modalDetalle").show();
        return;
    }

    const cls = { CREADA: "ok", SIN_PERFIL: "off", RESIDUO_TIGO: "warn", ERROR_RETCODE: "err", INCONSISTENTE: "warn" }[f.estadoProceso] || "neutro";
    MEUI.$("#mdResumen").innerHTML = `
        ${(f.inconsistencias || []).length ? `<div class="alert alert-warning py-2 mb-2">
            <b>Respuesta inconsistente — no usar como evidencia sin verificar:</b>
            <ul class="mb-0">${f.inconsistencias.map(t => `<li>${MEUI.esc(t)}</li>`).join("")}</ul>
        </div>` : ""}
        <div class="d-flex flex-wrap gap-3 align-items-center">
            <span class="badge-estado ${cls}">${MEUI.esc(ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso)}</span>
            <span class="me-mono text-muted">RETCODE ${MEUI.esc(f.retcode || "—")} ${MEUI.esc(f.retmsg || "")}</span>
            <span>Estado ME: ${celdaEstadoCM(f)}</span>
            ${f.bloqueosActivos.length ? `<span class="chip-bloqueo activo">${MEUI.esc(textoBloqueos(f))}</span>` : ""}
        </div>
        ${f.estadoProceso === "SIN_PERFIL" && f.cm && f.cm.estado === "Activa" ? `
            <div class="alert alert-warning py-2 mt-2 mb-0">
                <b>Inconsistencia a escalar a Optiva:</b> la línea está <b>Activa en el CM</b> pero
                <b>sin perfil en el HLR de Tigo</b> (ver doc §2.1).
            </div>` : ""}
        ${f.bloqueosActivos.length ? `
            <div class="mt-2">
                <div class="fw-bold small mb-1">Restricciones detectadas (heurística — ver detalle crudo abajo)</div>
                <ul class="mb-0">${f.bloqueosActivos.map(b => `<li>${MEUI.esc(b.etiqueta)}
                    <span class="me-mono text-muted">(${MEUI.esc(b.origen)} = ${MEUI.esc(b.valor)})</span></li>`).join("")}</ul>
            </div>` : ""}`;

    MEUI.$("#mdCategorias").innerHTML = f.secciones.length
        ? f.secciones.map(s => `
        <div class="mb-3">
            <h6 class="fw-bold">${MEUI.esc(s.nombre)} <small class="text-muted fw-normal">(${s.items.length})</small></h6>
            ${gridSeccion(s)}
        </div>`).join("")
        : `<p class="me-hint">No se recibió perfil detallado en esta respuesta.</p>`;

    MEUI.$("#mdTecnico").innerHTML = gridSeccion({
        items: [
            { clave: "RETCODE", valor: f.retcode }, { clave: "Mensaje", valor: f.retmsg },
            { clave: "Transaction ID", valor: f.transaccionId }, { clave: "Fecha/hora", valor: f.fechaHora },
            { clave: "Intentos realizados", valor: f.intentos }, { clave: "Duración (ms)", valor: f.ms }
        ]
    });

    MEUI.$("#mdJson").textContent = JSON.stringify(f.raw, null, 2);
    new bootstrap.Modal("#modalDetalle").show();
}

/* ---------------------------------------------------------------------
   14 · EXPORTACIÓN
--------------------------------------------------------------------- */
const CABECERA_EXPORT = ["MSISDN", "Estado", "Estado ME", "RETCODE", "Mensaje", "IMSI", "IMEI", "Tipo SIM",
    "Restricciones", "Roaming", "Desvíos", "Transaction ID", "Fecha/hora", "Observaciones"];

/** Texto plano del estado ME para exportar (CSV/Excel no llevan HTML). */
function textoEstadoCM(f) {
    if (!f.cm) return "";
    if (f.cm.pertenece === false) return "No está en el CM";
    if (f.cm.pertenece === null) return "Error CM: " + (f.cm.error || "");
    return f.cm.estado || "";
}

function filasExport() {
    const rows = filas.filter(filaPasaFiltros).map(f => [
        f.msisdn, ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso, textoEstadoCM(f), f.retcode || "", f.retmsg || f.detalle || "",
        (f.resumen && f.resumen.imsi) || "", (f.resumen && f.resumen.imei) || "", (f.resumen && f.resumen.cardType) || "",
        (f.bloqueosActivos || []).map(b => b.etiqueta).join(" | "),
        (f.resumen && f.resumen.roaming) || "", (f.resumen && f.resumen.desvios) || "",
        f.transaccionId || "", f.fechaHora || "",
        (f.inconsistencias || []).join(" | ")
    ]);
    return { head: CABECERA_EXPORT, rows };
}

function filasParaExportar() {
    return filas.filter(filaPasaFiltros).map(f => ({
        msisdn: f.msisdn, estado: ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso, estadoCm: textoEstadoCM(f),
        retcode: f.retcode, retmsg: f.retmsg, resumen: f.resumen, bloqueosActivos: f.bloqueosActivos,
        transaccionId: f.transaccionId, fechaHora: f.fechaHora, raw: f.raw
    }));
}

/* ---------------------------------------------------------------------
   15 · CARGA DE ARCHIVO (Excel / CSV) — mismo patrón del validador QDN
--------------------------------------------------------------------- */
function configurarArchivo() {
    const zona = MEUI.$("#dropzone"), input = MEUI.$("#inputArchivo");
    const selHoja = MEUI.$("#selHoja"), selColumna = MEUI.$("#selColumna");
    const info = MEUI.$("#fileInfo"), btnQuitar = MEUI.$("#btnQuitarArchivo");
    let libro = null;

    function limpiar() {
        libro = null; lineasArchivo = null;
        input.value = "";
        selHoja.innerHTML = '<option value="">— carga un archivo —</option>'; selHoja.disabled = true;
        selColumna.innerHTML = '<option value="">— carga un archivo —</option>'; selColumna.disabled = true;
        info.textContent = ""; btnQuitar.classList.add("d-none");
    }

    function extraerColumna() {
        if (!libro || !selHoja.value || !selColumna.value) { lineasArchivo = null; return; }
        const filasHoja = MEUI.filasDeHoja(libro.wb, selHoja.value);
        const valores = filasHoja.map(r => r[selColumna.value]).filter(v => v !== undefined && v !== "");
        lineasArchivo = parseMsisdns(valores.join("\n"));
        info.innerHTML = `${filasHoja.length} filas · ${lineasArchivo.lineas.length} MSISDN válidos` +
            (lineasArchivo.invalidas.length ? ` · ${lineasArchivo.invalidas.length} inválidos` : "") +
            (lineasArchivo.duplicados ? ` · ${lineasArchivo.duplicados} duplicados` : "");
    }

    function pintarColumnas() {
        const filasHoja = MEUI.filasDeHoja(libro.wb, selHoja.value);
        const columnasHoja = filasHoja.length ? Object.keys(filasHoja[0]) : [];
        selColumna.disabled = !columnasHoja.length;
        selColumna.innerHTML = columnasHoja.map(c => `<option value="${MEUI.esc(c)}">${MEUI.esc(c)}</option>`).join("");
        const auto = MEUI.detectarColumna(columnasHoja);
        if (auto) selColumna.value = auto;
        extraerColumna();
    }

    async function procesar(file) {
        try {
            libro = await MEUI.leerLibro(file);
            selHoja.disabled = false;
            selHoja.innerHTML = libro.hojas.map(h => `<option value="${MEUI.esc(h)}">${MEUI.esc(h)}</option>`).join("");
            selHoja.value = libro.hojas[0];
            pintarColumnas();
            btnQuitar.classList.remove("d-none");
            MEUI.log(`Archivo cargado: ${file.name} (${libro.hojas.length} hoja(s)).`, "ok");
        } catch (e) {
            MEUI.toast("No se pudo leer el archivo: " + e.message, "err");
            limpiar();
        }
    }

    zona.addEventListener("click", () => input.click());
    zona.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragover", "dragenter"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("drag"); }));
    zona.addEventListener("drop", e => { if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0]); });
    input.addEventListener("change", () => { if (input.files[0]) procesar(input.files[0]); });
    selHoja.addEventListener("change", pintarColumnas);
    selColumna.addEventListener("change", extraerColumna);
    btnQuitar.addEventListener("click", limpiar);
}

/* ---------------------------------------------------------------------
   16 · INICIALIZACIÓN
--------------------------------------------------------------------- */
function inicializarTigo() {
    MEUI.$("#cfgBaseUrl").value = AMBIENTE_TIGO.base_url;
    MEUI.$("#cfgApiKey").value = AMBIENTE_TIGO.api_key;

    MEUI.$("#btnConsultar").addEventListener("click", () => {
        cfgTigo.base_url = MEUI.$("#cfgBaseUrl").value.trim() || AMBIENTE_TIGO.base_url;
        cfgTigo.api_key = MEUI.$("#cfgApiKey").value.trim() || AMBIENTE_TIGO.api_key;
        consultar();
    });
    MEUI.$("#btnLimpiarFiltros").addEventListener("click", limpiarFiltros);
    MEUI.$$(".me-kpi.kpi-click").forEach(k => k.addEventListener("click", () => alternarKpi(k)));

    configurarArchivo();
    render();
}
inicializarTigo();
