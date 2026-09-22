/* =====================================================================
   logica-ajustes.js · Reporte de ajustes y paquetes del CM
   ---------------------------------------------------------------------
   Solo lo propio de ESTA herramienta: la consulta de ajustes, los
   catálogos editables (motivo / tipo / categoría), el cálculo de montos y
   las columnas de las dos tablas.

   Lo compartido NO está aquí:
     · marco visual, tablas, registro, exportación → me-ui.js
     · Keycloak, auth y GET autenticado            → me-api.js
     · enganche con el shell                       → me-ajustes-puente.js
===================================================================== */
"use strict";

MEAPI.configurar({ locale: "en" });

const auth = MEAPI.auth;
const apiGet = ruta => MEAPI.getJson(ruta);   // ruta relativa: antepone el apiBase

const $ = s => document.querySelector(s);
const log = (msg, cls) => MEUI.log(msg, cls === "e" ? "err" : cls === "w" ? "warn" : cls === "s" ? "ok" : "info");
const esc = MEUI.esc;

/* =====================================================================
   1 · CATÁLOGOS
   Traducen los códigos que devuelve el CM. Son editables desde la página
   y se guardan en este navegador; si un código no está, se muestra como
   «Sin catalogar» en vez de dejar el número suelto.
===================================================================== */
const DEFAULT_MAPS = {
    reason: {
        "3": "Error en recarga / cargue",
        "4": "Consumo por demanda",
        "7": "Error al comprar paquete",
        "9": "Error en recarga de saldo",
        "10": "Recarga no aplicada",
        "12": "Saldo vencido",
        "17": "Consumos inconsistentes",
        "21": "Reposición de línea",
        "22": "Reposición",
        "24": "Doble activación de paquete"
    },
    type: {
        "21000": "Crédito ajuste contact center *999",
        "25000": "Débito ajuste contact center *999",
        "50030": "Ajuste (Crédito)",
        "50031": "Ajuste (Débito)"
    },
    category: { "20000": "Exito Adjustments" }
};
let MAPS = structuredClone(DEFAULT_MAPS);

/* =====================================================================
   2 · UTILIDADES DE FORMATO
===================================================================== */
const TZ = "America/Bogota";
const fmtCOP = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtUnit = new Intl.NumberFormat("es-CO");

