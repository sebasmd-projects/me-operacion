/* =====================================================================
   logica-estado-lineas.js · Bloquear / inactivar líneas en el CM (masivo)
   ---------------------------------------------------------------------
   Por línea: se resuelve en el CM (cuenta, estado, SIM/IMSI y su estado
   en el inventario) y, sobre las que se marquen en la tabla, se envía la
   orden `ChangeSubscriptionState` y se sigue hasta su estado final. Al
   terminar se vuelve a consultar la línea para mostrar su estado REAL.

   Lo que hay que saber al inactivar: la IMSI de la línea pasa a HELD en el
   inventario y no queda libre sola. Para volver a usarla (p. ej. en un
   cambio de IMSI) hay que pasarla a disponible A MANO en el BSS.

   Lo compartido (resolver la línea, órdenes, tabla con casillas) está en
   cm-lineas.js; el enganche con la interfaz en me-estado-lineas-puente.js.
===================================================================== */
const L = window.CMLineas;

const CONFIG = {
    maxLineas: 200,
    concurrenciaConsulta: 4
};

/* Estados del PROCESO de cada fila (columna «Proceso» y su filtro). */
const PROCESO = {
    PENDIENTE: "Pendiente", CONSULTANDO: "Consultando", LISTA: "Lista",
    NO_EXISTE: "No existe", ERROR: "Error de consulta",
    ENVIANDO: "Enviando", CAMBIADA: "Cambiada", SIN_CAMBIO: "Ya estaba así",
    PENDIENTE_CM: "Orden OK, CM sin reflejar", FALLO: "Falló"
};

/** Fila vacía de una línea antes de consultarla. */
const filaNueva = msisdn => ({
    msisdn, proceso: PROCESO.PENDIENTE, detalle: "", ban: "", subscriberId: "",
    estado: null, estadoTexto: "", cuentas: 0, simId: "", imsi: "", simEstadoTexto: "",
    orden: "", estadoOrden: ""
});

/** Consulta una línea y deja la fila lista para operar (o bloqueada). */
async function consultarFila(f) {
    f.proceso = PROCESO.CONSULTANDO;
    try {
        const r = await L.resolverLinea(f.msisdn);
        if (!r) {
            Object.assign(f, { proceso: PROCESO.NO_EXISTE, detalle: "La línea no existe en el CM.", bloqueada: true, sel: false });
            return f;
        }
        const c = r.elegida;
        Object.assign(f, {
            ban: c.ban, subscriberId: c.subscriberId, estado: c.estado, estadoTexto: c.estadoTexto,
            cuentas: r.cuentas.length, simId: c.simId, bloqueada: false, detalle: "",
            _linea: c
        });
        if (r.cuentas.length > 1) {
            f.detalle = `Tiene ${r.cuentas.length} suscripciones; se usa ${c.ban} (${c.estadoTexto}).`;
        }
        const sim = await L.simDe(c.simId);
        f.imsi = sim.existe ? (sim.imsi || sim.id) : c.simId;
        f.simEstado = sim.estado;
        f.simEstadoTexto = sim.existe ? sim.estadoTexto : (sim.detalle || "—");
        f.proceso = PROCESO.LISTA;
    } catch (e) {
        Object.assign(f, { proceso: PROCESO.ERROR, detalle: L.textoError(e), bloqueada: true, sel: false });
    }
    return f;
}

/**
 * Aplica el cambio de estado a una fila ya consultada y la vuelve a
 * consultar. `destino` = "bloquear" | "inactivar".
 */
async function cambiarFila(f, destino, razon, nota, alPaso) {
    const d = L.DESTINOS_ESTADO[destino];
    // Si ya está en el estado destino, no se manda nada: la orden fallaría
    // o, peor, quedaría registrada una operación que no hizo nada.
    if (Number(f.estado) === d.estadoCm) {
        f.proceso = PROCESO.SIN_CAMBIO;
        f.detalle = `Ya estaba ${d.resultado.toLowerCase()}: no se envió nada.`;
        return f;
    }
    f.proceso = PROCESO.ENVIANDO;
    f.estadoAntes = f.estadoTexto;
    f.imsiAntes = f.imsi; f.simEstadoAntes = f.simEstadoTexto;
    const r = await L.cambiarEstado(f._linea, destino, razon, nota, alPaso);
    f.orden = r.ordenId; f.estadoOrden = r.estado; f.evidencia = r.evidencia;
    f.accion = d.etiqueta; f.razon = razon;

    if (!r.ok) {
        f.proceso = PROCESO.FALLO;
        f.detalle = r.detalle;
        return f;
    }
    // Se vuelve a leer la línea: el estado de la tabla es el que tiene
    // AHORA en el CM, no el que se pidió.
    if (alPaso) alPaso("Verificando en el CM…");
    await new Promise(res => setTimeout(res, 2000));
    await consultarFila(f);
    const quedo = Number(f.estado) === d.estadoCm;
    f.proceso = quedo ? PROCESO.CAMBIADA : PROCESO.PENDIENTE_CM;
    f.detalle = `${r.detalle}. Ahora: ${f.estadoTexto}`
        + (destino === "inactivar" ? ` · IMSI ${f.imsi}: ${f.simEstadoTexto} (para reutilizarla hay que liberarla en el BSS)` : "")
        + (quedo ? "" : " · el CM aún no refleja el cambio: vuelve a consultar en un momento");
    return f;
}

/* =====================================================================
   Exportación
===================================================================== */
const CABECERA = ["Línea", "Proceso", "Estado en el CM", "Cuenta (BAN)", "SubscriptionID", "Suscripciones",
    "IMSI", "Estado de la IMSI", "Acción", "Razón", "Estado antes", "Orden", "Estado de la orden", "Detalle"];

function filasExport(filas) {
    return {
        head: CABECERA,
        rows: filas.map(f => [f.msisdn, f.proceso, f.estadoTexto || "", f.ban, f.subscriberId, f.cuentas || "",
            f.imsi, f.simEstadoTexto || "", f.accion || "", f.razon || "", f.estadoAntes || "",
            f.orden || "", f.estadoOrden || "", f.detalle || ""])
    };
}

/** Bitácora con la petición y la respuesta de cada orden enviada. */
function filasBitacora(bitacora) {
    return {
        head: ["Fecha/hora", "Usuario", "Línea", "Acción", "Razón", "Nota", "Resultado", "Orden",
            "Estado de la orden", "Detalle", "Request", "Response"],
        rows: bitacora.map(b => [b.hora, b.usuario, b.msisdn, b.accion, b.razon, b.nota, b.ok ? "OK" : "FALLA",
            b.orden || "", b.estadoOrden || "", b.detalle || "",
            JSON.stringify(b.evidencia?.orden?.request || ""), JSON.stringify(b.evidencia?.orden?.response || "")])
    };
}
