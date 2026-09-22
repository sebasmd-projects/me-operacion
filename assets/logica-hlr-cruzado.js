/* =====================================================================
   logica-hlr-cruzado.js · ¿En qué HLR está la línea? (Claro / Tigo / Ninguno)
   ---------------------------------------------------------------------
   Por cada MSISDN consulta EN PARALELO el QDN de Claro (OAuth2, igual que
   validador_qdn.html) y el HLR de Tigo (X-Api-Key, igual que
   validador_qdn_tigo.html), y concluye en cuál de las dos redes está la
   línea — o en ninguna.

   Regla de conclusión (aclarada por el equipo):
     · Claro NO distingue "no existe" de "inactiva": ambas casos responden
       operationalState=inactive con HTTP 200. Por eso "Claro" solo aporta
       Activa / Inactiva, sin un tercer estado.
     · Tigo: RETCODE 0 = la línea tiene perfil en el HLR/HSS; RETCODE 3001 =
       no tiene perfil (no dice de quién es el número: puede estar inactiva
       en ME, ser una inconsistencia a escalar a Optiva si en ME figura
       activa, o simplemente no ser de Móvil Éxito); RETCODE 1033 = la línea
       se portó a Móvil Éxito pero Tigo no la eliminó de su HLR/HSS, así que
       SÍ queda registro en Tigo: es un residuo que se escala a Tigo y que,
       una vez depurado, pasa a responder 3001.

   Este archivo NO reemplaza a validador_qdn.html ni a
   validador_qdn_tigo.html: duplica lo mínimo de cada motor (autenticación
   + una consulta) para poder correr ambas en paralelo por línea. El
   detalle forense completo (categorías, bloqueos) se consulta en la
   herramienta dedicada de cada operador.
===================================================================== */

/* ---------------------------------------------------------------------
   1 · AMBIENTES
--------------------------------------------------------------------- */
const AMBIENTE_CLARO = {
    token_url: "https://apim.claro.com.co/MsCommunicatAuthToken/User/authenticate",
    client_id: "MOVILEXITO",
    client_secret: "ebaee6c9-513b-4ee6-abc4-c88924006bb8",
    base_apigw: "https://msapigateway-nm-apigateway-aro-prod.apps.prd-claro-co.eastus2.aroapp.io",
    auth_en_cuerpo: true,
    api_usuario: "exitoapi",
    api_clave: "exitoapi"
};
const RUTA_QDN_CLARO = "/APIMParOrdeConsQDN/MS/CUS/Customer/RSParOrdeConsQDN/V1/ValideQDN/";

const AMBIENTE_TIGO = {
    base_url: "https://tulioqa.grupo-exito.com/apimew/api/v1/autogestion/HLR/consulta",
    api_key: "5tVBWu5xdItBcC/4x9ohCBoEQTZ+PCiTpinT1hT+1eeiOCmq7dr+CZgZprcklYN4FJmPJBHoE1C6gkEYA2pqfA=="
};

const cfgCruce = {
    claro: Object.assign({}, AMBIENTE_CLARO, { timeoutMs: 30000, reintentos: 2 }),
    tigo: Object.assign({}, AMBIENTE_TIGO, { timeoutMs: 30000, reintentos: 2 }),
    concurrencia: 5 // cada línea dispara 2 peticiones (Claro + Tigo) en paralelo
};

