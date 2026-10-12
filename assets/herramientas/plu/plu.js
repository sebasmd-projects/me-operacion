/* =====================================================================
   plu.js · Aplicar PLU de paquete (Tulio) sobre una línea del CM
   ---------------------------------------------------------------------
   Porte a navegador de la operación «Agregar PLU» de la consola local
   `consola_bundles_movil_exito` (que corría con un servidor Python para
   evitar CORS y guardar los tokens fuera del navegador). Aquí NO hay
   Python: solo HTML + JS + CSS, igual que el resto de la suite.

   Que se pueda hacer sin servidor no es una suposición: esta suite ya
   llama a `tulio.grupo-exito.com` desde el navegador en Prepagadas
   (`simeBase`) y a `tulioqa.grupo-exito.com` en las herramientas de HLR.
   El precio es que la API key y el client_secret de Tulio viajan en este
   archivo, igual que el client_secret del QDN en assets/herramientas/hlr-hss/claro.js: ver el
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

   Organización de este archivo:
     1 a 9b  Configuración y reglas de negocio
     10      Interfaz: sesión, tabla, modal, secuencia y exportaciones
             (enganche con el shell MEUI)

   Lo que comparte con las demás herramientas NO está aquí:
     · marco visual, sesión, registro, tablas, exportación → me-ui.js
     · Keycloak, auth y GET autenticado al CM              → me-api.js
     · token y RecargaPaquete de Tulio                     → compartido/tulio-plu.js
===================================================================== */

