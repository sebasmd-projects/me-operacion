/* =====================================================================
   estado-lineas.js · Bloquear / inactivar líneas en el CM (masivo)
   ---------------------------------------------------------------------
   Por línea: se resuelve en el CM (cuenta, estado, SIM/IMSI y su estado
   en el inventario) y, sobre las que se marquen en la tabla, se envía la
   orden `ChangeSubscriptionState` y se sigue hasta su estado final. Al
   terminar se vuelve a consultar la línea para mostrar su estado REAL.

   Lo que hay que saber al inactivar: la IMSI de la línea pasa a HELD en el
   inventario y no queda libre sola. Para volver a usarla (p. ej. en un
   cambio de IMSI) hay que pasarla a disponible A MANO en el BSS.

   Contenido:
     1 · Configuración y constantes
     2 · Reglas de negocio (consultar y cambiar el estado de una línea)
     3 · Interfaz (tabla, filtros, ejecución y exportaciones)

   Va al final del <body>, después de cm-lineas.js (lo compartido: resolver
   la línea, órdenes, tabla con casillas).
===================================================================== */
(function () {
    "use strict";

    if (!window.CMLineas) {
        MEUI.log("No cargó cm-lineas.js: la herramienta queda inutilizable.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }

    /* =================================================================
       1 · Configuración y constantes
    ================================================================= */
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

    /* Insignia de color de cada proceso / estado del CM / estado de la IMSI. */
    const CLASE_PROCESO = {
        [PROCESO.LISTA]: "info", [PROCESO.CAMBIADA]: "ok", [PROCESO.SIN_CAMBIO]: "neutro",
        [PROCESO.PENDIENTE_CM]: "warn", [PROCESO.FALLO]: "err", [PROCESO.ERROR]: "err",
        [PROCESO.NO_EXISTE]: "err", [PROCESO.ENVIANDO]: "info", [PROCESO.CONSULTANDO]: "neutro"
    };
    const CLASE_ESTADO = { Activa: "ok", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const CLASE_SIM = { Disponible: "ok", "En uso": "info" };

    const FILTROS = {
        estado: "#fEstado", proceso: "#fProceso", sel: "#fSel", verOcultas: "#chkVerOcultas"
    };

    /* Cabecera de la exportación (CSV / Excel). */
    const CABECERA = ["Línea", "Proceso", "Estado en el CM", "Cuenta (BAN)", "SubscriptionID", "Suscripciones",
        "IMSI", "Estado de la IMSI", "Acción", "Razón", "Estado antes", "Orden", "Estado de la orden", "Detalle"];

    /* =================================================================
       2 · Reglas de negocio
    ================================================================= */
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

    /* =================================================================
       3 · Interfaz
    ================================================================= */
    const el = id => document.getElementById(id);

    const bitacora = [];
    let corriendo = false;

    /* --- Tabla ------------------------------------------------------- */

    const tabla = L.tablaSeleccionable({
        tabla: "#tablaLineas", vacio: "#msgVacio", filtros: FILTROS, lote: "#barraLote", columnasControl: "#fColumnas",
        textoDe: f => [f.msisdn, f.ban, f.subscriberId, f.imsi, f.orden, f.detalle, f.estadoTexto, f.proceso].join(" "),
        alCambiar: actualizar,
        columnas: [
            { t: "Línea", txt: f => f.msisdn, render: f => MEUI.copiable(f.msisdn, "línea") },
            { t: "Estado en el CM", txt: f => f.estadoTexto, render: f => f.estadoTexto ? L.badge(f.estadoTexto, CLASE_ESTADO[f.estadoTexto]) : "—" },
            { t: "Proceso", txt: f => f.proceso, render: f => L.badge(f.proceso, CLASE_PROCESO[f.proceso]) },
            {
                t: "Cuenta (BAN)", txt: f => f.ban,
                render: f => MEUI.copiable(f.ban, "BAN")
                    + (f.cuentas > 1 ? ` <span title="Tiene ${f.cuentas} suscripciones" style="color:var(--me-warn)">⚠</span>` : "")
            },
            { t: "IMSI", txt: f => f.imsi, render: f => MEUI.copiable(f.imsi, "IMSI") },
            {
                t: "Estado IMSI", txt: f => f.simEstadoTexto,
                render: f => f.simEstadoTexto ? L.badge(f.simEstadoTexto, CLASE_SIM[f.simEstadoTexto] || "warn") : "—"
            },
            { t: "Orden", txt: f => f.orden, render: f => `<span class="me-mono">${MEUI.esc(f.orden || "")}</span>` },
            { t: "Detalle", txt: f => f.detalle, orden: false, render: f => `<div class="celda-detalle">${MEUI.esc(f.detalle || "")}</div>` }
        ]
    });
    L.engancharLote(tabla, FILTROS);

    /* --- Contadores, filtros y botón de ejecutar -------------------- */
    function actualizar() {
        const filas = tabla.filas();
        el("kTotal").textContent = filas.length;
        el("kSel").textContent = tabla.marcadas().length;
        el("kOk").textContent = filas.filter(f => f.proceso === PROCESO.CAMBIADA).length;
        el("kErr").textContent = filas.filter(f => [PROCESO.FALLO, PROCESO.ERROR, PROCESO.NO_EXISTE].includes(f.proceso)).length;
        el("numOcultas").textContent = filas.filter(f => f.oculta).length;
        el("resumenSeleccion").textContent = `${tabla.marcadas().length} de ${filas.length} marcadas · ${tabla.visibles().length} visibles`;
        pintarAccion();
    }

    function pintarAccion() {
        const puede = L.puedeOperar();
        el("accionCampos").hidden = !puede;
        el("accionBloqueada").hidden = puede;
        if (!puede) {
            el("btnEjecutar").disabled = true;
            el("accionBloqueada").innerHTML = `<b>Solo consulta.</b> No se puede cambiar el estado: ${MEUI.esc(L.motivoSinPermiso())}.`;
            return;
        }
        const destino = el("selDestino").value;
        el("avisoHeld").hidden = destino !== "inactivar";
        el("vistaNota").textContent = `"${L.notaDe(el("inputNota").value)}"`;

        const d = L.DESTINOS_ESTADO[destino];
        const marcadas = tabla.marcadas();
        const aplican = marcadas.filter(f => Number(f.estado) !== d.estadoCm);
        el("resumenAccion").textContent = marcadas.length
            ? `${aplican.length} de ${marcadas.length} marcada(s) cambiarían a ${d.resultado}`
            + (marcadas.length - aplican.length ? ` · ${marcadas.length - aplican.length} ya lo están` : "")
            : "Marca en la tabla las líneas a cambiar.";
        const btn = el("btnEjecutar");
        if (!btn.dataset.meOcupado) btn.disabled = corriendo || !aplican.length;
        btn.textContent = aplican.length ? `${d.etiqueta} ${aplican.length} línea(s)` : "Aplicar a las marcadas";
    }


    el("selDestino").addEventListener("change", () => {
        // La razón sigue al estado mientras nadie la haya escrito a mano.
        const inp = el("inputRazon");
        if (!inp.dataset.editada) inp.value = L.DESTINOS_ESTADO[el("selDestino").value].razon;
        pintarAccion();
    });
    el("inputRazon").addEventListener("input", () => { el("inputRazon").dataset.editada = "1"; pintarAccion(); });
    el("inputNota").addEventListener("input", pintarAccion);

    L.engancharSesionCm(actualizar);
    L.engancharRegistro();

    /* --- Consulta ------------------------------------------------------ */
    function lineasEscritas() {
        return MEUI.parseLineas(el("inputLineas").value, { min: 10, max: 10 });
    }
    el("inputLineas").addEventListener("input", () => {
        const e = lineasEscritas();
        el("infoLineas").textContent = `${e.lineas.length} línea(s) válida(s) · ${e.descartadas.length} descartada(s) · máximo ${CONFIG.maxLineas}`;
    });
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    async function consultarTodas(filas) {
        MEUI.progreso.iniciar(filas.length, "Validando líneas");
        MEUI.estadoTabla("#tablaLineas", "cargando");
        let i = 0, hechos = 0;
        const trabajar = async () => {
            while (i < filas.length) {
                await consultarFila(filas[i++]);
                MEUI.progreso.avanzar(++hechos);
                tabla.redibujar(true);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONFIG.concurrenciaConsulta, filas.length) }, trabajar));
        tabla.opcionesFiltro("#fEstado", "estadoTexto");
        tabla.opcionesFiltro("#fProceso", "proceso");
        tabla.redibujar(true);
        const fallidas = filas.filter(f => f.proceso === PROCESO.ERROR);
        const reintentar = async () => {
            if (corriendo || !MEAPI.auth.token) return;
            const pendientes = fallidas.filter(f => tabla.filas().includes(f) && f.proceso === PROCESO.ERROR && !f.orden);
            if (!pendientes.length) return;
            corriendo = true; actualizar();
            try { await consultarTodas(pendientes); }
            finally { corriendo = false; actualizar(); }
        };
        MEUI.estadoTabla("#tablaLineas", fallidas.length === filas.length && filas.length ? "error" : "listo",
            { mensaje: "No se pudieron consultar las líneas.", reintentar });
        MEUI.progreso.fin({ ok: fallidas.length === 0, fallidas: fallidas.length, reintentar });
    }

    el("btnConsultar").addEventListener("click", async () => {
        const btn = el("btnConsultar");
        const soltar = () => { btn.disabled = false; };   // libera el autoSpinner
        if (corriendo) return soltar();
        const e = lineasEscritas();
        if (!e.lineas.length) { MEUI.toast("No hay líneas válidas.", "warn"); return soltar(); }
        if (e.lineas.length > CONFIG.maxLineas) { MEUI.toast(`Máximo ${CONFIG.maxLineas} líneas.`, "warn"); return soltar(); }
        if (!MEAPI.auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); return soltar(); }

        corriendo = true;
        try {
            if (e.descartadas.length) MEUI.log("No se consultan (no son móviles de 10 dígitos): " + e.descartadas.slice(0, 15).join(", "), "warn");
            const filas = tabla.poner(e.lineas.map(filaNueva));
            MEUI.log(`Consultando ${filas.length} línea(s)…`);
            await consultarTodas(filas);
            tabla.opcionesFiltro("#fEstado", "estadoTexto");
            tabla.opcionesFiltro("#fProceso", "proceso");
            tabla.redibujar(true);
            const listas = filas.filter(f => f.proceso === PROCESO.LISTA).length;
            MEUI.log(`Consulta terminada: ${listas} de ${filas.length} lista(s) para operar.`, "ok");
        } catch (err) {
            MEUI.log("✖ " + (err.message || err), "err");
            MEUI.estadoTabla("#tablaLineas", "error", { mensaje: err.message || String(err) });
            MEUI.progreso.fin({ ok: false, mensaje: "No se pudo completar la consulta" });
        } finally {
            corriendo = false; soltar(); actualizar();
        }
    });

    /* --- Ejecutar (confirmación con resumen) --------------------------------- */
    async function ejecutar(reintento) {
        if (corriendo || !L.puedeOperar()) return;
        const destino = el("selDestino").value;
        const d = L.DESTINOS_ESTADO[destino];
        const razon = el("inputRazon").value.trim() || d.razon;
        const nota = el("inputNota").value.trim();
        const objetivo = (Array.isArray(reintento) ? reintento.filter(f => tabla.filas().includes(f) && puedeReintentar(f)) : tabla.marcadas()).filter(f => Number(f.estado) !== d.estadoCm);
        if (!objetivo.length) return;
        if (objetivo.some(f => f.orden || f.evidencia?.orden)) { MEUI.toast("Revisa en el CM las órdenes ya enviadas antes de repetir.", "warn"); return; }

        corriendo = true;
        try {
            const confirmado = await MEUI.confirmarEscritura({
                titulo: d.etiqueta, accion: d.etiqueta,
                resumen: [["Operación", d.etiqueta], ["Líneas", objetivo.length], ["Nota", L.notaDe(nota)], ["Entorno", "Producción"]],
                items: objetivo.slice(0, 10).map(f => `${f.msisdn} → ${d.resultado}`)
            });
            if (!confirmado || !L.puedeOperar()) return;
        } finally { corriendo = false; actualizar(); }
        corriendo = true;
        MEUI.progreso.iniciar(objetivo.length, "Enviando cambios");
        el("btnEjecutar").disabled = true;
        MEUI.log(`▶ ${d.etiqueta} ${objetivo.length} línea(s) · razón «${razon}» · ejecuta ${L.usuario()}`, "warn");

        try {
            // De una en una: son órdenes de escritura y cada una se sigue
            // hasta su estado final antes de mandar la siguiente.
            for (const [n, f] of objetivo.entries()) {
                try {
                await cambiarFila(f, destino, razon, nota, t => {
                    f.detalle = `(${n + 1}/${objetivo.length}) ${t}`;
                    tabla.redibujar(true);
                });
                } catch (e) {
                    f.proceso = PROCESO.FALLO; f.detalle = L.textoError(e);
                    f.envioIncierto = true;
                }
                f.sel = false;
                if (f.orden || f.evidencia?.orden || f.envioIncierto) f.bloqueada = true;
                MEUI.progreso.avanzar(n + 1);
                bitacora.push({
                    hora: L.horaBogota(), usuario: L.usuario(), msisdn: f.msisdn, accion: d.etiqueta, razon,
                    nota: L.notaDe(nota), ok: f.proceso === PROCESO.CAMBIADA, orden: f.orden,
                    estadoOrden: f.estadoOrden, detalle: f.detalle, evidencia: f.evidencia
                });
                MEUI.log(`${f.proceso === PROCESO.CAMBIADA ? "✔" : f.proceso === PROCESO.FALLO ? "✖" : "⚠"} ${f.msisdn} · ${f.detalle}`,
                    f.proceso === PROCESO.CAMBIADA ? "ok" : f.proceso === PROCESO.FALLO ? "err" : "warn");
                tabla.redibujar(true);
            }
        } finally {
            const fallidas = objetivo.filter(f => [PROCESO.FALLO, PROCESO.ERROR].includes(f.proceso));
            const seguras = fallidas.filter(puedeReintentar);
            MEUI.progreso.fin({ ok: fallidas.length === 0, fallidas: seguras.length,
                reintentar: seguras.length ? () => ejecutar(seguras) : undefined,
                mensaje: `${objetivo.length - fallidas.length}/${objetivo.length} procesadas · ${seguras.length} fallidas sin orden para reintentar` });
            corriendo = false;
            tabla.opcionesFiltro("#fEstado", "estadoTexto");
            tabla.opcionesFiltro("#fProceso", "proceso");
            tabla.redibujar(true);
        }
        const ok = objetivo.filter(f => f.proceso === PROCESO.CAMBIADA).length;
        MEUI.toast(`${d.etiqueta}: ${ok}/${objetivo.length} confirmada(s).`, ok === objetivo.length ? "ok" : "warn");
        if (destino === "inactivar" && ok) {
            MEUI.log("Recuerda: las IMSI de las líneas inactivadas quedan en HELD. Para reutilizarlas hay que liberarlas en el BSS.", "warn");
        }
    }
    function puedeReintentar(f) {
        // Sin petición de orden: un timeout del POST no demuestra que no se creó.
        return f.proceso === PROCESO.FALLO && !f.orden && !f.evidencia?.orden && !f.envioIncierto;
    }
    el("btnEjecutar").addEventListener("click", () => ejecutar());

    /* --- Exportaciones -------------------------------------------------- */

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

    el("btnCSV").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarCSV(x.head, x.rows, "estado_lineas"); });
    el("btnXLSX").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarXLSX(x.head, x.rows, "estado_lineas", "Líneas"); });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(tabla.filas().map(f => { const c = Object.assign({}, f); delete c._linea; return c; }), "estado_lineas"));
    el("btnBitacora").addEventListener("click", () => {
        if (!bitacora.length) { MEUI.toast("Todavía no se ha enviado ninguna orden.", "warn"); return; }
        const x = filasBitacora(bitacora); MEUI.exportarCSV(x.head, x.rows, "bitacora_estado_lineas");
    });

    MEUI.autoSpinner("#btnConsultar", "Consultando…");
    actualizar();
})();