/* ---------------------------------------------------------------------
   2 · AUTENTICACIÓN CLARO (OAuth2 — mismo gestor que logica-qdn.js)
--------------------------------------------------------------------- */
const gestorClaro = {
    token: null, exp: 0, renovando: null,

    intentos(cfg) {
        const basic = btoa(`${cfg.client_id}:${cfg.client_secret}`);
        const form = { "Content-Type": "application/x-www-form-urlencoded" };
        const enCuerpo = ["client_credentials en el cuerpo", {
            headers: form,
            body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.client_id, client_secret: cfg.client_secret })
        }];
        const enCabecera = ["Basic + client_credentials", {
            headers: Object.assign({}, form, { Authorization: "Basic " + basic }),
            body: new URLSearchParams({ grant_type: "client_credentials" })
        }];
        const lista = [];
        if (cfg.auth_en_cuerpo) lista.push(enCuerpo, enCabecera);
        else {
            lista.push(["JSON username/password", {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: cfg.client_id, password: cfg.client_secret })
            }]);
            lista.push(enCabecera, enCuerpo);
        }
        if (cfg.api_usuario) {
            lista.push(["password grant con usuario de API", {
                headers: form,
                body: new URLSearchParams({
                    grant_type: "password", client_id: cfg.client_id, client_secret: cfg.client_secret,
                    username: cfg.api_usuario, password: cfg.api_clave || ""
                })
            }]);
        }
        lista.push(["JSON clientId/clientSecret", {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: cfg.client_id, clientSecret: cfg.client_secret })
        }]);
        return lista;
    },

    extraerToken(obj, profundidad) {
        profundidad = profundidad || 0;
        if (profundidad > 4 || obj == null) return null;
        const llaves = ["access_token", "accessToken", "token", "id_token", "jwt", "access_Public", "api_request"];
        if (typeof obj === "object" && !Array.isArray(obj)) {
            for (const k of llaves) if (typeof obj[k] === "string" && obj[k].length > 20) return obj[k];
            for (const v of Object.values(obj)) { const r = this.extraerToken(v, profundidad + 1); if (r) return r; }
        } else if (Array.isArray(obj)) {
            for (const v of obj) { const r = this.extraerToken(v, profundidad + 1); if (r) return r; }
        }
        return null;
    },

    async solicitar(cfg) {
        let ultimo = null;
        for (const [nombre, opts] of this.intentos(cfg)) {
            try {
                const r = await fetch(cfg.token_url, Object.assign({ method: "POST" }, opts));
                const texto = await r.text();
                let cuerpo; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { cuerpo = texto; }
                if (r.ok) {
                    const token = typeof cuerpo === "string" ? cuerpo : this.extraerToken(cuerpo);
                    if (token) {
                        this.token = token;
                        const vida = (cuerpo && cuerpo.expires_in) ? Number(cuerpo.expires_in) : 1500;
                        this.exp = Date.now() + Math.max(30, vida - 30) * 1000;
                        return token;
                    }
                    ultimo = nombre + ": respuesta 200 sin token";
                } else ultimo = nombre + `: HTTP ${r.status}`;
            } catch (e) { ultimo = nombre + ": " + e.message; }
        }
        throw new Error("No se pudo obtener el token Claro. Último error → " + ultimo);
    },

    async obtener(cfg, forzar) {
        if (!forzar && this.token && Date.now() < this.exp) return this.token;
        if (this.renovando) return this.renovando;
        this.renovando = this.solicitar(cfg).finally(() => { this.renovando = null; });
        return this.renovando;
    },

    reset() { this.token = null; this.exp = 0; }
};

