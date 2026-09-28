/* =====================================================================
   logica-plu.js · Aplicar PLU de paquete (Tulio) sobre una línea del CM
   ---------------------------------------------------------------------
   Porte a navegador de la operación «Agregar PLU» de la consola local
   `consola_bundles_movil_exito` (que corría con un servidor Python para
   evitar CORS y guardar los tokens fuera del navegador). Aquí NO hay
   Python: solo HTML + JS + CSS, igual que el resto de la suite.

   Que se pueda hacer sin servidor no es una suposición: esta suite ya
   llama a `tulio.grupo-exito.com` desde el navegador en Prepagadas
   (`simeBase`) y a `tulioqa.grupo-exito.com` en las herramientas de HLR.
   El precio es que la API key y el client_secret de Tulio viajan en este
   archivo, igual que el client_secret del QDN en logica-qdn.js: ver el
   apartado de riesgos del README.

   Lo que hace, por línea:
     1. la resuelve en el CM (/subscribers) y elige su cuenta
     2. lee sus paquetes activos (/subscription/bundleBalance)
     3. aplica el PLU en Tulio (RecargaPaquete)
     4. vuelve a leer el CM hasta que el cambio se estabilice y compara
        ANTES vs DESPUÉS: qué paquete es nuevo y a cuál se le sumó saldo,
        con cuánto se sumó

   Lo que NO hace (a propósito): eliminar paquetes (la orden ChangeOffer
   de la consola) ni la «Secuencia de PLU». Ver el README.

   Lo que comparte con las demás herramientas NO está aquí:
     · marco visual, sesión, registro, tablas, exportación → me-ui.js
     · Keycloak, auth y GET autenticado al CM              → me-api.js
     · enganche entre esta lógica y el shell               → me-plu-puente.js
===================================================================== */

/* =====================================================================
   1 · CONFIGURACIÓN
===================================================================== */
const CONFIG = {
    get apiBase() { return MEAPI.CONFIG.apiBase; },

    // Tulio: mismo host que ya usa Prepagadas para SIME.
    tulioBase: "https://tulio.grupo-exito.com",
    rutaToken: "/identity/connect/token",
    rutaRecarga: "/apimew/api/v1/MFYGS4TFMNQQ/Recarga/RecargaPaquete",

    // Valores del ejemplo recibido. `host` y `objetoNegocio` van tal cual
    // vinieron: no están confirmados con el equipo de API (ver README).
    hostRecarga: "1.1.1.1",
    objetoNegocio: "test",
    idAplicacion: "API_MOVIL_EXITO",

    canalPorDefecto: "PPrepagadaTP",
    costoPorDefecto: "0",

    timeoutMs: 60000,
    maxLineas: 50,

    /* Después de aplicar el PLU, el CM tarda en reflejarlo. Se relee hasta
       que la lista de paquetes CAMBIA y además se REPITE una vez (dos
       lecturas iguales seguidas = ya se estabilizó), como hacía
       `waitForStable` de la consola: sin la segunda lectura se puede
       fotografiar el momento en que el CM ya cargó un paquete pero
       todavía no el otro. */
    esperaCmMs: 2000,
    intentosEstable: 15
};

/* Credenciales de Tulio (las que traía `tulio_credentials.json` junto al
   servidor de la consola). Van aquí, igual que el client_secret del QDN en
   logica-qdn.js: la herramienta tiene que funcionar sin pedirle nada al
   analista.

   OJO al repartir: con estas credenciales se puede pedir un token y
   recargar cualquier línea, y este archivo viaja a todas las máquinas con
   la suite. La carpeta y el ZIP van en un lugar de acceso restringido, y
   cuando roten se cambian aquí (ver el apartado de riesgos del README). */
const TULIO_CRED = {
    api_key: "3PKRxw0LZTFXQ+9RUM3B5f0z8Slcn7VFbboJaXuekSGyd+e9ZzBsXtBShyECqSZYt3DUM4rEiF5Pmte31gMNeg==",
    client_id: "3ef5559a-99d8-43c8-b2af-d9c66abd01bb",
    client_secret: "AY5W76jSIfhhhc+rmwlO9bTrfZa2Nqz8l033U/F38t8=",
    scope: "UAIUGTFEYFUAPOIYO"
};
const credencialesTulio = () => TULIO_CRED;

/* Quién puede aplicar PLU. Se compara contra el usuario de la sesión del
   CM (el login de Keycloak): hace falta sesión vigente. Es una guarda de
   interfaz para que nadie recargue por accidente, no un control de acceso
   del servicio —la API key de Tulio es la misma para todos—. Para
   habilitar a alguien más se agrega aquí. */
const USUARIO_AGREGAR_PLU = ["jpelaezg"];

const auth = MEAPI.auth;
const getJson = MEAPI.getJson;

const soloDigitos = s => String(s == null ? "" : s).replace(/\D/g, "");
const escHtml = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Usuario de la sesión del CM (el que queda en la nota y en la bitácora). */
function usuarioOperador() {
    const st = MEUI.sesion.estado("cm");
    return (st && st.usuario) ? st.usuario : "sin sesión identificada";
}

/** Sesión del CM vigente Y usuario autorizado. */
function puedeAgregarPlu() {
    const st = MEUI.sesion.estado("cm");
    if (!st || (st.estado !== "ok" && st.estado !== "warn")) return false;
    const usuario = String(st.usuario || "").trim().toLowerCase();
    return USUARIO_AGREGAR_PLU.some(u => u.toLowerCase() === usuario);
}

/** Por qué no se puede aplicar PLU (texto para la interfaz), o "". */
function motivoSinPlu() {
    const st = MEUI.sesion.estado("cm");
    if (!st || (st.estado !== "ok" && st.estado !== "warn")) {
        return "hace falta una sesión del CM vigente: es la que dice quién eres";
    }
    return `el usuario «${st.usuario || "—"}» no está autorizado para aplicar PLU`;
}
const listoParaPlu = () => puedeAgregarPlu();

/* =====================================================================
   2 · ESTADO DE LA LÍNEA Y ELECCIÓN DE CUENTA
   ---------------------------------------------------------------------
   Mismo criterio que Prepagadas y que «Bolsillos, paquetes y consumos»:
   una línea puede tener VARIAS suscripciones en el CM (normalmente una
   activa y el resto desactivadas). Se elige la ACTIVA más reciente y, si
   ninguna está activa, la última creada — pero a diferencia de la consola
   las demás NO se esconden: se listan en el detalle y quedan en el
   registro, porque elegir la cuenta equivocada es justo lo que hace que
   el CM responda 500 más adelante.
===================================================================== */
const ESTADOS_CM = { 1: "Activo", 2: "Desactivado", 3: "Disponible", 4: "Bloqueada" };

