/* =====================================================================
   me-portabilidad-tigo-puente.js
   ---------------------------------------------------------------------
   Conecta la lógica del validador de portabilidad Tigo con el shell
   común (me-ui). No modifica esa lógica: la envuelve desde fuera.

   Va SIEMPRE al final del <body>, después del <script> de la lógica:

       <script src="assets/me-ui.js"></script>
       <script> MEUI.init({...}); </script>
       <script src="assets/logica-portabilidad-tigo.js"></script>
       <script src="assets/me-portabilidad-tigo-puente.js"></script>
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";
    const el = id => document.getElementById(id);
    const faltantes = [];

    /* --- 0 · ¿Cargó la lógica de la herramienta? ---------------------- */
    if (!existe(() => cfgTigo) || !esFn("render")) {
        MEUI.log("La lógica del validador no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("logica-portabilidad-tigo.js")) {
            MEUI.log("· Falta <script src=\"assets/logica-portabilidad-tigo.js\"></script> en el HTML.", "err");
        } else {
            MEUI.log("· El archivo está enlazado, así que hay un error dentro de "
                + "assets/logica-portabilidad-tigo.js. El detalle aparece arriba en este registro "
                + "(archivo:línea:columna).", "err");
        }
        MEUI.toast("La lógica del validador no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 0b · Sesión del CM (opcional: da el "Estado ME" de cada línea) */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
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
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
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

    // Credenciales compartidas: si ya se inició sesión en otra herramienta,
    // se reutilizan solas — el "Estado ME" queda disponible sin pedir nada.
    const credCm = MEUI.cred.get("cm");
    if (credCm && el("user")) {
        if (!el("user").value) el("user").value = credCm.usuario || "";
        if (!el("pass").value) el("pass").value = credCm.clave || "";
    }
    if (el("user") && el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true);
    } else {
        MEUI.log("Sin sesión del CM: la columna «Estado ME» quedará vacía (opcional, ver paso 2).");
    }

    /* --- 1 · Enter en el campo de líneas lanza la consulta ------------- */
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 2 · Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "validador_portabilidad_tigo";
    if (esFn("filasExport")) {
        reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
        reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "Portabilidad Tigo"); });
    } else faltantes.push("filasExport");
    if (el("btnJSON") && esFn("filasParaExportar"))
        el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 3 · Retroalimentación visible -------------------------------- */
    MEUI.autoSpinner("#btnConsultar", "Consultando HLR Tigo…");

    /* --- 4 · Registro --------------------------------------------------- */
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