/* ---------------------------------------------------------------------
   3 · CONSULTA CLARO (una vez + reintentos por timeout)
--------------------------------------------------------------------- */
async function consultarClaroUnaVez(msisdn, cfg, token) {
    const url = cfg.base_apigw.replace(/\/$/, "") + RUTA_QDN_CLARO + msisdn;
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    try {
        const r = await fetch(url, {
            method: "GET", signal: controlador.signal,
            headers: {
                "Accept": "application/json", "Authorization": "Bearer " + token,
                "transactionId": (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
            }
        });
        const texto = await r.text();
        let cuerpo = null; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
        return { ok: r.ok, status: r.status, cuerpo, texto };
    } finally { clearTimeout(temporizador); }
}

async function consultarClaro(msisdn, cfg) {
    let intentos = 0;
    while (true) {
        intentos++;
        let token;
        try { token = await gestorClaro.obtener(cfg); }
        catch (e) { return { fuente: "claro", estado: "ERROR", mensaje: "Autenticación: " + e.message, raw: null }; }

        let resp;
        try { resp = await consultarClaroUnaVez(msisdn, cfg, token); }
        catch (e) {
            const esTimeout = e && e.name === "AbortError";
            if (esTimeout && intentos < cfg.reintentos + 1) continue;
            if (esTimeout) return { fuente: "claro", estado: "TIMEOUT", mensaje: "Se agotaron los reintentos por timeout.", raw: null };
            return { fuente: "claro", estado: "ERROR", mensaje: "Error de comunicación: " + (e.message || e), raw: null };
        }

        if (resp.status === 401 || resp.status === 403) { gestorClaro.reset(); if (intentos === 1) continue; }

        if (!resp.ok) return { fuente: "claro", estado: "ERROR", mensaje: "HTTP " + resp.status, raw: resp.cuerpo };
        const res = resp.cuerpo && resp.cuerpo.result;
        if (!res) return { fuente: "claro", estado: "ERROR", mensaje: "Respuesta sin 'result'.", raw: resp.cuerpo };

        const operationalState = (res.operationalState || "").toLowerCase();
        const estado = operationalState === "active" ? "ACTIVA" : "INACTIVA";
        const nota = Array.isArray(res.note) ? res.note.map(n => n.text).filter(Boolean).join(" · ") : "";
        // Mismo endpoint que logica-qdn.js: el detalle completo (categorías,
        // bloqueos) se consulta allá; aquí solo se rescata el IMSI para el
        // título del modal.
        const rc = Array.isArray(res.resourceCharacteristic) ? res.resourceCharacteristic : [];
        const imsiCar = rc.find(c => c.name === "UDC_PRSSIMCD-imsi" || c.name === "UDC_SRV5GNE-imsi");
        const imsi = imsiCar && imsiCar.value ? imsiCar.value : null;
        return { fuente: "claro", estado, operationalState, mensaje: nota, imsi, raw: resp.cuerpo };
    }
}

/* ---------------------------------------------------------------------
   4 · CONSULTA TIGO (misma lógica que logica-qdn-tigo.js, versión ligera:
   solo extrae el RETCODE, no categoriza el perfil completo)
--------------------------------------------------------------------- */
function extraerRetcode(texto) {
    const m = String(texto || "").match(/RETCODE\s*=\s*(\d+)\s*(.*)/i);
    return m ? { retcode: m[1], retmsg: (m[2] || "").split(/\r?\n/)[0] } : { retcode: null, retmsg: "" };
}

const RETCODES_TIGO = { "0": "ACTIVA", "3001": "SIN_PERFIL", "1033": "RESIDUO_TIGO" };

/** Arma el valor `Linea` tal como lo espera Tigo (con indicativo 57). */
function lineaTigo(msisdn) { return msisdn.indexOf("57") === 0 ? msisdn : "57" + msisdn; }

async function consultarTigoUnaVez(linea, cfg) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    try {
        const r = await fetch(cfg.base_url, {
            method: "POST", signal: controlador.signal,
            headers: { "Content-Type": "application/json", "X-Api-Key": cfg.api_key },
            body: JSON.stringify({
                TransactionID: String(Date.now()) + Math.floor(Math.random() * 1000),
                FechaConsulta: new Date().toISOString(), Linea: linea
            })
        });
        const texto = await r.text();
        let cuerpo = null; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
        return { ok: r.ok, status: r.status, cuerpo, texto };
    } finally { clearTimeout(temporizador); }
}

