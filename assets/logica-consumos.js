/* =====================================================================
   logica-consumos.js · Consumos, paquetes y datos de línea (CM)
   ---------------------------------------------------------------------
   A diferencia de logica-prepagadas.js, esta herramienta NO toca SIME:
   no verifica suscripciones, no cuenta periodos ni recurrencias. Solo
   consulta el CM (Optiva) para tres cosas, por línea:

     · datos básicos de la línea (subscriptor, cuenta/BAN, estado, plan)
     · paquetes activos (bundleBalance) — igual que "Uso y Balance" de
       Prepagadas, mismas reglas de unidades/categoría
     · histórico de consumo (CDR, listDetailedCallDetailsWithBundles) por
       rango de fechas, con gráficas de barras/torta y exportación

   El histórico es la única consulta cara (puede paginar varias veces):
   por eso NO se trae en la consulta masiva, sino bajo demanda al abrir
   el detalle de una línea, con el mes en curso por defecto.

   Lo que comparte con las demás herramientas NO está aquí:
     · marco visual, sesión, registro, tablas, import/export → me-ui.js
     · Keycloak, auth, getJson, endpoints del CM        → me-api.js
     · enganche entre esta lógica y el shell              → me-consumos-puente.js
===================================================================== */

/* =====================================================================
   1 · CONFIGURACIÓN
===================================================================== */
const CONFIG = {
    get apiBase() { return MEAPI.CONFIG.apiBase; },

    /* 500 es el MÁXIMO que acepta el CM POR PÁGINA, dicho por él mismo: con
       limit=1000 responde 500 (Internal Server Error) con el texto «The
       input limit is 1000, but the CRM Service Provider defined maximum
       allowed limit size is 500». Aplica a los dos endpoints del histórico.
       No subir de aquí.

       Es un límite de la API, NO del resultado: el rango de fechas elegido
       se trae completo, pidiendo tantas páginas de 500 como haga falta.
       No hay tope de registros. */
    pageSizeHistorico: 500,

    /* Única guarda que queda, y no es un límite de datos: corta un bucle
       descontrolado (un CM que devolviera páginas para siempre) antes de
       colgar el navegador. A 500 por página son 500.000 registros para UNA
       línea en UN rango: ningún caso real se acerca, así que si esto salta
       es un error, y por eso se avisa como tal. */
    maxPaginasHistorico: 1000,

    /* El CM devuelve 500 de vez en cuando sin motivo y responde bien al
       repetir la misma petición: cada página se reintenta antes de darla
       por perdida (misma convención que `reintentos` en las otras
       herramientas: 2 reintentos = 3 intentos en total). */
    reintentosPagina: 2,
    esperaReintento: 600,     // ms; se multiplica por el número de intento

    /* Si una página sigue fallando con reintentos, se vuelve a pedir la
       MISMA ventana con la mitad de registros (y así hasta este piso):
       cuando el 500 viene de que al CM le pesa la página, pedir menos la
       trae. Mejor traerla lenta que no traerla. */
    minPaginaHistorico: 50
};

const auth = MEAPI.auth;        // login, refresh, re-auth en 401
const getJson = MEAPI.getJson;  // GET autenticado (añade token y cabeceras)

/* =====================================================================
   2 · ESTADO DE LA LÍNEA/CUENTA (mismo código que usan las otras
   herramientas en /api/v1/subscribers → status.state)
   TUNEABLE: solo 1 y 2 están confirmados con datos reales; 3 y 4 se
   infieren de las etiquetas de negocio — ajusta si difieren.
===================================================================== */
const ESTADOS_CM = { 1: "Activo", 2: "Desactivado", 3: "Disponible", 4: "Bloqueada" };

function cuentaBase(sub, linea) {
    const p = sub.profile || {}, st = sub.status || {}, rt = sub.rating || {};
    const estadoTxt = ESTADOS_CM[st.state] ?? (st.state != null ? `Estado ${st.state}` : "—");
    return {
        subscriberId: p.identifier || null,
        ban: p.accountID || null,
        msisdn: p.mobileNumber || String(linea),
        estadoCm: st.state,
        estadoCmTexto: estadoTxt,
        estadoLinea: ESTADOS_CM[st.state] || null,
        creado: p.created ? new Date(p.created).toISOString() : null,
        planPrecioId: rt.primaryPricePlanID ?? null,
        _raw: sub
    };
}
const cuentaActiva = c => c.estadoCm === 1;
function cuentaPorDefecto(cuentas) {
    const orden = [...cuentas].sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")));
    return orden.find(cuentaActiva) || orden[0];
}

/* =====================================================================
   2b · TITULAR DE LA CUENTA (identificación/cédula + nombre)
   ---------------------------------------------------------------------
   PORTE de la lógica ya probada de logica-rechazo.js (assets/logica-
   rechazo.js): mismos servicios, mismos fallbacks de `billingAccount` y
   la misma forma de subir por la cadena de cuentas. Se copia en vez de
   compartirse porque cada herramienta carga su propia lógica y dos
   archivos no pueden declarar las mismas constantes globales (mismo
   motivo que logica-portabilidad-tigo.js con su estado CM).

   Importa porque el BAN de la línea suele ser una CUENTA HIJA sin
   documento, y la cédula está en la cuenta de arriba: se sube por
   `parentId` y por `accountRelationship[]` hasta encontrarla, con un
   tope de 5 saltos. Si cambia algo aquí, conviene mirar también
   logica-rechazo.js.

   Nada se inventa: si no hay identificación en la cadena de cuentas, o
   el CM devuelve el nombre de prueba "FirstName LastName", el campo
   queda vacío -nunca se hace pasar un dato por otro-.
===================================================================== */
const TIPO_DOC_BSS = { "6": "CC" };
const tipoDocDeBSS = t => (t == null || t === "") ? null : (TIPO_DOC_BSS[String(t)] || null);

const esNombrePlaceholder = nombre =>
    String(nombre || "").replace(/\s+/g, "").toLowerCase() === "firstnamelastname";

/** Un accountID puede venir como «41041348619-1»; el externalID de la
 *  cuenta de facturación es la parte ANTES del guion, así que esa se
 *  prueba primero y el valor completo queda como respaldo. */
function candidatosExternalID(ban) {
    const s = String(ban || "").trim();
    const out = [];
    [s.split("-")[0], s].forEach(v => { if (v && !out.includes(v)) out.push(v); });
    return out;
}

/** Primer documento con número dentro de individualIdentification. */
const identDeIndividual = ind =>
    (ind?.individualIdentification || []).find(x => x.identificationId && String(x.identificationId).trim()) || null;

/**
 * Busca la cuenta de facturación por externalID, con los tres caminos que
 * usa el CM: la consulta simple, el filtro «todo en uno» y la búsqueda
 * por ID de cuenta (las relaciones traen el ID, que no siempre es el
 * externalID).
 */
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

    const porId = await getJson(
        `${CONFIG.apiBase}/api/v1/billingAccount/${encodeURIComponent(externalID)}`).catch(() => null);
    if (porId && (porId.id || porId["@type"] === "BillingAccount")) return porId;
    if (Array.isArray(porId) && porId.length) return porId[0];
    return null;
}

const MAX_SALTOS_PADRE = 5;

/**
 * Titular de una cuenta. La cuenta del BAN de la línea suele ser HIJA y
 * la cédula está en la cuenta de arriba, así que se sube por `parentId`
 * y, cuando ese campo no viene, por `accountRelationship[].account.id`.
 */
