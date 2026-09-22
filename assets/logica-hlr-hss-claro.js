/* =====================================================================
   logica-hlr-hss-claro.js · Motor "Claro" de la pestaña HLR/HSS
   ---------------------------------------------------------------------
   Copia envuelta de logica-qdn.js + logica-qdn-operaciones.js (Validador
   QDN · Claro), SIN TOCAR una sola linea de sus reglas de negocio ni de
   las operaciones de escritura (bloqueo/desbloqueo/conciliacion/
   cambio de IMSI-ICCID-KI/cambio de MSISDN/larga distancia).

   Van en el MISMO IIFE (un solo cierre compartido), no en dos separados:
   logica-qdn-operaciones.js referencia directamente variables de
   logica-qdn.js (gestorQdn, cfgQdn, evaluarNegocio, filas,
   filaPasaFiltros, consultarConReintentos, ejecutarPool, render,
   filaDe, datosArchivo) por nombre suelto, exactamente como hacian
   cuando eran dos <script> separados en la pagina original. Separarlos
   en dos IIFE distintos habria roto ese acople sin tocar la logica; UN
   cierre compartido lo preserva intacto.

   Se exponen filasExport/filasParaExportar (botones de exportacion) y
   gestorQdn (para poder resetear el token al cerrar la sesion QDN desde
   la cabecera): el puente vive FUERA del IIFE y no puede verlos si no
   se publican aqui.

   Si cambia algo aqui, revisa tambien logica-qdn.js /
   logica-qdn-operaciones.js, que son la fuente real de este archivo
   (este se regenera concatenando esos dos, ver el historial de chat).
===================================================================== */
(function () {
"use strict";
/* =====================================================================
   logica-qdn.js · Validador HLR/HSS · QDN Móvil Éxito - Claro
   ---------------------------------------------------------------------
   Reglas de negocio de esta herramienta. QDN habla con SU PROPIO servicio
   OAuth2 (el mismo que usan interfaz.py / main.py de consultar-qdn), NO con
   el Keycloak del CM que usa assets/me-api.js: por eso esta herramienta trae
   su propio gestor de token en vez de reusar MEAPI.

   La consulta QDN solo está confirmada contra PDN (así lo indica el equipo);
   el ambiente queda fijo en PDN con los mismos valores que interfaz.py.
===================================================================== */

/* ---------------------------------------------------------------------
   1 · AMBIENTE Y RUTA QDN (mismos valores que interfaz.py / main.py)
--------------------------------------------------------------------- */
const AMBIENTE_QDN = {
    etiqueta: "PDN - Producción",
    token_url: "https://apim.claro.com.co/MsCommunicatAuthToken/User/authenticate",
    client_id: "MOVILEXITO",
    client_secret: "ebaee6c9-513b-4ee6-abc4-c88924006bb8",
    base_apigw: "https://msapigateway-nm-apigateway-aro-prod.apps.prd-claro-co.eastus2.aroapp.io",
    auth_en_cuerpo: true,
    api_usuario: "exitoapi",
    api_clave: "exitoapi"
};
const RUTA_QDN = "/APIMParOrdeConsQDN/MS/CUS/Customer/RSParOrdeConsQDN/V1/ValideQDN/";

const cfgQdn = Object.assign({}, AMBIENTE_QDN, {
    timeoutMs: 30000,
    reintentos: 2,          // hasta 2 reintentos adicionales (3 intentos totales)
    concurrencia: 8         // RN08: máximo operativo recomendado
});

/* ---------------------------------------------------------------------
   2 · TOKEN OAuth2 (mismas estrategias que GestorToken de interfaz.py)
--------------------------------------------------------------------- */
const gestorQdn = {
    token: null, exp: 0, renovando: null,

    intentos(cfg) {
        const basic = btoa(`${cfg.client_id}:${cfg.client_secret}`);
        const form = { "Content-Type": "application/x-www-form-urlencoded" };
        const enCuerpo = ["client_credentials en el cuerpo", {
            headers: form,
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: cfg.client_id, client_secret: cfg.client_secret
            })
        }];
        const enCabecera = ["Basic + client_credentials", {
            headers: Object.assign({}, form, { Authorization: "Basic " + basic }),
            body: new URLSearchParams({ grant_type: "client_credentials" })
        }];
        const lista = [];
        if (cfg.auth_en_cuerpo) { lista.push(enCuerpo, enCabecera); }
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
                    grant_type: "password", client_id: cfg.client_id,
                    client_secret: cfg.client_secret,
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
        const llaves = ["access_token", "accessToken", "token", "id_token", "jwt",
            "access_Public", "api_request"];
        if (typeof obj === "object" && !Array.isArray(obj)) {
            for (const k of llaves) {
                if (typeof obj[k] === "string" && obj[k].length > 20) return obj[k];
            }
            for (const v of Object.values(obj)) {
                const r = this.extraerToken(v, profundidad + 1);
                if (r) return r;
            }
        } else if (Array.isArray(obj)) {
            for (const v of obj) {
                const r = this.extraerToken(v, profundidad + 1);
                if (r) return r;
            }
        }
        return null;
    },

    async solicitar(cfg) {
        let ultimo = null;
        for (const [nombre, opts] of this.intentos(cfg)) {
            try {
                const r = await fetch(cfg.token_url, Object.assign({ method: "POST" }, opts));
                let cuerpo;
                const texto = await r.text();
                try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { cuerpo = texto; }
                if (r.ok) {
                    const token = typeof cuerpo === "string" ? cuerpo : this.extraerToken(cuerpo);
                    if (token) {
                        this.token = token;
                        const vida = (cuerpo && cuerpo.expires_in) ? Number(cuerpo.expires_in) : 1500;
                        this.exp = Date.now() + Math.max(30, vida - 30) * 1000;
                        MEUI.log(`✔ Token QDN obtenido (${nombre}).`, "ok");
                        return token;
                    }
                    ultimo = nombre + ": respuesta 200 sin token";
                } else {
                    ultimo = nombre + `: HTTP ${r.status} — ${String(texto).slice(0, 160)}`;
                }
            } catch (e) { ultimo = nombre + ": " + e.message; }
        }
        throw new Error("No se pudo obtener el token QDN. Último error → " + ultimo);
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
   3 · CATÁLOGO DE BLOQUEOS Y CATEGORIZACIÓN (sección 15-16-22 de la HU)
--------------------------------------------------------------------- */
// Valor QDN -> interpretación (CA11/CA12/CA13). "0" y "Ninguno" también se
// tratan como "sin bloqueo": así vienen algunos campos de roaming (odb*).
const SIN_BLOQUEO_MARCAS = new Set(["No Registra", "", "0", "Ninguno", null, undefined]);
function interpretarBloqueo(valor) {
    if (valor === "4") return "ACTIVO";
    if (valor === "5") return "HISTORICO";
    if (SIN_BLOQUEO_MARCAS.has(valor)) return "SIN_BLOQUEO";
    return "OTRO"; // código no documentado por la HU: se muestra pero no se cuenta como activo
}

// name -> { etiqueta, grupo } para las características de bloqueo/restricción
// que la HU pide identificar explícitamente (sección 16).
const CATALOGO_BLOQUEOS = {
    "UDC_BLQINCLL-status": { etiqueta: "Llamadas entrantes", grupo: "Nacional" },
    "UDC_BLQOUTCL-status": { etiqueta: "Llamadas salientes", grupo: "Nacional" },
    "UDC_BRRSMS-status": { etiqueta: "SMS", grupo: "Nacional" },
    "UDC_SRVSMSFL-status": { etiqueta: "SMS (perfil)", grupo: "Nacional" },
    "UDC_BRRIDVOZ-clir": { etiqueta: "Identificador de llamadas", grupo: "Nacional" },
    "UDC_BRRLDIFL-osb4": { etiqueta: "LDI total", grupo: "Nacional" },
    "UDC_SRVLDIFL-osb4": { etiqueta: "LDI total", grupo: "Nacional" },
    "UDC_BRRLDIMA-osb1": { etiqueta: "LDI otros indicativos", grupo: "Nacional" },
    "UDC_BRRLDINF-osb2": { etiqueta: "LDI 444 (Infracel)", grupo: "Nacional" },
    "UDC_BRRLDI-osb3": { etiqueta: "LDI sin implementación de red", grupo: "Nacional" },
    "UDC_SRVVIDLL-status_BAIC": { etiqueta: "Video llamada entrante", grupo: "Nacional" },
    "UDC_SRVVIDLL-status_BAOC": { etiqueta: "Video llamada saliente", grupo: "Nacional" },

    "UDC_SRVINTPRE-odbgprs": { etiqueta: "Servicio de datos (GPRS)", grupo: "Datos" },
    "UDC_SRVINTPRE-obGprs": { etiqueta: "Restricción GPRS", grupo: "Datos" },
    "UDC_SRVINTPRE-sgsnAreaRestRcvd": { etiqueta: "Restricciones SGSN", grupo: "Datos" },
    "UDC_SRVINTPRE-sr": { etiqueta: "Redes de otros operadores (datos)", grupo: "Datos" },

    "UDC_SRVROAM-odbBaroam": { etiqueta: "Restricción general de roaming", grupo: "Roaming" },
    "UDC_SRVROAM-odbr": { etiqueta: "Restricción de roaming", grupo: "Roaming" },
    "UDC_SRVROAM-odbic": { etiqueta: "Llamadas entrantes en roaming", grupo: "Roaming" },
    "UDC_SRVROAM-odboc": { etiqueta: "Llamadas salientes en roaming", grupo: "Roaming" },
    "UDC_SRVROAM-sr": { etiqueta: "Redes de otros operadores (roaming)", grupo: "Roaming" },
    "UDC_SRVROAM-odbsci": { etiqueta: "Cambios de desvío en roaming", grupo: "Roaming" },

    "UDC_SRVBSVOZ-ts10BarrByCb": { etiqueta: "Voz (VLR)", grupo: "VLR" },
    "UDC_SRVBSVOZ-ts20BarrByCb": { etiqueta: "SMS (VLR)", grupo: "VLR" },
    "UDC_SRVBSVOZ-ts60BarrByCb": { etiqueta: "Fax (VLR)", grupo: "VLR" },
    "UDC_SRVBSVOZ-bs20BarrByCb": { etiqueta: "Datos asíncronos (VLR)", grupo: "VLR" },
    "UDC_SRVBSVOZ-bs30BarrByCb": { etiqueta: "Datos síncronos (VLR)", grupo: "VLR" },
    "UDC_SRVBSVOZ-bs40BarrByCb": { etiqueta: "Acceso PAD (VLR)", grupo: "VLR" }
};

// Suffijos de UDC_SRVBSVOZ- que son servicio de telefonía (el resto de ese
// mismo prefijo cae en VLR/MSC: comparten prefijo pero no significado).
const BSVOZ_TELEFONIA = new Set(["bcieID", "csiState", "imsiActive", "operatorServiceName",
    "ucsiserv", "msisdn"]);

function sufijo(name) {
    const i = name.indexOf("-");
    return i >= 0 ? name.slice(i + 1) : name;
}

/** Devuelve la categoría (sección 22 de la HU) para una característica. */
function categoriaDe(name, friendlyName) {
    if (name === "UDC") return "identidad";               // nota UDC-xxxx del servicio
    if (CATALOGO_BLOQUEOS[name]) return "bloqueos";
    if (name.indexOf("TITAN_SRVVOLTE-") === 0) return "volte";
    if (name.indexOf("STP_STPSUB-") === 0) return "portabilidad";
    if (name.indexOf("COTA_PRSSIMCD-") === 0) return "cota";
    if (name.indexOf("UDC_SRVROAM-") === 0) return "roaming";
    if (name.indexOf("UDC_SRVAVM-") === 0) return "desvios";
    if (name.indexOf("UDC_BLQ") === 0 || name.indexOf("UDC_BRR") === 0) return "bloqueos";
    if (name.indexOf("UDC_SRVBSVOZ-") === 0) {
        return BSVOZ_TELEFONIA.has(sufijo(name)) ? "servicios" : "vlr";
    }
    if (name.indexOf("UDC_SRVROUT-") === 0) return "vlr";
    if (name.indexOf("UDC_SRVCWA-") === 0) return "servicios";
    if (name.indexOf("UDC_SRVVIDLL-") === 0) return "servicios";
    if (name.indexOf("UDC_SRVSMSFL-") === 0) return "servicios";
    if (name.indexOf("UDC_SRVSIDVZ-") === 0) return "servicios";
    if (name.indexOf("UDC_SRVTRLLA-") === 0) return "servicios";
    if (name.indexOf("UDC_SRVACWI-") === 0 || name.indexOf("UDC_SRVRBT-") === 0 ||
        name.indexOf("UDC_SRVPMT-") === 0 || name.indexOf("UDC_SRVFRDPR-") === 0) return "servicios";
    if (name.indexOf("UDC_SRV5GNE-") === 0) return "servicios";
    if (name.indexOf("UDC_PRSSIMCD-") === 0) return "identidad";
    if (name.indexOf("UDC_PFAPNPRV-") === 0 || name.indexOf("UDC_SRVCTMMS-") === 0 ||
        name.indexOf("UDC_SRVVVM-") === 0 || name.indexOf("UDC_SRVINT-") === 0) return "datos";
    if (name.indexOf("UDC_SRVINTPRE-") === 0) return "datos";
    return "otros";
}

const NOMBRES_CATEGORIA = {
    identidad: "Identidad", servicios: "Servicios", bloqueos: "Bloqueos",
    datos: "Datos / Internet", roaming: "Roaming", desvios: "Desvíos",
    vlr: "VLR / MSC", volte: "VoLTE", portabilidad: "Portabilidad",
    cota: "COTA", otros: "Otros"
};
const ORDEN_CATEGORIAS = ["identidad", "servicios", "bloqueos", "datos", "roaming",
    "desvios", "vlr", "volte", "portabilidad", "cota", "otros"];

/* ---------------------------------------------------------------------
   4 · PARSEO DEL RESPONSE (secciones 3, 11-20, 32)
--------------------------------------------------------------------- */
function buscarCaracteristica(lista, name) {
    const f = lista.find(c => c.name === name);
    return f ? f.value : null;
}

/**
 * Valor tal como lo reportó el HLR.
 *   · Si la característica NO vino en el response  -> "—" (no hay dato).
 *   · Si vino con el texto "No Registra"           -> se muestra "No Registra".
 * La diferencia importa: "No Registra" es una afirmación del HLR; "—" es
 * ausencia de información y no se debe presentar como si fuera un dato.
 */
function valorHLR(v) {
    return (v === null || v === undefined || v === "") ? "—" : String(v);
}

/**
 * Éxito REAL leyendo el cuerpo, no el HTTP: mismo criterio que
 * evaluar_negocio()/_recorrer() de interfaz.py. Un HTTP 200 con
 * responseCode>=400, success:false o un objeto `error` con contenido
 * NO es una consulta exitosa.
 */
function evaluarNegocio(cuerpo) {
    const hall = { fallo: false, codigo: null, codigoMsg: null, detalle: null };
    const vacio = v => v === null || v === undefined || v === ""
        || (Array.isArray(v) && !v.length)
        || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

    (function recorrer(obj, enError) {
        if (obj === null || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(v => recorrer(v, enError)); return; }

        if (obj.success === false) hall.fallo = true;
        ["statusCode", "responseCode"].forEach(k => {
            const n = parseInt(obj[k], 10);
            if (!isNaN(n) && n >= 400) {
                hall.fallo = true;
                if (hall.codigo === null) hall.codigo = n;
            }
        });

        Object.keys(obj).forEach(k => {
            const v = obj[k];
            const hijoError = enError || k === "error";
            if (k === "error" && !vacio(v)) hall.fallo = true;
            if (hijoError && (k === "message" || k === "description")
                && typeof v === "string" && !hall.detalle) hall.detalle = v;
            if (hijoError && k === "messageCode" && typeof v === "string"
                && !hall.codigoMsg) hall.codigoMsg = v;
            recorrer(v, hijoError);
        });
    })(cuerpo, false);

    return { ok: !hall.fallo, codigo: hall.codigo, codigoMsg: hall.codigoMsg, detalle: hall.detalle };
}

function friendlyDeDesvio(status) {
    return status && status !== "No Registra" ? "Activo" : (status ? status : "—");
}

function textoPortabilidad(pt) {
    if (pt === "0") return "Número nativo del operador";
    if (pt === "1") return "Número en otro operador (portado)";
    if (pt === null || pt === undefined || pt === "No Registra") return "—";
    return "PT " + pt;
}

/** Convierte el response crudo de QDN en la fila que consume la tabla y el detalle. */
function procesarRespuestaQDN(msisdn, datos, meta) {
    const res = (datos && datos.result) || {};
    const rc = Array.isArray(res.resourceCharacteristic) ? res.resourceCharacteristic : [];

    // Nota especial "UDC" (p. ej. "UDC-3503 ... was not found in the Database").
    const notaUDC = rc.find(c => c.name === "UDC");

    // ---- categorización completa: no se asume que 'name' es único --------
    const categorias = {};
    ORDEN_CATEGORIAS.forEach(c => { categorias[c] = []; });
    rc.forEach(c => {
        const cat = categoriaDe(c.name, c.friendly_name);
        categorias[cat].push({ name: c.name, friendly: c.friendly_name || "", valor: c.value });
    });

    // ---- bloqueos: activos / históricos / otros ---------------------------
    // `bloqueosEvaluados` distingue "no hay bloqueos" (se revisaron y están
    // limpios) de "no se pudo revisar" (la línea no trajo ninguna
    // característica de bloqueo, p. ej. porque está inactiva o no existe).
    let bloqueosEvaluados = false;
    const bloqueosActivos = [], bloqueosHistoricos = [], bloqueosOtros = [];
    Object.entries(CATALOGO_BLOQUEOS).forEach(([name, info]) => {
        const c = rc.find(x => x.name === name);
        if (!c) return;
        bloqueosEvaluados = true;
        const estado = interpretarBloqueo(c.value);
        const item = { name, etiqueta: info.etiqueta, grupo: info.grupo, valor: c.value, estado };
        if (estado === "ACTIVO") bloqueosActivos.push(item);
        else if (estado === "HISTORICO") bloqueosHistoricos.push(item);
        else if (estado === "OTRO") bloqueosOtros.push(item);
    });

    // ---- resumen para la tabla (columnas de la sección 10) -----------------
    const imsi = buscarCaracteristica(rc, "UDC_PRSSIMCD-imsi") || buscarCaracteristica(rc, "UDC_SRV5GNE-imsi");
    const imei = buscarCaracteristica(rc, "UDC_PRSSIMCD-imeisv");
    // El ICCID no se muestra en la tabla: lo necesita el proceso de
    // conciliación (logica-qdn-operaciones.js) para armar el PATCH.
    const iccid = buscarCaracteristica(rc, "COTA_PRSSIMCD-iccid");
    const estadoImsi = buscarCaracteristica(rc, "UDC_SRVBSVOZ-imsiActive")
        || (buscarCaracteristica(rc, "UDC_PRSSIMCD-isActiveIMSI") === "true" ? "Activa" : null);
    const cincoG = buscarCaracteristica(rc, "UDC_SRV5GNE-supportNewRadioSecondaryRAT");
    const telefonia = buscarCaracteristica(rc, "UDC_SRVBSVOZ-bcieID");
    const smsEnvio = buscarCaracteristica(rc, "UDC_SRVSMSFL-TS22");
    const smsRecep = buscarCaracteristica(rc, "UDC_SRVSMSFL-TS21");
    const datosServ = buscarCaracteristica(rc, "UDC_SRVINTPRE-msisdn"); // friendly_name real: "SERVICIO DE DATOS"
    const roamGeneral = buscarCaracteristica(rc, "UDC_SRVROAM-odbBaroam") || buscarCaracteristica(rc, "UDC_SRVROAM-odbr");
    const desvioStatus = buscarCaracteristica(rc, "UDC_SRVAVM-status");
    const desvioTipo = buscarCaracteristica(rc, "UDC_SRVAVM-replaceCFConditional");
    const apn = buscarCaracteristica(rc, "UDC_PFAPNPRV-apn");
    const ip = buscarCaracteristica(rc, "UDC_PFAPNPRV-ipv4Address");
    const ipTipo = buscarCaracteristica(rc, "UDC_PFAPNPRV-typeip");
    const pt = buscarCaracteristica(rc, "STP_STPSUB-pt");

    const operationalState = (res.operationalState || "").toLowerCase();

    // ---- coherencia de la respuesta ---------------------------------------
    // El QDN devuelve en result.id la línea consultada. Si no coincide con lo
    // que se pidió, la respuesta no corresponde a esta línea y no se puede
    // presentar su contenido como si fuera de ella.
    const inconsistencias = [];
    const idDevuelto = soloDigitos(res.id);
    if (idDevuelto && !idDevuelto.endsWith(soloDigitos(msisdn))) {
        inconsistencias.push(`El servicio respondió por la línea ${res.id}, no por ${msisdn}.`);
    }
    if (!operationalState) {
        inconsistencias.push("La respuesta no trae operationalState.");
    }

    return {
        msisdn,
        estadoProceso: inconsistencias.length ? "INCONSISTENTE" : "SUCCESS",
        inconsistencias,
        bloqueosEvaluados,
        intentos: meta.intentos, ms: meta.ms,
        httpStatus: meta.httpStatus,
        responseCode: datos.responseCode, messageCode: datos.messageCode,
        message: datos.message, legacy: datos.legacy,
        transactionId: datos.transactionId, timestamp: datos.timestamp,
        operationalState,
        resourceId: res.id, resourceType: res["@type"], resourceCategory: res.category,
        resourceDescripcion: res.description, startOperatingDate: res.startOperatingDate,
        notaUDC: notaUDC ? (notaUDC.friendly_name || notaUDC.value) : null,
        notas: Array.isArray(res.note) ? res.note.map(n => n.text).filter(Boolean) : [],

        resumen: {
            imsi: valorHLR(imsi), imei: valorHLR(imei), iccid: valorHLR(iccid),
            estadoImsi: valorHLR(estadoImsi),
            cincoG: (cincoG === null || cincoG === undefined) ? "—"
                : (cincoG === "true" || cincoG === true) ? "Sí"
                    : (cincoG === "false" || cincoG === false) ? "No" : String(cincoG),
            telefonia: valorHLR(telefonia),
            sms: (smsEnvio === "Activo" && smsRecep === "Activo") ? "Activo"
                : valorHLR(smsEnvio || smsRecep),
            datos: valorHLR(datosServ),
            // Coherente con la columna Bloqueos: si hay restricciones activas
            // del grupo Roaming no se puede decir "sin restricción" aunque el
            // barring general (odbBaroam) venga en "Ninguno".
            roaming: (() => {
                const roam = bloqueosActivos.filter(b => b.grupo === "Roaming");
                if (roam.length) return `⚠ ${roam.length} restricción${roam.length > 1 ? "es" : ""} de roaming`;
                if (roamGeneral === null || roamGeneral === undefined) return "—";
                return SIN_BLOQUEO_MARCAS.has(roamGeneral) ? "Sin restricción" : roamGeneral;
            })(),
            desvio: valorHLR(desvioStatus), desvioTipo: valorHLR(desvioTipo),
            apn: valorHLR(apn),
            ip: valorHLR(ip !== null && ip !== undefined && ip !== "No Registra" ? ip : (ip === null ? ipTipo : ip)),
            portabilidad: textoPortabilidad(pt)
        },

        bloqueosActivos, bloqueosHistoricos, bloqueosOtros,
        categorias,
        raw: datos
    };
}

function filaError(msisdn, estadoProceso, detalle, meta) {
    return {
        msisdn, estadoProceso, detalle: detalle || "", sel: false,
        intentos: (meta && meta.intentos) || 0, ms: (meta && meta.ms) || null,
        httpStatus: meta && meta.httpStatus,
        resumen: {}, bloqueosActivos: [], bloqueosHistoricos: [], bloqueosOtros: [],
        categorias: {}, raw: (meta && meta.raw) || null
    };
}

/* ---------------------------------------------------------------------
   5 · ENTRADA: MSISDN individual y masivo (sección 4-5)
--------------------------------------------------------------------- */
function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }

/** Separa por salto de línea, coma, punto y coma o tabulación (sección 4.2-A). */
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

/* ---------------------------------------------------------------------
   6 · CONCURRENCIA, TIMEOUT Y REINTENTOS (secciones 6-9, 27-29)
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

async function consultarUnaVez(msisdn, cfg, token) {
    const url = cfg.base_apigw.replace(/\/$/, "") + RUTA_QDN + msisdn;
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    const t0 = performance.now();
    try {
        const r = await fetch(url, {
            method: "GET", signal: controlador.signal,
            headers: {
                "Accept": "application/json",
                "Authorization": "Bearer " + token,
                "transactionId": (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
            }
        });
        const ms = Math.round(performance.now() - t0);
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta no JSON */ }
        return { ok: r.ok, status: r.status, cuerpo, texto, ms };
    } finally {
        clearTimeout(temporizador);
    }
}