async function consultarTigo(msisdn, cfg) {
    let intentos = 0;
    const linea = lineaTigo(msisdn);
    while (true) {
        intentos++;
        let resp;
        try { resp = await consultarTigoUnaVez(linea, cfg); }
        catch (e) {
            const esTimeout = e && e.name === "AbortError";
            if (esTimeout && intentos < cfg.reintentos + 1) continue;
            if (esTimeout) return { fuente: "tigo", estado: "TIMEOUT", mensaje: "Se agotaron los reintentos por timeout.", raw: null };
            return { fuente: "tigo", estado: "ERROR", mensaje: "Error de comunicación: " + (e.message || e), raw: null };
        }
        if (!resp.ok || !resp.cuerpo) return { fuente: "tigo", estado: "ERROR", mensaje: "HTTP " + resp.status, raw: resp.cuerpo || resp.texto };

        const perfil = resp.cuerpo.perfilHLR || "";
        const errores = Array.isArray(resp.cuerpo.error) ? resp.cuerpo.error : [];
        const { retcode, retmsg } = extraerRetcode(perfil || errores[0] || "");
        const estado = RETCODES_TIGO[retcode] || (retcode ? "ERROR_RETCODE" : "ERROR");
        // El categorizado completo del volcado vive en logica-qdn-tigo.js;
        // aquí solo se rescata el IMSI con una lectura ligera para el título.
        const imsiM = perfil.match(/\bIMSI\s*=\s*([^\r\n]+)/i);
        const imsi = imsiM ? imsiM[1].trim() : null;
        return { fuente: "tigo", estado, retcode, retmsg, mensaje: retmsg, imsi, raw: resp.cuerpo };
    }
}

/* ---------------------------------------------------------------------
   5 · CONCLUSIÓN (Claro / Tigo / Ninguno / No concluyente)
--------------------------------------------------------------------- */
function concluirUbicacion(claro, tigo) {
    const errClaro = claro.estado === "ERROR" || claro.estado === "TIMEOUT";
    const errTigo = tigo.estado === "ERROR" || tigo.estado === "ERROR_RETCODE" || tigo.estado === "TIMEOUT";
    if (errClaro && errTigo) return "NO_CONCLUYENTE";

    const enClaro = claro.estado === "ACTIVA";
    // 0 = perfil creado en el HLR de Tigo. 1033 = registro residual que Tigo
    // no depuró tras la portación a ME: también es presencia en Tigo, pero
    // no es un perfil utilizable, por eso no se mezcla con "Tigo".
    // 3001 (sin perfil) NO es presencia: cae a Claro o a Ninguno.
    const enTigo = tigo.estado === "ACTIVA";
    const residuoTigo = tigo.estado === "RESIDUO_TIGO";

    if (enClaro && enTigo) return "AMBOS";
    if (enClaro && residuoTigo) return "CLARO_RESIDUO";
    if (enClaro) return "CLARO";
    if (enTigo) return "TIGO";
    if (residuoTigo) return "RESIDUO_TIGO";
    if (errClaro || errTigo) return "NO_CONCLUYENTE";
    return "NINGUNO";
}

/** Ubicaciones que agrupa la tarjeta "Residuo en Tigo" (escalamiento a Tigo). */
const UBICACIONES_RESIDUO = ["RESIDUO_TIGO", "CLARO_RESIDUO"];

const ETIQUETA_UBICACION = {
    CLARO: "Claro", TIGO: "Tigo",
    RESIDUO_TIGO: "Residuo en Tigo (escalar)", CLARO_RESIDUO: "Claro + residuo en Tigo",
    AMBOS: "Ambos — revisar", NINGUNO: "Ninguno", NO_CONCLUYENTE: "No concluyente"
};
const ETIQUETA_CLARO = { ACTIVA: "Activa", INACTIVA: "Inactiva", ERROR: "Error", TIMEOUT: "Timeout" };
const ETIQUETA_TIGO = {
    ACTIVA: "Activa", SIN_PERFIL: "Sin perfil", RESIDUO_TIGO: "Residuo en Tigo",
    ERROR: "Error", ERROR_RETCODE: "Error (RETCODE)", TIMEOUT: "Timeout"
};