async function titularDeCuenta(ban, avisos) {
    const clave = String(ban || "").trim();
    if (!clave) return null;

    const pendientes = candidatosExternalID(clave);
    const variantesBan = new Set(pendientes);
    const vistos = new Set();
    let saltos = 0, subio = false;

    while (pendientes.length && saltos <= MAX_SALTOS_PADRE) {
        const ext = pendientes.shift();
        if (vistos.has(ext)) continue;
        vistos.add(ext);

        const acc = await buscarBillingAccount(ext);
        if (!acc) continue;

        // Ya hay cuenta: las otras variantes del BAN (con/sin sufijo) sobran.
        if (variantesBan.size) {
            for (let k = pendientes.length - 1; k >= 0; k--)
                if (variantesBan.has(pendientes[k])) pendientes.splice(k, 1);
            variantesBan.clear();
        }

        const rel = acc.relatedParty || [];
        const refInd = rel.find(p => p["@referredType"] === "Individual" || /individual\//.test(p.href || ""));
        const refCus = rel.find(p => p["@referredType"] === "Customer" || /customer\//.test(p.href || ""));

        // Respaldo confirmado con el flujo de Postman: cuando relatedParty no
        // trae Individual, el id de la cuenta puede ser el individualID.
        const individualId = refInd?.id || acc.id;
        const [individuo, cliente] = await Promise.all([
            individualId ? getJson(`${CONFIG.apiBase}/api/v1/individual/${encodeURIComponent(individualId)}`).catch(() => null) : null,
            refCus?.id ? getJson(`${CONFIG.apiBase}/api/v1/customer/${encodeURIComponent(refCus.id)}`).catch(() => null) : null
        ]);

        const ident = identDeIndividual(individuo);
        if (ident) {
            if (subio && avisos)
                avisos.push(`la cuenta ${clave} es hija: la identificación se tomó de la cuenta ${acc.externalID || ext}`);

            const nombreCrudo = cliente?.name
                || individuo?.fullName
                || [individuo?.givenName, individuo?.familyName].filter(Boolean).join(" ").trim()
                || acc.name || null;
            // Cuentas sin datos reales cargados devuelven a veces el nombre de
            // prueba «FirstName LastName». No es un dato del cliente: se
            // trata igual que si el CM no hubiera devuelto nombre.
            const esPlaceholder = esNombrePlaceholder(nombreCrudo);
            if (esPlaceholder && avisos) avisos.push("el CM devolvió el nombre de prueba «FirstName LastName»; se descarta");

            return {
                identificacion: String(ident.identificationId).trim(),
                tipoId: tipoDocDeBSS(ident.identificationType),
                tipoIdCrudo: ident.identificationType ?? null,
                nombre: esPlaceholder ? null : nombreCrudo
            };
        }

        // Sin documento aquí: hay que subir a la cuenta de arriba.
        if (acc.parentId) { pendientes.push(String(acc.parentId)); subio = true; saltos++; }
        (acc.accountRelationship || []).forEach(r => {
            const otro = r?.account?.id ?? r?.account?.name ?? r?.id;
            if (otro && !vistos.has(String(otro))) { pendientes.push(String(otro)); subio = true; saltos++; }
        });
    }
    return null;
}

/* =====================================================================
   3 · CONSULTAS AL CM
===================================================================== */
/** Resuelve una línea a su(s) cuenta(s) en el CM. null si no existe. */
async function cmBuscarLinea(msisdn) {
    const data = await getJson(`${CONFIG.apiBase}/api/v1/subscribers`, { msisdnList: msisdn, offset: 0, limit: 10 });
    const lista = data?.subscriberResponseList || [];
    if (!lista.length) return null;
    const cuentas = lista.map(sub => cuentaBase(sub, msisdn));
    const activa = cuentaPorDefecto(cuentas);
    return {
        ...activa,
        resultCode: data.resultCode,
        cuentas,
        multiBan: cuentas.length > 1
    };
}

/** Paquetes activos y su balance (/api/v1/subscription/bundleBalance). */
async function cmBundleBalance(subscriberId) {
    try {
        const data = await getJson(`${CONFIG.apiBase}/api/v1/subscription/bundleBalance`, { subscriptionID: subscriberId });
        return data?.bundleBalances || [];
    } catch (e) {
        MEUI.log(`⚠ CM ${subscriberId}: no se pudo leer paquetes/balance (${e.message})`, "warn");
        return [];
    }
}

const espera = ms => new Promise(r => setTimeout(r, ms));

/** Una página del histórico, con reintentos. El CM devuelve 500 de vez en
    cuando sin motivo aparente y al repetir la MISMA petición responde bien:
    por eso se reintenta siempre (no solo por timeout), con una espera
    creciente. Solo si se agotan los intentos se propaga el error. */
async function pedirPagina(url, params, etiqueta, nPagina) {
    let ultimo = null;
    for (let intento = 1; intento <= CONFIG.reintentosPagina + 1; intento++) {
        try {
            return await getJson(url, params);
        } catch (e) {
            ultimo = e;
            if (intento <= CONFIG.reintentosPagina) {
                MEUI.log(`· ${etiqueta}: la página ${nPagina} falló (${e.message}). Reintento ${intento} de ${CONFIG.reintentosPagina}…`, "warn");
                await espera(CONFIG.esperaReintento * intento);
            }
        }
    }
    throw ultimo;
}

/** La misma página, pero bajando el tamaño si con reintentos no sale: parte
    del `limit` actual y lo va partiendo a la mitad hasta el piso. Devuelve
    también el límite que funcionó, para seguir con ese de ahí en adelante
    (si al CM le pesaba esta página, le van a pesar las siguientes). */
async function pedirPaginaAdaptativa(url, params, etiqueta, nPagina, limite) {
    for (;;) {
        try {
            return { data: await pedirPagina(url, { ...params, limit: String(limite) }, etiqueta, nPagina), limite };
        } catch (e) {
            const menor = Math.max(CONFIG.minPaginaHistorico, Math.floor(limite / 2));
            if (menor >= limite) throw e;      // ya no se puede pedir menos
            MEUI.log(`· ${etiqueta}: la página ${nPagina} no salió con limit=${limite}; se reintenta pidiendo ${menor}.`, "warn");
            limite = menor;
        }
    }
}

/** Paginador de los dos listados del histórico (CDR y movimientos).

    El CM entrega los resultados ordenados de más nuevo a más viejo
    (isAscending=false) y NO siempre devuelve `nextPageKey`: cuando no lo
    manda, la única forma de seguir es correr la ventana de fechas hacia
    atrás, poniendo como `end` la fecha del registro más antiguo que ya
    trajimos. La ventana se mueve INCLUSIVA (ese registro vuelve a venir y
    se descarta al deduplicar): así el corte entre páginas nunca deja
    huecos.

    ÚNICA condición de fin: que una página no traiga NADA NUEVO. No se usa
    el tamaño de la página para decidir si quedan más -ese fue un error de
    la 1.5: el CM no devuelve páginas de tamaño constante, así que una
    página más corta que la anterior se tomaba por "la última" y la consulta
    terminaba antes de tiempo, trayendo MENOS registros que antes-. Pedir
    una vuelta de más (la que confirma que ya no hay nada nuevo) cuesta una
    petición y es lo que garantiza que el rango salga completo.

    NO hay tope de registros: el rango de fechas elegido se trae entero. */
async function paginarHistorico(url, base, { fechaDe, claveDe, etiqueta, alProgresar }) {
    const registros = [], vistos = new Set();
    let pageKey = null, end = base.end, topePagina = 0, truncado = false, paginas = 0, porLlave = false;
    let limite = Number(base.limit) || CONFIG.pageSizeHistorico;

    while (paginas++ < CONFIG.maxPaginasHistorico) {
        const p = { ...base, end };
        if (pageKey) p.nextPageKey = pageKey;

        let data;
        try {
            const r = await pedirPaginaAdaptativa(url, p, etiqueta, paginas, limite);
            data = r.data;
            limite = r.limite;      // si hubo que bajar el tamaño, se sigue con ese
        } catch (e) {
            // Agotados los reintentos Y los tamaños de página: si ya hay
            // registros en la mano se devuelven (marcados como incompletos)
            // en vez de perderlos; si falló la primera página no hay nada
            // que salvar y el error sube.
            if (!registros.length) throw e;
            MEUI.log(`⚠ ${etiqueta}: la página ${paginas} siguió fallando tras los reintentos y bajando el tamaño (${e.message}). `
                + `Se devuelven los ${registros.length} registro(s) traídos hasta ahí.`, "warn");
            truncado = true;
            break;
        }

        const res = data?.results || [];
        if (!res.length) break;                 // no hay más: completo
        topePagina = Math.max(topePagina, res.length);

        let nuevos = 0, masAntigua = null;
        res.forEach(r => {
            const f = fechaDe(r);
            if (f && (masAntigua === null || String(f) < String(masAntigua))) masAntigua = f;
            const k = claveDe(r);
            if (k && vistos.has(k)) return;
            if (k) vistos.add(k);
            registros.push(r); nuevos++;
        });

        if (alProgresar) alProgresar(registros.length);

        const llave = data?.nextPageKey || null;
        if (llave && llave !== pageKey) { pageKey = llave; porLlave = true; continue; }

        if (!nuevos) {
            // Nada nuevo: normalmente es que el rango ya está completo. La
            // excepción es el empate de fechas -más registros con la MISMA
            // fecha que los que caben en una página-: ahí la ventana no
            // puede avanzar y sí falta información.
            if (masAntigua && String(masAntigua) === String(end) && res.length >= topePagina) truncado = true;
            break;
        }
        if (!masAntigua) break;                 // sin fecha no hay por dónde avanzar
        pageKey = null; end = masAntigua;
    }

    if (paginas > CONFIG.maxPaginasHistorico) {
        MEUI.log(`⚠ ${etiqueta}: se llegó a ${CONFIG.maxPaginasHistorico} páginas sin que el CM diera por terminada la lista. `
            + "Eso no pasa con datos normales: revisa el rango.", "warn");
        truncado = true;
    }
    if (paginas > 1) {
        MEUI.log(`· ${etiqueta}: ${registros.length} registro(s) en ${paginas} página(s) de hasta ${topePagina}` +
            `${porLlave ? " (nextPageKey)" : " (ventana de fechas)"}${truncado ? " · INCOMPLETO" : ""}`);
    }
    return { registros, truncado, paginas };
}

/** Histórico de consumo (CDR), paginado hasta traer TODO el rango. */
async function cmHistoricoConsumo(subscriberId, { start, end }, alProgresar) {
    const { registros, truncado } = await paginarHistorico(
        `${CONFIG.apiBase}/api/v1/listDetailedCallDetailsWithBundles`,
        { subscriptionID: subscriberId, limit: String(CONFIG.pageSizeHistorico), isAscending: "false", start, end },
        {
            fechaDe: r => r.transactionDate, claveDe: r => r.identifier || null,
            etiqueta: `Histórico ${subscriberId}`, alProgresar
        }
    );
    return { registros, truncado };
}

/* =====================================================================
   4 · FORMATEO (idéntico criterio al de Prepagadas)
===================================================================== */
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

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
function fmtCantidad(u, n) {
    if (u === "bytes") return fmtBytes(n);
    if (u === "seg") return fmtVoz(n);
    if (u === "conteo") return nfmt(n) + " SMS";
    if (u === "moneda") return "$" + nfmt(n, 2);
    return nfmt(n);
}
function nivelUso(pct) { return pct >= 90 ? "lvl-hi" : pct >= 70 ? "lvl-mid" : "lvl-ok"; }
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
/* El campo `duration` del histórico (CDR) viene en MILISEGUNDOS — confirmado
   comparando con el bundleInfo.chargedAmount de la misma llamada, que sí
   está en segundos. No confundir con fmtVoz(), que espera segundos
   (bundleBalance / bundleInfo). */
function fmtDuracionHMS(ms) {
    const totalSeg = Math.round((Number(ms) || 0) / 1000);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const p = n => String(n).padStart(2, "0");
    return `${p(h)}:${p(m)}:${p(s)}`;
}
/* balance/charge del histórico vienen x10.000, igual que los montos de
   "Ajustes y paquetes" (row.value.amount / 10000). */
function fmtMonto(n) {
    return "$" + nfmt((Number(n) || 0) / 10000, 4);
}

/* =====================================================================
   5 · PAQUETES (bundleBalance) — mismas reglas que "Uso y Balance"
===================================================================== */
const UNIT_TIPO = {
    "0": { cat: "Voz", u: "seg" },
    "1": { cat: "Datos", u: "bytes" },
    "2": { cat: "SMS", u: "conteo" },
    "3": { cat: "Saldo", u: "moneda" }
};
const CAT_ORDEN = ["Voz", "Datos", "SMS", "Saldo", "Otros"];

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

/** Suma consumido / total / disponible de una categoría, sobre todos sus
    bundles (para las columnas de la tabla principal y la exportación).
    `limite` solo suma los bundles que SÍ tienen tope: los ilimitados no
    aportan al total, y por eso se cuentan aparte en `sinLimite`. */
function totalesCategoria(uso, categoria) {
    let usado = 0, limite = 0, disponible = 0, sinLimite = 0, alguno = false;
    (uso || []).forEach(b => {
        const info = UNIT_TIPO[String(b.unitType)];
        if (!info || info.cat !== categoria) return;
        alguno = true;
        const bal = b.balances?.[0] || {};
        const lim = Number(bal.personalLimit) || 0;
        usado += Number(bal.personalUsed) || 0;
        disponible += Number(bal.personalBalance) || 0;
        if (lim > 0) limite += lim; else sinLimite++;
    });
    return alguno ? { usado, limite, disponible, sinLimite } : null;
}
const unidadCategoria = c => (c === "Datos" ? "bytes" : c === "Voz" ? "seg" : "conteo");

/** Celda de la tabla principal: consumido / total arriba, disponible abajo.
    (No confundir con celdaUso(), que pinta el uso de UN registro del CDR.) */
function celdaUsoCategoria(cm, categoria) {
    if (!cm) return "—";
    const t = totalesCategoria(cm.uso, categoria);
    if (!t) return "—";
    const u = unidadCategoria(categoria);
    const tope = t.limite > 0 ? fmtCantidad(u, t.limite) : "sin límite";
    const nota = t.limite > 0 && t.sinLimite ? ` <span class="uso-nota">(+${t.sinLimite} sin límite)</span>` : "";
    return `<span class="me-mono">${fmtCantidad(u, t.usado)} / ${tope}${nota}</span>` +
        `<div class="uso-celda-disp">Disp. <strong>${fmtCantidad(u, t.disponible)}</strong></div>`;
}

/* =====================================================================
   6 · MOVIMIENTOS (compras, paquetes, recurrencias y otros ajustes)
   /api/v1/subscription/{id}/detailedSubscriptionTransaction — mismo
   endpoint y misma clasificación que "Movimientos BSS" en Prepagadas,
   pero acotado al rango de fechas del histórico (no todo el historial
   desde 2020): esta herramienta no hace seguimiento de ciclos/periodos,
   así que "vigente" aquí es una noción simple (ver más abajo), no el
   cálculo de cobertura de Prepagadas.
===================================================================== */
const paramMov = (t, n) => (t.parameters || []).find(p => p.name === n)?.value || "";
const tipoMov = t => paramMov(t, "RNAdjustmentTypeID");
const montoMov = t => Number(t.amount || 0) / 10000;

// Mismas reglas que categoriaTx en Prepagadas (tuneables: si un tipo de
// ajuste queda mal clasificado, ajusta estas expresiones y listo).
const RE_PRIMERA = /1er\s*Mes/i;
const RE_RECURRENCIA = /\brecur/i;
const RE_COMPRA_PLAN = /(paquete|plan|suscrip|pague\s*\d|lleve\s*\d)/i;
const RE_COMPRA = /(compra|paquete|ingreso\s*de\s*saldo|recarga|abono|activaci|adquisic|1er\s*Mes)/i;

const esPrimeraMov = t => RE_PRIMERA.test(tipoMov(t));
const esRecurMov = t => RE_RECURRENCIA.test(tipoMov(t)) && !RE_PRIMERA.test(tipoMov(t));
const esCompraPlanMov = t => !esRecurMov(t) && !esPrimeraMov(t) && RE_COMPRA_PLAN.test(tipoMov(t));
const esCompraMov = t => !esRecurMov(t) && !esCompraPlanMov(t) && (RE_COMPRA.test(tipoMov(t)) || montoMov(t) > 0);

function categoriaMov(t) {
    if (esPrimeraMov(t)) return "primera";
    if (esCompraPlanMov(t)) return "compraPlan";
    if (esRecurMov(t)) return "recurrencia";
    if (esCompraMov(t)) return "compra";
    return "otro";
}
const ETIQUETA_CATEGORIA_MOV = {
    primera: "1.ª compra", compraPlan: "Compra de paquete",
    compra: "Compra / ingreso", recurrencia: "Recurrencia", otro: "Otro ajuste"
};
// Clase de fila (resalta compras y paquetes) — mismos colores que "Movimientos BSS" en Prepagadas.
const CLASE_FILA_MOV = {
    primera: "tx-primera", compraPlan: "tx-compraPlan", compra: "tx-compra",
    recurrencia: "tx-recurrencia", otro: "tx-otro"
};

function esMesActual(t) {
    const d = new Date(t.transactionDate);
    if (isNaN(d)) return false;
    const hoy = new Date();
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
}

/** "Vigente" = la compra/paquete/1.ª compra MÁS RECIENTE de su categoría
    dentro del rango consultado (no hay cálculo de cobertura de ciclo:
    ver la nota de la sección). Recurrencias y otros ajustes no aplican. */
function marcarVigentes(movs) {
    const ultimaPorCat = {};
    movs.forEach(t => {
        const cat = categoriaMov(t);
        if (cat === "recurrencia" || cat === "otro") return;
        const fecha = String(t.transactionDate || "");
        if (fecha && (!ultimaPorCat[cat] || fecha > ultimaPorCat[cat])) ultimaPorCat[cat] = fecha;
    });
    const vigentes = new Set();
    movs.forEach(t => {
        const cat = categoriaMov(t);
        if (ultimaPorCat[cat] && String(t.transactionDate) === ultimaPorCat[cat]) vigentes.add(t.identifier);
    });
    return vigentes;
}

/** Movimientos (compras/paquetes/recurrencias), paginado y deduplicado
    igual que el histórico de consumo. */
async function cmMovimientos(subscriberId, { start, end }, alProgresar) {
    // Aquí la firma de deduplicación es más ancha que el identifier solo: el
    // CM llega a repetir el mismo recibo con distinto tipo/monto.
    const { registros, truncado } = await paginarHistorico(
        `${CONFIG.apiBase}/api/v1/subscription/${encodeURIComponent(subscriberId)}/detailedSubscriptionTransaction`,
        { limit: String(CONFIG.pageSizeHistorico), isAscending: "false", start, end },
        {
            fechaDe: t => t.transactionDate,
            claveDe: t => `${t.identifier}|${t.transactionDate}|${tipoMov(t)}|${t.amount}`,
            etiqueta: `Movimientos ${subscriberId}`, alProgresar
        }
    );
    registros.sort((a, b) => String(b.transactionDate || "").localeCompare(String(a.transactionDate || ""))); // recientes primero
    return { movimientos: registros, truncado };
}

/* =====================================================================
   7 · HISTÓRICO DE CONSUMO (CDR) — clasificación por tipo y dirección
   TUNEABLE: callType 1/2 (voz MO/MT), 3 (SMS) y 11 (datos) están
   confirmados con datos reales de listDetailedCallDetailsWithBundles. Si
   aparece un callType nuevo, cae al respaldo por bundleInfo.unitType
   (mismo código que bundleBalance) y luego a dataUsage/duration.
===================================================================== */
const CALLTYPE_CATEGORIA = { "1": "VOZ", "2": "VOZ", "3": "SMS", "11": "DATOS" };
const UNIT_CATEGORIA_CDR = { "0": "VOZ", "1": "DATOS", "2": "SMS", "3": "SALDO" };
const ETIQUETA_CATEGORIA_CDR = { TODOS: "Todos", DATOS: "Datos", VOZ: "Voz", SMS: "SMS", SALDO: "Saldo", OTRO: "Otro" };
const CLASE_CATEGORIA_CDR = { DATOS: "info", VOZ: "ok", SMS: "warn", SALDO: "neutro", OTRO: "neutro" };

function categoriaCdr(r) {
    if (CALLTYPE_CATEGORIA[r.callType]) return CALLTYPE_CATEGORIA[r.callType];
    const bi = (r.bundleInfo || [])[0];
    if (bi && UNIT_CATEGORIA_CDR[String(bi.unitType)]) return UNIT_CATEGORIA_CDR[String(bi.unitType)];
    if (Number(r.dataUsage) > 0) return "DATOS";
    if (Number(r.duration) > 0) return "VOZ";
    return "OTRO";
}

function paramCdr(r, nombre) {
    return (r.parameters || []).find(p => p.name === nombre)?.value || "";
}
/** MO (originada por la línea) / MT (terminada en la línea), por ChargedParty (O/T) con respaldo en RatingRule. */
function direccionCdr(r) {
    const cp = paramCdr(r, "ChargedParty");
    if (cp === "O") return "MO";
    if (cp === "T") return "MT";
    const regla = paramCdr(r, "RatingRule");
    if (/\bMO\b/i.test(regla)) return "MO";
    if (/\bMT\b/i.test(regla)) return "MT";
    return "";
}

/* =====================================================================
   8 · ENTRADA: líneas manuales o desde archivo (Excel/CSV)
===================================================================== */
let lineasArchivo = null; // lo llena configurarArchivo(); mismo formato que MEUI.parseLineas()

function obtenerLineas() {
    if (lineasArchivo && lineasArchivo.lineas && lineasArchivo.lineas.length) return lineasArchivo;
    const el = MEUI.$("#inputLineas");
    return el ? MEUI.parseLineas(el.value) : { lineas: [], descartadas: [] };
}

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
        lineasArchivo = MEUI.parseLineas(valores.join("\n"));
        info.innerHTML = `${filasHoja.length} filas · ${lineasArchivo.lineas.length} líneas válidas` +
            (lineasArchivo.descartadas.length ? ` · ${lineasArchivo.descartadas.length} descartadas` : "");
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

/* =====================================================================
   9 · CONCURRENCIA Y CONSULTA MASIVA (solo línea + paquetes: rápido)
===================================================================== */
async function ejecutarPool(items, limite, worker) {
    let i = 0;
    const total = items.length;
    const n = Math.max(1, Math.min(limite || 8, total || 1));
    const ejecutores = Array.from({ length: n }, async () => {
        while (i < total) { const idx = i++; await worker(items[idx], idx); }
    });
    await Promise.all(ejecutores);
}

function filaError(msisdn, estadoProceso, detalle) {
    return { msisdn, estadoProceso, detalle: detalle || "", cm: null, historico: null, movimientos: null };
}

/** Trae el titular (identificación + nombre) de una cuenta y deja
 *  constancia en el registro de cualquier aviso (cuenta hija, nombre de
 *  prueba) — mismo criterio que logica-rechazo.js: nada se inventa, y lo
 *  que no se pudo resolver queda vacío en vez de adivinado. */
async function resolverTitular(msisdn, ban) {
    const avisos = [];
    try {
        const titular = await titularDeCuenta(ban, avisos);
        avisos.forEach(a => MEUI.log(`⚠ CM ${msisdn}: ${a}.`, "warn"));
        return titular;
    } catch (e) {
        MEUI.log(`⚠ CM ${msisdn}: no se pudo leer el titular (${e.message}).`, "warn");
        return null;
    }
}

async function consultarLinea(msisdn) {
    try {
        const cm = await cmBuscarLinea(msisdn);
        if (!cm) return { msisdn, estadoProceso: "SIN_CM", detalle: "Sin suscriptor en el CM para esta línea.", cm: null, historico: null, movimientos: null };
        const [uso, titular] = await Promise.all([
            cmBundleBalance(cm.subscriberId),
            resolverTitular(msisdn, cm.ban || cm.subscriberId)
        ]);
        cm.uso = uso;
        cm.identificacion = titular?.identificacion || null;
        cm.tipoId = titular?.tipoId || null;
        cm.nombreTitular = titular?.nombre || null;
        return { msisdn, estadoProceso: "SUCCESS", detalle: "", cm, historico: null, movimientos: null };
    } catch (e) {
        return { msisdn, estadoProceso: "ERROR", detalle: e.message || String(e), cm: null, historico: null, movimientos: null };
    }
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

let filas = [], dataTable = null, corriendo = false;

async function consultar() {
    if (corriendo) return;
    const entrada = obtenerLineas();
    if (!entrada.lineas.length) { MEUI.toast("No hay líneas válidas para consultar.", "warn"); return; }
    try { await auth.ensure(); }
    catch (e) { MEUI.toast("Inicia sesión en el CM primero.", "err"); MEUI.log("✖ " + e.message, "err"); return; }

    MEUI.log(`Líneas válidas: ${entrada.lineas.length}` +
        (entrada.descartadas.length ? ` · descartadas: ${entrada.descartadas.length}` : ""), "info");

    corriendo = true;
    const btn = MEUI.$("#btnConsultar");
    if (btn) btn.disabled = true;
    filas = entrada.lineas.map(m => ({ msisdn: m, estadoProceso: "PENDING", cm: null, historico: null, movimientos: null, detalle: "" }));
    entrada.descartadas.forEach(v => filas.push(filaError(String(v).trim(), "INVALID", "No es una línea válida.")));
    render();

    const paralelo = Math.max(1, Math.min(15, Number(MEUI.$("#cfgParalelo").value) || 8));
    const porMsisdn = new Map(filas.map(f => [f.msisdn, f]));
    let hechas = 0, ultimoRender = 0;
    const total = entrada.lineas.length;
    actualizarProgreso(0, total);

    await ejecutarPool(entrada.lineas, paralelo, async msisdn => {
        const fila = porMsisdn.get(msisdn);
        fila.estadoProceso = "PROCESSING";
        Object.assign(fila, await consultarLinea(msisdn));
        hechas++;
        actualizarProgreso(hechas, total);
        const ahora = performance.now();
        if (ahora - ultimoRender > 400 || hechas === total) { ultimoRender = ahora; render(); }
    });

    corriendo = false;
    if (btn) btn.disabled = false;
    actualizarProgreso(0, 0);
    render();
    MEUI.toast(`Consulta terminada: ${filas.length} línea(s) procesada(s).`, "ok");
}

/* =====================================================================
   10 · FILTROS Y KPIs (tabla principal)
===================================================================== */
const filtros = { estado: new Set() };

function estadoTabla(f) {
    if (f.estadoProceso !== "SUCCESS") return f.estadoProceso; // SIN_CM | ERROR | INVALID | PENDING | PROCESSING
    return f.cm?.estadoLinea || "—";
}

function filaPasaFiltros(f) {
    if (filtros.estado.size && !filtros.estado.has(estadoTabla(f))) return false;
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
    pintarFiltro(MEUI.$("#fEstado"), "estado", estados.map(v => [v, v === "SIN_CM" ? "Sin CM" : v, cont(v)]));
}

function actualizarKPIs() {
    const c = { SIN_CM: 0, ERROR: 0, INVALID: 0 };
    filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
    const activas = filas.filter(f => f.cm?.estadoLinea === "Activo").length;
    MEUI.$("#kpiTotal").textContent = filas.length;
    MEUI.$("#kpiActivas").textContent = activas;
    MEUI.$("#kpiSinCm").textContent = c.SIN_CM;
    MEUI.$("#kpiErrores").textContent = c.ERROR + c.INVALID;
}

function alternarKpi(el) {
    const dim = el.dataset.fdim;
    const vals = el.dataset.fval.split(",");
    const activo = el.classList.toggle("kpi-activo");
    MEUI.$$(`.me-kpi[data-fdim="${dim}"]`).forEach(o => { if (o !== el) o.classList.remove("kpi-activo"); });
    filtros[dim].clear();
    if (activo) vals.forEach(v => filtros[dim].add(v));
    render();
}

function limpiarFiltros() {
    Object.values(filtros).forEach(s => s.clear());
    MEUI.$$(".me-kpi.kpi-activo").forEach(k => k.classList.remove("kpi-activo"));
    render();
}

/* =====================================================================
   11 · TABLA PRINCIPAL (DataTables en modo data)
===================================================================== */
function celdaEstado(f) {
    const e = estadoTabla(f);
    const cls = { Activo: "ok", Disponible: "info", Desactivado: "off", Bloqueada: "err",
        SIN_CM: "neutro", ERROR: "err", INVALID: "err", PENDING: "neutro", PROCESSING: "info" }[e] || "neutro";
    return `<span class="badge-estado ${cls}">${MEUI.esc(e === "SIN_CM" ? "SIN CM" : e)}</span>`;
}

/** "123456789 (CC)" — o solo el número si no se pudo confirmar el tipo. */
function celdaIdentificacion(f) {
    const id = f.cm?.identificacion;
    if (!id) return "—";
    return MEUI.esc(f.cm.tipoId ? `${id} (${f.cm.tipoId})` : id);
}

function construirDataTable() {
    dataTable = new DataTable("#tablaLineas", MEUI.opcionesTabla({
        data: [],
        columns: [
            { data: "msisdn", title: "Línea (MSISDN)", render: v => `<span class="me-mono">${MEUI.esc(v)}</span>` },
            { data: null, title: "Estado", render: celdaEstado },
            { data: null, title: "Identificación", render: f => `<span class="me-mono">${celdaIdentificacion(f)}</span>` },
            { data: null, title: "Titular", render: f => MEUI.esc(f.cm?.nombreTitular || "—") },
            { data: null, title: "SubscriptionID", render: f => `<span class="me-mono">${MEUI.esc(f.cm?.subscriberId || "—")}</span>` },
            { data: null, title: "Cuenta (BAN)", render: f => `<span class="me-mono">${MEUI.esc(f.cm?.ban || "—")}</span>` },
            { data: null, title: "Price Plan", render: f => MEUI.esc(f.cm?.planPrecioId ?? "—") },
            { data: null, title: "Paquetes activos", render: f => f.cm ? (f.cm.uso || []).length : "—" },
            { data: null, title: "Datos (consumido / total)", render: f => celdaUsoCategoria(f.cm, "Datos") },
            { data: null, title: "Voz (consumido / total)", render: f => celdaUsoCategoria(f.cm, "Voz") },
            { data: null, title: "SMS (consumido / total)", render: f => celdaUsoCategoria(f.cm, "SMS") },
            {
                data: null, title: "Consumo", orderable: false, className: "col-accion",
                render: f => `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                    title="Ver consumo, paquetes y datos de la línea">👁</button>`
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
    MEUI.prepararTabla("#tablaLineas");
    if (!dataTable) construirDataTable();
    const visibles = filas.filter(filaPasaFiltros);
    dataTable.clear();
    dataTable.rows.add(visibles);
    dataTable.draw(false);
    actualizarKPIs();
    actualizarFiltros();
    MEUI.mostrarSiHayDatos("#tablaLineas", { vacio: "#msgVacio", tabla: dataTable });
    MEUI.resumenPaso(2, filas.length ? `${filas.length} líneas consultadas` : "");
    MEUI.ajustarTablas();
}

/* =====================================================================
   12 · MODAL DE DETALLE — cabecera, datos de línea, cuentas, paquetes
===================================================================== */
let filaActual = null;
function filaDe(msisdn) { return filas.find(f => f.msisdn === msisdn); }

function pintarCabeceraModal(f) {
    MEUI.$("#mdMsisdn").textContent = f.msisdn;
    MEUI.$("#mdCc").textContent = f.cm?.identificacion || "—";
    MEUI.$("#mdSubId").textContent = f.cm?.subscriberId || "—";
    MEUI.$("#mdBan").textContent = f.cm?.ban || "—";
    MEUI.$("#mdResumen").innerHTML = f.cm
        ? celdaEstado(f)
        : `<div class="alert alert-warning mb-0 py-2">${MEUI.esc(f.detalle || "Sin datos del CM para esta línea.")}</div>`;
    MEUI.$("#mdDatos").innerHTML = f.cm ? Object.entries({
        "Titular": f.cm.nombreTitular || "—",
        "Identificación": f.cm.identificacion ? `${f.cm.identificacion}${f.cm.tipoId ? " (" + f.cm.tipoId + ")" : ""}` : "—",
        "SubscriptionID": f.cm.subscriberId || "—",
        "Cuenta (BAN)": f.cm.ban || "—",
        "Estado de la línea": f.cm.estadoCmTexto || "—",
        "Price Plan ID": f.cm.planPrecioId ?? "—",
        "Creado": fmtFechaHora(f.cm.creado),
        "Otras cuentas (BAN)": f.cm.multiBan ? `${f.cm.cuentas.length} cuentas — ver abajo` : "1 (esta)"
    }).map(([k, v]) => `<dt>${k}</dt><dd>${escHtml(v)}</dd>`).join("") : "";
}

function pintarPaquetes(f) {
    const bundles = (f.cm && f.cm.uso) || [];
    if (bundles.length) {
        MEUI.$("#mdUsoWrap").style.display = "block";
        MEUI.$("#mdUsoInfo").textContent = `${bundles.length} bundle(s) · SubscriptionID ${f.cm.subscriberId}`;
        MEUI.$("#mdUso").innerHTML = usoHTML(bundles);
    } else {
        MEUI.$("#mdUsoWrap").style.display = "none";
    }
}

function pintarCuentas(f) {
    const wrap = MEUI.$("#mdCuentasWrap");
    const cuentas = (f.cm && f.cm.cuentas) || [];
    if (!f.cm || cuentas.length <= 1) { wrap.style.display = "none"; return; }
    wrap.style.display = "block";
    const activaId = f.cm.subscriberId;
    MEUI.$("#mdCuentas").innerHTML = cuentas.map(c => `
        <tr class="${String(c.subscriberId) === String(activaId) ? "table-success" : ""}">
            <td>${String(c.subscriberId) === String(activaId) ? "✔" : ""}</td>
            <td class="me-mono">${MEUI.esc(c.ban || "—")}</td>
            <td class="me-mono">${MEUI.esc(c.subscriberId || "—")}</td>
            <td>${MEUI.esc(c.estadoCmTexto || "—")}</td>
            <td>${String(c.subscriberId) === String(activaId)
            ? '<span class="badge text-bg-dark">en uso</span>'
            : `<button type="button" class="btn btn-sm btn-outline-dark" data-usar-cuenta="${MEUI.esc(c.subscriberId || "")}">Usar esta cuenta</button>`}</td>
        </tr>`).join("");
}

async function cambiarCuenta(subscriberId) {
    const f = filaDe(filaActual);
    if (!f || !f.cm) return;
    const c = (f.cm.cuentas || []).find(x => String(x.subscriberId) === String(subscriberId));
    if (!c || String(c.subscriberId) === String(f.cm.subscriberId)) return;
    try {
        // Cada BAN puede tener su propio titular (no siempre es la misma
        // persona/empresa que la cuenta que estaba activa), así que se
        // vuelve a resolver para la cuenta nueva en vez de arrastrar la
        // anterior.
        const [uso, titular] = await Promise.all([
            cmBundleBalance(c.subscriberId),
            resolverTitular(f.msisdn, c.ban || c.subscriberId)
        ]);
        f.cm = {
            ...f.cm, ...c, uso,
            identificacion: titular?.identificacion || null,
            tipoId: titular?.tipoId || null,
            nombreTitular: titular?.nombre || null
        };
        f.historico = null;
        f.movimientos = null;
        render();
        MEUI.log(`Cuenta cambiada en ${f.msisdn} → BAN ${c.ban || c.subscriberId}.`, "info");
        abrirDetalle(f.msisdn);
    } catch (e) {
        MEUI.toast("No se pudo cambiar de cuenta: " + e.message, "err");
    }
}

/* =====================================================================
   13 · HISTÓRICO DE CONSUMO — filtro de fechas/tipo, KPIs, gráficas
===================================================================== */
let tipoHistorico = "TODOS";
let chartBarras = null, chartTorta = null;
let dtHistorico = null;

function isoLocalSinZ(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** Mes en curso, en hora local (igual convención que "Fecha y hora de compra" de Prepagadas). */
function rangoMesActualLocal() {
    const hoy = new Date();
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 0, 0, 0);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
    return { desde: isoLocalSinZ(ini), hasta: isoLocalSinZ(fin) };
}
/** El input datetime-local se etiqueta con "Z" tal cual (mismo criterio que payloadCrear en Prepagadas). */
function normalizarLocalISO(v) {
    let s = String(v || "");
    if (s.length === 16) s += ":00";
    return s;
}

function registrosFiltrados(f) {
    const regs = (f.historico && f.historico.registros) || [];
    if (tipoHistorico === "TODOS") return regs;
    return regs.filter(r => categoriaCdr(r) === tipoHistorico);
}

async function cargarHistorico(f) {
    const desde = MEUI.$("#mdHistDesde").value, hasta = MEUI.$("#mdHistHasta").value;
    if (!desde || !hasta) { MEUI.toast("Completa el rango de fechas.", "warn"); return; }
    const start = normalizarLocalISO(desde) + ".000Z";
    const end = normalizarLocalISO(hasta) + ".999Z";
    const estado = MEUI.$("#mdHistEstado");
    estado.textContent = "Consultando histórico y movimientos…";
    MEUI.ocupado("#mdHistActualizar", "Consultando…");

    // El rango se trae completo, sin tope: con muchos registros son varias
    // páginas seguidas, así que se va contando en vivo para que no parezca
    // que se quedó pegado.
    let nCdr = 0, nMov = 0;
    const avisar = () => {
        estado.textContent = `Consultando… ${nfmt(nCdr)} registro(s) de consumo y ${nfmt(nMov)} movimiento(s) hasta ahora.`;
    };

    try {
        const [cdr, mov] = await Promise.all([
            cmHistoricoConsumo(f.cm.subscriberId, { start, end }, n => { nCdr = n; avisar(); }),
            cmMovimientos(f.cm.subscriberId, { start, end }, n => { nMov = n; avisar(); }).catch(e => {
                // El consumo (CDR) se sigue mostrando aunque los movimientos
                // fallen, pero la falla NO se calla: va marcada para que no
                // se lea como "esta línea no tuvo movimientos".
                MEUI.log(`✖ Movimientos ${f.msisdn}: ${e.message}`, "err");
                return { movimientos: [], truncado: true, error: e.message };
            })
        ]);
        f.historico = { registros: cdr.registros, truncado: cdr.truncado, start, end };
        f.movimientos = {
            movimientos: mov.movimientos, truncado: mov.truncado, error: mov.error || null,
            vigentes: marcarVigentes(mov.movimientos), start, end
        };
        estado.textContent =
            `${nfmt(cdr.registros.length)} registro(s) de consumo · ${nfmt(mov.movimientos.length)} movimiento(s) en el rango elegido` +
            (cdr.truncado || mov.truncado
                ? " · ⚠ el CM falló en una página y no se recuperó ni reintentando ni pidiendo menos registros: "
                  + "lo que ves está completo hasta donde alcanzó, pero puede faltar. Vuelve a consultar o acota el rango (ver el registro)."
                : ".");
        pintarHistorico(f);
        pintarMovimientos(f);
    } catch (e) {
        MEUI.$("#mdHistEstado").innerHTML = `<span class="text-danger">✖ ${MEUI.esc(e.message)}</span>`;
        MEUI.log(`✖ Histórico ${f.msisdn}: ${e.message}`, "err");
    } finally {
        MEUI.libre("#mdHistActualizar");
    }
}

function pintarHistKpis(regs) {
    let datos = 0, vozMs = 0, sms = 0;
    regs.forEach(r => {
        const cat = categoriaCdr(r);
        if (cat === "DATOS") datos += Number(r.dataUsage) || 0;
        else if (cat === "VOZ") vozMs += Number(r.duration) || 0; // duration del CDR viene en ms
        else if (cat === "SMS") sms++;
    });
    MEUI.$("#mdKpiDatos").textContent = fmtBytes(datos);
    MEUI.$("#mdKpiVoz").textContent = fmtVoz(vozMs / 1000);
    MEUI.$("#mdKpiSms").textContent = nfmt(sms);
    MEUI.$("#mdKpiRegistros").textContent = nfmt(regs.length);
}

function colorCategoria(cat) {
    const mapa = {
        DATOS: ["--me-info", "#2C5AA0"], VOZ: ["--me-ok", "#1D7A46"],
        SMS: ["--me-warn", "#C87400"], OTRO: ["--me-off", "#9A9A94"], SALDO: ["--me-off", "#9A9A94"]
    };
    const [v, fallback] = mapa[cat] || mapa.OTRO;
    const css = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    return css || fallback;
}

function pintarGraficas(regs) {
    if (typeof Chart === "undefined") return; // sin conexión a la CDN de Chart.js: se omiten las gráficas
    const porDia = new Map();
    const porCategoria = {};
    regs.forEach(r => {
        const cat = categoriaCdr(r);
        porCategoria[cat] = (porCategoria[cat] || 0) + 1;
        const dia = String(r.transactionDate || "").slice(0, 10);
        if (!dia) return;
        if (!porDia.has(dia)) porDia.set(dia, {});
        const d = porDia.get(dia);
        d[cat] = (d[cat] || 0) + 1;
    });
    const dias = [...porDia.keys()].sort();
    const categorias = tipoHistorico === "TODOS" ? ["DATOS", "VOZ", "SMS", "OTRO"] : [tipoHistorico];
    const categoriasConDatos = categorias.filter(c => dias.some(d => (porDia.get(d)[c] || 0) > 0));
    const seriesBarras = (categoriasConDatos.length ? categoriasConDatos : categorias);

    const ctxB = MEUI.$("#mdChartBarras");
    if (ctxB) {
        if (chartBarras) { chartBarras.destroy(); chartBarras = null; }
        chartBarras = new Chart(ctxB, {
            type: "bar",
            data: {
                labels: dias,
                datasets: seriesBarras.map(c => ({
                    label: ETIQUETA_CATEGORIA_CDR[c] || c,
                    data: dias.map(d => porDia.get(d)[c] || 0),
                    backgroundColor: colorCategoria(c)
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
                plugins: { legend: { display: seriesBarras.length > 1 }, title: { display: true, text: "Registros por día" } }
            }
        });
    }

    const ctxT = MEUI.$("#mdChartTorta");
    if (ctxT) {
        if (chartTorta) { chartTorta.destroy(); chartTorta = null; }
        const etiquetas = Object.keys(porCategoria);
        chartTorta = new Chart(ctxT, {
            type: "doughnut",
            data: {
                labels: etiquetas.map(c => ETIQUETA_CATEGORIA_CDR[c] || c),
                datasets: [{ data: etiquetas.map(c => porCategoria[c]), backgroundColor: etiquetas.map(colorCategoria) }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { title: { display: true, text: "Proporción por categoría" } }
            }
        });
    }
}

function celdaCategoriaCdr(r) {
    const cat = categoriaCdr(r);
    const dir = direccionCdr(r);
    return `<span class="badge-estado ${CLASE_CATEGORIA_CDR[cat] || "neutro"}">${MEUI.esc(ETIQUETA_CATEGORIA_CDR[cat] || cat)}${dir ? " · " + dir : ""}</span>`;
}
function celdaUso(r) {
    const cat = categoriaCdr(r);
    if (cat === "DATOS") return fmtBytes(r.dataUsage);
    if (cat === "VOZ") return fmtDuracionHMS(r.duration);
    return "—";
}

/* Ficha de detalle de un registro (fila expandible), con solo los campos
   relevantes: se excluyen códigos internos de facturación sin catálogo
   (billingCategoryID, bucketRateID, flatRate, glCode, tax authority IDs,
   subscriberType, usageType, usedBucketMinutes, variableRate*, el "type"
   fijo "CallDetailWithBundles" y los `parameters` internos que no sean
   ChargedParty/RatingRule). */
function detalleCdrHTML(r) {
    const bi = (r.bundleInfo || [])[0];
    const dir = direccionCdr(r);
    const cat = categoriaCdr(r);
    const pares = [
        ["ID", r.identifier || "—"],
        ["Cuenta (AccountID)", r.accountID || "—"],
        ["Línea (Mobile Number)", r.mobileNumber || "—"],
        ["Fecha del evento", fmtFechaHora(r.transactionDate)],
        ["Fecha de registro (posted)", fmtFechaHora(r.postedDate)],
        ["Tipo", `${ETIQUETA_CATEGORIA_CDR[cat] || cat}${dir ? " · " + dir : ""}`],
        ["Regla de tarifa (RatingRule)", paramCdr(r, "RatingRule") || "—"],
        ["Origen", [r.originatingNumber, r.originatingLocation].filter(Boolean).join(" · ") || "—"],
        ["Destino", [r.destinationNumber, r.destinationLocation].filter(Boolean).join(" · ") || "—"],
        ["Duración", cat === "VOZ" ? fmtDuracionHMS(r.duration) : "—"],
        ["Datos", cat === "DATOS" ? fmtBytes(r.dataUsage) : "—"],
        ["Cargo (charge)", fmtMonto(r.charge)],
        ["Balance de la cuenta tras el evento", fmtMonto(r.balance)],
        ["Plan (ratePlan)", r.ratePlan || "—"],
        ["Bundle", bi
            ? `${bi.bundleId || "—"} · ${bi.bundleCategoryDesc || "—"} · consumió ${bi.chargedAmount ?? "—"} ${UNIT_TIPO[String(bi.unitType)]?.u || ""} · saldo del bundle ${bi.balance ?? "—"}`
            : "—"]
    ];
    return `<dl class="dl-grid mb-0" style="grid-template-columns:200px 1fr">` +
        pares.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join("") + `</dl>`;
}

function construirTablaHistorico() {
    dtHistorico = new DataTable("#tablaHistorico", MEUI.opcionesTabla({
        data: [],
        order: [[0, "desc"]],
        columns: [
            {
                data: null, title: "Fecha",
                render: (d, type, r) => type === "display"
                    ? `<span class="me-mono">${fmtFechaHora(r.transactionDate)}</span>`
                    : (r.transactionDate || "")
            },
            { data: null, title: "Tipo", render: celdaCategoriaCdr },
            { data: null, title: "Origen", render: r => MEUI.esc(r.originatingNumber || "—") },
            { data: null, title: "Destino", render: r => MEUI.esc(r.destinationNumber || "—") },
            { data: null, title: "Uso", render: celdaUso },
            { data: null, title: "Bundle", render: r => MEUI.esc(r.bundleInfo?.[0]?.bundleId || "—") },
            { data: null, title: "Monto", render: r => fmtMonto(r.charge) },
            { data: null, title: "ID", render: r => `<span class="me-mono">${MEUI.esc(r.identifier || "—")}</span>` },
            {
                data: null, title: "Detalle", orderable: false, className: "col-accion",
                render: () => `<button type="button" class="btn btn-sm btn-me-line btn-ver-cdr" title="Ver todos los datos del registro">👁</button>`
            }
        ]
    }));
    dtHistorico.on("click", "button.btn-ver-cdr", function () {
        const tr = this.closest("tr");
        const fila = dtHistorico.row(tr);
        if (fila.child.isShown()) { fila.child.hide(); tr.classList.remove("shown"); }
        else { fila.child(detalleCdrHTML(fila.data())).show(); tr.classList.add("shown"); }
    });
    MEUI.registrarTabla(dtHistorico);
}

function pintarTablaHistorico(regs) {
    MEUI.prepararTabla("#tablaHistorico");
    if (!dtHistorico) construirTablaHistorico();
    dtHistorico.clear();
    dtHistorico.rows.add(regs);
    dtHistorico.draw(false);
    MEUI.mostrarSiHayDatos("#tablaHistorico", { vacio: "#mdHistVacio", tabla: dtHistorico });
    MEUI.ajustarTablas();
}

function pintarHistorico(f) {
    const regs = registrosFiltrados(f);
    pintarHistKpis(regs);
    pintarGraficas(regs);
    pintarTablaHistorico(regs);
    MEUI.$$(".hist-tipo-btn").forEach(b => b.classList.toggle("active", b.dataset.tipo === tipoHistorico));
    const etiqueta = ETIQUETA_CATEGORIA_CDR[tipoHistorico] || tipoHistorico;
    MEUI.$$(".hist-tipo-actual").forEach(el => el.textContent = etiqueta);
}

/* --- Exportación del histórico de la línea abierta (mismo filtro que la
   tabla y las gráficas: ver registrosFiltrados()) --------------------- */
function cabeceraHistorico() {
    return ["Fecha", "Tipo", "Dirección", "Origen", "Destino", "Duración (hh:mm:ss)",
        "Datos (bytes)", "Bundle", "Monto", "ID", "AccountID"];
}
function filasHistoricoExport(regs) {
    return regs.map(r => {
        const cat = categoriaCdr(r);
        return [
            String(r.transactionDate || "").replace("T", " ").slice(0, 19),
            ETIQUETA_CATEGORIA_CDR[cat] || cat, direccionCdr(r),
            r.originatingNumber || "", r.destinationNumber || "",
            cat === "VOZ" ? fmtDuracionHMS(r.duration) : "",
            cat === "DATOS" ? (Number(r.dataUsage) || 0) : "",
            r.bundleInfo?.[0]?.bundleId || "", (Number(r.charge) || 0) / 10000,
            r.identifier || "", r.accountID || ""
        ];
    });
}

/* =====================================================================
   13.5 · MOVIMIENTOS — filtro por categoría, KPIs, DataTable
   Todo aquí resuelve la línea abierta con filaDe(filaActual) EN CADA
   llamada (no la captura en un closure): la DataTable de movimientos se
   construye una sola vez (lazy) y se reutiliza al cambiar de línea, así
   que un valor capturado en la construcción quedaría obsoleto.
===================================================================== */
let filtroCategoriaMov = new Set(); // vacío = sin filtro
let dtMovimientos = null;

function movimientosFiltrados(f) {
    const movs = (f.movimientos && f.movimientos.movimientos) || [];
    if (!filtroCategoriaMov.size) return movs;
    return movs.filter(t => filtroCategoriaMov.has(categoriaMov(t)));
}

function pintarMovKpis(movs) {
    const f = filaDe(filaActual);
    const vigentes = (f && f.movimientos && f.movimientos.vigentes) || new Set();
    const compras = movs.filter(t => ["primera", "compraPlan", "compra"].indexOf(categoriaMov(t)) >= 0).length;
    const totalMonto = movs.reduce((s, t) => s + montoMov(t), 0);
    const enVigencia = movs.filter(t => vigentes.has(t.identifier)).length;
    MEUI.$("#mdMovKpiTotal").textContent = nfmt(movs.length);
    MEUI.$("#mdMovKpiCompras").textContent = nfmt(compras);
    MEUI.$("#mdMovKpiMonto").textContent = "$" + nfmt(totalMonto, 2);
    MEUI.$("#mdMovKpiVigentes").textContent = nfmt(enVigencia);
}

function celdaCategoriaMov(t) {
    const cat = categoriaMov(t);
    const cls = { primera: "warn", compraPlan: "info", compra: "ok", recurrencia: "neutro", otro: "neutro" }[cat] || "neutro";
    return `<span class="badge-estado ${cls}">${MEUI.esc(ETIQUETA_CATEGORIA_MOV[cat] || cat)}</span>`;
}
function celdaVigenciaMov(t) {
    const f = filaDe(filaActual);
    const vigentes = (f && f.movimientos && f.movimientos.vigentes) || new Set();
    const chips = [];
    if (esMesActual(t)) chips.push(`<span class="chip-vigencia mes">Mes actual</span>`);
    if (vigentes.has(t.identifier)) chips.push(`<span class="chip-vigencia vigente">Vigente</span>`);
    return chips.join(" ") || "—";
}

function construirTablaMovimientos() {
    dtMovimientos = new DataTable("#tablaMovimientos", MEUI.opcionesTabla({
        data: [],
        order: [[0, "desc"]],
        createdRow: (row, data) => {
            row.classList.add(CLASE_FILA_MOV[categoriaMov(data)] || "tx-otro");
            const f = filaDe(filaActual);
            const vigentes = (f && f.movimientos && f.movimientos.vigentes) || new Set();
            if (vigentes.has(data.identifier)) row.classList.add("tx-vigente");
        },
        columns: [
            {
                data: null, title: "Fecha",
                render: (d, type, t) => type === "display"
                    ? `<span class="me-mono">${fmtFechaHora(t.transactionDate)}</span>`
                    : (t.transactionDate || "")
            },
            { data: null, title: "Categoría", render: celdaCategoriaMov },
            { data: null, title: "Tipo", render: t => MEUI.esc(tipoMov(t) || "—") },
            { data: null, title: "Monto", render: t => "$" + nfmt(montoMov(t), 2) },
            { data: null, title: "Agente", render: t => MEUI.esc(t.agent || "—") },
            { data: null, title: "Vigencia", render: (d, type, t) => type === "display" ? celdaVigenciaMov(t) : "" },
            { data: null, title: "ID", render: t => `<span class="me-mono">${MEUI.esc(t.identifier || "—")}</span>` }
        ]
    }));
    MEUI.registrarTabla(dtMovimientos);
}

function pintarMovimientos(f) {
    const movs = movimientosFiltrados(f);
    pintarMovKpis((f.movimientos && f.movimientos.movimientos) || []);
    MEUI.prepararTabla("#tablaMovimientos");
    if (!dtMovimientos) construirTablaMovimientos();
    dtMovimientos.clear();
    dtMovimientos.rows.add(movs);
    dtMovimientos.draw(false);
    MEUI.mostrarSiHayDatos("#tablaMovimientos", { vacio: "#mdMovVacio", tabla: dtMovimientos });
    MEUI.ajustarTablas();
    pintarFiltroMov(f);
}

function pintarFiltroMov(f) {
    const ul = MEUI.$("#fMovCategoria");
    if (!ul) return;
    const movs = (f.movimientos && f.movimientos.movimientos) || [];
    const cont = cat => movs.filter(t => categoriaMov(t) === cat).length;
    const categorias = ["primera", "compraPlan", "compra", "recurrencia", "otro"];
    ul.innerHTML = categorias.map(cat => `
        <li class="form-check px-2">
            <input class="form-check-input" type="checkbox" value="${cat}" id="f_mov_${cat}"
                ${filtroCategoriaMov.has(cat) ? "checked" : ""}>
            <label class="form-check-label" for="f_mov_${cat}">${MEUI.esc(ETIQUETA_CATEGORIA_MOV[cat])} <small class="text-muted">(${cont(cat)})</small></label>
        </li>`).join("");
    ul.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
        if (chk.checked) filtroCategoriaMov.add(chk.value); else filtroCategoriaMov.delete(chk.value);
        const fActual = filaDe(filaActual);
        if (fActual) pintarMovimientos(fActual);
    }));
}

/* --- Exportación de movimientos de la línea abierta ------------------ */
function cabeceraMovimientos() {
    return ["Fecha", "Categoría", "Tipo", "Monto", "Agente", "Mes actual", "Vigente", "ID"];
}
function filasMovimientosExport(f, movs) {
    const vigentes = (f.movimientos && f.movimientos.vigentes) || new Set();
    return movs.map(t => [
        String(t.transactionDate || "").replace("T", " ").slice(0, 19),
        ETIQUETA_CATEGORIA_MOV[categoriaMov(t)] || categoriaMov(t),
        tipoMov(t) || "", montoMov(t), t.agent || "",
        esMesActual(t) ? "Sí" : "No", vigentes.has(t.identifier) ? "Sí" : "No",
        t.identifier || ""
    ]);
}

/* =====================================================================
   14 · ABRIR EL DETALLE
===================================================================== */
function abrirDetalle(msisdn) {
    const f = filaDe(msisdn);
    if (!f) return;
    filaActual = msisdn;
    pintarCabeceraModal(f);
    pintarPaquetes(f);
    pintarCuentas(f);

    if (f.cm) {
        MEUI.$("#mdHistWrap").style.display = "block";
        if (!MEUI.$("#mdHistDesde").value) {
            const r = rangoMesActualLocal();
            MEUI.$("#mdHistDesde").value = r.desde;
            MEUI.$("#mdHistHasta").value = r.hasta;
        }
        cargarHistorico(f);
    } else {
        MEUI.$("#mdHistWrap").style.display = "none";
    }
    new bootstrap.Modal("#modalDetalle").show();
}

/* =====================================================================
   15 · EXPORTACIÓN (tabla principal)
===================================================================== */
const CABECERA_EXPORT = ["MSISDN", "Estado", "Identificación", "Tipo ID", "Titular", "SubscriptionID", "Cuenta (BAN)", "Price Plan ID",
    "Paquetes activos",
    "Datos consumidos (bytes)", "Datos total (bytes)", "Datos disponibles (bytes)",
    "Voz consumida (seg)", "Voz total (seg)", "Voz disponible (seg)",
    "SMS consumidos", "SMS total", "SMS disponibles",
    "Observación"];

/** En la exportación van los tres números crudos por categoría (sin
    formato) para que se puedan sumar/filtrar en Excel. */
function trioUso(cm, categoria) {
    const t = cm ? totalesCategoria(cm.uso, categoria) : null;
    if (!t) return ["", "", ""];
    return [t.usado, t.limite > 0 ? t.limite : "", t.disponible];
}

function filasExport() {
    return {
        head: CABECERA_EXPORT,
        rows: filas.filter(filaPasaFiltros).map(f => [
            f.msisdn, estadoTabla(f), f.cm?.identificacion || "", f.cm?.tipoId || "", f.cm?.nombreTitular || "",
            f.cm?.subscriberId || "", f.cm?.ban || "", f.cm?.planPrecioId ?? "",
            f.cm ? (f.cm.uso || []).length : "",
            ...trioUso(f.cm, "Datos"),
            ...trioUso(f.cm, "Voz"),
            ...trioUso(f.cm, "SMS"),
            f.detalle || ""
        ])
    };
}
function filasParaExportar() {
    return filas.filter(filaPasaFiltros).map(f => ({ msisdn: f.msisdn, estado: estadoTabla(f), cm: f.cm, detalle: f.detalle }));
}

/* =====================================================================
   16 · INICIALIZACIÓN
===================================================================== */
function inicializarConsumos() {
    MEUI.$("#btnConsultar").addEventListener("click", consultar);
    MEUI.$("#btnLimpiarFiltros").addEventListener("click", limpiarFiltros);
    MEUI.$$(".me-kpi.kpi-click").forEach(k => k.addEventListener("click", () => alternarKpi(k)));

    MEUI.$("#mdCuentas").addEventListener("click", e => {
        const b = e.target.closest("[data-usar-cuenta]");
        if (b) cambiarCuenta(b.dataset.usarCuenta);
    });
    MEUI.$("#mdHistTipo").addEventListener("click", e => {
        const b = e.target.closest("button[data-tipo]");
        if (!b) return;
        tipoHistorico = b.dataset.tipo;
        const f = filaDe(filaActual);
        if (f) pintarHistorico(f);
    });
    MEUI.$("#mdHistActualizar").addEventListener("click", () => {
        const f = filaDe(filaActual);
        if (f && f.cm) cargarHistorico(f);
    });
    MEUI.$("#mdHistCSV").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarCSV(cabeceraHistorico(), filasHistoricoExport(registrosFiltrados(f)), `consumo_${f.msisdn}`);
    });
    MEUI.$("#mdHistXLSX").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarXLSX(cabeceraHistorico(), filasHistoricoExport(registrosFiltrados(f)), `consumo_${f.msisdn}`, "Consumo");
    });
    MEUI.$("#mdHistJSON").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarJSON(registrosFiltrados(f), `consumo_${f.msisdn}`);
    });
    MEUI.$("#mdMovCSV").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarCSV(cabeceraMovimientos(), filasMovimientosExport(f, movimientosFiltrados(f)), `movimientos_${f.msisdn}`);
    });
    MEUI.$("#mdMovXLSX").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarXLSX(cabeceraMovimientos(), filasMovimientosExport(f, movimientosFiltrados(f)), `movimientos_${f.msisdn}`, "Movimientos");
    });
    MEUI.$("#mdMovJSON").addEventListener("click", () => {
        const f = filaDe(filaActual); if (!f) return;
        MEUI.exportarJSON(movimientosFiltrados(f), `movimientos_${f.msisdn}`);
    });

    document.getElementById("modalDetalle").addEventListener("shown.bs.modal", () => MEUI.ajustarTablas());

    configurarArchivo();
    render();
}
inicializarConsumos();