/** Consulta con hasta cfg.reintentos reintentos ADICIONALES, solo por timeout (sección 28). */
async function consultarConReintentos(msisdn, cfg) {
    let intentos = 0;
    let ultimoErrorConexion = null;
    let tokenRenovado = false;

    while (true) {
        intentos++;
        let token;
        try {
            token = await gestorQdn.obtener(cfg);
        } catch (e) {
            return filaError(msisdn, "ERROR", "No se pudo autenticar: " + e.message, { intentos });
        }

        let resp;
        try {
            resp = await consultarUnaVez(msisdn, cfg, token);
        } catch (e) {
            const esTimeout = e && e.name === "AbortError";
            // cfg.reintentos + 1 = intentos totales permitidos (1 inicial + N reintentos).
            if (esTimeout && intentos < cfg.reintentos + 1) continue; // retry solo por timeout
            if (esTimeout) return filaError(msisdn, "TIMEOUT", "Se agotaron los reintentos por timeout.", { intentos });
            ultimoErrorConexion = e.message || String(e);
            return filaError(msisdn, "ERROR", "Error de comunicación: " + ultimoErrorConexion, { intentos });
        }

        // 401/403: el token venció -> se renueva UNA vez y se repite sin gastar reintento.
        if ((resp.status === 401 || resp.status === 403) && !tokenRenovado) {
            tokenRenovado = true;
            gestorQdn.reset();
            intentos--; // no cuenta como intento fallido
            continue;
        }

        if (!resp.ok) {
            // Errores funcionales (400/401/403/404/5xx): NO se reintentan (sección 28).
            const msg = (resp.cuerpo && (resp.cuerpo.message || resp.cuerpo.messageCode))
                || (resp.texto || "").slice(0, 200) || ("HTTP " + resp.status);
            return filaError(msisdn, "ERROR", msg, { intentos, httpStatus: resp.status, raw: resp.cuerpo });
        }

        // El éxito real no es el HTTP 200: se evalúa el cuerpo (misma regla
        // que evaluar_negocio() de interfaz.py).
        const negocio = evaluarNegocio(resp.cuerpo);
        if (!negocio.ok) {
            const partes = [];
            if (negocio.codigo) partes.push("código " + negocio.codigo);
            if (negocio.codigoMsg) partes.push(negocio.codigoMsg);
            if (negocio.detalle) partes.push(negocio.detalle);
            return filaError(msisdn, "ERROR",
                `HTTP ${resp.status}, pero el cuerpo reporta fallo` +
                (partes.length ? ": " + partes.join(" · ") : "."),
                { intentos, httpStatus: resp.status, raw: resp.cuerpo });
        }

        if (!resp.cuerpo || !resp.cuerpo.result || !Array.isArray(resp.cuerpo.result.resourceCharacteristic)) {
            return filaError(msisdn, "ERROR",
                "La respuesta no tiene la estructura esperada (result.resourceCharacteristic).",
                { intentos, httpStatus: resp.status, raw: resp.cuerpo });
        }

        return procesarRespuestaQDN(msisdn, resp.cuerpo, { intentos, ms: resp.ms, httpStatus: resp.status });
    }
}

/* ---------------------------------------------------------------------
   7 · ESTADO DE LA HERRAMIENTA
--------------------------------------------------------------------- */
let filas = [];                 // resultado consolidado, en el orden de entrada
let dataTable = null;
let corriendo = false;
let cancelar = false;
const filtros = { estado: new Set(), bloqueo: new Set(), cincoG: new Set(), roaming: new Set(), proceso: new Set() };
const columnas = ["msisdn", "estado", "imsi", "imei", "cincoG", "telefonia", "sms",
    "datos", "roaming", "bloqueos", "desvio", "apn", "ip", "portabilidad", "detalle"];
const ETIQUETA_COLUMNA = {
    msisdn: "MSISDN", estado: "Estado", imsi: "IMSI", imei: "IMEI", cincoG: "5G",
    telefonia: "Telefonía", sms: "SMS", datos: "Datos", roaming: "Roaming",
    bloqueos: "Bloqueos", desvio: "Desvío", apn: "APN", ip: "IP",
    portabilidad: "Portabilidad", detalle: "Detalle"
};
const columnasOcultas = new Set();

/* ---------------------------------------------------------------------
   8 · DERIVADOS POR FILA (estado de tabla, texto de bloqueos)
--------------------------------------------------------------------- */
function estadoTabla(f) {
    if (f.estadoProceso !== "SUCCESS") return f.estadoProceso; // TIMEOUT | ERROR | INVALID | PENDING | PROCESSING
    return (f.operationalState || "desconocido").toUpperCase();
}

function textoBloqueos(f) {
    // Sin características de bloqueo en el response no se puede afirmar que la
    // línea está limpia: se dice "Sin datos", no "Sin bloqueos".
    if (!f.bloqueosEvaluados) return "Sin datos";
    const n = (f.bloqueosActivos || []).length;
    return n ? `⚠ ${n} bloqueo${n > 1 ? "s" : ""} activo${n > 1 ? "s" : ""}` : "Sin bloqueos";
}

/* ---------------------------------------------------------------------
   9 · CONSULTA INDIVIDUAL Y MASIVA (secciones 4, 25, 26)
--------------------------------------------------------------------- */
let lineasArchivo = null; // lo llena configurarArchivo() al leer Excel/CSV: mismo formato que parseMsisdns()

/**
 * MSISDN -> { imsi, iccid, ki } tomados de columnas OPCIONALES del archivo.
 * Solo lo consumen las operaciones de provisión (logica-qdn-operaciones.js):
 * la consulta QDN no necesita nada de esto.
 */
const datosArchivo = new Map();

/** Busca una columna por nombre normalizado (sin espacios, tildes ni signos). */
function columnaPorNombre(columnas, nombres) {
    const norm = s => MEUI.normalizar
        ? MEUI.normalizar(String(s || "")).replace(/[^a-z0-9]/g, "")
        : String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return (columnas || []).find(c => nombres.indexOf(norm(c)) >= 0) || null;
}

/**
 * Columnas OPCIONALES imsi / iccid / ki -> datosArchivo, a partir de filas
 * ya tabuladas (del Excel/CSV cargado o del texto pegado con encabezado).
 * Devuelve los nombres de las columnas extra que encontró.
 */
function cargarDatosExtra(filasTabla, columnas, colMsisdn) {
    datosArchivo.clear();
    const colImsi = columnaPorNombre(columnas, ["imsi"]);
    const colIccid = columnaPorNombre(columnas, ["iccid", "serialsim", "seriesim"]);
    const colKi = columnaPorNombre(columnas, ["ki"]);
    if (colImsi || colIccid || colKi) {
        filasTabla.forEach(r => {
            const clave = soloDigitos(r[colMsisdn]);
            if (!clave) return;
            datosArchivo.set(clave, {
                imsi: colImsi ? soloDigitos(r[colImsi]) : "",
                iccid: colIccid ? soloDigitos(r[colIccid]) : "",
                ki: colKi ? String(r[colKi] || "").trim() : ""
            });
        });
    }
    return [colImsi && "imsi", colIccid && "iccid", colKi && "ki"].filter(Boolean);
}

/**
 * El cuadro de texto acepta dos cosas: solo líneas (separadas por lo que
 * sea) o una tabla pegada CON ENCABEZADO -CSV, tab, punto y coma-, como
 * `imsi,iccid,pin1,puk1,pin2,puk2,adm1,ki,msisdn`. Se reconoce que es una
 * tabla si la primera fila tiene un separador y una columna cuyo nombre
 * normalizado (minúsculas, sin tildes) sea el de la línea: msisdn, línea,
 * celular, teléfono, número, min… (MEUI.detectarColumna). Si no, todo el
 * texto se lee como líneas sueltas, igual que siempre.
 */
function tablaDesdeTexto(texto) {
    const lineas = String(texto || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lineas.length < 2) return null;
    const cab = lineas[0];
    const sep = ["\t", ";", ",", "|"].find(d => cab.includes(d));
    if (!sep) {
        // Una sola columna con encabezado ("Telefono" y debajo las líneas):
        // se salta el encabezado en vez de reportarlo como línea inválida.
        if (/[a-z]/i.test(cab) && MEUI.detectarColumna([cab])) {
            const col = cab.trim();
            return { columnas: [col], colMsisdn: col, filasTabla: lineas.slice(1).map(l => ({ [col]: l })) };
        }
        return null;
    }
    const columnas = cab.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
    if (!columnas.some(c => /[a-z]/i.test(c))) return null;      // sin letras no es encabezado
    const colMsisdn = MEUI.detectarColumna(columnas);
    if (!colMsisdn) return null;
    const filasTabla = lineas.slice(1).map(l => {
        const v = l.split(sep).map(x => x.trim().replace(/^"|"$/g, ""));
        const o = {};
        columnas.forEach((c, i) => { o[c] = v[i] === undefined ? "" : v[i]; });
        return o;
    });
    return { columnas, colMsisdn, filasTabla };
}

function obtenerLineas() {
    if (lineasArchivo && lineasArchivo.lineas && lineasArchivo.lineas.length) return lineasArchivo;
    const el = MEUI.$("#inputLineas");
    if (!el) return { lineas: [], invalidas: [], total: 0, duplicados: 0 };

    const tabla = tablaDesdeTexto(el.value);
    if (!tabla) {
        datosArchivo.clear();            // solo líneas: no hay datos extra
        return parseMsisdns(el.value);
    }
    const entrada = parseMsisdns(tabla.filasTabla.map(r => r[tabla.colMsisdn]).join("\n"));
    const extras = cargarDatosExtra(tabla.filasTabla, tabla.columnas, tabla.colMsisdn);
    MEUI.log(`Texto con encabezado: la línea sale de la columna «${tabla.colMsisdn}»` +
        (extras.length ? ` · columnas para operaciones: ${extras.join(", ")}` : " · sin columnas imsi/iccid/ki"), "info");
    return entrada;
}