function cuentaBase(sub, linea) {
    const p = sub.profile || {}, st = sub.status || {}, rt = sub.rating || {};
    return {
        subscriberId: p.identifier || null,
        ban: p.accountID != null ? String(p.accountID) : null,
        msisdn: p.mobileNumber ? String(p.mobileNumber) : String(linea),
        estadoCm: st.state,
        estadoCmTexto: ESTADOS_CM[st.state] ?? (st.state != null ? `Estado ${st.state}` : "—"),
        creado: p.created ? Number(p.created) : 0,
        iccid: p.cardPackageID ? String(p.cardPackageID) : "",
        planPrecioId: rt.primaryPricePlanID ?? null
    };
}
const cuentaActiva = c => c.estadoCm === 1;
function cuentaPorDefecto(cuentas) {
    const orden = [...cuentas].sort((a, b) => b.creado - a.creado);
    return orden.find(cuentaActiva) || orden[0] || null;
}

/**
 * Resuelve la línea en el CM. Pagina /subscribers y descarta lo que no
 * sea EXACTAMENTE esta línea: el servicio filtra por `msisdnList`, pero
 * comparar `mobileNumber` evita quedarse con el vecino de página.
 */
async function cmBuscarLinea(msisdn) {
    const encontradas = [];
    const tam = 50;
    for (let offset = 0; offset <= 500; offset += tam) {
        const data = await getJson(`${CONFIG.apiBase}/api/v1/subscribers`,
            { msisdnList: msisdn, offset, limit: tam });
        const pagina = data?.subscriberResponseList || [];
        pagina.forEach(s => {
            if (String(s?.profile?.mobileNumber || "") === String(msisdn)) encontradas.push(s);
        });
        if (pagina.length < tam) break;
    }
    if (!encontradas.length) return null;

    const cuentas = encontradas.map(s => cuentaBase(s, msisdn));
    const elegida = cuentaPorDefecto(cuentas);
    if (cuentas.length > 1) {
        MEUI.log(`· ${msisdn}: ${cuentas.length} suscripciones en el CM → ` +
            cuentas.map(c => `${c.ban} (${c.estadoCmTexto})`).join(", ") +
            ` · se usa ${elegida.ban}`, cuentas.filter(cuentaActiva).length > 1 ? "warn" : "info");
    }
    return { cuentas, elegida, multi: cuentas.length > 1 };
}

/**
 * Cuenta de facturación (CRM) por externalID, EXIGIENDO coincidencia
 * exacta.
 *
 * Aquí estaba el error que hacía fallar la eliminación con un 500 del CM:
 * la búsqueda `billingAccount?externalID=<ban>` NO es de igualdad —el
 * mismo endpoint se usa con un filtro compuesto por `%3B` sobre varios
 * campos—, así que puede devolver OTRA cuenta parecida. Tomando el primer
 * resultado a ciegas (y peor con `limit=1`, que ni deja ver si había una
 * mejor) se acaba operando sobre una cuenta que ni siquiera aparece entre
 * las de la línea. Se pide `limit=10` y se acepta solo la que tenga el
 * mismo `externalID`; si ninguna coincide, se devuelve null y se avisa,
 * en vez de seguir con una cuenta ajena.
 */
async function cmCuentaCrm(ban) {
    const clave = String(ban || "").trim();
    if (!clave) return { cuenta: null, aviso: "la línea no trae accountID" };

    const lista = await getJson(`${CONFIG.apiBase}/api/v1/billingAccount`,
        { externalID: clave, offset: 0, limit: 10 }).catch(() => null);
    const arreglo = Array.isArray(lista) ? lista : (lista?.billingAccounts || lista?.results || []);
    const exacta = arreglo.find(a => String(a?.externalID || "") === clave);

    if (exacta) return { cuenta: exacta, aviso: "" };
    if (arreglo.length) {
        const otras = arreglo.map(a => a?.externalID).filter(Boolean).join(", ");
        return {
            cuenta: null,
            aviso: `el CRM no tiene la cuenta ${clave}; la búsqueda devolvió ${otras || "otras cuentas"} ` +
                "(no se usa ninguna: operar sobre una cuenta distinta es lo que hace fallar la orden en el CM)"
        };
    }
    return { cuenta: null, aviso: `la cuenta ${clave} no existe en el CRM del CM (billingAccount)` };
}

/** Paquetes activos (status 0) de una suscripción. */
async function cmPaquetes(subscriberId) {
    const data = await getJson(`${CONFIG.apiBase}/api/v1/subscription/bundleBalance`,
        { subscriptionID: subscriberId });
    const filas = data?.bundleBalances;
    if (!Array.isArray(filas)) {
        throw new Error("el CM no devolvió bundleBalances: no se puede confirmar la consulta");
    }
    return filas.filter(z => String(z.status) === "0").map(z => ({
        bundleId: String(z.bundleID || ""),
        nombre: z.bundleName || "",
        bucketId: String(z.bucketID || ""),
        unitType: String(z.unitType || ""),
        promocional: String(z.isPromotional) === "true",
        inicio: z.activationTime || z.provisionTime || null,
        fin: z.expiryTime || null,
        balances: z.balances || []
    }));
}

/** Consulta completa de una línea: cuenta elegida + paquetes activos. */
async function consultarLinea(msisdn) {
    const base = { msisdn, estado: "PENDING", paquetes: [], cuentas: [], avisos: [] };
    try {
        const linea = await cmBuscarLinea(msisdn);
        if (!linea) return { ...base, estado: "NO_EXISTE", detalle: "La línea no existe en el CM." };

        const c = linea.elegida;
        const fila = {
            ...base, ...c, cuentas: linea.cuentas, multi: linea.multi,
            estado: cuentaActiva(c) ? "OK" : "INACTIVA"
        };

        // La cuenta del CRM no hace falta para recargar, pero sí para saber
        // si esta línea se podría operar después (eliminar paquetes), que es
        // donde el CM devuelve 500 si la cuenta no es la suya.
        const crm = await cmCuentaCrm(c.ban);
        fila.cuentaCrm = crm.cuenta ? String(crm.cuenta.externalID) : null;
        fila.titular = crm.cuenta
            ? [crm.cuenta.givenName, crm.cuenta.familyName].filter(Boolean).join(" ").trim()
            : "";
        if (crm.aviso) {
            fila.avisos.push(crm.aviso);
            MEUI.log(`⚠ ${msisdn}: ${crm.aviso}`, "warn");
        }

        fila.paquetes = await cmPaquetes(c.subscriberId);
        return fila;
    } catch (e) {
        return { ...base, estado: "ERROR", detalle: e.message || String(e) };
    }
}

