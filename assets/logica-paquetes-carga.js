/* =====================================================================
   logica-paquetes-carga.js · Cargar paquetes (bundles) a una línea (CM)
   ---------------------------------------------------------------------
   Complemento de logica-consumos.js: esa lee (línea, paquetes, consumo),
   esta ESCRIBE. Vive aparte a propósito, porque es la única parte de la
   herramienta que modifica el CM y conviene poder leerla —y auditarla—
   sin mezclarla con la consulta.

   El flujo no es un endpoint de «agregar paquete»: en el CM agregar un
   paquete es una ORDEN DE CAMBIO DE OFERTA (`ChangeOffer`) sobre el plan
   que la línea ya tiene, armada primero en un carrito. Está documentado
   paso a paso, con la captura de la que salió, en
   `doc/reporte-ajustes/recarga-de-paquetes-cm.md`.

       perfil → oferta del plan → catálogo → carrito → orden → limpieza
                                                              → verificación

   Por qué un IIFE y no globales sueltas como en las demás lógicas: este
   archivo se carga JUNTO a logica-consumos.js en la misma página, y dos
   scripts clásicos no pueden declarar `CONFIG`, `auth` o `getJson` dos
   veces. Todo queda detrás de `window.MEPAQ`.

   Depende de: me-ui.js (MEUI), me-api.js (MEAPI) y del HTML del modal de
   detalle de reporte_consumos.html.
===================================================================== */
(function (global) {
    "use strict";

    const getJson = (ruta, params) => MEAPI.getJson(ruta, params);
    const api = (ruta, opciones) => MEAPI.api(ruta, opciones);
    const $ = sel => document.querySelector(sel);
    const esc = t => MEUI.esc(t);
    const log = (m, n) => MEUI.log(m, n);

    /* =====================================================================
       1 · REGLAS FIJAS DEL FLUJO
       Todas salen de la captura; si el CM cambia alguna, se cambia aquí.
    ===================================================================== */
    const CANAL = "DCRM";              // channel[].id — canal del CRM de atención
    const CANAL_USERDATA = "0";        // userData.CHANNEL — no es el mismo campo
    const TIPO_ORDEN = "ChangeOffer";
    const TIPO_ORDEN_USERDATA = "changeProduct";
    const PROGRAMACION = "IMMEDIATE";  // sin agendar: se aplica de una

    /* Guarda de negocio, no técnica. La captura que documentamos agrega
       paquetes de precio 0 y la orden sale con total 0, `AMOUNT` en 0 y
       sin método de pago. Cómo se arma el cobro cuando el paquete SÍ vale
       (los `PROD_COMP_PACKAGE` llegan hasta $74.700) no está capturado, y
       adivinarlo es cobrarle mal a un cliente: hasta tener esa captura,
       esta herramienta solo carga paquetes de precio 0. */
    const TOPE_PRECIO = 0;

    /* Cuántos resultados se pintan a la vez. El catálogo real trae ~469
       bundles: pintarlos todos en cada tecla hace que el buscador se
       sienta pesado, y nadie revisa 469 filas a ojo. */
    const MAX_LISTA = 60;

    /* =====================================================================
       2 · ESTADO
    ===================================================================== */
    let fila = null;          // fila de la línea abierta en el modal
    let ctx = null;           // contexto resuelto (perfil + oferta + catálogo)
    let seleccion = [];       // bundles elegidos por el analista
    let ocupado = false;      // hay una resolución o un envío en curso
    let alAplicar = null;     // callback para refrescar los paquetes de la línea

    /* El catálogo depende de la OFERTA, no de la línea: dos líneas con el
       mismo plan comparten los mismos 469 bundles. Se cachea por oferta
       para no volver a pedirlo al abrir la siguiente línea. */
    const cacheCatalogo = new Map();

    /* =====================================================================
       3 · UTILIDADES
    ===================================================================== */
    const numero = v => { const n = Number(v); return isFinite(n) ? n : 0; };

    const fmtCOP = n => numero(n) === 0 ? "$0"
        : "$" + numero(n).toLocaleString("es-CO", { maximumFractionDigits: 0 });

    /** Los nombres del catálogo terminan en «-{bundleId}» («WhatsApp 30
        dias-234»). El id ya se muestra como etiqueta aparte, así que en el
        nombre estorba. */
    const nombreLimpio = p => String(p.name || "").replace(/-\d+$/, "").trim() || String(p.productId || "—");

    const bundleIdDe = p => String(p?.attributes?.bundleId ?? "");

    /** «2026-09-23 08:48:35.571» en hora local, como lo manda el front del CM. */
    function fechaNota(d) {
        const p = (n, l = 2) => String(n).padStart(l, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
            + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
    }

    /** `DCRM-TRX20260923084839-715`. El CM la usa para trazabilidad; no
        deduplica, así que no sirve como llave de idempotencia. */
    function transactionId(d) {
        const p = n => String(n).padStart(2, "0");
        const sello = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
            + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
        return `${CANAL}-TRX${sello}-${Math.floor(Math.random() * 900) + 100}`;
    }

    /** El front del CM lo inventa en el cliente (4 dígitos en la captura) y
        lo usa además como prefijo de `{grupo}_MSISDN` y `{grupo}_ICCID`. */
    const nuevoItemGroupId = () => String(Math.floor(Math.random() * 9000) + 1000);

    const postJson = (ruta, cuerpo, cabeceras) => api(ruta, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, cabeceras || {}),
        body: JSON.stringify(cuerpo)
    });

    /* =====================================================================
       4 · CONSULTAS AL CM
    ===================================================================== */

    /** Perfil del suscriptor: de aquí sale TODO lo que el carrito repite
        (cuenta, MSISDN, ICCID, plan, spid, paidType) y la foto «antes» de
        los paquetes activos. */
    async function perfilSuscriptor(subscriptionId) {
        const data = await getJson("/api/v1/subscriberProfile", { identifier: subscriptionId });
        const s = data?.subscriber || {};
        const p = s.profile || {}, r = s.rating || {};
        return {
            subscriptionId: p.identifier || subscriptionId,
            accountID: p.accountID || null,
            msisdn: p.mobileNumber || null,
            iccid: p.cardPackageID || p.imsi || null,
            spid: p.spid ?? null,
            paidType: p.paidType ?? null,
            pricePlanId: r.primaryPricePlanID ?? null,
            bundlesActivos: (r.enabledOptionalBundles || []).map(String)
        };
    }

    /** Titular para `relatedParty`. No se inventa: si el CM no lo da, van
        vacíos y se avisa en el registro. */
    async function titular(accountID) {
        const externo = String(accountID || "").split("-")[0];
        let cuenta = null;
        try {
            const lista = await getJson("/api/v1/billingAccount", { externalID: externo, offset: 0, limit: 1 });
            cuenta = Array.isArray(lista) ? lista[0] : null;
        } catch (e) {
            log("⚠ No se pudo leer la cuenta de facturación: " + e.message, "warn");
        }
        let nombre = cuenta?.givenName || "", apellido = cuenta?.familyName || "";
        if ((!nombre || !apellido) && cuenta?.id) {
            try {
                const ind = await getJson(`/api/v1/individual/${encodeURIComponent(cuenta.id)}`,
                    { fields: "familyName,givenName,location" });
                nombre = nombre || ind?.givenName || "";
                apellido = apellido || ind?.familyName || "";
            } catch (e) {
                log("⚠ No se pudo leer el titular: " + e.message, "warn");
            }
        }
        if (!nombre && !apellido) log("⚠ El CM no devolvió nombre del titular; la orden irá sin él.", "warn");
        return { firstName: nombre, lastName: apellido };
    }

    /** Plan de precios de la línea → oferta comercial (`productOfferingId`).
        Es la llave de todo lo que sigue: catálogo, carrito y orden. */
    async function ofertaDelPlan(pricePlanId) {
        const lista = await getJson("/api/v1/productOffering",
            { offeringType: "PRICE_PLAN", primaryPricePlanId: pricePlanId });
        const oferta = (Array.isArray(lista) ? lista : [])[0];
        if (!oferta?.productOfferingId)
            throw new Error(`El CM no devolvió oferta para el plan ${pricePlanId}.`);
        return { id: String(oferta.productOfferingId), nombre: oferta.name || "" };
    }

    /** Catálogo de la oferta, con la misma cadena que usa el asistente del
        CM: primero los servicios obligatorios, y con ESA selección a cuestas
        se piden los bundles. Devuelve qué es obligatorio (va siempre en el
        carrito como NO_CHANGE) y qué es elegible. */
    async function catalogoDeOferta(offeringId) {
        if (cacheCatalogo.has(offeringId)) return cacheCatalogo.get(offeringId);

        const ruta = `/api/v1/productOffering/${encodeURIComponent(offeringId)}/selectableProducts`;

        const tps = await postJson(ruta, { productTypeId: "PROD_COMP_TPS" });
        const servicios = (tps?.selectableProducts || []);
        const serviciosObligatorios = servicios.filter(p => p.optional === false).map(p => String(p.productId));

        const bdl = await postJson(ruta, {
            productTypeId: "PROD_COMP_BDLE",
            selectedProducts: [{
                productTypeId: "PROD_COMP_TPS",
                products: serviciosObligatorios.map(id => ({ productId: id }))
            }]
        });
        const bundles = (bdl?.selectableProducts || []);

        const obligatorio = p => ({ productId: String(p.productId), name: p.name || "" });
        const cat = {
            // El orden importa: el front manda servicios y luego el bundle
            // obligatorio de la oferta. Se conserva. Se guarda el nombre y no
            // solo el id porque en la revisión el analista tiene que poder ver
            // QUÉ se manda, no un número suelto.
            obligatorios: servicios.filter(p => p.optional === false).map(obligatorio)
                .concat(bundles.filter(p => p.optional === false).map(obligatorio)),
            elegibles: bundles.filter(p => p.optional !== false).map(p => ({
                productId: String(p.productId),
                productCode: p.productCode || "",
                bundleId: bundleIdDe(p),
                name: p.name || "",
                precio: numero(p.price?.priceAmount)
            }))
        };
        cacheCatalogo.set(offeringId, cat);
        return cat;
    }

    /* =====================================================================
       5 · CUERPOS DEL CARRITO Y DE LA ORDEN
       ---------------------------------------------------------------------
       Calcados de la captura. Dos cosas que no son obvias:

         · los bundles que la línea YA tiene activos no se reenvían; solo
           van los obligatorios de la oferta (NO_CHANGE) y los nuevos (ADD).
           Los activos sobreviven igual.
         · la orden es la RESPUESTA del carrito con `MODIFY` → `CHANGE` y
           tres campos de pago añadidos. Por eso se arma desde ella y no se
           vuelve a construir a mano: lo que el CM devolvió es lo que el CM
           espera de vuelta.
    ===================================================================== */
    function cuerpoCarrito(c, elegidos, grupo) {
        return {
            relatedParty: [{
                id: c.accountID, firstName: c.firstName, lastName: c.lastName, role: "Customer"
            }],
            cartItem: [{
                action: "MODIFY",
                id: "00001",
                index: 0,
                itemGroupId: grupo,
                productOffering: {
                    id: c.offeringId,
                    quantity: 1,
                    includedItems: [
                        ...c.obligatorios.map(o => ({ id: o.productId, quantity: 1, action: "NO_CHANGE" })),
                        ...elegidos.map(p => ({ id: p.productId, quantity: 1, action: "ADD" }))
                    ]
                },
                note: [{ text: "", author: "" }]
            }],
            userData: [
                { name: "EXISTING_PLAN_ID", value: String(c.pricePlanId) },
                { name: "CHANGE_PRICE_PLAN", value: false },   // booleano, no cadena
                { name: "SUBSCRIPTION_ID", value: c.subscriptionId },
                { name: `${grupo}_MSISDN`, value: String(c.msisdn || "") },
                { name: "SPID", value: String(c.spid ?? "") },
                { name: "SCHEDULE", value: PROGRAMACION },
                { name: "PAIDTYPE", value: String(c.paidType ?? "") },
                { name: `${grupo}_ICCID`, value: String(c.iccid || "") },
                { name: "orderType", value: TIPO_ORDEN_USERDATA },
                { name: "type", value: TIPO_ORDEN },
                { name: "CHANNEL", value: CANAL_USERDATA }
            ],
            channel: [{ id: CANAL }]
        };
    }

    function cuerpoOrden(carrito) {
        const item = carrito.cartItem[0];
        // El front del CM ordena los componentes por id antes de mandar la
        // orden, aunque el carrito se los devuelva en otro orden. Se copia
        // ese detalle para que el cuerpo salga idéntico al de la captura y
        // no quede una diferencia sin explicar si algún día algo falla.
        const oferta = Object.assign({}, item.productOffering, {
            includedItems: (item.productOffering.includedItems || [])
                .slice()
                .sort((a, b) => numero(a.id) - numero(b.id) || String(a.id).localeCompare(String(b.id)))
        });
        return {
            notificationContact: "",
            channel: [{ id: CANAL }],
            relatedParty: carrito.relatedParty,
            productOrderItem: [Object.assign({}, item, { action: "CHANGE", productOffering: oferta })],
            note: item.note,
            contactMedium: carrito.contactMedium || [],
            userData: (carrito.userData || []).concat([
                { name: "AMOUNT_PAID", value: "0" },
                { name: "AMOUNT", value: "0" },
                { name: "PAYMENT_METHOD", value: "" }
            ]),
            type: TIPO_ORDEN,
            atuBssTokenID: ""
        };
    }

    /* =====================================================================
       6 · ENVÍO
       ---------------------------------------------------------------------
       Tres escrituras encadenadas y una verificación. Reglas:
         · el carrito se borra SIEMPRE, salga bien o mal la orden, para no
           dejarle basura pegada al cliente;
         · la orden NO se reintenta. El CM no deduplica: un reintento a
           ciegas sobre una respuesta incierta carga el paquete dos veces.
    ===================================================================== */
    async function ejecutar(c, elegidos, grupo) {
        const pasos = [
            { clave: "carrito", texto: "Crear el carrito (POST /shoppingCart)" },
            { clave: "orden", texto: "Confirmar la orden (POST /productOrder)" },
            { clave: "limpieza", texto: "Borrar el carrito (DELETE /shoppingCart)" },
            { clave: "verificar", texto: "Verificar los paquetes de la línea" }
        ];
        pasos.forEach(p => { p.estado = "espera"; p.detalle = ""; });
        pintarTimeline(pasos);

        const marcar = (clave, estado, detalle) => {
            const p = pasos.find(x => x.clave === clave);
            if (p) { p.estado = estado; p.detalle = detalle || ""; }
            pintarTimeline(pasos);
        };

        const salida = { grupo, cartId: null, orden: null, error: null, antes: c.bundlesActivos.slice(), despues: null };
        let carrito = null;

        try {
            marcar("carrito", "curso");
            const cuerpo = cuerpoCarrito(c, elegidos, grupo);
            log(`Carrito: ${elegidos.length} paquete(s) ADD sobre la oferta ${c.offeringId} (grupo ${grupo}).`, "info");
            carrito = await postJson("/api/v1/shoppingCart", cuerpo);
            salida.cartId = carrito?.id || null;
            if (!salida.cartId) throw new Error("El CM no devolvió id de carrito.");
            marcar("carrito", "ok", "Carrito " + salida.cartId);
            log("✔ Carrito " + salida.cartId + " creado.", "ok");

            marcar("orden", "curso");
            const trx = transactionId(new Date());
            log("Orden: enviando con Transaction-Id " + trx + ". No se reintenta si falla.", "warn");
            salida.orden = await postJson("/api/v1/productOrder", cuerpoOrden(carrito), { "Transaction-Id": trx });
            const idOrden = salida.orden?.id || "(sin id)";
            marcar("orden", "ok", "Orden " + idOrden);
            log("✔ Orden " + idOrden + " creada.", "ok");
        } catch (e) {
            salida.error = e.message || String(e);
            marcar(salida.cartId ? "orden" : "carrito", "err", salida.error);
            log("✖ " + salida.error, "err");
        }

        // Limpieza: siempre que haya carrito, haya fallado o no la orden.
        if (salida.cartId) {
            marcar("limpieza", "curso");
            try {
                await api(`/api/v1/shoppingCart/${encodeURIComponent(salida.cartId)}`, { method: "DELETE" });
                marcar("limpieza", "ok", "Carrito " + salida.cartId + " borrado");
            } catch (e) {
                marcar("limpieza", "err", e.message);
                log("⚠ No se pudo borrar el carrito " + salida.cartId + ": " + e.message
                    + ". Queda pegado al cliente; hay que borrarlo desde el CM.", "warn");
            }
        } else {
            marcar("limpieza", "omitido", "No se creó carrito");
        }

        // Verificación: la respuesta 200 de la orden dice que se CREÓ, no
        // que se aplicó. Lo único que lo prueba es el perfil del suscriptor.
        if (!salida.error) {
            marcar("verificar", "curso");
            try {
                const p = await perfilSuscriptor(c.subscriptionId);
                salida.despues = p.bundlesActivos;
                const faltan = elegidos.map(x => x.bundleId).filter(b => b && !p.bundlesActivos.includes(b));
                marcar("verificar", faltan.length ? "pendiente" : "ok",
                    faltan.length ? `Aún no aparece(n): ${faltan.join(", ")}` : "Todos los paquetes aparecen activos");
            } catch (e) {
                marcar("verificar", "err", e.message);
            }
        } else {
            marcar("verificar", "omitido", "La orden no se creó");
        }

        pasosPintados = pasos;
        return salida;
    }

    /* =====================================================================
       7 · INTERFAZ
    ===================================================================== */
    let pasosPintados = [];
    let ultimaSalida = null;
    let grupoActual = null;   // itemGroupId del envío que se está revisando

    const panel = () => $("#cargaPanel");

    function irAPaso(n) {
        document.querySelectorAll("#cargaPanel .carga-paso").forEach(el =>
            el.classList.toggle("d-none", el.dataset.paso !== String(n)));
        document.querySelectorAll("#cargaSteps li").forEach(el => {
            const p = Number(el.dataset.paso);
            el.classList.toggle("activo", p === n);
            el.classList.toggle("hecho", p < n);
        });
    }

    function estado(texto, nivel) {
        const el = $("#cargaEstado");
        if (!el) return;
        el.className = "carga-estado " + (nivel || "");
        el.innerHTML = texto || "";
    }

    /* --- 7.a · Paso 1: elegir ---------------------------------------- */
    function pintarLista() {
        const caja = $("#cargaLista");
        if (!caja || !ctx) return;
        const q = ($("#cargaBuscar").value || "").trim().toLowerCase();
        const coincide = p => !q
            || p.name.toLowerCase().includes(q)
            || p.bundleId.includes(q)
            || p.productId.includes(q)
            || p.productCode.toLowerCase().includes(q);

        const todos = ctx.elegibles.filter(coincide);
        const vista = todos.slice(0, MAX_LISTA);

        if (!todos.length) {
            caja.innerHTML = `<div class="carga-vacio">Ningún paquete coincide con «${esc(q)}».</div>`;
            return;
        }

        caja.innerHTML = vista.map(p => {
            const elegido = seleccion.some(s => s.productId === p.productId);
            const activo = p.bundleId && ctx.bundlesActivos.includes(p.bundleId);
            return `<button type="button" class="carga-item${elegido ? " elegido" : ""}" data-pid="${esc(p.productId)}">
  <span class="carga-item-n">${esc(nombreLimpio(p))}</span>
  <span class="carga-item-tags">
    <span class="carga-tag">bundle ${esc(p.bundleId || "—")}</span>
    <span class="carga-tag">prod ${esc(p.productId)}</span>
    ${p.precio > 0 ? `<span class="carga-tag precio">${esc(fmtCOP(p.precio))}</span>` : ""}
    ${activo ? '<span class="carga-tag ya">ya activo</span>' : ""}
  </span>
  <span class="carga-item-marca">${elegido ? "✓" : "+"}</span>
</button>`;
        }).join("")
            + (todos.length > vista.length
                ? `<div class="carga-vacio">Mostrando ${vista.length} de ${todos.length}. Afina la búsqueda para ver el resto.</div>`
                : "");
    }

    function pintarSeleccion() {
        const caja = $("#cargaSel");
        if (!caja) return;
        caja.innerHTML = seleccion.length
            ? seleccion.map(p => `<span class="carga-chip">${esc(nombreLimpio(p))}
                <small>${esc(p.bundleId)}</small>
                <button type="button" class="carga-chip-x" data-quitar="${esc(p.productId)}" title="Quitar">✕</button></span>`).join("")
            : `<span class="carga-vacio">Nada elegido todavía.</span>`;
        const btn = $("#btnCargaRevisar");
        if (btn) btn.disabled = seleccion.length === 0;
        if (seleccion.length) estado(`${seleccion.length} paquete(s) elegido(s).`, "");
        else estado("", "");
    }

    function alternar(productId) {
        const p = ctx.elegibles.find(x => x.productId === productId);
        if (!p) return;
        const i = seleccion.findIndex(s => s.productId === productId);
        if (i >= 0) seleccion.splice(i, 1); else seleccion.push(p);
        pintarLista();
        pintarSeleccion();
    }

    /* --- 7.b · Paso 2: revisar --------------------------------------- */
    function pintarRevision() {
        const total = seleccion.reduce((a, p) => a + p.precio, 0);
        const repetidos = seleccion.filter(p => p.bundleId && ctx.bundlesActivos.includes(p.bundleId));

        const filasTabla = [
            ...ctx.obligatorios.map(o => ({
                accion: "NO_CHANGE",
                nombre: nombreLimpio(o) || "Componente obligatorio de la oferta",
                bundleId: "", productId: o.productId, precio: 0
            })),
            ...seleccion.map(p => ({ accion: "ADD", nombre: nombreLimpio(p), bundleId: p.bundleId, productId: p.productId, precio: p.precio }))
        ];

        $("#cargaResumen").innerHTML = `
<div class="carga-linea">
  <span>Línea <b class="me-mono">${esc(ctx.msisdn || fila.msisdn)}</b></span>
  <span>SubscriptionID <b class="me-mono">${esc(ctx.subscriptionId)}</b></span>
  <span>Cuenta <b class="me-mono">${esc(ctx.accountID || "—")}</b></span>
  <span>Oferta <b class="me-mono">${esc(ctx.offeringId)}</b> ${esc(ctx.offeringNombre)}</span>
</div>
<div class="carga-tabla-wrap">
<table class="table table-sm mb-0 carga-tabla">
  <thead><tr><th>Acción</th><th>Paquete</th><th>bundleId</th><th>productId</th><th class="text-end">Precio</th></tr></thead>
  <tbody>${filasTabla.map(r => `<tr class="${r.accion === "ADD" ? "add" : "nochange"}">
    <td><span class="carga-acc ${r.accion === "ADD" ? "add" : "nc"}">${r.accion}</span></td>
    <td>${esc(r.nombre)}</td>
    <td class="me-mono">${esc(r.bundleId || "—")}</td>
    <td class="me-mono">${esc(r.productId)}</td>
    <td class="text-end me-mono">${esc(fmtCOP(r.precio))}</td></tr>`).join("")}</tbody>
  <tfoot><tr><th colspan="4" class="text-end">Total de la orden</th>
    <th class="text-end me-mono">${esc(fmtCOP(total))}</th></tr></tfoot>
</table></div>
${repetidos.length ? `<div class="carga-alerta warn"><i class="bi bi-exclamation-triangle-fill"></i>
   ${repetidos.length} paquete(s) ya están activos en la línea (${esc(repetidos.map(p => p.bundleId).join(", "))}).
   El CM los volverá a cargar: confirma que es lo que quieres.</div>` : ""}
${total > TOPE_PRECIO ? `<div class="carga-alerta err"><i class="bi bi-slash-circle-fill"></i>
   <b>Bloqueado.</b> Esta herramienta solo carga paquetes de precio 0. El total es ${esc(fmtCOP(total))} y
   cómo se arma el cobro no está verificado — cargarlo así le cobraría mal al cliente.
   Quita los paquetes con precio o hazlo desde el CM.</div>` : ""}`;

        // El itemGroupId se fija AQUÍ y se reutiliza al enviar: si el cuerpo
        // que se muestra no fuera exactamente el que sale, la revisión no
        // serviría para lo único que existe —revisar—.
        grupoActual = nuevoItemGroupId();
        $("#cargaJson").textContent = JSON.stringify(cuerpoCarrito(ctx, seleccion, grupoActual), null, 2);

        const btn = $("#btnCargaEnviar");
        btn.disabled = total > TOPE_PRECIO;
        btn.innerHTML = total > TOPE_PRECIO
            ? '<i class="bi bi-slash-circle"></i> Bloqueado: la orden tiene costo'
            : `<i class="bi bi-exclamation-triangle-fill"></i> Confirmar y cargar ${seleccion.length} paquete(s) en el CM`;
    }

    /* --- 7.c · Paso 3: resultado ------------------------------------- */
    const ICONO = { espera: "○", curso: "◔", ok: "✓", err: "✕", pendiente: "!", omitido: "–" };

    function pintarTimeline(pasos) {
        const caja = $("#cargaTimeline");
        if (!caja) return;
        caja.innerHTML = pasos.map(p => `<div class="carga-tl ${p.estado}">
  <span class="ic">${ICONO[p.estado] || "○"}</span>
  <span class="tx">${esc(p.texto)}</span>
  <span class="dt">${esc(p.detalle || "")}</span></div>`).join("");
    }

    function pintarSalida(s) {
        const caja = $("#cargaSalida");
        if (!caja) return;
        if (s.error) {
            caja.innerHTML = `<div class="carga-alerta err"><i class="bi bi-x-octagon-fill"></i>
  <b>No se cargó el paquete.</b> ${esc(s.error)}
  <div class="mt-1">El carrito ${s.cartId ? "se borró" : "no llegó a crearse"}.
  <b>No vuelvas a enviar sin revisar antes en el CM</b> si la orden alcanzó a salir: el CM no deduplica.</div></div>`;
            return;
        }
        const nuevos = (s.despues || []).filter(b => !s.antes.includes(b));
        const pedidos = seleccion.map(p => p.bundleId).filter(Boolean);
        const faltan = pedidos.filter(b => !(s.despues || []).includes(b));
        caja.innerHTML = `
<div class="carga-alerta ${faltan.length ? "warn" : "ok"}">
  <i class="bi ${faltan.length ? "bi-hourglass-split" : "bi-check-circle-fill"}"></i>
  ${faltan.length
                ? `Orden creada, pero ${faltan.length} paquete(s) aún no aparecen en la línea. El CM tarda unos segundos: verifica de nuevo.`
                : `Paquete(s) cargado(s) y verificado(s) en la línea.`}
</div>
<dl class="dl-grid mb-2">
  <dt>Orden</dt><dd><span id="cargaOrdenId">${esc(s.orden?.id || "—")}</span>
    <button type="button" class="btn-copy" data-copy-target="cargaOrdenId" title="Copiar número de orden">⧉</button></dd>
  <dt>Fecha de la orden</dt><dd>${esc(s.orden?.orderDate || "—")}</dd>
  <dt>Carrito usado</dt><dd>${esc(s.cartId || "—")} (borrado)</dd>
  <dt>Paquetes antes</dt><dd>${esc(s.antes.join(", ") || "—")}</dd>
  <dt>Paquetes después</dt><dd>${esc((s.despues || []).join(", ") || "— sin verificar —")}</dd>
  <dt>Nuevos en la línea</dt><dd>${nuevos.length ? esc(nuevos.join(", ")) : "—"}</dd>
</dl>
<button class="btn btn-sm btn-me-line" type="button" id="btnCargaVerificar">↻ Verificar de nuevo</button>`;

        const btn = $("#btnCargaVerificar");
        if (btn) btn.addEventListener("click", () => MEUI.conSpinner(btn, "Verificando…", verificarDeNuevo));
    }

    async function verificarDeNuevo() {
        if (!ctx || !ultimaSalida) return;
        try {
            const p = await perfilSuscriptor(ctx.subscriptionId);
            ultimaSalida.despues = p.bundlesActivos;
            ctx.bundlesActivos = p.bundlesActivos;
            const faltan = seleccion.map(x => x.bundleId).filter(b => b && !p.bundlesActivos.includes(b));
            const paso = pasosPintados.find(x => x.clave === "verificar");
            if (paso) {
                paso.estado = faltan.length ? "pendiente" : "ok";
                paso.detalle = faltan.length ? `Aún no aparece(n): ${faltan.join(", ")}` : "Todos los paquetes aparecen activos";
                pintarTimeline(pasosPintados);
            }
            pintarSalida(ultimaSalida);
            if (!faltan.length && typeof alAplicar === "function") alAplicar();
        } catch (e) {
            MEUI.toast("No se pudo verificar: " + e.message, "err");
        }
    }

    /* =====================================================================
       8 · ORQUESTACIÓN DE LA INTERFAZ
    ===================================================================== */
    async function resolverContexto() {
        const subId = fila?.cm?.subscriberId;
        if (!subId) throw new Error("La línea no tiene SubscriptionID en el CM.");

        estado("Resolviendo la línea y su catálogo…", "info");
        const perfil = await perfilSuscriptor(subId);
        if (perfil.pricePlanId == null)
            throw new Error("La línea no tiene plan de precios en el CM.");

        const [quien, oferta] = await Promise.all([
            titular(perfil.accountID || fila.cm.ban),
            ofertaDelPlan(perfil.pricePlanId)
        ]);
        const cat = await catalogoDeOferta(oferta.id);

        ctx = Object.assign({}, perfil, quien, {
            offeringId: oferta.id,
            offeringNombre: oferta.nombre,
            obligatorios: cat.obligatorios,
            elegibles: cat.elegibles
        });
        log(`Catálogo de la oferta ${oferta.id} (${oferta.nombre}): ${cat.elegibles.length} paquetes, `
            + `${cat.obligatorios.length} componente(s) obligatorio(s).`, "info");
        estado(`Oferta <b class="me-mono">${esc(oferta.id)}</b> ${esc(oferta.nombre)} · `
            + `${ctx.elegibles.length} paquetes disponibles · ${ctx.bundlesActivos.length} activos en la línea.`, "info");
    }

    async function abrirPanel() {
        if (ocupado) return;
        panel().classList.remove("d-none");
        $("#btnCargaAbrir").classList.add("d-none");
        irAPaso(1);
        if (ctx) { pintarLista(); pintarSeleccion(); return; }
        ocupado = true;
        try {
            await resolverContexto();
            pintarLista();
            pintarSeleccion();
            $("#cargaBuscar").focus();
        } catch (e) {
            estado(`<i class="bi bi-x-octagon-fill"></i> No se pudo preparar la carga: ${esc(e.message)}`, "err");
            log("✖ Cargar paquete: " + e.message, "err");
        } finally { ocupado = false; }
    }

    function cerrarPanel() {
        panel().classList.add("d-none");
        $("#btnCargaAbrir").classList.remove("d-none");
    }

    async function enviar() {
        if (ocupado || !ctx || !seleccion.length) return;
        ocupado = true;
        const btn = $("#btnCargaEnviar");
        btn.disabled = true;
        irAPaso(3);
        estado("Enviando al CM. No cierres esta ventana.", "warn");
        try {
            ultimaSalida = await ejecutar(ctx, seleccion, grupoActual);
            pintarSalida(ultimaSalida);
            if (!ultimaSalida.error) {
                ctx.bundlesActivos = ultimaSalida.despues || ctx.bundlesActivos;
                estado("Listo. Revisa el resultado y el registro.", "");
                MEUI.toast(`Orden ${ultimaSalida.orden?.id || ""} creada.`, "ok");
                if (typeof alAplicar === "function") alAplicar();
            } else {
                estado("La carga falló. Revisa el registro antes de reintentar.", "err");
                MEUI.toast("No se cargó el paquete. Mira el registro.", "err");
            }
        } finally {
            ocupado = false;
            btn.disabled = false;
        }
    }

    /* =====================================================================
       9 · MONTAJE (lo llama logica-consumos.js al abrir el detalle)
    ===================================================================== */
    function montar(f, opciones) {
        fila = f;
        alAplicar = opciones && opciones.recargar;
        seleccion = [];
        ctx = null;
        ultimaSalida = null;
        pasosPintados = [];

        const wrap = $("#mdCargaWrap");
        if (!wrap) return;
        // Sin línea en el CM no hay nada que cargar: la sección no aparece.
        if (!f || !f.cm || !f.cm.subscriberId) { wrap.style.display = "none"; return; }
        wrap.style.display = "block";
        cerrarPanel();
        irAPaso(1);
        estado("", "");
        if ($("#cargaBuscar")) $("#cargaBuscar").value = "";
        if ($("#cargaLista")) $("#cargaLista").innerHTML = "";
        if ($("#cargaSel")) $("#cargaSel").innerHTML = "";
        if ($("#cargaSalida")) $("#cargaSalida").innerHTML = "";
        if ($("#cargaTimeline")) $("#cargaTimeline").innerHTML = "";
    }

    let cableado = false;

    function cablear() {
        if (cableado) return;             // un segundo cableado duplicaría cada clic
        if (!$("#mdCargaWrap")) return;   // la página no tiene la sección
        cableado = true;

        $("#btnCargaAbrir").addEventListener("click", () =>
            MEUI.conSpinner($("#btnCargaAbrir"), "Cargando catálogo…", abrirPanel));

        let t = null;
        $("#cargaBuscar").addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(pintarLista, 150);
        });

        $("#cargaLista").addEventListener("click", e => {
            const b = e.target.closest(".carga-item");
            if (b) alternar(b.dataset.pid);
        });

        $("#cargaSel").addEventListener("click", e => {
            const b = e.target.closest("[data-quitar]");
            if (b) alternar(b.dataset.quitar);
        });

        $("#btnCargaRevisar").addEventListener("click", () => { pintarRevision(); irAPaso(2); });
        $("#btnCargaVolver").addEventListener("click", () => irAPaso(1));
        $("#btnCargaEnviar").addEventListener("click", enviar);
        $("#btnCargaCancelar").addEventListener("click", cerrarPanel);
        $("#btnCargaCerrar").addEventListener("click", cerrarPanel);
        $("#btnCargaOtro").addEventListener("click", () => {
            seleccion = [];
            ultimaSalida = null;
            $("#cargaSalida").innerHTML = "";
            $("#cargaTimeline").innerHTML = "";
            pintarLista();
            pintarSeleccion();
            irAPaso(1);
            $("#cargaBuscar").focus();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cablear);
    else cablear();

    global.MEPAQ = { montar, CANAL, TOPE_PRECIO };
})(window);