/**
 * El QDN es la información real y actual de la línea. Si lo que trajo el
 * archivo o el texto (imsi / iccid) no coincide con lo que respondió el
 * QDN, no se corrige nada solo: se marca la fila y se avisa, para que el
 * analista decida cuál usar (en el formulario ve los dos valores).
 */
function discrepanciasDe(f) {
    const ext = datosArchivo.get(f.msisdn);
    if (!ext || f.estadoProceso !== "SUCCESS" || !f.resumen) return [];
    const out = [];
    [["imsi", "IMSI"], ["iccid", "ICCID"]].forEach(([campo, etq]) => {
        const entrada = soloDigitos(ext[campo] || "");
        const qdn = soloDigitos(f.resumen[campo] === "—" ? "" : (f.resumen[campo] || ""));
        if (entrada && qdn && entrada !== qdn) out.push({ campo, etiqueta: etq, entrada, qdn });
    });
    return out;
}
function marcarDiscrepancias(f) {
    f.discrepancias = discrepanciasDe(f);
    if (f.discrepancias.length) {
        MEUI.log(`⚠ ${f.msisdn}: ${f.discrepancias.map(d => `${d.etiqueta} en la entrada ${d.entrada} ≠ QDN ${d.qdn}`).join(" · ")}`, "warn");
    }
}

function actualizarProgreso(hechas, total) {
    const wrap = MEUI.$("#progresoWrap");
    if (!wrap) return;
    wrap.style.display = total ? "" : "none";
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    const contador = { SUCCESS: 0, TIMEOUT: 0, ERROR: 0, INVALID: 0 };
    filas.forEach(f => {
        if (f.estadoProceso === "SUCCESS") contador.SUCCESS++;
        else if (contador[f.estadoProceso] !== undefined) contador[f.estadoProceso]++;
    });
    const conBloqueo = filas.filter(f => f.estadoProceso === "SUCCESS" && (f.bloqueosActivos || []).length).length;
    MEUI.$("#progresoTexto").textContent =
        `Procesando: ${hechas} / ${total}  ·  Exitosas ${contador.SUCCESS} (${conBloqueo} con bloqueos)` +
        `  ·  Timeout ${contador.TIMEOUT}  ·  Errores ${contador.ERROR}  ·  Inválidas ${contador.INVALID}`;
    MEUI.$("#progresoPct").textContent = pct + "%";
    MEUI.$("#progresoBar").style.width = pct + "%";
}