/* =====================================================================
   3 · UNIDADES Y TOTALES
   ---------------------------------------------------------------------
   Misma conversión que la consola y que la tabla del CM: datos en kb
   (valor ÷ 1024) y voz en minutos (valor ÷ 60). No se pasa a GB a
   propósito: así el número se puede cruzar con lo que el analista ve en
   pantalla en el CM.
===================================================================== */
const CATEGORIA_UNIDAD = { "0": "Voz", "1": "Datos", "2": "SMS", "3": "Saldo", "4": "Unidades" };
const UNIDAD = { "0": "min", "1": "kb", "2": "SMS", "3": "$", "4": "u" };

const categoriaPaquete = u => CATEGORIA_UNIDAD[String(u)] || "Otro";
const unidadPaquete = u => UNIDAD[String(u)] || "u";

function factorUnidad(unitType) {
    if (String(unitType) === "1") return 1024;   // datos → kb
    if (String(unitType) === "0") return 60;     // voz → minutos
    return 1;
}
function enUnidad(valor, unitType) {
    return Math.floor(Number(valor || 0) / factorUnidad(unitType));
}
const nfmt = n => (Number(n) || 0).toLocaleString("es-CO");
function fmtCantidad(valor, unitType) {
    return `${nfmt(enUnidad(valor, unitType))} ${unidadPaquete(unitType)}`;
}

/**
 * Lo mismo, pero con el equivalente en MB/GB entre paréntesis cuando son
 * datos. El número en kb es el que se puede cruzar con la tabla del CM;
 * el equivalente es para poder leer de un vistazo cuánto se sumó, que en
 * kb son cifras de siete dígitos (1 GB = 1.048.576 kb).
 */
function fmtCantidadLegible(valor, unitType) {
    const base = fmtCantidad(valor, unitType);
    if (String(unitType) !== "1") return base;
    const kb = enUnidad(valor, unitType);
    if (kb < 1024) return base;
    const mb = kb / 1024;
    const legible = mb >= 1024
        ? `${(mb / 1024).toLocaleString("es-CO", { maximumFractionDigits: 2 })} GB`
        : `${mb.toLocaleString("es-CO", { maximumFractionDigits: 2 })} MB`;
    return `${base} (${legible})`;
}

/** Asignado total de un paquete: límite personal + de grupo, en crudo. */
function totalAsignado(paquete) {
    return (paquete.balances || []).reduce(
        (n, b) => n + Number(b.personalLimit || 0) + Number(b.groupLimit || 0), 0);
}
/** Disponible total de un paquete, en crudo. */
function totalDisponible(paquete) {
    return (paquete.balances || []).reduce(
        (n, b) => n + Number(b.personalBalance || 0) + Number(b.groupBalance || 0), 0);
}

function fmtFechaHora(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d) || d.getFullYear() < 2000) return "—";
    return d.toLocaleString("es-CO", {
        timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
}

/* =====================================================================
   4 · TOKEN DE TULIO (client_credentials)
   ---------------------------------------------------------------------
   El cuerpo va como multipart/form-data, igual que lo mandaba el servidor
   Python. Con FormData el navegador pone el boundary solo: por eso NO se
   fija Content-Type a mano (si se fija, el boundary falta y Tulio
   responde 400).
===================================================================== */
const gestorTulio = {
    token: null, exp: 0, renovando: null,

    async solicitar() {
        const cred = credencialesTulio();
        const cuerpo = new FormData();
        cuerpo.append("client_id", cred.client_id);
        cuerpo.append("client_secret", cred.client_secret);
        cuerpo.append("grant_type", "client_credentials");
        cuerpo.append("scope", cred.scope);

        const r = await fetch(CONFIG.tulioBase + CONFIG.rutaToken, { method: "POST", body: cuerpo });
        const texto = await r.text();
        let datos = null;
        try { datos = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
        if (!r.ok) {
            throw new Error(`Tulio ${r.status} pidiendo el token: ${String(texto).slice(0, 200)}`);
        }
        const token = datos && typeof datos.access_token === "string" ? datos.access_token : "";
        if (!token) throw new Error("Tulio no devolvió access_token.");

        this.token = token;
        const vida = Number(datos.expires_in || 300);
        this.exp = Date.now() + Math.max(30, vida - 60) * 1000;
        MEUI.log(`✔ Token de Tulio obtenido (vence en ${vida}s).`, "ok");
        return token;
    },

    async obtener(forzar) {
        if (!forzar && this.token && Date.now() < this.exp) return this.token;
        if (this.renovando) return this.renovando;
        this.renovando = this.solicitar().finally(() => { this.renovando = null; });
        return this.renovando;
    },

    reset() { this.token = null; this.exp = 0; }
};

/* =====================================================================
   5 · APLICAR EL PLU (RecargaPaquete)
===================================================================== */
const idTransaccion = () => (crypto.randomUUID ? crypto.randomUUID()
    : "ME-" + Date.now() + "-" + Math.random().toString(16).slice(2));

function payloadRecarga(msisdn, plu, costo, canal, usuario) {
    const sello = new Date().toISOString().replace("Z", "-05:00");
    return {
        cabeceraEntrada: {
            uuid: idTransaccion(),
            idAplicacion: CONFIG.idAplicacion,
            fechaTransaccion: sello,
            host: CONFIG.hostRecarga,
            usuario,
            objetoNegocio: CONFIG.objetoNegocio,
            operacion: "RecargaPaquete"
        },
        DatosEntradaRecargaPaquete: {
            idTransaccion: idTransaccion(),
            canalVenta: canal,
            lineaTelefonica: msisdn,
            pluPaquete: plu,
            costoPaquete: Number(costo),
            fechaSolicitud: sello
        }
    };
}

async function recargaUnaVez(payload, token) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), CONFIG.timeoutMs);
    const t0 = performance.now();
    try {
        const r = await fetch(CONFIG.tulioBase + CONFIG.rutaRecarga, {
            method: "POST", signal: controlador.signal,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "X-Api-Key": credencialesTulio().api_key
            },
            body: JSON.stringify(payload)
        });
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
        return { ok: r.ok, status: r.status, cuerpo, texto, ms: Math.round(performance.now() - t0) };
    } finally {
        clearTimeout(temporizador);
    }
}

/**
 * Aplica el PLU. El éxito NO es el HTTP 200: Tulio marca el resultado en
 * `cabeceraSalida.estado.estado` y en `datosSalida.estado`, y los dos
 * tienen que venir en "000" (mismo criterio que el servidor Python).
 */
