/* =====================================================================
   me-consumos-puente.js
   ---------------------------------------------------------------------
   Conecta logica-consumos.js con el shell común (me-ui). No modifica esa
   lógica: la envuelve desde fuera, igual que los demás puentes de esta
   suite. Va SIEMPRE al final del <body>, después del <script> de la
   lógica.
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";
    const el = id => document.getElementById(id);
    const faltantes = [];

    /* --- 0 · ¿Cargó la lógica de la herramienta? ---------------------- */
    if (!existe(() => auth) || !esFn("render")) {
        MEUI.log("La lógica de consumos no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("me-api.js")) {
            MEUI.log("· Falta <script src=\"assets/me-api.js\"></script> antes de la lógica.", "err");
        } else if (!cargado("logica-consumos.js")) {
            MEUI.log("· Falta <script src=\"assets/logica-consumos.js\"></script> en el HTML.", "err");
        } else {
            MEUI.log("· Los archivos están enlazados, así que hay un error dentro de "
                + "assets/logica-consumos.js. El detalle aparece arriba en este registro "
                + "(archivo:línea:columna).", "err");
        }
        MEUI.toast("La lógica de consumos no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión del CM (única sesión de esta herramienta) --------- */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            MEUI.abrirPaso(1, true);
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña.", "warn");
            return false;
        }
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("user").value.trim(), clave: el("pass").value });
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión.", "err");
            return false;
        }
    }

    if (el("btnLogin")) el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", () => { if (el("btnLogin")) el("btnLogin").click(); });
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        if (el("pass")) el("pass").value = "";
    });

    /* --- 2 · Credenciales compartidas -------------------------------- */
    const c = MEUI.cred.get("cm");
    if (c && el("user")) {
        if (!el("user").value) el("user").value = c.usuario || "";
        if (!el("pass").value) el("pass").value = c.clave || "";
    }
    if (el("user") && el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true).then(ok => { if (ok) MEUI.abrirPaso(2, true); });
    } else {
        MEUI.log("Escribe usuario y contraseña del CM y presiona «Iniciar sesión».");
    }

    /* --- 3 · Enter en el campo de líneas lanza la consulta ------------- */
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 4 · Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "reporte_consumos";
    if (esFn("filasExport")) {
        reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
        reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "Líneas"); });
    } else faltantes.push("filasExport");
    if (el("btnJSON") && esFn("filasParaExportar"))
        el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 5 · Retroalimentación visible -------------------------------- */
    MEUI.autoSpinner("#btnConsultar", "Consultando CM…");

    /* --- 6 · Registro --------------------------------------------------- */
    if (el("btnLimpiarLog")) el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    if (el("btnCopiarLog")) el("btnCopiarLog").addEventListener("click", () => {
        MEUI.copiarTexto(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    if (faltantes.length)
        MEUI.log("Puente parcial: no se encontró " + faltantes.join(", ") + " en la lógica.", "warn");
    MEUI.log("Herramienta lista.", "ok");
})();