async function consultar() {
    if (corriendo) return;
    const entrada = obtenerLineas();
    if (!entrada.lineas.length) {
        MEUI.toast("No hay líneas válidas para consultar.", "warn");
        return;
    }
    MEUI.log(`Registros recibidos: ${entrada.total}  ·  MSISDN válidos: ${entrada.lineas.length}  ·  ` +
        `Inválidos: ${entrada.invalidas.length}  ·  Duplicados: ${entrada.duplicados}`, "info");
    if (entrada.invalidas.length) {
        MEUI.log("Inválidos (no se consultan): " + entrada.invalidas.slice(0, 15).join(", ") +
            (entrada.invalidas.length > 15 ? "…" : ""), "warn");
    }

    corriendo = true; cancelar = false;
    const btn = MEUI.$("#btnConsultar");
    if (btn) btn.disabled = true;

    filas = entrada.lineas.map(m => ({ msisdn: m, estadoProceso: "PENDING", sel: false, resumen: {}, categorias: {} }));
    entrada.invalidas.forEach(v => filas.push(filaError(v, "INVALID", "MSISDN con formato inválido.")));
    render();

    const cfg = cfgQdn;
    const concurrencia = Math.max(1, Math.min(15, Number(MEUI.$("#cfgConcurrencia").value) || 8));
    cfg.concurrencia = concurrencia;

    let hechas = 0;
    let ultimoRender = 0;
    const total = entrada.lineas.length;
    const porMsisdn = new Map(filas.map(f => [f.msisdn, f]));

    await ejecutarPool(entrada.lineas, concurrencia, async (msisdn) => {
        if (cancelar) return;
        const fila = porMsisdn.get(msisdn);
        fila.estadoProceso = "PROCESSING";
        const resultado = await consultarConReintentos(msisdn, cfg);
        Object.assign(fila, resultado);
        marcarDiscrepancias(fila);
        hechas++;
        actualizarProgreso(hechas, total);
        const ahora = performance.now();
        if (ahora - ultimoRender > 400 || hechas === total) { ultimoRender = ahora; render(); }
    });

    corriendo = false;
    if (btn) btn.disabled = false;
    render();

    const c = { SUCCESS: 0, TIMEOUT: 0, ERROR: 0, INVALID: 0, INCONSISTENTE: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    const conBloqueo = filas.filter(f => f.estadoProceso === "SUCCESS" && (f.bloqueosActivos || []).length).length;
    // "Sin bloqueos" solo cuenta las líneas donde SÍ se pudieron evaluar.
    const sinBloqueo = filas.filter(f => f.estadoProceso === "SUCCESS"
        && f.bloqueosEvaluados && !(f.bloqueosActivos || []).length).length;
    const sinDatosBloqueo = c.SUCCESS - conBloqueo - sinBloqueo;
    MEUI.log(`Resultado de la consulta — Total: ${filas.length}  ·  Exitosas: ${c.SUCCESS}  ·  ` +
        `Con bloqueos: ${conBloqueo}  ·  Sin bloqueos: ${sinBloqueo}  ·  ` +
        `Sin datos de bloqueo: ${sinDatosBloqueo}  ·  Inconsistentes: ${c.INCONSISTENTE}  ·  ` +
        `Timeout: ${c.TIMEOUT}  ·  Errores: ${c.ERROR}  ·  Inválidas: ${c.INVALID}`, "ok");
    const conDiscrepancia = filas.filter(f => (f.discrepancias || []).length).length;
    if (conDiscrepancia) {
        MEUI.log(`⚠ ${conDiscrepancia} línea(s) con IMSI/ICCID en la entrada DISTINTOS a los del QDN (el QDN es el dato real). ` +
            "Se marcan con ⚠ en la tabla; en el formulario de cada operación se ven los dos valores.", "warn");
        MEUI.toast(`${conDiscrepancia} línea(s) con datos distintos a los del QDN. Mira el registro.`, "warn");
    }
    if (c.INCONSISTENTE) {
        MEUI.log(`⚠ ${c.INCONSISTENTE} respuesta(s) no corresponden a la línea consultada o vienen incompletas. ` +
            `Revísalas con la tarjeta «Revisar respuesta» antes de usarlas como evidencia.`, "warn");
    }
    MEUI.toast(`Consulta terminada: ${filas.length} líneas procesadas.`, "ok");
}

/* ---------------------------------------------------------------------
   10 · FILTROS Y KPIs
--------------------------------------------------------------------- */
const PROCESOS_FALLIDOS = ["ERROR", "TIMEOUT", "INVALID"];

function filaPasaFiltros(f) {
    if (filtros.proceso.size) {
        // "FALLIDAS" agrupa todo lo que no dejó un resultado utilizable.
        const agrupado = filtros.proceso.has("FALLIDAS")
            && PROCESOS_FALLIDOS.indexOf(f.estadoProceso) >= 0;
        if (!agrupado && !filtros.proceso.has(f.estadoProceso)) return false;
    }
    if (filtros.estado.size && !filtros.estado.has(estadoTabla(f))) return false;
    if (filtros.bloqueo.size) {
        const con = f.estadoProceso === "SUCCESS" && (f.bloqueosActivos || []).length > 0;
        if (filtros.bloqueo.has("CON") && !con) return false;
        if (filtros.bloqueo.has("SIN") && con) return false;
    }
    if (filtros.cincoG.size && !filtros.cincoG.has((f.resumen && f.resumen.cincoG) || "—")) return false;
    if (filtros.roaming.size) {
        const restringido = f.estadoProceso === "SUCCESS" &&
            f.resumen && f.resumen.roaming !== "Sin restricción" && f.resumen.roaming !== "—";
        if (filtros.roaming.has("RESTRINGIDO") && !restringido) return false;
        if (filtros.roaming.has("SIN_RESTRICCION") && restringido) return false;
    }
    // Marcadas con checkbox (§ Conciliación/Aprovisionar masivo: usan esto,
    // no el resto de filtros, como origen de las líneas objetivo).
    const fSel = MEUI.$("#fSel");
    if (fSel && fSel.value === "si" && !f.sel) return false;
    if (fSel && fSel.value === "no" && f.sel) return false;
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
    const cont = v => filas.filter(f => estadoTabla(f) === v).length;
    const estados = [...new Set(filas.map(estadoTabla))].sort();
    pintarFiltro(MEUI.$("#fEstado"), "estado", estados.map(v => [v, v, cont(v)]));

    const conB = filas.filter(f => f.estadoProceso === "SUCCESS" && (f.bloqueosActivos || []).length).length;
    const sinB = filas.filter(f => f.estadoProceso === "SUCCESS").length - conB;
    pintarFiltro(MEUI.$("#fBloqueo"), "bloqueo",
        [["CON", "Con bloqueos activos", conB], ["SIN", "Sin bloqueos", sinB]]);

    const si5g = filas.filter(f => f.resumen && f.resumen.cincoG === "Sí").length;
    const no5g = filas.filter(f => f.resumen && f.resumen.cincoG === "No").length;
    pintarFiltro(MEUI.$("#f5g"), "cincoG", [["Sí", "Con 5G", si5g], ["No", "Sin 5G", no5g]]);

    const rRestr = filas.filter(f => f.estadoProceso === "SUCCESS" && f.resumen &&
        f.resumen.roaming !== "Sin restricción" && f.resumen.roaming !== "—").length;
    const rLibre = filas.filter(f => f.estadoProceso === "SUCCESS").length - rRestr;
    pintarFiltro(MEUI.$("#fRoaming"), "roaming",
        [["RESTRINGIDO", "Con restricción", rRestr], ["SIN_RESTRICCION", "Sin restricción", rLibre]]);
}

function actualizarKPIs() {
    const c = { SUCCESS: 0, TIMEOUT: 0, ERROR: 0, INVALID: 0, INCONSISTENTE: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    const activas = filas.filter(f => estadoTabla(f) === "ACTIVE").length;
    const inactivas = filas.filter(f => estadoTabla(f) === "INACTIVE").length;
    const conBloqueo = filas.filter(f => f.estadoProceso === "SUCCESS" && (f.bloqueosActivos || []).length).length;
    MEUI.$("#kpiActivas").textContent = activas;
    MEUI.$("#kpiInactivas").textContent = inactivas;
    MEUI.$("#kpiBloqueos").textContent = conBloqueo;
    MEUI.$("#kpiRevisar").textContent = c.INCONSISTENTE;
    MEUI.$("#kpiErrores").textContent = c.ERROR + c.TIMEOUT + c.INVALID;
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
    const fSel = MEUI.$("#fSel");
    if (fSel) fSel.value = "";
    render();
}

/* ---------------------------------------------------------------------
   11 · COLUMNAS (mostrar/ocultar)
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
        // +1: la columna 0 real de DataTables es el checkbox de selección,
        // que no entra en `columnas` (no se puede ocultar desde este menú).
        if (dataTable) { dataTable.column(Number(chk.dataset.col) + 1).visible(chk.checked); MEUI.ajustarTablas(); }
    }));
}

/* ---------------------------------------------------------------------
   12 · TABLA (DataTables en modo data + columns)
--------------------------------------------------------------------- */
function celdaEstado(f) {
    const e = estadoTabla(f);
    const cls = { ACTIVE: "ok", ACTIVO: "ok", INACTIVE: "off", INACTIVO: "off",
        TIMEOUT: "warn", INCONSISTENTE: "warn", ERROR: "err", INVALID: "err",
        PENDING: "neutro", PROCESSING: "info" }[e] || "neutro";
    // Aviso visible en la propia tabla cuando el HLR dijo que el número no
    // está en base de datos, o cuando la respuesta no cuadra con la consulta.
    const avisos = [];
    if (f.notaUDC) avisos.push(f.notaUDC);
    (f.inconsistencias || []).forEach(t => avisos.push(t));
    (f.discrepancias || []).forEach(d => avisos.push(`${d.etiqueta} de la entrada (${d.entrada}) ≠ QDN (${d.qdn})`));
    const icono = avisos.length
        ? ` <span class="aviso-fila" title="${MEUI.esc(avisos.join(" · "))}">⚠</span>` : "";
    return `<span class="badge-estado ${cls}">${MEUI.esc(e)}</span>${icono}`;
}

function construirDataTable() {
    dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
        data: [],
        columns: [
            {
                data: null, orderable: false, searchable: false, className: "col-sel",
                render: f => `<input type="checkbox" class="form-check-input chk-fila"
                    data-msisdn="${MEUI.esc(f.msisdn)}"${f.sel ? " checked" : ""}>`
            },
            { data: "msisdn", title: "MSISDN", render: (v, t, f) => `<span class="me-mono">${MEUI.esc(v)}</span>` },
            { data: null, title: "Estado", render: (f) => celdaEstado(f) },
            { data: null, title: "IMSI", render: f => MEUI.esc((f.resumen && f.resumen.imsi) || "—") },
            { data: null, title: "IMEI", render: f => MEUI.esc((f.resumen && f.resumen.imei) || "—") },
            { data: null, title: "5G", render: f => MEUI.esc((f.resumen && f.resumen.cincoG) || "—") },
            { data: null, title: "Telefonía", render: f => MEUI.esc((f.resumen && f.resumen.telefonia) || "—") },
            { data: null, title: "SMS", render: f => MEUI.esc((f.resumen && f.resumen.sms) || "—") },
            { data: null, title: "Datos", render: f => MEUI.esc((f.resumen && f.resumen.datos) || "—") },
            { data: null, title: "Roaming", render: f => MEUI.esc((f.resumen && f.resumen.roaming) || "—") },
            {
                data: null, title: "Bloqueos", render: f => f.estadoProceso === "SUCCESS"
                    ? `<span class="${(f.bloqueosActivos || []).length ? "chip-bloqueo activo" : "chip-bloqueo"}">${MEUI.esc(textoBloqueos(f))}</span>`
                    : "—"
            },
            { data: null, title: "Desvío", render: f => MEUI.esc((f.resumen && f.resumen.desvio) || "—") },
            { data: null, title: "APN", render: f => MEUI.esc((f.resumen && f.resumen.apn) || "—") },
            { data: null, title: "IP", render: f => MEUI.esc((f.resumen && f.resumen.ip) || "—") },
            { data: null, title: "Portabilidad", render: f => MEUI.esc((f.resumen && f.resumen.portabilidad) || "—") },
            {
                data: null, title: "Detalle", orderable: false, className: "col-accion",
                render: f => `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                    title="Ver detalle completo">👁</button>`
            }
        ]
    }));
    // DataTables reorganiza el DOM al activar scrollX/scrollY (separa cabecera
    // y cuerpo en tablas distintas): el binding delegado vía dataTable.on()
    // sigue funcionando porque apunta al nodo real, a diferencia de un
    // querySelector tomado una sola vez sobre el <tbody> original.
    dataTable.on("click", "button.btn-detalle", function (e) {
        e.stopPropagation();
        abrirDetalle(this.dataset.msisdn);
    });
    dataTable.on("click", "tbody tr", function () {
        const fila = dataTable.row(this).data();
        if (fila && fila.msisdn) abrirDetalle(fila.msisdn);
    });
    // Marcado por fila: origen de las líneas objetivo de Conciliación y
    // Aprovisionar en el menú masivo (logica-qdn-operaciones.js), no de
    // bloqueos/desbloqueos, que siguen usando todo lo filtrado.
    dataTable.on("click", "input.chk-fila, input.chk-todas", e => e.stopPropagation());
    dataTable.on("change", "input.chk-fila", function () {
        const f = filaDe(this.dataset.msisdn);
        if (!f) return;
        f.sel = this.checked;
        sincronizarCasillaTodas();
        if (typeof actualizarConteoMasivo === "function") actualizarConteoMasivo();
    });
    dataTable.on("change", "input.chk-todas", function () {
        const marcar = this.checked;
        dataTable.rows({ search: "applied" }).every(function () {
            const f = this.data();
            if (f) f.sel = marcar;
        });
        render();
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
    sincronizarCasillaTodas();
    // Cuántas líneas alcanzaría una operación masiva con los filtros puestos.
    if (typeof actualizarConteoMasivo === "function") actualizarConteoMasivo();
}

/** Estado del checkbox de cabecera según lo marcado entre lo visible
 *  (mismo criterio que logica-casos.js): todo marcado -> checked, algo
 *  marcado -> indeterminate, nada -> desmarcado. */
function sincronizarCasillaTodas() {
    const visibles = filas.filter(filaPasaFiltros);
    const todas = visibles.length > 0 && visibles.every(f => f.sel);
    const algunas = visibles.some(f => f.sel);
    MEUI.$$(".chk-todas").forEach(c => {
        c.checked = todas;
        c.indeterminate = !todas && algunas;
    });
}

/* ---------------------------------------------------------------------
   13 · MODAL DE DETALLE (secciones 21-24)
--------------------------------------------------------------------- */
function filaDe(msisdn) { return filas.find(f => f.msisdn === msisdn); }

function grid(items) {
    if (!items || !items.length) return `<p class="me-hint mb-0">Sin datos en esta categoría.</p>`;
    return `<dl class="dl-grid mb-0">` + items.map(it => `
        <dt title="${MEUI.esc(it.name)}">${MEUI.esc(it.friendly || it.name)}</dt>
        <dd>${MEUI.esc(it.valor === null || it.valor === undefined || it.valor === "" ? "No Registra" : it.valor)}</dd>`
    ).join("") + `</dl>`;
}

function abrirDetalle(msisdn) {
    const f = filaDe(msisdn);
    if (!f) return;
    MEUI.$("#mdMsisdn").textContent = f.msisdn;
    MEUI.$("#mdImsi").textContent = (f.resumen && f.resumen.imsi) || "—";
    MEUI.$("#mdIccid").textContent = (f.resumen && f.resumen.iccid) || "—";

    // Las respuestas inconsistentes SÍ traen detalle parseado: se muestra
    // igual, pero encabezado por el aviso de por qué no es confiable.
    if (f.estadoProceso !== "SUCCESS" && f.estadoProceso !== "INCONSISTENTE") {
        MEUI.$("#mdResumen").innerHTML = `<div class="alert alert-warning mb-0">
            <b>${MEUI.esc(f.estadoProceso)}</b> — ${MEUI.esc(f.detalle || "Sin detalle adicional.")}
            ${f.intentos ? `<div class="me-hint mt-1">Intentos realizados: ${f.intentos}</div>` : ""}
        </div>`;
        MEUI.$("#mdCategorias").innerHTML = "";
        MEUI.$("#mdTecnico").innerHTML = "";
        MEUI.$("#mdJson").textContent = f.raw ? JSON.stringify(f.raw, null, 2) : "(sin respuesta)";
        // También aquí: sin esto el bloque de operaciones quedaba con el
        // contenido de la línea ANTERIOR, y una línea que no existe en el
        // HLR (404) es justo la que se puede aprovisionar.
        if (typeof pintarOperacionesLinea === "function") pintarOperacionesLinea(f);
        bootstrap.Modal.getOrCreateInstance("#modalDetalle").show();
        return;
    }

    const bloqueosHTML = (lista, cls) => !lista.length ? "" : `
        <ul class="mb-2">${lista.map(b => `<li><span class="badge-estado ${cls}">${MEUI.esc(b.grupo)}</span>
            ${MEUI.esc(b.etiqueta)} <span class="me-mono text-muted">(${MEUI.esc(b.name)} = ${MEUI.esc(b.valor)})</span></li>`).join("")}</ul>`;

    MEUI.$("#mdResumen").innerHTML = `
        ${(f.inconsistencias || []).length ? `<div class="alert alert-warning py-2 mb-2">
            <b>Respuesta inconsistente — no usar como evidencia sin verificar:</b>
            <ul class="mb-0">${f.inconsistencias.map(t => `<li>${MEUI.esc(t)}</li>`).join("")}</ul>
        </div>` : ""}
        <div class="d-flex flex-wrap gap-3 align-items-center">
            <span class="badge-estado ${f.operationalState === "active" ? "ok" : "off"}">${MEUI.esc((f.operationalState || "—").toUpperCase())}</span>
            <span class="${f.bloqueosActivos.length ? "chip-bloqueo activo" : "chip-bloqueo"}">${MEUI.esc(textoBloqueos(f))}</span>
            ${f.notaUDC ? `<span class="text-danger small">⚠ ${MEUI.esc(f.notaUDC)}</span>` : ""}
        </div>
        ${f.notas.length ? `<div class="me-hint mt-1">${f.notas.map(MEUI.esc).join(" · ")}</div>` : ""}
        <div class="mt-2">
            <div class="fw-bold small mb-1">Bloqueos activos</div>
            ${f.bloqueosActivos.length ? bloqueosHTML(f.bloqueosActivos, "err") : `<p class="me-hint mb-0">Sin bloqueos activos.</p>`}
            ${f.bloqueosHistoricos.length ? `<div class="fw-bold small mt-2 mb-1">Bloqueos históricos</div>${bloqueosHTML(f.bloqueosHistoricos, "warn")}` : ""}
        </div>`;

    MEUI.$("#mdCategorias").innerHTML = ORDEN_CATEGORIAS.filter(c => c !== "otros" || (f.categorias.otros || []).length)
        .map(c => `
        <div class="mb-3">
            <h6 class="fw-bold">${NOMBRES_CATEGORIA[c]} <small class="text-muted fw-normal">(${(f.categorias[c] || []).length})</small></h6>
            ${grid(f.categorias[c])}
        </div>`).join("");

    MEUI.$("#mdTecnico").innerHTML = grid([
        { name: "responseCode", friendly: "Response Code", valor: f.responseCode },
        { name: "messageCode", friendly: "Message Code", valor: f.messageCode },
        { name: "message", friendly: "Message", valor: f.message },
        { name: "legacy", friendly: "Legacy", valor: f.legacy },
        { name: "transactionId", friendly: "Transaction ID", valor: f.transactionId },
        { name: "timestamp", friendly: "Timestamp", valor: f.timestamp },
        { name: "startOperatingDate", friendly: "Start Operating Date", valor: f.startOperatingDate },
        { name: "intentos", friendly: "Intentos realizados", valor: f.intentos },
        { name: "ms", friendly: "Duración (ms)", valor: f.ms }
    ]);

    MEUI.$("#mdJson").textContent = JSON.stringify(f.raw, null, 2);
    // Operaciones de escritura: viven en logica-qdn-operaciones.js, que se
    // carga después de este archivo (de ahí la guarda).
    if (typeof pintarOperacionesLinea === "function") pintarOperacionesLinea(f);
    bootstrap.Modal.getOrCreateInstance("#modalDetalle").show();
}

/* ---------------------------------------------------------------------
   14 · EXPORTACIÓN
--------------------------------------------------------------------- */
const CABECERA_EXPORT = ["MSISDN", "Estado", "IMSI", "IMEI", "5G", "Telefonía", "SMS", "Datos",
    "Roaming", "Bloqueos activos", "Desvío", "APN", "IP", "Portabilidad",
    "Response Code", "Message", "Transaction ID", "Timestamp", "Observaciones"];

function filasExport() {
    const rows = filas.filter(filaPasaFiltros).map(f => [
        f.msisdn, estadoTabla(f), (f.resumen && f.resumen.imsi) || "", (f.resumen && f.resumen.imei) || "",
        (f.resumen && f.resumen.cincoG) || "", (f.resumen && f.resumen.telefonia) || "",
        (f.resumen && f.resumen.sms) || "", (f.resumen && f.resumen.datos) || "",
        (f.resumen && f.resumen.roaming) || "", (f.bloqueosActivos || []).map(b => b.etiqueta).join(" | "),
        (f.resumen && f.resumen.desvio) || "", (f.resumen && f.resumen.apn) || "", (f.resumen && f.resumen.ip) || "",
        (f.resumen && f.resumen.portabilidad) || "", f.responseCode || "", f.message || f.detalle || "",
        f.transactionId || "", f.timestamp || "",
        [].concat(f.inconsistencias || [], f.notaUDC ? [f.notaUDC] : [],
            (f.estadoProceso === "SUCCESS" && !f.bloqueosEvaluados)
                ? ["Sin características de bloqueo en la respuesta: no se pudo evaluar."] : []
        ).join(" | ")
    ]);
    return { head: CABECERA_EXPORT, rows };
}

function filasParaExportar() {
    return filas.filter(filaPasaFiltros).map(f => ({
        msisdn: f.msisdn, estado: estadoTabla(f), resumen: f.resumen,
        bloqueosActivos: f.bloqueosActivos, bloqueosHistoricos: f.bloqueosHistoricos,
        responseCode: f.responseCode, messageCode: f.messageCode, message: f.message,
        transactionId: f.transactionId, timestamp: f.timestamp, raw: f.raw
    }));
}

/* ---------------------------------------------------------------------
   15 · PROBAR CONEXIÓN (paso 1)
--------------------------------------------------------------------- */
async function probarConexionQdn() {
    const btn = MEUI.$("#btnProbarQdn");
    try {
        await gestorQdn.obtener(cfgQdn, true);
        MEUI.toast("Token QDN obtenido correctamente.", "ok");
        MEUI.sesion.set("qdn", { usuario: cfgQdn.client_id, duracion: Math.round((gestorQdn.exp - Date.now()) / 1000) });
    } catch (e) {
        MEUI.toast("No se pudo obtener el token QDN.", "err");
        MEUI.log("✖ " + e.message, "err");
        MEUI.sesion.caida("qdn", e.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function sincronizarCfgDesdeCampos() {
    const v = id => { const el = MEUI.$(id); return el ? el.value.trim() : ""; };
    cfgQdn.token_url = v("#cfgTokenUrl") || AMBIENTE_QDN.token_url;
    cfgQdn.client_id = v("#cfgClientId") || AMBIENTE_QDN.client_id;
    cfgQdn.client_secret = MEUI.$("#cfgClientSecret").value || AMBIENTE_QDN.client_secret;
    cfgQdn.base_apigw = v("#cfgBaseApigw") || AMBIENTE_QDN.base_apigw;
    cfgQdn.auth_en_cuerpo = MEUI.$("#cfgAuthEnCuerpo").checked;
}

/* ---------------------------------------------------------------------
   16 · CARGA DE ARCHIVO (Excel / CSV) — sección 4.2-B/C de la HU
--------------------------------------------------------------------- */
function configurarArchivo() {
    const zona = MEUI.$("#dropzone"), input = MEUI.$("#inputArchivo");
    const selHoja = MEUI.$("#selHoja"), selColumna = MEUI.$("#selColumna");
    const info = MEUI.$("#fileInfo"), btnQuitar = MEUI.$("#btnQuitarArchivo");
    let libro = null;

    function limpiar() {
        libro = null; lineasArchivo = null; datosArchivo.clear();
        input.value = "";
        selHoja.innerHTML = '<option value="">— carga un archivo —</option>'; selHoja.disabled = true;
        selColumna.innerHTML = '<option value="">— carga un archivo —</option>'; selColumna.disabled = true;
        info.textContent = ""; btnQuitar.classList.add("d-none");
    }

    function extraerColumna() {
        if (!libro || !selHoja.value || !selColumna.value) { lineasArchivo = null; datosArchivo.clear(); return; }
        const filasHoja = MEUI.filasDeHoja(libro.wb, selHoja.value);
        const valores = filasHoja.map(r => r[selColumna.value]).filter(v => v !== undefined && v !== "");
        lineasArchivo = parseMsisdns(valores.join("\n"));

        // Columnas OPCIONALES para las operaciones (imsi / iccid / ki):
        // mismo helper que usa el texto pegado con encabezado.
        const columnasHoja = filasHoja.length ? Object.keys(filasHoja[0]) : [];
        const extras = cargarDatosExtra(filasHoja, columnasHoja, selColumna.value);

        info.innerHTML = `${filasHoja.length} filas · ${lineasArchivo.lineas.length} MSISDN válidos` +
            (lineasArchivo.invalidas.length ? ` · ${lineasArchivo.invalidas.length} inválidos` : "") +
            (lineasArchivo.duplicados ? ` · ${lineasArchivo.duplicados} duplicados` : "") +
            (extras.length ? ` · columnas para operaciones: ${extras.join(", ")}` : "");
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
   17 · INICIALIZACIÓN — se ejecuta al cargar el script (el shell ya montó
   el DOM en MEUI.init(), que corre antes en el <script> inline del HTML).
--------------------------------------------------------------------- */
function inicializarQdn() {
    MEUI.$("#cfgTokenUrl").value = AMBIENTE_QDN.token_url;
    MEUI.$("#cfgClientId").value = AMBIENTE_QDN.client_id;
    MEUI.$("#cfgClientSecret").value = AMBIENTE_QDN.client_secret;
    MEUI.$("#cfgBaseApigw").value = AMBIENTE_QDN.base_apigw;
    MEUI.$("#cfgAuthEnCuerpo").checked = AMBIENTE_QDN.auth_en_cuerpo;

    // El botón existe solo en la página suelta validador_qdn.html; en la
    // pestaña Claro de hlr_hss.html la conexión no se prueba a mano (el
    // token se pide solo al consultar), así que puede no estar.
    const btnProbar = MEUI.$("#btnProbarQdn");
    if (btnProbar) btnProbar.addEventListener("click", () => { sincronizarCfgDesdeCampos(); probarConexionQdn(); });
    MEUI.$("#btnConsultar").addEventListener("click", () => { sincronizarCfgDesdeCampos(); consultar(); });
    MEUI.$("#btnLimpiarFiltros").addEventListener("click", limpiarFiltros);
    MEUI.$$(".me-kpi.kpi-click").forEach(k => k.addEventListener("click", () => alternarKpi(k)));
    const fSel = MEUI.$("#fSel");
    if (fSel) fSel.addEventListener("change", render);

    configurarArchivo();
    render();
}
/* =====================================================================
   logica-qdn-operaciones.js · Operaciones de provisión sobre la línea
   ---------------------------------------------------------------------
   El validador QDN era de SOLO LECTURA. Aquí se agregan las operaciones
   que ESCRIBEN en la red de Claro: bloqueos, desbloqueos y conciliación.

   Todo sale de `interfaz.py` (consola de líneas), que es la referencia
   viva de estos servicios:

     · endpoint  PATCH {base_apigw}/APIMParOrdeProvision/.../ModifingService
     · payloads  process / action / level / relatedParty / tier / msisdn /
                 imsi / iccid / ki / features
     · reglas    `features` NUNCA viaja como "" (vacío -> " ");
                 el éxito real NO es el HTTP 200, se evalúa el cuerpo.

   Se carga DESPUÉS de logica-qdn.js y reusa lo que ya vive allí:
   `gestorQdn` (mismo OAuth2), `cfgQdn`, `evaluarNegocio()`, `filas`,
   `filaPasaFiltros()`, `consultarConReintentos()`, `ejecutarPool()` y
   `render()`. No duplica ni el token ni el parseo.

   POR QUÉ LA DOBLE CONFIRMACIÓN
   Estas llamadas afectan líneas REALES en PRODUCCIÓN y no se deshacen
   solas. Bloquear y conciliar piden dos pasos (revisar -> "seguro?");
   desbloquear pide uno. En masivo se listan TODAS las líneas antes de
   ejecutar. Cada ejecución queda con el usuario que la hizo en la
   bitácora, el registro y la exportación.
===================================================================== */

/* ---------------------------------------------------------------------
   1 · ENDPOINT Y CONSTANTES (mismos valores que interfaz.py)
--------------------------------------------------------------------- */
const RUTA_BASE_PROVISION = "/APIMParOrdeProvision/MSParOrdeProvision/SVC/Service/RSParOrdeProvision/V1";
const RUTA_MODIFYING = RUTA_BASE_PROVISION + "/ModifingService";
// DELETE / POST del mismo servicio (reset-linea-me-claro/main.py): en PDN
// van por el mismo gateway y la misma ruta base que el ModifingService.
const RUTA_DELETING = RUTA_BASE_PROVISION + "/DeletingService";
const RUTA_PROVISIONING = RUTA_BASE_PROVISION + "/provisionServiceRED";
const RELATED_PARTY = [{ id: "EXITO", role: "ServiceProvider", name: "MOVIL EXITO" }];
const TIER_OPERACION = "prepaid";
const TECNOLOGIA_PROVISION = "4G";
const NIVEL_LOCKALL = "2";
const CONCURRENCIA_OPERACION = 3;   // más bajo que en consulta: son escrituras
// Reintentos SOLO para error de conexión (la petición nunca llegó a tener
// respuesta -conexión cerrada/reset por el gateway, típico en lotes grandes
// con muchas peticiones seguidas-): ahí es seguro reintentar, no hay forma
// de que el servicio la haya procesado. Un TIMEOUT (sí hubo conexión, se
// agotó esperando la respuesta) sigue sin reintentarse solo: la operación
// pudo haberse aplicado y repetirla la duplicaría (se avisa que se verifique
// con una consulta). Backoff creciente, mismo criterio que cerrar-casos.
const REINTENTOS_CONEXION_OPERACION = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Quiénes ven "Aprovisionamiento" (DELETE/POST de la línea en el HLR/HSS).
   Se compara contra el usuario de la sesión del CM (el login de Keycloak):
   hace falta haber iniciado sesión en el CM y que esté vigente. Es una
   guarda de interfaz para que nadie lo ejecute por accidente, no un
   control de acceso del servicio (el token de Claro es el mismo para
   todos). Para habilitar a alguien más, se agrega aquí. */
const USUARIOS_PROVISION = ["jpelaezg"];

/**
 * `features` no admite cadena vacía: el servicio la rechaza. Vacío -> " ".
 * Varios valores se separan con pipe. Misma regla que normalizar_features().
 */
function normalizarFeatures(texto) {
    const partes = String(texto === null || texto === undefined ? "" : texto)
        .split("|").map(p => p.trim()).filter(Boolean);
    return partes.length ? partes.join("|") : " ";
}

/* ---------------------------------------------------------------------
   2 · CATÁLOGO DE OPERACIONES
   ---------------------------------------------------------------------
   `tipo` decide cuánta fricción pide la interfaz:
     bloqueo / conciliacion / riesgo_alto / provision -> doble confirmación
     desbloqueo                                       -> confirmación simple
   Desactivar roaming es una restricción, así que cuenta como bloqueo.

   El menú se arma por `grupo`, en este orden (lo más usado primero):
     1. Procesos      conciliación y -solo usuarios autorizados- aprovisionar
                      / desaprovisionar
     2. SIM y número  cambio de SIM (IMSI/ICCID/KI) y cambio de MSISDN
     3. Bloqueos      plegados: se usan poco. Van por `familia` (una fila por
                      familia con su par bloquear/desbloquear, con icono),
                      nunca mezclados en una sola lista.
   `etiqueta` es el nombre completo (título del modal, bitácora, registro);
   `corto` es lo que dice el botón dentro de su familia.
--------------------------------------------------------------------- */
const OPERACIONES = [
    // 1 · Procesos
    { id: "conciliation", grupo: "Procesos", etiqueta: "Conciliación de línea", tipo: "conciliacion", proceso: "conciliation", icono: "bi-arrow-repeat" },
    // "provision": NO son PATCH al ModifingService sino DELETE/POST a otros
    // dos recursos del mismo servicio (main.py de reset-linea-me-claro):
    // crean la línea en el HLR/HSS o la sacan. Solo los ve quien esté en
    // USUARIOS_PROVISION con sesión del CM vigente (`autorizado`).
    { id: "provision", grupo: "Procesos", etiqueta: "Aprovisionar (crear en el HLR/HSS)", tipo: "provision", proceso: "provision", metodo: "POST", ruta: RUTA_PROVISIONING, icono: "bi-plus-circle-fill", autorizado: true },
    { id: "deprovision", grupo: "Procesos", etiqueta: "Desaprovisionar (eliminar del HLR/HSS)", tipo: "provision", proceso: "delete", metodo: "DELETE", ruta: RUTA_DELETING, icono: "bi-dash-circle-fill", autorizado: true },

    // 2 · SIM y número. "riesgo_alto": cambia identificadores propios de la
    // línea. El valor NUEVO no puede salir del QDN ni de un archivo -nadie
    // más que el analista sabe cuál es-, así que siempre se escribe a mano,
    // línea por línea, y por eso quedan FUERA del menú masivo: aplicar el
    // mismo IMSI o MSISDN nuevo a varias líneas sería un error.
    { id: "change_imsi", grupo: "SIM y número", etiqueta: "Cambios en la SIM (IMSI, ICCID, KI)", tipo: "riesgo_alto", proceso: "change_imsi", icono: "bi-sim-fill" },
    { id: "change_msisdn", grupo: "SIM y número", etiqueta: "Cambio de número (MSISDN)", tipo: "riesgo_alto", proceso: "change_msisdn", icono: "bi-123" },

    // 3 · Bloqueos (una familia = una fila: bloquear | desbloquear)
    { id: "lockall", grupo: "Bloqueos", familia: "Bloqueo total", corto: "Bloquear", etiqueta: "Bloqueo TOTAL de la línea", tipo: "bloqueo", proceso: "lockall", icono: "bi-lock-fill" },
    { id: "unlockall", grupo: "Bloqueos", familia: "Bloqueo total", corto: "Desbloquear", etiqueta: "Desbloqueo TOTAL de la línea", tipo: "desbloqueo", proceso: "unlockall", icono: "bi-unlock-fill" },

    { id: "blqoutcl_on", grupo: "Bloqueos", familia: "Llamada saliente", corto: "Bloquear", etiqueta: "Bloquear llamada SALIENTE", tipo: "bloqueo", proceso: "blqoutcl", accion: "activate", icono: "bi-telephone-x-fill" },
    { id: "blqoutcl_off", grupo: "Bloqueos", familia: "Llamada saliente", corto: "Desbloquear", etiqueta: "Desbloquear llamada SALIENTE", tipo: "desbloqueo", proceso: "blqoutcl", accion: "deactivate", icono: "bi-telephone-fill" },
    { id: "blqinccl_on", grupo: "Bloqueos", familia: "Llamada entrante", corto: "Bloquear", etiqueta: "Bloquear llamada ENTRANTE", tipo: "bloqueo", proceso: "blqinccl", accion: "activate", icono: "bi-telephone-x-fill" },
    { id: "blqinccl_off", grupo: "Bloqueos", familia: "Llamada entrante", corto: "Desbloquear", etiqueta: "Desbloquear llamada ENTRANTE", tipo: "desbloqueo", proceso: "blqinccl", accion: "deactivate", icono: "bi-telephone-fill" },
    { id: "blqoutsms_on", grupo: "Bloqueos", familia: "SMS saliente", corto: "Bloquear", etiqueta: "Bloquear SMS SALIENTE", tipo: "bloqueo", proceso: "blqoutsms", accion: "activate", icono: "bi-send-x-fill" },
    { id: "blqoutsms_off", grupo: "Bloqueos", familia: "SMS saliente", corto: "Desbloquear", etiqueta: "Desbloquear SMS SALIENTE", tipo: "desbloqueo", proceso: "blqoutsms", accion: "deactivate", icono: "bi-send-fill" },
    { id: "blqincsms_on", grupo: "Bloqueos", familia: "SMS entrante", corto: "Bloquear", etiqueta: "Bloquear SMS ENTRANTE", tipo: "bloqueo", proceso: "blqincsms", accion: "activate", icono: "bi-envelope-x-fill" },
    { id: "blqincsms_off", grupo: "Bloqueos", familia: "SMS entrante", corto: "Desbloquear", etiqueta: "Desbloquear SMS ENTRANTE", tipo: "desbloqueo", proceso: "blqincsms", accion: "deactivate", icono: "bi-envelope-fill" },
    { id: "blqldi_on", grupo: "Bloqueos", familia: "Larga distancia (LDI)", corto: "Bloquear", etiqueta: "Bloquear larga distancia (LDI)", tipo: "bloqueo", proceso: "blqldi", accion: "activate", icono: "bi-ban" },
    { id: "blqldi_off", grupo: "Bloqueos", familia: "Larga distancia (LDI)", corto: "Desbloquear", etiqueta: "Desbloquear larga distancia (LDI)", tipo: "desbloqueo", proceso: "blqldi", accion: "deactivate", icono: "bi-globe2" },
    // La colección manda features="roaming" en estas dos (no el valor general).
    { id: "roaming_off", grupo: "Bloqueos", familia: "Roaming", corto: "Desactivar", etiqueta: "Desactivar ROAMING", tipo: "bloqueo", proceso: "roaming", accion: "deactivate", features: "roaming", icono: "bi-airplane" },
    { id: "roaming_on", grupo: "Bloqueos", familia: "Roaming", corto: "Activar", etiqueta: "Activar ROAMING", tipo: "desbloqueo", proceso: "roaming", accion: "activate", features: "roaming", icono: "bi-airplane-fill" }
];

const GRUPOS_OPERACION = ["Procesos", "SIM y número", "Bloqueos"];
// Familias de bloqueo, en el orden en que se pintan, con el icono de la fila.
const FAMILIAS_BLOQUEO = [
    { nombre: "Bloqueo total", icono: "bi-shield-lock-fill" },
    { nombre: "Llamada saliente", icono: "bi-telephone-outbound-fill" },
    { nombre: "Llamada entrante", icono: "bi-telephone-inbound-fill" },
    { nombre: "SMS saliente", icono: "bi-send" },
    { nombre: "SMS entrante", icono: "bi-envelope" },
    { nombre: "Larga distancia (LDI)", icono: "bi-globe2" },
    { nombre: "Roaming", icono: "bi-airplane" }
];
const operacionPorId = id => OPERACIONES.find(o => o.id === id) || null;
const pideDobleConfirmacion = op => op.tipo === "bloqueo" || op.tipo === "conciliacion" || op.tipo === "riesgo_alto" || op.tipo === "provision";

/** Sesión del CM vigente Y usuario en la lista: solo entonces se ofrecen
 *  las operaciones marcadas `autorizado` (aprovisionar/desaprovisionar).
 *  El usuario sale del login de Keycloak que el CM registra en la sesión
 *  compartida de la cabecera. */
function puedeAprovisionar() {
    const st = MEUI.sesion.estado("cm");
    if (!st || (st.estado !== "ok" && st.estado !== "warn")) return false;
    const usuario = String(st.usuario || "").trim().toLowerCase();
    return USUARIOS_PROVISION.some(u => u.toLowerCase() === usuario);
}

/** Qué operaciones ve ESTE usuario en ESTE contexto ("linea" | "masivo"). */
function operacionVisible(op, contexto) {
    if (op.autorizado && !puedeAprovisionar()) return false;
    // Riesgo alto: nunca en masivo (ver el catálogo) -aplicar el mismo IMSI o
    // MSISDN nuevo a varias líneas sería un error. Desaprovisionar (DELETE):
    // tampoco, es la más destructiva del catálogo y se valida línea por línea.
    // Aprovisionar (POST) y conciliación SÍ se ofrecen en masivo, pero solo
    // sobre lo marcado con checkbox (ver OPS_MASIVO_POR_SELECCION más abajo).
    if (contexto === "masivo" && (op.tipo === "riesgo_alto" || op.id === "deprovision")) return false;
    return true;
}

/** Operaciones que en el menú MASIVO se aplican solo a lo MARCADO con la
 *  casilla de la tabla (logica-qdn.js: chk-fila/chk-todas/#fSel), no a todo
 *  lo que pase el filtro como el resto (bloqueos/desbloqueos). Crear o
 *  conciliar líneas en producción a partir de un archivo merece una
 *  selección explícita, fila por fila, no solo un filtro puesto. */
const OPS_MASIVO_POR_SELECCION = new Set(["conciliation", "provision"]);

/* ---------------------------------------------------------------------
   3 · DATOS DE LA LÍNEA (IMSI / ICCID / KI) Y DE DÓNDE SALEN
   ---------------------------------------------------------------------
   El PATCH necesita el IMSI; la conciliación además el ICCID. Hay cuatro
   orígenes posibles, y el que se use SIEMPRE se muestra en pantalla para
   que nadie envíe un dato creyendo que lo dijo el HLR:

     1. manual    lo escribió el analista en el modal de la operación
     2. archivo   columna opcional imsi / iccid / ki del Excel o CSV
     3. QDN       lo devolvió la consulta (UDC_PRSSIMCD-imsi, COTA_…-iccid)
     4. derivado  ICCID = 8957 + IMSI (regla del operador; solo si falta)

   Manual gana sobre archivo, y archivo sobre QDN: si alguien se tomó el
   trabajo de escribirlo o cargarlo, no se le sobreescribe en silencio.
   La KI no la devuelve el QDN nunca: o viene del archivo, o se escribe.
   Es obligatoria en conciliación y en aprovisionar (las dos hacen un
   delete/post de la línea por dentro); en los bloqueos no se usa.
--------------------------------------------------------------------- */
const SIN_DATO = new Set(["—", "", "No Registra", null, undefined]);
const PREFIJO_ICCID = "8957";
const LARGO_IMSI = 15;

function valorQdn(f, campo) {
    const v = f && f.resumen ? f.resumen[campo] : null;
    return SIN_DATO.has(v) ? "" : String(v).trim();
}

/** ICCID = 8957 + IMSI (p. ej. 732157001050037 -> 8957732157001050037). */
function iccidDesdeImsi(imsi) {
    const d = String(imsi || "").replace(/\D/g, "");
    return d.length === LARGO_IMSI ? PREFIJO_ICCID + d : "";
}

/** Correcciones escritas a mano en el modal: msisdn -> {imsi, iccid, ki}. */
const datosManuales = new Map();

/**
 * Resuelve los tres campos con su procedencia.
 * Devuelve { imsi:{valor,origen}, iccid:{…}, ki:{…} }.
 */
function datosOperacion(f) {
    const manual = datosManuales.get(f.msisdn) || {};
    const archivo = (typeof datosArchivo !== "undefined" && datosArchivo.get(f.msisdn)) || {};
    const elegir = (campo, origenQdn) => {
        if (manual[campo]) return { valor: manual[campo], origen: "manual" };
        const qdn = origenQdn ? valorQdn(f, campo) : "";
        if (archivo[campo]) {
            // El QDN es el dato real: si la entrada trae otro valor no se
            // pisa en silencio, se muestra la diferencia para que decida.
            const distinto = qdn && soloDigitos(qdn) !== soloDigitos(archivo[campo]);
            return { valor: archivo[campo], origen: distinto ? `entrada ≠ QDN (${qdn})` : "entrada", discrepancia: distinto ? qdn : "" };
        }
        if (qdn) return { valor: qdn, origen: "QDN" };
        return { valor: "", origen: "" };
    };

    const imsi = elegir("imsi", true);
    const iccid = elegir("iccid", true);
    if (!iccid.valor && imsi.valor) {
        const derivado = iccidDesdeImsi(imsi.valor);
        if (derivado) { iccid.valor = derivado; iccid.origen = "derivado 8957+IMSI"; }
    }
    // La KI no existe en el QDN: solo manual o archivo.
    const ki = elegir("ki", false);

    return { imsi, iccid, ki };
}

/** Compatibilidad con el resto del archivo: solo el valor resuelto. */
function datoLinea(f, campo) {
    const d = datosOperacion(f)[campo];
    return d ? d.valor : "";
}

/** Campos que la operación exige. La KI es obligatoria donde el servicio
 *  hace un delete/post de la línea: el POST de aprovisionamiento (probado
 *  en PDN: sin ki responde 400) y la conciliación, que por dentro hace lo
 *  mismo. En los bloqueos no se usa. */
function camposRequeridos(op) {
    if (!op) return ["imsi"];
    if (op.proceso === "conciliation") return ["imsi", "iccid", "ki"];
    // DELETE: imsi + iccid (sin ki). POST: además la ki, obligatoria.
    if (op.tipo === "provision") return op.metodo === "POST" ? ["imsi", "iccid", "ki"] : ["imsi", "iccid"];
    // change_imsi / change_msisdn: como es un PATCH, no hace falta traer
    // todos los datos -solo el valor NUEVO del campo que de verdad cambia-.
    if (op.proceso === "change_imsi") return ["imsi_new"];
    if (op.proceso === "change_msisdn") return ["msisdn_new"];
    return ["imsi"];
}

/* ---------------------------------------------------------------------
   3b · VALORES "NUEVOS" (change_imsi / change_msisdn) Y FEATURES DINÁMICOS
   ---------------------------------------------------------------------
   Los valores NUEVOS (imsi_new, iccid_new, ki_new, msisdn_new,
   portation_status) nunca salen del QDN ni de un archivo: nadie más que
   el analista sabe cuál es el dato nuevo, así que SIEMPRE se escriben a
   mano. Se guardan en el mismo `datosManuales` que ya usan imsi/iccid/ki
   (una entrada más por MSISDN, mismo mapa).

   `features` también se vuelve editable aquí para TODAS las operaciones,
   no solo las de riesgo alto: si la línea ya tiene bloqueos activos y se
   ejecuta OTRA operación sin decirle al servicio cuáles son, el riesgo es
   que esos bloqueos se pierdan sin que nadie lo pidiera. Se detectan los
   que se pueden traducir con confianza al nombre de "process" que espera
   el PATCH, se listan aparte los que no, y el campo queda editable para
   que el analista corrija o complete.
--------------------------------------------------------------------- */

/** Valor "nuevo" (o de features/nota) escrito a mano para esta línea. */
function valorNuevo(msisdn, campo) {
    const m = datosManuales.get(msisdn) || {};
    return m[campo] || "";
}
function escribirValorNuevo(msisdn, campo, valor) {
    const previo = datosManuales.get(msisdn) || {};
    if (valor) previo[campo] = valor; else delete previo[campo];
    datosManuales.set(msisdn, previo);
}

/** Un ICCID que no empieza por 8957: se avisa, NUNCA se corrige solo. */
function iccidSospechoso(iccid) {
    const d = String(iccid || "").replace(/\D/g, "");
    return d.length > 0 && d.slice(0, PREFIJO_ICCID.length) !== PREFIJO_ICCID;
}

// Nombre de característica QDN (ver CATALOGO_BLOQUEOS en logica-qdn.js) ->
// "process" del catálogo de OPERACIONES. Solo las que se pueden traducir
// con confianza: por ejemplo "SMS" a secas (UDC_BRRSMS-status /
// UDC_SRVSMSFL-status) no dice si es entrante o saliente -blqincsms y
// blqoutsms son procesos DISTINTOS-, así que esa no se traduce sola: se
// avisa en `sinTraducir` para que el analista decida.
const BLOQUEO_A_PROCESO = {
    "UDC_BLQINCLL-status": "blqinccl",
    "UDC_BLQOUTCL-status": "blqoutcl",
    "UDC_SRVROAM-odbBaroam": "roaming",
    "UDC_SRVROAM-odbr": "roaming",
    // Solo se traduce el LDI "total" (osb4, en sus dos variantes de nombre):
    // es el que representa la restricción general de larga distancia. Los
    // más granulares del catálogo (LDI otros indicativos/osb1, LDI 444/
    // Infracel/osb2, LDI sin implementación de red/osb3) NO se traducen
    // solos a "blqldi" -no hay certeza de que equivalgan al mismo proceso-;
    // si están activos quedan en `sinTraducir` para que el analista decida.
    "UDC_BRRLDIFL-osb4": "blqldi",
    "UDC_SRVLDIFL-osb4": "blqldi"
};

/**
 * Bloqueos activos de la línea, traducidos a la lista de "features" que
 * espera el PATCH (separados por "|"). Lo que no se puede traducir con
 * confianza queda en `sinTraducir` -se avisa, no se adivina-.
 */
function featuresDeBloqueos(f) {
    const activos = f.bloqueosActivos || [];
    const procesos = new Set(), sinTraducir = [];
    activos.forEach(b => {
        const p = BLOQUEO_A_PROCESO[b.name];
        if (p) procesos.add(p); else sinTraducir.push(b.etiqueta || b.name);
    });
    return { texto: [...procesos].join("|"), sinTraducir };
}

/**
 * `features` resuelto para el PATCH de esta línea: lo que haya escrito el
 * analista a mano, o -si no ha tocado nada- lo detectado de los bloqueos
 * activos. Vacío de verdad (sin bloqueos, nadie escribió nada) se manda
 * como " " más abajo, vía normalizarFeatures().
 */
function featuresResueltos(f) {
    const manual = valorNuevo(f.msisdn, "features");
    if (manual) return { valor: manual, origen: "manual", sinTraducir: [] };
    const det = featuresDeBloqueos(f);
    return {
        valor: det.texto,
        origen: det.texto ? "detectado de los bloqueos activos" : (f.estadoProceso ? "sin bloqueos detectados" : ""),
        sinTraducir: det.sinTraducir
    };
}

/**
 * Datos de "antes" y "después" para change_imsi / change_msisdn: el valor
 * actual (de datosOperacion) + el nuevo (manual) + el ICCID nuevo derivado
 * de 8957+IMSI-nuevo si no se escribió uno -mismo criterio que el ICCID
 * actual-, y los avisos de ICCID que no empieza por 8957 (se muestran,
 * nunca se corrigen solos).
 */
function datosCambio(f, op) {
    const actual = datosOperacion(f);
    const avisos = [];
    if (actual.iccid.valor && iccidSospechoso(actual.iccid.valor)) {
        avisos.push(`El ICCID actual (${actual.iccid.valor}) no empieza por ${PREFIJO_ICCID}: revísalo antes de continuar. No se modifica solo.`);
    }

    const salida = { avisos, actual };

    if (op.proceso === "change_imsi") {
        const imsiNew = valorNuevo(f.msisdn, "imsi_new");
        let iccidNew = valorNuevo(f.msisdn, "iccid_new");
        let iccidNewOrigen = iccidNew ? "manual" : "";
        if (!iccidNew && imsiNew) {
            const derivado = iccidDesdeImsi(imsiNew);
            if (derivado) { iccidNew = derivado; iccidNewOrigen = "derivado 8957+IMSI nuevo"; }
        }
        if (iccidNew && iccidNewOrigen === "manual" && iccidSospechoso(iccidNew)) {
            avisos.push(`El ICCID nuevo (${iccidNew}) no empieza por ${PREFIJO_ICCID}: revísalo antes de continuar. No se modifica solo.`);
        }
        salida.imsi_new = imsiNew;
        salida.iccid_new = { valor: iccidNew, origen: iccidNewOrigen };
        salida.ki_new = valorNuevo(f.msisdn, "ki_new");
    }

    if (op.proceso === "change_msisdn") {
        salida.msisdn_new = valorNuevo(f.msisdn, "msisdn_new");
        // Valor visto en el único ejemplo real disponible ("0"); sin
        // documentación propia del campo, se deja editable y con ese
        // valor de partida en vez de imponerlo sin poder cambiarlo.
        salida.portation_status = valorNuevo(f.msisdn, "portation_status") || "0";
    }

    return salida;
}

/**
 * Motivo por el que una línea NO se puede operar ni pidiendo datos, o ""
 * si es operable (aunque haya que completar campos a mano).
 */
function motivoNoOperable(f, op) {
    // Aprovisionar (POST) es justamente para una línea que NO está en el
    // HLR/HSS: ahí el QDN responde 404, y eso no es un impedimento sino
    // el caso esperado. IMSI/ICCID/KI tendrán que venir del archivo o
    // escribirse a mano, porque el QDN no los tiene.
    if (op && op.metodo === "POST" && f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404) return "";
    if (f.estadoProceso !== "SUCCESS" && f.estadoProceso !== "INCONSISTENTE") {
        return "la consulta QDN no devolvió un resultado utilizable";
    }
    if (f.estadoProceso === "INCONSISTENTE") {
        return "la respuesta QDN quedó marcada como inconsistente";
    }
    return "";
}

/** Campos obligatorios que todavía están vacíos para esta línea. */
function faltantesDe(f, op) {
    if (op.proceso === "change_imsi") return valorNuevo(f.msisdn, "imsi_new") ? [] : ["imsi_new"];
    if (op.proceso === "change_msisdn") return valorNuevo(f.msisdn, "msisdn_new") ? [] : ["msisdn_new"];
    const datos = datosOperacion(f);
    return camposRequeridos(op).filter(c => !datos[c].valor);
}

// Nota libre de ESTA confirmación (una sola caja de texto para todo el
// lote, no una por línea: es el motivo de la operación, no un dato propio
// de cada MSISDN). Se reinicia cada vez que se abre una confirmación nueva.
let notaLibreActual = "";

/**
 * Nota que viaja en el PATCH: SIEMPRE lleva el usuario que ejecuta (mismo
 * criterio que la bitácora), y opcionalmente lo que el analista haya
 * escrito, separado por ". " -mismo formato del ejemplo real
 * ("usuario. Se realiza cambio de línea por x o y motivo")-.
 */
function notaOperacion() {
    const usuario = usuarioOperador();
    return notaLibreActual ? `${usuario}. ${notaLibreActual}` : usuario;
}

/** Cuerpo del PATCH, con la misma forma exacta que arma interfaz.py. */
function payloadOperacion(op, f) {
    const datos = datosOperacion(f);

    // DELETE / POST del HLR/HSS: misma forma exacta que payload_delete() y
    // payload_post() de reset-linea-me-claro/main.py. No llevan `process`
    // ni `features`: no son un PATCH.
    if (op.tipo === "provision") {
        const cuerpo = {
            relatedParty: RELATED_PARTY,
            iccid: datos.iccid.valor, imsi: datos.imsi.valor, msisdn: f.msisdn,
            tier: TIER_OPERACION
        };
        if (op.metodo === "POST") {
            cuerpo.ki = datos.ki.valor;      // obligatoria: sin ella el servicio responde 400
            cuerpo.technology = TECNOLOGIA_PROVISION;
            cuerpo.note = notaOperacion();
        }
        return cuerpo;
    }

    const cuerpo = { process: op.proceso };
    if (op.proceso === "lockall") cuerpo.level = NIVEL_LOCKALL;
    if (op.accion) cuerpo.action = op.accion;
    cuerpo.relatedParty = RELATED_PARTY;
    cuerpo.tier = TIER_OPERACION;
    cuerpo.msisdn = f.msisdn;

    if (op.proceso === "change_imsi") {
        // PATCH parcial: el ICCID/KI nuevos solo se mandan si el analista
        // los diligenció (o se derivó el ICCID del IMSI nuevo) — "no es
        // necesario ingresar todos los datos".
        const cambio = datosCambio(f, op);
        cuerpo.imsi = datos.imsi.valor;
        cuerpo.imsi_new = cambio.imsi_new;
        if (cambio.iccid_new.valor) { cuerpo.iccid = datos.iccid.valor; cuerpo.iccid_new = cambio.iccid_new.valor; }
        if (cambio.ki_new) { cuerpo.ki = datos.ki.valor; cuerpo.ki_new = cambio.ki_new; }
    } else if (op.proceso === "change_msisdn") {
        const cambio = datosCambio(f, op);
        cuerpo.msisdn_new = cambio.msisdn_new;
        cuerpo.imsi = datos.imsi.valor;
        cuerpo.portation_status = cambio.portation_status;
    } else {
        cuerpo.imsi = datos.imsi.valor;
        if (op.proceso === "conciliation") {
            cuerpo.iccid = datos.iccid.valor;
            cuerpo.ki = datos.ki.valor;   // obligatoria: la conciliación hace delete/post
        }
    }

    // `op.features` es un override fijo del CATÁLOGO (solo lo usan hoy
    // roaming_on/roaming_off, que siempre mandan features="roaming"); para
    // todo lo demás se usa el valor dinámico de esta línea -detectado de
    // sus bloqueos activos, o editado a mano-, para no perderlos al
    // ejecutar una operación que no es sobre ellos.
    cuerpo.features = normalizarFeatures(op.features || featuresResueltos(f).valor);
    cuerpo.note = notaOperacion();
    return cuerpo;
}

/* ---------------------------------------------------------------------
   4 · QUIÉN EJECUTA (para la bitácora)
   ---------------------------------------------------------------------
   El token de QDN es de servicio (client_credentials MOVILEXITO): no
   identifica a nadie. La persona sale de la sesión que dejó el lanzador,
   CM (Keycloak) o SIME.
--------------------------------------------------------------------- */
function usuarioOperador() {
    const st = MEUI.sesion.estado("cm");

    console.log("st:", st);
    console.log("st.usuario:", st?.usuario);

    return st?.usuario || "sin sesión identificada";
}

/* ---------------------------------------------------------------------
   5 · BITÁCORA
   ---------------------------------------------------------------------
   Queda EN LA HERRAMIENTA, no en el payload: el servicio de provisión no
   define un campo de nota en ModifingService y no se inventa uno. Se ve
   en el registro y sale en la exportación de operaciones.
--------------------------------------------------------------------- */
const bitacoraOperaciones = [];

function anotarBitacora(entrada) {
    bitacoraOperaciones.push(entrada);
    MEUI.log(
        `${entrada.ok ? "✔" : "✖"} ${entrada.operacion} · ${entrada.msisdn} · ` +
        `HTTP ${entrada.httpStatus} · código ${entrada.codigo === null ? "—" : entrada.codigo}` +
        `${entrada.detalle ? " · " + entrada.detalle : ""} · por ${entrada.usuario}`,
        entrada.ok ? "ok" : "err");
}

const CABECERA_BITACORA = ["Fecha/hora", "Usuario", "MSISDN", "Operación", "process", "action",
    "IMSI", "ICCID", "IMSI nuevo", "ICCID nuevo", "KI nuevo", "MSISDN nuevo", "Portation status",
    "HTTP", "Resultado", "Código", "Message Code", "Detalle", "Nota", "Transaction ID"];

function bitacoraExport() {
    return {
        head: CABECERA_BITACORA,
        rows: bitacoraOperaciones.map(b => [
            b.hora, b.usuario, b.msisdn, b.operacion, b.proceso, b.accion || "",
            b.imsi || "", b.iccid || "",
            b.imsiNuevo || "", b.iccidNuevo || "", b.kiNuevo || "", b.msisdnNuevo || "", b.portationStatus || "",
            b.httpStatus, b.ok ? "OK" : "FALLA",
            b.codigo === null || b.codigo === undefined ? "" : b.codigo,
            b.codigoMsg || "", b.detalle || "", b.nota || "", b.transactionId || ""
        ])
    };
}

/* ---------------------------------------------------------------------
   6 · EJECUCIÓN DEL PATCH
--------------------------------------------------------------------- */
function idTransaccion() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.floor(Math.random() * 1e6);
}

async function enviarUnaVez(metodo, url, payload, cfg, token) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    const transactionId = idTransaccion();
    const t0 = performance.now();
    try {
        const r = await fetch(url, {
            method: metodo, signal: controlador.signal,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "transactionId": transactionId
            },
            body: JSON.stringify(payload)
        });
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
        return {
            ok: r.ok, status: r.status, cuerpo, texto, transactionId,
            ms: Math.round(performance.now() - t0)
        };
    } finally {
        clearTimeout(temporizador);
    }
}

/**
 * Ejecuta una operación sobre UNA línea y devuelve el registro de bitácora.
 * El éxito real se lee del cuerpo con `evaluarNegocio()` (logica-qdn.js):
 * un HTTP 200 con `success:false` o `responseCode>=400` es una FALLA.
 */
async function ejecutarOperacion(op, f, cfg) {
    const hora = new Date().toISOString().replace("T", " ").slice(0, 19);
    const usuario = usuarioOperador();
    const datos = datosOperacion(f);
    const base = {
        hora, usuario, msisdn: f.msisdn, operacion: op.etiqueta,
        proceso: op.proceso, accion: op.accion || "",
        imsi: datos.imsi.valor, iccid: datos.iccid.valor,
        origenImsi: datos.imsi.origen, origenIccid: datos.iccid.origen,
        nota: notaOperacion()
    };
    // "Riesgo alto": la bitácora también deja el valor NUEVO -sin esto, el
    // registro de una operación que cambia un identificador no diría a qué
    // quedó, solo desde qué estaba.
    if (op.tipo === "riesgo_alto") {
        const cambio = datosCambio(f, op);
        if (op.proceso === "change_imsi") {
            Object.assign(base, { imsiNuevo: cambio.imsi_new, iccidNuevo: cambio.iccid_new.valor, kiNuevo: cambio.ki_new });
        } else if (op.proceso === "change_msisdn") {
            Object.assign(base, { msisdnNuevo: cambio.msisdn_new, portationStatus: cambio.portation_status });
        }
    }

    const impedimento = motivoNoOperable(f, op)
        || (faltantesDe(f, op).length ? "falta " + faltantesDe(f, op).join(" y ") : "");
    if (impedimento) {
        return Object.assign(base, {
            ok: false, httpStatus: "—", codigo: "no-operable", codigoMsg: "",
            detalle: "No se envió nada: " + impedimento, payload: null, cuerpo: null
        });
    }

    const payload = payloadOperacion(op, f);
    // Casi todo es PATCH al ModifingService; DELETE/POST (aprovisionamiento)
    // traen su propio método y ruta en el catálogo.
    const metodo = op.metodo || "PATCH";
    const url = cfg.base_apigw.replace(/\/$/, "") + (op.ruta || RUTA_MODIFYING);

    let tokenRenovado = false;
    let intentosConexion = 0;
    while (true) {
        let token;
        try {
            token = await gestorQdn.obtener(cfg, tokenRenovado);
        } catch (e) {
            return Object.assign(base, {
                ok: false, httpStatus: "—", codigo: "auth", codigoMsg: "",
                detalle: "No se pudo autenticar: " + (e.message || e), payload, cuerpo: null
            });
        }

        let resp;
        try {
            resp = await enviarUnaVez(metodo, url, payload, cfg, token);
        } catch (e) {
            const esTimeout = e && e.name === "AbortError";
            // Error de conexión (nunca hubo respuesta): reintenta solo, hasta
            // REINTENTOS_CONEXION_OPERACION veces, con espera creciente.
            if (!esTimeout && intentosConexion < REINTENTOS_CONEXION_OPERACION) {
                intentosConexion++;
                MEUI.log(`⚠ ${f.msisdn}: error de conexión (${e.message || e}) — ` +
                    `reintentando (${intentosConexion}/${REINTENTOS_CONEXION_OPERACION})…`, "warn");
                await sleep(600 * intentosConexion);
                continue;
            }
            return Object.assign(base, {
                ok: false, httpStatus: esTimeout ? "timeout" : "—",
                codigo: esTimeout ? "timeout" : "conn-err", codigoMsg: "",
                // Un timeout NO se reintenta: SÍ hubo conexión y la operación
                // pudo haberse aplicado; repetirla la duplicaría. El error de
                // conexión de arriba ya agotó sus reintentos si llegó aquí.
                detalle: esTimeout
                    ? "Tiempo de espera agotado. NO se reintenta: verifica con una consulta antes de repetir."
                    : `Error de comunicación tras ${intentosConexion + 1} intento(s): ` + (e.message || e),
                payload, cuerpo: null
            });
        }

        // 401/403: el token venció -> se renueva UNA vez y se repite.
        if ((resp.status === 401 || resp.status === 403) && !tokenRenovado) {
            tokenRenovado = true;
            gestorQdn.reset();
            continue;
        }

        const negocio = resp.cuerpo
            ? evaluarNegocio(resp.cuerpo)
            : { ok: resp.ok, codigo: resp.status, codigoMsg: null, detalle: (resp.texto || "").slice(0, 300) };
        if (!resp.ok) negocio.ok = false;

        return Object.assign(base, {
            ok: negocio.ok, httpStatus: resp.status, ms: resp.ms,
            codigo: negocio.codigo, codigoMsg: negocio.codigoMsg,
            detalle: negocio.detalle || "", transactionId: resp.transactionId,
            payload, cuerpo: resp.cuerpo, texto: resp.texto
        });
    }
}

/**
 * Vuelve a consultar el QDN de las líneas tocadas y refresca sus filas.
 * Es el mismo `qdn -> operación -> qdn` de los escenarios de interfaz.py:
 * sin esto la tabla seguiría mostrando el estado ANTERIOR a la operación.
 */
async function reconsultar(msisdns, cfg) {
    await ejecutarPool(msisdns, CONCURRENCIA_OPERACION, async (msisdn) => {
        const i = filas.findIndex(x => x.msisdn === msisdn);
        if (i < 0) return;
        const fresca = await consultarConReintentos(msisdn, cfg);
        filas[i] = Object.assign({}, filas[i], fresca);
        marcarDiscrepancias(filas[i]);
    });
    render();
}

/* ---------------------------------------------------------------------
   7 · INTERFAZ · lista de operaciones (misma forma en modal y masivo)
--------------------------------------------------------------------- */
function claseTipo(tipo) {
    if (tipo === "bloqueo" || tipo === "riesgo_alto" || tipo === "provision") return "err";
    return tipo === "conciliacion" ? "warn" : "ok";
}

/** Un botón de operación (mismo aspecto en el modal de la línea y en el
 *  menú masivo). `texto` = corto dentro de una familia, etiqueta completa
 *  fuera. */
function botonOperacionHTML(op, contexto, texto, impedimento, clase) {
    return `<button type="button"
        class="${clase || "btn btn-sm btn-me-line"} btn-operacion op-${MEUI.esc(op.tipo)}"
        data-op="${MEUI.esc(op.id)}" data-contexto="${contexto}"
        title="${MEUI.esc(impedimento ? "No disponible: " + impedimento : op.etiqueta)}"
        ${impedimento ? "disabled" : ""}>
        <i class="bi ${MEUI.esc(op.icono || "bi-circle")}"></i> ${MEUI.esc(texto)}
    </button>`;
}

/**
 * `contexto` = "linea" (modal de detalle) o "masivo" (barra de acciones).
 * En "linea" se deshabilita lo que esa línea no puede ejecutar y se explica
 * por qué; en masivo el filtro por línea se hace al confirmar.
 *
 * Orden: Procesos, SIM y número, y al final Bloqueos PLEGADOS (se usan
 * poco), una fila por familia con su par bloquear | desbloquear.
 */
function listaOperacionesHTML(contexto, f) {
    const impedimentoDe = op => (contexto === "linea" ? motivoNoOperable(f, op) : "");
    const visibles = grupo => OPERACIONES.filter(o => o.grupo === grupo && operacionVisible(o, contexto));

    const bloqueSimple = grupo => {
        const ops = visibles(grupo);
        if (!ops.length) return "";
        return `<div class="op-grupo">
            <div class="op-grupo-tit">${MEUI.esc(grupo)}</div>
            <div class="d-flex flex-wrap gap-2">
                ${ops.map(op => botonOperacionHTML(op, contexto, op.etiqueta, impedimentoDe(op))).join("")}
            </div>
        </div>`;
    };

    const bloqueos = visibles("Bloqueos");
    const bloqueBloqueos = !bloqueos.length ? "" : `<details class="op-grupo op-bloqueos">
        <summary class="op-grupo-tit"><i class="bi bi-lock"></i> Bloqueos <span class="text-muted fw-normal">(${bloqueos.length / 2} tipos)</span></summary>
        <div class="op-familias">
            ${FAMILIAS_BLOQUEO.map(fam => {
                const par = bloqueos.filter(o => o.familia === fam.nombre);
                if (!par.length) return "";
                return `<div class="op-familia">
                    <div class="op-familia-nom"><i class="bi ${MEUI.esc(fam.icono)}"></i> ${MEUI.esc(fam.nombre)}</div>
                    <div class="op-familia-par">
                        ${par.map(op => botonOperacionHTML(op, contexto, op.corto || op.etiqueta, impedimentoDe(op))).join("")}
                    </div>
                </div>`;
            }).join("")}
        </div>
    </details>`;

    return bloqueSimple("Procesos") + bloqueSimple("SIM y número") + bloqueBloqueos;
}

/** Bloque de operaciones dentro del modal de detalle de una línea. */
function pintarOperacionesLinea(f) {
    const cont = MEUI.$("#mdOperaciones");
    if (!cont) return;
    const impedimentoGeneral = motivoNoOperable(f, null);
    // Una línea que no existe en el HLR (404) no se puede operar... salvo
    // aprovisionarla, que es exactamente para eso: se avisa distinto.
    const esInexistente = f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404;
    const datos = datosOperacion(f);
    const dato = (etq, d) => `${etq} <span class="me-mono">${MEUI.esc(d.valor || "—")}</span>` +
        `${d.origen ? ` <small class="text-muted">(${MEUI.esc(d.origen)})</small>` : ""}`;
    cont.innerHTML = `
        <div class="me-hint mb-2">
            <span class="me-mono">${MEUI.esc(f.msisdn)}</span> ·
            ${dato("IMSI", datos.imsi)} · ${dato("ICCID", datos.iccid)}.
            Lo que falte se pide al confirmar y todo se puede corregir ahí.
            Quedan registradas a nombre de <b>${MEUI.esc(usuarioOperador())}</b>.
        </div>
        ${impedimentoGeneral ? `<div class="alert alert-warning py-2 mb-2">
            ${esInexistente
                ? `La línea <b>no existe en el HLR/HSS</b> (el QDN responde 404): no se puede bloquear ni conciliar.${puedeAprovisionar() ? " Sí se puede <b>aprovisionar</b> (abajo)." : ""}`
                : `No se puede operar esta línea: ${MEUI.esc(impedimentoGeneral)}.`}</div>` : ""}
        ${(f.discrepancias || []).length ? `<div class="alert alert-warning py-2 mb-2">
            <b>La entrada no coincide con el QDN</b> (el QDN es el dato real de la línea):
            ${f.discrepancias.map(d => `${MEUI.esc(d.etiqueta)} entrada <span class="me-mono">${MEUI.esc(d.entrada)}</span> ≠ QDN <span class="me-mono">${MEUI.esc(d.qdn)}</span>`).join(" · ")}.
            En el formulario se envía el de la entrada; corrígelo ahí si corresponde.</div>` : ""}
        ${puedeAprovisionar() && !datos.imsi.valor ? `<div class="me-hint mb-2">
            ${esInexistente ? "Como no existe" : `Como está <b>${MEUI.esc((f.operationalState || "sin estado").toUpperCase())}</b>`},
            el QDN no trae IMSI ni ICCID: para <b>aprovisionar</b> hay que escribir el IMSI (el ICCID se deriva solo)
            y la KI en el formulario, o cargarlos por archivo (columnas <span class="me-mono">imsi</span>,
            <span class="me-mono">iccid</span>, <span class="me-mono">ki</span>).</div>` : ""}
        ${listaOperacionesHTML("linea", f)}`;
    cont.querySelectorAll("button.btn-operacion").forEach(b => {
        b.addEventListener("click", () => abrirConfirmacion(b.dataset.op, [f.msisdn]));
    });
}

/** Menú de operaciones masivas en la barra de acciones. Riesgo alto y
 *  desaprovisionar NO se ofrecen aquí (operacionVisible), solo por línea.
 *  Conciliación y Aprovisionar sí se ofrecen, pero actúan sobre lo MARCADO
 *  con checkbox (OPS_MASIVO_POR_SELECCION), no sobre todo lo filtrado. */
function pintarMenuOperaciones() {
    const ul = MEUI.$("#menuOperaciones");
    if (!ul) return;
    const item = (op, texto) => {
        const porSel = OPS_MASIVO_POR_SELECCION.has(op.id);
        const etiquetaExtra = porSel ? `${texto} <small class="text-muted">(marcadas)</small>` : texto;
        return `<li><button type="button" class="dropdown-item btn-operacion small op-${MEUI.esc(op.tipo)}"
            data-op="${MEUI.esc(op.id)}" data-contexto="masivo"
            title="${MEUI.esc(op.etiqueta)}${porSel ? " — se aplica a lo marcado con la casilla, no a todo lo filtrado" : ""}">
            <i class="bi ${MEUI.esc(op.icono || "bi-circle")}"></i> ${etiquetaExtra}</button></li>`;
    };
    const titulo = t => `<li class="px-2 pt-2 fw-bold small text-muted">${MEUI.esc(t)}</li>`;

    let html = `<li class="px-2 pb-2 me-hint" style="max-width:320px">
            Bloqueos y desbloqueos se aplican a las <b id="opMasivoConteo">0</b> líneas
            que quedaron visibles tras los filtros. Conciliación y Aprovisionar se aplican
            solo a las <b id="opMasivoConteoSel">0</b> línea(s) <b>marcadas</b> con la
            casilla de la tabla (de las visibles). Antes de ejecutar se listan todas.
        </li>`;
    ["Procesos", "SIM y número"].forEach(grupo => {
        const ops = OPERACIONES.filter(o => o.grupo === grupo && operacionVisible(o, "masivo"));
        if (ops.length) html += titulo(grupo) + ops.map(op => item(op, op.etiqueta)).join("");
    });
    const bloqueos = OPERACIONES.filter(o => o.grupo === "Bloqueos" && operacionVisible(o, "masivo"));
    if (bloqueos.length) {
        html += titulo("Bloqueos");
        FAMILIAS_BLOQUEO.forEach(fam => {
            const par = bloqueos.filter(o => o.familia === fam.nombre);
            if (par.length) html += `<li class="op-menu-familia"><i class="bi ${MEUI.esc(fam.icono)}"></i> ${MEUI.esc(fam.nombre)}</li>`
                + par.map(op => item(op, op.corto || op.etiqueta)).join("");
        });
    }
    ul.innerHTML = html;

    ul.querySelectorAll("button.btn-operacion").forEach(b => {
        b.addEventListener("click", () => {
            const objetivo = OPS_MASIVO_POR_SELECCION.has(b.dataset.op)
                ? filas.filter(f => f.sel && filaPasaFiltros(f)).map(f => f.msisdn)
                : filas.filter(filaPasaFiltros).map(f => f.msisdn);
            abrirConfirmacion(b.dataset.op, objetivo);
        });
    });
    actualizarConteoMasivo();
}

/** Vuelve a pintar los menús de operaciones (masivo y, si el detalle de
 *  una línea está abierto, el de esa línea). Se llama cuando cambia la
 *  sesión del CM: "Aprovisionamiento" depende de quién esté conectado. */
function repintarOperaciones() {
    pintarMenuOperaciones();
    const abierto = MEUI.$("#modalDetalle.show");
    const msisdn = MEUI.$("#mdMsisdn") ? MEUI.$("#mdMsisdn").textContent.trim() : "";
    if (abierto && msisdn) {
        const f = filaDe(msisdn);
        if (f) pintarOperacionesLinea(f);
    }
}

function actualizarConteoMasivo() {
    const visibles = filas.filter(filaPasaFiltros);
    const el = MEUI.$("#opMasivoConteo");
    if (el) el.textContent = visibles.length;
    const elSel = MEUI.$("#opMasivoConteoSel");
    if (elSel) elSel.textContent = visibles.filter(f => f.sel).length;
}

/* ---------------------------------------------------------------------
   8 · CONFIRMACIÓN (revisar -> "seguro?") Y EJECUCIÓN
--------------------------------------------------------------------- */
let operacionEnCurso = null;   // { op, objetivo: [filas], bloqueadas: [...] }

function abrirConfirmacion(opId, msisdns) {
    const op = operacionPorId(opId);
    if (!op) return;

    const candidatas = msisdns.map(m => filaDe(m)).filter(Boolean);
    const objetivo = [], bloqueadas = [];
    candidatas.forEach(f => {
        const motivo = motivoNoOperable(f, op);
        if (motivo) bloqueadas.push({ msisdn: f.msisdn, motivo });
        else objetivo.push(f);
    });

    operacionEnCurso = { op, objetivo, bloqueadas };
    const requeridos = camposRequeridos(op);
    notaLibreActual = "";   // cada confirmación nueva empieza con la nota en blanco

    MEUI.$("#opTitulo").textContent = op.etiqueta;
    MEUI.$("#opResultado").innerHTML = "";
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#opPaso1").hidden = false;

    const esRiesgoAlto = op.tipo === "riesgo_alto" || op.tipo === "provision";
    const muestra = objetivo[0] ? payloadOperacion(op, objetivo[0]) : null;
    MEUI.$("#opCuerpo").innerHTML = `
        <div class="d-flex flex-wrap gap-3 align-items-center mb-2">
            <span class="badge-estado ${claseTipo(op.tipo)}">${esRiesgoAlto ? "RIESGO ALTO" : MEUI.esc(op.tipo.toUpperCase())}</span>
            <span class="me-mono text-muted">${op.tipo === "provision"
            ? `${MEUI.esc(op.metodo)} …${MEUI.esc(op.ruta.split("/").pop())}`
            : `process=${MEUI.esc(op.proceso)}${op.accion ? " · action=" + MEUI.esc(op.accion) : ""}${op.proceso === "lockall" ? " · level=" + NIVEL_LOCKALL : ""}`}</span>
            <span class="text-muted small">Ejecuta: <b>${MEUI.esc(usuarioOperador())}</b></span>
        </div>

        <div class="alert ${objetivo.length > 1 || esRiesgoAlto ? "alert-danger" : "alert-warning"} py-2">
            línea${objetivo.length === 1 ? "" : "s"}.
            ${op.tipo === "provision"
            ? (op.metodo === "DELETE"
                ? "<b>Saca la línea del HLR/HSS</b>: queda sin servicio hasta que se vuelva a aprovisionar. "
                : "<b>Crea la línea en el HLR/HSS</b> con el IMSI/ICCID/KI indicados: si alguno está mal, la SIM no va a registrar. ")
            : esRiesgoAlto ? "<b>Cambia un identificador propio de la línea</b> -esto puede dejarla sin servicio si el dato nuevo es incorrecto. " : ""}
            Esta acción no se deshace sola.
        </div>

        <div class="op-seccion-tit">Líneas afectadas <span class="op-conteo">${objetivo.length}</span></div>
        ${objetivo.length ? `<div class="tabla-operacion-scroll">
            <table class="table table-sm mb-0 tabla-operacion">
                ${tablaConfirmacionEncabezado(op, requeridos)}
                <tbody>${objetivo.map(f => filaConfirmacion(op, f, requeridos)).join("")}</tbody>
            </table></div>
            <div class="me-hint mt-1">
                ${op.tipo === "provision"
                ? `Los valores vienen del archivo, de la consulta QDN o derivados (<span class="me-mono">ICCID = ${PREFIJO_ICCID} + IMSI</span>) y se pueden corregir aquí.${op.metodo === "POST" ? " La <b>KI</b> es <b>obligatoria</b> y el QDN nunca la da: viene de la columna <span class=\"me-mono\">ki</span> del archivo o se escribe aquí." : ""}`
                : esRiesgoAlto
                    ? `Es un PATCH parcial: solo hace falta llenar lo que de verdad cambia.`
                    : `Los valores vienen del archivo, de la consulta QDN o derivados (<span class="me-mono">ICCID = ${PREFIJO_ICCID} + IMSI</span>) y se pueden corregir aquí.${op.proceso === "conciliation" ? " La <b>KI</b> es <b>obligatoria</b> (la conciliación hace un delete/post de la línea) y el QDN nunca la da: viene de la columna <span class=\"me-mono\">ki</span> del archivo o se escribe aquí." : ""}`}
                ${op.tipo === "provision" ? "" : "<b>Features</b> lleva los bloqueos que ya tiene la línea, para no perderlos al ejecutar."}
            </div>`
            : `<div class="alert alert-danger py-2 mb-0">Ninguna línea de la selección se puede operar.</div>`}

        ${bloqueadas.length ? `
            <details class="op-plegable mt-3">
                <summary>Se omiten <span class="op-conteo">${bloqueadas.length}</span></summary>
                <ul class="me-hint mb-0 mt-1" style="max-height:140px;overflow:auto">
                    ${bloqueadas.map(b => `<li><span class="me-mono">${MEUI.esc(b.msisdn)}</span> — ${MEUI.esc(b.motivo)}</li>`).join("")}
                </ul>
            </details>` : ""}

        <div id="opAvisoFaltantes"></div>

        <div class="mt-3">
            <label class="me-lbl" for="opNota">Nota (opcional)</label>
            <textarea id="opNota" class="form-control form-control-sm" rows="2"
                placeholder="Motivo de la operación -se agrega a la nota junto a tu usuario-">${MEUI.esc(notaLibreActual)}</textarea>
            <div class="me-hint">Se envía como <span class="me-mono" id="opNotaVista">"${MEUI.esc(notaOperacion())}"</span></div>
        </div>

        ${muestra ? `<details class="op-plegable mt-3">
            <summary>Cuerpo que se envía${objetivo.length > 1 ? " (ejemplo de la primera línea)" : ""}</summary>
            <pre class="json me-mono mb-0 mt-1" id="opPayload">${MEUI.esc(JSON.stringify(muestra, null, 2))}</pre>
        </details>` : ""}`;

    // Cada input escribe en `datosManuales` y revalida en caliente. Los
    // campos de texto libre (KI, features, nota) NO se limpian a solo
    // dígitos -KI es hexadecimal, features usa letras y "|"-.
    const CAMPOS_TEXTO_LIBRE = new Set(["ki", "ki_new", "features"]);
    MEUI.$("#opCuerpo").querySelectorAll("input[data-campo]").forEach(inp => {
        inp.addEventListener("input", () => {
            const msisdn = inp.dataset.msisdn, campo = inp.dataset.campo;
            const limpio = CAMPOS_TEXTO_LIBRE.has(campo) ? inp.value.trim() : inp.value.replace(/\D/g, "");
            escribirValorNuevo(msisdn, campo, limpio);
            // Escribir el IMSI (actual o nuevo) vuelve a derivar su ICCID
            // correspondiente si no lo pusieron a mano.
            if (campo === "imsi") refrescarIccidDerivado(msisdn);
            if (campo === "imsi_new") refrescarIccidNuevoDerivado(msisdn);
            revalidarConfirmacion();
        });
    });
    const notaEl = MEUI.$("#opNota");
    if (notaEl) notaEl.addEventListener("input", () => {
        notaLibreActual = notaEl.value.trim();
        const vista = MEUI.$("#opNotaVista");
        if (vista) vista.textContent = `"${notaOperacion()}"`;
        revalidarConfirmacion();
    });

    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpSeguro").hidden = true;
    const btn = MEUI.$("#btnOpGuardar");
    btn.hidden = false;
    btn.textContent = pideDobleConfirmacion(op) ? "Guardar" : "Ejecutar";
    btn.className = "btn btn-sm " + (pideDobleConfirmacion(op) ? "btn-warning" : "btn-me");
    revalidarConfirmacion();

    bootstrap.Modal.getOrCreateInstance("#modalOperacion").show();
}

/** Campo editable (sin <td>): input + pie de origen/aviso.
 *  El <div.me-hint> se emite SIEMPRE, aunque vaya vacío: los campos
 *  derivados (el ICCID que sale de 8957+IMSI) lo rellenan después, al
 *  escribir el IMSI, y necesitan encontrarlo ya en el DOM. */
function campoInput({ msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio }) {
    const hint = pie || (obligatorio && !valor ? "sin dato: escríbelo" : "");
    return `<input type="text" ${textoLibre ? "" : 'inputmode="numeric"'}
            class="form-control form-control-sm me-mono ${invalidaSiVacio && !valor ? "is-invalid" : ""}"
            data-msisdn="${MEUI.esc(msisdn)}" data-campo="${campo}"
            value="${MEUI.esc(valor || "")}"
            placeholder="${obligatorio ? "obligatorio" : "opcional"}">
        <div class="me-hint">${MEUI.esc(hint)}</div>`;
}

/** Celda editable genérica. */
function celdaInput(opciones) {
    return `<td>${campoInput(opciones)}</td>`;
}

/** Celda de solo lectura (el dato actual, cuando la operación no lo toca). */
function celdaLectura(valor) {
    return `<td class="align-top me-mono">${MEUI.esc(valor || "—")}</td>`;
}

/** Celda "de X a Y": el valor actual y el nuevo en dos filas alineadas y
 *  etiquetadas, en vez de un texto suelto con una flecha encima del input.
 *  Antes se solapaban -el valor actual iba en `nowrap` y el input tenía un
 *  ancho mínimo, así que entre los dos desbordaban la columna- y no se
 *  entendía cuál era el valor viejo y cuál el nuevo. */
function celdaCambio({ actual, msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio }) {
    const sinCambio = !valor;
    return `<td>
        <div class="cambio">
            <div class="cambio-fila">
                <span class="cambio-lbl">antes</span>
                <span class="cambio-actual me-mono" title="${MEUI.esc(actual || "sin dato")}">${MEUI.esc(actual || "—")}</span>
            </div>
            <div class="cambio-fila">
                <span class="cambio-lbl ${sinCambio ? "" : "nuevo"}">después</span>
                <div class="cambio-campo">${campoInput({ msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio })}</div>
            </div>
        </div>
    </td>`;
}

/** Encabezado de la tabla de confirmación: cambia según la operación. */
function tablaConfirmacionEncabezado(op, requeridos) {
    if (op.proceso === "change_imsi") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>IMSI</th>
            <th>ICCID</th>
            <th>KI <small>(opcional)</small></th>
            <th class="col-features">Features</th>
        </tr></thead>`;
    }
    if (op.proceso === "change_msisdn") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>MSISDN</th>
            <th>IMSI <small>(no cambia)</small></th>
            <th>Portation status</th>
            <th class="col-features">Features</th>
        </tr></thead>`;
    }
    if (op.tipo === "provision") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>IMSI</th>
            <th>ICCID</th>
            ${op.metodo === "POST" ? "<th>KI <small>(obligatoria)</small></th>" : ""}
        </tr></thead>`;
    }
    return `<thead><tr>
        <th class="col-linea">Línea</th>
        <th>IMSI</th>
        ${requeridos.indexOf("iccid") >= 0 ? `<th>ICCID</th><th>KI <small>(${requeridos.indexOf("ki") >= 0 ? "obligatoria" : "opcional"})</small></th>` : ""}
        <th class="col-features">Features</th>
    </tr></thead>`;
}

/** Primera columna: la línea y su estado juntos, que es como se leen.
 *  Antes iban en dos columnas y el estado le robaba ancho al resto. */
function celdaLinea(f) {
    const inexistente = f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404;
    return `<td class="col-linea">
        <div class="me-mono linea-msisdn">${MEUI.esc(f.msisdn)}</div>
        <div class="me-hint">${inexistente ? "NO EXISTE EN HLR (404)" : MEUI.esc((f.operationalState || "—").toUpperCase())}</div>
    </td>`;
}

/** Celda de Features: el valor editable y, debajo, solo el resumen de
 *  cuántos bloqueos se detectaron. El detalle (cuáles, y los que no se
 *  pudieron traducir) va en el `title`, no ocupando tres renglones en la
 *  tabla -era el "exceso de información" de esta columna-. */
function celdaFeatures(f) {
    const r = featuresResueltos(f);
    const trozos = r.valor ? r.valor.split("|").filter(Boolean) : [];
    let resumen, detalle;
    if (r.origen === "manual") {
        resumen = "editado a mano";
        detalle = "Valor escrito por ti; no se vuelve a calcular solo.";
    } else if (trozos.length) {
        resumen = `${trozos.length} bloqueo${trozos.length === 1 ? "" : "s"} detectado${trozos.length === 1 ? "" : "s"}`;
        detalle = "Detectados de los bloqueos activos: " + trozos.join(", ");
    } else {
        resumen = "sin bloqueos";
        detalle = "La línea no tiene bloqueos activos que reenviar.";
    }
    if (r.sinTraducir.length) {
        resumen += ` · ${r.sinTraducir.length} sin traducir`;
        detalle += ` — sin traducción automática: ${r.sinTraducir.join(", ")} (agrégalo aquí si aplica).`;
    }
    return `<td class="col-features">
        ${campoInput({
        msisdn: f.msisdn, campo: "features",
        valor: valorNuevo(f.msisdn, "features") || r.valor,
        obligatorio: false, textoLibre: true
    })}
        <div class="me-hint ${r.sinTraducir.length ? "hint-aviso" : ""}" title="${MEUI.esc(detalle)}">${MEUI.esc(resumen)}</div>
    </td>`;
}

/** Una fila de la tabla de confirmación. Tres formas según la operación. */
function filaConfirmacion(op, f, requeridos) {
    const cambio = op.tipo === "riesgo_alto" ? datosCambio(f, op) : null;

    if (op.proceso === "change_imsi") {
        return `<tr>
            ${celdaLinea(f)}
            ${celdaCambio({
            actual: cambio.actual.imsi.valor, msisdn: f.msisdn, campo: "imsi_new",
            valor: cambio.imsi_new, obligatorio: true, invalidaSiVacio: true
        })}
            ${celdaCambio({
            actual: cambio.actual.iccid.valor, msisdn: f.msisdn, campo: "iccid_new",
            valor: cambio.iccid_new.valor, obligatorio: false, pie: cambio.iccid_new.origen
        })}
            ${celdaCambio({
            actual: cambio.actual.ki.valor, msisdn: f.msisdn, campo: "ki_new",
            valor: cambio.ki_new, obligatorio: false, textoLibre: true
        })}
            ${celdaFeatures(f)}
        </tr>`;
    }

    if (op.proceso === "change_msisdn") {
        return `<tr>
            ${celdaLinea(f)}
            ${celdaCambio({
            actual: f.msisdn, msisdn: f.msisdn, campo: "msisdn_new",
            valor: cambio.msisdn_new, obligatorio: true, invalidaSiVacio: true
        })}
            ${celdaLectura(cambio.actual.imsi.valor)}
            ${celdaInput({
            msisdn: f.msisdn, campo: "portation_status", valor: cambio.portation_status,
            obligatorio: false, pie: 'ejemplo: "0"'
        })}
            ${celdaFeatures(f)}
        </tr>`;
    }

    // Operaciones existentes (bloqueo/desbloqueo/conciliación/roaming): aquí
    // no hay "antes y después" -los campos solo identifican la línea ante el
    // QDN, no cambian de valor-, así que van como campos sueltos.
    const datos = datosOperacion(f);
    const celda = campo => celdaInput({
        msisdn: f.msisdn, campo, valor: datos[campo].valor,
        obligatorio: requeridos.indexOf(campo) >= 0, invalidaSiVacio: requeridos.indexOf(campo) >= 0,
        textoLibre: campo === "ki", pie: datos[campo].origen
    });
    if (op.tipo === "provision") {
        return `<tr>
            ${celdaLinea(f)}
            ${celda("imsi")}
            ${celda("iccid")}
            ${op.metodo === "POST" ? celda("ki") : ""}
        </tr>`;
    }
    return `<tr>
        ${celdaLinea(f)}
        ${celda("imsi")}
        ${requeridos.indexOf("iccid") >= 0 ? celda("iccid") + celda("ki") : ""}
        ${celdaFeatures(f)}
    </tr>`;
}

/** Al cambiar el IMSI actual se recalcula el ICCID actual derivado. */
function refrescarIccidDerivado(msisdn) {
    const inp = MEUI.$(`#opCuerpo input[data-campo="iccid"][data-msisdn="${msisdn}"]`);
    if (!inp) return;
    const manual = datosManuales.get(msisdn) || {};
    if (manual.iccid) return;                       // lo escribieron: no se toca
    const f = filaDe(msisdn);
    if (!f) return;
    const datos = datosOperacion(f);
    inp.value = datos.iccid.valor;
    const pie = inp.parentElement.querySelector(".me-hint");
    if (pie) pie.textContent = datos.iccid.origen || "sin dato: escríbelo";
    inp.classList.toggle("is-invalid", !datos.iccid.valor);
}

/** Al cambiar el IMSI NUEVO (change_imsi) se recalcula el ICCID nuevo
 *  derivado -mismo criterio que refrescarIccidDerivado, para el par nuevo-. */
function refrescarIccidNuevoDerivado(msisdn) {
    const inp = MEUI.$(`#opCuerpo input[data-campo="iccid_new"][data-msisdn="${msisdn}"]`);
    if (!inp) return;
    const manual = datosManuales.get(msisdn) || {};
    if (manual.iccid_new) return;                    // lo escribieron: no se toca
    const f = filaDe(msisdn);
    if (!f) return;
    const cambio = datosCambio(f, { proceso: "change_imsi" });
    inp.value = cambio.iccid_new.valor;
    const pie = inp.parentElement.querySelector(".me-hint");
    if (pie) pie.textContent = cambio.iccid_new.origen || "sin dato";
}

/** Habilita o bloquea el botón según falten campos obligatorios. */
function revalidarConfirmacion() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    const incompletas = objetivo.filter(f => faltantesDe(f, op).length);

    const aviso = MEUI.$("#opAvisoFaltantes");
    if (aviso) {
        aviso.innerHTML = incompletas.length
            ? `<div class="alert alert-warning py-2 mt-2 mb-0">
                 Faltan datos obligatorios en <b>${incompletas.length}</b> línea(s):
                 ${MEUI.esc(incompletas.slice(0, 8).map(f => f.msisdn).join(", "))}${incompletas.length > 8 ? "…" : ""}.
                 Complétalos arriba para poder continuar.
               </div>`
            : "";
    }

    const payload = MEUI.$("#opPayload");
    if (payload && objetivo.length && !faltantesDe(objetivo[0], op).length) {
        payload.textContent = JSON.stringify(payloadOperacion(op, objetivo[0]), null, 2);
    }

    const btn = MEUI.$("#btnOpGuardar");
    if (btn) btn.disabled = !objetivo.length || incompletas.length > 0;
}

/** Paso 1 -> paso 2 en bloqueo y conciliación; ejecución directa si no. */
function confirmarPaso1() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    if (!objetivo.length) return;

    if (objetivo.some(f => faltantesDe(f, op).length)) { revalidarConfirmacion(); return; }
    if (!pideDobleConfirmacion(op)) { correrOperacion(); return; }

    MEUI.$("#opPaso1").hidden = true;
    MEUI.$("#opPaso2").hidden = false;
    MEUI.$("#btnOpGuardar").hidden = true;
    MEUI.$("#btnOpVolver").hidden = false;
    MEUI.$("#btnOpSeguro").hidden = false;
    MEUI.$("#opSeguroTexto").innerHTML =
        `¿Seguro? Vas a <b>${MEUI.esc(op.etiqueta.toLowerCase())}</b> en producción sobre ` +
        `<b>${objetivo.length}</b> línea${objetivo.length === 1 ? "" : "s"}` +
        `${objetivo.length === 1 ? ` (<span class="me-mono">${MEUI.esc(objetivo[0].msisdn)}</span>)` : ""}. ` +
        `Queda registrado a nombre de <b>${MEUI.esc(usuarioOperador())}</b>.`;
}