async function aplicarPlu(msisdn, plu, costo, canal) {
    const usuario = usuarioOperador();
    const payload = payloadRecarga(msisdn, plu, costo, canal, usuario);
    const evidencia = { request: { url: CONFIG.tulioBase + CONFIG.rutaRecarga, body: payload } };

    for (let intento = 1; intento <= 2; intento++) {
        let token;
        try {
            token = await gestorTulio.obtener(intento === 2);
        } catch (e) {
            return { ok: false, detalle: "No se pudo autenticar en Tulio: " + e.message, evidencia };
        }

        let resp;
        try {
            resp = await recargaUnaVez(payload, token);
        } catch (e) {
            const esTimeout = e && e.name === "AbortError";
            return {
                ok: false, evidencia,
                // Un timeout NO se reintenta: la recarga pudo haberse
                // aplicado y repetirla la sumaría dos veces.
                detalle: esTimeout
                    ? "Tiempo de espera agotado. NO se reintenta: verifica los paquetes antes de repetir."
                    : "Error de comunicación con Tulio: " + (e.message || e)
            };
        }

        // 401: el token venció → se renueva UNA vez y se repite.
        if (resp.status === 401 && intento === 1) { gestorTulio.reset(); continue; }

        evidencia.response = resp.cuerpo || { httpStatus: resp.status, texto: (resp.texto || "").slice(0, 500) };
        const estado = resp.cuerpo?.cabeceraSalida?.estado || {};
        const estadoDatos = resp.cuerpo?.datosSalida?.estado;
        const exito = resp.ok && String(estado.estado) === "000" && String(estadoDatos) === "000";

        return {
            ok: exito, httpStatus: resp.status, ms: resp.ms, evidencia,
            codigo: estado.estado != null ? String(estado.estado) : String(resp.status),
            detalle: exito
                ? String(estado.descripcion || "Transacción Exitosa")
                : "Tulio no confirmó la recarga: " + String(estado.descripcion || (resp.texto || "").slice(0, 200) || "error desconocido")
        };
    }
    return { ok: false, detalle: "No se pudo aplicar el PLU.", evidencia };
}

/* =====================================================================
   6 · ESPERAR A QUE EL CM REFLEJE EL CAMBIO
===================================================================== */
const clavePaquetes = fila => (fila?.paquetes || []).map(b => b.bundleId).sort().join(",");
/** Huella que cambia también cuando solo se SUMA saldo a un paquete que ya
 *  estaba (ahí la lista de IDs no cambia, pero el asignado sí). */
const huellaPaquetes = fila => (fila?.paquetes || [])
    .map(b => `${b.bundleId}:${totalAsignado(b)}`).sort().join(",");

/**
 * Relee la línea hasta que la huella CAMBIE respecto a la de antes y
 * además se repita en dos lecturas seguidas (ya está estable). Devuelve
 * la última lectura aunque se agote el tope, con `estable: false`.
 */
async function esperarEstable(msisdn, huellaAntes, alProgresar) {
    let anterior = null, ultima = null;
    for (let intento = 1; intento <= CONFIG.intentosEstable; intento++) {
        if (alProgresar) alProgresar(intento, CONFIG.intentosEstable);
        const fila = await consultarLinea(msisdn);
        if (fila.estado === "OK" || fila.estado === "INACTIVA") {
            const huella = huellaPaquetes(fila);
            if (huella !== huellaAntes && huella === anterior) return { fila, estable: true };
            anterior = huella;
            ultima = fila;
        }
        await espera(CONFIG.esperaCmMs);
    }
    return { fila: ultima, estable: false };
}

/* =====================================================================
   7 · COMPARACIÓN ANTES / DESPUÉS  ←  el cuadro de «cuánto se sumó»
   ---------------------------------------------------------------------
   Un PLU puede dejar un paquete NUEVO o sumarle saldo a uno que ya
   estaba. En los dos casos interesa el mismo trío, y en este orden:

       TOTAL            lo que quedó asignado después
       Valor anterior   lo que tenía antes (0 si el paquete es nuevo)
       Valor agregado   la diferencia  ← es el dato que se resalta

   La comparación es sobre el ASIGNADO (personalLimit + groupLimit), no
   sobre el disponible: el disponible baja solo con el consumo y no
   serviría para probar qué cargó el PLU.
===================================================================== */
function compararPaquetes(antes, despues) {
    const previos = new Map((antes?.paquetes || []).map(b => [b.bundleId, totalAsignado(b)]));
    const cambios = [];

    (despues?.paquetes || []).forEach(b => {
        const total = totalAsignado(b);
        const habia = previos.has(b.bundleId);
        const anterior = habia ? previos.get(b.bundleId) : 0;
        if (!habia || total > anterior) {
            cambios.push({
                bundleId: b.bundleId, nombre: b.nombre, unitType: b.unitType,
                tipo: habia ? "SUMA" : "NUEVO",
                total, anterior, agregado: total - anterior,
                disponible: totalDisponible(b),
                promocional: b.promocional, fin: b.fin
            });
        }
    });
    // Primero lo nuevo, y dentro de cada grupo lo que más sumó.
    cambios.sort((a, b) => (a.tipo === b.tipo ? b.agregado - a.agregado : a.tipo === "NUEVO" ? -1 : 1));
    return cambios;
}

/** El cuadro con los tres valores, uno debajo del otro. */
function cuadroCambioHTML(c) {
    return `
<div class="plu-cambio ${c.tipo === "NUEVO" ? "es-nuevo" : "es-suma"}">
  <div class="plu-cambio-cab">
    <span class="plu-badge ${c.tipo === "NUEVO" ? "nuevo" : "suma"}">${c.tipo === "NUEVO" ? "Paquete nuevo" : "Se sumó saldo"}</span>
    <span class="plu-cambio-nom">${escHtml(c.nombre || "—")}</span>
    <span class="plu-cambio-id me-mono">${escHtml(c.bundleId)}</span>
    <span class="plu-cambio-cat">${escHtml(categoriaPaquete(c.unitType))}</span>
  </div>
  <div class="plu-cifras">
    <div class="plu-cifra">
      <span class="plu-cifra-lbl">Total</span>
      <span class="plu-cifra-val me-mono">${escHtml(fmtCantidadLegible(c.total, c.unitType))}</span>
    </div>
    <div class="plu-cifra">
      <span class="plu-cifra-lbl">Valor anterior</span>
      <span class="plu-cifra-val me-mono">${escHtml(fmtCantidadLegible(c.anterior, c.unitType))}</span>
    </div>
    <div class="plu-cifra destacada">
      <span class="plu-cifra-lbl">${c.tipo === "NUEVO" ? "Valor nuevo" : "Valor agregado"}</span>
      <span class="plu-cifra-val me-mono">+${escHtml(fmtCantidadLegible(c.agregado, c.unitType))}</span>
    </div>
  </div>
  <div class="plu-cambio-pie">
    Disponible ahora: <span class="me-mono">${escHtml(fmtCantidad(c.disponible, c.unitType))}</span>
    ${c.promocional ? ' · <span class="plu-promo">promocional</span>' : ""}
    ${c.fin ? " · vence " + escHtml(fmtFechaHora(c.fin)) : ""}
  </div>
</div>`;
}

