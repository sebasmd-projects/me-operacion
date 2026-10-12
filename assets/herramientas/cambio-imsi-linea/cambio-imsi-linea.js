/* =====================================================================
   cambio-imsi-linea.js · «Cambio IMSI y línea Claro|Tigo»
   ---------------------------------------------------------------------
   Va al final del <body>, después de cm-lineas.js y de los dos motores
   de esta carpeta (imsi.js y msisdn.js, que traen las reglas de negocio
   de cada pestaña). Aquí vive la
   interfaz: tabla con casillas, filtros, nota obligatoria, confirmación
   con resumen y exportaciones.

   Hay UN solo juego de controles. Lo que cambia según la pestaña activa
   sale de PESTANAS (más abajo): textos, columnas propias, motor y
   nombres de exportación. Para agregar o ajustar una pestaña se toca
   solo ese objeto (y su motor), nunca el marcado ni el resto de este archivo.

   Cada pestaña guarda su propio estado (filas, texto de entrada, nota y
   bitácora). Al cambiar de pestaña se desmonta la tabla y se rehace con
   las columnas de la otra, sobre los mismos elementos; la sesión del CM,
   el registro y los botones se enganchan una sola vez.

   Contenido:
     1 · Configuración y constantes (colores de insignias y PESTANAS)
     2 · Reglas de negocio: viven en imsi.js y msisdn.js (un motor por pestaña)
     3 · Interfaz (tabla, pestañas, validación, ejecución y exportaciones)
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    if (!window.CMLineas || !window.CambioIMSI || !window.CambioMSISDN) {
        MEUI.log("No cargó cm-lineas.js o alguno de los motores (imsi.js, msisdn.js): la herramienta queda inutilizable.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }
    const L = window.CMLineas;

    /* =================================================================
       1 · Configuración y constantes
    ================================================================= */
    const CLASE_ESTADO = { Activa: "ok", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const CLASE_SIM = { Disponible: "ok", "En uso": "info" };
    const CLASE_NUEVA = { "No está en el CM": "ok", Activa: "err", Inactiva: "off", Bloqueada: "warn", Disponible: "info" };
    const simBadge = t => t ? L.badge(t, CLASE_SIM[t] || "warn") : "—";

    // Clase del badge por nombre de proceso; cada pestaña la resuelve contra
    // los textos de SU motor (no todos los procesos existen en los dos).
    const CLASE_POR_PROCESO = {
        LISTA: "info", CAMBIADA: "ok", SOLICITADA: "ok", PENDIENTE_CM: "warn", FALLO: "err",
        ERROR: "err", NO_APLICA: "err", ENVIANDO: "info", CONSULTANDO: "neutro"
    };
    const claseProcesos = P => Object.fromEntries(
        Object.entries(CLASE_POR_PROCESO).filter(([nombre]) => P[nombre]).map(([nombre, clase]) => [P[nombre], clase]));

    /* ---------------------------------------------------------------
       Configuración por pestaña: TODO lo que cambia entre una y otra.
       Campos:
         motor / etiqueta / icono   motor de negocio y rótulo de la pestaña
         operacion                  nombre en la confirmación, el registro y los avisos
         entrada, formato, ejemplo   rótulo, formato (línea;...) y ejemplo del cuadro de texto
         aviso, notaEjemplo         aviso de riesgo del paso 3 y ayuda de la nota
         kOk, verboOk               rótulo de la KPI de éxito y verbo del aviso final
         accion, cambiar            «Cambiar IMSI» (botón) y «cambiar la IMSI» (bloqueo)
         nuevoDe(f)                 el valor nuevo de la fila (para el resumen y el registro)
         textoExtra(f)              datos propios que también busca el «Buscar»
         columnaPropia              la columna que solo tiene esta pestaña
         exportBase, bitacoraBase   nombres de los archivos exportados
    --------------------------------------------------------------- */
    const PESTANAS = {
        imsi: {
            motor: window.CambioIMSI, etiqueta: "Cambio IMSI", icono: "bi-sim",
            operacion: "Cambio IMSI Claro|Tigo",
            entrada: "Línea;IMSI nueva (uno por renglón, máximo 100)", formato: "línea;imsi_nueva", ejemplo: "3054164491;732157001066358",
            aviso: "La IMSI debe estar disponible; si está en HELD, hay que liberarla en el BSS.",
            notaEjemplo: "Motivo del cambio de SIM",
            kOk: "Cambiadas", verboOk: "confirmado(s)",
            accion: "Cambiar IMSI", cambiar: "cambiar la IMSI",
            nuevoDe: f => f.imsiNueva,
            textoExtra: f => f.imsiActual,
            columnaPropia: {
                t: "IMSI actual → nueva", txt: f => `${f.imsiActual} ${f.imsiNueva}`,
                render: f => `<div class="small">${MEUI.copiable(f.imsiActual, "IMSI actual")} ${simBadge(f.simActualEstado)}</div>`
                    + `<div class="small">→ <b>${MEUI.copiable(f.imsiNueva, "IMSI nueva")}</b> ${simBadge(f.simNuevaEstado)}</div>`
            },
            exportBase: "cambio_imsi", bitacoraBase: "bitacora_cambio_imsi"
        },
        msisdn: {
            motor: window.CambioMSISDN, etiqueta: "Cambio de línea (MSISDN)", icono: "bi-telephone-forward",
            operacion: "Cambio MSISDN Claro|Tigo",
            entrada: "Línea;línea nueva (uno por renglón, máximo 100)", formato: "línea;línea_nueva", ejemplo: "3052619570;3016999316",
            aviso: "Es una portabilidad: el número cambia cuando se completa.",
            notaEjemplo: "Motivo del cambio de número",
            kOk: "Solicitadas", verboOk: "solicitado(s)",
            accion: "Cambiar número", cambiar: "cambiar el número",
            nuevoDe: f => f.nueva,
            textoExtra: () => "",
            columnaPropia: {
                t: "Línea nueva", txt: f => f.nueva,
                render: f => `<div class="small">→ <b>${MEUI.copiable(f.nueva, "línea nueva")}</b></div>`
                    + (f.nuevaEnCm ? `<div class="small">${L.badge(f.nuevaEnCm, CLASE_NUEVA[f.nuevaEnCm] || "neutro")}</div>` : "")
            },
            exportBase: "cambio_msisdn", bitacoraBase: "bitacora_cambio_msisdn"
        }
    };
    Object.entries(PESTANAS).forEach(([clave, p]) => {
        p.clave = clave;
        p.clase = claseProcesos(p.motor.PROCESO);
        // Lo que cada pestaña conserva al irse: filas, texto, nota y bitácora.
        p.estado = { filas: [], texto: "", nota: "", bitacora: [] };
    });

    const FILTROS = {
        estado: "#fEstado", proceso: "#fProceso", sel: "#fSel", verOcultas: "#chkVerOcultas"
    };

    /* =================================================================
       3 · Interfaz (las reglas de negocio están en los motores de cada pestaña)
    ================================================================= */
    let actual = null;      // configuración de la pestaña activa
    let tabla = null;       // tabla de la pestaña activa
    let corriendo = false;

    /* --- Tabla (se rehace por pestaña) ---------------------------------- */
    function columnasDe(p) {
        return [
            { t: "Línea", txt: f => f.msisdn, render: f => MEUI.copiable(f.msisdn, "línea") },
            { t: "Estado de la línea", txt: f => f.estadoTexto, render: f => f.estadoTexto ? L.badge(f.estadoTexto, CLASE_ESTADO[f.estadoTexto]) : "—" },
            { t: "Proceso", txt: f => f.proceso, render: f => L.badge(f.proceso, p.clase[f.proceso]) },
            p.columnaPropia,
            {
                t: "Cuenta (BAN)", txt: f => f.ban,
                render: f => MEUI.copiable(f.ban, "BAN")
                    + (f.cuentas > 1 ? ` <span title="Tiene ${f.cuentas} suscripciones" style="color:var(--me-warn)">⚠</span>` : "")
            },
            { t: "Orden", txt: f => f.orden, render: f => `<span class="me-mono">${MEUI.esc(f.orden || "")}</span>` },
            { t: "Detalle", txt: f => f.detalle, orden: false, render: f => `<div class="celda-detalle">${MEUI.esc(f.detalle || "")}</div>` }
        ];
    }

    function crearTabla(p) {
        return L.tablaSeleccionable({
            tabla: "#tablaLineas", vacio: "#msgVacio", filtros: FILTROS, lote: "#barraLote", columnasControl: "#fColumnas",
            textoDe: f => [f.msisdn, p.nuevoDe(f), p.textoExtra(f), f.ban, f.orden, f.detalle, f.proceso].join(" "),
            alCambiar: actualizar,
            columnas: columnasDe(p)
        });
    }

    function refrescarFiltros() {
        tabla.opcionesFiltro("#fEstado", "estadoTexto");
        tabla.opcionesFiltro("#fProceso", "proceso");
        tabla.redibujar(true);
    }

    // Los botones de lote se enganchan UNA vez y apuntan a la tabla vigente.
    L.engancharLote({
        marcarTodo: () => tabla.marcarTodo(), desmarcarTodo: () => tabla.desmarcarTodo(),
        marcarVisibles: v => tabla.marcarVisibles(v), ocultarMarcadas: () => tabla.ocultarMarcadas(),
        ocultarNoMarcadas: () => tabla.ocultarNoMarcadas(), restaurarOcultas: () => tabla.restaurarOcultas(),
        limpiarFiltros: () => tabla.limpiarFiltros(), redibujar: () => tabla.redibujar()
    }, FILTROS);

    /* --- Pestañas ------------------------------------------------------- */
    function pintarPestanas() {
        el("pestanas").innerHTML = Object.values(PESTANAS).map(p =>
            `<button type="button" class="cl-tab${p === actual ? " activa" : ""}" data-tab="${p.clave}" role="tab" aria-selected="${p === actual}">`
            + `<i class="bi ${p.icono}"></i>${MEUI.esc(p.etiqueta)}</button>`).join("");
    }

    /** Pone los textos de la pestaña en los controles comunes. */
    function pintarTextos(p) {
        el("lblEntrada").textContent = p.entrada;
        el("inputLineas").placeholder = p.ejemplo;
        el("entradaArchivo").hidden = typeof p.motor.textoDesdeHoja !== "function";
        el("avisoAccion").textContent = p.aviso;
        el("inputNota").placeholder = p.notaEjemplo;
        el("kOkEtiqueta").textContent = p.kOk;
    }

    function activar(clave) {
        const p = PESTANAS[clave];
        if (!p || p === actual) return;
        if (corriendo) { MEUI.toast("Espera a que termine la operación en curso.", "warn"); return; }
        if (actual) {
            Object.assign(actual.estado, { filas: tabla.filas(), texto: el("inputLineas").value, nota: el("inputNota").value });
            tabla.destruir();
        }
        actual = p;
        pintarPestanas();
        pintarTextos(p);
        el("inputLineas").value = p.estado.texto;
        el("inputNota").value = p.estado.nota;
        el("inputLineas").dispatchEvent(new Event("input"));
        tabla = crearTabla(p);
        if (p.estado.filas.length) { tabla.poner(p.estado.filas); refrescarFiltros(); }
        actualizar();
    }
    el("pestanas").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (b) activar(b.dataset.tab);
    });

    /* --- Resumen y paso 3 ------------------------------------------------- */
    function actualizar() {
        if (!tabla) return;
        const P = actual.motor.PROCESO;
        const filas = tabla.filas();
        el("kTotal").textContent = filas.length;
        el("kSel").textContent = tabla.marcadas().length;
        el("kOk").textContent = filas.filter(f => actual.motor.procesosOk.includes(f.proceso)).length;
        el("kErr").textContent = filas.filter(f => [P.FALLO, P.ERROR, P.NO_APLICA].includes(f.proceso)).length;
        el("numOcultas").textContent = filas.filter(f => f.oculta).length;
        el("resumenSeleccion").textContent = `${tabla.marcadas().length} de ${filas.length} marcados · ${tabla.visibles().length} visibles`;
        pintarAccion();
    }

    function pintarAccion() {
        const P = actual.motor.PROCESO;
        const puede = L.puedeOperar();
        el("accionCampos").hidden = !puede;
        el("accionBloqueada").hidden = puede;
        if (!puede) {
            el("btnEjecutar").disabled = true;
            el("accionBloqueada").innerHTML = `<b>Solo validación.</b> No se puede ${MEUI.esc(actual.cambiar)}: ${MEUI.esc(L.motivoSinPermiso())}.`;
            return;
        }
        const nota = el("inputNota").value.trim();
        el("vistaNota").textContent = nota ? `"${L.notaDe(nota)}"` : "— escribe la nota —";
        el("inputNota").classList.toggle("is-invalid", !nota && tabla.marcadas().length > 0);

        const marcadas = tabla.marcadas().filter(f => f.proceso === P.LISTA);
        el("resumenAccion").textContent = marcadas.length
            ? `${marcadas.length} cambio(s) listo(s)` + (nota ? "." : " · falta la nota.")
            : "Marca en la tabla los cambios a aplicar (solo los que pasaron la validación).";
        const btn = el("btnEjecutar");
        if (!btn.dataset.meOcupado) btn.disabled = corriendo || !marcadas.length || !nota;
        btn.textContent = marcadas.length ? `${actual.accion} de ${marcadas.length} línea(s)` : `${actual.accion} de las marcadas`;
    }

    el("inputNota").addEventListener("input", () => { pintarAccion(); });

    L.engancharSesionCm(actualizar);
    L.engancharRegistro();

    /* --- Entrada: texto o Excel/CSV (solo en las pestañas con motor que lo lee) --- */
    const leer = () => actual.motor.leerEntrada(el("inputLineas").value);

    el("inputLineas").addEventListener("input", () => {
        const e = leer();
        el("infoLineas").textContent = `${e.cambios.length} cambio(s) leído(s)`
            + (e.malos.length ? ` · ${e.malos.length} con error (${e.malos[0].motivo})` : "")
            + ` · máximo ${actual.motor.CONFIG.maxCambios}`;
    });

    el("inputArchivo").addEventListener("change", async () => {
        const archivo = el("inputArchivo").files[0];
        if (!archivo) return;
        try {
            const libro = await MEUI.leerLibro(archivo);
            const hoja = libro.wb.Sheets[libro.hojas[0]];
            const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: "", raw: false, blankrows: false });
            el("inputLineas").value = actual.motor.textoDesdeHoja(filas);
            el("inputLineas").dispatchEvent(new Event("input"));
            MEUI.log(`Archivo «${libro.nombre}» · hoja «${libro.hojas[0]}»: ${filas.length} fila(s) leídas (las dos primeras columnas).`, "ok");
        } catch (e) {
            MEUI.log("✖ No se pudo leer el archivo: " + (e.message || e), "err");
        } finally {
            el("inputArchivo").value = "";
        }
    });

    /* --- Validación ---------------------------------------------------- */
    async function consultarTodas(filas) {
        const { consultarFila, PROCESO, CONFIG } = actual.motor;
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
        refrescarFiltros();
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
        const { filaNueva, marcarRepetidos, PROCESO, CONFIG } = actual.motor;
        const e = leer();
        if (!e.cambios.length) { MEUI.toast(`No hay renglones válidos (${actual.formato}).`, "warn"); return soltar(); }
        if (e.cambios.length > CONFIG.maxCambios) { MEUI.toast(`Máximo ${CONFIG.maxCambios} cambios.`, "warn"); return soltar(); }
        if (!MEAPI.auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); return soltar(); }

        corriendo = true;
        try {
            e.malos.forEach(m => MEUI.log(`No se toma «${m.texto}»: ${m.motivo}.`, "warn"));
            const filas = tabla.poner(e.cambios.map(filaNueva));
            marcarRepetidos(filas);
            const porConsultar = filas.filter(f => !f.bloqueada);
            MEUI.log(`Validando ${porConsultar.length} cambio(s)…`);
            await consultarTodas(porConsultar);
            refrescarFiltros();
            const listas = filas.filter(f => f.proceso === PROCESO.LISTA).length;
            MEUI.log(`Validación terminada: ${listas} de ${filas.length} cambio(s) listo(s).`, listas ? "ok" : "warn");
        } catch (err) {
            MEUI.log("✖ " + (err.message || err), "err");
            MEUI.estadoTabla("#tablaLineas", "error", { mensaje: err.message || String(err) });
            MEUI.progreso.fin({ ok: false, mensaje: "No se pudo completar la consulta" });
        } finally {
            corriendo = false; soltar(); actualizar();
        }
    });

    /* --- Ejecutar (nota obligatoria + confirmación con resumen) --------------- */
    async function ejecutar(reintento) {
        if (corriendo || !L.puedeOperar()) return;
        const p = actual;
        const { PROCESO, cambiarFila, revalidarAntesDeEnviar, noAplica, registroBitacora } = p.motor;
        const nota = el("inputNota").value.trim();
        if (!nota) { MEUI.toast("La nota es obligatoria.", "warn"); el("inputNota").focus(); return; }
        const objetivo = (Array.isArray(reintento) ? reintento.filter(f => tabla.filas().includes(f) && puedeReintentar(f)) : tabla.marcadas()).filter(f => f.proceso === PROCESO.LISTA || (Array.isArray(reintento) && puedeReintentar(f)));
        if (!objetivo.length) return;
        if (objetivo.some(f => f.orden || f.evidencia?.orden)) { MEUI.toast("Revisa en el CM las órdenes ya enviadas antes de repetir.", "warn"); return; }

        corriendo = true;
        try {
            const confirmado = await MEUI.confirmarEscritura({
                titulo: p.operacion, accion: p.operacion,
                resumen: [["Operación", p.operacion], ["Líneas", objetivo.length], ["Nota", L.notaDe(nota)], ["Entorno", "Producción"]],
                items: objetivo.slice(0, 10).map(f => `${f.msisdn} → ${p.nuevoDe(f)}`)
            });
            if (!confirmado || !L.puedeOperar()) return;
        } finally { corriendo = false; actualizar(); }
        corriendo = true;
        MEUI.progreso.iniciar(objetivo.length, "Enviando cambios");
        el("btnEjecutar").disabled = true;
        MEUI.log(`▶ ${p.operacion} en ${objetivo.length} línea(s) · nota «${L.notaDe(nota)}» · ejecuta ${L.usuario()}`, "warn");

        try {
            for (const [n, f] of objetivo.entries()) {
                // Se revalida justo antes: entre la validación y la ejecución
                // la situación en el CM pudo cambiar.
                const motivo = await revalidarAntesDeEnviar(f);
                if (motivo) {
                    noAplica(f, motivo);
                    tabla.redibujar(true);
                    MEUI.progreso.avanzar(n + 1);
                    continue;
                }
                try {
                    await cambiarFila(f, nota, t => {
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
                const bien = p.motor.procesosOk.includes(f.proceso);
                p.estado.bitacora.push(Object.assign({ hora: L.horaBogota(), usuario: L.usuario(), nota: L.notaDe(nota) }, registroBitacora(f)));
                MEUI.log(`${bien ? "✔" : f.proceso === PROCESO.FALLO ? "✖" : "⚠"} ${f.msisdn} → ${p.nuevoDe(f)} · ${f.detalle}`,
                    bien ? "ok" : f.proceso === PROCESO.FALLO ? "err" : "warn");
                tabla.redibujar(true);
            }
        } finally {
            const fallidas = objetivo.filter(f => [PROCESO.FALLO, PROCESO.NO_APLICA, PROCESO.ERROR].includes(f.proceso));
            const seguras = fallidas.filter(puedeReintentar);
            MEUI.progreso.fin({ ok: fallidas.length === 0, fallidas: seguras.length,
                reintentar: seguras.length ? () => ejecutar(seguras) : undefined,
                mensaje: `${objetivo.length - fallidas.length}/${objetivo.length} procesadas · ${seguras.length} fallidas sin orden para reintentar` });
            corriendo = false;
            refrescarFiltros();
        }
        const ok = objetivo.filter(f => p.motor.procesosOk.includes(f.proceso)).length;
        MEUI.toast(`${p.operacion}: ${ok}/${objetivo.length} ${p.verboOk}.`, ok === objetivo.length ? "ok" : "warn");
    }
    function puedeReintentar(f) {
        // Sin petición de orden: un timeout del POST no demuestra que no se creó.
        return f.proceso === actual.motor.PROCESO.FALLO && !f.orden && !f.evidencia?.orden && !f.envioIncierto;
    }
    el("btnEjecutar").addEventListener("click", () => ejecutar());

    /* --- Exportaciones -------------------------------------------------- */
    // Los campos con «_» son internos (respuestas del CM ya resueltas): no se exportan.
    const limpia = f => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("_")));
    el("btnCSV").addEventListener("click", () => { const x = actual.motor.filasExport(tabla.filas()); MEUI.exportarCSV(x.head, x.rows, actual.exportBase); });
    el("btnXLSX").addEventListener("click", () => { const x = actual.motor.filasExport(tabla.filas()); MEUI.exportarXLSX(x.head, x.rows, actual.exportBase, "Cambios"); });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(tabla.filas().map(limpia), actual.exportBase));
    el("btnBitacora").addEventListener("click", () => {
        if (!actual.estado.bitacora.length) { MEUI.toast("Todavía no se ha enviado ningún cambio.", "warn"); return; }
        const x = actual.motor.filasBitacora(actual.estado.bitacora); MEUI.exportarCSV(x.head, x.rows, actual.bitacoraBase);
    });

    MEUI.autoSpinner("#btnConsultar", "Validando…");
    activar("imsi");
})();