function dateOnly(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const p = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g("day")}/${g("month")}/${g("year")}`;
}
function dateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const p = new Intl.DateTimeFormat("es-CO", {
        timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}
function approvalDate(row) {
    const h = Array.isArray(row.history) ? row.history : [];
    const find = st => h.find(x => (x.status || "").toLowerCase() === st);
    const ev = find("approved") || find("completed");
    return ev ? ev.updateTimeStamp : "";
}
const activity = row => Number(row.action) === 1 ? "Decremento" : "Incremento";
const approvedFlag = row => row.approvedBy ? "SI" : "NO";

function accountFromSub(row) {
    const sub = row.subscriptionId || "";
    return sub.includes("-") ? sub.split("-")[0] : (row.accountId || "");
}
function reasonText(row) {
    const code = row.reasonCode != null ? String(row.reasonCode) : "";
    const desc = code ? (MAPS.reason[code] || "Código sin catalogar") : "";
    const notes = (row.notes || "").replace(/\s+/g, " ").trim();
    return [code ? `${code} · ${desc}` : "", notes].filter(Boolean).join(" — ");
}
// El API entrega los montos multiplicados por 10.000
const money = row => Number(row?.value?.amount ?? 0) / 10000;

/* =====================================================================
   3 · CONSULTA
===================================================================== */
function parseAdjustment(row) {
    const typeCode = row.type != null ? String(row.type) : "";
    const categoryCode = row.category != null ? String(row.category) : "";
    const reasonCode = row.reasonCode != null ? String(row.reasonCode) : "";
    return Object.assign({}, row, {
        _typeCode: typeCode,
        _categoryCode: categoryCode,
        _reasonCode: reasonCode,
        _typeDescription: MAPS.type[typeCode] || row.typeDescription || "Sin catalogar",
        _categoryDescription: MAPS.category[categoryCode] || row.categoryDescription || "Sin catalogar",
        _reasonDescription: MAPS.reason[reasonCode] || "Código sin catalogar",
        _reasonText: reasonText(row),
        _activity: activity(row),
        _approved: approvedFlag(row),
        _accountID: accountFromSub(row),
        _money: money(row),
        _approvalDate: approvalDate(row)
    });
}

async function fetchAdjustments(isBundle) {
    const limit = Math.min(100, Math.max(1, +$("#limit").value || 100));
    const maxPages = $("#pageMode").value === "one" ? 1 : Math.max(1, +$("#maxPages").value || 1);
    let offset = Math.max(1, +$("#offset").value || 1);

    let fromDate = $("#fromDate").value;
    let toDate = $("#toDate").value;
    if (fromDate && !toDate) toDate = new Date().toISOString().split("T")[0];

    const statusId = $("#statusId").value.trim();
    const params = new URLSearchParams();
    if (fromDate) params.set("from", `${fromDate}T00:00:00:000`);
    if (toDate) params.set("to", `${toDate}T23:59:59:999`);
    if (statusId) params.set("statusId", statusId);
    params.set("bundleAdjustment", String(isBundle));
    params.set("limit", String(limit));

    const out = [];
    for (let page = 0; page < maxPages; page++) {
        params.set("offset", String(offset));
        const ruta = `/api/v1/subscription/adjustment?${params.toString()}`;
        log(`GET ${ruta}`);
        const rows = (await apiGet(ruta) || []).map(parseAdjustment);
        out.push(...rows);
        log(`  ↳ ${rows.length} registros (acumulado ${out.length})`);
        if (rows.length < limit) break;   // página corta: no hay más
        offset += limit;
    }
    return out;
}

/* ---------- Número de la línea a partir de la cuenta ---------- */
const msisdnCache = new Map();
const MSISDN_KEYS = ["mobileNumber", "msisdn", "MSISDN", "phoneNumber", "primaryMsisdn", "subscriberNumber", "number"];

function digMsisdn(obj, depth = 0) {
    if (obj == null || depth > 6) return "";
    if (Array.isArray(obj)) { for (const it of obj) { const v = digMsisdn(it, depth + 1); if (v) return v; } return ""; }
    if (typeof obj !== "object") return "";
    for (const k of MSISDN_KEYS) {
        const v = obj[k];
        if (typeof v === "string" && /^\d{7,15}$/.test(v)) return v;
        if (typeof v === "number" && String(v).length >= 7) return String(v);
    }
    for (const v of Object.values(obj)) { const found = digMsisdn(v, depth + 1); if (found) return found; }
    return "";
}

async function resolveMsisdn(accountID) {
    if (!accountID) return "";
    if (msisdnCache.has(accountID)) return msisdnCache.get(accountID);
    try {
        const num = digMsisdn(await apiGet(`/api/v1/subscription?accountID=${encodeURIComponent(accountID)}&recurse=true`));
        msisdnCache.set(accountID, num);
        return num;
    } catch (e) {
        log(`Sin número para ${accountID}: ${e.message}`, "w");
        msisdnCache.set(accountID, "");
        return "";
    }
}

/* ---------- Cédula del titular a partir de la cadena de cuentas ----------
   Es el mismo criterio robusto de Consumos/Rechazos, ampliado con los dos
   respaldos confirmados por la colección de Postman: `account.id` puede ser
   el individualID y `individual.fullName` puede traer el nombre consolidado.
   Aquí solo se necesita el documento para tabla/exportación/copia rápida. */
const titularCache = new Map();

function candidatosCuenta(accountID) {
    const s = String(accountID || "").trim();
    return [...new Set([s.split("-")[0], s].filter(Boolean))];
}

async function buscarCuenta(externalID) {
    const norm = r => Array.isArray(r) ? r : (r?.billingAccounts || r?.results || []);
    let lista = norm(await apiGet(`/api/v1/billingAccount?externalID=${encodeURIComponent(externalID)}&offset=0&limit=1`).catch(() => null));
    if (lista.length) return lista[0];
    const filtro = [
        String(externalID), `id=${externalID}`,
        `contact.contactMedium.characteristic.emailAddress=${externalID}`,
        `contact.contactMedium.characteristic.phoneNumber=${externalID}`,
        "includeEmail=true"
    ].join("%3B");
    lista = norm(await apiGet(`/api/v1/billingAccount?externalID=${filtro}&offset=0&limit=10`).catch(() => null));
    if (lista.length) return lista[0];
    const porId = await apiGet(`/api/v1/billingAccount/${encodeURIComponent(externalID)}`).catch(() => null);
    if (porId && (porId.id || porId["@type"] === "BillingAccount")) return porId;
    return Array.isArray(porId) ? porId[0] || null : null;
}

async function resolveTitular(accountID) {
    const clave = String(accountID || "").trim();
    if (!clave) return { identificacion: "", tipoId: "", nombre: "" };
    if (titularCache.has(clave)) return titularCache.get(clave);

    const pendientes = candidatosCuenta(clave);
    const vistos = new Set();
    let saltos = 0;
    while (pendientes.length && saltos <= 5) {
        const ext = pendientes.shift();
        if (vistos.has(ext)) continue;
        vistos.add(ext);
        const cuenta = await buscarCuenta(ext);
        if (!cuenta) continue;

        const rel = cuenta.relatedParty || [];
        const refInd = rel.find(p => p["@referredType"] === "Individual" || /individual\//.test(p.href || ""));
        const individualID = refInd?.id || cuenta.id;
        const individual = individualID
            ? await apiGet(`/api/v1/individual/${encodeURIComponent(individualID)}`).catch(() => null)
            : null;
        const ident = (individual?.individualIdentification || [])
            .find(x => x.identificationId && String(x.identificationId).trim());
        if (ident) {
            const resultado = {
                identificacion: String(ident.identificationId).trim(),
                tipoId: String(ident.identificationType || ""),
                nombre: String(individual.fullName
                    || [individual.givenName, individual.familyName].filter(Boolean).join(" ")
                    || "").replace(/\s+/g, " ").trim()
            };
            titularCache.set(clave, resultado);
            return resultado;
        }

        if (cuenta.parentId) { pendientes.push(String(cuenta.parentId)); saltos++; }
        (cuenta.accountRelationship || []).forEach(r => {
            const otro = r?.account?.id ?? r?.account?.name ?? r?.id;
            if (otro && !vistos.has(String(otro))) { pendientes.push(String(otro)); saltos++; }
        });
    }
    const vacio = { identificacion: "", tipoId: "", nombre: "" };
    titularCache.set(clave, vacio);
    return vacio;
}

async function resolveAll(rows, concurrency = 5) {
    const ids = [...new Set(rows.map(accountFromSub).filter(Boolean))];
    log(`Consultando ${ids.length} cuentas para obtener número y CC…`);
    let i = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
        while (i < ids.length) {
            const id = ids[i++];
            await Promise.all([resolveMsisdn(id), resolveTitular(id)]);
            if (++done % 25 === 0) log(`  ↳ ${done}/${ids.length}`);
        }
    }));
    rows.forEach(r => {
        const titular = titularCache.get(accountFromSub(r));
        r._identificacion = titular?.identificacion || "";
        r._tipoId = titular?.tipoId || "";
        r._titular = titular?.nombre || "";
    });
    log("Números y documentos resueltos.", "s");
}

/* =====================================================================
   4 · COLUMNAS
===================================================================== */
const MONEY_COLS = [
    { h: "Número", k: r => r.mobileNumber || msisdnCache.get(accountFromSub(r)) || "", cls: "me-mono" },
    { h: "CC", k: r => r._identificacion || titularCache.get(accountFromSub(r))?.identificacion || "", cls: "me-mono", copiar: true },
    { h: "accountID", k: r => accountFromSub(r), cls: "me-mono" },
    { h: "Nombre del ajuste", k: r => (r.name || "").trim() },
    { h: "Tipo (descripción)", k: r => r.typeDescription || "" },
    { h: "Monto (COP)", k: r => money(r), num: true, fmt: v => fmtCOP.format(v) },
    { h: "Fecha creación", k: r => dateOnly(r.createdTimestamp) },
    { h: "Estado", k: r => r.status || "", tag: v => v === "Completed" ? "ok" : (v === "Failed" ? "bad" : "mid") },
    { h: "Creado por", k: r => r.createdBy || "" },
    { h: "Aprobado por", k: r => r.approvedBy || "" },
    { h: "¿Aprobado?", k: r => approvedFlag(r), tag: v => v === "SI" ? "ok" : "bad" },
    { h: "Tipo (código)", k: r => r.type ?? "", cls: "me-mono" },
    { h: "Tipo (mapeo)", k: r => r._typeDescription || "Sin catalogar" },
    { h: "Categoría (código)", k: r => r.category ?? "", cls: "me-mono" },
    { h: "Categoría (mapeo)", k: r => r._categoryDescription || "Sin catalogar" },
    { h: "subscriptionId", k: r => r.subscriptionId || "", cls: "me-mono" },
    { h: "Fecha aprobación", k: r => dateTime(approvalDate(r)) },
    { h: "Motivo del ajuste", k: r => reasonText(r), larga: true },
    { h: "Actividad", k: r => activity(r), tag: v => v === "Incremento" ? "up" : "down" },
    { h: "adjustmentId", k: r => r.adjustmentId || "", cls: "me-mono" },
    { h: "transactionId", k: r => r.transactionId || "", cls: "me-mono" }
];

const BUNDLE_COLS = [
    { h: "Número", k: r => msisdnCache.get(accountFromSub(r)) || "", cls: "me-mono" },
    { h: "CC", k: r => r._identificacion || titularCache.get(accountFromSub(r))?.identificacion || "", cls: "me-mono", copiar: true },
    { h: "accountID", k: r => accountFromSub(r), cls: "me-mono" },
    { h: "Monto", k: r => Number(r?.value?.amount ?? 0), num: true, fmt: v => fmtUnit.format(v) },
    { h: "Unidad (typeDescription)", k: r => r.typeDescription || "" },
    { h: "Actividad", k: r => activity(r), tag: v => v === "Incremento" ? "up" : "down" },
    { h: "Fecha creación", k: r => dateOnly(r.createdTimestamp) },
    { h: "Estado", k: r => r.status || "", tag: v => v === "Completed" ? "ok" : (v === "Failed" ? "bad" : "mid") },
    { h: "Creado por", k: r => r.createdBy || "" },
    { h: "Aprobado por", k: r => r.approvedBy || "" },
    { h: "¿Aprobado?", k: r => approvedFlag(r), tag: v => v === "SI" ? "ok" : "bad" },
    { h: "Nombre del paquete", k: r => (r.name || "").trim(), larga: true },
    { h: "subscriptionId", k: r => r.subscriptionId || "", cls: "me-mono" },
    { h: "Subtipo", k: r => r.subTypeDescription || r.subType || "" },
    { h: "Fecha activación", k: r => dateOnly(r?.value?.activationDate) },
    { h: "Fecha aprobación", k: r => dateTime(approvalDate(r)) },
    { h: "adjustmentId", k: r => r.adjustmentId || "", cls: "me-mono" }
];

const STATE = {
    money: { raw: [], cols: MONEY_COLS, tabla: null, el: "#tblMoney", vacio: "#msgVacioMoney", file: "ajustes_dinero", hoja: "Ajustes dinero" },
    bundle: { raw: [], cols: BUNDLE_COLS, tabla: null, el: "#tblBundle", vacio: "#msgVacioBundle", file: "ajustes_paquetes", hoja: "Paquetes" }
};
let current = "money";

const cellValue = (col, row) => col.k(row);
const cellText = (col, row) => {
    const v = cellValue(col, row);
    return col.fmt ? col.fmt(v) : String(v ?? "");
};

function render(view) {
    const st = STATE[view];
    if (st.tabla) { st.tabla.destroy(); st.tabla = null; }
    const tabla = document.querySelector(st.el);
    tabla.innerHTML = "";
    MEUI.prepararTabla(st.el);

    if (st.raw.length) {
        st.tabla = MEUI.tabla(st.el, {
            data: st.raw,
            pageLength: 25,
            lengthMenu: [10, 25, 50, 100, 250],
            columns: st.cols.map(col => ({
                title: col.h,
                data: null,
                className: (col.num ? "num me-mono " : "") + (col.cls || "") + (col.larga ? " me-col-larga" : ""),
                render: (data, type, row) => {
                    const value = cellValue(col, row);
                    if (type === "sort" || type === "type") return value ?? "";   // crudo, para ordenar bien
                    const text = esc(col.fmt ? col.fmt(value) : String(value ?? ""));
                    if (col.copiar && value) return `${text} <button type="button" class="btn-copy" data-copy-text="${esc(String(value))}" title="Copiar CC">⧉</button>`;
                    return col.tag ? `<span class="tag ${col.tag(value)}">${text}</span>` : text;
                }
            })),
            language: Object.assign({}, MEUI.idiomaTabla, {
                lengthMenu: "Mostrar _MENU_ registros",
                info: "Mostrando _START_–_END_ de _TOTAL_ registros",
                infoEmpty: "Sin registros"
            })
        });
    }
    MEUI.mostrarSiHayDatos(st.el, { vacio: st.vacio, tabla: st.tabla });
    actualizarResumen();
}

function actualizarResumen() {
    $("#cMoney").textContent = STATE.money.raw.length;
    $("#cBundle").textContent = STATE.bundle.raw.length;
    const suma = STATE.money.raw.reduce((s, r) => s + money(r), 0);
    $("#sumaCop").textContent = "$" + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(suma);
}

/* =====================================================================
   5 · EXPORTACIÓN
===================================================================== */
function matriz(view) {
    const st = STATE[view];
    return {
        cabecera: st.cols.map(c => c.h),
        // Los numéricos van crudos para que Excel los pueda sumar
        filas: st.raw.map(r => st.cols.map(c => c.num ? cellValue(c, r) : cellText(c, r)))
    };
}

$("#btnCsv").addEventListener("click", () => {
    const st = STATE[current];
    if (!st.raw.length) { MEUI.toast("No hay registros para exportar.", "warn"); return; }
    const m = matriz(current);
    MEUI.exportarCSV(m.cabecera, m.filas, st.file);
});

$("#btnXlsx").addEventListener("click", () => {
    const st = STATE[current];
    if (!st.raw.length) { MEUI.toast("No hay registros para exportar.", "warn"); return; }
    const m = matriz(current);
    const formato = current === "money" ? "#,##0.0000" : "#,##0";
    const numFmt = {};
    st.cols.forEach((c, i) => { if (c.num) numFmt[i] = formato; });
    MEUI.exportarXLSX(m.cabecera, m.filas, st.file, st.hoja, { numFmt });
});

$("#btnJson").addEventListener("click", () => {
    const st = STATE[current];
    if (!st.raw.length) { MEUI.toast("No hay registros para exportar.", "warn"); return; }
    MEUI.exportarJSON(st.raw, st.file);
});

/* =====================================================================
   6 · DESCARGAS
===================================================================== */
$("#btnMoney").addEventListener("click", async () => {
    await MEUI.conSpinner($("#btnMoney"), "Descargando…", async () => {
        try {
            STATE.money.raw = await fetchAdjustments(false);
            if ($("#resolveMsisdn").checked) await resolveAll(STATE.money.raw);
            render("money");
            mostrarPestana("money");
            log(`Ajustes de dinero listos: ${STATE.money.raw.length}.`, "s");
            MEUI.toast(STATE.money.raw.length + " ajustes de dinero.", "ok");
        } catch (e) { log(e.message, "e"); MEUI.toast("La descarga falló. Mira el registro.", "err"); }
    });
});

$("#btnBundle").addEventListener("click", async () => {
    await MEUI.conSpinner($("#btnBundle"), "Descargando…", async () => {
        try {
            STATE.bundle.raw = await fetchAdjustments(true);
            if ($("#resolveMsisdn").checked) await resolveAll(STATE.bundle.raw);
            render("bundle");
            mostrarPestana("bundle");
            log(`Paquetes listos: ${STATE.bundle.raw.length}.`, "s");
            MEUI.toast(STATE.bundle.raw.length + " paquetes.", "ok");
        } catch (e) { log(e.message, "e"); MEUI.toast("La descarga falló. Mira el registro.", "err"); }
    });
});

function mostrarPestana(view) {
    const btn = document.querySelector(`[data-bs-target="#pane${view === "money" ? "Money" : "Bundle"}"]`);
    if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    current = view;
}

document.addEventListener("shown.bs.tab", ev => {
    const destino = ev.target.getAttribute("data-bs-target");
    if (destino === "#paneMoney") current = "money";
    if (destino === "#paneBundle") current = "bundle";
});

/* =====================================================================
   7 · EDITOR DE CATÁLOGOS
===================================================================== */
function renderCatalogEditor(key) {
    const cont = document.getElementById("editor" + key.charAt(0).toUpperCase() + key.slice(1));
    if (!cont) return;
    cont.innerHTML = "";
    for (const [code, desc] of Object.entries(MAPS[key])) {
        const fila = document.createElement("div");
        fila.className = "d-flex gap-1 mb-1 align-items-center";

        const inputCode = document.createElement("input");
        inputCode.type = "text";
        inputCode.className = "form-control form-control-sm me-mono";
        inputCode.value = code;
        inputCode.dataset.code = key;
        inputCode.style.width = "84px";
        inputCode.placeholder = "Código";

        const inputDesc = document.createElement("input");
        inputDesc.type = "text";
        inputDesc.className = "form-control form-control-sm";
        inputDesc.value = desc;
        inputDesc.dataset.desc = key;
        inputDesc.placeholder = "Descripción";

        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "btn btn-sm btn-outline-danger";
        btnDel.innerHTML = "&times;";
        btnDel.onclick = () => { delete MAPS[key][code]; renderCatalogEditor(key); };

        fila.append(inputCode, inputDesc, btnDel);
        cont.appendChild(fila);
    }
}

window.addCatalogRow = function (key) {
    MAPS[key][""] = "";
    renderCatalogEditor(key);
};

$("#btnApplyMaps").addEventListener("click", () => {
    try {
        ["reason", "type", "category"].forEach(key => {
            const cont = document.getElementById("editor" + key.charAt(0).toUpperCase() + key.slice(1));
            const nuevo = {};
            cont.querySelectorAll("div.d-flex").forEach(fila => {
                const code = fila.querySelector(`input[data-code="${key}"]`);
                const desc = fila.querySelector(`input[data-desc="${key}"]`);
                if (code && desc && code.value.trim()) nuevo[code.value.trim()] = desc.value.trim();
            });
            MAPS[key] = nuevo;
        });
        try { localStorage.setItem("cmMaps", JSON.stringify(MAPS)); } catch (e) { }
        // Los datos ya descargados se vuelven a interpretar con el catálogo nuevo
        STATE.money.raw = STATE.money.raw.map(parseAdjustment);
        STATE.bundle.raw = STATE.bundle.raw.map(parseAdjustment);
        render("money"); render("bundle");
        log("Catálogos actualizados y guardados en este navegador.", "s");
        MEUI.toast("Catálogos guardados.", "ok");
    } catch (e) { log("Error al guardar catálogos: " + e.message, "e"); }
});

$("#btnResetMaps").addEventListener("click", () => {
    MAPS = structuredClone(DEFAULT_MAPS);
    try { localStorage.removeItem("cmMaps"); } catch (e) { }
    ["reason", "type", "category"].forEach(renderCatalogEditor);
    log("Catálogos vueltos a los valores de fábrica.", "w");
});

/* =====================================================================
   8 · ARRANQUE
===================================================================== */
try {
    const guardado = localStorage.getItem("cmMaps");
    if (guardado) MAPS = JSON.parse(guardado);
} catch (e) { }

["reason", "type", "category"].forEach(renderCatalogEditor);
render("money");
render("bundle");