/** Bloque completo del resultado de un PLU sobre una línea. */
function resultadoPluHTML(r) {
    if (!r) return "";
    const cambios = r.cambios || [];
    const sinEvidencia = r.ok && !cambios.length;
    return `
<div class="plu-resultado">
  <div class="alert ${r.ok ? (sinEvidencia ? "alert-warning" : "alert-success") : "alert-danger"} py-2 mb-2">
    <b>PLU ${escHtml(r.plu)}</b> · costo ${escHtml(nfmt(r.costo))} · canal ${escHtml(r.canal)}
    — ${escHtml(r.detalle || (r.ok ? "aplicado" : "falló"))}
    ${r.ok && !r.estable ? "<div class=\"me-hint mt-1\">El CM todavía no mostró un resultado estable: lo de abajo es la última lectura. Vuelve a consultar en un momento.</div>" : ""}
    ${sinEvidencia ? "<div class=\"me-hint mt-1\">Tulio confirmó la recarga, pero el CM no muestra paquetes nuevos ni saldo sumado. No repitas el PLU sin revisar la línea.</div>" : ""}
  </div>
  ${cambios.length ? `<div class="plu-cambios">${cambios.map(cuadroCambioHTML).join("")}</div>` : ""}
</div>`;
}

/* =====================================================================
   8 · OPERACIÓN COMPLETA POR LÍNEA
===================================================================== */
/**
 * consulta → PLU en Tulio → espera al CM → compara.
 * `alPaso` recibe el nombre del paso para que la interfaz lo muestre.
 */
async function ejecutarPlu(fila, plu, costo, canal, alPaso) {
    const aviso = p => { if (alPaso) alPaso(p); };
    const salida = { msisdn: fila.msisdn, plu, costo, canal, ok: false, cambios: [], estable: true };

    aviso("Leyendo paquetes actuales…");
    const antes = await consultarLinea(fila.msisdn);
    if (antes.estado === "ERROR" || antes.estado === "NO_EXISTE") {
        salida.detalle = "No se aplicó nada: " + (antes.detalle || "la línea no se pudo consultar");
        return { salida, antes, despues: antes };
    }
    salida.antes = antes;

    aviso("Aplicando el PLU en Tulio…");
    const tulio = await aplicarPlu(fila.msisdn, plu, costo, canal);
    salida.evidencia = tulio.evidencia;
    salida.httpStatus = tulio.httpStatus;
    salida.codigo = tulio.codigo;
    salida.detalle = tulio.detalle;
    if (!tulio.ok) return { salida, antes, despues: antes };
    salida.ok = true;

    aviso("Esperando a que el CM refleje el cambio…");
    await espera(CONFIG.esperaCmMs);
    const { fila: despues, estable } = await esperarEstable(
        fila.msisdn, huellaPaquetes(antes),
        (i, n) => aviso(`Esperando al CM (${i}/${n})…`));

    salida.estable = estable;
    salida.despues = despues || antes;
    salida.cambios = compararPaquetes(antes, salida.despues);
    return { salida, antes, despues: salida.despues };
}

/* =====================================================================
   9 · ELIMINAR LOS PAQUETES (orden ChangeOffer del CM)
   ---------------------------------------------------------------------
   Porte de `delete_bundles()` del servidor de la consola, paso por paso.
   El CM no tiene un «borrar paquete»: hay que armar un CARRITO con TODOS
   los productos del plan y marcar cada uno con la acción que le toca, y
   después convertir ese carrito en una ORDEN:

     NO_CHANGE  los tres servicios base del plan (voz/datos/SMS) y los
                paquetes que no se pueden eliminar
     DELETE     los paquetes opcionales habilitados que sí se pueden

   Y el 200 del POST no significa que se aplicó: hay que seguir la orden
   hasta «Order Fulfilled» / «Order Failed».
===================================================================== */
const PLAN_OBLIGATORIO = new Set(["205"]);   // paquete técnico del plan

/* Paquetes que el CM LISTA como habilitados pero rechaza al darlos de
   baja («Specified bundle is not Enabled of the subscriber», código 14).
   Una sola opción rechazada hace fallar TODA la orden y el CM no dice
   cuál fue, así que se excluyen de entrada. Venía en
   `paquetes_no_eliminables.json`; para agregar otro caso se añade aquí. */
const NO_ELIMINABLES = {
    "394": "Promo 1x1 minutos 2 dias: el CM lo lista como habilitado pero rechaza la orden (SOI7854736)."
};
const esEliminable = b => !NO_ELIMINABLES[b.bundleId] && !PLAN_OBLIGATORIO.has(b.bundleId);

const apiCm = (ruta, opciones) => MEAPI.api(ruta, opciones);
const postCm = (ruta, cuerpo, cabeceras) => apiCm(ruta, {
    method: "POST", body: JSON.stringify(cuerpo),
    headers: Object.assign({ "Content-Type": "application/json" }, cabeceras || {})
});

/** Perfil de la suscripción: plan, paquetes habilitados e ICCID. */
async function cmPerfil(subscriberId) {
    const data = await getJson(`${CONFIG.apiBase}/api/v1/subscriptionProfile`,
        { subscriptionID: subscriberId });
    const perfil = data?.getSubscriptionProfileResponse?.return;
    if (!perfil) throw new Error("el CM no devolvió el perfil de la suscripción");
    return perfil;
}

/**
 * Sigue la orden hasta su estado final. Un id de orden solo confirma que
 * el CM la recibió; el resultado real está en su estado y, si falló, en
 * el `faultstring` del historial (viene como XML dentro del JSON).
 */
async function cmEsperarOrden(ban, ordenId, alProgresar) {
    const limite = Date.now() + 30000;
    let ultima = null;
    while (Date.now() < limite) {
        const ordenes = await getJson(`${CONFIG.apiBase}/api/v1/productOrder`, { customerBan: ban })
            .catch(() => null);
        const orden = Array.isArray(ordenes) ? ordenes.find(o => String(o?.id) === String(ordenId)) : null;
        if (orden) {
            ultima = orden;
            const estado = String(orden.state || orden.orderStatus || "").trim();
            if (alProgresar) alProgresar(estado || "en curso");
            if (estado === "Order Failed") {
                let motivo = "";
                for (const h of (orden.history || [])) {
                    if (h.orderStatus !== "Order Failed") continue;
                    const crudo = String(h.changeReason || "");
                    const m = /<[^>]*faultstring[^>]*>([^<]*)</i.exec(crudo);
                    motivo = m ? m[1].trim() : crudo.slice(0, 200);
                    break;
                }
                return { estado, ok: false, motivo: motivo || "revisa el historial de la orden en el CM", orden };
            }
            if (estado === "Order Fulfilled" || estado === "Order Completed") {
                return { estado, ok: true, motivo: "", orden };
            }
        }
        await espera(CONFIG.esperaCmMs);
    }
    return { estado: "Order Pending", ok: false, motivo: "el CM no dio un estado final en 30 s", orden: ultima };
}