/* ---------------------------------------------------------------------
   6 · ENTRADA (pegar / CSV / Excel) — mismo patrón de los validadores QDN
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
   7 · CONCURRENCIA
--------------------------------------------------------------------- */
async function ejecutarPool(items, limite, worker) {
    let i = 0;
    const total = items.length;
    const n = Math.max(1, Math.min(limite || 5, total || 1));
    const ejecutores = Array.from({ length: n }, async () => {
        while (i < total) { const idx = i++; await worker(items[idx], idx); }
    });
    await Promise.all(ejecutores);
}

/* ---------------------------------------------------------------------
   8 · ESTADO / CONSULTA MASIVA
--------------------------------------------------------------------- */
let filas = [];
let dataTable = null;
let corriendo = false;
const filtros = { ubicacion: new Set() };

function filaInvalida(msisdn) {
    return { msisdn, ubicacion: "INVALID", claro: null, tigo: null, detalle: "MSISDN con formato inválido." };
}

function actualizarProgreso(hechas, total) {
    const wrap = MEUI.$("#progresoWrap");
    if (!wrap) return;
    wrap.style.display = total ? "" : "none";
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    MEUI.$("#progresoTexto").textContent = `Procesando: ${hechas} / ${total}`;
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

    filas = entrada.lineas.map(m => ({ msisdn: m, ubicacion: "EN_COLA", claro: null, tigo: null }));
    entrada.invalidas.forEach(v => filas.push(filaInvalida(v)));
    render();

    const concurrencia = Math.max(1, Math.min(15, Number(MEUI.$("#cfgConcurrencia").value) || 5));
    let hechas = 0, ultimoRender = 0;
    const total = entrada.lineas.length;
    const porMsisdn = new Map(filas.map(f => [f.msisdn, f]));

    await ejecutarPool(entrada.lineas, concurrencia, async (msisdn) => {
        const fila = porMsisdn.get(msisdn);
        fila.ubicacion = "PROCESSING";
        const [claro, tigo] = await Promise.all([
            consultarClaro(msisdn, cfgCruce.claro),
            consultarTigo(msisdn, cfgCruce.tigo)
        ]);
        fila.claro = claro; fila.tigo = tigo;
        fila.ubicacion = concluirUbicacion(claro, tigo);
        hechas++;
        actualizarProgreso(hechas, total);
        const ahora = performance.now();
        if (ahora - ultimoRender > 400 || hechas === total) { ultimoRender = ahora; render(); }
    });

    corriendo = false;
    if (btn) btn.disabled = false;
    render();

    const c = {};
    filas.forEach(f => { c[f.ubicacion] = (c[f.ubicacion] || 0) + 1; });
    MEUI.log(`Resultado — Total: ${filas.length}  ·  Claro: ${c.CLARO || 0}  ·  Tigo: ${c.TIGO || 0}  ·  ` +
        `Residuo en Tigo: ${(c.RESIDUO_TIGO || 0) + (c.CLARO_RESIDUO || 0)}  ·  Ninguno: ${c.NINGUNO || 0}  ·  ` +
        `Ambos: ${c.AMBOS || 0}  ·  No concluyente: ${c.NO_CONCLUYENTE || 0}`, "ok");
    MEUI.toast(`Consulta terminada: ${filas.length} líneas procesadas.`, "ok");
}

