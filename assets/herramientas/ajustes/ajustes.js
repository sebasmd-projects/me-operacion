/* =====================================================================
   ajustes.js · Reporte de ajustes y paquetes del CM
   ---------------------------------------------------------------------
   Un solo archivo por herramienta, en tres bloques:

     1 · Configuración y constantes   (todo lo ajustable, arriba)
     2 · Reglas de negocio            (consulta, cuentas, montos, columnas)
     3 · Interfaz                     (tablas, exportación, eventos, MEUI)

   Lo compartido NO está aquí:
     · marco visual, tablas, registro, exportación → assets/base/me-ui.js
     · Keycloak, auth y GET autenticado            → assets/base/me-api.js

   Todo va dentro de una IIFE: lo único global es addCatalogRow, que el
   HTML invoca desde sus onclick.
===================================================================== */
(function () {
    "use strict";

    /* =================================================================
       1 · CONFIGURACIÓN Y CONSTANTES
    ================================================================= */
    MEAPI.configurar({ locale: "en" });

    const auth = MEAPI.auth;
    const apiGet = ruta => MEAPI.getJson(ruta);   // ruta relativa: antepone el apiBase

    const TZ = "America/Bogota";
    const fmtCOP = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const fmtUnit = new Intl.NumberFormat("es-CO");

    // El API entrega los montos multiplicados por 10.000
    const FACTOR_MONTO = 10000;

    // Consulta: límites del API y de la descarga
    const LIMITE_MAXIMO = 100;          // registros por página que admite el API
    const CUENTAS_EN_PARALELO = 5;      // cuentas que se resuelven a la vez
    const SALTOS_MAXIMOS_TITULAR = 5;   // cuentas padre/relacionadas que se recorren buscando la CC

    // Claves donde un objeto de la suscripción puede traer el número de la línea
    const MSISDN_KEYS = ["mobileNumber", "msisdn", "MSISDN", "phoneNumber", "primaryMsisdn", "subscriberNumber", "number"];

    // Tablas: paginación y clave del navegador donde se guardan los catálogos
    const FILAS_POR_PAGINA = 25;
    const OPCIONES_FILAS = [10, 25, 50, 100, 250];
    const CLAVE_CATALOGOS = "cmMaps";

    // Catálogos editables: clave → id del contenedor del editor en el HTML
    const CATALOGOS_CLAVES = ["reason", "type", "category"];
    const idEditor = key => "editor" + key.charAt(0).toUpperCase() + key.slice(1);

    /* Catálogos de fábrica. Traducen los códigos que devuelve el CM. Son
       editables desde la página y se guardan en este navegador; si un
       código no está, se muestra como «Sin catalogar» en vez de dejar el
       número suelto. */
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

    const $ = s => document.querySelector(s);
    const el = id => document.getElementById(id);
    const log = (msg, cls) => MEUI.log(msg, cls === "e" ? "err" : cls === "w" ? "warn" : cls === "s" ? "ok" : "info");
    const esc = MEUI.esc;

    /* =================================================================
       2 · REGLAS DE NEGOCIO
       2.1 Formato y datos derivados del ajuste
    ================================================================= */
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
    const money = row => Number(row?.value?.amount ?? 0) / FACTOR_MONTO;

    /* -----------------------------------------------------------------
       2.2 Consulta de ajustes
    ----------------------------------------------------------------- */
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
        const limit = Math.min(LIMITE_MAXIMO, Math.max(1, +$("#limit").value || LIMITE_MAXIMO));
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

        MEUI.progreso.iniciar(maxPages, "Consultar páginas de ajustes");
        const out = [];
        for (let page = 0; page < maxPages; page++) {
            params.set("offset", String(offset));
            const ruta = `/api/v1/subscription/adjustment?${params.toString()}`;
            log(`GET ${ruta}`);
            const rows = (await apiGet(ruta) || []).map(parseAdjustment);
            out.push(...rows);
            MEUI.progreso.avanzar(page + 1);
            log(`  ↳ ${rows.length} registros (acumulado ${out.length})`);
            if (rows.length < limit) break;   // página corta: no hay más
            offset += limit;
        }
        return out;
    }

    /* -----------------------------------------------------------------
       2.3 Número de la línea y titular a partir de la cuenta
    ----------------------------------------------------------------- */
    const msisdnCache = new Map();

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
        while (pendientes.length && saltos <= SALTOS_MAXIMOS_TITULAR) {
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

    async function resolveAll(rows, concurrency = CUENTAS_EN_PARALELO) {
        const ids = [...new Set(rows.map(accountFromSub).filter(Boolean))];
        log(`Consultando ${ids.length} cuentas para obtener número y CC…`);
        MEUI.progreso.iniciar(ids.length, "Resolver cuentas");
        let i = 0, done = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
            while (i < ids.length) {
                const id = ids[i++];
                await Promise.all([resolveMsisdn(id), resolveTitular(id)]);
                MEUI.progreso.avanzar(done + 1);
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

    /* -----------------------------------------------------------------
       2.4 Columnas de las tablas
       Una sola definición por columna: de aquí salen la tabla en pantalla
       y la exportación (CSV / Excel). Las columnas comunes a dinero y
       paquetes se declaran una vez y se reutilizan.
         h      encabezado            k       valor de la fila
         num    numérica (se exporta cruda)   fmt   formato de pantalla
         tag    clase de la etiqueta de color  cls   clases de la celda
         larga  columna de texto largo         copiar  botón de copiar
    ----------------------------------------------------------------- */
    const tagEstado = v => v === "Completed" ? "ok" : (v === "Failed" ? "bad" : "mid");
    const tagSiNo = v => v === "SI" ? "ok" : "bad";
    const tagActividad = v => v === "Incremento" ? "up" : "down";

    const COL = {
        cc: { h: "CC", k: r => r._identificacion || titularCache.get(accountFromSub(r))?.identificacion || "", cls: "me-mono", copiar: true },
        accountID: { h: "accountID", k: r => accountFromSub(r), cls: "me-mono" },
        actividad: { h: "Actividad", k: r => activity(r), tag: tagActividad },
        fechaCreacion: { h: "Fecha creación", k: r => dateOnly(r.createdTimestamp) },
        estado: { h: "Estado", k: r => r.status || "", tag: tagEstado },
        creadoPor: { h: "Creado por", k: r => r.createdBy || "" },
        aprobadoPor: { h: "Aprobado por", k: r => r.approvedBy || "" },
        aprobado: { h: "¿Aprobado?", k: r => approvedFlag(r), tag: tagSiNo },
        subscriptionId: { h: "subscriptionId", k: r => r.subscriptionId || "", cls: "me-mono" },
        fechaAprobacion: { h: "Fecha aprobación", k: r => dateTime(approvalDate(r)) },
        adjustmentId: { h: "adjustmentId", k: r => r.adjustmentId || "", cls: "me-mono" }
    };

    const MONEY_COLS = [
        { h: "Número", k: r => r.mobileNumber || msisdnCache.get(accountFromSub(r)) || "", cls: "me-mono" },
        COL.cc,
        COL.accountID,
        { h: "Nombre del ajuste", k: r => (r.name || "").trim() },
        { h: "Tipo (descripción)", k: r => r.typeDescription || "" },
        { h: "Monto (COP)", k: r => money(r), num: true, fmt: v => fmtCOP.format(v) },
        COL.fechaCreacion,
        COL.estado,
        COL.creadoPor,
        COL.aprobadoPor,
        COL.aprobado,
        { h: "Tipo (código)", k: r => r.type ?? "", cls: "me-mono" },
        { h: "Tipo (mapeo)", k: r => r._typeDescription || "Sin catalogar" },
        { h: "Categoría (código)", k: r => r.category ?? "", cls: "me-mono" },
        { h: "Categoría (mapeo)", k: r => r._categoryDescription || "Sin catalogar" },
        COL.subscriptionId,
        COL.fechaAprobacion,
        { h: "Motivo del ajuste", k: r => reasonText(r), larga: true },
        COL.actividad,
        COL.adjustmentId,
        { h: "transactionId", k: r => r.transactionId || "", cls: "me-mono" }
    ];

    const BUNDLE_COLS = [
        { h: "Número", k: r => msisdnCache.get(accountFromSub(r)) || "", cls: "me-mono" },
        COL.cc,
        COL.accountID,
        { h: "Monto", k: r => Number(r?.value?.amount ?? 0), num: true, fmt: v => fmtUnit.format(v) },
        { h: "Unidad (typeDescription)", k: r => r.typeDescription || "" },
        COL.actividad,
        COL.fechaCreacion,
        COL.estado,
        COL.creadoPor,
        COL.aprobadoPor,
        COL.aprobado,
        { h: "Nombre del paquete", k: r => (r.name || "").trim(), larga: true },
        COL.subscriptionId,
        { h: "Subtipo", k: r => r.subTypeDescription || r.subType || "" },
        { h: "Fecha activación", k: r => dateOnly(r?.value?.activationDate) },
        COL.fechaAprobacion,
        COL.adjustmentId
    ];

    /* =================================================================
       3 · INTERFAZ
       3.1 Estado de las dos vistas (pestañas) y tablas
    ================================================================= */
    const VISTAS = {
        money: {
            raw: [], cols: MONEY_COLS, tabla: null, el: "#tblMoney", vacio: "#msgVacioMoney",
            panel: "#paneMoney", boton: "#btnMoney", esPaquete: false,
            file: "ajustes_dinero", hoja: "Ajustes dinero", formatoNum: "#,##0.0000",
            textoListo: n => n + " ajustes de dinero.", logListo: n => `Ajustes de dinero listos: ${n}.`
        },
        bundle: {
            raw: [], cols: BUNDLE_COLS, tabla: null, el: "#tblBundle", vacio: "#msgVacioBundle",
            panel: "#paneBundle", boton: "#btnBundle", esPaquete: true,
            file: "ajustes_paquetes", hoja: "Paquetes", formatoNum: "#,##0",
            textoListo: n => n + " paquetes.", logListo: n => `Paquetes listos: ${n}.`
        }
    };
    let current = "money";

    const cellValue = (col, row) => col.k(row);
    const cellText = (col, row) => {
        const v = cellValue(col, row);
        return col.fmt ? col.fmt(v) : String(v ?? "");
    };

    function render(view) {
        const st = VISTAS[view];
        if (st.tabla) { st.tabla.destroy(); st.tabla = null; }
        const tabla = document.querySelector(st.el);
        tabla.innerHTML = "";
        MEUI.prepararTabla(st.el);

        if (st.raw.length) {
            st.tabla = MEUI.tabla(st.el, {
                data: st.raw,
                pageLength: FILAS_POR_PAGINA,
                lengthMenu: OPCIONES_FILAS,
                columns: st.cols.map(col => ({
                    title: col.h,
                    data: null,
                    className: (col.num ? "num me-mono " : "") + (col.cls || "") + (col.larga ? " me-col-larga" : ""),
                    render: (data, type, row) => {
                        const value = cellValue(col, row);
                        if (type === "sort" || type === "type") return value ?? "";   // crudo, para ordenar bien
                        const text = esc(col.fmt ? col.fmt(value) : String(value ?? ""));
                        if (col.copiar && value) return MEUI.copiable(value, "CC");
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
        MEUI.estadoTabla(st.el, st.raw.length ? "listo" : "vacio");
        document.querySelector(st.vacio).hidden = true;
        actualizarResumen();
    }

    function actualizarResumen() {
        $("#cMoney").textContent = VISTAS.money.raw.length;
        $("#cBundle").textContent = VISTAS.bundle.raw.length;
        const suma = VISTAS.money.raw.reduce((s, r) => s + money(r), 0);
        $("#sumaCop").textContent = "$" + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(suma);
    }


    /* -----------------------------------------------------------------
       3.2 Exportación de la pestaña visible
    ----------------------------------------------------------------- */
    function matriz(view) {
        const st = VISTAS[view];
        return {
            cabecera: st.cols.map(c => c.h),
            // Los numéricos van crudos para que Excel los pueda sumar
            filas: st.raw.map(r => st.cols.map(c => c.num ? cellValue(c, r) : cellText(c, r)))
        };
    }

    // Ejecuta la exportación solo si la pestaña actual tiene registros
    function exportarVistaActual(exportar) {
        const st = VISTAS[current];
        if (!st.raw.length) { MEUI.toast("No hay registros para exportar.", "warn"); return; }
        exportar(st);
    }

    $("#btnCsv").addEventListener("click", () => exportarVistaActual(st => {
        const m = matriz(current);
        MEUI.exportarCSV(m.cabecera, m.filas, st.file);
    }));

    $("#btnXlsx").addEventListener("click", () => exportarVistaActual(st => {
        const m = matriz(current);
        const numFmt = {};
        st.cols.forEach((c, i) => { if (c.num) numFmt[i] = st.formatoNum; });
        MEUI.exportarXLSX(m.cabecera, m.filas, st.file, st.hoja, { numFmt });
    }));

    $("#btnJson").addEventListener("click", () => exportarVistaActual(st =>
        MEUI.exportarJSON(st.raw, st.file)));

    /* -----------------------------------------------------------------
       3.3 Descargas y pestañas
    ----------------------------------------------------------------- */
    function descargar(view) {
        const st = VISTAS[view];
        return MEUI.conSpinner($(st.boton), "Descargando…", async () => {
            try {
                MEUI.estadoTabla(st.el, "cargando");
                st.raw = await fetchAdjustments(st.esPaquete);
                if ($("#resolveMsisdn").checked) await resolveAll(st.raw);
                render(view);
                mostrarPestana(view);
                MEUI.progreso.fin({ fallidas: 0, mensaje: "Descarga completada" });
                log(st.logListo(st.raw.length), "s");
                MEUI.toast(st.textoListo(st.raw.length), "ok");
            } catch (e) {
                MEUI.progreso.fin({ fallidas: 1 });
                MEUI.estadoTabla(st.el, "error", { reintentar: () => $(st.boton).click() });
                log(e.message, "e"); MEUI.toast("La descarga falló. Mira el registro.", "err");
            }
        });
    }

    Object.keys(VISTAS).forEach(view =>
        $(VISTAS[view].boton).addEventListener("click", () => descargar(view)));

    function mostrarPestana(view) {
        const btn = document.querySelector(`[data-bs-target="${VISTAS[view].panel}"]`);
        if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
        current = view;
    }

    // Al cambiar de pestaña: se exporta esa vista y su tabla se reajusta
    document.addEventListener("shown.bs.tab", ev => {
        const destino = ev.target.getAttribute("data-bs-target");
        const view = Object.keys(VISTAS).find(v => VISTAS[v].panel === destino);
        if (view) {
            current = view;
            MEUI.prepararTabla(VISTAS[view].el);
        }
        setTimeout(MEUI.ajustarTablas, 60);
    });

    /* -----------------------------------------------------------------
       3.4 Editor de catálogos
    ----------------------------------------------------------------- */
    function renderCatalogEditor(key) {
        const cont = el(idEditor(key));
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
            btnDel.setAttribute("aria-label", "Eliminar código " + code);
            btnDel.onclick = () => { delete MAPS[key][code]; renderCatalogEditor(key); };

            const indice = cont.children.length;
            inputCode.id = `catalogo-${key}-${indice}-codigo`;
            inputDesc.id = `catalogo-${key}-${indice}-descripcion`;
            const etiquetas = [inputCode, inputDesc].map((input, i) => {
                const label = document.createElement("label");
                label.htmlFor = input.id; label.className = "visually-hidden";
                label.textContent = i ? "Descripción" : "Código";
                return label;
            });
            fila.append(etiquetas[0], inputCode, etiquetas[1], inputDesc, btnDel);
            cont.appendChild(fila);
        }
    }

    // Lo invoca el HTML desde los botones «+ Agregar …»
    window.addCatalogRow = function (key) {
        MAPS[key][""] = "";
        renderCatalogEditor(key);
    };

    $("#btnApplyMaps").addEventListener("click", () => {
        try {
            CATALOGOS_CLAVES.forEach(key => {
                const cont = el(idEditor(key));
                const nuevo = {};
                cont.querySelectorAll("div.d-flex").forEach(fila => {
                    const code = fila.querySelector(`input[data-code="${key}"]`);
                    const desc = fila.querySelector(`input[data-desc="${key}"]`);
                    if (code && desc && code.value.trim()) nuevo[code.value.trim()] = desc.value.trim();
                });
                MAPS[key] = nuevo;
            });
            try { localStorage.setItem(CLAVE_CATALOGOS, JSON.stringify(MAPS)); } catch (e) { }
            // Los datos ya descargados se vuelven a interpretar con el catálogo nuevo
            VISTAS.money.raw = VISTAS.money.raw.map(parseAdjustment);
            VISTAS.bundle.raw = VISTAS.bundle.raw.map(parseAdjustment);
            render("money"); render("bundle");
            log("Catálogos actualizados y guardados en este navegador.", "s");
            MEUI.toast("Catálogos guardados.", "ok");
        } catch (e) { log("Error al guardar catálogos: " + e.message, "e"); }
    });

    $("#btnResetMaps").addEventListener("click", () => {
        MAPS = structuredClone(DEFAULT_MAPS);
        try { localStorage.removeItem(CLAVE_CATALOGOS); } catch (e) { }
        CATALOGOS_CLAVES.forEach(renderCatalogEditor);
        log("Catálogos vueltos a los valores de fábrica.", "w");
    });

    /* -----------------------------------------------------------------
       3.5 Sesión del CM
    ----------------------------------------------------------------- */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            MEUI.abrirPaso(1, true);
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña.", "warn");
            return false;
        }
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("user").value.trim(), clave: el("pass").value });
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión.", "err");
            return false;
        }
    }

    el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", () => el("btnLogin").click());
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        el("pass").value = "";
    });

    /* -----------------------------------------------------------------
       3.6 Registro
    ----------------------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("log").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    /* -----------------------------------------------------------------
       3.7 Arranque
    ----------------------------------------------------------------- */
    try {
        const guardado = localStorage.getItem(CLAVE_CATALOGOS);
        if (guardado) MAPS = JSON.parse(guardado);
    } catch (e) { }

    CATALOGOS_CLAVES.forEach(renderCatalogEditor);
    render("money");
    render("bundle");

    // Fechas por defecto: el mes en curso
    if (!el("fromDate").value && !el("toDate").value) {
        const hoy = new Date();
        const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const iso = d => d.toISOString().slice(0, 10);
        el("fromDate").value = iso(primero);
        el("toDate").value = iso(hoy);
    }

    // Credenciales compartidas con las demás herramientas del CM
    const credenciales = MEUI.cred.get("cm");
    if (credenciales) {
        if (!el("user").value) el("user").value = credenciales.usuario || "";
        if (!el("pass").value) el("pass").value = credenciales.clave || "";
    }
    if (el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true).then(ok => { if (ok) MEUI.abrirPaso(2, true); });
    } else {
        MEUI.log("Escribe usuario y contraseña del CM y presiona «Iniciar sesión».");
    }

    MEUI.log("Herramienta lista.", "ok");
})();