/* Máximo de productos que se agregan al carrito por dependencias que el
   propio CM reclama (ver crearCarrito). Es un tope, no un objetivo: si
   hacen falta más de estos, algo más grande está mal. */
const MAX_DEPENDENCIAS = 10;

/**
 * Crea el carrito, resolviendo las dependencias que el CM reclame.
 *
 * El CM valida que el carrito lleve los productos DEPENDIENTES de los que
 * se mandan. Cuando falta alguno responde 500 con
 *
 *     ERCRT1002 · "Missing dependent product null having product id:10185"
 *
 * y ahí está el dato que hace falta: el id del producto. El flujo de la
 * consola solo metía al carrito los paquetes de `enabledOptionalBundles`,
 * así que un producto del plan del que estos dependan nunca entraba y el
 * carrito no se podía crear —es el caso que la propia consola avisaba como
 * no demostrado—.
 *
 * Aquí se agrega ese producto con `NO_CHANGE` (no se toca: solo se declara
 * para satisfacer la dependencia) y se reintenta. Si el CM vuelve a pedir
 * el MISMO producto que ya está en el carrito, no se insiste: quiere decir
 * que el mensaje apunta a otra cosa, y se corta explicándolo en vez de
 * girar en vacío.
 */
async function crearCarrito(items, ctx, res, aviso) {
    const lista = items.slice();
    const agregados = [];

    for (let intento = 1; intento <= MAX_DEPENDENCIAS + 1; intento++) {
        try {
            return await postCm("/api/v1/shoppingCart", {
                relatedParty: ctx.parte,
                cartItem: [{
                    action: "MODIFY", id: "00001", index: 0, itemGroupId: ctx.grupo,
                    productOffering: { id: ctx.oferta, quantity: 1, includedItems: lista },
                    note: [{ text: "", author: "" }]
                }],
                userData: ctx.userData, channel: [{ id: "DCRM" }]
            });
        } catch (e) {
            const cuerpo = String(e.cuerpo || e.message || "");
            const m = /Missing dependent product[^]*?product id\s*:\s*(\d+)/i.exec(cuerpo);
            if (!m) throw e;                       // otro error: sube tal cual
            const idFalta = m[1];

            if (lista.some(z => String(z.id) === idFalta)) {
                // Ya estaba: el mensaje no se refiere a que falte ESE.
                res.detalle = `El CM rechaza el carrito pidiendo el producto ${idFalta}, que ya va incluido `
                    + `(ERCRT1002). No se insiste. ${describirInventario(res, idFalta)}`;
                res.dependenciaIrresoluble = idFalta;
                return null;
            }
            if (agregados.length >= MAX_DEPENDENCIAS) {
                res.detalle = `El CM siguió pidiendo productos dependientes tras agregar ${agregados.length} `
                    + `(${agregados.join(", ")}). Se corta para no seguir a ciegas.`;
                return null;
            }

            lista.push({ id: idFalta, quantity: 1, action: "NO_CHANGE" });
            agregados.push(idFalta);
            res.dependencias = agregados.slice();
            MEUI.log(`· El CM pidió el producto dependiente ${idFalta}: se agrega al carrito como NO_CHANGE `
                + `y se reintenta. ${describirInventario(res, idFalta)}`, "warn");
            if (aviso) aviso(`Agregando dependencia ${idFalta} y reintentando el carrito…`);
        }
    }
    res.detalle = "no se pudo crear el carrito tras resolver dependencias";
    return null;
}

/** Qué se sabe de un productId, para que el aviso diga algo útil. */
function describirInventario(res, productId) {
    const inv = res && res.inventario;
    if (!inv) return "";
    if (inv.base.indexOf(String(productId)) >= 0) return `(${productId} es un servicio base del plan).`;
    const p = inv.porProducto[String(productId)];
    if (p) {
        return `(${productId} = paquete ${p.bundleId || "?"}${p.nombre ? " " + p.nombre : ""}`
            + `${p.opcional ? "" : ", que el CM marca como NO opcional"}).`;
    }
    return `(${productId} no viene en los productos que el CM listó para este plan: `
        + "por eso no estaba en el carrito).";
}

/**
 * Elimina los paquetes opcionales habilitados de la línea.
 * `esperados` son los bundleId que se vieron en la última consulta: si el
 * CM ya muestra otros, algo cambió por debajo y NO se opera a ciegas.
 */
