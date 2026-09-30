/* =====================================================================
   logica-cambio-imsi.js · Cambio de IMSI (SIM) en el CM, en masivo
   ---------------------------------------------------------------------
   Entrada: un renglón por cambio, `linea;imsi_nuevo`.
   Por renglón se valida ANTES de dejarlo marcar:
     · la línea existe y está ACTIVA
     · la IMSI nueva existe en el inventario y está DISPONIBLE
       (cardPackage.state = 1). Una IMSI que salió de una línea
       inactivada queda en HELD: hay que liberarla en el BSS primero.
     · la IMSI nueva no es la que ya tiene la línea
     · ni la línea ni la IMSI nueva se repiten en la tanda
   Y al ejecutar: carrito ChangeSim → orden → seguimiento → se borra el
   carrito, con la NOTA obligatoria (usuario + motivo). Después se vuelve
   a consultar la línea para confirmar que quedó con la SIM nueva.

   Lo compartido (resolver la línea, órdenes, tabla con casillas) está en
   cm-lineas.js; el enganche con la interfaz en me-cambio-imsi-puente.js.
===================================================================== */
const L = window.CMLineas;

const CONFIG = {
    maxCambios: 100,
    concurrenciaConsulta: 4,
    largoImsi: 15
};

const PROCESO = {
    PENDIENTE: "Pendiente", CONSULTANDO: "Consultando", LISTA: "Lista",
    NO_APLICA: "No se puede", ERROR: "Error de consulta",
    ENVIANDO: "Enviando", CAMBIADA: "Cambiada",
    PENDIENTE_CM: "Orden OK, CM sin reflejar", FALLO: "Falló"
};

/**
 * `linea;imsi_nuevo`, uno por renglón. Acepta `;` `,` tabulación, `|` o
 * espacios, y salta un encabezado si lo hay. Devuelve los renglones
 * válidos y los que no se pudieron leer, con el motivo.
 */
function leerEntrada(texto) {
    const renglones = String(texto || "").split(/\r?\n/).map(t => t.trim()).filter(Boolean);
    const cambios = [], malos = [];
    renglones.forEach((t, i) => {
        const partes = t.split(/\s*[;,\t|]\s*|\s+/).filter(Boolean);
        if (i === 0 && partes.length && !/\d/.test(partes[0])) return;      // encabezado
        let linea = L.soloDigitos(partes[0]);
        const imsi = L.soloDigitos(partes[1]);
        if (/^57(3\d{9})$/.test(linea)) linea = linea.slice(2);
        if (!/^3\d{9}$/.test(linea)) { malos.push({ texto: t, motivo: "la línea debe ser un móvil de 10 dígitos" }); return; }
        if (imsi.length !== CONFIG.largoImsi) { malos.push({ texto: t, motivo: `la IMSI nueva debe tener ${CONFIG.largoImsi} dígitos` }); return; }
        cambios.push({ msisdn: linea, imsiNueva: imsi });
    });
    return { cambios, malos };
}

const filaNueva = c => ({
    msisdn: c.msisdn, imsiNueva: c.imsiNueva, proceso: PROCESO.PENDIENTE, detalle: "",
    ban: "", subscriberId: "", estado: null, estadoTexto: "", cuentas: 0,
    simId: "", imsiActual: "", simActualEstado: "", simNuevaEstado: "", orden: "", estadoOrden: ""
});

/** Marca como «no se puede» con el motivo, y la bloquea en la tabla. */
function noAplica(f, motivo) {
    Object.assign(f, { proceso: PROCESO.NO_APLICA, detalle: motivo, bloqueada: true, sel: false });
    return f;
}

/** Consulta la línea y la IMSI nueva, y valida el cambio. */
async function consultarFila(f) {
    f.proceso = PROCESO.CONSULTANDO;
    try {
        const r = await L.resolverLinea(f.msisdn);
        if (!r) return noAplica(f, "La línea no existe en el CM.");
        const c = r.elegida;
        Object.assign(f, {
            ban: c.ban, subscriberId: c.subscriberId, estado: c.estado, estadoTexto: c.estadoTexto,
            cuentas: r.cuentas.length, simId: c.simId, _linea: c, bloqueada: false, detalle: ""
        });

        const [actual, nueva] = await Promise.all([L.simDe(c.simId), L.simDe(f.imsiNueva)]);
        f.imsiActual = actual.existe ? (actual.imsi || actual.id) : c.simId;
        f.simActualEstado = actual.existe ? actual.estadoTexto : (actual.detalle || "—");
        f.simNuevaEstado = nueva.existe ? nueva.estadoTexto : (nueva.detalle || "—");
        f._simNueva = nueva;

        if (c.estado !== 1) return noAplica(f, `La línea está ${c.estadoTexto.toLowerCase()}: el cambio de SIM se hace sobre una línea activa.`);
        if (!nueva.existe) return noAplica(f, `La IMSI nueva ${f.imsiNueva} ${nueva.detalle || "no existe en el inventario"}.`);
        if (f.imsiNueva === f.imsiActual || nueva.identificador === c.simId) return noAplica(f, "La IMSI nueva es la que la línea ya tiene.");
        if (!nueva.disponible) {
            // En uso = la tiene otra línea. Cualquier otro estado es el caso
            // típico de una IMSI que salió de una línea inactivada (HELD).
            return noAplica(f, Number(nueva.estado) === 2
                ? "La IMSI nueva está en uso: la tiene asignada otra línea."
                : `La IMSI nueva no está disponible (${nueva.estadoTexto}). Si salió de una línea inactivada `
                + "quedó en HELD: hay que pasarla a disponible en el BSS antes del cambio.");
        }
        f.proceso = PROCESO.LISTA;
        if (r.cuentas.length > 1) f.detalle = `Tiene ${r.cuentas.length} suscripciones; se usa la activa ${c.ban}.`;
    } catch (e) {
        Object.assign(f, { proceso: PROCESO.ERROR, detalle: L.textoError(e), bloqueada: true, sel: false });
    }
    return f;
}

