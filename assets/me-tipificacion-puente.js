/* =====================================================================
   me-tipificacion-puente.js
   ---------------------------------------------------------------------
   Enganche entre logica-tipificacion.js y el shell común. Va SIEMPRE
   después de la lógica.
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const el = id => document.getElementById(id);

    /* --- 0 · ¿Cargó la lógica? --------------------------------------- */
    if (!existe(() => auth) || typeof window.validarYLeer !== "function") {
        MEUI.log("La lógica del exportador no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("me-api.js")) MEUI.log("· Falta assets/me-api.js antes de la lógica.", "err");
        else if (!cargado("logica-tipificacion.js")) MEUI.log("· Falta assets/logica-tipificacion.js en el HTML.", "err");
        else MEUI.log("· Hay un error dentro de assets/logica-tipificacion.js; el detalle está "
            + "arriba en este registro (archivo:línea:columna).", "err");
        MEUI.toast("La lógica no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión del CRM ------------------------------------------
       Esta herramienta no tiene botón propio de «iniciar sesión»: la
       primera consulta autentica. Desde la cabecera se fuerza el login
       para saber de una vez si las credenciales sirven. */
    async function iniciar() {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            MEUI.abrirPaso(1, true);
            MEUI.toast("Escribe usuario y clave del CRM (o pega un token).", "warn");
            return false;
        }
        try {
            auth.token = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("username").value.trim(), clave: el("password").value });
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            return false;
        }
    }

    document.addEventListener("me:sesion-iniciar", () => iniciar());
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        el("password").value = ""; el("token").value = "";
    });

    /* --- 2 · Credenciales compartidas con las otras herramientas ------ */
    const c = MEUI.cred.get("cm");
    if (c) {
        if (!el("username").value) el("username").value = c.usuario || "";
        if (!el("password").value) el("password").value = c.clave || "";
    }
    if (el("username").value && el("password").value && !auth.token) {
        MEUI.log("Credenciales disponibles. Iniciando sesión…");
        iniciar().then(ok => { if (ok) MEUI.abrirPaso(2, true); });
    } else {
        MEUI.log("Escribe usuario y clave del CRM para empezar.");
    }
    MEUI.enterEjecuta(el("password"), el("btnRun"));

    /* --- 3 · Tablas dentro de pestañas -------------------------------
       Una DataTable oculta mide cero: al cambiar de pestaña hay que
       descubrirla y rehacer los anchos. */
    document.addEventListener("shown.bs.tab", ev => {
        const destino = ev.target.getAttribute("data-bs-target");
        if (destino === "#paneResultados") MEUI.prepararTabla("#resultsTable");
        if (destino === "#panePreview") MEUI.prepararTabla("#previewTable");
        setTimeout(MEUI.ajustarTablas, 60);
    });

    /* --- 4 · Registro ------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("log").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista.", "ok");
})();