/* ---------------------------------------------------------------------
   9 · FILTROS Y KPIs
--------------------------------------------------------------------- */
function filaPasaFiltros(f) {
    if (filtros.ubicacion.size) {
        // "RESIDUO" agrupa los dos casos que se escalan a Tigo.
        const agrupado = filtros.ubicacion.has("RESIDUO")
            && UBICACIONES_RESIDUO.indexOf(f.ubicacion) >= 0;
        // "REVISAR" permite ver juntos los casos que requieren revision
        // manual, sin perder los filtros individuales del desplegable.
        const revisar = filtros.ubicacion.has("REVISAR")
            && (f.ubicacion === "AMBOS" || f.ubicacion === "NO_CONCLUYENTE");
        if (!agrupado && !revisar && !filtros.ubicacion.has(f.ubicacion)) return false;
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
    const cont = v => filas.filter(f => f.ubicacion === v).length;
    const valores = [...new Set(filas.map(f => f.ubicacion))].sort();
    const opciones = [["REVISAR", "Ambos / no concluyente", cont("AMBOS") + cont("NO_CONCLUYENTE")]]
        .concat(valores.map(v => [v, ETIQUETA_UBICACION[v] || v, cont(v)]));
    pintarFiltro(MEUI.$("#fUbicacion"), "ubicacion", opciones);
}

function actualizarKPIs() {
    const c = {};
    filas.forEach(f => { c[f.ubicacion] = (c[f.ubicacion] || 0) + 1; });
    MEUI.$("#kpiClaro").textContent = c.CLARO || 0;
    MEUI.$("#kpiTigo").textContent = c.TIGO || 0;
    MEUI.$("#kpiResiduoTigo").textContent = (c.RESIDUO_TIGO || 0) + (c.CLARO_RESIDUO || 0);
    MEUI.$("#kpiNinguno").textContent = c.NINGUNO || 0;
    MEUI.$("#kpiRevisar").textContent = (c.AMBOS || 0) + (c.NO_CONCLUYENTE || 0);
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
   10 · TABLA
--------------------------------------------------------------------- */
function celdaUbicacion(f) {
    const cls = { CLARO: "info", TIGO: "ok", RESIDUO_TIGO: "warn", CLARO_RESIDUO: "warn", AMBOS: "warn",
        NINGUNO: "off", NO_CONCLUYENTE: "err", INVALID: "err", EN_COLA: "neutro", PROCESSING: "info" }[f.ubicacion] || "neutro";
    const texto = ETIQUETA_UBICACION[f.ubicacion] || f.ubicacion;
    return `<span class="badge-estado ${cls}">${MEUI.esc(texto)}</span>`;
}
function celdaCarrier(r, etiquetas) {
    if (!r) return "—";
    const cls = { ACTIVA: "ok", INACTIVA: "off", SIN_PERFIL: "off", RESIDUO_TIGO: "warn",
        ERROR: "err", ERROR_RETCODE: "err", TIMEOUT: "warn" }[r.estado] || "neutro";
    return `<span class="badge-estado ${cls}">${MEUI.esc(etiquetas[r.estado] || r.estado)}</span>`;
}

function construirDataTable() {
    dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
        data: [],
        columns: [
            { data: "msisdn", title: "MSISDN", render: v => `<span class="me-mono">${MEUI.esc(v)}</span>` },
            { data: null, title: "Ubicación", render: f => celdaUbicacion(f) },
            { data: null, title: "Claro", render: f => celdaCarrier(f.claro, ETIQUETA_CLARO) },
            { data: null, title: "Tigo", render: f => celdaCarrier(f.tigo, ETIQUETA_TIGO) },
            { data: null, title: "RETCODE Tigo", render: f => MEUI.esc((f.tigo && f.tigo.retcode) || "—") },
            {
                data: null, title: "Detalle", orderable: false, className: "col-accion",
                render: f => `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                    title="Ver detalle completo">👁</button>`
            }
        ]
    }));
    dataTable.on("click", "button.btn-detalle", function (e) { e.stopPropagation(); abrirDetalle(this.dataset.msisdn); });
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
    MEUI.mostrarSiHayDatos("#tablaResultados", { vacio: "#msgVacio", tabla: dataTable });
    MEUI.resumenPaso(2, filas.length ? `${filas.length} líneas consultadas` : "");
    MEUI.ajustarTablas();
}

/* ---------------------------------------------------------------------
   11 · MODAL DE DETALLE (resumen + JSON crudo de cada operador)
--------------------------------------------------------------------- */
function filaDe(msisdn) { return filas.find(f => f.msisdn === msisdn); }

