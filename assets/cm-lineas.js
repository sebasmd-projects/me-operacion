/* =====================================================================
   cm-lineas.js · Operaciones sobre líneas del CM, compartidas
   ---------------------------------------------------------------------
   Lo usan «Estado de líneas» (bloquear / inactivar) y «Cambio de IMSI».
   Las dos resuelven la línea igual, escriben en el CM con una orden
   (`productOrder`) y la siguen hasta su estado final, así que esa parte
   vive aquí una sola vez. Todo va dentro de un IIFE y se publica como
   `window.CMLineas`: las dos herramientas cargan su propia lógica y no
   pueden declarar los mismos nombres globales.

   Los cuerpos de las órdenes son los que manda la interfaz del CM, sacados
   de las capturas `har nuevas/` (ver doc/estado-lineas y doc/cambio-imsi):

     Cambio de estado  POST /productOrder  type=ChangeSubscriptionState
     Cambio de IMSI    POST /shoppingCart  → POST /productOrder (ChangeSim)
                       → DELETE /shoppingCart/{id}

   Además trae la tabla con casillas, filtros y ocultar/mostrar que usan
   las dos (mismo manejo que «Cierre masivo de casos»).

   Depende de me-ui.js (MEUI) y me-api.js (MEAPI).
===================================================================== */
(function (global) {
    "use strict";

    const API = () => MEAPI.CONFIG.apiBase;
    const getJson = (url, params) => MEAPI.getJson(url, params);
    const soloDigitos = s => String(s == null ? "" : s).replace(/\D/g, "");
    const esc = s => MEUI.esc(s);
    const espera = ms => new Promise(r => setTimeout(r, ms));

    /* Quiénes pueden ESCRIBIR (bloquear, inactivar, cambiar IMSI). Se
       compara con el usuario de la sesión del CM, que tiene que estar
       vigente. Es una guarda de interfaz para evitar operaciones por
       accidente, no un control de acceso del CM. Los demás usuarios pueden
       consultar. Para habilitar a alguien más se agrega aquí. */
    const USUARIOS_AUTORIZADOS = ["jpelaezg"];

    function usuario() {
        const st = MEUI.sesion.estado("cm");
        return (st && st.usuario) ? st.usuario : "";
    }
    function puedeOperar() {
        const st = MEUI.sesion.estado("cm");
        if (!st || (st.estado !== "ok" && st.estado !== "warn")) return false;
        const u = String(st.usuario || "").trim().toLowerCase();
        return USUARIOS_AUTORIZADOS.some(x => x.toLowerCase() === u);
    }
    function motivoSinPermiso() {
        const st = MEUI.sesion.estado("cm");
        if (!st || (st.estado !== "ok" && st.estado !== "warn")) {
            return "hace falta una sesión del CM vigente: es la que dice quién eres";
        }
        return `el usuario «${st.usuario || "—"}» no está autorizado para esta operación`;
    }
    /** Nota que viaja en la orden: SIEMPRE con el usuario delante. */
    const notaDe = texto => {
        const u = usuario() || "sin usuario";
        const t = String(texto || "").trim();
        return t ? `${u}. ${t}` : u;
    };

    /* ---------------------------------------------------------------
       Catálogos. Solo lo confirmado con datos reales; lo demás se muestra
       con su código crudo en vez de adivinar una etiqueta.
    --------------------------------------------------------------- */
    // Estado de la suscripción (/subscribers → status.state). El 5 es el
    // «Barred/Locked» de productOffering/10008 (confirmado en la captura).
    const ESTADOS_LINEA = { 1: "Activa", 2: "Inactiva", 3: "Disponible", 4: "Bloqueada", 5: "Bloqueada" };
    const textoEstadoLinea = s => ESTADOS_LINEA[s] || (s != null ? `Estado ${s}` : "—");

    // Estado de la SIM/IMSI (/cardPackage → state). Confirmados: 1 es la
    // que se pudo asignar en el cambio de IMSI, 2 la que tiene una línea en
    // uso. HELD (lo que queda tras inactivar) NO se alcanzó a capturar con
    // su código, así que se muestra crudo.
    const ESTADOS_SIM = { 1: "Disponible", 2: "En uso" };
    const textoEstadoSim = s => ESTADOS_SIM[s] || (s != null ? `Estado ${s} (¿HELD?)` : "—");
    const SIM_DISPONIBLE = 1;

    /* ---------------------------------------------------------------
       Resolver la línea
       Una línea puede tener varias suscripciones: se usa la ACTIVA más
       reciente y, si ninguna está activa, la última creada — el mismo
       criterio de las otras herramientas, y el que usó la interfaz del CM
       en la captura del cambio de IMSI (3054164491 tiene una desactivada y
       una activa: la orden fue sobre la activa).
    --------------------------------------------------------------- */
    function cuentaBase(sub, linea) {
        const p = sub.profile || {}, st = sub.status || {};
        return {
            msisdn: String(p.mobileNumber || linea),
            ban: p.accountID != null ? String(p.accountID) : "",
            subscriberId: p.identifier || "",
            estado: st.state,
            estadoTexto: textoEstadoLinea(st.state),
            creado: Number(p.created || 0),
            simId: p.cardPackageID ? String(p.cardPackageID) : "",
            paidType: p.paidType != null ? String(p.paidType) : "0",
            notificationPreference: p.notificationPreference != null ? String(p.notificationPreference) : "0"
        };
    }

    async function resolverLinea(msisdn) {
        const encontradas = [];
        for (let offset = 0; offset <= 500; offset += 50) {
            const data = await getJson(`${API()}/api/v1/subscribers`, { msisdnList: msisdn, offset, limit: 50 });
            const pagina = data?.subscriberResponseList || [];
            pagina.forEach(s => {
                if (String(s?.profile?.mobileNumber || "") === String(msisdn)) encontradas.push(s);
            });
            if (pagina.length < 50) break;
        }
        if (!encontradas.length) return null;
        const cuentas = encontradas.map(s => cuentaBase(s, msisdn)).sort((a, b) => b.creado - a.creado);
        const elegida = cuentas.find(c => c.estado === 1) || cuentas[0];
        return { cuentas, elegida };
    }

    /** Cuenta del CRM con coincidencia EXACTA de externalID (ver el error
     *  500 documentado en doc/aplicar-plu: la búsqueda no es de igualdad). */
    async function cuentaCrm(ban) {
        const clave = String(ban || "").trim();
        if (!clave) return { cuenta: null, aviso: "la línea no trae cuenta (accountID)" };
        const r = await getJson(`${API()}/api/v1/billingAccount`, { externalID: clave, offset: 0, limit: 10 })
            .catch(() => null);
        const lista = Array.isArray(r) ? r : (r?.billingAccounts || r?.results || []);
        const exacta = lista.find(a => String(a?.externalID || "") === clave);
        if (exacta) return { cuenta: exacta, aviso: "" };
        return {
            cuenta: null,
            aviso: lista.length
                ? `el CRM no tiene la cuenta ${clave} (devolvió ${lista.map(a => a.externalID).join(", ")}; no se usa ninguna)`
                : `la cuenta ${clave} no existe en el CRM del CM`
        };
    }

    /** Dirección de facturación con el formato que manda la interfaz del CM
     *  en `ADDRESS` («Colombia billingAddress Colombia 410-3 Direcc1 Direcc2»).
     *  Sale del detalle de la cuenta por su id interno, que trae la calle
     *  partida en street1/street2; si falla, del listado. */
    async function direccionDe(cuenta) {
        let contacto = null;
        if (cuenta?.id) {
            const det = await getJson(`${API()}/api/v1/billingAccount/${encodeURIComponent(cuenta.id)}`).catch(() => null);
            const d = Array.isArray(det) ? det[0] : det;
            contacto = d?.contact;
        }
        contacto = contacto || cuenta?.contact || [];
        const c = (contacto.find(x => x.contactType === "billingAddress") || contacto[0] || {})
            .contactMedium?.[0]?.characteristic || {};
        return {
            address: [c.city, c.contactType, c.country, c.stateOrProvince, c.street1, c.street2]
                .filter(v => v != null && String(v).trim() !== "").join(" "),
            state: c.stateOrProvince || "",
            city: c.city || ""
        };
    }

    /** SIM / IMSI en el inventario (/cardPackage/{id}). */
    async function simDe(id) {
        const clave = soloDigitos(id);
        if (!clave) return { existe: false, id: "", detalle: "sin IMSI" };
        try {
            const r = await getJson(`${API()}/api/v1/cardPackage/${encodeURIComponent(clave)}`);
            const cp = r?.cardPackage;
            if (!cp) return { existe: false, id: clave, detalle: "el CM no devolvió la SIM" };
            return {
                existe: true, id: clave,
                identificador: String(cp.identifier || clave),
                imsi: String(cp.imsi || ""),
                estado: cp.state,
                estadoTexto: textoEstadoSim(cp.state),
                disponible: Number(cp.state) === SIM_DISPONIBLE,
                modificado: cp.lastModified || ""
            };
        } catch (e) {
            return { existe: false, id: clave, detalle: e.status === 404 ? "no existe en el inventario" : (e.message || String(e)) };
        }
    }

    /* ---------------------------------------------------------------
       Órdenes
    --------------------------------------------------------------- */
    const dos = n => String(n).padStart(2, "0");
    /** Mismo formato que la interfaz del CM: DCRM-TRX20260928160249-922. */
    function transactionId() {
        const d = new Date();
        return `DCRM-TRX${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}`
            + `${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    }
    /** itemGroupId de cuatro dígitos: da nombre a <grupo>_MSISDN, etc. */
    const grupo = () => String(Math.floor(Math.random() * 9000) + 1000);

    const post = (ruta, cuerpo, cabeceras) => MEAPI.api(ruta, {
        method: "POST", body: JSON.stringify(cuerpo),
        headers: Object.assign({ "Content-Type": "application/json" }, cabeceras || {})
    });

    /** Texto útil de un error del CM (el cuerpo trae code/message/detail). */
    function textoError(e) {
        const crudo = String(e?.cuerpo || "");
        try {
            const j = JSON.parse(crudo);
            const partes = [j.code, j.message, j.detail].filter(Boolean);
            if (partes.length) return `HTTP ${e.status || "?"} · ${partes.join(" · ")}`;
        } catch (x) { /* no era JSON */ }
        return e?.message || String(e);
    }

    /**
     * Sigue la orden hasta su estado final. El 200 del POST solo dice que
     * el CM la RECIBIÓ. La interfaz del CM consulta con el BAN entre
     * comillas (customerBan="…"); si así no aparece, se prueba sin ellas.
     */
    async function esperarOrden(ban, ordenId, alProgresar, maxMs) {
        const limite = Date.now() + (maxMs || 45000);
        let ultima = null;
        while (Date.now() < limite) {
            let orden = null;
            for (const valor of [`"${ban}"`, String(ban)]) {
                const lista = await getJson(`${API()}/api/v1/productOrder`, { customerBan: valor }).catch(() => null);
                orden = Array.isArray(lista) ? lista.find(o => String(o?.id) === String(ordenId)) : null;
                if (orden) break;
            }
            if (orden) {
                ultima = orden;
                const estado = String(orden.state || orden.orderStatus || "").trim();
                if (alProgresar) alProgresar(estado || "en curso");
                if (estado === "Order Failed") {
                    let motivo = "";
                    for (const h of (orden.history || [])) {
                        if (h.orderStatus !== "Order Failed") continue;
                        const m = /<[^>]*faultstring[^>]*>([^<]*)</i.exec(String(h.changeReason || ""));
                        motivo = m ? m[1].trim() : String(h.changeReason || "").slice(0, 200);
                        break;
                    }
                    return { estado, ok: false, motivo: motivo || "revisa el historial de la orden en el CM", orden };
                }
                if (estado === "Order Fulfilled" || estado === "Order Completed") {
                    return { estado, ok: true, motivo: "", orden };
                }
            }
            await espera(2000);
        }
        return { estado: "Order Pending", ok: false, motivo: "el CM no dio un estado final a tiempo", orden: ultima };
    }

    /* ---------------------------------------------------------------
       Cambio de estado de la suscripción
       Oferta 10008 «Subscription state change» y UN producto destino.
    --------------------------------------------------------------- */
    const DESTINOS_ESTADO = {
        bloquear: {
            productId: "10006", estadoCm: 5, etiqueta: "Bloquear", resultado: "Bloqueada",
            razon: "Exito Razón bloqueo"
        },
        inactivar: {
            productId: "10007", estadoCm: 2, etiqueta: "Inactivar", resultado: "Inactiva",
            razon: "Exito Razón Inactividad"
        }
    };

    /** Envía y sigue la orden. Devuelve { ok, ordenId, estado, detalle, evidencia }. */
    async function cambiarEstado(linea, destino, razon, nota, alPaso) {
        const d = DESTINOS_ESTADO[destino];
        const res = { ok: false, ordenId: "", estado: "", detalle: "", evidencia: {} };
        if (!d) { res.detalle = "destino de estado desconocido"; return res; }
        const aviso = t => { if (alPaso) alPaso(t); };

        const crm = await cuentaCrm(linea.ban);
        if (!crm.cuenta) { res.detalle = crm.aviso; return res; }
        const g = grupo();
        const texto = notaDe(nota);
        const cuerpo = {
            type: "ChangeSubscriptionState",
            relatedParty: [{
                id: linea.ban, firstName: crm.cuenta.givenName || "", lastName: crm.cuenta.familyName || "",
                role: "Customer"
            }],
            productOrderItem: [{
                action: "ADD", index: 0, itemGroupId: g,
                productOffering: { id: "10008", quantity: 1, includedItems: [{ id: d.productId, quantity: 1 }] },
                note: [{ author: usuario(), text: texto }]
            }],
            note: [{ author: usuario(), text: texto }],
            orderDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            userData: [
                { name: `${g}_MSISDN`, value: linea.msisdn },
                { name: "SPID", value: "410" },
                { name: "SUBSCRIPTION_ID", value: linea.subscriberId },
                { name: "REASON", value: String(razon || d.razon) }
            ]
        };
        res.evidencia.orden = { request: cuerpo };
        aviso("Enviando la orden…");
        try {
            const r = await post("/api/v1/productOrder", cuerpo, { "Transaction-Id": transactionId() });
            res.evidencia.orden.response = r;
            if (!r?.id) { res.detalle = "el CM no confirmó la orden: revisa antes de repetir"; return res; }
            res.ordenId = String(r.id);
        } catch (e) {
            res.evidencia.orden.response = e.cuerpo || e.message;
            res.detalle = textoError(e);
            return res;
        }

        aviso(`Orden ${res.ordenId}: esperando su estado…`);
        const fin = await esperarOrden(linea.ban, res.ordenId, e => aviso(`Orden ${res.ordenId}: ${e}…`));
        res.evidencia.ordenFinal = fin.orden;
        res.estado = fin.estado;
        res.ok = fin.ok;
        res.detalle = fin.ok ? `Orden ${res.ordenId}: ${fin.estado}` : `Orden ${res.ordenId}: ${fin.estado}. ${fin.motivo}`;
        return res;
    }

    /* ---------------------------------------------------------------
       Cambio de IMSI (ChangeSim)
       Carrito con la oferta 10012 «SIM Category-EXITO» (producto 10010)
       → orden → seguimiento → borrar el carrito. La SIM nueva va en
       <g>_ICCID (su identificador en el inventario) y <g>_NEW_IMSI.
    --------------------------------------------------------------- */
    async function cambiarImsi(linea, simNueva, nota, alPaso) {
        const res = { ok: false, ordenId: "", estado: "", detalle: "", evidencia: {} };
        const aviso = t => { if (alPaso) alPaso(t); };

        const crm = await cuentaCrm(linea.ban);
        if (!crm.cuenta) { res.detalle = crm.aviso; return res; }
        aviso("Leyendo la dirección de facturación…");
        const dir = await direccionDe(crm.cuenta);

        const g = grupo();
        const texto = notaDe(nota);
        const userData = [
            ["SPID", "410"], ["PAIDTYPE", linea.paidType || "0"], ["LANGUAGE", "es"],
            ["orderType", "changeSim"], ["type", "ChangeSim"],
            ["notificationPreference", linea.notificationPreference || "0"], ["preferredLanguage", "es"],
            ["dealerCode", ""], ["reasonForActivation", ""], ["MSISDN_PREFIX", ""], ["PAYMENT_METHOD", ""],
            ["MONTHLY_SPEND_LIMIT", ""], ["ADDRESS", dir.address], ["QUERY_TYPE", "0"], ["state", dir.state],
            ["CITY", dir.city], ["GEOCODE", ""], ["CUSTOMER_EMAIL", ""],
            ["IS_2FA_REQUIRED", false], ["SKIP_2FA_ENABLED", false], ["SEND_EMAIL_ON_SIM_SWAP", false],
            ["CUSTOMER_NAME", ""],
            [`${g}_MSISDN`, linea.msisdn],
            [`${g}_ICCID`, simNueva.identificador],
            [`${g}_OLD_ICCID`, linea.simId],
            [`${g}_NEW_IMSI`, simNueva.imsi || simNueva.id],
            ["SUBSCRIPTION_ID", linea.subscriberId],
            ["AUTHORIZER_NAME", ""]
        ].map(([name, value]) => ({ name, value }));

        const carritoReq = {
            userData,
            cartItem: [{
                action: "ADD", index: 0, itemGroupId: g,
                productOffering: { id: "10012", quantity: 1, includedItems: [{ id: "10010", quantity: 1 }] },
                note: [{ text: texto, author: usuario() }]
            }],
            relatedParty: [{
                id: linea.ban, firstName: crm.cuenta.givenName || "", lastName: crm.cuenta.familyName || "",
                role: "Customer"
            }]
        };
        res.evidencia.carrito = { request: carritoReq };

        let carritoId = null;
        try {
            aviso("Creando el carrito…");
            const carrito = await post("/api/v1/shoppingCart", carritoReq);
            res.evidencia.carrito.response = carrito;
            carritoId = carrito?.id;
            if (!carritoId || !carrito.cartItem) { res.detalle = "el CM no devolvió un carrito válido"; return res; }

            const ordenReq = {
                notificationContact: "", channel: [{ id: "DCRM" }],
                relatedParty: carrito.relatedParty || carritoReq.relatedParty,
                productOrderItem: JSON.parse(JSON.stringify(carrito.cartItem)),
                note: carrito.cartItem[0].note || [],
                contactMedium: carrito.contactMedium || [],
                userData: (carrito.userData || userData).concat([
                    { name: "AMOUNT_PAID", value: "0" }, { name: "AMOUNT", value: "0" }
                ]),
                type: "ChangeSim", atuBssTokenID: ""
            };
            res.evidencia.orden = { request: ordenReq };
            aviso("Enviando la orden de cambio de SIM…");
            const orden = await post("/api/v1/productOrder", ordenReq, { "Transaction-Id": transactionId() });
            res.evidencia.orden.response = orden;
            if (!orden?.id) { res.detalle = "el CM no confirmó la orden: revisa antes de repetir"; return res; }
            res.ordenId = String(orden.id);

            aviso(`Orden ${res.ordenId}: esperando su estado…`);
            const fin = await esperarOrden(linea.ban, res.ordenId, e => aviso(`Orden ${res.ordenId}: ${e}…`));
            res.evidencia.ordenFinal = fin.orden;
            res.estado = fin.estado;
            res.ok = fin.ok;
            res.detalle = fin.ok ? `Orden ${res.ordenId}: ${fin.estado}` : `Orden ${res.ordenId}: ${fin.estado}. ${fin.motivo}`;
            return res;
        } catch (e) {
            const paso = res.evidencia.orden ? "orden" : "carrito";
            res.evidencia[paso].response = e.cuerpo || e.message;
            res.detalle = textoError(e);
            return res;
        } finally {
            // Un carrito que queda colgado lo vuelve a mandar la interfaz del
            // CM más adelante: en la captura, uno viejo de SwitchCarrier se
            // envió solo (orden SOI7869437). Por eso se borra SIEMPRE.
            if (carritoId) {
                await MEAPI.api("/api/v1/shoppingCart/" + encodeURIComponent(carritoId), { method: "DELETE" })
                    .catch(() => { });
            }
        }
    }

    /* ---------------------------------------------------------------
       Tabla con casillas, filtros y ocultar/mostrar
       ---------------------------------------------------------------
       Mismo manejo que «Cierre masivo de casos»: casilla por fila y una en
       el encabezado para lo visible, ocultar/mostrar por fila y en lote, y
       filtros que se combinan. Cada herramienta pone sus columnas.

       cfg = {
         tabla: "#id", vacio: "#id",
         columnas: [{ t, txt(f), render?(f), orden?: false }],
         filtros: { texto, estado, proceso, sel, verOcultas },   // selectores
         textoDe(f): string para el buscador,
         alCambiar(): se llama tras cada cambio (contadores, botones)
       }
    --------------------------------------------------------------- */
    function tablaSeleccionable(cfg) {
        let filas = [];
        let dt = null;
        const $ = s => document.querySelector(s);
        const idTabla = cfg.tabla.replace(/^#/, "");
        const valor = sel => (sel && $(sel) ? $(sel).value : "");
        const marcado = sel => !!(sel && $(sel) && $(sel).checked);
        const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

        const COLS = [{
            t: '<input type="checkbox" class="form-check-input chk-todas" title="Marcar o desmarcar lo visible">',
            orden: false, txt: f => (f.sel ? "1" : "0"),
            render: f => `<input type="checkbox" class="form-check-input chk-fila" data-id="${esc(f.__id)}"${f.sel ? " checked" : ""}${f.bloqueada ? " disabled" : ""}>`
        }].concat(cfg.columnas).concat([{
            t: "", orden: false, txt: () => "",
            render: f => `<button class="btn btn-sm btn-me-line btn-ocultar" data-id="${esc(f.__id)}" type="button">${f.oculta ? "Mostrar" : "Ocultar"}</button>`
        }]);

        DataTable.ext.search.push(function (settings, datos, indice, fila) {
            if (settings.nTable.id !== idTabla) return true;
            const f = fila || filas[indice];
            if (!f) return true;
            const F = cfg.filtros || {};
            if (f.oculta && !marcado(F.verOcultas)) return false;
            const est = valor(F.estado);
            if (est && String(f.estadoTexto || "") !== est) return false;
            const pro = valor(F.proceso);
            if (pro && String(f.proceso || "") !== pro) return false;
            const sel = valor(F.sel);
            if (sel === "si" && !f.sel) return false;
            if (sel === "no" && f.sel) return false;
            const txt = norm(valor(F.texto));
            if (txt && !norm(cfg.textoDe ? cfg.textoDe(f) : JSON.stringify(f)).includes(txt)) return false;
            return true;
        });

        function construir() {
            MEUI.prepararTabla(cfg.tabla);
            $(cfg.tabla).innerHTML = "<thead><tr>" + COLS.map(c => `<th>${c.t}</th>`).join("") + "</tr></thead><tbody></tbody>";
            dt = new DataTable(cfg.tabla, MEUI.opcionesTabla({
                data: filas, pageLength: 25, lengthMenu: [10, 25, 50, 100, 250], order: [],
                columns: COLS.map(c => ({
                    title: c.t, orderable: c.orden !== false, data: null,
                    render: (d, type, f) => type === "display" ? (c.render ? c.render(f) : esc(c.txt(f))) : c.txt(f)
                })),
                createdRow: (tr, f) => { tr.classList.toggle("fila-oculta", !!f.oculta); }
            }));
            MEUI.registrarTabla(dt);
        }

        function visibles() {
            return dt ? dt.rows({ search: "applied" }).indexes().toArray().map(i => filas[i]) : [];
        }
        function sincronizarTodas() {
            const vis = visibles().filter(f => !f.bloqueada);
            const todas = vis.length > 0 && vis.every(f => f.sel);
            const algunas = vis.some(f => f.sel);
            document.querySelectorAll(`#${idTabla} .chk-todas, #${idTabla}_wrapper .chk-todas`).forEach(c => {
                c.checked = todas; c.indeterminate = !todas && algunas;
            });
        }
        function redibujar(reRender) {
            if (dt) {
                if (reRender) dt.rows().invalidate("data");
                dt.draw(false);
                dt.rows().every(function () {
                    const f = this.data(), tr = this.node();
                    if (tr) tr.classList.toggle("fila-oculta", !!f.oculta);
                });
            }
            MEUI.mostrarSiHayDatos(cfg.tabla, { vacio: cfg.vacio, tabla: dt });
            sincronizarTodas();
            if (cfg.alCambiar) cfg.alCambiar();
        }

        // Casillas y botones de fila (delegados: la tabla se repinta).
        document.addEventListener("change", ev => {
            const t = ev.target;
            if (!t.closest || !t.closest(`#${idTabla}, #${idTabla}_wrapper`)) return;
            if (t.classList.contains("chk-fila")) {
                const f = filas.find(x => String(x.__id) === t.dataset.id);
                if (f) { f.sel = t.checked; sincronizarTodas(); if (cfg.alCambiar) cfg.alCambiar(); }
            } else if (t.classList.contains("chk-todas")) {
                visibles().forEach(f => { if (!f.bloqueada) f.sel = t.checked; });
                redibujar(true);
            }
        });
        document.addEventListener("click", ev => {
            const b = ev.target.closest && ev.target.closest(`#${idTabla} .btn-ocultar`);
            if (!b) return;
            const f = filas.find(x => String(x.__id) === b.dataset.id);
            if (f) { f.oculta = !f.oculta; redibujar(true); }
        });
        const F = cfg.filtros || {};
        [F.estado, F.proceso, F.sel, F.verOcultas].filter(Boolean).forEach(s => {
            if ($(s)) $(s).addEventListener("change", () => redibujar());
        });
        if (F.texto && $(F.texto)) $(F.texto).addEventListener("input", () => redibujar());

        return {
            poner(nuevas) {
                filas = nuevas.map((f, i) => Object.assign({ __id: String(i), sel: false, oculta: false }, f));
                if (!dt) construir();
                dt.clear().rows.add(filas);
                redibujar(true);
                return filas;
            },
            filas: () => filas,
            visibles,
            /** Marcadas Y no ocultas: lo que se va a operar. */
            marcadas: () => filas.filter(f => f.sel && !f.oculta && !f.bloqueada),
            redibujar,
            marcarVisibles(v) { visibles().forEach(f => { if (!f.bloqueada) f.sel = v; }); redibujar(true); },
            ocultarMarcadas() { visibles().forEach(f => { if (f.sel) f.oculta = true; }); redibujar(true); },
            ocultarNoMarcadas() { visibles().forEach(f => { if (!f.sel) f.oculta = true; }); redibujar(true); },
            restaurarOcultas() { filas.forEach(f => { f.oculta = false; }); redibujar(true); },
            /** Llena un <select> de filtro con los valores presentes. */
            opcionesFiltro(sel, campo) {
                const s = $(sel);
                if (!s) return;
                const actual = s.value;
                const valores = [...new Set(filas.map(f => f[campo]).filter(v => v != null && v !== ""))].sort();
                s.innerHTML = '<option value="">Todos</option>' + valores.map(v => `<option>${esc(v)}</option>`).join("");
                if (valores.includes(actual)) s.value = actual;
            }
        };
    }

    /* ---------------------------------------------------------------
       Enganches de interfaz comunes a las dos herramientas
    --------------------------------------------------------------- */
    const byId = id => document.getElementById(id);

    /** Sesión del CM: botón, Enter, credenciales compartidas y chips. */
    function engancharSesionCm(alCambiar) {
        const auth = MEAPI.auth;
        async function conectar(silencioso) {
            auth.leerCampos();
            if (!(auth.username && auth.password)) {
                if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
                return false;
            }
            try {
                auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
                await auth.ensure();
                MEUI.cred.set("cm", { usuario: byId("user").value.trim(), clave: byId("pass").value });
                MEUI.aplicarAperturaPasos();
                if (alCambiar) alCambiar();
                return true;
            } catch (e) {
                MEUI.log("✖ " + e.message, "err");
                if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
                return false;
            }
        }
        byId("btnLogin").addEventListener("click", () =>
            MEUI.conSpinner(byId("btnLogin"), "Conectando…", () => conectar(false)));
        MEUI.enterEjecuta(byId("pass"), byId("btnLogin"));
        document.addEventListener("me:sesion-iniciar", e => { if (e.detail.clave === "cm") byId("btnLogin").click(); });
        document.addEventListener("me:sesion-renovar", e => {
            if (e.detail.clave === "cm" && auth.token) auth.reauth(auth.version).catch(() => { });
        });
        document.addEventListener("me:sesion-cerrar", e => {
            if (e.detail.clave !== "cm") return;
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            byId("pass").value = "";
            if (alCambiar) alCambiar();
        });
        document.addEventListener("me:sesion-cambio", () => { if (alCambiar) alCambiar(); });

        const c = MEUI.cred.get("cm");
        if (c) {
            if (!byId("user").value) byId("user").value = c.usuario || "";
            if (!byId("pass").value) byId("pass").value = c.clave || "";
        }
        if (byId("user").value && byId("pass").value && !auth.token) {
            MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
            conectar(true);
        }
    }

    /** Botones de lote (marcar, ocultar…) y limpiar filtros. */
    function engancharLote(tabla, filtros) {
        const en = (id, fn) => { const b = byId(id); if (b) b.addEventListener("click", fn); };
        en("btnMarcarVisibles", () => tabla.marcarVisibles(true));
        en("btnDesmarcarVisibles", () => tabla.marcarVisibles(false));
        en("btnOcultarSel", () => tabla.ocultarMarcadas());
        en("btnOcultarNoSel", () => tabla.ocultarNoMarcadas());
        en("btnRestaurarOcultas", () => tabla.restaurarOcultas());
        en("btnLimpiarFiltros", () => {
            Object.values(filtros).forEach(sel => {
                const el = document.querySelector(sel);
                if (!el) return;
                if (el.type === "checkbox") el.checked = false; else el.value = "";
            });
            tabla.redibujar();
        });
    }

    /** Limpiar y copiar el registro. */
    function engancharRegistro() {
        const l = byId("btnLimpiarLog"), c = byId("btnCopiarLog");
        if (l) l.addEventListener("click", () => MEUI.limpiarLog());
        if (c) c.addEventListener("click", () => {
            navigator.clipboard.writeText(byId("logConexion").innerText)
                .then(() => MEUI.toast("Registro copiado.", "ok"))
                .catch(() => MEUI.toast("No se pudo copiar.", "err"));
        });
    }

    /** Badge de color para un estado de línea o de proceso. */
    function badge(texto, clase) {
        return `<span class="badge-estado ${clase || "neutro"}">${esc(texto || "—")}</span>`;
    }

    const horaBogota = () => new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", hour12: false });

    global.CMLineas = {
        engancharSesionCm, engancharLote, engancharRegistro, badge, horaBogota,
        USUARIOS_AUTORIZADOS, usuario, puedeOperar, motivoSinPermiso, notaDe,
        ESTADOS_LINEA, textoEstadoLinea, ESTADOS_SIM, textoEstadoSim, SIM_DISPONIBLE,
        resolverLinea, cuentaCrm, direccionDe, simDe,
        transactionId, esperarOrden, textoError,
        DESTINOS_ESTADO, cambiarEstado, cambiarImsi,
        tablaSeleccionable, soloDigitos
    };
})(window);
