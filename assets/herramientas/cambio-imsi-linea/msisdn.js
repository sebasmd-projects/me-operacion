/* =====================================================================
   msisdn.js · Motor de «Cambio de línea»: Cambio MSISDN Claro|Tigo en el CM, en masivo
   ---------------------------------------------------------------------
   Entrada: un renglón por cambio, `linea;linea_nueva` (cualquier
   separador), escrito o desde un Excel/CSV.

   Es la orden de la interfaz del CM para «cambio de número»: una
   PortInExistingSubscription (captura «cambio de numero.har»). Queda en
   «Order Created»: es una portabilidad y el número cambia cuando se
   completa, no en el momento.

   Por renglón se valida ANTES de dejarlo marcar:
     · la línea existe, está ACTIVA y tiene SIM
     · la línea nueva es un móvil de 10 dígitos, distinto de la actual
     · la línea nueva no es ya una línea ACTIVA de Móvil Éxito
     · la cuenta no tiene otro cambio de número o portabilidad pendiente
       (lo mismo que revisa la interfaz del CM antes de dejar pedirlo)
     · ni la línea ni la línea nueva se repiten en la tanda

   Lo compartido (resolver la línea, órdenes, tabla con casillas) está en
   cm-lineas.js; la interfaz y las pestañas en cambio-imsi-linea.js.

   Se publica como window.CambioMSISDN (envuelto en una función: las dos
   herramientas conviven en la misma página y comparten nombres internos).
===================================================================== */
(function () {
    "use strict";
    const L = window.CMLineas;

    const CONFIG = {
        maxCambios: 100,
        concurrenciaConsulta: 4,
        tiposPendientes: ["ChangeMSISDN", "portInExistingSubscription"]
    };

    const PROCESO = {
        PENDIENTE: "Pendiente", CONSULTANDO: "Consultando", LISTA: "Lista",
        NO_APLICA: "No se puede", ERROR: "Error de consulta",
        ENVIANDO: "Enviando", SOLICITADA: "Solicitada", CAMBIADA: "Cambiada", FALLO: "Falló"
    };

    const normalizarLinea = v => {
        let d = L.soloDigitos(v);
        if (/^57(3\d{9})$/.test(d)) d = d.slice(2);
        return d;
    };
    const esMovil = d => /^3\d{9}$/.test(d);

    /**
     * `linea;linea_nueva`, uno por renglón. Acepta `;` `,` tabulación, `|` o
     * espacios, y salta un encabezado si lo hay. Devuelve los renglones
     * válidos y los que no se pudieron leer, con el motivo.
     */
    function leerEntrada(texto) {
        const renglones = String(texto || "").split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        const cambios = [], malos = [];
        renglones.forEach((t, i) => {
            const partes = t.split(/\s*[;,\t|]\s*|\s+/).filter(Boolean);
            if (i === 0 && partes.length && !/\d/.test(partes[0])) return;      // encabezado
            const linea = normalizarLinea(partes[0]);
            const nueva = normalizarLinea(partes[1]);
            if (!esMovil(linea)) { malos.push({ texto: t, motivo: "la línea debe ser un móvil de 10 dígitos" }); return; }
            if (!esMovil(nueva)) { malos.push({ texto: t, motivo: "la línea nueva debe ser un móvil de 10 dígitos" }); return; }
            cambios.push({ msisdn: linea, nueva });
        });
        return { cambios, malos };
    }

    /** Excel/CSV → texto `linea;nueva`. Toma las dos primeras celdas con valor
     *  de cada fila (el encabezado, si lo hay, lo salta leerEntrada). */
    function textoDesdeHoja(filas) {
        return filas
            .map(f => (f || []).map(c => String(c ?? "").trim()).filter(Boolean).slice(0, 2))
            .filter(p => p.length)
            .map(p => p.join(";"))
            .join("\n");
    }

    const filaNueva = c => ({
        msisdn: c.msisdn, nueva: c.nueva, proceso: PROCESO.PENDIENTE, detalle: "",
        ban: "", subscriberId: "", estado: null, estadoTexto: "", cuentas: 0, simId: "",
        nuevaEnCm: "", orden: "", estadoOrden: ""
    });

    /** Marca como «no se puede» con el motivo, y la bloquea en la tabla. */
    function noAplica(f, motivo) {
        Object.assign(f, { proceso: PROCESO.NO_APLICA, detalle: motivo, bloqueada: true, sel: false });
        return f;
    }

    /** Consulta la línea, la línea nueva y las órdenes pendientes. */
    async function consultarFila(f) {
        f.proceso = PROCESO.CONSULTANDO;
        try {
            if (f.nueva === f.msisdn) return noAplica(f, "La línea nueva es la misma línea.");
            const [r, rn] = await Promise.all([L.resolverLinea(f.msisdn), L.resolverLinea(f.nueva)]);
            if (!r) return noAplica(f, "La línea no existe en el CM.");
            const c = r.elegida;
            Object.assign(f, {
                ban: c.ban, subscriberId: c.subscriberId, estado: c.estado, estadoTexto: c.estadoTexto,
                cuentas: r.cuentas.length, simId: c.simId, _linea: c, bloqueada: false, detalle: ""
            });
            f.nuevaEnCm = rn ? rn.elegida.estadoTexto : "No está en el CM";

            if (c.estado !== 1) return noAplica(f, `La línea está ${c.estadoTexto.toLowerCase()}: el cambio de número se hace sobre una línea activa.`);
            if (!c.simId) return noAplica(f, "La línea no tiene SIM (cardPackageID) en el CM.");
            if (rn && rn.cuentas.some(x => x.estado === 1)) {
                return noAplica(f, `La línea nueva ${f.nueva} ya es una línea activa de Móvil Éxito (cuenta ${rn.elegida.ban}).`);
            }
            const pendientes = await L.ordenesPendientes(c.ban, CONFIG.tiposPendientes);
            if (pendientes.length) {
                return noAplica(f, `La cuenta ya tiene un cambio de número pendiente: ${pendientes.map(o => `${o.id} (${o.tipo}, ${o.estado})`).join(", ")}.`);
            }
            f.proceso = PROCESO.LISTA;
            if (r.cuentas.length > 1) f.detalle = `Tiene ${r.cuentas.length} suscripciones; se usa la activa ${c.ban}.`;
        } catch (e) {
            Object.assign(f, { proceso: PROCESO.ERROR, detalle: L.textoError(e), bloqueada: true, sel: false });
        }
        return f;
    }

    /** La misma línea o la misma línea nueva dos veces en la tanda: solo vale la primera. */
    function marcarRepetidos(filas) {
        const lineas = new Set(), nuevas = new Set();
        filas.forEach(f => {
            if (lineas.has(f.msisdn)) noAplica(f, "La línea se repite en la tanda: solo se toma el primer renglón.");
            else if (nuevas.has(f.nueva)) noAplica(f, "La línea nueva se repite en la tanda: no se puede asignar a dos líneas.");
            lineas.add(f.msisdn); nuevas.add(f.nueva);
        });
    }

    /** Envía la orden y relee la línea. */
    async function cambiarFila(f, nota, alPaso) {
        f.proceso = PROCESO.ENVIANDO;
        const r = await L.cambiarMsisdn(f._linea, f.nueva, nota, alPaso);
        f.orden = r.ordenId; f.estadoOrden = r.estado; f.evidencia = r.evidencia;

        if (!r.ok) { f.proceso = PROCESO.FALLO; f.detalle = r.detalle; f.bloqueada = !!r.ordenId; f.sel = false; return f; }

        if (alPaso) alPaso("Verificando en el CM…");
        await new Promise(res => setTimeout(res, 2000));
        const ahora = await L.resolverLinea(f.nueva).catch(() => null);
        const yaCambio = !!ahora && ahora.cuentas.some(x => x.subscriberId === f.subscriberId && x.estado === 1);
        f.proceso = yaCambio ? PROCESO.CAMBIADA : PROCESO.SOLICITADA;
        f.detalle = r.detalle + (yaCambio ? ` · la suscripción ya tiene el número ${f.nueva}` : "");
        f.bloqueada = true; f.sel = false;   // hecha: no se vuelve a mandar
        return f;
    }

    /* =====================================================================
       Exportación
    ===================================================================== */
    const CABECERA = ["Línea", "Línea nueva", "Proceso", "Estado de la línea", "Línea nueva en el CM", "Cuenta (BAN)",
        "SubscriptionID", "SIM (ICCID)", "Orden", "Estado de la orden", "Detalle"];

    function filasExport(filas) {
        return {
            head: CABECERA,
            rows: filas.map(f => [f.msisdn, f.nueva, f.proceso, f.estadoTexto || "", f.nuevaEnCm || "", f.ban,
                f.subscriberId, f.simId || "", f.orden || "", f.estadoOrden || "", f.detalle || ""])
        };
    }

    function filasBitacora(bitacora) {
        return {
            head: ["Fecha/hora", "Usuario", "Línea", "Línea nueva", "Nota", "Resultado", "Orden",
                "Estado de la orden", "Detalle", "Carrito (request)", "Carrito (response)", "Orden (request)", "Orden (response)"],
            rows: bitacora.map(b => [b.hora, b.usuario, b.msisdn, b.nueva, b.nota, b.ok ? "OK" : "FALLA",
                b.orden || "", b.estadoOrden || "", b.detalle || "",
                JSON.stringify(b.evidencia?.carrito?.request || ""), JSON.stringify(b.evidencia?.carrito?.response || ""),
                JSON.stringify(b.evidencia?.orden?.request || ""), JSON.stringify(b.evidencia?.orden?.response || "")])
        };
    }

    /** Revalida justo antes de enviar: entre la validación y la ejecución pudo
     *  aparecer otra orden de cambio de número en la cuenta. Devuelve el motivo
     *  por el que ya no aplica, o "" si sigue vigente. */
    async function revalidarAntesDeEnviar(f) {
        const pend = await L.ordenesPendientes(f.ban, CONFIG.tiposPendientes);
        if (pend.length) return `Al momento de enviar, la cuenta ya tenía un cambio de número pendiente (${pend.map(o => o.id).join(", ")}).`;
        return "";
    }

    /** Campos de la fila que van a la bitácora (el resto lo pone la interfaz). */
    const registroBitacora = f => ({
        msisdn: f.msisdn, nueva: f.nueva, ok: [PROCESO.CAMBIADA, PROCESO.SOLICITADA].includes(f.proceso),
        orden: f.orden, estadoOrden: f.estadoOrden, detalle: f.detalle, evidencia: f.evidencia
    });

    window.CambioMSISDN = {
        CONFIG, PROCESO, procesosOk: [PROCESO.CAMBIADA, PROCESO.SOLICITADA], leerEntrada, textoDesdeHoja, filaNueva,
        consultarFila, marcarRepetidos, noAplica, revalidarAntesDeEnviar, cambiarFila, registroBitacora,
        filasExport, filasBitacora
    };
})();