/** La misma línea o la misma IMSI nueva dos veces en la tanda: solo vale la primera. */
function marcarRepetidos(filas) {
    const lineas = new Set(), imsis = new Set();
    filas.forEach(f => {
        if (lineas.has(f.msisdn)) noAplica(f, "La línea se repite en la tanda: solo se toma el primer renglón.");
        else if (imsis.has(f.imsiNueva)) noAplica(f, "La IMSI nueva se repite en la tanda: no se puede asignar a dos líneas.");
        lineas.add(f.msisdn); imsis.add(f.imsiNueva);
    });
}

/** Ejecuta el cambio y confirma contra el CM. */
async function cambiarFila(f, nota, alPaso) {
    f.proceso = PROCESO.ENVIANDO;
    f.imsiAntes = f.imsiActual;
    const r = await L.cambiarImsi(f._linea, f._simNueva, nota, alPaso);
    f.orden = r.ordenId; f.estadoOrden = r.estado; f.evidencia = r.evidencia;

    if (!r.ok) { f.proceso = PROCESO.FALLO; f.detalle = r.detalle; return f; }

    if (alPaso) alPaso("Verificando en el CM…");
    await new Promise(res => setTimeout(res, 2000));
    const linea = await L.resolverLinea(f.msisdn).catch(() => null);
    const ahora = linea ? linea.elegida.simId : "";
    const [nueva, vieja] = await Promise.all([L.simDe(f.imsiNueva), L.simDe(f.imsiAntes)]);
    f.simNuevaEstado = nueva.existe ? nueva.estadoTexto : "—";
    f.simAnteriorEstado = vieja.existe ? vieja.estadoTexto : "—";
    const quedo = !!ahora && (ahora === f._simNueva.identificador || ahora === f.imsiNueva);
    if (quedo) { f.imsiActual = f.imsiNueva; f.simId = ahora; }
    f.proceso = quedo ? PROCESO.CAMBIADA : PROCESO.PENDIENTE_CM;
    f.detalle = `${r.detalle}. Ahora la línea tiene ${ahora || "—"} · IMSI anterior ${f.imsiAntes}: ${f.simAnteriorEstado}`
        + (quedo ? "" : " · el CM aún no refleja la SIM nueva: vuelve a consultar en un momento");
    f.bloqueada = true; f.sel = false;   // hecha: no se vuelve a mandar
    return f;
}

/* =====================================================================
   Exportación
===================================================================== */
const CABECERA = ["Línea", "IMSI nueva", "Proceso", "Estado de la línea", "Cuenta (BAN)", "SubscriptionID",
    "IMSI actual", "Estado IMSI actual", "Estado IMSI nueva", "IMSI anterior", "Estado IMSI anterior",
    "Orden", "Estado de la orden", "Detalle"];

function filasExport(filas) {
    return {
        head: CABECERA,
        rows: filas.map(f => [f.msisdn, f.imsiNueva, f.proceso, f.estadoTexto || "", f.ban, f.subscriberId,
            f.imsiActual || "", f.simActualEstado || "", f.simNuevaEstado || "", f.imsiAntes || "",
            f.simAnteriorEstado || "", f.orden || "", f.estadoOrden || "", f.detalle || ""])
    };
}

function filasBitacora(bitacora) {
    return {
        head: ["Fecha/hora", "Usuario", "Línea", "IMSI anterior", "IMSI nueva", "Nota", "Resultado", "Orden",
            "Estado de la orden", "Detalle", "Carrito (request)", "Carrito (response)", "Orden (request)", "Orden (response)"],
        rows: bitacora.map(b => [b.hora, b.usuario, b.msisdn, b.imsiAntes, b.imsiNueva, b.nota, b.ok ? "OK" : "FALLA",
            b.orden || "", b.estadoOrden || "", b.detalle || "",
            JSON.stringify(b.evidencia?.carrito?.request || ""), JSON.stringify(b.evidencia?.carrito?.response || ""),
            JSON.stringify(b.evidencia?.orden?.request || ""), JSON.stringify(b.evidencia?.orden?.response || "")])
    };
}