function volverPaso1() {
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#opPaso1").hidden = false;
    MEUI.$("#btnOpSeguro").hidden = true;
    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpGuardar").hidden = false;
}

async function correrOperacion() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    const cfg = cfgQdn;

    MEUI.$("#opPaso1").hidden = true;
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#btnOpGuardar").hidden = true;
    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpSeguro").hidden = true;
    const salida = MEUI.$("#opResultado");
    salida.innerHTML = `<div class="me-hint">Ejecutando <b>${MEUI.esc(op.etiqueta)}</b> sobre ${objetivo.length} línea(s)…</div>`;

    MEUI.log(`▶ ${op.etiqueta} sobre ${objetivo.length} línea(s) · ejecuta ${usuarioOperador()}`, "warn");

    const resultados = [];
    await ejecutarPool(objetivo, CONCURRENCIA_OPERACION, async (f) => {
        const r = await ejecutarOperacion(op, f, cfg);
        anotarBitacora(r);
        resultados.push(r);
        salida.innerHTML = `<div class="me-hint">Ejecutando… ${resultados.length} / ${objetivo.length}</div>`;
    });
    resultados.sort((a, b) => objetivo.findIndex(f => f.msisdn === a.msisdn) - objetivo.findIndex(f => f.msisdn === b.msisdn));

    const ok = resultados.filter(r => r.ok).length;
    salida.innerHTML = `
        <div class="alert ${ok === resultados.length ? "alert-success" : "alert-warning"} py-2">
            <b>${ok} de ${resultados.length}</b> operación(es) con resultado exitoso.
            ${ok === resultados.length ? "" : "Revisa el detalle: un HTTP 200 con error en el cuerpo cuenta como falla."}
        </div>
        <div style="max-height:260px;overflow:auto">
        <table class="table table-sm table-striped mb-0">
            <thead><tr><th>MSISDN</th><th>Resultado</th><th>HTTP</th><th>Código</th><th>Detalle</th></tr></thead>
            <tbody>${resultados.map(r => `<tr>
                <td class="me-mono">${MEUI.esc(r.msisdn)}</td>
                <td><span class="badge-estado ${r.ok ? "ok" : "err"}">${r.ok ? "OK" : "FALLA"}</span></td>
                <td class="me-mono">${MEUI.esc(String(r.httpStatus))}</td>
                <td class="me-mono">${MEUI.esc(String(r.codigo === null || r.codigo === undefined ? "—" : r.codigo))}</td>
                <td>${MEUI.esc([r.codigoMsg, r.detalle].filter(Boolean).join(" · ") || "—")}</td>
            </tr>`).join("")}</tbody>
        </table></div>
        <div class="me-hint mt-2">Verificando el estado real con una consulta QDN…</div>`;

    MEUI.toast(`${op.etiqueta}: ${ok}/${resultados.length} con éxito.`, ok === resultados.length ? "ok" : "warn");

    // Verificación: la tabla debe reflejar el estado DESPUÉS de la operación.
    await reconsultar(objetivo.map(f => f.msisdn), cfg);
    salida.insertAdjacentHTML("beforeend",
        `<div class="me-hint">Consulta de verificación terminada: la tabla ya muestra el estado actual.</div>`);
    operacionEnCurso = null;
}

