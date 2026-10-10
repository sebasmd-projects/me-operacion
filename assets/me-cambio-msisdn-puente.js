/* =====================================================================
   me-cambio-msisdn-puente.js · Enganche de «Cambio MSISDN Claro|Tigo»
   ---------------------------------------------------------------------
   Va al final del <body>, después de cm-lineas.js y
   logica-cambio-msisdn.js. Aquí vive la interfaz: entrada por texto o
   Excel, tabla con casillas, filtros, nota obligatoria, doble
   confirmación y exportaciones.
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    if (!window.CMLineas || typeof consultarFila !== "function") {
        MEUI.log("No cargó cm-lineas.js o logica-cambio-msisdn.js: la herramienta queda inutilizable.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }
    const L = window.CMLineas;
    const bitacora = [];
    let corriendo = false;
    let armado = false;

    const CLASE_PROCESO = {
        [PROCESO.LISTA]: "info", [PROCESO.CAMBIADA]: "ok", [PROCESO.SOLICITADA]: "ok",
        [PROCESO.FALLO]: "err", [PROCESO.ERROR]: "err", [PROCESO.NO_APLICA]: "err",
        [PROCESO.ENVIANDO]: "info", [PROCESO.CONSULTANDO]: "neutro"
    };
    const CLASE_ESTADO = { Activa: "ok", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const CLASE_NUEVA = { "No está en el CM": "ok", Activa: "err", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };

    const FILTROS = {
        texto: "#fTexto", estado: "#fEstado", proceso: "#fProceso", sel: "#fSel", verOcultas: "#chkVerOcultas"
    };

    const tabla = L.tablaSeleccionable({
        tabla: "#tablaLineas", vacio: "#msgVacio", filtros: FILTROS,
        textoDe: f => [f.msisdn, f.nueva, f.ban, f.orden, f.detalle, f.proceso].join(" "),
        alCambiar: actualizar,
        columnas: [
            { t: "Línea", txt: f => f.msisdn, render: f => MEUI.copiable(f.msisdn, "línea") },
            { t: "Estado de la línea", txt: f => f.estadoTexto, render: f => f.estadoTexto ? L.badge(f.estadoTexto, CLASE_ESTADO[f.estadoTexto]) : "—" },
            { t: "Proceso", txt: f => f.proceso, render: f => L.badge(f.proceso, CLASE_PROCESO[f.proceso]) },
            {
                t: "Línea nueva", txt: f => f.nueva,
                render: f => `<div class="small">→ <b>${MEUI.copiable(f.nueva, "línea nueva")}</b></div>`
                    + (f.nuevaEnCm ? `<div class="small">${L.badge(f.nuevaEnCm, CLASE_NUEVA[f.nuevaEnCm] || "neutro")}</div>` : "")
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
        el("kOk").textContent = filas.filter(f => [PROCESO.CAMBIADA, PROCESO.SOLICITADA].includes(f.proceso)).length;
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
            el("accionBloqueada").innerHTML = `<b>Solo validación.</b> No se puede cambiar el número: ${MEUI.esc(L.motivoSinPermiso())}.`;
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
        if (!armado) btn.textContent = marcadas.length ? `Cambiar número de ${marcadas.length} línea(s)` : "Cambiar número de las marcadas";
    }

    el("inputNota").addEventListener("input", () => { armado = false; pintarAccion(); });

    L.engancharSesionCm(actualizar);
    L.engancharRegistro();

    /* --- Entrada desde Excel/CSV ------------------------------------------ */
    el("inputArchivo").addEventListener("change", async () => {
        const archivo = el("inputArchivo").files[0];
        if (!archivo) return;
        try {
            const libro = await MEUI.leerLibro(archivo);
            const hoja = libro.wb.Sheets[libro.hojas[0]];
            const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: "", raw: false, blankrows: false });
            el("inputLineas").value = textoDesdeHoja(filas);
            el("inputLineas").dispatchEvent(new Event("input"));
            MEUI.log(`Archivo «${libro.nombre}» · hoja «${libro.hojas[0]}»: ${filas.length} fila(s) leídas (las dos primeras columnas).`, "ok");
        } catch (e) {
            MEUI.log("✖ No se pudo leer el archivo: " + (e.message || e), "err");
        } finally {
            el("inputArchivo").value = "";
        }
    });

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
        if (!e.cambios.length) { MEUI.toast("No hay renglones válidos (línea;línea_nueva).", "warn"); return soltar(); }
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
            el("btnEjecutar").textContent = `Sí, cambiar el número de ${objetivo.length} línea(s) en PRODUCCIÓN`;
            return;
        }
        armado = false;
        corriendo = true;
        el("btnEjecutar").disabled = true;
        MEUI.log(`▶ Cambio MSISDN Claro|Tigo en ${objetivo.length} línea(s) · nota «${L.notaDe(nota)}» · ejecuta ${L.usuario()}`, "warn");

        try {
            for (const [n, f] of objetivo.entries()) {
                // Se revalida justo antes: entre la validación y la ejecución
                // pudo aparecer otra orden de cambio de número en la cuenta.
                const pend = await L.ordenesPendientes(f.ban, CONFIG.tiposPendientes);
                if (pend.length) {
                    noAplica(f, `Al momento de enviar, la cuenta ya tenía un cambio de número pendiente (${pend.map(o => o.id).join(", ")}).`);
                    tabla.redibujar(true);
                    continue;
                }
                await cambiarFila(f, nota, t => {
                    f.detalle = `(${n + 1}/${objetivo.length}) ${t}`;
                    tabla.redibujar(true);
                });
                bitacora.push({
                    hora: L.horaBogota(), usuario: L.usuario(), msisdn: f.msisdn,
                    nueva: f.nueva, nota: L.notaDe(nota), ok: [PROCESO.CAMBIADA, PROCESO.SOLICITADA].includes(f.proceso),
                    orden: f.orden, estadoOrden: f.estadoOrden, detalle: f.detalle, evidencia: f.evidencia
                });
                const bien = [PROCESO.CAMBIADA, PROCESO.SOLICITADA].includes(f.proceso);
                MEUI.log(`${bien ? "✔" : f.proceso === PROCESO.FALLO ? "✖" : "⚠"} ${f.msisdn} → ${f.nueva} · ${f.detalle}`,
                    bien ? "ok" : f.proceso === PROCESO.FALLO ? "err" : "warn");
                tabla.redibujar(true);
            }
        } finally {
            corriendo = false;
            tabla.opcionesFiltro("#fEstado", "estadoTexto");
            tabla.opcionesFiltro("#fProceso", "proceso");
            tabla.redibujar(true);
        }
        const ok = objetivo.filter(f => [PROCESO.CAMBIADA, PROCESO.SOLICITADA].includes(f.proceso)).length;
        MEUI.toast(`Cambio MSISDN Claro|Tigo: ${ok}/${objetivo.length} solicitado(s).`, ok === objetivo.length ? "ok" : "warn");
    });

    /* --- Exportaciones -------------------------------------------------- */
    const limpia = f => { const c = Object.assign({}, f); delete c._linea; return c; };
    el("btnCSV").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarCSV(x.head, x.rows, "cambio_msisdn"); });
    el("btnXLSX").addEventListener("click", () => { const x = filasExport(tabla.filas()); MEUI.exportarXLSX(x.head, x.rows, "cambio_msisdn", "Cambios"); });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(tabla.filas().map(limpia), "cambio_msisdn"));
    el("btnBitacora").addEventListener("click", () => {
        if (!bitacora.length) { MEUI.toast("Todavía no se ha enviado ningún cambio.", "warn"); return; }
        const x = filasBitacora(bitacora); MEUI.exportarCSV(x.head, x.rows, "bitacora_cambio_msisdn");
    });

    MEUI.autoSpinner("#btnConsultar", "Validando…");
    actualizar();
})();
