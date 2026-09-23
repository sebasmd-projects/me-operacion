/* =====================================================================
   logica-prepagadas.js · Reglas de negocio del reporte de prepagadas
   ---------------------------------------------------------------------
   Solo lo propio de ESTA herramienta: endpoints de SIME, clasificación de
   movimientos, catálogo de planes/PLU, cálculo de ciclos y el pintado de
   la tabla y de la modal de detalle.

   Lo que comparte con las demás herramientas NO está aquí:
     · marco visual, sesión, registro, tablas, import/export → me-ui.js
     · Keycloak, auth, getJson, endpoints del CM/BSS        → me-api.js
     · enganche entre esta lógica y el shell                → me-prepagadas-puente.js
===================================================================== */
/* =====================================================================
   CONFIGURACIÓN
===================================================================== */
const CONFIG = {
    simeBase: "https://tulio.grupo-exito.com/apimew/api/v1/simeCliente/SuscripcionRecurrente/SuscripcionRecurrente",
    // Alta de suscripción en SIME. OJO: el segmento "DFXRWFBFZM" parece un
    // identificador de aplicación/versión del gateway; si algún día el alta
    // empieza a responder 404, es lo primero que hay que actualizar aquí.
    simeRegistrar: "https://titanio.grupo-exito.com/apiow/api/v1/DFXRWFBFZM/Suscription/registrar",
    // Recurrencias planificadas de una suscripción. OJO: cuelgan de la RAÍZ
    // del módulo (un solo "SuscripcionRecurrente"), no de simeBase.
    simeRecurrencias: "https://tulio.grupo-exito.com/apimew/api/v1/simeCliente/SuscripcionRecurrente/recurrencia",
    // Edición de una recurrencia (PUT). Mismo gateway que el alta.
    simeEditarRecurrencia: "https://titanio.grupo-exito.com/apiow/api/v1/DFXRWFBFZM/Recurrencia/editar",
    // Las direcciones del CM/BSS y de Keycloak viven en assets/me-api.js:
    // se cambian UNA sola vez para las cuatro herramientas.
    get apiBase() { return MEAPI.CONFIG.apiBase; },
    get tokenSime() { return cfgTokenSime.value.trim() || "token=="; },
    pageSize: 100
};
// Las cabeceras del CM (locale, spid, tenant) las pone MEAPI.cabeceras().

// El registro es el del shell: mismo formato y mismos colores en las 4 herramientas.
const log = (m, nivel) => MEUI.log(m, nivel);

// Estado de sesión: CM (Keycloak) + SIME (token prf)
const sesion = { sime: false };
function pintarSesion() {
    const chip = (ok, txt) => `<span class="chip-verif ${ok ? "ok" : "na"}"><span class="dot"></span>${txt}</span>`;
    estadoSesion.innerHTML =
        chip(!!auth.token, auth.token ? "CM conectado" : "CM sin sesión") + " " +
        chip(sesion.sime, sesion.sime ? "SIME conectado" : "SIME sin sesión");
}

const PESTANAS = {
    0: "Suscripción cancelada",
    1: "Prepagadas activas",
    2: "Suscripción finalizada",
    3: "Suscripciones suspendidas",
    4: "Suscripciones inactivas"
};
const ESTADO_POR_PESTANA = { 0: "CANCELADA", 1: "ACTIVA", 2: "FINALIZADA", 3: "SUSPENDIDA", 4: "INACTIVA" };
// Estado del BAN, tal como llega en /api/v1/subscribers → status.state
//   1 = Activo, 2 = Desactivado  (confirmados con datos reales)
//   3 = Disponible, 4 = Bloqueada (inferidos según las etiquetas de negocio; ajusta si difieren)
const ESTADOS_BSS = { 1: "Activo", 2: "Desactivado", 3: "Disponible", 4: "Bloqueada" };

// Estado de una recurrencia planificada (SIME → recurrencia.estado).
// TUNEABLE: solo el 0 está confirmado con datos reales (recurrencia
// pendiente, sin fechas de inicio/fin de ejecución).
const ESTADOS_RECURRENCIA = { 0: "Planificada" };
const estadoRecTexto = e => ESTADOS_RECURRENCIA[e] ?? (e != null ? `Estado ${e}` : "—");

// Tipo de documento del titular (individualIdentification.identificationType).
// Solo "6" está confirmado con datos reales (cédula de ciudadanía); el resto
// se muestra tal cual hasta que se confirmen los códigos.
const TIPO_DOC_BSS = { "6": "Cédula de ciudadanía" };
const nombreTipoDoc = t => (t == null || t === "") ? "—" : (TIPO_DOC_BSS[String(t)] || `Tipo ${t}`);

/* -------------------------------------------------------------------
   ESTADO DE LA LÍNEA
   Ya NO se consulta /api/v1/subscription: el estado de la línea viene
   directamente en status.state de /api/v1/subscribers, con el mismo
   código que ESTADOS_BSS (1=Activo, 2=Desactivado, 3=Disponible,
   4=Bloqueada). Se asigna en cuentaBase(). Aquí solo quedan las clases
   de badge que usa el detalle.
------------------------------------------------------------------- */
const BADGE_LINEA = { "Activo": "text-bg-success", "Disponible": "text-bg-info", "Desactivado": "text-bg-secondary", "Bloqueada": "text-bg-danger" };

/* =====================================================================
   AUTENTICACIÓN Y CONSULTAS AL CM / BSS
   Viven en assets/me-api.js, compartidas con las otras herramientas.
   Aquí solo se les pone nombre local para no tocar el resto del código.
===================================================================== */
const auth = MEAPI.auth;        // login, refresh, re-auth en 401
const getJson = MEAPI.getJson;  // GET autenticado (añade token y cabeceras)

/* ============ SIME ============ */
function headersSime(extra = {}) {
    return { "accept": "application/json", "prf": CONFIG.tokenSime, ...extra };
}
// Paso 1: la pestaña de la línea. NO es redundante: /-1 en el paginador solo
// trae suscripciones finalizadas/inactivas, así que las ACTIVAS solo se
// recuperan consultando su pestaña real con Tiposuscription.
async function simeConsultarPestana(linea) {
    const r = await fetch(`${CONFIG.simeBase}/Tiposuscription/1/${linea}`, { headers: headersSime(), credentials: "include" });
    if (!r.ok) throw new Error(`SIME ${r.status} en Tiposuscription`);
    return (await r.json()).pestana;           // → 0 | 1 | 2 | 3 | 4
}
// Paso 2: los datos de la suscripción en esa pestaña.
async function simeGetSuscripcion(pestana, linea) {
    const pagination = btoa(JSON.stringify({ pageSize: CONFIG.pageSize, pageNumber: 1, filter: "mSISDN", filterValue: String(linea) }));
    const r = await fetch(`${CONFIG.simeBase}/GetSuscripcionPresentePaginador/${pestana}`, {
        method: "POST", credentials: "include",
        headers: headersSime({ "content-type": "application/json", "pagination": pagination }),
        body: JSON.stringify({ id: "", linea: String(linea), fechaSuscripcion: null, fechaCompra: null })
    });
    if (!r.ok) throw new Error(`SIME ${r.status} en GetSuscripcionPresentePaginador`);
    return r.json();                            // → {items:[…], count:n}
}
/* ---- Recurrencias de una suscripción (lectura y edición) ----
   GET  {simeBase}/suscripcion/{b64(id)}                 → suscripción al día
   GET  {simeRecurrencias}/suscripcion/{b64(id)}         → {recurrencias, count}
   PUT  {simeEditarRecurrencia}                          → edita una recurrencia
   El id de la suscripción viaja en base64 en la URL, igual que el
   "pagination" de los demás endpoints de SIME. */
const b64 = v => btoa(String(v));

async function simeSuscripcionPorId(id) {
    const r = await fetch(`${CONFIG.simeBase}/suscripcion/${b64(id)}`, { headers: headersSime(), credentials: "include" });
    if (!r.ok) throw new Error(`SIME ${r.status} al leer la suscripción ${id}`);
    return r.json();
}

async function simeRecurrencias(id) {
    const pagination = btoa(JSON.stringify({ pageSize: 50, pageNumber: 1, sort: "fechaInicioEjecucion" }));
    const r = await fetch(`${CONFIG.simeRecurrencias}/suscripcion/${b64(id)}`, {
        credentials: "include",
        headers: headersSime({ "content-type": "application/json", "pagination": pagination })
    });
    if (!r.ok) throw new Error(`SIME ${r.status} al leer las recurrencias de ${id}`);
    return r.json();                            // → {recurrencias:[…], count:n}
}