async function eliminarPaquetes(fila, esperados, alPaso) {
    const aviso = p => { if (alPaso) alPaso(p); };
    const res = { ok: false, ordenId: null, estado: "", omitidos: [], eliminados: 0 };

    aviso("Comprobando que los paquetes no hayan cambiado…");
    const vivos = await cmPaquetes(fila.subscriberId);
    const idsVivos = [...new Set(vivos.map(b => b.bundleId))].sort().join(",");
    if (idsVivos !== [...new Set(esperados)].sort().join(",")) {
        res.detalle = "los paquetes cambiaron desde la consulta: actualiza y confirma de nuevo";
        return res;
    }
    if (!vivos.length) { res.detalle = "no hay paquetes activos para eliminar"; return res; }

    aviso("Leyendo el plan de la línea…");
    const perfil = await cmPerfil(fila.subscriberId);
    const rating = perfil.rating || {};
    const habilitados = (rating.enabledOptionalBundles || []).map(String);
    if (!habilitados.length) {
        res.detalle = "el CM no reporta paquetes opcionales habilitados: no se envía la orden";
        return res;
    }

    const ofertas = await getJson(`${CONFIG.apiBase}/api/v1/productOffering`,
        { offeringType: "PRICE_PLAN", primaryPricePlanId: String(rating.primaryPricePlanID) });
    if (!Array.isArray(ofertas) || ofertas.length !== 1) {
        res.detalle = "no se pudo determinar un único plan comercial para esta línea";
        return res;
    }
    const oferta = String(ofertas[0].productOfferingId);

    aviso("Resolviendo los productos del plan…");
    const base = (await postCm(`/api/v1/productOffering/${encodeURIComponent(oferta)}/selectableProducts`,
        { productTypeId: "PROD_COMP_TPS" }))?.selectableProducts || [];
    if (!base.length) { res.detalle = "no se pudieron determinar los servicios base del plan"; return res; }

    const opcionales = (await postCm(`/api/v1/productOffering/${encodeURIComponent(oferta)}/selectableProducts`, {
        productTypeId: "PROD_COMP_BDLE",
        selectedProducts: [{
            productTypeId: "PROD_COMP_TPS",
            products: base.map(x => ({ productId: String(x.productId) }))
        }]
    }))?.selectableProducts || [];

    const porBundle = {};
    opcionales.forEach(z => { porBundle[String(z?.attributes?.bundleId)] = z; });
    const faltantes = habilitados.filter(b => !porBundle[b]);
    if (faltantes.length) {
        res.detalle = "no se identificaron los productos de todos los paquetes: " + faltantes.join(", ");
        return res;
    }

    // Se omiten los no eliminables y los que el propio CM marca como no
    // opcionales: incluirlos haría fallar la orden entera.
    const omitidos = habilitados.filter(b => NO_ELIMINABLES[b] || porBundle[b].optional === false);
    res.omitidos = omitidos;

    const items = base.map(z => ({ id: String(z.productId), quantity: 1, action: "NO_CHANGE" }));
    habilitados.forEach(b => items.push({
        id: String(porBundle[b].productId), quantity: 1,
        action: omitidos.indexOf(b) >= 0 ? "NO_CHANGE" : "DELETE"
    }));

    // Inventario de lo que devolvió el CM: sirve para entender un
    // «Missing dependent product ... product id:N» (abajo), donde N puede
    // ser un producto que no está en enabledOptionalBundles y por eso no
    // entró al carrito.
    res.inventario = {
        base: base.map(z => String(z.productId)),
        porProducto: Object.fromEntries(opcionales.map(z => [
            String(z.productId),
            { bundleId: String(z?.attributes?.bundleId ?? ""), nombre: z.name || z.productName || "", opcional: z.optional !== false }
        ]))
    };
    if (!items.some(z => z.action === "DELETE")) {
        res.detalle = "solo quedan paquetes no eliminables u obligatorios del plan: " + omitidos.join(", ");
        res.sinNadaQueBorrar = true;
        return res;
    }

    const crm = await cmCuentaCrm(fila.ban);
    if (!crm.cuenta) { res.detalle = crm.aviso; return res; }
    const nombre = crm.cuenta.givenName, apellido = crm.cuenta.familyName;
    if (!nombre || !apellido) {
        res.detalle = "faltan nombres en la cuenta de facturación para crear el carrito";
        return res;
    }
    const iccid = String(perfil.profile?.cardPackageID || "");
    if (!iccid) { res.detalle = "no se encontró ICCID para la orden"; return res; }

    // itemGroupId de cuatro dígitos, consistente con los nombres
    // <grupo>_MSISDN / <grupo>_ICCID de userData.
    const grupo = String(Math.floor(Math.random() * 9000) + 1000);
    const userData = [
        ["EXISTING_PLAN_ID", String(rating.primaryPricePlanID)], ["CHANGE_PRICE_PLAN", false],
        ["SUBSCRIPTION_ID", fila.subscriberId], [`${grupo}_MSISDN`, fila.msisdn], ["SPID", "410"],
        ["SCHEDULE", "IMMEDIATE"], ["PAIDTYPE", String(perfil.profile?.paidType ?? "0")],
        [`${grupo}_ICCID`, iccid], ["orderType", "changeProduct"], ["type", "ChangeOffer"], ["CHANNEL", "0"]
    ].map(([name, value]) => ({ name, value }));
    const parte = [{ id: fila.ban, firstName: nombre, lastName: apellido, role: "Customer" }];

    aviso("Creando el carrito…");
    let carritoId = null;
    try {
        const carrito = await crearCarrito(items, { oferta, grupo, userData, parte }, res, aviso);
        carritoId = carrito?.id;
        if (!carritoId || !carrito.cartItem) {
            res.detalle = res.detalle || "el CM no devolvió un carrito válido";
            return res;
        }

        aviso("Enviando la orden de eliminación…");
        const orden = await postCm("/api/v1/productOrder", {
            notificationContact: "", channel: [{ id: "DCRM" }],
            relatedParty: carrito.relatedParty,
            productOrderItem: JSON.parse(JSON.stringify(carrito.cartItem)),
            note: carrito.cartItem[0].note || [],
            contactMedium: carrito.contactMedium || [],
            userData: carrito.userData.concat([
                { name: "AMOUNT_PAID", value: "0" }, { name: "AMOUNT", value: "0" },
                { name: "PAYMENT_METHOD", value: "" }
            ]),
            type: "ChangeOffer", atuBssTokenID: ""
        }, { "Transaction-Id": idTransaccion() });

        if (!orden?.id) {
            res.detalle = "la respuesta del CM no confirmó una orden: revisa el estado antes de repetir";
            return res;
        }
        res.ordenId = String(orden.id);

        aviso(`Orden ${res.ordenId}: esperando su estado…`);
        const fin = await cmEsperarOrden(fila.ban, res.ordenId, e => aviso(`Orden ${res.ordenId}: ${e}…`));
        res.estado = fin.estado;
        res.ok = fin.ok;
        res.detalle = fin.ok
            ? `Orden ${res.ordenId}: ${fin.estado}`
            : `Orden ${res.ordenId}: ${fin.estado}. ${fin.motivo}`;
        if (fin.ok) res.eliminados = items.filter(z => z.action === "DELETE").length;
        return res;
    } catch (e) {
        res.detalle = e.message || String(e);
        return res;
    } finally {
        // El carrito queda colgado si no se borra; que falle no cambia el
        // resultado de la orden, que ya está enviada.
        if (carritoId) {
            await apiCm("/api/v1/shoppingCart/" + encodeURIComponent(carritoId), { method: "DELETE" })
                .catch(() => { });
        }
    }
}

