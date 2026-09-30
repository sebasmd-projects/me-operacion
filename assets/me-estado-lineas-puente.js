/* =====================================================================
   me-estado-lineas-puente.js · Enganche de «Estado de líneas»
   ---------------------------------------------------------------------
   Va al final del <body>, después de cm-lineas.js y
   logica-estado-lineas.js. Aquí vive la interfaz: tabla con casillas,
   filtros, doble confirmación y exportaciones. Las reglas están en
   logica-estado-lineas.js y lo compartido en cm-lineas.js.
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    if (!window.CMLineas || typeof consultarFila !== "function") {
        MEUI.log("No cargó cm-lineas.js o logica-estado-lineas.js: la herramienta queda inutilizable.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }
    const L = window.CMLineas;
    const bitacora = [];
    let corriendo = false;
    let armado = false;

    /* --- Tabla ------------------------------------------------------- */
    const CLASE_PROCESO = {
        [PROCESO.LISTA]: "info", [PROCESO.CAMBIADA]: "ok", [PROCESO.SIN_CAMBIO]: "neutro",
        [PROCESO.PENDIENTE_CM]: "warn", [PROCESO.FALLO]: "err", [PROCESO.ERROR]: "err",
        [PROCESO.NO_EXISTE]: "err", [PROCESO.ENVIANDO]: "info", [PROCESO.CONSULTANDO]: "neutro"
    };
    const CLASE_ESTADO = { Activa: "ok", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const CLASE_SIM = { Disponible: "ok", "En uso": "info" };

    const FILTROS = {
        texto: "#fTexto", estado: "#fEstado", proceso: "#fProceso", sel: "#fSel", verOcultas: "#chkVerOcultas"
    };

    const tabla = L.tablaSeleccionable({
        tabla: "#tablaLineas", vacio: "#msgVacio", filtros: FILTROS,
        textoDe: f => [f.msisdn, f.ban, f.subscriberId, f.imsi, f.orden, f.detalle, f.estadoTexto, f.proceso].join(" "),
        alCambiar: actualizar,
        columnas: [
            { t: "Línea", txt: f => f.msisdn, render: f => `<span class="me-mono">${MEUI.esc(f.msisdn)}</span>` },
            { t: "Estado en el CM", txt: f => f.estadoTexto, render: f => f.estadoTexto ? L.badge(f.estadoTexto, CLASE_ESTADO[f.estadoTexto]) : "—" },
            { t: "Proceso", txt: f => f.proceso, render: f => L.badge(f.proceso, CLASE_PROCESO[f.proceso]) },
            {
                t: "Cuenta (BAN)", txt: f => f.ban,
                render: f => `<span class="me-mono">${MEUI.esc(f.ban || "—")}</span>`
                    + (f.cuentas > 1 ? ` <span title="Tiene ${f.cuentas} suscripciones" style="color:var(--me-warn)">⚠</span>` : "")
            },
            { t: "IMSI", txt: f => f.imsi, render: f => `<span class="me-mono">${MEUI.esc(f.imsi || "—")}</span>` },
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
        if (!armado) btn.textContent = aplican.length ? `${d.etiqueta} ${aplican.length} línea(s)` : "Aplicar a las marcadas";
    }

    function desarmar() { armado = false; pintarAccion(); }

    el("selDestino").addEventListener("change", () => {
        // La razón sigue al estado mientras nadie la haya escrito a mano.
        const inp = el("inputRazon");
        if (!inp.dataset.editada) inp.value = L.DESTINOS_ESTADO[el("selDestino").value].razon;
        desarmar();
    });
    el("inputRazon").addEventListener("input", () => { el("inputRazon").dataset.editada = "1"; desarmar(); });
    el("inputNota").addEventListener("input", desarmar);

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
        let i = 0;
        const trabajar = async () => {
            while (i < filas.length) {
                const f = filas[i++];
                await consultarFila(f);
                tabla.redibujar(true);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONFIG.concurrenciaConsulta, filas.length) }, trabajar));
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
        } finally {
            corriendo = false; soltar(); actualizar();
        }
    });

    /* --- Ejecutar (doble confirmación) --------------------------------- */
    el("btnEjecutar").addEventListener("click", async () => {
        if (corriendo || !L.puedeOperar()) return;
        const destino = el("selDestino").value;
        const d = L.DESTINOS_ESTADO[destino];
        const razon = el("inputRazon").value.trim() || d.razon;
        const nota = el("inputNota").value.trim();
        const objetivo = tabla.marcadas().filter(f => Number(f.estado) !== d.estadoCm);
        if (!objetivo.length) return;

        if (!armado) {
            armado = true;
            el("btnEjecutar").textContent = `Sí, ${d.etiqueta.toLowerCase()} ${objetivo.length} línea(s) en PRODUCCIÓN`;
            return;
        }
        armado = false;
        corriendo = true;
        el("btnEjecutar").disabled = true;
        MEUI.log(`▶ ${d.etiqueta} ${objetivo.length} línea(s) · razón «${razon}» · ejecuta ${L.usuario()}`, "warn");

        try {
            // De una en una: son órdenes de escritura y cada una se sigue
            // hasta su estado final antes de mandar la siguiente.
            for (const [n, f] of objetivo.entries()) {
                await cambiarFila(f, destino, razon, nota, t => {
                    f.detalle = `(${n + 1}/${objetivo.length}) ${t}`;
                    tabla.redibujar(true);
                });
                f.sel = false;   // hecha: no se vuelve a mandar por error
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
    });

    /* --- Exportaciones -------------------------------------------------- */
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
