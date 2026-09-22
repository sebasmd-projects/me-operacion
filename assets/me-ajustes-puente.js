/* =====================================================================
   me-ajustes-puente.js
   ---------------------------------------------------------------------
   Enganche entre logica-ajustes.js y el shell común. Va SIEMPRE después
   de la lógica.
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const el = id => document.getElementById(id);

    /* --- 0 · ¿Cargó la lógica? --------------------------------------- */
    if (!existe(() => auth) || !existe(() => STATE)) {
        MEUI.log("La lógica del reporte de ajustes no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("me-api.js")) MEUI.log("· Falta assets/me-api.js antes de la lógica.", "err");
        else if (!cargado("logica-ajustes.js")) MEUI.log("· Falta assets/logica-ajustes.js en el HTML.", "err");
        else MEUI.log("· Hay un error dentro de assets/logica-ajustes.js; el detalle está arriba "
            + "en este registro (archivo:línea:columna).", "err");
        MEUI.toast("La lógica no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión del CM ------------------------------------------- */
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

    el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", () => el("btnLogin").click());
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        el("pass").value = "";
    });

    /* --- 2 · Credenciales compartidas -------------------------------- */
    const c = MEUI.cred.get("cm");
    if (c) {
        if (!el("user").value) el("user").value = c.usuario || "";
        if (!el("pass").value) el("pass").value = c.clave || "";
    }
    if (el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true).then(ok => { if (ok) MEUI.abrirPaso(2, true); });
    } else {
        MEUI.log("Escribe usuario y contraseña del CM y presiona «Iniciar sesión».");
    }

    /* --- 3 · Tablas dentro de pestañas -------------------------------- */
    document.addEventListener("shown.bs.tab", ev => {
        const destino = ev.target.getAttribute("data-bs-target");
        if (destino === "#paneMoney") MEUI.prepararTabla("#tblMoney");
        if (destino === "#paneBundle") MEUI.prepararTabla("#tblBundle");
        setTimeout(MEUI.ajustarTablas, 60);
    });

    /* --- 4 · Fechas por defecto: el mes en curso ---------------------- */
    if (!el("fromDate").value && !el("toDate").value) {
        const hoy = new Date();
        const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const iso = d => d.toISOString().slice(0, 10);
        el("fromDate").value = iso(primero);
        el("toDate").value = iso(hoy);
    }

    /* --- 5 · Registro ------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("log").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista.", "ok");
})();