/* =====================================================================
   10 · SECUENCIA: 1 línea, N PLU, uno detrás de otro
   ---------------------------------------------------------------------
   Por cada PLU, en este orden:
     1. consultar el estado actual de la línea
     2. aplicar el PLU (agrega los bolsillos)
     3. esperar a que el CM lo refleje y anotar QUÉ y CUÁNTO entró
     4. eliminar los bolsillos que dejó ese PLU
     5. verificar que ya no estén, y seguir con el PLU siguiente

   Se hace de uno en uno a propósito: dos PLU a la vez sobre la misma
   línea mezclarían la evidencia y la eliminación de uno se llevaría los
   paquetes del otro.
===================================================================== */
/** Un PLU completo sobre una línea. Devuelve el renglón de la secuencia. */
async function correrPluSecuencia(fila, item, alPaso, cancelado) {
    const r = {
        msisdn: fila.msisdn, plu: item.plu, costo: item.costo, canal: item.canal,
        estado: "corriendo", paso: "", cambios: [], omitidos: [], restantes: [],
        inicio: Date.now()
    };
    const aviso = p => { r.paso = p; if (alPaso) alPaso(r); };

    try {
        // 1 · estado actual
        aviso("Consultando estado actual");
        const antes = await consultarLinea(fila.msisdn);
        if (antes.estado === "ERROR" || antes.estado === "NO_EXISTE") {
            throw new Error("no se pudo consultar la línea: " + (antes.detalle || "sin detalle"));
        }
        r.antes = antes;

        // 2 · aplicar el PLU
        aviso("Aplicando el PLU en Tulio");
        const tulio = await aplicarPlu(fila.msisdn, item.plu, item.costo, item.canal);
        r.httpStatus = tulio.httpStatus; r.codigo = tulio.codigo; r.evidencia = tulio.evidencia;
        if (!tulio.ok) throw new Error(tulio.detalle);

        // 3 · evidencia de lo que entró
        aviso("Esperando a que el CM muestre los bolsillos");
        await espera(CONFIG.esperaCmMs);
        const est = await esperarEstable(fila.msisdn, huellaPaquetes(antes),
            (i, n) => aviso(`Esperando al CM (${i}/${n})`));
        const despues = est.fila || antes;
        r.despues = despues;
        r.estable = est.estable;
        r.cambios = compararPaquetes(antes, despues);

        if (!r.cambios.length) {
            // Tulio dijo que sí y el CM no muestra nada: no se elimina a
            // ciegas, porque no se sabe qué tocaría borrar.
            r.estado = "aviso";
            r.detalle = "Tulio confirmó la recarga pero el CM no muestra bolsillos nuevos ni saldo sumado. "
                + "No se eliminó nada: revisa la línea antes de repetir este PLU.";
            return r;
        }

        if (cancelado && cancelado()) { r.estado = "cancelado"; r.detalle = "Secuencia detenida antes de eliminar."; return r; }

        // 4 · eliminar los bolsillos de ESTE PLU
        const objetivo = r.cambios.map(c => c.bundleId);
        const hayQueBorrar = (despues.paquetes || []).some(esEliminable);
        if (!hayQueBorrar) {
            r.estado = "aviso";
            r.detalle = "El PLU cargó, pero ninguno de los paquetes activos se puede eliminar "
                + "(no eliminables u obligatorios del plan).";
            return r;
        }
        aviso("Eliminando los bolsillos del PLU");
        const borrado = await eliminarPaquetes(despues,
            [...new Set((despues.paquetes || []).map(b => b.bundleId))],
            p => aviso(p));
        r.orden = borrado;
        r.omitidos = borrado.omitidos || [];
        if (!borrado.ok) throw new Error(borrado.detalle || "la eliminación no se confirmó");

        // 5 · verificar
        aviso("Verificando que ya no estén");
        await espera(CONFIG.esperaCmMs);
        const verif = await esperarEstable(fila.msisdn, huellaPaquetes(despues),
            (i, n) => aviso(`Verificando (${i}/${n})`));
        const final = verif.fila || despues;
        r.final = final;
        const activos = new Set((final.paquetes || []).map(b => b.bundleId));
        r.restantes = objetivo.filter(id => activos.has(id) &&
            (final.paquetes || []).some(b => b.bundleId === id && esEliminable(b)));
        r.noEliminables = objetivo.filter(id => activos.has(id) &&
            (final.paquetes || []).some(b => b.bundleId === id && !esEliminable(b)));

        if (r.restantes.length) {
            r.estado = "error";
            r.detalle = `${borrado.detalle}. Siguen activos: ${r.restantes.join(", ")}.`;
            return r;
        }
        r.estado = "ok";
        r.detalle = `${r.cambios.length} bolsillo(s) agregado(s) y eliminado(s)`
            + (r.noEliminables.length ? ` · ${r.noEliminables.length} no eliminable(s) siguen activos` : "")
            + (borrado.ordenId ? ` · orden ${borrado.ordenId}` : "");
        return r;
    } catch (e) {
        r.estado = "error";
        r.detalle = e.message || String(e);
        return r;
    } finally {
        r.fin = Date.now();
        r.paso = "";
    }
}

/* =====================================================================
   11 · EXPORTACIÓN
===================================================================== */
const CABECERA_EXPORT = ["MSISDN", "Estado", "SubscriptionID", "Cuenta (BAN)", "Cuenta CRM",
    "Titular", "Paquetes activos", "Avisos"];

function filasExport(filas) {
    return {
        head: CABECERA_EXPORT,
        rows: filas.map(f => [
            f.msisdn, f.estado, f.subscriberId || "", f.ban || "", f.cuentaCrm || "",
            f.titular || "", (f.paquetes || []).length, (f.avisos || []).join(" · ")
        ])
    };
}

/** Evidencia de una secuencia: una fila por cada bolsillo que cambió. */
const CABECERA_SECUENCIA = ["#", "MSISDN", "PLU", "Costo", "Canal", "Resultado", "Detalle",
    "Orden de eliminación", "Estado de la orden", "Paquete", "Tipo", "Total", "Valor anterior",
    "Valor agregado", "Unidad", "Siguió activo"];

function filasSecuencia(msisdn, items) {
    const rows = [];
    items.forEach((r, i) => {
        const orden = r.orden || {};
        const base = [i + 1, msisdn, r.plu, r.costo, r.canal, r.estado || "", r.detalle || "",
            orden.ordenId || "", orden.estado || ""];
        if (!(r.cambios || []).length) { rows.push([...base, "", "", "", "", "", "", ""]); return; }
        const restantes = new Set(r.restantes || []);
        r.cambios.forEach(c => rows.push([...base,
            `${c.bundleId} ${c.nombre}`, c.tipo === "NUEVO" ? "Paquete nuevo" : "Se sumó saldo",
            enUnidad(c.total, c.unitType), enUnidad(c.anterior, c.unitType),
            enUnidad(c.agregado, c.unitType), unidadPaquete(c.unitType),
            restantes.has(c.bundleId) ? "SÍ — no se eliminó" : "no"]));
    });
    return { head: CABECERA_SECUENCIA, rows };
}

const CABECERA_BITACORA = ["Fecha/hora", "Usuario", "MSISDN", "PLU", "Costo", "Canal",
    "Resultado", "HTTP", "Código", "Detalle", "Paquete", "Tipo", "Total", "Valor anterior", "Valor agregado", "Unidad"];

/** Una fila de bitácora por CAMBIO (y una sola si no hubo ninguno). */
function filasBitacora(bitacora) {
    const rows = [];
    bitacora.forEach(b => {
        const base = [b.hora, b.usuario, b.msisdn, b.plu, b.costo, b.canal,
            b.ok ? "OK" : "FALLA", b.httpStatus ?? "", b.codigo ?? "", b.detalle || ""];
        if (!(b.cambios || []).length) { rows.push([...base, "", "", "", "", "", ""]); return; }
        b.cambios.forEach(c => rows.push([...base,
            `${c.bundleId} ${c.nombre}`, c.tipo === "NUEVO" ? "Paquete nuevo" : "Se sumó saldo",
            enUnidad(c.total, c.unitType), enUnidad(c.anterior, c.unitType),
            enUnidad(c.agregado, c.unitType), unidadPaquete(c.unitType)]));
    });
    return { head: CABECERA_BITACORA, rows };
}
