/* =====================================================================
   me-prepagadas-puente.js
   ---------------------------------------------------------------------
   Conecta la lógica existente del reporte de prepagadas con el shell
   común (me-ui). No modifica esa lógica: la envuelve desde fuera.

   Va SIEMPRE al final del <body>, después del <script> de la lógica:

       <script src="assets/me-ui.js"></script>
       <script> MEUI.init({...}); </script>
       <script> ...lógica de la herramienta... </script>
       <script src="assets/me-prepagadas-puente.js"></script>

   Cada bloque comprueba primero que exista lo que necesita, así una pieza
   que falte no tumba a las demás y el error queda escrito en el registro.
===================================================================== */
(function puente() {
    "use strict";

    /* Comprobar si un global existe SIN usar eval: si no está declarado,
       la función lanza ReferenceError y se atrapa aquí. */
    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";
    const el = id => document.getElementById(id);
    const faltantes = [];

    /* --- 0 · ¿Cargó la lógica de la herramienta? ---------------------- */
    if (!existe(() => auth) || !esFn("render")) {
        MEUI.log("La lógica del reporte no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("me-api.js")) {
            MEUI.log("· Falta <script src=\"assets/me-api.js\"></script> antes de la lógica.", "err");
        } else if (!cargado("logica-prepagadas.js")) {
            MEUI.log("· Falta <script src=\"assets/logica-prepagadas.js\"></script> en el HTML.", "err");
        } else if (typeof MEAPI === "undefined") {
            MEUI.log("· assets/me-api.js está declarado pero no cargó: revisa que el archivo exista "
                + "dentro de la carpeta assets y que el nombre coincida.", "err");
        } else {
            MEUI.log("· Los archivos están enlazados, así que hay un error dentro de "
                + "assets/logica-prepagadas.js. El detalle aparece arriba en este registro "
                + "(archivo:línea:columna).", "err");
        }
        MEUI.toast("La lógica del reporte no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesiones en la cabecera --------------------------------- */
    const _pintar = (typeof pintarSesion === "function") ? pintarSesion : null;
    window.pintarSesion = function () {
        if (_pintar) { try { _pintar(); } catch (e) { } }
        try {
            if (auth.token) {
                MEUI.sesion.set("cm", {
                    usuario: auth.username || (el("cfgUser") ? el("cfgUser").value.trim() : "") || "CM",
                    expira: (auth.expiresAt || 0) + 30000   // expiresAt ya viene 30 s antes del vencimiento
                });
            } else if (MEUI.sesion.estado("cm").estado !== "off") {
                MEUI.sesion.caida("cm");
            }
            if (existe(() => sesion) && sesion.sime) {
                let quien = "SIME";
                try {
                    const p = JSON.parse(atob(el("cfgTokenSime").value.trim()));
                    quien = p.UserName || p.Usuario || p.Nombre || quien;
                } catch (e) { }
                MEUI.sesion.set("sime", { usuario: quien });
            }
        } catch (e) { }
        MEUI.aplicarAperturaPasos();
    };
    pintarSesion();

    document.addEventListener("me:sesion-iniciar", e => {
        const b = el(e.detail.clave === "cm" ? "btnLoginCm" : "btnTokenSime");
        if (b) b.click();
    });
    document.addEventListener("me:sesion-renovar", e => {
        if (e.detail.clave !== "cm" || !auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(err => MEUI.log("No se pudo renovar: " + err.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", e => {
        if (e.detail.clave === "cm") {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            if (el("cfgPass")) el("cfgPass").value = "";
        } else if (el("cfgTokenSime")) {
            el("cfgTokenSime").value = "";
            el("cfgTokenSime").dispatchEvent(new Event("input"));
        }
        pintarSesion();
    });

    /* --- 2 · Credenciales compartidas -------------------------------- */
    const cCm = MEUI.cred.get("cm");
    if (cCm && el("cfgUser")) {
        if (!el("cfgUser").value) el("cfgUser").value = cCm.usuario || "";
        if (!el("cfgPass").value) el("cfgPass").value = cCm.clave || "";
    }
    const cSime = MEUI.cred.get("sime");
    if (cSime && cSime.prf && el("cfgTokenSime") && !el("cfgTokenSime").value) {
        el("cfgTokenSime").value = cSime.prf;
        el("cfgTokenSime").dispatchEvent(new Event("input"));
    }
    if (el("btnLoginCm")) el("btnLoginCm").addEventListener("click", () =>
        MEUI.cred.set("cm", { usuario: el("cfgUser").value.trim(), clave: el("cfgPass").value }));
    if (el("btnTokenSime")) el("btnTokenSime").addEventListener("click", () =>
        setTimeout(() => {
            const t = el("cfgTokenSime").value.trim();
            if (t) MEUI.cred.set("sime", { prf: t });
        }, 1500));

    if (el("cfgUser") && el("cfgUser").value && el("cfgPass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        el("btnLoginCm").click();
    }

    /* --- 3 · Tabla al alto útil -------------------------------------- */
    const _render = window.render;
    window.render = function () {
        // Primero se descubre la tabla: DataTables va a medir los anchos dentro
        // de _render() y no puede hacerlo sobre un elemento oculto.
        MEUI.prepararTabla("#tablaLineas");
        _render.apply(this, arguments);
        try {
            const dt = existe(() => dataTable) ? dataTable : null;
            // Sin filas la tabla se esconde y queda el mensaje de ayuda;
            // con datos se muestra y se recalculan los anchos.
            const n = MEUI.mostrarSiHayDatos("#tablaLineas", { vacio: "#msgVacio", tabla: dt });
            if (dt) MEUI.registrarTabla(dt);
            if (existe(() => filas)) MEUI.resumenPaso(2, filas.length + " líneas consultadas");
            MEUI.log(n ? `Tabla actualizada: ${n} líneas.` : "La consulta no devolvió líneas.", n ? "ok" : "warn");
        } catch (e) { }
        MEUI.ajustarTablas();
    };

    // Estado inicial: todavía no hay consulta, así que la tabla no se muestra.
    MEUI.mostrarSiHayDatos("#tablaLineas", { vacio: "#msgVacio" });

    /* --- 4 · Entrada de líneas: separadores ampliados ----------------- */
    if (esFn("obtenerLineas")) {
        window.obtenerLineas = function () {
            if (existe(() => lineasArchivo) && lineasArchivo.length) return lineasArchivo;
            const r = MEUI.parseLineas(el("inputLineas").value);
            if (r.descartadas.length)
                MEUI.log("Se ignoraron " + r.descartadas.length + " valores que no parecen líneas.", "warn");
            return r.lineas;
        };
    } else faltantes.push("obtenerLineas");
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 5 · Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "reporte_prepagadas";
    if (esFn("filasExport")) {
        reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
        reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "prepagadas"); });
    } else faltantes.push("filasExport");
    if (el("btnJSON") && esFn("filasParaExportar"))
        el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 6 · Retroalimentación visible -------------------------------- */
    MEUI.autoSpinner("#btnConsultar", "Consultando SIME y BSS…");
    MEUI.autoSpinner("#btnCrearSime", "Registrando…");
    MEUI.autoSpinner("#btnGuardarRec", "Guardando…");
    ["btnTokenSime", "btnTestSime", "btnTestBss", "btnLoginCm"].forEach(id => {
        const b = el(id); if (!b) return;
        b.addEventListener("click", () => { MEUI.ocupado(b, "Probando…"); setTimeout(() => MEUI.libre(b), 1800); });
    });

    /* --- 7 · Registro ------------------------------------------------- */
    if (el("btnLimpiarLog")) el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    if (el("btnCopiarLog")) el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    if (faltantes.length)
        MEUI.log("Puente parcial: no se encontró " + faltantes.join(", ") + " en la lógica.", "warn");
    MEUI.log("Herramienta lista.", "ok");
})();