/* =====================================================================
   1 · CONFIGURACIÓN
===================================================================== */
const CONFIG = {
    get apiBase() { return MEAPI.CONFIG.apiBase; },

    // Tulio (endpoints, credenciales, token): assets/compartido/tulio-plu.js.
    get canalPorDefecto() { return TulioPLU.CONFIG.canalPorDefecto; },
    get costoPorDefecto() { return TulioPLU.CONFIG.costoPorDefecto; },

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

/* Etapas de cada operación, en orden. Los avisos de progreso se refieren
   a ellas por índice (r.etapa); `etapasDe` devuelve las de una fila. */
const ETAPAS_PLU = ["Consultar", "Aplicar PLU", "Evidencia", "Eliminar", "Verificar"];
const ETAPAS_LIMPIEZA = ["Consultar", "Eliminar", "Verificar"];
const etapasDe = r => r.etapas || ETAPAS_PLU;


const auth = MEAPI.auth;
const getJson = MEAPI.getJson;

const soloDigitos = s => String(s == null ? "" : s).replace(/\D/g, "");
const escHtml = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Usuario de la sesión del CM (el que queda en la nota y en la bitácora). */
const usuarioOperador = () => TulioPLU.usuario();
/** Sesión del CM vigente (no hay lista de usuarios). */
const puedeAgregarPlu = () => TulioPLU.puede();
/** Por qué no se puede aplicar PLU (texto para la interfaz), o "". */
const motivoSinPlu = () => TulioPLU.motivo();
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

        // La consulta de suscriptores no trae el IMSI: sale de la SIM (cardPackage).
        const [paquetes, imsi] = await Promise.all([cmPaquetes(c.subscriberId), MEAPI.imsi(c.iccid)]);
        fila.paquetes = paquetes;
        fila.imsi = imsi;
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
   4 · TOKEN Y RECARGA EN TULIO → assets/compartido/tulio-plu.js (compartido)
===================================================================== */
const idTransaccion = TulioPLU.idTransaccion;
/** Aplica el PLU en Tulio como el usuario de la sesión. */
const aplicarPlu = (msisdn, plu, costo, canal) => TulioPLU.aplicar(msisdn, plu, costo, canal, usuarioOperador());

/* =====================================================================
   5 · ESPERAR A QUE EL CM REFLEJE EL CAMBIO
===================================================================== */
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
   6 · COMPARACIÓN ANTES / DESPUÉS  ←  el cuadro de «cuánto se sumó»
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
   7 · ELIMINAR LOS PAQUETES (orden ChangeOffer del CM)
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

/** Cuerpo de un error del CM para la evidencia: el JSON si lo es, o el texto. */
function respuestaDeError(e) {
    const crudo = String(e?.cuerpo || "");
    try { return JSON.parse(crudo); } catch (x) { return { httpStatus: e?.status || null, text: crudo || (e?.message || String(e)) }; }
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
        // Se guarda la petición y la respuesta del ÚLTIMO intento: es la
        // que va a la evidencia (Excel), también cuando falla.
        const pedido = {
            relatedParty: ctx.parte,
            cartItem: [{
                action: "MODIFY", id: "00001", index: 0, itemGroupId: ctx.grupo,
                productOffering: { id: ctx.oferta, quantity: 1, includedItems: lista.slice() },
                note: [{ text: "", author: "" }]
            }],
            userData: ctx.userData, channel: [{ id: "DCRM" }]
        };
        res.evidencia = res.evidencia || {};
        res.evidencia.cart = { request: pedido };
        try {
            const r = await postCm("/api/v1/shoppingCart", pedido);
            res.evidencia.cart.response = r;
            return r;
        } catch (e) {
            res.evidencia.cart.response = respuestaDeError(e);
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
        const pedidoOrden = {
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
        };
        res.evidencia.order = { request: pedidoOrden };
        let orden;
        try {
            orden = await postCm("/api/v1/productOrder", pedidoOrden, { "Transaction-Id": idTransaccion() });
            res.evidencia.order.response = orden;
        } catch (e) {
            res.evidencia.order.response = respuestaDeError(e);
            throw e;
        }

        if (!orden?.id) {
            res.detalle = "la respuesta del CM no confirmó una orden: revisa el estado antes de repetir";
            return res;
        }
        res.ordenId = String(orden.id);

        aviso(`Orden ${res.ordenId}: esperando su estado…`);
        const fin = await cmEsperarOrden(fila.ban, res.ordenId, e => aviso(`Orden ${res.ordenId}: ${e}…`));
        if (fin.orden) res.evidencia.finalOrder = fin.orden;
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
   8 · SECUENCIA: 1 línea, N PLU, uno detrás de otro
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
/** Un PLU completo sobre una línea. Devuelve el renglón de la secuencia.
    opciones.eliminar (por defecto true): después de cargarlo, eliminar los
    bolsillos. En false, el PLU termina en «Evidencia» y los bolsillos
    quedan en la línea. */
async function correrPluSecuencia(fila, item, alPaso, cancelado, opciones) {
    const eliminar = !opciones || opciones.eliminar !== false;
    const r = {
        msisdn: fila.msisdn, plu: item.plu, costo: item.costo, canal: item.canal,
        estado: "corriendo", paso: "", cambios: [], omitidos: [], restantes: [],
        etapas: eliminar ? ETAPAS_PLU : ETAPAS_PLU.slice(0, 3), sinEliminar: !eliminar,
        inicio: Date.now()
    };
    /* Cada aviso dice en qué ETAPA va (índice de ETAPAS_PLU) y, opcional,
       cuánto de esa etapa lleva (0..1). Sin etapa se queda en la actual:
       así los avisos internos de la eliminación o de las esperas avanzan
       la barra dentro de la misma etapa sin tener que conocerla. */
    const aviso = (p, etapa, fraccion) => {
        r.paso = p;
        if (etapa != null && etapa !== r.etapa) { r.etapa = etapa; r.fraccion = 0; }
        if (fraccion != null) r.fraccion = Math.max(r.fraccion || 0, Math.min(1, fraccion));
        if (alPaso) alPaso(r);
    };
    r.etapa = 0; r.fraccion = 0;

    try {
        // 1 · estado actual
        aviso("Consultando estado actual", 0);
        const antes = await consultarLinea(fila.msisdn);
        if (antes.estado === "ERROR" || antes.estado === "NO_EXISTE") {
            throw new Error("no se pudo consultar la línea: " + (antes.detalle || "sin detalle"));
        }
        r.antes = antes;

        // 2 · aplicar el PLU
        aviso("Aplicando el PLU en Tulio", 1);
        const tulio = await aplicarPlu(fila.msisdn, item.plu, item.costo, item.canal);
        r.httpStatus = tulio.httpStatus; r.codigo = tulio.codigo; r.evidencia = tulio.evidencia;
        if (!tulio.ok) throw new Error(tulio.detalle);

        // 3 · evidencia de lo que entró
        aviso("Esperando a que el CM muestre los bolsillos", 2);
        await espera(CONFIG.esperaCmMs);
        const est = await esperarEstable(fila.msisdn, huellaPaquetes(antes),
            (i, n) => aviso(`Esperando al CM (${i}/${n})`, 2, i / n));
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

        if (!eliminar) {
            r.estado = "ok";
            r.final = despues;
            r.detalle = `${r.cambios.length} bolsillo(s) agregado(s). No se eliminan: «eliminar después de cada PLU» está desmarcado.`;
            return r;
        }

        if (cancelado && cancelado()) { r.estado = "cancelado"; r.detalle = "Secuencia detenida antes de eliminar."; return r; }

        // 4 · eliminar los bolsillos de ESTE PLU
        r.etapa = 3; r.fraccion = 0;
        const objetivo = r.cambios.map(c => c.bundleId);
        const hayQueBorrar = (despues.paquetes || []).some(esEliminable);
        if (!hayQueBorrar) {
            r.estado = "aviso";
            r.detalle = "El PLU cargó, pero ninguno de los paquetes activos se puede eliminar "
                + "(no eliminables u obligatorios del plan).";
            return r;
        }
        aviso("Eliminando los bolsillos del PLU", 3);
        // La eliminación tiene unos siete avisos propios (plan, productos,
        // carrito, orden, estado…): cada uno avanza un tramo de la etapa.
        let subpasos = 0;
        const borrado = await eliminarPaquetes(despues,
            [...new Set((despues.paquetes || []).map(b => b.bundleId))],
            p => aviso(p, 3, Math.min(0.95, ++subpasos / 8)));
        r.orden = borrado;
        r.omitidos = borrado.omitidos || [];
        if (!borrado.ok) throw new Error(borrado.detalle || "la eliminación no se confirmó");

        // 5 · verificar
        aviso("Verificando que ya no estén", 4);
        await espera(CONFIG.esperaCmMs);
        const verif = await esperarEstable(fila.msisdn, huellaPaquetes(despues),
            (i, n) => aviso(`Verificando (${i}/${n})`, 4, i / n));
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

/** Deja la línea SIN bolsillos eliminables (antes de empezar o al terminar
    la secuencia). Usa la misma orden ChangeOffer que la eliminación de cada
    PLU, sobre lo que la línea tenga en ese momento. */
async function limpiarLinea(fila, titulo, alPaso) {
    const r = {
        msisdn: fila.msisdn, plu: "—", costo: "", canal: "", limpieza: true, titulo,
        estado: "corriendo", paso: "", cambios: [], omitidos: [], restantes: [],
        etapas: ETAPAS_LIMPIEZA, inicio: Date.now(), etapa: 0, fraccion: 0
    };
    const aviso = (p, etapa, fraccion) => {
        r.paso = p;
        if (etapa != null && etapa !== r.etapa) { r.etapa = etapa; r.fraccion = 0; }
        if (fraccion != null) r.fraccion = Math.max(r.fraccion || 0, Math.min(1, fraccion));
        if (alPaso) alPaso(r);
    };
    try {
        aviso("Consultando los bolsillos de la línea", 0);
        const actual = await consultarLinea(fila.msisdn);
        if (actual.estado === "ERROR" || actual.estado === "NO_EXISTE") {
            throw new Error("no se pudo consultar la línea: " + (actual.detalle || "sin detalle"));
        }
        r.antes = actual;
        const eliminables = (actual.paquetes || []).filter(esEliminable);
        if (!eliminables.length) {
            r.estado = "ok"; r.final = actual;
            r.detalle = "La línea no tenía bolsillos eliminables: no se envió ninguna orden.";
            return r;
        }
        aviso(`Eliminando ${eliminables.length} bolsillo(s)`, 1);
        let subpasos = 0;
        const borrado = await eliminarPaquetes(actual,
            [...new Set((actual.paquetes || []).map(b => b.bundleId))],
            p => aviso(p, 1, Math.min(0.95, ++subpasos / 8)));
        r.orden = borrado;
        r.omitidos = borrado.omitidos || [];
        if (!borrado.ok) throw new Error(borrado.detalle || "la eliminación no se confirmó");

        aviso("Verificando que ya no estén", 2);
        await espera(CONFIG.esperaCmMs);
        const verif = await esperarEstable(fila.msisdn, huellaPaquetes(actual),
            (i, n) => aviso(`Verificando (${i}/${n})`, 2, i / n));
        const final = verif.fila || actual;
        r.final = final;
        r.restantes = (final.paquetes || []).filter(esEliminable).map(b => b.bundleId);
        if (r.restantes.length) {
            r.estado = "error";
            r.detalle = `${borrado.detalle}. Siguen activos: ${r.restantes.join(", ")}.`;
            return r;
        }
        r.estado = "ok";
        r.detalle = `${eliminables.length} bolsillo(s) eliminado(s)` + (borrado.ordenId ? ` · orden ${borrado.ordenId}` : "");
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
   8b · PINTADO DE LA SECUENCIA: bolsillos plegables
===================================================================== */
/** Cantidad corta para el resumen plegado: en datos, directo en MB/GB. */
function cantidadCorta(valor, unitType) {
    const legible = fmtCantidadLegible(valor, unitType);
    const m = /\(([^)]+)\)\s*$/.exec(legible);
    return m ? m[1] : legible;
}

/**
 * Bolsillos de un PLU, plegables. El resumen dice cuántos y cuánto sumó
 * cada uno sin abrirlo; los cuadros completos (total / anterior /
 * agregado) quedan adentro. Plegado por defecto: en una secuencia de
 * muchos PLU los cuadros abiertos empujan la lista fuera de la pantalla.
 */
function bolsillosPlegablesHTML(r, i, abierto) {
    const cambios = r.cambios || [];
    if (!cambios.length) return "";
    const resumen = cambios.map(c => `${c.bundleId} +${cantidadCorta(c.agregado, c.unitType)}`).join(" · ");
    const restantes = new Set(r.restantes || []);
    const quedaron = cambios.filter(c => restantes.has(c.bundleId)).length;
    return `<details class="seq-paquetes" data-idx="${i}" ${abierto ? "open" : ""}>
        <summary>
            <span class="seq-paquetes-n">${cambios.length} bolsillo${cambios.length === 1 ? "" : "s"}</span>
            <span class="seq-paquetes-res">${escHtml(resumen)}</span>
            ${quedaron ? `<span class="seq-paquetes-alerta">${quedaron} siguió activo</span>` : ""}
        </summary>
        <div class="plu-cambios mt-2">${cambios.map(cuadroCambioHTML).join("")}</div>
    </details>`;
}

/* =====================================================================
   9 · EXPORTACIÓN
===================================================================== */
const CABECERA_EXPORT = ["MSISDN", "Estado", "IMSI", "SubscriptionID", "Cuenta (BAN)", "Cuenta CRM",
    "Titular", "Paquetes activos", "Avisos"];

function filasExport(filas) {
    return {
        head: CABECERA_EXPORT,
        rows: filas.map(f => [
            f.msisdn, f.estado, f.imsi || "", f.subscriberId || "", f.ban || "", f.cuentaCrm || "",
            f.titular || "", (f.paquetes || []).length, (f.avisos || []).join(" · ")
        ])
    };
}

/* =====================================================================
   9b · EVIDENCIA EN EXCEL (mismo formato que la consola)
   ---------------------------------------------------------------------
   `evidencias_plu_AAAAMMDD_HHMM.xlsx`, igual que el que descargaba la
   consola `consola_bundles_movil_exito` (exportEvidence de su app.js):

     Resumen           una fila por PLU
     «NN PLU xxxx»     una hoja por PLU: datos, paquetes activados (con el
                       asignado antes), eliminados (valores al momento de
                       eliminar), no eliminables, activos en cada fase y el
                       request/response de Tulio y del CM

   Mismas columnas, mismos títulos de bloque y mismos anchos. Datos en kb
   y voz en minutos, como la tabla del CM. Las cabeceras con token o API
   key no se guardan: solo van los cuerpos.
===================================================================== */
const GRUPO_XLS = { "0": "Voz", "1": "Datos", "2": "SMS" };
const UNIDAD_XLS = { "0": "minutos", "1": "kb", "2": "mensajes", "3": "unidades", "4": "unidades" };
const ETIQUETA_XLS = { espera: "En cola", corriendo: "En curso", ok: "Correcto", aviso: "Con novedad", error: "Error", cancelado: "Cancelado" };

const fechaXls = x => {
    if (!x) return "";
    const d = new Date(x);
    return isNaN(d) ? String(x) : new Intl.DateTimeFormat("es-CO",
        { dateStyle: "medium", timeStyle: "medium", timeZone: "America/Bogota" }).format(d);
};

/** Un renglón por saldo de cada paquete, en las unidades de la tabla del CM. */
function saldosXls(fila) {
    return (fila?.paquetes || []).flatMap(b => (b.balances?.length ? b.balances : [{}]).map(bal => {
        const suma = (a, c) => enUnidad(Number(bal[a] || 0) + Number(bal[c] || 0), b.unitType);
        return {
            b, grupo: GRUPO_XLS[b.unitType] || "Otro", unidad: UNIDAD_XLS[b.unitType] || b.unitType || "—",
            asignado: suma("personalLimit", "groupLimit"), usado: suma("personalUsed", "groupUsed"),
            disponible: suma("personalBalance", "groupBalance"),
            rollAsignado: enUnidad(bal.rolloverLimit, b.unitType), rollUsado: enUnidad(bal.rolloverUsed, b.unitType),
            rollDisponible: enUnidad(bal.rolloverBalance, b.unitType)
        };
    }));
}

/** Lo que va a las hojas de un PLU, derivado de su renglón de la secuencia. */
function datosEvidencia(r) {
    const cargados = new Set((r.cambios || []).map(c => c.bundleId));
    const tipoCarga = Object.fromEntries((r.cambios || []).map(c => [c.bundleId, c.tipo === "NUEVO" ? "Nuevo" : "Se sumó saldo"]));
    const antesPorId = new Map((r.antes?.paquetes || []).map(b => [b.bundleId, b]));
    const tras = saldosXls(r.despues);

    const activados = tras.filter(x => cargados.has(x.b.bundleId)).map(x => {
        const previo = antesPorId.get(x.b.bundleId);
        return Object.assign({}, x, {
            carga: tipoCarga[x.b.bundleId] || "",
            asignadoAntes: previo ? enUnidad(totalAsignado(previo), previo.unitType) : null
        });
    });
    // Eliminados: los que estaban tras el PLU y ya no están tras eliminar.
    const quedan = new Set((r.final?.paquetes || []).map(b => b.bundleId));
    const eliminados = r.final ? tras.filter(x => !quedan.has(x.b.bundleId)) : [];
    const noElim = new Set(r.noEliminables || []);
    const conservados = saldosXls(r.final).filter(x => noElim.has(x.b.bundleId));

    const tulio = r.evidencia || {}, cm = r.orden?.evidencia || {};
    const intercambios = [
        ["Tulio · RecargaPaquete · Request", tulio.request], ["Tulio · RecargaPaquete · Response", tulio.response],
        ["CM · shoppingCart · Request", cm.cart?.request], ["CM · shoppingCart · Response", cm.cart?.response],
        ["CM · productOrder · Request", cm.order?.request], ["CM · productOrder · Response", cm.order?.response],
        ["CM · Orden final (estado e historial)", cm.finalOrder]
    ].filter(([, d]) => d !== undefined);
    return { cargados, activados, eliminados, conservados, intercambios };
}

function textoTulio(r) {
    const e = r.evidencia?.response?.cabeceraSalida?.estado;
    return e ? `${e.estado} · ${e.descripcion || ""}` : "";
}
function textoOrden(r) {
    if (r.orden?.ordenId) return `${r.orden.ordenId} · ${r.orden.estado || ""}`;
    const f = r.orden?.evidencia?.finalOrder;
    return f ? `${f.id} · ${f.state || ""}` : "";
}
const pasoConFalla = r => r.estado === "error" ? (etapasDe(r)[r.etapa] || "") : "";
const duracionS = r => r.inicio ? Math.round(((r.fin || Date.now()) - r.inicio) / 1000) : "";
const listaPaquetes = xs => xs.map(x => `${x.b.bundleId} ${x.b.nombre}`).join("; ");

/**
 * Arma y descarga el libro. `items` son los renglones de la secuencia
 * (los de correrPluSecuencia) y `linea` la línea sobre la que corrió.
 */
function descargarEvidenciaXlsx(linea, items) {
    if (typeof XLSX === "undefined") throw new Error("no cargó la librería de Excel (SheetJS)");
    const resumen = [["#", "Línea", "PLU", "Costo", "Canal", "Estado", "Paso con falla", "Detalle", "Inicio", "Fin",
        "Duración (s)", "Suscripción", "Respuesta Tulio", "Paquetes activados", "Detalle de activados",
        "Paquetes eliminados", "Detalle de eliminados", "No eliminables", "Orden de eliminación", "Paquetes remanentes"]];
    items.forEach((r, i) => {
        const d = datosEvidencia(r);
        resumen.push([i + 1, linea, r.limpieza ? r.titulo : r.plu, r.limpieza ? "" : Number(r.costo), r.canal, ETIQUETA_XLS[r.estado] || r.estado || "",
            pasoConFalla(r), r.detalle || "", fechaXls(r.inicio), fechaXls(r.fin), duracionS(r),
            r.antes?.subscriberId || "", textoTulio(r),
            r.cambios ? d.activados.length : "", listaPaquetes(d.activados),
            r.final ? d.eliminados.length : "", listaPaquetes(d.eliminados), listaPaquetes(d.conservados),
            textoOrden(r), (r.restantes || []).join("; ")]);
    });

    const wb = XLSX.utils.book_new();
    const hojaRes = XLSX.utils.aoa_to_sheet(resumen);
    hojaRes["!cols"] = [4, 12, 10, 8, 14, 10, 14, 50, 22, 22, 11, 16, 26, 10, 60, 10, 60, 30, 26, 30].map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, hojaRes, "Resumen");
    const usados = new Set(["Resumen"]);

    const COLS_SALDO = ["Asignado", "Usado", "Disponible", "Rollover asignado", "Rollover usado", "Rollover disponible", "Unidad", "Inicio", "Fin"];
    const saldo = x => [x.asignado, x.usado, x.disponible, x.rollAsignado, x.rollUsado, x.rollDisponible, x.unidad,
        fechaXls(x.b.inicio), fechaXls(x.b.fin)];

    items.forEach((r, i) => {
        if (!r.antes || r.limpieza) return;      // no se llegó a consultar, o es una limpieza (va en el Resumen)
        const d = datosEvidencia(r);
        const aoa = [
            ["Línea", linea], ["PLU", r.plu], ["Costo", Number(r.costo)], ["Canal", r.canal],
            ["Estado", ETIQUETA_XLS[r.estado] || r.estado || ""], ["Paso con falla", pasoConFalla(r)],
            ["Detalle", r.detalle || ""], ["Suscripción", r.antes.subscriberId || ""],
            ["Inicio", fechaXls(r.inicio)], ["Fin", fechaXls(r.fin)],
            ["Respuesta Tulio", textoTulio(r)], ["Orden de eliminación", textoOrden(r)], [],
            ["PAQUETES ACTIVADOS POR EL PLU"],
            ["Carga", "ID paquete", "Paquete", "Tipo", "Asignado antes", ...COLS_SALDO]
        ];
        d.activados.forEach(x => aoa.push([x.carga, x.b.bundleId, x.b.nombre, x.grupo, x.asignadoAntes ?? "", ...saldo(x)]));
        if (!d.activados.length) aoa.push(["", "", "Sin paquetes activados"]);

        aoa.push([], ["PAQUETES ELIMINADOS (valores al momento de eliminar)"], ["ID paquete", "Paquete", "Tipo", ...COLS_SALDO]);
        d.eliminados.forEach(x => aoa.push([x.b.bundleId, x.b.nombre, x.grupo, ...saldo(x)]));
        if (!d.eliminados.length) aoa.push(["", "Sin paquetes eliminados"]);

        if (d.conservados.length) {
            aoa.push([], ["PAQUETES NO ELIMINABLES (el CM no permite darlos de baja; siguen activos)"],
                ["ID paquete", "Paquete", "Tipo", ...COLS_SALDO]);
            d.conservados.forEach(x => aoa.push([x.b.bundleId, x.b.nombre, x.grupo, ...saldo(x)]));
        }

        aoa.push([], ["PAQUETES ACTIVOS POR FASE"],
            ["Fase", "Activado por el PLU", "ID paquete", "Paquete", "Tipo", ...COLS_SALDO]);
        [["Consulta inicial", r.antes], ["Tras aplicar el PLU", r.despues], ["Tras eliminar", r.final]].forEach(([fase, fila]) => {
            if (!fila) { aoa.push([fase, "", "", "No se llegó a este paso"]); return; }
            const filas = saldosXls(fila);
            if (!filas.length) aoa.push([fase, "", "", "Sin paquetes activos"]);
            filas.forEach(x => aoa.push([fase, d.cargados.has(x.b.bundleId) ? "Sí" : "No", x.b.bundleId, x.b.nombre, x.grupo, ...saldo(x)]));
        });

        aoa.push([], ["REQUEST / RESPONSE"]);
        if (!d.intercambios.length) aoa.push(["Sin llamadas registradas"]);
        d.intercambios.forEach(([titulo, datos]) => {
            aoa.push([], [titulo]);
            JSON.stringify(datos, null, 2).split("\n").forEach(l => aoa.push([l]));
        });

        const hoja = XLSX.utils.aoa_to_sheet(aoa);
        hoja["!cols"] = [22, 12, 34, 10, 12, 12, 10, 12, 12, 12, 12, 10, 22, 22].map(wch => ({ wch }));
        let nombre = `${String(i + 1).padStart(2, "0")} PLU ${r.plu}`.slice(0, 31);
        while (usados.has(nombre)) nombre = nombre.slice(0, 29) + "_" + usados.size;
        usados.add(nombre);
        XLSX.utils.book_append_sheet(wb, hoja, nombre);
    });

    const ahora = new Date(), dd = x => String(x).padStart(2, "0");
    const archivo = `evidencias_plu_${ahora.getFullYear()}${dd(ahora.getMonth() + 1)}${dd(ahora.getDate())}_${dd(ahora.getHours())}${dd(ahora.getMinutes())}.xlsx`;
    XLSX.writeFile(wb, archivo);
    return { archivo, hojas: wb.SheetNames };
}

/** Evidencia de una secuencia: una fila por cada bolsillo que cambió. */
const CABECERA_SECUENCIA = ["#", "MSISDN", "PLU", "Costo", "Canal", "Resultado", "Detalle",
    "Orden de eliminación", "Estado de la orden", "Paquete", "Tipo", "Total", "Valor anterior",
    "Valor agregado", "Unidad", "Siguió activo"];

function filasSecuencia(msisdn, items) {
    const rows = [];
    items.forEach((r, i) => {
        const orden = r.orden || {};
        const base = [i + 1, msisdn, r.limpieza ? r.titulo : r.plu, r.costo, r.canal, r.estado || "", r.detalle || "",
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

/* =====================================================================
   10 · INTERFAZ: SESIÓN, TABLA, MODAL, SECUENCIA Y EXPORTACIONES
   ---------------------------------------------------------------------
   Enganche con el shell (MEUI): la sesión del CM, la tabla, el modal de
   detalle, la confirmación previa de la recarga y las exportaciones. Las
   reglas de negocio están arriba, en las secciones 1 a 9b.
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    let filas = [];                 // una por línea consultada
    let dataTable = null;
    let msisdnAbierto = null;
    const bitacora = [];            // una entrada por recarga ejecutada
    let corriendo = false;

    /* --- 1 · Sesión del CM ------------------------------------------- */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
            return false;
        }
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("user").value.trim(), clave: el("pass").value });
            MEUI.aplicarAperturaPasos();
            pintarPermiso();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", e => {
        if (e.detail.clave === "cm") el("btnLogin").click();
    });
    document.addEventListener("me:sesion-renovar", e => {
        if (e.detail.clave === "cm" && auth.token) {
            auth.reauth(auth.version).catch(err => MEUI.log("No se pudo renovar: " + err.message, "err"));
        }
    });
    document.addEventListener("me:sesion-cerrar", e => {
        if (e.detail.clave !== "cm") return;
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        if (el("pass")) el("pass").value = "";
        pintarPermiso();
    });
    // Entrar, vencer o salir cambia si se puede recargar o no.
    document.addEventListener("me:sesion-cambio", e => {
        if (!e.detail || e.detail.clave === "cm") { pintarPermiso(); render(); }
    });

    const credCm = MEUI.cred.get("cm");
    if (credCm) {
        if (!el("user").value) el("user").value = credCm.usuario || "";
        if (!el("pass").value) el("pass").value = credCm.clave || "";
    }
    if (el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true);
    } else {
        MEUI.log("Sin sesión del CM: inicia sesión en el paso 1 para consultar.");
    }

    /* --- 2 · Permiso para aplicar PLU -------------------------------- */
    function pintarPermiso() {
        const listo = listoParaPlu();
        const aviso = el("pluBloqueado");
        el("pluCampos").hidden = !listo;
        aviso.hidden = listo;
        if (!listo) {
            aviso.innerHTML = `<b>Solo consulta.</b> No se puede aplicar PLU: ${MEUI.esc(motivoSinPlu())}. `
                + "Los paquetes de cada línea sí se pueden ver.";
        }
    }
    pintarPermiso();


    /* --- 3 · Entrada de líneas -------------------------------------- */
    // MEUI.parseLineas devuelve { lineas, descartadas } y ya deduplica y
    // quita el indicativo 57: se le pide el largo de un móvil (10).
    function lineasEscritas() {
        return MEUI.parseLineas(el("inputLineas").value, { min: 10, max: 10 });
    }
    function pintarInfoLineas() {
        const e = lineasEscritas();
        el("infoLineas").textContent =
            `${e.lineas.length} línea(s) válida(s) · ${e.descartadas.length} descartada(s)`
            + ` · máximo ${CONFIG.maxLineas}`;
    }
    el("inputLineas").addEventListener("input", pintarInfoLineas);
    pintarInfoLineas();
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 4 · Consulta -----------------------------------------------
       MEUI.autoSpinner deja el botón ocupado y espera a que la
       herramienta le ponga `disabled = false` para liberarlo: si no se
       hace, el spinner se queda girando (hasta su red de seguridad de 15
       min). Por eso el `finally` de abajo NO es opcional.
    --------------------------------------------------------------------- */
    function liberarConsultar() {
        const b = el("btnConsultar");
        // autoSpinner observa el cambio de `disabled`; con dos frames se
        // asegura que el observer ya corrió antes de seguir.
        b.disabled = false;
    }

    el("btnConsultar").addEventListener("click", async () => {
        if (corriendo) { liberarConsultar(); return; }
        const entrada = lineasEscritas();
        if (!entrada.lineas.length) { MEUI.toast("No hay líneas válidas.", "warn"); liberarConsultar(); return; }
        if (entrada.lineas.length > CONFIG.maxLineas) {
            MEUI.toast(`Máximo ${CONFIG.maxLineas} líneas por consulta.`, "warn"); liberarConsultar(); return;
        }
        if (!auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); liberarConsultar(); return; }

        corriendo = true;
        try {
            MEUI.log(`Consultando ${entrada.lineas.length} línea(s)…`);
            if (entrada.descartadas.length) {
                MEUI.log("No se consultan (no son móviles de 10 dígitos): "
                    + entrada.descartadas.slice(0, 15).join(", ")
                    + (entrada.descartadas.length > 15 ? "…" : ""), "warn");
            }

            filas = entrada.lineas.map(m => ({ msisdn: m, estado: "PENDING", paquetes: [], cuentas: [], avisos: [] }));
            render();

            await consultarFilas(filas.slice());
            resumen();
        } catch (e) {
            MEUI.log("✖ " + (e.message || e), "err");
            MEUI.toast("Falló la consulta. Mira el registro.", "err");
            MEUI.estadoTabla("#tablaResultados", "error", { reintentar: () => el("btnConsultar").click() });
            MEUI.progreso.fin({ fallidas: 1 });
        } finally {
            corriendo = false;
            liberarConsultar();
        }
    });

    async function consultarFilas(pendientes) {
        MEUI.progreso.iniciar(pendientes.length, "Consultar líneas");
        MEUI.estadoTabla("#tablaResultados", "cargando");
        let hechas = 0;
        for (const pendiente of pendientes) {
            const i = filas.findIndex(f => f.msisdn === pendiente.msisdn);
            try { filas[i] = await consultarLinea(pendiente.msisdn); }
            catch (e) { filas[i] = { ...pendiente, estado: "ERROR", detalle: e.message }; }
            MEUI.progreso.avanzar(++hechas);
            render();
        }
        const fallidas = filas.filter(f => f.estado === "ERROR");
        MEUI.estadoTabla("#tablaResultados", filas.length ? "listo" : "vacio");
        MEUI.progreso.fin({ fallidas: fallidas.length, reintentar: async () => {
            if (corriendo) return;
            corriendo = true;
            try { await consultarFilas(fallidas); resumen(); }
            finally { corriendo = false; }
        } });
    }

    function resumen() {
        const ok = filas.filter(f => f.estado === "OK").length;
        const conAviso = filas.filter(f => (f.avisos || []).length).length;
        el("estadoTabla").textContent =
            `${filas.length} línea(s) · ${ok} activa(s) · `
            + `${filas.reduce((n, f) => n + (f.paquetes || []).length, 0)} paquetes activos`
            + (conAviso ? ` · ${conAviso} con avisos` : "");
        MEUI.log(`Consulta terminada: ${ok} de ${filas.length} línea(s) activas.`, "ok");
    }

    /* --- 5 · Tabla --------------------------------------------------- */
    const CLASE_ESTADO = {
        OK: "ok", INACTIVA: "off", NO_EXISTE: "err", ERROR: "err", PENDING: "neutro"
    };
    const TEXTO_ESTADO = {
        OK: "Activa", INACTIVA: "Inactiva", NO_EXISTE: "No existe", ERROR: "Error", PENDING: "…"
    };

    function celdaEstado(f) {
        const cls = CLASE_ESTADO[f.estado] || "neutro";
        const txt = TEXTO_ESTADO[f.estado] || f.estado;
        const avisos = (f.avisos || []).slice();
        if (f.detalle) avisos.push(f.detalle);
        const icono = avisos.length
            ? ` <span class="aviso-fila" title="${MEUI.esc(avisos.join(" · "))}">⚠</span>` : "";
        return `<span class="badge-estado ${cls}">${MEUI.esc(txt)}</span>${icono}`;
    }

    function construirTabla() {
        const columnasTabla = [
            {
                data: null, title: "Acciones", orderable: false, className: "col-accion",
                render: f => {
                    const hayQueBorrar = (f.paquetes || []).some(esEliminable);
                    return `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                        aria-label="Ver paquetes de la línea" title="Ver paquetes de la línea">👁</button>`
                        + (listoParaPlu()
                            ? ` <span class="me-acciones-escritura"><button class="btn btn-sm btn-me-peligro btn-borrar" aria-label="Eliminar paquetes" data-msisdn="${MEUI.esc(f.msisdn)}"
                                ${hayQueBorrar ? "" : "disabled"}
                                title="${hayQueBorrar ? "Eliminar los paquetes activos de esta línea" : "No hay paquetes eliminables"}">🗑</button></span>`
                            : "");
                }
            },
            { data: "msisdn", title: "Línea (MSISDN)", render: v => MEUI.copiable(v, "línea") },
            { data: null, title: "Estado", render: celdaEstado },
            { data: null, title: "IMSI", render: f => MEUI.copiable(f.imsi, "IMSI") },
            { data: null, title: "SubscriptionID", render: f => MEUI.copiable(f.subscriberId, "SubscriptionID") },
            {
                data: null, title: "Cuenta (BAN)",
                render: f => MEUI.copiable(f.ban, "BAN")
                    + (f.multi ? ` <span class="aviso-fila" title="Esta línea tiene ${f.cuentas.length} cuentas en el CM">⚠</span>` : "")
            },
            { data: null, title: "Titular", render: f => MEUI.esc(f.titular || "—") },
            { data: null, title: "Paquetes activos", render: f => (f.paquetes || []).length }
        ];
        dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
            data: [],
            order: [[columnasTabla.findIndex(c => c.data === "msisdn"), "asc"]],
            columns: columnasTabla
        }));
        dataTable.on("click", "button.btn-detalle", function (e) { e.stopPropagation(); abrirDetalle(this.dataset.msisdn); });
        dataTable.on("click", "button.btn-borrar", function (e) {
            e.stopPropagation();
            eliminarDeLinea(this.dataset.msisdn, this);
        });
        dataTable.on("click", "tbody tr", function (e) {
            if (e.target.closest(".btn-copy")) return;      // copiar no abre el detalle
            const f = dataTable.row(this).data();
            if (f && f.msisdn) abrirDetalle(f.msisdn);
        });
        MEUI.registrarTabla(dataTable);
    }

    function render() {
        if (!dataTable) { MEUI.prepararTabla("#tablaResultados"); construirTabla(); }
        dataTable.clear().rows.add(filas).draw();
        MEUI.mostrarSiHayDatos("#tablaResultados", { vacio: "#msgVacio", tabla: dataTable });
        el("kpiLineas").textContent = filas.filter(f => f.estado !== "PENDING").length;
        el("kpiAplicados").textContent = bitacora.filter(b => b.ok).length;
        el("kpiFallos").textContent = bitacora.filter(b => !b.ok).length;
        el("kpiCambios").textContent = bitacora.reduce((n, b) => n + (b.cambios || []).length, 0);
    }

    const filaDe = m => filas.find(f => f.msisdn === m);

    /* --- 6 · Modal de detalle --------------------------------------- */
    function pintarPaquetes(f) {
        const cuerpo = el("cuerpoPaquetes");
        const lista = f.paquetes || [];
        cuerpo.innerHTML = lista.length
            ? lista.map(b => `<tr>
                <td>${MEUI.esc(categoriaPaquete(b.unitType))}</td>
                <td>${MEUI.esc(b.nombre || "—")}${b.promocional ? ' <span class="plu-promo">promo</span>' : ""}</td>
                <td class="me-mono">${MEUI.esc(b.bundleId)}</td>
                <td class="me-mono">${MEUI.esc(fmtCantidad(totalAsignado(b), b.unitType))}</td>
                <td class="me-mono">${MEUI.esc(fmtCantidad(totalDisponible(b), b.unitType))}</td>
                <td class="me-mono">${MEUI.esc(fmtFechaHora(b.fin))}</td>
            </tr>`).join("")
            : `<tr><td colspan="6" class="text-muted">Sin paquetes activos.</td></tr>`;
    }

    function pintarDetalle(f) {
        el("mdMsisdn").textContent = f.msisdn;
        el("mdDatos").innerHTML = [
            ["Estado en el CM", f.estadoCmTexto || TEXTO_ESTADO[f.estado] || "—"],
            ["SubscriptionID", f.subscriberId || "—", true],
            ["IMSI", f.imsi || "", true],
            ["Cuenta (BAN)", f.ban || "—", true],
            ["Cuenta en el CRM", f.cuentaCrm || "— no encontrada —"],
            ["Titular", f.titular || "—"],
            ["ICCID", f.iccid || "—", true],
            ["Price Plan", f.planPrecioId ?? "—"]
        ].map(([k, v, copiar]) => `<dt>${MEUI.esc(k)}</dt><dd>${copiar ? MEUI.copiable(v, k) : MEUI.esc(v)}</dd>`).join("");

        const wrap = el("mdCuentasWrap");
        wrap.hidden = !(f.cuentas && f.cuentas.length > 1);
        if (!wrap.hidden) {
            el("mdCuentas").innerHTML = f.cuentas.map(c =>
                `<span class="cuenta-chip ${c.ban === f.ban ? "usada" : ""}"
                    title="${c.ban === f.ban ? "Es la que se usa" : "No se usa"}">${MEUI.copiable(c.ban, "BAN")}
                    · ${MEUI.esc(c.estadoCmTexto)}</span>`).join("");
        }

        el("mdAvisos").innerHTML = (f.avisos || []).length
            ? `<div class="alert alert-warning py-2 mb-0">${f.avisos.map(a => MEUI.esc(a)).join("<br>")}</div>`
            : "";

        pintarPaquetes(f);
        el("mdResultado").innerHTML = f.ultimoResultado ? resultadoPluHTML(f.ultimoResultado) : "";
        el("mdPaso").textContent = "";

        const usable = f.estado === "OK" || f.estado === "INACTIVA";
        const btn = el("btnUsarEnSecuencia");
        btn.hidden = !listoParaPlu();
        btn.disabled = !usable;

        const borrar = el("btnEliminar");
        borrar.hidden = !listoParaPlu();
        borrar.disabled = !usable || !(f.paquetes || []).some(esEliminable);
        borrar.title = borrar.disabled && usable ? "No hay paquetes eliminables en esta línea" : "";
    }

    function abrirDetalle(msisdn) {
        const f = filaDe(msisdn);
        if (!f) return;
        msisdnAbierto = msisdn;
        pintarDetalle(f);
        bootstrap.Modal.getOrCreateInstance("#modalDetalle").show();
    }

    el("btnRefrescar").addEventListener("click", () => MEUI.conSpinner(el("btnRefrescar"), "Consultando…", async () => {
        const f = filaDe(msisdnAbierto);
        if (!f) return;
        MEUI.progreso.iniciar(1, "Consultar línea");
        const fresca = await consultarLinea(f.msisdn);
        MEUI.progreso.fin({ fallidas: fresca.estado === "ERROR" ? 1 : 0 });
        const i = filas.findIndex(x => x.msisdn === f.msisdn);
        // Se conserva el último resultado del PLU: es la evidencia de la
        // recarga y no la borra una consulta posterior.
        fresca.ultimoResultado = f.ultimoResultado;
        filas[i] = fresca;
        render();
        pintarDetalle(fresca);
    }));

    /* --- 6b · Eliminar los paquetes de una línea (suelto) -------------
       La misma orden ChangeOffer que usa la secuencia, pero a demanda:
       después de consultar se puede limpiar la línea sin aplicar ningún
       PLU. Con confirmación previa, porque escribe en producción.
    --------------------------------------------------------------------- */
    let borrando = false;

    async function eliminarDeLinea(msisdn, boton) {
        if (borrando) return;
        const f = filaDe(msisdn);
        if (!f || !listoParaPlu()) return;
        const activos = (f.paquetes || []).filter(esEliminable);
        if (!activos.length) { MEUI.toast("Esta línea no tiene paquetes eliminables.", "warn"); return; }

        if (!await MEUI.confirmarEscritura({
            titulo: "Eliminar paquetes", accion: "Eliminar paquetes",
            resumen: [["Operación", "Eliminar paquetes"], ["Línea", msisdn],
                ["Cantidad", activos.length + " paquetes"], ["Entorno", "Producción · CM"]],
            items: activos.map(b => `${b.bundleId} ${b.nombre}`),
            aviso: "Elimina TODOS los paquetes opcionales habilitados del plan, no solo los de un PLU."
        })) return;

        borrando = true;
        if (boton) boton.disabled = true;
        const paso = el("mdPaso");
        MEUI.log(`▶ Eliminación de paquetes · ${msisdn} · ejecuta ${usuarioOperador()}`, "warn");
        MEUI.progreso.iniciar(2, "Eliminar paquetes");
        try {
            const r = await eliminarPaquetes(f, [...new Set((f.paquetes || []).map(b => b.bundleId))],
                t => { if (paso) paso.textContent = t; });

            MEUI.log(`${r.ok ? "✔" : "✖"} Eliminación · ${msisdn} · ${r.detalle || "sin detalle"}`
                + (r.omitidos.length ? ` · omitidos (no eliminables): ${r.omitidos.join(", ")}` : "")
                + (r.dependencias && r.dependencias.length
                    ? ` · dependencias que pidió el CM: ${r.dependencias.join(", ")}` : ""),
                r.ok ? "ok" : "err");
            // Si el carrito no se pudo crear, el inventario de productos del
            // plan es lo que hace falta para entender por qué.
            if (!r.ok && r.inventario) {
                const inv = r.inventario;
                MEUI.log("· Productos que el CM listó para este plan — base: " + inv.base.join(", ")
                    + " · opcionales: " + Object.entries(inv.porProducto)
                        .map(([id, p]) => `${id}=paquete ${p.bundleId}${p.opcional ? "" : " (no opcional)"}`).join(", "),
                    "info");
            }
            MEUI.toast(r.ok ? `Orden ${r.ordenId}: ${r.estado}.` : "La eliminación no se confirmó. Mira el registro.",
                r.ok ? "ok" : "err");

            bitacora.push({
                hora: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", hour12: false }),
                usuario: usuarioOperador(), msisdn, plu: "—", costo: "—", canal: "—",
                ok: r.ok, httpStatus: "", codigo: r.estado || "",
                detalle: "Eliminación de paquetes: " + (r.detalle || ""), cambios: []
            });

            // Se relee para que la tabla muestre lo que quedó.
            MEUI.progreso.paso(2, 2, "Verificar eliminación");
            if (paso) paso.textContent = "Verificando…";
            await new Promise(res => setTimeout(res, CONFIG.esperaCmMs));
            const fresca = await consultarLinea(msisdn);
            const i = filas.findIndex(x => x.msisdn === msisdn);
            if (i >= 0) filas[i] = fresca;
            MEUI.progreso.fin({ fallidas: !r.ok || fresca.estado === "ERROR" ? 1 : 0 });
            render();
            if (msisdnAbierto === msisdn) pintarDetalle(fresca);
        } catch (e) {
            MEUI.log("✖ " + (e.message || e), "err");
            MEUI.toast("Falló la eliminación. Mira el registro.", "err");
        } finally {
            borrando = false;
            if (paso) paso.textContent = "";
            if (boton) boton.disabled = false;
        }
    }

    el("btnEliminar").addEventListener("click", () => {
        if (msisdnAbierto) eliminarDeLinea(msisdnAbierto, el("btnEliminar"));
    });

    /* --- 7 · Secuencia de PLU ---------------------------------------
       Una línea y N PLU, uno detrás de otro. Por cada PLU: consultar,
       agregar los bolsillos, verificarlos y eliminarlos.

       Los dos atajos que pide la operación al teclear muchos PLU:
         Enter → agrega otra fila debajo y salta a ella
         Tab   → pasa al campo siguiente SELECCIONANDO su contenido, para
                 sobrescribirlo de una (costo y canal vienen con un valor
                 por defecto que casi siempre se reemplaza)
    --------------------------------------------------------------------- */
    const secuencia = { corriendo: false, detener: false, items: [], armado: false };

    const CAMPOS_FILA = ["plu", "costo", "canal"];

    function filaSeqHTML() {
        return `<input class="form-control form-control-sm me-mono" data-campo="plu" inputmode="numeric"
                    placeholder="10021" aria-label="PLU">
            <input class="form-control form-control-sm me-mono" data-campo="costo" inputmode="numeric"
                    value="${CONFIG.costoPorDefecto}" aria-label="Costo">
            <input class="form-control form-control-sm me-mono" data-campo="canal"
                    value="${MEUI.esc(CONFIG.canalPorDefecto)}" autocomplete="off" aria-label="Canal de venta">
            <button type="button" class="seq-quitar" tabindex="-1" aria-label="Quitar fila">×</button>`;
    }

    function agregarFila(despuesDe, enfocar) {
        const fila = document.createElement("div");
        fila.className = "seq-fila";
        fila.innerHTML = filaSeqHTML();
        if (despuesDe) despuesDe.after(fila); else el("seqFilas").appendChild(fila);
        if (enfocar !== false) {
            const primero = fila.querySelector('[data-campo="plu"]');
            primero.focus();
            fila.scrollIntoView({ block: "nearest" });
        }
        return fila;
    }

    function errorDeFila(x) {
        if (!/^\d{1,20}$/.test(x.plu)) return "PLU inválido";
        if (!/^\d{1,10}$/.test(x.costo)) return "costo inválido";
        if (!/^[A-Za-z0-9_.-]{1,50}$/.test(x.canal)) return "canal inválido";
        return "";
    }

    /**
     * El cuadro de texto acepta la lista tal cual venga: `PLU costo canal`
     * separados por espacio, tabulación, coma, `;` o `|`, uno por renglón.
     * Con solo el PLU se usan el costo y el canal por defecto, y si el
     * primer renglón es un encabezado (`plu,costo,canal`) se salta.
     */
    function leerPlusTexto() {
        const renglones = String(el("seqPlusTexto").value || "")
            .split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        // Encabezado solo si la primera columna se llama «plu» de verdad: no
        // basta con que el renglón empiece por letra, porque entonces un PLU
        // mal escrito («abc 0 canal») se tragaría como encabezado en vez de
        // avisar que está mal.
        if (renglones.length) {
            const primera = renglones[0].split(/\s*[\t;,|]\s*|\s+/)[0] || "";
            if (/^(plu|plupaquete|plu_paquete|codigo|código)$/i.test(primera)) renglones.shift();
        }
        return renglones.map(texto => {
            const partes = texto.split(/\s*[\t;,|]\s*|\s+/).filter(Boolean);
            return {
                origen: "texto", texto,
                plu: partes[0] || "",
                costo: partes[1] !== undefined ? partes[1] : CONFIG.costoPorDefecto,
                canal: partes[2] !== undefined ? partes[2] : CONFIG.canalPorDefecto,
                sobran: partes.length > 3
            };
        });
    }

    function leerFilas() {
        return Array.from(el("seqFilas").children).map(fila => {
            const v = {};
            CAMPOS_FILA.forEach(c => { v[c] = fila.querySelector(`[data-campo="${c}"]`).value.trim(); });
            return { origen: "form", fila, plu: v.plu, costo: v.costo, canal: v.canal };
        }).filter(x => x.plu);
    }

    /** Primero lo pegado, después lo escrito fila a fila. */
    function leerItems() {
        return leerPlusTexto().concat(leerFilas());
    }

    function validarSecuencia() {
        const linea = soloDigitos(el("seqLinea").value);
        const lineaOk = /^3\d{9}$/.test(linea);
        el("seqLineaInfo").textContent = linea
            ? (lineaOk ? `Línea ${linea}: válida.` : "Debe ser un móvil de 10 dígitos que empiece por 3.")
            : "Una sola línea: la secuencia es secuencial por línea.";

        const items = leerItems();
        items.forEach(x => {
            x.error = x.sobran ? "sobran columnas" : errorDeFila(x);
            if (x.fila) x.fila.querySelectorAll("input").forEach(i => i.classList.toggle("is-invalid", !!x.error));
        });
        const malos = items.filter(x => x.error);
        el("seqPlusTexto").classList.toggle("is-invalid",
            malos.some(x => x.origen === "texto"));

        const op = opcionesSecuencia();
        const plan = [op.limpiarAntes ? "limpia la línea" : "",
            items.length ? `aplica ${items.length - malos.length} PLU ${op.eliminar ? "(agregar y eliminar cada uno)" : "(solo agregar)"}` : "",
            op.limpiarDespues ? "limpia al terminar" : ""].filter(Boolean).join(" → ");
        el("seqResumen").textContent = `${items.length - malos.length} PLU válido(s)`
            + (malos.length ? ` · ${malos.length} con error (${malos[0].error})` : "")
            + (items.length ? ` · ${plan}.` : ".");

        // Vista previa: deja ver cómo se interpretó cada renglón antes de correr.
        const previa = el("seqPrevia");
        previa.hidden = !items.length;
        el("seqPreviaCuerpo").innerHTML = items.map((x, i) => x.error
            ? `<tr class="mala"><td>${i + 1}</td><td colspan="3">${MEUI.esc(x.texto || x.plu)} — ${MEUI.esc(x.error)}</td></tr>`
            : `<tr><td>${i + 1}</td><td>${MEUI.esc(x.plu)}</td><td>${MEUI.esc(x.costo)}</td><td>${MEUI.esc(x.canal)}</td></tr>`
        ).join("");

        el("seqEjecutar").disabled = secuencia.corriendo || !lineaOk || !items.length || malos.length > 0;
        return { linea, items };
    }

    function opcionesSecuencia() {
        return {
            eliminar: el("seqEliminarCada").checked,
            limpiarAntes: el("seqLimpiarAntes").checked,
            limpiarDespues: el("seqLimpiarDespues").checked
        };
    }
    ["seqEliminarCada", "seqLimpiarAntes", "seqLimpiarDespues"].forEach(id =>
        el(id).addEventListener("change", () => { desarmarSecuencia(); validarSecuencia(); }));

    function desarmarSecuencia() {
        secuencia.armado = false;
        el("seqEjecutar").textContent = "Ejecutar secuencia";
    }
    const alCambiarSecuencia = () => { desarmarSecuencia(); validarSecuencia(); };

    el("seqLinea").addEventListener("input", alCambiarSecuencia);
    el("seqFilas").addEventListener("input", alCambiarSecuencia);
    el("seqPlusTexto").addEventListener("input", alCambiarSecuencia);
    el("seqAgregar").addEventListener("click", () => { agregarFila(); alCambiarSecuencia(); });
    el("seqLimpiar").addEventListener("click", () => {
        el("seqPlusTexto").value = "";
        el("seqFilas").innerHTML = "";
        agregarFila(null, false);
        alCambiarSecuencia();
    });

    // Enter: otra fila debajo. Tab: siguiente campo con el contenido
    // seleccionado (y en el último campo, salta a la fila siguiente o crea una).
    el("seqFilas").addEventListener("keydown", ev => {
        const campo = ev.target.closest("input[data-campo]");
        if (!campo) return;
        const fila = campo.closest(".seq-fila");

        if (ev.key === "Enter") {
            ev.preventDefault();
            const plu = fila.querySelector('[data-campo="plu"]');
            if (!plu.value.trim()) { plu.focus(); plu.select(); return; }
            const siguiente = fila.nextElementSibling;
            if (siguiente) {
                const p = siguiente.querySelector('[data-campo="plu"]');
                p.focus(); p.select();
            } else {
                agregarFila(fila);
            }
            alCambiarSecuencia();
            return;
        }

        if (ev.key === "Tab" && !ev.shiftKey) {
            const i = CAMPOS_FILA.indexOf(campo.dataset.campo);
            let destino = null;
            if (i < CAMPOS_FILA.length - 1) {
                destino = fila.querySelector(`[data-campo="${CAMPOS_FILA[i + 1]}"]`);
            } else {
                const siguiente = fila.nextElementSibling
                    || (fila.querySelector('[data-campo="plu"]').value.trim() ? agregarFila(fila, false) : null);
                if (siguiente) destino = siguiente.querySelector('[data-campo="plu"]');
            }
            if (destino) {
                ev.preventDefault();
                destino.focus();
                destino.select();   // se sobrescribe de una, sin borrar a mano
                alCambiarSecuencia();
            }
        }
    });

    el("seqFilas").addEventListener("click", ev => {
        const btn = ev.target.closest(".seq-quitar");
        if (!btn) return;
        const fila = btn.closest(".seq-fila");
        const vecina = fila.nextElementSibling || fila.previousElementSibling;
        fila.remove();
        const quedan = el("seqFilas").children.length;
        const foco = quedan ? (vecina || el("seqFilas").firstElementChild) : agregarFila(null, false);
        foco.querySelector('[data-campo="plu"]').focus();
        alCambiarSecuencia();
    });

    // Pegar desde Excel en el campo de PLU: reparte columnas y filas.
    el("seqFilas").addEventListener("paste", ev => {
        const campo = ev.target.closest('input[data-campo="plu"]');
        if (!campo) return;
        const texto = (ev.clipboardData || window.clipboardData).getData("text") || "";
        const renglones = texto.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        if (renglones.length < 2 && !/[\t;,]/.test(texto)) return;   // un solo valor: pegado normal
        ev.preventDefault();
        let fila = campo.closest(".seq-fila");
        renglones.forEach((renglon, idx) => {
            const partes = renglon.split(/\s*[\t;,|]\s*|\s+/).filter(Boolean);
            const destino = idx === 0 ? fila : agregarFila(fila, false);
            fila = destino;
            CAMPOS_FILA.forEach((c, k) => {
                if (partes[k] !== undefined) destino.querySelector(`[data-campo="${c}"]`).value = partes[k];
            });
        });
        alCambiarSecuencia();
    });

    el("btnUsarEnSecuencia").addEventListener("click", () => {
        if (!msisdnAbierto) return;
        el("seqLinea").value = msisdnAbierto;
        alCambiarSecuencia();
        bootstrap.Modal.getOrCreateInstance("#modalDetalle").hide();
        MEUI.abrirPaso(3, true);
        const primero = el("seqFilas").querySelector('[data-campo="plu"]');
        if (primero) { primero.focus(); primero.select(); }
    });

    agregarFila(null, false);
    validarSecuencia();

    /* --- 7b · Pintado y ejecución de la secuencia -------------------- */
    const ETIQUETA_ESTADO = {
        espera: "En cola", corriendo: "En curso", ok: "Correcto",
        aviso: "Con novedad", error: "Error", cancelado: "Cancelado"
    };

    /* La lista se repinta en cada aviso (innerHTML), así que el estado
       abierto/cerrado de cada bloque de bolsillos se guarda aparte: si no,
       cada aviso del PLU en curso cerraría lo que el analista abrió.
       «toggle» no burbujea: se escucha en fase de captura. */
    const abiertos = new Set();
    el("seqLista").addEventListener("toggle", ev => {
        const d = ev.target;
        if (!d.matches || !d.matches("details.seq-paquetes")) return;
        if (d.open) abiertos.add(d.dataset.idx); else abiertos.delete(d.dataset.idx);
    }, true);

    function pintarSecuencia() {
        const panel = el("seqPanel");
        panel.hidden = !secuencia.items.length;
        if (panel.hidden) return;
        el("seqPanelLinea").textContent = secuencia.linea || "—";
        el("seqLista").innerHTML = secuencia.items.map((r, i) => {
            const est = r.estado || "espera";
            const seg = r.inicio ? Math.round(((r.fin || Date.now()) - r.inicio) / 1000) : null;
            return `<div class="seq-item">
                <div class="seq-item-cab">
                    <span class="seq-estado ${est}">${MEUI.esc(ETIQUETA_ESTADO[est] || est)}</span>
                    <span class="seq-item-plu">${i + 1}. ${r.limpieza ? MEUI.esc(r.titulo) : "PLU " + MEUI.esc(r.plu)}</span>
                    ${r.limpieza ? "" : `<span class="me-hint">costo ${MEUI.esc(r.costo)} · canal ${MEUI.esc(r.canal)}${r.sinEliminar ? " · sin eliminar" : ""}</span>`}
                    ${seg !== null ? `<span class="me-hint">${seg}s</span>` : ""}
                    <span class="seq-item-paso ms-auto">${MEUI.esc(r.paso || "")}</span>
                </div>
                ${r.detalle ? `<div class="me-hint mt-1">${MEUI.esc(r.detalle)}</div>` : ""}
                ${bolsillosPlegablesHTML(r, i, abiertos.has(String(i)))}
            </div>`;
        }).join("");
    }

    el("seqDetener").addEventListener("click", () => {
        secuencia.detener = true;
        el("seqDetener").disabled = true;
        el("seqDetener").textContent = "Se detendrá al terminar el PLU actual…";
        MEUI.log("Se pidió detener la secuencia: termina el PLU en curso y para.", "warn");
    });

    el("seqEjecutar").addEventListener("click", async () => {
        const { linea, items } = validarSecuencia();
        if (el("seqEjecutar").disabled) return;
        if (!auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); return; }

        const op = opcionesSecuencia();
        if (!await MEUI.confirmarEscritura({
            titulo: "Aplicar secuencia de PLU", accion: "Ejecutar secuencia",
            resumen: [["Operación", "Aplicar PLU"], ["Línea", linea], ["Cantidad", items.length + " PLU"],
                ["Entorno", "Producción · Tulio / CM"], ["Eliminar después de cada PLU", op.eliminar ? "Sí" : "No"],
                ["Limpiar antes", op.limpiarAntes ? "Sí" : "No"], ["Limpiar al final", op.limpiarDespues ? "Sí" : "No"]],
            items: items.map(x => `PLU ${x.plu} · costo ${x.costo} · canal ${x.canal}`),
            aviso: "La recarga suma saldo real a la línea."
        })) return;
        desarmarSecuencia();

        secuencia.corriendo = true; secuencia.detener = false;
        secuencia.linea = linea;
        const limpieza = titulo => ({ limpieza: true, titulo, plu: "—", costo: "", canal: "", estado: "espera", etapas: ETAPAS_LIMPIEZA });
        secuencia.items = [
            ...(op.limpiarAntes ? [limpieza("Limpieza inicial")] : []),
            ...items.map(x => ({ plu: x.plu, costo: x.costo, canal: x.canal, estado: "espera", sinEliminar: !op.eliminar,
                etapas: op.eliminar ? ETAPAS_PLU : ETAPAS_PLU.slice(0, 3) })),
            ...(op.limpiarDespues ? [limpieza("Limpieza final")] : [])
        ];
        abiertos.clear();   // los índices son de la lista anterior
        el("seqEjecutar").disabled = true;
        el("seqDetener").hidden = false; el("seqDetener").disabled = false;
        el("seqDetener").textContent = "Detener al terminar el PLU actual";
        pintarSecuencia();

        MEUI.log(`▶ Secuencia sobre ${linea}: ${op.limpiarAntes ? "limpieza inicial → " : ""}${items.length} PLU `
            + `${op.eliminar ? "(agregar y eliminar)" : "(solo agregar)"}${op.limpiarDespues ? " → limpieza final" : ""} · ejecuta ${usuarioOperador()}`, "warn");

        // La línea se resuelve UNA vez: subscriberId y cuenta no cambian
        // entre PLU, y así la secuencia no repite la misma consulta.
        MEUI.progreso.iniciar(secuencia.items.length, "Secuencia de PLU");
        let fila = filaDe(linea) || await consultarLinea(linea);
        if (fila.estado === "ERROR" || fila.estado === "NO_EXISTE") {
            secuencia.items.forEach(r => { r.estado = "error"; r.detalle = fila.detalle || "la línea no se pudo consultar"; });
            MEUI.log(`✖ Secuencia detenida: ${fila.detalle || "la línea no se pudo consultar"}`, "err");
            pintarSecuencia();
            secuencia.corriendo = false;
            el("seqDetener").hidden = true;
            validarSecuencia();
            MEUI.progreso.fin({ fallidas: secuencia.items.length });
            return;
        }
        if (!filaDe(linea)) { filas.push(fila); render(); }

        for (const r of secuencia.items) {
            if (secuencia.detener) { r.estado = "cancelado"; r.detalle = "Secuencia detenida antes de este paso."; continue; }
            MEUI.progreso.paso(secuencia.items.indexOf(r) + 1, secuencia.items.length, r.limpieza ? r.titulo : "PLU " + r.plu);
            const alParcial = parcial => {
                Object.assign(r, parcial); pintarSecuencia();
                MEUI.progreso.paso(secuencia.items.indexOf(r) + 1, secuencia.items.length, r.paso || r.titulo || "PLU " + r.plu);
            };
            const hecho = r.limpieza
                ? await limpiarLinea(fila, r.titulo, alParcial)
                : await correrPluSecuencia(fila, r, alParcial, () => secuencia.detener, { eliminar: op.eliminar });
            Object.assign(r, hecho);

            bitacora.push({
                hora: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", hour12: false }),
                usuario: usuarioOperador(), msisdn: linea, plu: r.plu, costo: r.costo, canal: r.canal,
                ok: r.estado === "ok", httpStatus: r.httpStatus, codigo: r.codigo,
                detalle: r.detalle, cambios: r.cambios, orden: r.orden ? r.orden.ordenId : "",
                estadoOrden: r.orden ? r.orden.estado : ""
            });
            MEUI.log(`${r.estado === "ok" ? "✔" : r.estado === "aviso" ? "⚠" : "✖"} ${r.limpieza ? r.titulo : "PLU " + r.plu} · ${linea} · ${r.detalle}`,
                r.estado === "ok" ? "ok" : r.estado === "aviso" ? "warn" : "err");

            // La tabla y el detalle reflejan el último estado conocido.
            const i = filas.findIndex(x => x.msisdn === linea);
            if (i >= 0 && (r.final || r.despues)) {
                filas[i] = Object.assign({}, r.final || r.despues, { ultimoResultado: null });
                fila = filas[i];
            }
            render(); pintarSecuencia();

            // Un fallo NO detiene la secuencia: se registra y sigue con el
            // PLU siguiente, como en la consola. Detenerla es decisión del
            // analista con el botón «Detener».
        }

        secuencia.corriendo = false;
        el("seqDetener").hidden = true;
        validarSecuencia();
        pintarSecuencia();

        const ok = secuencia.items.filter(r => r.estado === "ok").length;
        MEUI.progreso.fin({ fallidas: secuencia.items.filter(r => r.estado === "error" || r.estado === "aviso").length,
            ok: ok === secuencia.items.length, mensaje: `Secuencia terminada: ${ok}/${secuencia.items.length} correctos.` });
        const tipo = ok === secuencia.items.length ? "ok" : ok ? "warn" : "err";
        MEUI.log(`Secuencia terminada: ${ok} de ${secuencia.items.length} paso(s) correctos.`, tipo);
        MEUI.toast(`Secuencia terminada: ${ok}/${secuencia.items.length} correctos.`, tipo);
    });

    /* --- 8 · Exportaciones ------------------------------------------ */
    el("btnCSV").addEventListener("click", () => {
        const d = filasExport(filas); MEUI.exportarCSV(d.head, d.rows, "aplicar_plu");
    });
    el("btnXLSX").addEventListener("click", () => {
        const d = filasExport(filas); MEUI.exportarXLSX(d.head, d.rows, "aplicar_plu", "Líneas");
    });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filas, "aplicar_plu"));

    el("btnBitacora").addEventListener("click", () => {
        if (!bitacora.length) { MEUI.toast("Todavía no se ha aplicado ningún PLU.", "warn"); return; }
        const d = filasBitacora(bitacora);
        MEUI.exportarCSV(d.head, d.rows, "bitacora_plu");
    });

    el("btnEvidenciaXlsx").addEventListener("click", () => {
        if (!secuencia.items.length) { MEUI.toast("No hay secuencia que exportar.", "warn"); return; }
        try {
            const r = descargarEvidenciaXlsx(secuencia.linea, secuencia.items);
            MEUI.log(`Evidencia descargada: ${r.archivo} (${r.hojas.length} hoja(s): ${r.hojas.join(", ")}).`, "ok");
        } catch (e) {
            MEUI.log("✖ No se pudo generar el Excel: " + (e.message || e), "err");
            MEUI.toast("No se pudo generar el Excel. Mira el registro.", "err");
        }
    });

    el("btnEvidencia").addEventListener("click", () => {
        if (!secuencia.items.length) { MEUI.toast("No hay secuencia que exportar.", "warn"); return; }
        const d = filasSecuencia(secuencia.linea, secuencia.items);
        MEUI.exportarCSV(d.head, d.rows, "evidencia_plu");
    });

    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.autoSpinner("#btnConsultar", "Consultando…");
})();