async function simeEditarRecurrencia(payload) {
    const r = await fetch(CONFIG.simeEditarRecurrencia, {
        method: "PUT", credentials: "include",
        headers: headersSime({ "content-type": "application/json" }),
        body: JSON.stringify(payload)
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} · ${String(txt).slice(0, 300)}`);
    try { return JSON.parse(txt); } catch (_) { return txt; }
}

async function probarSime() {
    try {
        log("Probando SIME…");
        const p = await simeConsultarPestana("3012398258");
        sesion.sime = true; pintarSesion();
        log(`✔ SIME responde. pestana=${p}`);
    } catch (e) {
        sesion.sime = false; pintarSesion();
        log(`✖ SIME: ${e.message}. Si es CORS/401, abre esta página con el acceso directo (.bat) y revisa el token prf.`);
    }
}

async function obtenerTokenSime() {
    log("Obteniendo token SIME con la sesión de Windows…");
    const r = await fetch("http://296vnextqa02/SIMEPRB/Web", { credentials: "include", redirect: "follow" });
    const m = /[?&]prf=([^&#]+)/.exec(r.url || "");
    let token = m ? decodeURIComponent(m[1]) : null;
    if (!token) {
        const html = await r.text();
        const m2 = /[?&]prf=([A-Za-z0-9+/%=_\-]+)/.exec(html);
        if (m2) token = decodeURIComponent(m2[1]);
    }
    if (!token) throw new Error("No se encontró prf en el redirect de SIME/Web. Verifica la sesión de Windows (NTLM) e inténtalo con el .bat");
    cfgTokenSime.value = token;
    cfgTokenSime.dispatchEvent(new Event("input"));   // refresca "Usuario creación" (solo lectura)
    sesion.sime = true; pintarSesion();
    try {
        const perfil = JSON.parse(atob(token));
        log(`✔ Token SIME obtenido para ${perfil.Nombre || perfil.UserName || "usuario"} (${perfil.Departamento || ""})`);
    } catch (_) { log("✔ Token SIME obtenido"); }
    return token;
}

/* ============ BSS vía OBP ============ */
const epochISO = ms => (ms || ms === 0) ? new Date(ms).toISOString().slice(0, 19) : null;
const soloFecha = iso => iso ? String(iso).slice(0, 10) : null;

const paramTx = (tx, n) => (tx.parameters || []).find(p => p.name === n)?.value || "";
const tipoTx = tx => paramTx(tx, "RNAdjustmentTypeID");
const montoTx = tx => Number(tx.amount || 0) / 10000;

/* -------------------------------------------------------------------
   CLASIFICACIÓN DE MOVIMIENTOS (adjustment types)
   Reglas tuneables: si un tipo de la BSS queda mal clasificado,
   ajusta estas expresiones regulares y listo.
   - primera : "1er Mes" (inicio de un ciclo del plan)
   - compraPlan : compra de paquete / plan (también inicia ciclo)
   - compra : cualquier otro pago del cliente (ingreso de saldo,
              recarga, etc.) — se resalta pero NO inicia ciclo
   - recurrencia : cobros automáticos de renovación
   - otro : ajustes, cortesías, reversos, etc.
------------------------------------------------------------------- */
const RE_PRIMERA = /1er\s*Mes/i;
const RE_RECURRENCIA = /\brecur/i;
const RE_COMPRA_PLAN = /(paquete|plan|suscrip|pague\s*\d|lleve\s*\d)/i;
const RE_COMPRA = /(compra|paquete|ingreso\s*de\s*saldo|recarga|abono|activaci|adquisic|1er\s*Mes)/i;

const esPrimeraTx = tx => RE_PRIMERA.test(tipoTx(tx));
const esRecurTx = tx => RE_RECURRENCIA.test(tipoTx(tx)) && !RE_PRIMERA.test(tipoTx(tx));
// Compra que INICIA un ciclo del plan (para el conteo de periodos).
// Solo el "1er Mes" abre ciclo: las recurrencias renuevan el MISMO ciclo y los
// paquetes/servicios que acompañan cada cobro son aprovisionamiento, no compras nuevas.
// (Si en tu BSS una recompra del plan no dice "1er Mes", añade su patrón a RE_PRIMERA.)
const esCicloTx = tx => esPrimeraTx(tx);
// Compra de paquete (se resalta en la tabla, NO inicia ciclo)
const esCompraPlanTx = tx => !esRecurTx(tx) && !esPrimeraTx(tx) && RE_COMPRA_PLAN.test(tipoTx(tx));
// Cualquier otra compra/pago del cliente (para resaltar en la tabla)
const esCompraTx = tx => !esRecurTx(tx) && !esCompraPlanTx(tx) && (RE_COMPRA.test(tipoTx(tx)) || montoTx(tx) > 0);

// Categoría legible de cada movimiento (para pintar/filtrar)
function categoriaTx(tx) {
    if (esPrimeraTx(tx)) return "primera";
    if (esCompraPlanTx(tx)) return "compraPlan";
    if (esRecurTx(tx)) return "recurrencia";
    if (esCompraTx(tx)) return "compra";
    return "otro";
}
const CAT_LABEL = {
    primera: "1.ª compra (ciclo)", compraPlan: "Compra de paquete",
    compra: "Compra / ingreso", recurrencia: "Recurrencia", otro: "Otro ajuste"
};

async function bssTransacciones(subscriberId) {
    const url = `${CONFIG.apiBase}/api/v1/subscription/${encodeURIComponent(subscriberId)}/detailedSubscriptionTransaction`;
    const base = {
        limit: "500", isAscending: "false",
        start: "2020-01-01T00:00:00.000Z", end: new Date().toISOString()
    };
    let txs = [], pageKey = null, prevKey = null, guard = 0;
    do {
        const p = { ...base };
        if (pageKey) p.nextPageKey = pageKey;
        const data = await getJson(url, p);
        const res = data?.results || [];
        txs = txs.concat(res);
        prevKey = pageKey; pageKey = data?.nextPageKey || null;
        if (pageKey && pageKey === prevKey) break;
    } while (pageKey && ++guard < 50);   // trae TODO el histórico disponible (tope de seguridad)
    // La BSS a veces devuelve el mismo movimiento repetido (páginas solapadas / doble registro).
    // Deduplicamos por firma (receipt + fecha + tipo + monto) para no inflar movimientos ni ciclos.
    const vistos = new Set();
    txs = txs.filter(t => {
        const k = `${t.identifier}|${t.transactionDate}|${tipoTx(t)}|${t.amount}`;
        if (vistos.has(k)) return false;
        vistos.add(k); return true;
    });
    txs.sort((a, b) => String(a.transactionDate).localeCompare(String(b.transactionDate)));
    return txs;
}

// Uso y balance por bundle (/api/v1/subscription/bundleBalance)
async function bssBundleBalance(subscriberId) {
    try {
        const data = await getJson(`${CONFIG.apiBase}/api/v1/subscription/bundleBalance`, { subscriptionID: subscriberId });
        return data?.bundleBalances || [];
    } catch (e) {
        log(`⚠ BSS ${subscriberId}: no se pudo leer uso/balance (${e.message})`);
        return null;
    }
}

/* -------------------------------------------------------------------
   DATOS DEL TITULAR (cédula)  ← nuevo en v6
   Cadena de llamadas, tal como la hace el CMS:
     1) /api/v1/billingAccount?externalID=<BAN>;id=<BAN>;…  → cuenta de
        facturación con relatedParty (Individual + Customer)
     2) /api/v1/individual/<id>  → individualIdentification[0]
        .identificationId  = LA CÉDULA
     3) /api/v1/customer/<id>    → nombre y estado del cliente
   El filtro va TODO dentro del parámetro externalID separado por ";",
   igual que en el curl del CMS (no son parámetros independientes).
------------------------------------------------------------------- */
function contactoDe(obj, mediumType) {
    return (obj?.contactMedium || []).find(m => m.mediumType === mediumType)?.characteristic || null;
}

// Un accountID puede venir como "41041348619-1"; el externalID de la cuenta
// de facturación es la parte ANTES del guion, así que esa se prueba primero
// (y el valor completo queda como respaldo).
function candidatosExternalID(ban) {
    const s = String(ban || "").trim();
    const out = [];
    [s.split("-")[0], s].forEach(v => { if (v && !out.includes(v)) out.push(v); });
    return out;
}

// Busca la cuenta de facturación por externalID:
//   a) forma simple  ?externalID=X&offset=0&limit=1   (la que usa el CMS)
//   b) si no devuelve nada, el filtro "todo en uno" del CMS: el mismo valor
//      en externalID/id/email/teléfono, con ";" codificado (%3B) y los "="
//      internos crudos.
async function buscarBillingAccount(externalID) {
    const norm = r => Array.isArray(r) ? r : (r?.billingAccounts || r?.results || []);
    let lista = norm(await getJson(`${CONFIG.apiBase}/api/v1/billingAccount`,
        { externalID, offset: 0, limit: 1 }).catch(() => null));
    if (lista.length) return lista[0];
    const filtro = [
        String(externalID),
        `id=${externalID}`,
        `contact.contactMedium.characteristic.emailAddress=${externalID}`,
        `contact.contactMedium.characteristic.phoneNumber=${externalID}`,
        "includeEmail=true"
    ].join("%3B");
    lista = norm(await getJson(
        `${CONFIG.apiBase}/api/v1/billingAccount?externalID=${filtro}&offset=0&limit=10`).catch(() => null));
    if (lista.length) return lista[0];
    // c) por ID de cuenta. Las relaciones (parentId / accountRelationship)
    //    traen el ID de la cuenta, que no siempre coincide con su externalID.
    const porId = await getJson(
        `${CONFIG.apiBase}/api/v1/billingAccount/${encodeURIComponent(externalID)}`).catch(() => null);
    if (porId && (porId.id || porId["@type"] === "BillingAccount")) return porId;
    if (Array.isArray(porId) && porId.length) return porId[0];
    return null;
}

// Primer documento con número dentro de individualIdentification
const identDeIndividual = ind =>
    (ind?.individualIdentification || []).find(x => x.identificationId && String(x.identificationId).trim()) || null;

const MAX_SALTOS_PADRE = 5;   // tope al subir por parentId

/* Titular de una cuenta. IMPORTANTE: la cuenta del BAN de la línea suele ser
   HIJA (childAccount:true, relatedParty "Default" sin documento) y la cédula
   está en la cuenta de arriba. Se sube por parentId y, cuando ese campo no
   viene, por accountRelationship[].account.id, hasta encontrar un individual
   con documento. */
async function bssCliente(cuenta) {
    const clave = cuenta?.ban || cuenta?.subscriberId;
    if (!clave) return null;
    try {
        const pendientes = candidatosExternalID(clave);
        const variantesBan = new Set(pendientes);
        const vistos = new Set();
        const cadena = [];
        let saltos = 0;

        while (pendientes.length && saltos <= MAX_SALTOS_PADRE) {
            const ext = pendientes.shift();
            if (vistos.has(ext)) continue;
            vistos.add(ext);

            const acc = await buscarBillingAccount(ext);
            if (!acc) { cadena.push({ externalID: ext, encontrada: false }); continue; }
            cadena.push({
                externalID: ext, encontrada: true, billingAccountId: acc.id || null,
                nombre: acc.name || null, hija: !!acc.childAccount, parentId: acc.parentId || null
            });
            // Ya hay cuenta: las otras variantes del BAN (con/sin sufijo) sobran.
            if (variantesBan.size) {
                for (let k = pendientes.length - 1; k >= 0; k--)
                    if (variantesBan.has(pendientes[k])) pendientes.splice(k, 1);
                variantesBan.clear();
            }

            const rel = acc.relatedParty || [];
            const refInd = rel.find(p => p["@referredType"] === "Individual" || /individual\//.test(p.href || ""));
            const refCus = rel.find(p => p["@referredType"] === "Customer" || /customer\//.test(p.href || ""));
            const [individuo, cliente] = await Promise.all([
                refInd?.id ? getJson(`${CONFIG.apiBase}/api/v1/individual/${encodeURIComponent(refInd.id)}`).catch(() => null) : null,
                refCus?.id ? getJson(`${CONFIG.apiBase}/api/v1/customer/${encodeURIComponent(refCus.id)}`).catch(() => null) : null
            ]);

            const ident = identDeIndividual(individuo);
            if (ident) {
                const correo = contactoDe(individuo, "email")?.emailAddress
                    || (acc.contact || []).flatMap(c => c.contactMedium || [])
                        .find(m => m.mediumType === "email")?.characteristic?.emailAddress || null;
                const tel = contactoDe(individuo, "telephone")?.phoneNumber || null;
                const dir = contactoDe(individuo, "address") || null;
                if (cadena.length > 1)
                    log(`BSS ${clave}: cuenta hija → cédula tomada de la cuenta relacionada ${acc.externalID || ext}.`);
                return {
                    cedula: String(ident.identificationId).trim(),
                    tipoDocId: ident.identificationType ?? null,
                    tipoDoc: nombreTipoDoc(ident.identificationType),
                    docValidado: ident.validated,
                    nombre: cliente?.name
                        || [individuo?.givenName, individuo?.familyName].filter(Boolean).join(" ").trim()
                        || acc.name || null,
                    correo, telefono: tel,
                    ciudad: dir?.city || null,
                    estadoCliente: cliente?.status || null,
                    estadoCuenta: acc.state || null,
                    tipoCuenta: acc.accountType || null,
                    billingAccountId: acc.id || null,
                    externalID: acc.externalID || ext,
                    individualId: refInd?.id || null,
                    customerId: refCus?.id || null,
                    cuentaHija: !!acc.childAccount,
                    desdePadre: cadena.length > 1,
                    cadena,
                    _rawAccount: acc, _rawIndividual: individuo, _rawCustomer: cliente
                };
            }

            // Sin documento aquí: hay que subir a la cuenta "de arriba".
            //   a) parentId — relación directa.
            //   b) accountRelationship[].account.id — algunas cuentas hijas NO
            //      traen parentId y la única pista de la cuenta padre está aquí
            //      (ej.: BAN 4105308078 → billingAccount 5997493 sin parentId,
            //      relacionada con la cuenta 41013468245, que sí tiene cédula).
            const relacionadas = [];
            if (acc.parentId) relacionadas.push(String(acc.parentId));
            (acc.accountRelationship || []).forEach(rel2 => {
                const id = rel2?.account?.id ?? rel2?.account?.name ?? rel2?.id;
                if (id) relacionadas.push(String(id));
            });
            cadena[cadena.length - 1].relacionadas = relacionadas;
            relacionadas.forEach(id => {
                if (!vistos.has(id) && !pendientes.includes(id)) { pendientes.push(id); saltos++; }
            });
        }

        log(`⚠ BSS ${clave}: sin cédula en la cadena de cuentas (${cadena.map(c => c.externalID).join(" → ") || "sin resultados"}).`);
        return null;
    } catch (e) {
        log(`⚠ BSS ${clave}: no se pudieron leer los datos del titular (${e.message})`);
        return null;
    }
}

// Construye el objeto base de una cuenta (BAN). El estado real viene en status.state.
function cuentaBase(sub, linea) {
    const p = sub.profile || {}, st = sub.status || {}, rt = sub.rating || {};
    const estadoTxt = ESTADOS_BSS[st.state] ?? (st.state != null ? `Estado ${st.state}` : "—");
    return {
        subscriberId: p.identifier || null,
        ban: p.accountID || null,
        msisdn: p.mobileNumber || String(linea),
        estadoBss: st.state,
        estadoBssTexto: estadoTxt,
        estadoLinea: ESTADOS_BSS[st.state] || null,   // etiqueta de negocio (Activo/Desactivado/…)
        estadoLineaRaw: null, _rawSubscription: null,
        creado: epochISO(p.created),
        inicioEstado: epochISO(st.startDate),
        finEstado: epochISO(st.endDate),
        expira: epochISO(st.expiryDate),
        planPrecioId: rt.primaryPricePlanID ?? null,
        _raw: sub
    };
}

// El BAN activo es el que está en estado Activo (status.state === 1).
const cuentaActiva = c => c.estadoBss === 1;
// Cuenta que se usa por defecto: la ACTIVA más reciente; si ninguna está
// activa, la última creada. El analista puede cambiarla en la modal.
function cuentaPorDefecto(cuentas) {
    const orden = [...cuentas].sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")));
    return orden.find(cuentaActiva) || orden[0];
}

/* -------------------------------------------------------------------
   RESUMEN DE MOVIMIENTOS de UNA cuenta (ciclos, 1.ª compra, recurrencias)
   Se separó de bssBuscarLinea para poder recalcularlo cuando el analista
   cambia de BAN en la modal.
------------------------------------------------------------------- */
function resumirTx(txs) {
    const r = {
        primeraCompra: null, montoPrimera: null, recurrenciasBss: null, comprasBss: null,
        recurrenciasHistoricas: null, primeraPorMonto: false, esRecompra: false,
        ciclosDetectados: 0, txRelevantes: [], txTodas: [], comprasPlan: [], totalTx: 0
    };
    if (!txs) return r;
    r.totalTx = txs.length;

    // TODOS los movimientos (todos los adjustment type), para la tabla legible
    r.txTodas = txs.map(t => ({
        id: t.identifier,
        fecha: String(t.transactionDate).slice(0, 19),
        tipo: tipoTx(t) || "(sin tipo)",
        monto: montoTx(t),
        agente: t.agent || "",
        categoria: categoriaTx(t)
    }));
    // Compras que inician un ciclo del plan (para el conteo por stacking)
    r.comprasPlan = txs.filter(esCicloTx).map(t => ({
        fecha: String(t.transactionDate).slice(0, 19),
        monto: montoTx(t),
        tipo: tipoTx(t)
    }));

    let primeras = txs.filter(esPrimeraTx);
    let primera = primeras[primeras.length - 1] || null;      // ciclo vigente
    if (!primera) {
        const conMonto = txs.filter(t => montoTx(t) > 0);
        if (conMonto.length) {
            primera = conMonto[conMonto.length - 1];
            primeras = conMonto;
            r.primeraPorMonto = true;
        }
    }
    const recusTodas = txs.filter(esRecurTx);
    const recus = primera
        ? recusTodas.filter(t => String(t.transactionDate) >= String(primera.transactionDate))
        : recusTodas;
    if (primera) {
        r.primeraCompra = String(primera.transactionDate).slice(0, 19);
        r.montoPrimera = montoTx(primera);
        r.recurrenciasBss = recus.length;
        r.comprasBss = 1 + recus.length;
    } else {
        r.recurrenciasHistoricas = recusTodas.length;
    }
    r.esRecompra = primeras.length > 1 || recusTodas.length > recus.length;
    r.ciclosDetectados = primeras.length;
    r.txRelevantes = [...primeras, ...recusTodas]
        .sort((a, b) => String(a.transactionDate).localeCompare(String(b.transactionDate)))
        .map(t => ({
            id: t.identifier, fecha: String(t.transactionDate).slice(0, 19),
            tipo: tipoTx(t), monto: montoTx(t), agente: t.agent,
            esPrimera: esPrimeraTx(t) || (r.primeraPorMonto && montoTx(t) > 0),
            cicloVigente: !primera || String(t.transactionDate) >= String(primera.transactionDate)
        }));
    return r;
}

/* -------------------------------------------------------------------
   SERVICIOS DE UNA CUENTA (BAN): uso/balance + movimientos + titular.
   Los tres son independientes → se piden EN PARALELO.
   Se cachean por subscriberId para que cambiar de BAN ida y vuelta en la
   modal no vuelva a golpear la API.
------------------------------------------------------------------- */
const cacheServicios = new Map();

async function bssServiciosDeCuenta(cuenta) {
    if (!cuenta?.subscriberId) return { uso: null, cliente: null, ...resumirTx(null) };
    if (cacheServicios.has(cuenta.subscriberId)) return cacheServicios.get(cuenta.subscriberId);
    const [bundles, txs, cliente] = await Promise.all([
        bssBundleBalance(cuenta.subscriberId),
        bssTransacciones(cuenta.subscriberId).catch(e => {
            log(`⚠ BSS ${cuenta.msisdn || cuenta.subscriberId}: suscriptor OK pero falló el historial de transacciones (${e.message})`);
            return null;
        }),
        bssCliente(cuenta)
    ]);
    const serv = { uso: bundles, cliente, ...resumirTx(txs) };
    cacheServicios.set(cuenta.subscriberId, serv);
    return serv;
}

async function bssBuscarLinea(linea) {
    const data = await getJson(`${CONFIG.apiBase}/api/v1/subscribers`, { msisdnList: linea, offset: 0, limit: 10 });
    const lista = data?.subscriberResponseList || [];
    if (!lista.length) {
        log(`BSS: sin suscriptor para ${linea} (regla: BSS → si no aparece, consultar en SIME)`);
        return null;
    }

    // Una línea puede tener VARIOS BAN. Cada uno trae su estado en status.state.
    const cuentas = lista.map(sub => cuentaBase(sub, linea));

    // Por defecto se toma el BAN activo más reciente (cambiable en la modal).
    const activa = cuentaPorDefecto(cuentas);
    if (cuentas.length > 1)
        log(`BSS ${linea}: ${cuentas.length} cuentas (BAN) → servicios desde la activa ${activa.ban || activa.subscriberId} (${activa.estadoLinea || activa.estadoBssTexto})`);

    const serv = await bssServiciosDeCuenta(activa);

    return {
        ...activa,
        resultCode: data.resultCode,
        cuentas,                        // todas las cuentas de la línea, con su estado
        multiBan: cuentas.length > 1,
        cuentaSeleccionada: activa.subscriberId,
        seleccionManual: false,
        ...serv                         // uso, cliente (cédula) y resumen de movimientos
    };
}

async function probarBss() {
    try {
        log("Probando BSS (subscribers)…");
        const b = await bssBuscarLinea("3012398258");
        log(b ? `✔ BSS responde. subscriberId=${b.subscriberId} · cédula ${b.cliente?.cedula || "no disponible"}` : "✔ BSS responde (sin suscriptor para la línea de prueba)");
    } catch (e) { log(`✖ BSS: ${e.message}`); }
}

/* =====================================================================
   CARGA DE ARCHIVO EXCEL / CSV (SheetJS) — soporta múltiples hojas
===================================================================== */
let wbGlobal = null;
let hojaDatos = [];
let lineasArchivo = [];

const ALIAS_COLUMNA = ["linea", "línea", "lineas", "líneas", "msisdn", "numero", "número",
    "numero de linea", "número de línea", "celular", "movil", "móvil", "telefono", "teléfono"];
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function leerArchivo(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            wbGlobal = XLSX.read(e.target.result, { type: "array" });
            if (!wbGlobal.SheetNames.length) { fileInfo.textContent = "⚠ El archivo no tiene hojas."; return; }

            // Selector de hoja (si hay varias, el analista escoge)
            selHoja.innerHTML = wbGlobal.SheetNames.map(n => `<option value="${n}">${n}</option>`).join("");
            selHoja.disabled = wbGlobal.SheetNames.length <= 1;

            // Elegir por defecto la primera hoja que tenga una columna de líneas
            let hojaInicial = wbGlobal.SheetNames[0];
            for (const n of wbGlobal.SheetNames) {
                const filas0 = XLSX.utils.sheet_to_json(wbGlobal.Sheets[n], { defval: "", raw: false });
                if (filas0.length && Object.keys(filas0[0]).some(c => norm(c).includes("linea") || norm(c).includes("msisdn"))) {
                    hojaInicial = n; break;
                }
            }
            selHoja.value = hojaInicial;
            cargarHoja(hojaInicial, file.name);
            btnQuitarArchivo.classList.remove("d-none");
        } catch (err) {
            fileInfo.textContent = "✖ No se pudo leer el archivo: " + err.message;
        }
    };
    reader.readAsArrayBuffer(file);
}

function cargarHoja(nombre, nombreArchivo) {
    hojaDatos = XLSX.utils.sheet_to_json(wbGlobal.Sheets[nombre], { defval: "", raw: false });
    if (!hojaDatos.length) {
        selColumna.innerHTML = `<option value="">— hoja sin datos —</option>`;
        selColumna.disabled = true;
        lineasArchivo = [];
        fileInfo.innerHTML = `⚠ La hoja "<strong>${nombre}</strong>" no tiene filas de datos. Escoge otra hoja.`;
        return;
    }
    const columnas = Object.keys(hojaDatos[0]);
    selColumna.innerHTML = columnas.map(c => `<option value="${c}">${c}</option>`).join("");
    selColumna.disabled = false;

    const detectada = columnas.find(c => norm(c) === "linea")
        || columnas.find(c => ALIAS_COLUMNA.includes(norm(c)))
        || columnas.find(c => norm(c).includes("linea") || norm(c).includes("msisdn"));
    if (detectada) selColumna.value = detectada;

    extraerLineas();
    fileInfo.innerHTML = `✔ ${nombreArchivo ? `<strong>${nombreArchivo}</strong> · ` : ""}hoja "<strong>${nombre}</strong>" · ${hojaDatos.length} filas`
        + (detectada ? ` · columna detectada: <strong>${detectada}</strong>` : ` · <span class="text-danger">elige la columna de líneas</span>`)
        + ` · ${lineasArchivo.length} líneas únicas`;
}

function extraerLineas() {
    const col = selColumna.value;
    if (!col) { lineasArchivo = []; return; }
    const set = new Set();
    hojaDatos.forEach(f => {
        let v = String(f[col] ?? "").replace(/[\s\-\.\(\)]/g, "");
        v = v.replace(/^\+?57(?=3\d{9}$)/, "");
        if (/^\d{7,12}$/.test(v)) set.add(v);
    });
    lineasArchivo = [...set];
    inputLineas.value = lineasArchivo.join(", ");
}

function quitarArchivo() {
    wbGlobal = null; hojaDatos = []; lineasArchivo = [];
    inputArchivo.value = "";
    inputLineas.value = "";
    selHoja.innerHTML = `<option value="">— Carga primero un archivo —</option>`;
    selHoja.disabled = true;
    selColumna.innerHTML = `<option value="">— Carga primero un archivo —</option>`;
    selColumna.disabled = true;
    fileInfo.textContent = "";
    btnQuitarArchivo.classList.add("d-none");
    log("Archivo descartado. Puedes cargar otro o usar el campo manual.");
}

dropzone.addEventListener("click", () => inputArchivo.click());
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") inputArchivo.click(); });
inputArchivo.addEventListener("change", e => { if (e.target.files[0]) leerArchivo(e.target.files[0]); });
["dragover", "dragenter"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) leerArchivo(f); });
selHoja.addEventListener("change", () => cargarHoja(selHoja.value));
selColumna.addEventListener("change", () => {
    extraerLineas();
    fileInfo.innerHTML = `Hoja "<strong>${selHoja.value}</strong>" · columna <strong>${selColumna.value}</strong> · ${lineasArchivo.length} líneas únicas`;
});
btnQuitarArchivo.addEventListener("click", quitarArchivo);
// Si el analista escribe manualmente, el archivo deja de mandar
inputLineas.addEventListener("input", () => { lineasArchivo = []; });

/* =====================================================================
   LÓGICA DE NEGOCIO
===================================================================== */
const fmt = iso => iso ? new Date(iso).toLocaleString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function totalPeriodosDePlan(nombre) {
    const m = /lleve\s+(\d+)/i.exec(nombre || "");
    return m ? parseInt(m[1], 10) : null;
}

function calcularPeriodos(item) {
    const total = totalPeriodosDePlan(item?.nombre);
    if (!total) return null;
    const consumidos = Math.min(1 + (item.numeroRecurrenciasEjecutadas || 0), total);
    return { total, consumidos, porConsumir: total - consumidos, mesActual: consumidos };
}

/* -------------------------------------------------------------------
   CICLOS APILADOS (ej.: "pague 3 lleve 4")
   Cada compra del plan cubre `total` meses consecutivos desde el mes
   de compra. Varias compras pueden solaparse y siguen vigentes.
   Ejemplo (plan de 4, mes actual = 06):
     compra 04 → cubre 04,05,06,07  · consumidos 04,05      · restan 06,07
     compra 05 → cubre 05,06,07,08  · consumido 05          · restan 06,07,08
     compra 06 → cubre 06,07,08,09  · apenas empieza        · restan 06,07,08,09
   Cobertura combinada vigente: 06 → 09.
------------------------------------------------------------------- */
const mesIdxDeFecha = f => { const d = new Date(f); return d.getFullYear() * 12 + d.getMonth(); };
const etiquetaMes = idx => `${String((idx % 12) + 1).padStart(2, "0")}/${Math.floor(idx / 12)}`;

function calcularCiclos(item, bss) {
    const total = totalPeriodosDePlan(item?.nombre);
    if (!total || !bss || !bss.comprasPlan || !bss.comprasPlan.length) return null;
    const hoyIdx = mesIdxDeFecha(new Date());
    const ciclos = bss.comprasPlan.map((c, i) => {
        const iniIdx = mesIdxDeFecha(c.fecha);
        const finIdx = iniIdx + total - 1;                       // último mes cubierto
        const completados = Math.min(Math.max(hoyIdx - iniIdx, 0), total); // meses ya consumidos (sin contar el actual)
        const restantes = Math.max(total - completados, 0);       // incluye el mes en curso
        const vigente = hoyIdx <= finIdx;
        return {
            n: i + 1, fecha: c.fecha, monto: c.monto, tipo: c.tipo, total,
            iniIdx, finIdx, completados, restantes,
            mesActual: Math.min(hoyIdx - iniIdx + 1, total),        // en qué mes del plan va (1-based)
            etiquetaInicio: etiquetaMes(iniIdx), etiquetaFin: etiquetaMes(finIdx),
            vigente
        };
    });
    const vigentes = ciclos.filter(c => c.vigente);
    const finMax = ciclos.reduce((m, c) => Math.max(m, c.finIdx), -Infinity);
    const inicioCobertura = vigentes.length ? Math.min(hoyIdx, ...vigentes.map(c => c.iniIdx)) : null;
    return {
        total, ciclos, vigentes: vigentes.length,
        finMax, hoyIdx,
        // Cobertura combinada de lo que aún falta por consumir (rango, no suma)
        coberturaDesde: vigentes.length ? etiquetaMes(Math.max(hoyIdx, inicioCobertura)) : null,
        coberturaHasta: vigentes.length ? etiquetaMes(finMax) : null,
        // Nº de meses (distintos) aún cubiertos desde hoy
        mesesCubiertosRestantes: vigentes.length ? (finMax - hoyIdx + 1) : 0
    };
}

function verificar(item, bss) {
    if (!bss) return { estado: "na", texto: "Sin datos BSS" };
    if (!item) return { estado: "na", texto: "No creada en SIME" };
    const idOk = !!(item.idSuscriptionOptiva && bss.subscriberId && item.idSuscriptionOptiva === bss.subscriberId);
    if (item.idSuscriptionOptiva && bss.subscriberId && !idOk)
        return { estado: "fail", texto: `ID difiere: ${item.idSuscriptionOptiva} ≠ ${bss.subscriberId}` };
    if (item.fechaCompra && bss.primeraCompra) {
        return soloFecha(item.fechaCompra) === soloFecha(bss.primeraCompra)
            ? { estado: "ok", texto: idOk ? "ID y 1.ª compra coinciden" : "1.ª compra coincide" }
            : { estado: "fail", texto: `1.ª compra difiere: SIME ${soloFecha(item.fechaCompra)} ≠ BSS ${soloFecha(bss.primeraCompra)}` };
    }
    if (!bss.primeraCompra) return { estado: "na", texto: idOk ? "ID ok · BSS sin compra identificable" : "BSS sin compra identificable" };
    return { estado: "na", texto: "Verificación parcial" };
}

// Comentarios como LISTA de puntos (se muestran como <ul><li>…)
function generarComentarios(row) {
    const it = row.sime.items[0];
    const items = [];
    if (row.error) {
        items.push(`✖ Error al consultar: ${row.error}.`);
        items.push("Verificar conexión a la red interna y sesión activa.");
        return items;
    }
    if (row.bss?.multiBan) {
        const otras = row.bss.cuentas
            .filter(c => c.subscriberId !== row.bss.subscriberId)
            .map(c => `${c.ban} (${c.estadoLinea || c.estadoBssTexto})`).join(", ");
        items.push(`Línea con ${row.bss.cuentas.length} cuentas (BAN); servicios tomados de ${row.bss.seleccionManual ? "la cuenta elegida" : "la activa"} ${row.bss.ban}${otras ? ` · otras: ${otras}` : ""}.`);
    }
    if (!it) {
        if (row.bss) {
            items.push("⚠ Suscriptor en BSS sin registro en SIME.");
            const ced = row.bss.cliente?.cedula ? `, cédula ${row.bss.cliente.cedula}` : "";
            items.push(`Crear suscripción con: ID suscriptor ${row.bss.subscriberId}, línea ${row.msisdn}, cuenta ${row.bss.ban}${ced}.`);
        } else {
            items.push("Sin registro en BSS ni en SIME. Verificar línea.");
        }
        return items;
    }
    const p = calcularPeriodos(it);

    switch (row.estado) {
        case "ACTIVA": {
            const v = row.verif;
            const monto = row.bss?.montoPrimera ? ` por $${row.bss.montoPrimera.toLocaleString("es-CO")}` : "";
            if (v.estado === "ok") {
                items.push(`✔ Activa. Compra del ciclo vigente verificada en BSS el ${soloFecha(row.bss.primeraCompra)}${monto}, ID suscriptor ${row.bss.subscriberId}.`);
            } else if (v.estado === "fail") {
                items.push(`⚠ Activa, pero la verificación falla: ${v.texto}. Validar en BSS.`);
            } else {
                items.push(`⚠ Activa, sin verificación completa (${v.texto}).`);
            }
            if (row.bss?.primeraPorMonto)
                items.push("Compra identificada por monto (el canal no la nombra '1er Mes').");
            if (row.bss?.esRecompra)
                items.push("Re-compra detectada: se valida el ciclo vigente (hubo ciclos anteriores).");
            if (p)
                items.push(`Va en el mes ${p.mesActual} de ${p.total} (la 1.ª compra no cuenta como recurrencia).`);
            if (row.ciclos && row.ciclos.vigentes > 1)
                items.push(`Compras apiladas: ${row.ciclos.vigentes} ciclos vigentes; cobertura combinada ${row.ciclos.coberturaDesde} → ${row.ciclos.coberturaHasta} (${row.ciclos.mesesCubiertosRestantes} meses aún cubiertos).`);
            else if (row.ciclos && row.ciclos.vigentes === 1 && row.ciclos.ciclos.length > 1)
                items.push(`Hubo ${row.ciclos.ciclos.length} compras del plan; solo 1 ciclo sigue vigente (cobertura hasta ${row.ciclos.coberturaHasta}).`);
            if (row.bss?.comprasBss != null && p && row.bss.comprasBss !== p.consumidos)
                items.push(`BSS registra ${row.bss.comprasBss} compras del ciclo vigente (compra + ${row.bss.recurrenciasBss} recurrencias) vs ${p.consumidos} en SIME — revisar.`);
            if (row.bss && row.bss.comprasBss == null)
                items.push(`BSS sin transacción de compra identificable; ${row.bss.recurrenciasHistoricas ?? 0} recurrencias históricas sin ciclo asignable — validar manualmente.`);
            if (row.bss && row.bss.estadoBss !== 1)
                items.push(`BSS reporta ${row.bss.estadoBssTexto} — revisar.`);
            break;
        }
        case "INACTIVA":
            items.push("Reportar: suscripción INACTIVA.");
            if (it.fechaInactivacion) items.push(`Inactiva desde ${fmt(it.fechaInactivacion)}.`);
            items.push(`Motivo: ${it.motivoInactivacion || "no registrado"}.`);
            items.push("Si hubo portabilidad o cambio de línea, registra el siguiente ciclo con la línea nueva en «Crear en SIME».");
            break;
        case "SUSPENDIDA":
            items.push("Reportar: suscripción SUSPENDIDA.");
            if (it.portabilidad) items.push(`Portabilidad detectada el ${fmt(it.fechaDeteccionPortabilidad)}.`);
            items.push(`Motivo: ${it.motivoInactivacion || "no registrado"}.`);
            items.push("Si hubo portabilidad o cambio de línea, registra el siguiente ciclo con la línea nueva en «Crear en SIME».");
            break;
        case "FINALIZADA":
            items.push("Reportar: suscripción FINALIZADA (completó su ciclo).");
            if (p) items.push(`Plan de ${p.total} periodos; recurrencias ejecutadas: ${it.numeroRecurrenciasEjecutadas ?? "—"}.`);
            if (it.fechaInactivacion) items.push(`Finalizó el ${fmt(it.fechaInactivacion)}.`);
            break;
        case "CANCELADA":
            items.push("Reportar: suscripción CANCELADA.");
            if (it.fechaInactivacion) items.push(`Cancelada el ${fmt(it.fechaInactivacion)}.`);
            items.push(`Motivo: ${it.motivoInactivacion || "no registrado"}.`);
            break;
        default:
            items.push(`Pestaña ${row.pestana} sin caso de uso definido — revisar respuesta SIME.`);
    }
    return items;
}
const comentarioHTML = items => `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;

// Recalcula todo lo derivado de (item SIME + cuenta BSS elegida).
// Se usa al procesar la consulta y al cambiar de BAN en la modal.
function enriquecer(row) {
    row.periodos = row.item ? calcularPeriodos(row.item) : null;
    row.ciclos = row.item ? calcularCiclos(row.item, row.bss) : null;
    row.verif = verificar(row.item, row.bss);
    row.comentarios = generarComentarios(row);
    row.comentario = row.comentarios.join(" ");
    return row;
}

function procesar(raw) {
    return raw.map(r => {
        const it = r.sime.items[0] || null;
        const estado = it ? (ESTADO_POR_PESTANA[r.pestana] ?? `PESTAÑA_${r.pestana}`) : "SIN_SIME";
        return enriquecer({ ...r, item: it, estado, oculta: false });
    });
}

/* =====================================================================
   RENDER (DataTables + Bootstrap 5) + filtros + columnas + ocultar filas
===================================================================== */
let dataTable = null, filas = [];
// Alto del cuerpo de la tabla (scrollY). Al ser un recuadro con alto fijo,
// su barra horizontal queda siempre visible en pantalla.
const ALTO_TABLA = "58vh";
const HEADERS = ["Línea (MSISDN)", "Cédula", "Estado SIME", "Pestaña", "ID suscriptor BSS", "Estado BSS", "Plan",
    "F. compra SIME", "F. compra BSS", "Verificación", "Periodos", "Próxima ejecución", "Comentario", "Acción"];
const COL_ACCION = HEADERS.length - 1;
let colVisibles = HEADERS.map(() => true);
let mostrarOcultas = false;   // ver las líneas que el analista ya despachó

// Filtros seleccionados (vacío = sin filtro)
const filtroSel = { estado: new Set(), pestana: new Set(), estadoBss: new Set(), verif: new Set() };
const VERIF_LABEL = { ok: "Coincide", fail: "No coincide", na: "Sin verificar" };

// Filtro personalizado: usa la fila original por índice
DataTable.ext.search.push((settings, data, dataIndex) => {
    if (settings.nTable.id !== "tablaLineas") return true;
    const f = filas[dataIndex];
    if (!f) return true;
    if (f.oculta && !mostrarOcultas) return false;     // línea ocultada por el analista
    const pasa = (set, val) => !set.size || set.has(String(val));
    return pasa(filtroSel.estado, f.estado)
        && pasa(filtroSel.pestana, f.item ? f.pestana : "—")
        && pasa(filtroSel.estadoBss, f.bss ? f.bss.estadoBssTexto : "—")
        && pasa(filtroSel.verif, f.verif.estado);
});

function badgeEstado(e) {
    const lbl = e === "SIN_SIME" ? "SIN SIME" : e;
    return `<span class="badge badge-estado ${e}">${lbl}</span>`;
}
function chipVerif(v) {
    return `<span class="chip-verif ${v.estado}"><span class="dot"></span>${v.texto}</span>`;
}
function celdaPeriodos(p, ciclos) {
    if (!p) return `<span class="text-muted">—</span>`;
    const pct = Math.round(p.consumidos / p.total * 100);
    const extra = (ciclos && ciclos.vigentes > 1)
        ? `<small class="d-block">${ciclos.vigentes} ciclos vigentes · cobertura ${ciclos.coberturaDesde} → ${ciclos.coberturaHasta}</small>`
        : "";
    return `<div class="periodos">
    <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
    <small>${p.consumidos} consumidos · ${p.porConsumir} por consumir</small>${extra}
  </div>`;
}
// Botón de la columna "Acción": ocultar / restaurar la línea
function botonOcultarHTML(r) {
    return r.oculta
        ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-accion="ocultar" title="Volver a mostrarla">↩ Restaurar</button>`
        : `<button type="button" class="btn btn-sm btn-outline-dark" data-accion="ocultar" title="Ocultar esta línea de la tabla (sin acción pendiente)">🚫 Ocultar</button>`;
}

function construirFiltroDropdown(ul, valores, set, etiqueta) {
    const menu = document.getElementById(ul);
    menu.innerHTML = valores.map(v => `
<li><label class="dropdown-item mb-0 d-flex align-items-center gap-2">
  <input type="checkbox" class="form-check-input m-0" value="${v.valor}" ${set.has(String(v.valor)) ? "checked" : ""}>
  <span>${v.texto}</span>
</label></li>`).join("") || `<li><span class="dropdown-item text-muted">Sin valores</span></li>`;
    menu.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
        chk.checked ? set.add(chk.value) : set.delete(chk.value);
        actualizarEtiquetasFiltro();
        dataTable.draw();
    }));
}

function actualizarEtiquetasFiltro() {
    const et = (btn, base, set) => document.getElementById(btn).textContent = set.size ? `${base} (${set.size})` : base;
    et("btnFEstado", "Estado SIME", filtroSel.estado);
    et("btnFPestana", "Pestaña", filtroSel.pestana);
    et("btnFEstadoBss", "Estado BSS", filtroSel.estadoBss);
    et("btnFVerif", "Verificación", filtroSel.verif);
    sincronizarKPIsActivos();
}

function construirFiltros() {
    const distintos = (fn) => [...new Set(filas.map(fn))].sort();
    construirFiltroDropdown("fEstado",
        distintos(f => f.estado).map(v => ({ valor: v, texto: v })), filtroSel.estado);
    construirFiltroDropdown("fPestana",
        distintos(f => f.item ? f.pestana : "—").map(v => ({ valor: v, texto: v === "—" ? "— (sin SIME)" : `${v} · ${PESTANAS[v] || "?"}` })), filtroSel.pestana);
    construirFiltroDropdown("fEstadoBss",
        distintos(f => f.bss ? f.bss.estadoBssTexto : "—").map(v => ({ valor: v, texto: v })), filtroSel.estadoBss);
    construirFiltroDropdown("fVerif",
        distintos(f => f.verif.estado).map(v => ({ valor: v, texto: VERIF_LABEL[v] || v })), filtroSel.verif);
    actualizarEtiquetasFiltro();
}

function construirMenuColumnas() {
    menuColumnas.innerHTML = HEADERS.map((h, i) => `
<li><label class="dropdown-item mb-0 d-flex align-items-center gap-2">
  <input type="checkbox" class="form-check-input m-0" data-col="${i}" ${colVisibles[i] ? "checked" : ""}>
  <span>${h}</span>
</label></li>`).join("");
    menuColumnas.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
        const i = +chk.dataset.col;
        colVisibles[i] = chk.checked;
        dataTable.column(i).visible(chk.checked);
    }));
}

// KPIs: cuentan solo lo que sigue visible (las ocultas no confunden el conteo)
function actualizarKPIs() {
    const vis = filas.filter(f => !f.oculta);
    const c = e => vis.filter(f => f.estado === e).length;
    kpiActivas.textContent = c("ACTIVA"); kpiInactivas.textContent = c("INACTIVA");
    kpiSuspendidas.textContent = c("SUSPENDIDA"); kpiSinSime.textContent = c("SIN_SIME");
    kpiDescuadre.textContent = vis.filter(f => f.verif.estado === "fail").length;
}

function actualizarOcultas() {
    const n = filas.filter(f => f.oculta).length;
    btnVerOcultas.textContent = `${mostrarOcultas ? "🙈 Volver a esconderlas" : "👁 Ver ocultas"} (${n})`;
    btnVerOcultas.classList.toggle("btn-dark", mostrarOcultas);
    btnVerOcultas.classList.toggle("btn-outline-dark", !mostrarOcultas);
    btnRestaurarOcultas.classList.toggle("d-none", n === 0);
}

function alternarOculta(i, tr) {
    const f = filas[i];
    if (!f) return;
    f.oculta = !f.oculta;
    if (tr) {
        tr.classList.toggle("fila-oculta", f.oculta);
        const celda = tr.querySelector("td.col-accion");
        if (celda) celda.innerHTML = botonOcultarHTML(f);
    }
    actualizarOcultas();
    actualizarKPIs();
    if (dataTable) dataTable.draw(false);      // false = conserva la página actual
}

function render() {
    msgVacio.style.display = "none";
    barraFiltros.hidden = false;
    if (dataTable) { dataTable.destroy(); dataTable = null; }
    const tbody = document.querySelector("#tablaLineas tbody");
    tbody.innerHTML = filas.map((r, i) => `
    <tr data-i="${i}" class="${r.oculta ? "fila-oculta" : ""}">
      <td class="col-accion">${botonOcultarHTML(r)}</td>
      <td class="mono fw-semibold">${r.msisdn}</td>
      <td class="mono">${r.bss?.cliente?.cedula || "—"}</td>
      <td>${badgeEstado(r.estado)}</td>
      <td>${r.item ? `${r.pestana} · ${PESTANAS[r.pestana] || "?"}` : "—"}</td>
      <td class="mono">${r.bss?.subscriberId || "—"}</td>
      <td>${r.bss ? `${r.bss.estadoBssTexto}` : "—"}</td>
      <td>${r.item?.nombre || "—"}</td>
      <td class="mono" data-order="${r.item?.fechaCompra || ""}">${fmt(r.item?.fechaCompra)}</td>
      <td class="mono" data-order="${r.bss?.primeraCompra || ""}">${fmt(r.bss?.primeraCompra)}</td>
      <td>${chipVerif(r.verif)}</td>
      <td data-order="${r.periodos ? r.periodos.consumidos : -1}">${celdaPeriodos(r.periodos, r.ciclos)}</td>
      <td class="mono" data-order="${r.item?.fechaProximaEjecucion || ""}">${fmtSime(r.item?.fechaProximaEjecucion)}</td>
      <td class="col-comentario">${comentarioHTML(r.comentarios)}</td>
    </tr>`).join("");

    dataTable = new DataTable("#tablaLineas", {
        // scrollX + scrollY: el cuerpo se desplaza dentro de su propio
        // recuadro, así la barra horizontal queda siempre visible sin tener
        // que recorrer toda la página (ni todas las filas) en vertical.
        // scrollY se toma de ALTO_TABLA; scrollCollapse evita el hueco vacío
        // cuando hay pocas filas.
        scrollX: true,
        scrollY: ALTO_TABLA,
        scrollCollapse: true,
        deferRender: true,
        paging: true, pageLength: 10, lengthMenu: [1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100],
        searching: true, ordering: true,
        columnDefs: [{ targets: COL_ACCION, orderable: false, searchable: false }],
        language: {
            search: "Buscar:", lengthMenu: "Mostrar _MENU_ líneas",
            info: "Mostrando _START_–_END_ de _TOTAL_ líneas",
            infoEmpty: "Sin líneas", infoFiltered: "(filtrado de _MAX_)",
            zeroRecords: "Sin coincidencias", emptyTable: "Sin resultados",
            paginate: { first: "«", last: "»", next: "›", previous: "‹" }
        }
    });

    // Restaurar visibilidad de columnas elegida
    colVisibles.forEach((v, i) => { if (!v) dataTable.column(i).visible(false); });
    construirFiltros();
    construirMenuColumnas();
    actualizarKPIs();
    actualizarOcultas();
}

btnLimpiarFiltros.addEventListener("click", () => {
    Object.values(filtroSel).forEach(s => s.clear());
    construirFiltros();
    if (dataTable) dataTable.draw();
});

// Con scrollX los anchos se calculan una vez: hay que recalcularlos cuando
// cambia el espacio disponible (ventana o paneles colapsables).
const ajustarTabla = () => { if (dataTable) dataTable.columns.adjust(); };
window.addEventListener("resize", ajustarTabla);
document.addEventListener("shown.bs.collapse", ajustarTabla);
document.addEventListener("hidden.bs.collapse", ajustarTabla);

btnVerOcultas.addEventListener("click", () => {
    mostrarOcultas = !mostrarOcultas;
    actualizarOcultas();
    if (dataTable) dataTable.draw(false);
});
btnRestaurarOcultas.addEventListener("click", () => {
    filas.forEach(f => f.oculta = false);
    mostrarOcultas = false;
    render();
});

// Marca las tarjetas KPI cuyo filtro está aplicado exactamente
function sincronizarKPIsActivos() {
    document.querySelectorAll(".kpi-click").forEach(card => {
        const dim = card.dataset.fdim, val = card.dataset.fval;
        const set = filtroSel[dim];
        const activo = set && set.size === 1 && set.has(val);
        card.classList.toggle("kpi-activo", !!activo);
    });
}

// Las tarjetas del resumen funcionan como filtros rápidos
document.querySelectorAll(".kpi-click").forEach(card => {
    card.addEventListener("click", () => {
        if (!dataTable) return;                 // aún no hay resultados
        const dim = card.dataset.fdim, val = card.dataset.fval;
        const set = filtroSel[dim];
        const yaActivo = set.size === 1 && set.has(val);
        set.clear();
        if (!yaActivo) set.add(val);            // clic de nuevo = quitar el filtro
        construirFiltros();                     // re-pinta menús (checkbox sincronizado)
        dataTable.draw();
        if (!yaActivo) {
            document.getElementById("barraFiltros")
                .scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });
});

// Clic en la tabla: el botón de acción NO abre el detalle
document.querySelector("#tablaLineas").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    if (e.target.closest("[data-accion='ocultar']")) { alternarOculta(+tr.dataset.i, tr); return; }
    abrirDetalle(+tr.dataset.i);
});

// El botón "copiar" (.btn-copy[data-copy-target]) del modal de detalle lo
// maneja MEUI.copiarTexto vía delegación global — ver assets/me-ui.js.

// Aplana un objeto/array anidado en pares [ruta, valor] legibles
function aplanarObjeto(obj, prefijo = "", salida = []) {
    if (obj === null || obj === undefined) { salida.push([prefijo || "(vacío)", "—"]); return salida; }
    if (typeof obj !== "object") { salida.push([prefijo, obj === "" ? "—" : String(obj)]); return salida; }
    if (Array.isArray(obj)) {
        if (!obj.length) { salida.push([prefijo, "[ ]"]); return salida; }
        obj.forEach((v, i) => aplanarObjeto(v, `${prefijo}[${i}]`, salida));
        return salida;
    }
    const claves = Object.keys(obj);
    if (!claves.length) { salida.push([prefijo, "{ }"]); return salida; }
    claves.forEach(k => aplanarObjeto(obj[k], prefijo ? `${prefijo}.${k}` : k, salida));
    return salida;
}
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function tablaDatosHTML(pares) {
    if (!pares || !pares.length) return `<div class="text-muted" style="font-size:.8rem">Sin datos.</div>`;
    return `<table class="tbl-datos"><tbody>${pares.map(([k, v]) =>
        `<tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- Uso y Balance (bundleBalance) ---------- */
// Mapa TUNEABLE de unitType → categoría/unidad. Confirmados con datos reales:
//   0 = Voz (segundos) · 1 = Datos (bytes) · 2 = SMS (conteo).
//   Otros (3,4,…) caen en "Otros"; si tu BSS usa un código para saldo/dinero, dilo aquí.
const UNIT_TIPO = {
    "0": { cat: "Voz", u: "seg" },
    "1": { cat: "Datos", u: "bytes" },
    "2": { cat: "SMS", u: "conteo" },
    "3": { cat: "Saldo", u: "moneda" }
};
const CAT_ORDEN = ["Voz", "Datos", "SMS", "Saldo", "Otros"];

function nfmt(n, dec = 0) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtBytes(n) {
    n = Number(n) || 0;
    const GB = 1073741824, MB = 1048576, KB = 1024;
    if (n >= GB) return nfmt(n / GB, 2) + " GB";
    if (n >= MB) return nfmt(n / MB, 2) + " MB";
    if (n >= KB) return nfmt(n / KB, 2) + " KB";
    return nfmt(n) + " B";
}
function fmtVoz(seg) {
    const min = (Number(seg) || 0) / 60;
    return nfmt(min) + " min";
}
// Formatea una cantidad según la unidad de la categoría
function fmtCantidad(u, n) {
    if (u === "bytes") return fmtBytes(n);
    if (u === "seg") return fmtVoz(n);
    if (u === "conteo") return nfmt(n) + " SMS";
    if (u === "moneda") return "$" + nfmt(n, 2);
    return nfmt(n);
}
function nivelUso(pct) { return pct >= 90 ? "lvl-hi" : pct >= 70 ? "lvl-mid" : "lvl-ok"; }
// Fecha + hora en hora de Colombia (UTC-5), sin depender de la zona del navegador
function fmtFechaHora(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d) || d.getFullYear() < 2000) return "—";
    return d.toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    });
}

// Agrupa los bundles por categoría y arma el HTML de tarjetas con barra de consumo
function usoHTML(bundles) {
    const grupos = {};
    bundles.forEach(b => {
        const info = UNIT_TIPO[String(b.unitType)] || { cat: "Otros", u: "conteo" };
        (grupos[info.cat] ??= []).push({ ...b, _u: info.u });
    });
    let html = "";
    for (const cat of CAT_ORDEN) {
        const items = grupos[cat];
        if (!items || !items.length) continue;
        html += `<div class="uso-grupo">${cat} <span class="uso-tot">${items.length} bundle(s)</span></div>`;
        html += items.map(b => {
            const bal = b.balances?.[0] || {};
            const limite = Number(bal.personalLimit) || 0;
            const usado = Number(bal.personalUsed) || 0;
            const rest = Number(bal.personalBalance) || 0;
            const pct = limite > 0 ? Math.min(100, Math.round(usado / limite * 100)) : 0;
            const vencido = (() => { const d = new Date(b.expiryTime); return !isNaN(d) && d.getFullYear() >= 2000 && d < new Date(); })();
            const barra = limite > 0
                ? `<div class="bar"><div class="fill ${nivelUso(pct)}" style="width:${pct}%"></div></div>`
                : "";
            return `
<div class="uso-item ${vencido ? 'vencido' : ''}">
  <span class="uso-name">${escHtml(b.bundleName || b.bundleID || "—")}</span>
  <span class="uso-val"><span class="rem">${fmtCantidad(b._u, usado)}</span> <span class="lim">/ ${limite > 0 ? fmtCantidad(b._u, limite) : "sin límite"}</span></span>
  <div class="uso-lbl">Consumido / Total${limite > 0 ? ` · ${pct}%` : ""}</div>
  ${barra}
  <div class="uso-disp">Disponible <strong>${fmtCantidad(b._u, rest)}</strong></div>
  <div class="uso-sub">
    <span>${b.isPromotional === "true" ? "Promocional · " : ""}${vencido ? '<span class="badge-venc">vencido</span> ' : 'vence '}${fmtFechaHora(b.expiryTime)}</span>
    <span>ID ${escHtml(b.bundleID || "")}</span>
  </div>
</div>`;
        }).join("");
    }
    return html;
}

/* =====================================================================
   ALTA DE SUSCRIPCIÓN EN SIME (POST .../Suscription/registrar)
   Campos fijos por definición del proceso (no se piden en el formulario):
     tipoDocumento "CC" · documento "0" · adicionalesSuscripcion "{}"
     transaccionId "" · id 0
   La LÍNEA sí es editable: si hubo portabilidad o el cliente cambia de
   número para el siguiente ciclo, se registra con la línea nueva.
===================================================================== */
const CANALES = [
    { v: "01", t: "POS" }, { v: "02", t: "PRESENTE" }, { v: "03", t: "PAGINA WEB" },
    { v: "04", t: "Contingencia" }, { v: "05", t: "MarketPlace_PuntoCol" },
    { v: "06", t: "Empresas" }, { v: "07", t: "Gestores" }
];

// Catálogo de planes, en el MISMO orden del desplegable de SIME.
// El ID de tipo de suscripción se asume = posición + 1 (en la lista real,
// "Pague 3 Lleve 4 paquete $19.900 - POS" está en la posición 15 y su
// tipoSuscripcionId es 16). El campo queda editable para poder corregirlo.
const TIPOS_SUSCRIPCION = [
    "test",
    "Pague 3 Lleve 4 paquete $19.900 - PCompraPrepagadaWeb",
    "Pague 3 Lleve 4 paquete $24.900 - PCompraPrepagadaWeb",
    "Pague 3 Lleve 4 paquete $35.000 - PCompraPrepagadaWeb",
    "Pague 3 Lleve 4 paquete $25.000 - Presente",
    "Pague 3 Lleve 4 paquete $35.000 - Presente",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaPCO",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaPyP",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaTP",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaPCO",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaPyP",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaTP",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaPCO",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaPyP",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaTP",
    "Pague 3 Lleve 4 paquete $19.900 - POS",
    "Pague 3 Lleve 4 paquete $49.900 - POS",
    "Pague 3 Lleve 4 paquete $24.900 - POS",
    "Pague 3 Lleve 4 paquete $35.000 - POS",
    "Pague 3 Lleve 4 paquete $19.900 - Presente",
    "Prepagada Convenio Empleados",
    "Prepagada 5.000 PCO - PPrepagadaPCO",
    "Pague 3 Lleve 4 paquete $19.900 - Contingencia",
    "Pague 3 Lleve 4 paquete $35.000 - Contingencia",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaTC",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaTC",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaTC",
    "Pague 3 Lleve 4 paquete $24.900 - Contingencia",
    "Paquete $35.000 - Presente",
    "Paquete $19.900 - Presente",
    "Paquete $25.000 - Presente",
    "Paquete $45.000 - Presente",
    "Paquete $10.000 - Presente",
    "Prepagada 5.000 PCO - MKPuntosColombia",
    "Generico Primera compra Presente",
    "Paquete $9.900 - Presente Familiar",
    "Paquete $7.500 - Presente Familiar",
    "Paquete $5.000 - Presente Familiar",
    "Paquete $2.500 - Presente Familiar",
    "Pague 3 Lleve 4 paquete $35.000 - Presente",
    "Pague 8 Lleve 12 paquete $159.200 - Presente",
    "Pague 8 Lleve 12 paquete $280.000 - Presente",
    "Pague 8 Lleve 12 paquete $199.200 - Presente",
    "Prepagada Convenio Corporativo 3X6 Pasteur- Empresas",
    "Prepagada Convenio Corporativo 3X6 Pasteur- Contingencia",
    "Pague 8 Lleve 12 paquete $159.200 - POS",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaPCO",
    "Pague 8 Lleve 12 paquete $199.200 - POS",
    "Pague 8 Lleve 12 paquete $280.000 - POS",
    "Pague 8 Lleve 12 paquete $159.200 - PCompraPrepagadaWeb",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaPCO",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaTP",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaPyP",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaTC",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaTP",
    "Pague 8 Lleve 12 paquete $199.200 - PCompraPrepagadaWeb",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaPyP",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaTC",
    "Pague 8 Lleve 12 paquete $280.000 - PCompraPrepagadaWeb",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaPCO",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaTP",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaPyP",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaTC",
    "Paquete $24.900 - Presente",
    "Pague 8 Lleve 12 paquete $159.200 - PTM",
    "Pague 3 Lleve 4 paquete $19.900 - PTM",
    "Paquete $19.900 - Debito Automatico",
    "Paquete $24.900 - Debito Automatico",
    "Paquete $35.000 - Debito Automatico",
    "Pague 3 Lleve 4 paquete $35.000 - Presente 31 días",
    "Pague 3 Lleve 4 paquete $24.900 - PTM",
    "Pague 8 Lleve 12 paquete $199.200 - PTM"
];

/* -------------------------------------------------------------------
   PLU DE 1.ª COMPRA POR SERVICIO (plan)
   Catálogo oficial: nombre EXACTO del plan → PLU de 1.ª compra.
   Prioridad al llenar el formulario:
     PLU aprendido de SIME (dato real de la línea) > este catálogo > a mano.
   Notas:
     · "" (vacío)  → el plan no tiene PLU en el catálogo.
     · PLU_MANUAL  → el PLU depende de la venta y lo debe escribir el
                     analista (caso "Generico Primera compra Presente").
     · Varios planes comparten PLU a propósito (mismo paquete, distinto canal).
------------------------------------------------------------------- */
const PLU_MANUAL = "MANUAL";
const PLU_PRIMERA_COMPRA = {
    "test": "",
    "Pague 3 Lleve 4 paquete $19.900 - PCompraPrepagadaWeb": "1741695",
    "Pague 3 Lleve 4 paquete $24.900 - PCompraPrepagadaWeb": "1844089",
    "Pague 3 Lleve 4 paquete $35.000 - PCompraPrepagadaWeb": "3092311",
    "Pague 3 Lleve 4 paquete $25.000 - Presente": "1828099",
    "Pague 3 Lleve 4 paquete $35.000 - Presente": "3383537",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaPCO": "1741695",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaPyP": "1741695",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaTP": "1741695",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaPCO": "1844089",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaPyP": "1844089",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaTP": "1844089",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaPCO": "3092311",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaPyP": "3092311",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaTP": "3092311",
    "Pague 3 Lleve 4 paquete $19.900 - POS": "1741695",
    "Pague 3 Lleve 4 paquete $49.900 - POS": "1741697",
    "Pague 3 Lleve 4 paquete $24.900 - POS": "1844089",
    "Pague 3 Lleve 4 paquete $35.000 - POS": "3092311",
    "Pague 3 Lleve 4 paquete $19.900 - Presente": "3284237",
    "Prepagada Convenio Empleados": "10003",
    "Prepagada 5.000 PCO - PPrepagadaPCO": "3305221",
    "Pague 3 Lleve 4 paquete $19.900 - Contingencia": "1741695",
    "Pague 3 Lleve 4 paquete $35.000 - Contingencia": "3092311",
    "Pague 3 Lleve 4 paquete $19.900 - PPrepagadaTC": "1741695",
    "Pague 3 Lleve 4 paquete $24.900 - PPrepagadaTC": "1844089",
    "Pague 3 Lleve 4 paquete $35.000 - PPrepagadaTC": "3092311",
    "Pague 3 Lleve 4 paquete $24.900 - Contingencia": "1844089",
    "Paquete $35.000 - Presente": "3085868",
    "Paquete $19.900 - Presente": "595633",
    "Paquete $25.000 - Presente": "1590611",
    "Paquete $45.000 - Presente": "1590612",
    "Paquete $10.000 - Presente": "1590610",
    "Prepagada 5.000 PCO - MKPuntosColombia": "3305221",
    "Generico Primera compra Presente": PLU_MANUAL,
    "Paquete $9.900 - Presente Familiar": "330271",
    "Paquete $7.500 - Presente Familiar": "3337864",
    "Paquete $5.000 - Presente Familiar": "227132",
    "Paquete $2.500 - Presente Familiar": "333203",
    "Pague 8 Lleve 12 paquete $159.200 - Presente": "3481975",
    "Pague 8 Lleve 12 paquete $280.000 - Presente": "3482774",
    "Pague 8 Lleve 12 paquete $199.200 - Presente": "3482752",
    "Prepagada Convenio Corporativo 3X6 Pasteur- Empresas": "10011",
    "Prepagada Convenio Corporativo 3X6 Pasteur- Contingencia": "10011",
    "Pague 8 Lleve 12 paquete $159.200 - POS": "3511936",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaPCO": "3512525",
    "Pague 8 Lleve 12 paquete $199.200 - POS": "3512525",
    "Pague 8 Lleve 12 paquete $280.000 - POS": "3512530",
    "Pague 8 Lleve 12 paquete $159.200 - PCompraPrepagadaWeb": "3511936",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaPCO": "3511936",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaTP": "3511936",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaPyP": "3511936",
    "Pague 8 Lleve 12 paquete $159.200 - PPrepagadaTC": "3511936",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaTP": "3512525",
    "Pague 8 Lleve 12 paquete $199.200 - PCompraPrepagadaWeb": "3512525",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaPyP": "3512525",
    "Pague 8 Lleve 12 paquete $199.200 - PPrepagadaTC": "3512525",
    "Pague 8 Lleve 12 paquete $280.000 - PCompraPrepagadaWeb": "3512530",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaPCO": "3512530",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaTP": "3512530",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaPyP": "3512530",
    "Pague 8 Lleve 12 paquete $280.000 - PPrepagadaTC": "3512530",
    "Paquete $24.900 - Presente": "332403",
    "Pague 8 Lleve 12 paquete $159.200 - PTM": "3511936",
    "Pague 3 Lleve 4 paquete $19.900 - PTM": "1741695",
    "Paquete $19.900 - Debito Automatico": "595633",
    "Paquete $24.900 - Debito Automatico": "332403",
    "Paquete $35.000 - Debito Automatico": "3085868",
    "Pague 3 Lleve 4 paquete $35.000 - Presente 31 días": "3772789",
    "Pague 3 Lleve 4 paquete $24.900 - PTM": "1844089",
    "Pague 8 Lleve 12 paquete $199.200 - PTM": "3512525"
};

// Aprende plan → {tipoSuscripcionId, plu, canalId} de las líneas ya consultadas
// que SÍ tienen registro en SIME: son datos reales, no supuestos.
function catalogoAprendido() {
    const m = new Map();
    filas.forEach(f => {
        const it = f.item;
        if (it?.nombre && it.tipoSuscripcionId != null && !m.has(it.nombre))
            m.set(it.nombre, { id: it.tipoSuscripcionId, plu: it.plu ?? null, canalId: it.canalId ?? null });
    });
    return m;
}
// PLU conocidos por plan: catálogo fijo + lo aprendido de SIME (esto último manda)
function catalogoPlu() {
    const m = new Map();
    Object.entries(PLU_PRIMERA_COMPRA).forEach(([n, plu]) => {
        if (plu == null || plu === "") return;
        m.set(n, { plu, origen: "catálogo", manual: plu === PLU_MANUAL });
    });
    filas.forEach(f => {
        const it = f.item;
        if (it?.nombre && it.plu != null && it.plu !== "")
            m.set(it.nombre, { plu: it.plu, origen: "aprendido de SIME", manual: false });
    });
    return m;
}
// Canal sugerido a partir del sufijo del nombre del plan
function canalDeNombre(n) {
    const s = String(n || "");
    if (/-\s*POS\b/i.test(s)) return "01";
    if (/Presente/i.test(s)) return "02";
    if (/PCompraPrepagadaWeb/i.test(s)) return "03";
    if (/Contingencia/i.test(s)) return "04";
    if (/PCO|PuntosColombia/i.test(s)) return "05";
    if (/Empresas/i.test(s)) return "06";
    return "";
}
// Usuario que va en usuarioCreacion: sale del token prf de SIME
function usuarioSime() {
    try {
        const p = JSON.parse(atob(cfgTokenSime.value.trim()));
        return p.UserName || p.Usuario || p.usuario || p.Nombre || "";
    } catch (_) { return ""; }
}
const dtLocal = iso => iso ? String(iso).slice(0, 19) : "";

let filaActual = null;   // índice de la fila abierta en la modal

/* -------------------------------------------------------------------
   CAMPOS DERIVADOS DEL PLAN  (regla de negocio, v7.2)
   El "Tipo de suscripción" es el CAMPO MAESTRO: cada vez que cambia,
   Canal de venta, ID tipo suscripción y PLU de 1.ª compra se RECALCULAN
   Y SE SOBRESCRIBEN SIEMPRE, sin importar lo que hubiera antes.
   Antes se conservaban valores del plan anterior (p. ej. al pasar de una
   suscripción finalizada al plan de la compra vigente) y SIME respondía
   400 "One or more validation errors occurred" por combinación inválida.
------------------------------------------------------------------- */
let tRecalc = null;
function marcarRecalculo(txt) {
    crRecalc.textContent = txt || "";
    clearTimeout(tRecalc);
    if (txt) tRecalc = setTimeout(() => { crRecalc.textContent = ""; }, 6000);
}

// Bloque de solo lectura: valores fijos del proceso + los dos campos que
// ya no se editan a mano (ID tipo suscripción y usuario creación).
function pintarFijos() {
    const fijos = [
        ["Tipo documento", "CC"], ["Documento", "0"], ["Adicionales", "{}"],
        ["transaccionId", "(vacío)"], ["id", "0"]
    ].map(([k, v]) => `<span class="fijo"><b>${k}:</b> ${escHtml(v)}</span>`).join("");
    const calc = [
        ["ID tipo suscripción", crTipoId.value || "— elige el plan —",
            "Se deriva del plan: aprendido de SIME o posición en el catálogo."],
        ["Usuario creación", crUsuario.value || "— sin usuario en el token prf —",
            "Sale del token prf de SIME."]
    ].map(([k, v, t]) => `<span class="fijo calc" title="${escHtml(t)}"><b>${k}:</b> ${escHtml(v)}</span>`).join("");
    mdCrearFijos.innerHTML = fijos + calc;
}

// Sin plan elegido: todo lo derivado queda en blanco (nunca heredado)
function limpiarDerivados() {
    crTipoId.value = "";
    crPlu.value = "";
    crCanal.value = "";
    crPluHint.textContent = "Se llena al elegir el plan.";
    crCanalHint.textContent = "Se llena al elegir el plan.";
    pintarFijos();
    actualizarPayload();
}

/* -------------------------------------------------------------------
   BUSCADOR DEL CATÁLOGO DE PLANES
   Son ~70 planes: el select se filtra por texto. La búsqueda ignora
   acentos y signos, así que "19900" encuentra "$19.900" y se pueden
   encadenar palabras ("lleve 12 pos" = todas deben aparecer).
------------------------------------------------------------------- */
const compactoPlan = s => norm(s).replace(/[^a-z0-9]/g, "");

// Etiqueta de cada plan: marca ✓id / ✓PLU cuando el dato es REAL y no supuesto
function opcionesPlan() {
    const aprendido = catalogoAprendido(), plus = catalogoPlu();
    return TIPOS_SUSCRIPCION.map((n, idx) => {
        const a = aprendido.get(n), p = plus.get(n);
        const marcaPlu = p ? (p.manual ? " ✎ PLU manual" : ` ✓PLU ${p.plu}`) : "";
        return { idx, nombre: n, etiqueta: `${n}${a ? " ✓id" : ""}${marcaPlu}` };
    });
}

function pintarOpcionesPlan() {
    const q = crTipoBuscar.value.trim();
    const sel = crTipoNombre.value;                       // no perder la selección actual
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    const casa = o => tokens.every(t =>
        norm(o.nombre).includes(t) || compactoPlan(o.nombre).includes(compactoPlan(t)));
    const todas = opcionesPlan();
    let lista = tokens.length ? todas.filter(casa) : todas;
    // El plan ya elegido siempre queda disponible, aunque no case con el filtro
    if (sel !== "" && !lista.some(o => String(o.idx) === sel)) {
        const actual = todas.find(o => String(o.idx) === sel);
        if (actual) lista = [actual, ...lista];
    }
    crTipoNombre.innerHTML = `<option value="">— elegir plan —</option>`
        + lista.map(o => `<option value="${o.idx}">${escHtml(o.etiqueta)}</option>`).join("");
    crTipoNombre.value = sel;
    // Con filtro activo el select se abre como lista para ver los resultados
    crTipoNombre.size = tokens.length ? Math.min(8, Math.max(2, lista.length + 1)) : 1;
    crTipoCount.textContent = tokens.length
        ? `${lista.length} de ${todas.length} planes coinciden`
        : `${todas.length} planes en el catálogo`;
}

crTipoBuscar.addEventListener("input", pintarOpcionesPlan);
// Enter = elegir el primer resultado
crTipoBuscar.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const primera = [...crTipoNombre.options].find(o => o.value !== "");
    if (!primera) return;
    crTipoNombre.value = primera.value;
    crTipoNombre.size = 1;
    alElegirTipo();
});
btnTipoBuscarLimpiar.addEventListener("click", () => {
    crTipoBuscar.value = "";
    pintarOpcionesPlan();
    crTipoBuscar.focus();
});

function pintarCrearSime(r, i) {
    filaActual = i;
    const plus = catalogoPlu();
    const yaExiste = !!r.item;

    mdCrearInfo.textContent = yaExiste
        ? "la línea ya tiene suscripción en SIME"
        : "la línea no está en SIME";

    mdCrearAviso.innerHTML = yaExiste
        ? `<div class="alert alert-warning py-2 mb-0" style="font-size:.8rem">
     ⚠ Esta línea ya tiene una suscripción en SIME (${r.estado}). Registrar otra puede duplicarla.
     <div class="form-check mt-1">
       <input class="form-check-input" type="checkbox" id="crConfirmaDup">
       <label class="form-check-label" for="crConfirmaDup">Entiendo el riesgo, quiero crearla de todos modos</label>
     </div>
   </div>`
        : "";

    // Selects
    crCanal.innerHTML = `<option value="">— elegir —</option>`
        + CANALES.map(c => `<option value="${c.v}">${c.v} · ${c.t}</option>`).join("");
    crTipoBuscar.value = "";
    pintarOpcionesPlan();

    // Sugerencias del campo PLU: un PLU por valor (varios planes comparten el
    // mismo), etiquetado con el plan y cuántos más lo usan.
    const porPlu = new Map();
    plus.forEach((p, n) => {
        if (p.manual) return;
        const k = String(p.plu);
        (porPlu.get(k) || porPlu.set(k, []).get(k)).push(n);
    });
    dlPlu.innerHTML = [...porPlu.entries()].map(([plu, nombres]) =>
        `<option value="${escHtml(plu)}">${escHtml(nombres[0])}${nombres.length > 1 ? ` (+${nombres.length - 1} planes)` : ""}</option>`
    ).join("");

    // Prefill con lo que ya sabemos de la línea (nada de esto depende del plan)
    crMsisdn.value = r.msisdn;
    crOptiva.value = r.bss?.subscriberId || "";
    crFechaCompra.value = dtLocal(r.bss?.primeraCompra) || dtLocal(r.item?.fechaCompra);
    crUsuario.value = usuarioSime();
    crRecurrente.checked = true;
    crEstado.textContent = ""; crResultado.innerHTML = ""; marcarRecalculo("");

    // Arranca SIN plan: lo derivado se calcula, nunca se hereda.
    crTipoNombre.value = "";
    limpiarDerivados();

    if (r.item?.nombre) {
        const idx = TIPOS_SUSCRIPCION.indexOf(r.item.nombre);
        if (idx >= 0) {
            crTipoNombre.value = String(idx);
            alElegirTipo();                 // los derivados salen del PLAN, no del registro viejo
            marcarRecalculo("");
            crTipoHint.innerHTML = `Precargado con el plan del registro actual en SIME. <strong>Si vas a registrar el ciclo nuevo, elige aquí el plan de esa compra</strong>: canal, ID de tipo y PLU se recalculan solos.`;
        } else {
            crTipoHint.innerHTML = `<span class="text-danger">El plan del registro actual ("${escHtml(r.item.nombre)}") no está en el catálogo: elige el plan a registrar.</span>`;
        }
    } else {
        crTipoHint.textContent = plus.size
            ? `${plus.size} plan(es) con PLU de 1.ª compra en catálogo — elige el plan y lo derivado se llena solo.`
            : "Elige el plan: canal, ID de tipo y PLU se calculan a partir de él.";
    }

    avisoMsisdn();
    pintarFijos();
    actualizarPayload();
}

// Aviso cuando el analista cambia la línea (portabilidad / cambio de número)
function avisoMsisdn() {
    const r = filas[filaActual] || {};
    const v = crMsisdn.value.trim();
    if (!v) { crMsisdnAviso.innerHTML = `<span class="text-danger">Escribe la línea a registrar.</span>`; return; }
    if (!/^\d{7,12}$/.test(v)) { crMsisdnAviso.innerHTML = `<span class="text-danger">Formato de línea inválido.</span>`; return; }
    crMsisdnAviso.innerHTML = (v === String(r.msisdn || ""))
        ? "Línea consultada (por defecto)."
        : `<span class="text-warning-emphasis">⚠ Distinta de la consultada (${escHtml(r.msisdn || "")}): se registrará con <strong>${escHtml(v)}</strong>.</span>`;
}

// Al elegir plan: SOBRESCRIBE canal, ID de tipo y PLU con los de ESE plan.
// Nunca conserva lo del plan anterior (causa del 400 de validación en SIME).
function alElegirTipo() {
    const idx = crTipoNombre.value;
    if (idx === "") { limpiarDerivados(); marcarRecalculo(""); return; }
    const nombre = TIPOS_SUSCRIPCION[+idx];
    const a = catalogoAprendido().get(nombre);   // dato real de SIME, si lo hay
    const p = catalogoPlu().get(nombre);         // catálogo fijo + aprendido

    // 1) ID tipo suscripción: aprendido de SIME > posición + 1 (supuesto)
    crTipoId.value = a ? a.id : (+idx + 1);
    // 2) Canal de venta: aprendido de SIME > deducido del sufijo del plan
    crCanal.value = (a && a.canalId != null)
        ? String(a.canalId).padStart(2, "0")
        : canalDeNombre(nombre);
    // 3) PLU 1.ª compra: catálogo/aprendido; vacío si el plan lo exige manual
    crPlu.value = (p && !p.manual) ? p.plu : "";

    crCanalHint.innerHTML = crCanal.value
        ? `Canal ${escHtml(crCanal.value)} · ${(a && a.canalId != null) ? "aprendido de SIME" : "deducido del nombre del plan"}`
        : `<span class="text-danger">Sin canal para este plan — elígelo a mano.</span>`;
    crPluHint.innerHTML = !p
        ? `<span class="text-danger">Sin PLU conocido para este plan — escríbelo a mano (y agrégalo a PLU_PRIMERA_COMPRA).</span>`
        : p.manual
            ? `<span class="text-danger">⚠ Este plan no tiene PLU fijo: escribe el de la venta.</span>`
            : `PLU ${escHtml(p.plu)} · ${p.origen}`;

    marcarRecalculo(`✓ Recalculado para «${nombre}»: canal ${crCanal.value || "—"} · ID tipo ${crTipoId.value} · PLU ${crPlu.value || "(manual)"}.`);
    pintarFijos();
    actualizarPayload();
}

function payloadCrear() {
    let f = crFechaCompra.value || "";
    if (f.length === 16) f += ":00";           // sin segundos → añade :00
    return {
        transaccionId: "",
        id: 0,
        idSuscriptionOptiva: crOptiva.value.trim(),
        esRecurrente: crRecurrente.checked,
        canalVenta: crCanal.value,
        tipoDocumento: "CC",
        documento: "0",
        plu: crPlu.value ? Number(crPlu.value) : null,
        MSISDN: crMsisdn.value.trim(),
        fechaCompra: f ? `${f}.000Z` : "",
        adicionalesSuscripcion: "{}",
        usuarioCreacion: crUsuario.value.trim(),
        tipoSuscripcion: crTipoId.value ? Number(crTipoId.value) : null
    };
}
function actualizarPayload() {
    crPayload.textContent = JSON.stringify(payloadCrear(), null, 2);
}

function validarCrear(p) {
    const faltan = [];
    if (!p.canalVenta) faltan.push("canal de venta");
    if (!p.tipoSuscripcion) faltan.push("ID tipo suscripción (elige el plan)");
    if (!p.plu) faltan.push("PLU de 1.ª compra");
    if (!p.idSuscriptionOptiva) faltan.push("ID suscripción Optiva");
    if (!p.fechaCompra) faltan.push("fecha de compra");
    if (!p.usuarioCreacion) faltan.push("usuario creación (obtén el token prf de SIME)");
    if (!p.MSISDN) faltan.push("línea");
    else if (!/^\d{7,12}$/.test(p.MSISDN)) faltan.push("línea con formato válido");
    return faltan;
}

async function crearEnSime() {
    const p = payloadCrear();
    const faltan = validarCrear(p);
    if (faltan.length) {
        crResultado.innerHTML = `<div class="alert alert-danger py-2 mb-0" style="font-size:.8rem">Faltan datos: ${faltan.join(", ")}.</div>`;
        return;
    }
    const conf = document.getElementById("crConfirmaDup");
    if (conf && !conf.checked) {
        crResultado.innerHTML = `<div class="alert alert-danger py-2 mb-0" style="font-size:.8rem">Marca la casilla de confirmación: la línea ya existe en SIME.</div>`;
        return;
    }
    btnCrearSime.disabled = true;
    crEstado.textContent = "Registrando…";
    crResultado.innerHTML = "";
    try {
        const res = await fetch(CONFIG.simeRegistrar, {
            method: "POST", credentials: "include",
            headers: headersSime({ "content-type": "application/json" }),
            body: JSON.stringify(p)
        });
        const txt = await res.text();
        let cuerpo; try { cuerpo = JSON.parse(txt); } catch (_) { cuerpo = txt; }
        if (!res.ok) throw new Error(`${res.status} · ${String(txt).slice(0, 300)}`);
        const original = String(filas[filaActual]?.msisdn || "");
        const cambioLinea = p.MSISDN !== original;
        crEstado.innerHTML = `<span class="chip-verif ok"><span class="dot"></span>Creada</span>`;
        crResultado.innerHTML = `<div class="alert alert-success py-2 mb-0" style="font-size:.8rem">
    ✔ Suscripción registrada para ${p.MSISDN}${cambioLinea ? ` <strong>(la línea consultada era ${escHtml(original)})</strong>` : ""}.
    <details class="mt-1"><summary>Respuesta de SIME</summary>
      <pre class="json mono mt-2" style="max-height:200px">${escHtml(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo, null, 2))}</pre>
    </details>
  </div>`;
        log(`✔ SIME: suscripción creada para ${p.MSISDN}${cambioLinea ? ` (consultada: ${original})` : ""} (plan ${p.tipoSuscripcion}, PLU ${p.plu}).`);
        if (!cambioLinea) await refrescarLinea(filaActual);
        else crEstado.innerHTML += ` <span class="text-muted" style="font-size:.78rem">Se registró otra línea: consulta ${escHtml(p.MSISDN)} para verla.</span>`;
    } catch (e) {
        crEstado.innerHTML = `<span class="chip-verif fail"><span class="dot"></span>Error</span>`;
        crResultado.innerHTML = `<div class="alert alert-danger py-2 mb-0" style="font-size:.8rem">✖ No se pudo crear: ${escHtml(e.message)}</div>`;
        log(`✖ SIME alta ${p.MSISDN}: ${e.message}`);
    } finally {
        btnCrearSime.disabled = false;
    }
}

// Vuelve a consultar SOLO esa línea y actualiza su fila y la modal
async function refrescarLinea(i) {
    const r = filas[i];
    if (!r) return;
    crEstado.textContent = "Actualizando la línea…";
    try {
        cacheServicios.clear();                       // datos frescos de BSS
        const raw = await consultarLinea(r.msisdn, !!auth.token);
        const nueva = procesar([raw])[0];
        nueva.oculta = r.oculta;                      // respeta si estaba oculta
        filas[i] = nueva;
        render();
        abrirDetalle(i);
        crEstado.textContent = "";
    } catch (e) {
        crEstado.textContent = "Creada, pero no se pudo refrescar: " + e.message;
    }
}

btnCrearSime.addEventListener("click", crearEnSime);
crTipoNombre.addEventListener("change", () => { crTipoNombre.size = 1; alElegirTipo(); });
btnMsisdnOriginal.addEventListener("click", () => {
    crMsisdn.value = String(filas[filaActual]?.msisdn || "");
    avisoMsisdn(); actualizarPayload();
});
crMsisdn.addEventListener("input", avisoMsisdn);
["crMsisdn", "crCanal", "crTipoId", "crPlu", "crOptiva", "crFechaCompra", "crUsuario", "crRecurrente"]
    .forEach(id => document.getElementById(id).addEventListener("input", actualizarPayload));

/* =====================================================================
   RECURRENCIAS DE LA SUSCRIPCIÓN (SIME)
   Lectura por suscripción y edición de una recurrencia (fecha de próxima
   ejecución y número de recurrencia). Se cachean por
   suscripcionRecurrenteId; el botón ↻ fuerza una relectura.
   OJO: SIME espera `numeroRecurrencia` como TEXTO y la fecha con sufijo
   ".000Z" aunque el valor sea hora Colombia (misma convención del alta).
===================================================================== */
const cacheRecurrencias = new Map();
let recActual = null;                 // recurrencia que se está editando

// Las fechas "vacías" de SIME llegan como 0001-01-01T00:00:00
const fmtSime = iso => (!iso || String(iso).slice(0, 4) === "0001") ? "—" : fmt(iso);

function pintarRecFijos() {
    const x = recActual || {};
    const filasFijas = [
        ["ID recurrencia", x.recurrenciaId ?? "—", false, "Lo asigna SIME; no se puede cambiar."],
        ["Suscripción", x.suscripcionRecurrenteId ?? "—", false, ""],
        ["Línea", x.msisdn ?? "—", false, ""],
        ["PLU", x.plu ?? "—", false, "PLU con el que SIME planificó el cobro."],
        ["TransaccionId", "(vacío)", false, "Fijo por definición del proceso."],
        ["Usuario modificación", usuarioSime() || "— sin usuario en el token prf —", true, "Sale del token prf de SIME."]
    ];
    mdRecFijos.innerHTML = filasFijas.map(([k, v, calc, t]) =>
        `<span class="fijo${calc ? " calc" : ""}" title="${escHtml(t)}"><b>${k}:</b> ${escHtml(v)}</span>`).join("");
}

function payloadRec() {
    let f = reFecha.value || "";
    if (f.length === 16) f += ":00";                    // sin segundos → añade :00
    return {
        TransaccionId: "",
        usuarioModificacion: usuarioSime(),
        recurrenciaId: recActual ? Number(recActual.recurrenciaId) : null,
        fechaProximaEjecucion: f ? `${f}.000Z` : "",
        numeroRecurrencia: String(reNumero.value ?? "").trim()   // SIME lo espera como texto
    };
}

function actualizarPayloadRec() {
    const p = payloadRec();
    rePayload.textContent = JSON.stringify(p, null, 2);
    if (!recActual) { reDiff.textContent = ""; return; }
    const fAntes = dtLocal(recActual.fechaProximaEjecucion);
    const fAhora = p.fechaProximaEjecucion.slice(0, 19);
    const nAntes = String(recActual.numeroRecurrencia ?? "");
    const cambios = [];
    if (fAhora && fAhora !== fAntes) cambios.push(`Próxima ejecución: ${fmtSime(fAntes)} → ${fmtSime(fAhora)}`);
    if (p.numeroRecurrencia !== nAntes) cambios.push(`Nº de recurrencia: ${nAntes || "—"} → ${p.numeroRecurrencia || "—"}`);
    reDiff.innerHTML = cambios.length
        ? cambios.map(c => escHtml(c)).join("<br>")
        : `<span class="text-muted">Sin cambios respecto a lo que hay en SIME.</span>`;
    reNumeroAviso.innerHTML = p.numeroRecurrencia !== nAntes
        ? `<span class="text-warning-emphasis">⚠ Cambia el ciclo que SIME considera en curso.</span>`
        : "Ciclo planificado por SIME.";
}

function pintarTablaRec(data) {
    const recs = (data?.recurrencias || []).slice()
        .sort((a, b) => (a.numeroRecurrencia || 0) - (b.numeroRecurrencia || 0));
    mdRecInfo.textContent = `${data?.count ?? recs.length} recurrencia(s)`;
    mdRec.innerHTML = recs.length
        ? recs.map(x => {
            const det = (x.detalles || []).map(d => `${escHtml(d.key)}: ${escHtml(d.value)}`).join("<br>");
            const editando = recActual && String(recActual.recurrenciaId) === String(x.recurrenciaId);
            return `
      <tr class="${editando ? "rec-editando" : ""}">
<td class="mono">${x.numeroRecurrencia ?? "—"}</td>
<td class="mono">${escHtml(x.recurrenciaId ?? "—")}</td>
<td class="mono">${fmtSime(x.fechaProximaEjecucion)}</td>
<td>${escHtml(estadoRecTexto(x.estado))}</td>
<td class="mono text-end">${x.plu ?? "—"}</td>
<td class="mono">${fmtSime(x.fechaInicioEjecucion)} / ${fmtSime(x.fechaFinEjecucion)}</td>
<td class="mono">${escHtml(x.usuarioPlanifica || "—")}</td>
<td class="rec-detalles">${det || "—"}</td>
<td><button type="button" class="btn btn-sm btn-outline-dark" data-editar-rec="${escHtml(x.recurrenciaId ?? "")}">✎ Editar</button></td>
      </tr>`;
        }).join("")
        : `<tr><td colspan="9" class="text-muted">La suscripción no tiene recurrencias planificadas.</td></tr>`;
}

async function cargarRecurrencias(forzar) {
    const r = filas[filaActual];
    const id = r?.item?.suscripcionRecurrenteId;
    if (!id) return;
    if (!forzar && cacheRecurrencias.has(id)) { pintarTablaRec(cacheRecurrencias.get(id)); return; }
    mdRecInfo.textContent = "leyendo SIME…";
    mdRecAviso.innerHTML = "";
    try {
        const data = await simeRecurrencias(id);
        cacheRecurrencias.set(id, data);
        // El analista pudo cambiar de línea mientras cargaba
        if (filas[filaActual]?.item?.suscripcionRecurrenteId === id) pintarTablaRec(data);
    } catch (e) {
        mdRecInfo.textContent = "";
        mdRec.innerHTML = `<tr><td colspan="9" class="text-muted">Sin datos.</td></tr>`;
        mdRecAviso.innerHTML = `<span class="text-danger">✖ ${escHtml(e.message)}</span>`;
        log(`✖ SIME recurrencias ${id}: ${e.message}`);
    }
}

function pintarRecurrencias(r) {
    recActual = null;
    formEditarRec.classList.remove("show");
    mdRecAviso.innerHTML = "";
    reEstado.textContent = ""; reResultado.innerHTML = "";
    const id = r?.item?.suscripcionRecurrenteId;
    if (!id) { mdRecWrap.style.display = "none"; mdRec.innerHTML = ""; return; }
    mdRecWrap.style.display = "block";
    mdRec.innerHTML = `<tr><td colspan="9" class="text-muted">Cargando…</td></tr>`;
    cargarRecurrencias(false);
}

function abrirEditarRec(recurrenciaId) {
    const r = filas[filaActual];
    const data = cacheRecurrencias.get(r?.item?.suscripcionRecurrenteId);
    const x = (data?.recurrencias || []).find(y => String(y.recurrenciaId) === String(recurrenciaId));
    if (!x) return;
    recActual = x;
    reFecha.value = dtLocal(x.fechaProximaEjecucion);
    reNumero.value = x.numeroRecurrencia ?? "";
    reEstado.textContent = ""; reResultado.innerHTML = "";
    pintarRecFijos();
    actualizarPayloadRec();
    pintarTablaRec(data);                       // resalta la fila en edición
    bootstrap.Collapse.getOrCreateInstance(formEditarRec).show();
}

// Tras editar: relee la suscripción (fecha próxima / recurrencias ejecutadas)
// y las recurrencias, y repinta la fila con los datos al día.
async function refrescarSuscripcion() {
    const i = filaActual, r = filas[i];
    const id = r?.item?.suscripcionRecurrenteId;
    if (!id) return;
    cacheRecurrencias.delete(id);
    try {
        const s = await simeSuscripcionPorId(id);
        if (s && typeof s === "object" && !Array.isArray(s)) {
            r.item = { ...r.item, ...s };
            if (r.sime?.items?.length) r.sime.items[0] = r.item;
            enriquecer(r);
            render();
        }
    } catch (e) {
        log(`⚠ SIME: no se pudo releer la suscripción ${id} (${e.message})`);
    }
    recActual = null;
    abrirDetalle(i);
}

async function guardarRec() {
    if (!recActual) return;
    const p = payloadRec();
    const faltan = [];
    if (!p.recurrenciaId) faltan.push("ID de recurrencia");
    if (!p.fechaProximaEjecucion) faltan.push("fecha de próxima ejecución");
    if (!/^\d+$/.test(p.numeroRecurrencia) || Number(p.numeroRecurrencia) < 1)
        faltan.push("nº de recurrencia (entero ≥ 1)");
    if (!p.usuarioModificacion) faltan.push("usuario modificación (obtén el token prf de SIME)");
    if (faltan.length) {
        reResultado.innerHTML = `<div class="alert alert-danger py-2 mb-0" style="font-size:.8rem">Faltan datos: ${faltan.join(", ")}.</div>`;
        return;
    }
    btnGuardarRec.disabled = true;
    reEstado.textContent = "Guardando…";
    reResultado.innerHTML = "";
    try {
        const cuerpo = await simeEditarRecurrencia(p);
        reEstado.innerHTML = `<span class="chip-verif ok"><span class="dot"></span>Actualizada</span>`;
        reResultado.innerHTML = `<div class="alert alert-success py-2 mb-0" style="font-size:.8rem">
    ✔ Recurrencia ${p.recurrenciaId} actualizada (nº ${escHtml(p.numeroRecurrencia)} · próxima ${fmtSime(p.fechaProximaEjecucion.slice(0, 19))}).
    <details class="mt-1"><summary>Respuesta de SIME</summary>
      <pre class="json mono mt-2" style="max-height:200px">${escHtml(typeof cuerpo === "string" ? (cuerpo || "(sin cuerpo)") : JSON.stringify(cuerpo, null, 2))}</pre>
    </details>
  </div>`;
        log(`✔ SIME: recurrencia ${p.recurrenciaId} actualizada (nº ${p.numeroRecurrencia}, próxima ${p.fechaProximaEjecucion}).`);
        await refrescarSuscripcion();
    } catch (e) {
        reEstado.innerHTML = `<span class="chip-verif fail"><span class="dot"></span>Error</span>`;
        reResultado.innerHTML = `<div class="alert alert-danger py-2 mb-0" style="font-size:.8rem">✖ No se pudo actualizar: ${escHtml(e.message)}</div>`;
        log(`✖ SIME recurrencia ${p.recurrenciaId}: ${e.message}`);
    } finally {
        btnGuardarRec.disabled = false;
    }
}

btnRecCargar.addEventListener("click", () => cargarRecurrencias(true));
mdRec.addEventListener("click", e => {
    const b = e.target.closest("[data-editar-rec]");
    if (b) abrirEditarRec(b.dataset.editarRec);
});
btnGuardarRec.addEventListener("click", guardarRec);
["reFecha", "reNumero"].forEach(id =>
    document.getElementById(id).addEventListener("input", actualizarPayloadRec));

/* =====================================================================
   CAMBIO DE CUENTA (BAN) DESDE LA MODAL
   Trae uso, movimientos y titular de la cuenta elegida y recalcula
   ciclos, verificación y comentarios con esa cuenta.
===================================================================== */
async function cambiarCuenta(i, subscriberId) {
    const r = filas[i];
    if (!r?.bss) return;
    const c = (r.bss.cuentas || []).find(x => String(x.subscriberId) === String(subscriberId));
    if (!c || String(c.subscriberId) === String(r.bss.subscriberId)) return;
    mdCuentasInfo.textContent = `Cargando servicios de la cuenta ${c.ban || c.subscriberId}…`;
    try {
        const serv = await bssServiciosDeCuenta(c);
        r.bss = {
            ...r.bss,
            ...c,                       // subscriberId, ban, estado… de la cuenta elegida
            ...resumirTx(null),         // limpia el resumen de la cuenta anterior
            ...serv,                    // uso + titular + resumen de la cuenta nueva
            cuentaSeleccionada: c.subscriberId,
            seleccionManual: true
        };
        enriquecer(r);
        render();
        abrirDetalle(i);
        log(`Cuenta cambiada en ${r.msisdn} → BAN ${c.ban || c.subscriberId} (${c.estadoLinea || c.estadoBssTexto}).`);
    } catch (e) {
        mdCuentasInfo.textContent = `✖ No se pudo cargar la cuenta: ${e.message}`;
    }
}
mdCuentas.addEventListener("click", e => {
    const b = e.target.closest("[data-usar-cuenta]");
    if (b && filaActual != null) cambiarCuenta(filaActual, b.dataset.usarCuenta);
});

function abrirDetalle(i) {
    const r = filas[i];
    filaActual = i;
    const cli = r.bss?.cliente || null;
    mdLinea.textContent = r.msisdn;
    mdBan.textContent = r.bss?.subscriberId || r.bss?.ban || "—";
    mdCedula.textContent = cli?.cedula || "—";
    mdTitular.textContent = cli?.nombre ? `· ${cli.nombre}` : "";
    const it = r.item || {};
    mdUsuarioCreacion.textContent = it.usuarioCreacion || "—";
    mdUsuarioUltMod.textContent = it.usuarioUltMod || "";
    mdUsuarioUltModWrap.style.display = it.usuarioUltMod ? "inline" : "none";
    const badgeLinea = r.bss?.estadoLinea
        ? `<span class="badge ${BADGE_LINEA[r.bss.estadoLinea] || 'text-bg-dark'}">Línea: ${r.bss.estadoLinea}</span>`
        : "";
    mdResumen.innerHTML = `${badgeEstado(r.estado)} &nbsp; ${badgeLinea ? badgeLinea + " &nbsp; " : ""}${chipVerif(r.verif)}${comentarioHTML(r.comentarios)}`;

    // ---- Titular de la cuenta (cédula) ----
    if (cli) {
        mdClienteWrap.style.display = "block";
        mdClienteInfo.textContent = `cuenta ${r.bss?.ban || ""} · billingAccount ${cli.billingAccountId || "—"}`;
        mdCliente.innerHTML = [
            ["Cédula", cli.cedula || "—"],
            ["Tipo doc.", `${cli.tipoDoc}${cli.tipoDocId != null ? ` (${cli.tipoDocId})` : ""}`],
            ["Nombre", cli.nombre || "—"],
            ["Correo", cli.correo || "—"],
            ["Tel. alterno", cli.telefono || "—"],
            ["Ciudad", cli.ciudad || "—"],
            ["Estado cuenta", cli.estadoCuenta || "—"],
            ["Estado cliente", cli.estadoCliente || "—"],
            ["externalID", cli.externalID || "—"],
            ["Origen del titular", cli.desdePadre
                ? `cuenta relacionada (${(cli.cadena || []).map(c => c.externalID).join(" → ")})`
                : "misma cuenta del BAN"],
            ["individualId", cli.individualId || "—"],
            ["customerId", cli.customerId || "—"]
        ].map(([k, v]) => `<span class="dato"><b>${k}:</b> ${escHtml(v)}</span>`).join("");
    } else {
        mdClienteWrap.style.display = r.bss ? "block" : "none";
        mdClienteInfo.textContent = "";
        mdCliente.innerHTML = r.bss
            ? `<span class="text-muted" style="font-size:.8rem">No se pudo traer el titular de esta cuenta (billingAccount/individual). Revisa el registro de conexión.</span>`
            : "";
    }

    // ---- Cuentas (BAN) de la línea: se puede elegir cuál usar ----
    const cuentas = r.bss?.cuentas || [];
    if (cuentas.length) {
        mdCuentasWrap.style.display = "block";
        const activaId = r.bss?.subscriberId;
        const nActivas = cuentas.filter(cuentaActiva).length;
        mdCuentasInfo.textContent = `${cuentas.length} cuenta(s) · ${nActivas} activa(s) · usando ${r.bss?.ban || activaId}`
            + (r.bss?.seleccionManual ? " (elegida a mano)" : " (activa por defecto)");
        mdCuentas.innerHTML = cuentas.map(c => {
            const esUsada = String(c.subscriberId) === String(activaId);
            const et = c.estadoLinea || "—";
            const badge = `<span class="badge ${BADGE_LINEA[et] || 'text-bg-dark'}">${et}${c.estadoLineaRaw != null && String(c.estadoLineaRaw) !== et ? ` · ${escHtml(String(c.estadoLineaRaw))}` : ""}</span>`;
            return `
      <tr class="${esUsada ? 'table-success' : ''}">
<td>${esUsada ? '✔' : ''}</td>
<td class="mono">${escHtml(c.ban || "—")}</td>
<td class="mono">${escHtml(c.subscriberId || "—")}</td>
<td>${badge}</td>
<td class="mono">${c.estadoBss ?? "—"} · ${escHtml(c.estadoBssTexto || "—")}</td>
<td class="mono">${fmt(c.creado)}</td>
<td>${esUsada
                    ? '<span class="badge text-bg-dark">en uso</span>'
                    : `<button type="button" class="btn btn-sm btn-outline-dark" data-usar-cuenta="${escHtml(c.subscriberId || "")}">Ver servicios</button>`}</td>
      </tr>`;
        }).join("");
    } else {
        mdCuentasWrap.style.display = "none";
    }

    mdDatos.innerHTML = Object.entries({
        "Cédula del titular": cli?.cedula ? `${cli.cedula} · ${cli.tipoDoc}` : "—",
        "Nombre del titular": cli?.nombre || "—",
        "Correo": cli?.correo || "—",
        "Cuenta de facturación": cli?.billingAccountId ? `${cli.billingAccountId} · ${cli.estadoCuenta || ""}` : "—",
        "Estado de la línea (OBP)": r.bss?.estadoLinea ? `${r.bss.estadoLinea}${r.bss.estadoLineaRaw != null && String(r.bss.estadoLineaRaw) !== r.bss.estadoLinea ? ` · ${r.bss.estadoLineaRaw}` : ""}` : "—",
        "ID suscriptor BSS (identifier)": r.bss?.subscriberId || "—",
        "Cuenta BSS (accountID)": r.bss?.ban || "—",
        "Estado BSS": r.bss ? `${r.bss.estadoBss} · ${r.bss.estadoBssTexto}` : "—",
        "1.ª compra del ciclo vigente": r.bss?.primeraCompra ? `${fmt(r.bss.primeraCompra)}${r.bss.montoPrimera ? ` · $${r.bss.montoPrimera.toLocaleString("es-CO")}` : ""}${r.bss.primeraPorMonto ? " · identificada por monto" : ""}` : "—",
        "Re-compra": r.bss ? (r.bss.esRecompra ? `Sí · ${r.bss.ciclosDetectados || 1} ciclo(s) en la ventana consultada` : "No detectada") : "—",
        "Compras del ciclo vigente": r.bss?.comprasBss != null ? `${r.bss.comprasBss} (compra + ${r.bss.recurrenciasBss} recurrencias)`
            : (r.bss?.recurrenciasHistoricas != null ? `sin ciclo asignable · ${r.bss.recurrenciasHistoricas} recurrencias históricas` : "—"),
        "Creado en BSS": fmt(r.bss?.creado),
        "ID suscripción SIME": it.suscripcionRecurrenteId || "—",
        "ID Optiva en SIME": it.idSuscriptionOptiva || "—",
        "Canal": it.descripcionCanal || "—",
        "Fecha suscripción SIME": fmt(it.fechaSuscripcion),
        "Fecha compra SIME": fmt(it.fechaCompra),
        "Recurrencias ejecutadas (SIME)": it.numeroRecurrenciasEjecutadas ?? "—",
        "Periodos (mes actual / total)": r.periodos ? `${r.periodos.mesActual} / ${r.periodos.total}` : "—",
        "Próxima ejecución": fmtSime(it.fechaProximaEjecucion),
        "PLU (SIME)": it.plu ?? "—",
        "Price plan BSS": r.bss?.planPrecioId ?? "—",
        "Documento (SIME)": it.tipoDocumento ? `${it.tipoDocumento} ${it.documento}` : "—"
    }).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    // ---- Uso y Balance (bundleBalance) ----
    const bundles = r.bss?.uso || [];
    if (bundles.length) {
        mdUsoWrap.style.display = "block";
        mdUsoInfo.textContent = `${bundles.length} bundles · SuscriptionID ${r.bss?.subscriberId || ""} · horarios en UTC-5 (Colombia)`;
        mdUso.innerHTML = usoHTML(bundles);
    } else {
        mdUsoWrap.style.display = "none";
    }

    // ---- Alta de suscripción en SIME ----
    pintarCrearSime(r, i);

    // ---- Recurrencias de la suscripción ----
    pintarRecurrencias(r);

    // ---- Tabla de ciclos apilados ----
    if (r.ciclos && r.ciclos.ciclos.length) {
        mdCiclosWrap.style.display = "block";
        mdCiclosInfo.textContent = `plan de ${r.ciclos.total} periodos · ${r.ciclos.vigentes} vigente(s)`
            + (r.ciclos.vigentes ? ` · cobertura combinada ${r.ciclos.coberturaDesde} → ${r.ciclos.coberturaHasta} (${r.ciclos.mesesCubiertosRestantes} meses)` : "");
        mdCiclos.innerHTML = r.ciclos.ciclos.map(c => `
      <tr class="${c.vigente ? '' : 'ciclo-vencido'}">
<td>${c.n}</td>
<td class="mono">${fmt(c.fecha)}</td>
<td class="mono">${c.etiquetaInicio} → ${c.etiquetaFin}</td>
<td class="mono text-end">$${(c.monto || 0).toLocaleString("es-CO")}</td>
<td class="mono">${c.vigente ? `${c.mesActual} / ${c.total}` : `— / ${c.total}`}</td>
<td class="mono text-end">${c.completados}</td>
<td class="mono text-end">${c.restantes}</td>
<td>${c.vigente ? '<span class="badge text-bg-success">Vigente</span>' : '<span class="badge text-bg-secondary">Vencido</span>'}</td>
      </tr>`).join("");
    } else {
        mdCiclosWrap.style.display = "none";
    }

    // ---- Todos los movimientos BSS (todos los adjustment type) ----
    const ventanasVig = (r.ciclos?.ciclos || []).filter(c => c.vigente).map(c => [c.iniIdx, c.finIdx]);
    const enCicloVigente = fechaISO => {
        const idx = mesIdxDeFecha(fechaISO);
        if (ventanasVig.length) return ventanasVig.some(([a, b]) => idx >= a && idx <= b);
        return r.bss?.primeraCompra ? fechaISO >= r.bss.primeraCompra : false; // respaldo
    };
    // Se muestran del más reciente al más viejo (los datos internos siguen en orden ascendente)
    const txs = (r.bss?.txTodas || []).slice().reverse();
    if (txs.length) {
        mdTxWrap.style.display = "block";
        mdTxInfo.textContent = `${txs.length} movimientos · cuenta ${r.bss?.ban || r.bss?.subscriberId || ""} · más recientes primero`;
        mdTx.innerHTML = txs.map(t => {
            const actual = enCicloVigente(t.fecha);
            const clase = `tx-${t.categoria}${actual ? ' tx-actual' : ''}`;
            const resalta = (t.categoria === 'primera' || t.categoria === 'compraPlan' || t.categoria === 'compra');
            return `
      <tr class="${clase}">
<td class="mono">${escHtml(t.id || "")}</td>
<td${resalta ? ' class="fw-semibold"' : ''}>${escHtml(t.tipo)}</td>
<td>${CAT_LABEL[t.categoria] || t.categoria}${actual ? ' <span class="badge text-bg-dark ms-1">actual</span>' : ''}</td>
<td class="mono">${fmt(t.fecha)}</td>
<td class="mono text-end">$${(t.monto || 0).toLocaleString("es-CO")}</td>
<td class="mono">${escHtml(t.agente || "")}</td>
      </tr>`;
        }).join("");
    } else {
        mdTxWrap.style.display = "none";
    }

    // ---- Respuesta SIME en tabla legible ----
    const itemsSime = r.sime?.items || [];
    if (itemsSime.length) {
        mdTablaSime.innerHTML = itemsSime.map((it2, idx) =>
            (itemsSime.length > 1 ? `<div class="lbl-mini mt-2 mb-1">Ítem ${idx + 1}</div>` : "")
            + tablaDatosHTML(aplanarObjeto(it2))).join("");
    } else {
        mdTablaSime.innerHTML = `<div class="text-muted" style="font-size:.8rem">SIME no devolvió ítems (count=${r.sime?.count ?? 0}).</div>`;
    }

    // ---- Respuesta BSS en tabla legible ----
    if (r.bss) {
        let htmlBss = tablaDatosHTML(aplanarObjeto(r.bss._raw ?? r.bss));
        if (r.bss._rawSubscription)
            htmlBss += `<div class="lbl-mini mt-3 mb-1">/api/v1/subscription (estado de la línea)</div>`
                + tablaDatosHTML(aplanarObjeto(r.bss._rawSubscription));
        if (cli?._rawAccount)
            htmlBss += `<div class="lbl-mini mt-3 mb-1">/api/v1/billingAccount (cuenta de facturación)</div>`
                + tablaDatosHTML(aplanarObjeto(cli._rawAccount));
        if (cli?._rawIndividual)
            htmlBss += `<div class="lbl-mini mt-3 mb-1">/api/v1/individual (titular · cédula)</div>`
                + tablaDatosHTML(aplanarObjeto(cli._rawIndividual));
        if (cli?._rawCustomer)
            htmlBss += `<div class="lbl-mini mt-3 mb-1">/api/v1/customer (cliente)</div>`
                + tablaDatosHTML(aplanarObjeto(cli._rawCustomer));
        mdTablaBss.innerHTML = htmlBss;
    } else {
        mdTablaBss.innerHTML = `<div class="text-muted" style="font-size:.8rem">Sin suscriptor en BSS → consultar en SIME.</div>`;
    }

    // ---- JSON crudo (respaldo, plegable) ----
    mdJsonSime.textContent = JSON.stringify(r.sime, null, 2);
    mdJsonBss.textContent = r.bss
        ? JSON.stringify({
            subscriber: r.bss._raw ?? null,
            subscription: r.bss._rawSubscription ?? null,
            billingAccount: cli?._rawAccount ?? null,
            individual: cli?._rawIndividual ?? null,
            customer: cli?._rawCustomer ?? null
        }, null, 2)
        : "Sin suscriptor en BSS → consultar en SIME (regla: BSS → si no aparece, consultar en SIME).";
    bootstrap.Modal.getOrCreateInstance("#modalDetalle").show();
}

/* =====================================================================
   CONSULTA (asíncrona, en paralelo, no bloqueante) Y EXPORTACIÓN
===================================================================== */
function obtenerLineas() {
    if (lineasArchivo.length) return lineasArchivo;
    return inputLineas.value
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function setProgreso(hechas, total, linea) {
    progresoWrap.style.display = total ? "block" : "none";
    if (!total) return;
    const pct = Math.round(hechas / total * 100);
    progresoBar.style.width = pct + "%";
    progresoPct.textContent = pct + "%";
    progresoTexto.textContent = `Consultadas ${hechas} de ${total}${linea ? ` · última: ${linea}` : ""}`;
}

// Consulta de UNA línea (SIME + BSS); nunca lanza: devuelve la fila con o sin error
async function consultarLinea(linea, usarBss) {
    // SIME necesita 2 pasos encadenados (pestaña → datos), pero es independiente
    // de BSS: ambos flujos corren EN PARALELO para no sumar latencias.
    const pSime = (async () => {
        const pestana = await simeConsultarPestana(linea);
        const sime = await simeGetSuscripcion(pestana, linea);
        return { pestana, sime };
    })();
    const pBss = usarBss
        ? bssBuscarLinea(linea).catch(eb => { log(`✖ BSS ${linea}: ${eb.message}`); return null; })
        : Promise.resolve(null);
    try {
        const [{ pestana, sime }, bss] = await Promise.all([pSime, pBss]);
        return { msisdn: linea, pestana, sime, bss };
    } catch (e) {
        // Falló SIME: se conserva lo que haya devuelto BSS (su promesa no lanza)
        const bss = await pBss;
        return { msisdn: linea, pestana: null, sime: { items: [], count: 0 }, bss, error: String(e.message || e) };
    }
}

async function consultar() {
    const lineas = obtenerLineas();
    if (!lineas.length) { alert("Carga un archivo con la columna 'linea' o escribe líneas manualmente."); return; }

    if (!cfgTokenSime.value.trim()) {
        try { await obtenerTokenSime(); } catch (e) { log("✖ " + e.message); }
    }
    auth.leerCampos();
    let usarBss = true;
    try { await auth.ensure(); }
    catch (e) { usarBss = false; log(`⚠ ${e.message} — se consultará solo SIME.`); }

    const paralelo = Math.min(Math.max(parseInt(cfgParalelo.value, 10) || 5, 1), 10);
    const out = new Array(lineas.length);
    let indice = 0, hechas = 0;
    btnConsultar.disabled = true;
    cacheServicios.clear();
    setProgreso(0, lineas.length);

    // Pool de workers: hasta N líneas consultándose a la vez, sin bloquear la UI
    async function worker() {
        while (true) {
            const k = indice++;
            if (k >= lineas.length) return;
            const linea = lineas[k];
            out[k] = await consultarLinea(linea, usarBss);   // el orden del archivo se conserva
            setProgreso(++hechas, lineas.length, linea);
        }
    }
    await Promise.all(Array.from({ length: Math.min(paralelo, lineas.length) }, worker));

    btnConsultar.disabled = false;
    setProgreso(0, 0);
    filas = procesar(out);
    mostrarOcultas = false;
    render();
}

// Exporta lo que el analista está viendo: respeta filtros y excluye las ocultas
function filasParaExportar() {
    if (!dataTable) return filas.filter(f => !f.oculta);
    return dataTable.rows({ search: "applied" }).indexes().toArray()
        .map(i => filas[i]).filter(Boolean);
}

function filasExport() {
    const head = ["MSISDN", "Cédula", "Titular", "Estado SIME", "Pestaña", "Estado línea (OBP)", "ID suscriptor BSS", "Cuenta BSS", "Estado BSS", "Plan",
        "Fecha compra SIME", "1.ª compra BSS", "Monto 1.ª compra", "Compras BSS", "Verificación",
        "Recurrencias SIME", "Periodos consumidos", "Periodos por consumir",
        "Ciclos vigentes", "Cobertura desde", "Cobertura hasta", "Próxima ejecución", "Comentario"];
    const rows = filasParaExportar().map(r => [
        r.msisdn, r.bss?.cliente?.cedula || "", r.bss?.cliente?.nombre || "",
        r.estado, r.item ? r.pestana : "", r.bss?.estadoLinea || "", r.bss?.subscriberId || "", r.bss?.ban || "",
        r.bss ? r.bss.estadoBssTexto : "", r.item?.nombre || "",
        r.item?.fechaCompra || "", r.bss?.primeraCompra || "", r.bss?.montoPrimera ?? "", r.bss?.comprasBss ?? "",
        r.verif.texto,
        r.item?.numeroRecurrenciasEjecutadas ?? "", r.periodos?.consumidos ?? "", r.periodos?.porConsumir ?? "",
        r.ciclos?.vigentes ?? "", r.ciclos?.coberturaDesde ?? "", r.ciclos?.coberturaHasta ?? "",
        r.item?.fechaProximaEjecucion || "", r.comentarios.join(" | ")
    ]);
    return { head, rows };
}
function exportarCSV() {
    if (!filas.length) return;
    const { head, rows } = filasExport();
    const esc = v => /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const csv = [head, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `reporte_prepagadas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}
function exportarXLSX() {
    if (!filas.length) return;
    const { head, rows } = filasExport();
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "prepagadas");
    XLSX.writeFile(wb, `reporte_prepagadas_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* =====================================================================
   ARRANQUE DESDE EL .BAT (dame click.bat)
   El lanzador hace el login NTLM contra SIME, valida las credenciales del
   CM y abre esta página con:
     ?prf=<token>                       ← en la query, como el redirect de SIME
     #cm_user=…&cm_pass=…               ← en el fragmento: NO viaja en la URL
                                          de ninguna petición y se borra aquí.
   Todo es opcional: si no viene nada, la página funciona igual que siempre.
===================================================================== */
function leerArranqueUrl() {
    const q = new URLSearchParams(location.search.slice(1));
    const h = new URLSearchParams(location.hash.slice(1));
    const dato = k => q.get(k) || h.get(k) || "";
    const prf = dato("prf");
    const usuario = dato("cm_user");
    const clave = dato("cm_pass");
    if (!prf && !usuario && !clave) return;

    if (prf) {
        cfgTokenSime.value = prf;
        cfgTokenSime.dispatchEvent(new Event("input"));
        try {
            const perfil = JSON.parse(atob(prf));
            log(`✔ Token SIME recibido del lanzador para ${perfil.Nombre || perfil.UserName || "usuario"}.`);
        } catch (_) { log("✔ Token SIME recibido del lanzador."); }
    }
    if (usuario) cfgUser.value = usuario;
    if (clave) { cfgPass.value = clave; log("✔ Credenciales del CM recibidas del lanzador."); }

    // Limpiar la URL para que el token/clave no queden a la vista ni en el
    // historial. En file:// Chromium bloquea replaceState: si falla, al
    // menos se borra el fragmento.
    try { history.replaceState(null, "", location.pathname); }
    catch (_) { location.hash = ""; }
}
/* ============ Init ============ */
fechaReporte.textContent = "Generado: " + new Date().toLocaleString("es-CO");
btnConsultar.addEventListener("click", consultar);
btnCSV.addEventListener("click", exportarCSV);
btnXLSX.addEventListener("click", exportarXLSX);
btnLoginCm.addEventListener("click", async () => {
    auth.token = null; auth.leerCampos();
    try { await auth.ensure(); log("✔ Sesión CM lista."); }
    catch (e) { log("✖ " + e.message); }
});
btnTestBss.addEventListener("click", probarBss);
btnTokenSime.addEventListener("click", () => obtenerTokenSime().catch(e => log("✖ " + e.message)));
btnTestSime.addEventListener("click", probarSime);
// Si pegan el token a mano, marcar SIME como conectado
cfgTokenSime.addEventListener("input", () => {
    sesion.sime = !!cfgTokenSime.value.trim(); pintarSesion();
    // "Usuario creación" es solo lectura y sale del token: se refresca aquí
    if (filaActual != null) { crUsuario.value = usuarioSime(); pintarFijos(); actualizarPayload(); }
});
pintarSesion();
leerArranqueUrl();   // después de registrar los listeners: así el chip de sesión se pinta

// escuchar la acción "Enter" al pegar líneas para consultar
document.getElementById("inputLineas").addEventListener("keydown", e => {
    if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btnConsultar").click();
    }
});
