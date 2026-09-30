/* =====================================================================
   me-cambio-imsi-puente.js · Enganche de «Cambio de IMSI»
   ---------------------------------------------------------------------
   Va al final del <body>, después de cm-lineas.js y
   logica-cambio-imsi.js. Aquí vive la interfaz: tabla con casillas,
   filtros, nota obligatoria, doble confirmación y exportaciones.
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    if (!window.CMLineas || typeof consultarFila !== "function") {
        MEUI.log("No cargó cm-lineas.js o logica-cambio-imsi.js: la herramienta queda inutilizable.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }
    const L = window.CMLineas;
    const bitacora = [];
    let corriendo = false;
    let armado = false;

    const CLASE_PROCESO = {
        [PROCESO.LISTA]: "info", [PROCESO.CAMBIADA]: "ok", [PROCESO.PENDIENTE_CM]: "warn",
        [PROCESO.FALLO]: "err", [PROCESO.ERROR]: "err", [PROCESO.NO_APLICA]: "err",
        [PROCESO.ENVIANDO]: "info", [PROCESO.CONSULTANDO]: "neutro"
    };
    const CLASE_ESTADO = { Activa: "ok", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const CLASE_SIM = { Disponible: "ok", "En uso": "info" };
    const simBadge = t => t ? L.badge(t, CLASE_SIM[t] || "warn") : "—";

    const FILTROS = {
        texto: "#fTexto", estado: "#fEstado", proceso: "#fProceso", sel: "#fSel", verOcultas: "#chkVerOcultas"
    };

    const tabla = L.tablaSeleccionable({
        tabla: "#tablaLineas", vacio: "#msgVacio", filtros: FILTROS,
        textoDe: f => [f.msisdn, f.imsiNueva, f.imsiActual, f.ban, f.orden, f.detalle, f.proceso].join(" "),
        alCambiar: actualizar,
        columnas: [
            { t: "Línea", txt: f => f.msisdn, render: f => `<span class="me-mono">${MEUI.esc(f.msisdn)}</span>` },
            { t: "Estado de la línea", txt: f => f.estadoTexto, render: f => f.estadoTexto ? L.badge(f.estadoTexto, CLASE_ESTADO[f.estadoTexto]) : "—" },
            { t: "Proceso", txt: f => f.proceso, render: f => L.badge(f.proceso, CLASE_PROCESO[f.proceso]) },
            {
                t: "IMSI actual → nueva", txt: f => `${f.imsiActual} ${f.imsiNueva}`,
                render: f => `<div class="me-mono small">${MEUI.esc(f.imsiActual || "—")} ${simBadge(f.simActualEstado)}</div>`
                    + `<div class="me-mono small">→ <b>${MEUI.esc(f.imsiNueva)}</b> ${simBadge(f.simNuevaEstado)}</div>`
            },
            {
                t: "Cuenta (BAN)", txt: f => f.ban,
                render: f => `<span class="me-mono">${MEUI.esc(f.ban || "—")}</span>`
                    + (f.cuentas > 1 ? ` <span title="Tiene ${f.cuentas} suscripciones" style="color:var(--me-warn)">⚠</span>` : "")
            },
            { t: "Orden", txt: f => f.orden, render: f => `<span class="me-mono">${MEUI.esc(f.orden || "")}</span>` },
            { t: "Detalle", txt: f => f.detalle, orden: false, render: f => `<div class="celda-detalle">${MEUI.esc(f.detalle || "")}</div>` }
        ]
    });
    L.engancharLote(tabla, FILTROS);

    function actualizar() {
        const filas = tabla.filas();
        el("kTotal").textContent = filas.length;
        el("kSel").textContent = tabla.marcadas().length;
        el("kOk").textContent = filas.filter(f => f.proceso === PROCESO.CAMBIADA).length;
        el("kErr").textContent = filas.filter(f => [PROCESO.FALLO, PROCESO.ERROR, PROCESO.NO_APLICA].includes(f.proceso)).length;
        el("numOcultas").textContent = filas.filter(f => f.oculta).length;
        el("resumenSeleccion").textContent = `${tabla.marcadas().length} de ${filas.length} marcados · ${tabla.visibles().length} visibles`;
        pintarAccion();
    }

    function pintarAccion() {
        const puede = L.puedeOperar();
        el("accionCampos").hidden = !puede;
        el("accionBloqueada").hidden = puede;
        if (!puede) {
            el("accionBloqueada").innerHTML = `<b>Solo validación.</b> No se puede cambiar la IMSI: ${MEUI.esc(L.motivoSinPermiso())}.`;
            return;
        }
        const nota = el("inputNota").value.trim();
        el("vistaNota").textContent = nota ? `"${L.notaDe(nota)}"` : "— escribe la nota —";
        el("inputNota").classList.toggle("is-invalid", !nota && tabla.marcadas().length > 0);

        const marcadas = tabla.marcadas().filter(f => f.proceso === PROCESO.LISTA);
        el("resumenAccion").textContent = marcadas.length
            ? `${marcadas.length} cambio(s) listo(s)` + (nota ? "." : " · falta la nota.")
            : "Marca en la tabla los cambios a aplicar (solo los que pasaron la validación).";
        const btn = el("btnEjecutar");
        if (!btn.dataset.meOcupado) btn.disabled = corriendo || !marcadas.length || !nota;
        if (!armado) btn.textContent = marcadas.length ? `Cambiar IMSI de ${marcadas.length} línea(s)` : "Cambiar IMSI de las marcadas";
    }

    el("inputNota").addEventListener("input", () => { armado = false; pintarAccion(); });

    L.engancharSesionCm(actualizar);
    L.engancharRegistro();

    /* --- Validación ---------------------------------------------------- */
    el("inputLineas").addEventListener("input", () => {
        const e = leerEntrada(el("inputLineas").value);
        el("infoLineas").textContent = `${e.cambios.length} cambio(s) leído(s)`
            + (e.malos.length ? ` · ${e.malos.length} con error (${e.malos[0].motivo})` : "")
            + ` · máximo ${CONFIG.maxCambios}`;
    });

    el("btnConsultar").addEventListener("click", async () => {
        const btn = el("btnConsultar");
        const soltar = () => { btn.disabled = false; };   // libera el autoSpinner
        if (corriendo) return soltar();
        const e = leerEntrada(el("inputLineas").value);
        if (!e.cambios.length) { MEUI.toast("No hay renglones válidos (línea;imsi_nueva).", "warn"); return soltar(); }
        if (e.cambios.length > CONFIG.maxCambios) { MEUI.toast(`Máximo ${CONFIG.maxCambios} cambios.`, "warn"); return soltar(); }
        if (!MEAPI.auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); return soltar(); }

        corriendo = true;
        try {
            e.malos.forEach(m => MEUI.log(`No se toma «${m.texto}»: ${m.motivo}.`, "warn"));
            const filas = tabla.poner(e.cambios.map(filaNueva));
            marcarRepetidos(filas);
            const porConsultar = filas.filter(f => !f.bloqueada);
            MEUI.log(`Validando ${porConsultar.length} cambio(s)…`);
            let i = 0;
            const trabajar = async () => {
                while (i < porConsultar.length) {
                    await consultarFila(porConsultar[i++]);
                    tabla.redibujar(true);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONFIG.concurrenciaConsulta, porConsultar.length) }, trabajar));
            tabla.opcionesFiltro("#fEstado", "estadoTexto");
            tabla.opcionesFiltro("#fProceso", "proceso");
            tabla.redibujar(true);
            const listas = filas.filter(f => f.proceso === PROCESO.LISTA).length;
            MEUI.log(`Validación terminada: ${listas} de ${filas.length} cambio(s) listo(s).`, listas ? "ok" : "warn");
        } catch (err) {
            MEUI.log("✖ " + (err.message || err), "err");
        } finally {
            corriendo = false; soltar(); actualizar();
        }
    });

    /* --- Ejecutar (nota obligatoria + doble confirmación) --------------- */
    el("btnEjecutar").addEventListener("click", async () => {
        if (corriendo || !L.puedeOperar()) return;
        const nota = el("inputNota").value.trim();
        if (!nota) { MEUI.toast("La nota es obligatoria.", "warn"); el("inputNota").focus(); return; }
        const objetivo = tabla.marcadas().filter(f => f.proceso === PROCESO.LISTA);
        if (!objetivo.length) return;

        if (!armado) {
            armado = true;
            el("btnEjecutar").textContent = `Sí, cambiar la IMSI de ${objetivo.length} línea(s) en PRODUCCIÓN`;
            return;
        }
        armado = false;
        corriendo = true;
        el("btnEjecutar").disabled = true;
        MEUI.log(`▶ Cambio de IMSI en ${objetivo.length} línea(s) · nota «${L.notaDe(nota)}» · ejecuta ${L.usuario()}`, "warn");

        try {
            for (const [n, f] of objetivo.entries()) {
                // Se revalida la IMSI justo antes: entre la validación y la
                // ejecución otra persona pudo haberla asignado.
                const fresca = await L.simDe(f.imsiNueva);
                if (!fresca.disponible) {
                    noAplica(f, `Al momento de enviar, la IMSI nueva ya no estaba disponible (${fresca.estadoTexto || fresca.detalle}).`);
                    tabla.redibujar(true);
                    continue;
                }
                f._simNueva = fresca;
                await cambiarFila(f, nota, t => {
                    f.detalle = `(${n + 1}/${objetivo.length}) ${t}`;
                    tabla.redibujar(true);
                });
                bitacora.push({
                    hora: L.horaBogota(), usuario: L.usuario(), msisdn: f.msisdn, imsiAntes: f.imsiAntes,
                    imsiNueva: f.imsiNueva, nota: L.notaDe(nota), ok: f.proceso === PROCESO.CAMBIADA,
                    orden: f.orden, estadoOrden: f.estadoOrden, detalle: f.detalle, evidencia: f.evidencia
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
        MEUI.toast(`Cambio de IMSI: ${ok}/${objetivo.length} confirmado(s).`, ok === objetivo.length ? "ok" : "warn");
    });

    /* --- Exportaciones -------------------------------------------------- */
    const limpia = f => { const c = Object.assign({}, f); delete c._linea; delete c._simNueva; return c; };
    el("btnCSV").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarCSV(x.head, x.rows, "cambio_imsi"); });
    el("btnXLSX").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarXLSX(x.head, x.rows, "cambio_imsi", "Cambios"); });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(tabla.filas().map(limpia), "cambio_imsi"));
    el("btnBitacora").addEventListener("click", () => {
        if (!bitacora.length) { MEUI.toast("Todavía no se ha enviado ningún cambio.", "warn"); return; }
        const x = filasBitacora(bitacora); MEUI.exportarCSV(x.head, x.rows, "bitacora_cambio_imsi");
    });

    MEUI.autoSpinner("#btnConsultar", "Validando…");
    actualizar();
})();