/* ---------------------------------------------------------------------
   9 · INICIALIZACIÓN
--------------------------------------------------------------------- */
function inicializarOperaciones() {
    const guardar = MEUI.$("#btnOpGuardar");
    const seguro = MEUI.$("#btnOpSeguro");
    const volver = MEUI.$("#btnOpVolver");
    if (guardar) guardar.addEventListener("click", confirmarPaso1);
    if (seguro) seguro.addEventListener("click", correrOperacion);
    if (volver) volver.addEventListener("click", volverPaso1);

    const bitacora = MEUI.$("#btnBitacora");
    if (bitacora) bitacora.addEventListener("click", () => {
        if (!bitacoraOperaciones.length) { MEUI.toast("Todavía no se ha ejecutado ninguna operación.", "warn"); return; }
        const { head, rows } = bitacoraExport();
        MEUI.exportarCSV(head, rows, "bitacora_operaciones");
    });

    pintarMenuOperaciones();
}

// Diferido hasta que la pestaña "Claro" se monte de verdad (ver
    // me-hlr-hss-puente.js) — misma razon que en los otros dos motores.
    window.MotorClaro = {
        iniciar: function () { inicializarQdn(); inicializarOperaciones(); },
        reiniciar: function () { dataTable = null; },
        filasExport: filasExport,
        filasParaExportar: filasParaExportar,
        gestorQdn: gestorQdn,
        // Lo que hacía el botón "Probar conexión": lo usa el chip de sesión de
        // la cabecera, que es el único lugar desde donde se conecta a mano.
        conectar: function () { sincronizarCfgDesdeCampos(); return probarConexionQdn(); },
        // Al cambiar la sesión del CM: "Aprovisionamiento" aparece/desaparece.
        repintarOperaciones: repintarOperaciones
    };
})();