function abrirDetalle(msisdn) {
    const f = filaDe(msisdn);
    if (!f) return;
    MEUI.$("#mdMsisdn").textContent = f.msisdn;
    const imsi = (f.claro && f.claro.imsi) || (f.tigo && f.tigo.imsi) || "—";
    MEUI.$("#mdImsi").textContent = imsi;

    MEUI.$("#mdResumen").innerHTML = `
        <div class="d-flex flex-wrap gap-3 align-items-center">
            <span class="badge-estado info">${MEUI.esc(ETIQUETA_UBICACION[f.ubicacion] || f.ubicacion)}</span>
            <span>Claro: ${celdaCarrier(f.claro, ETIQUETA_CLARO)}</span>
            <span>Tigo: ${celdaCarrier(f.tigo, ETIQUETA_TIGO)}</span>
        </div>
        ${f.detalle ? `<div class="me-hint mt-2">${MEUI.esc(f.detalle)}</div>` : ""}`;

    const resumenLado = (r, etiquetas) => {
        if (!r) return `<p class="me-hint">Sin datos.</p>`;
        return `<dl class="dl-grid mb-2">
            <dt>Estado</dt><dd>${MEUI.esc(etiquetas[r.estado] || r.estado)}</dd>
            ${r.mensaje ? `<dt>Mensaje</dt><dd>${MEUI.esc(r.mensaje)}</dd>` : ""}
            ${r.retcode ? `<dt>RETCODE</dt><dd>${MEUI.esc(r.retcode)}</dd>` : ""}
        </dl>`;
    };
    MEUI.$("#mdClaroResumen").innerHTML = resumenLado(f.claro, ETIQUETA_CLARO);
    MEUI.$("#mdTigoResumen").innerHTML = resumenLado(f.tigo, ETIQUETA_TIGO);
    MEUI.$("#mdClaroJson").textContent = f.claro && f.claro.raw ? JSON.stringify(f.claro.raw, null, 2) : "(sin respuesta)";
    MEUI.$("#mdTigoJson").textContent = f.tigo && f.tigo.raw ? JSON.stringify(f.tigo.raw, null, 2) : "(sin respuesta)";

    new bootstrap.Modal("#modalDetalle").show();
}

/* ---------------------------------------------------------------------
   12 · EXPORTACIÓN
--------------------------------------------------------------------- */
const CABECERA_EXPORT = ["MSISDN", "Ubicación", "Estado Claro", "Estado Tigo", "RETCODE Tigo", "Mensaje Tigo"];

function filasExport() {
    const rows = filas.filter(filaPasaFiltros).map(f => [
        f.msisdn, ETIQUETA_UBICACION[f.ubicacion] || f.ubicacion,
        f.claro ? (ETIQUETA_CLARO[f.claro.estado] || f.claro.estado) : "",
        f.tigo ? (ETIQUETA_TIGO[f.tigo.estado] || f.tigo.estado) : "",
        (f.tigo && f.tigo.retcode) || "", (f.tigo && f.tigo.retmsg) || ""
    ]);
    return { head: CABECERA_EXPORT, rows };
}

function filasParaExportar() {
    return filas.filter(filaPasaFiltros).map(f => ({
        msisdn: f.msisdn, ubicacion: ETIQUETA_UBICACION[f.ubicacion] || f.ubicacion,
        claro: f.claro, tigo: f.tigo
    }));
}

/* ---------------------------------------------------------------------
   13 · CARGA DE ARCHIVO (Excel / CSV) — mismo patrón de los validadores QDN
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
   14 · INICIALIZACIÓN
--------------------------------------------------------------------- */
function inicializarCruce() {
    MEUI.$("#btnConsultar").addEventListener("click", consultar);
    MEUI.$("#btnLimpiarFiltros").addEventListener("click", limpiarFiltros);
    MEUI.$$(".me-kpi.kpi-click").forEach(k => k.addEventListener("click", () => alternarKpi(k)));

    configurarArchivo();
    render();
}
inicializarCruce();
