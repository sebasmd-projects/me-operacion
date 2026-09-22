/* =====================================================================
   me-casos-puente.js
   ---------------------------------------------------------------------
   Enganche entre logica-casos.js y el shell común (me-ui). No modifica la
   lógica: la envuelve desde fuera. Va SIEMPRE después de ella.
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const el = id => document.getElementById(id);

    /* --- 0 · ¿Cargó la lógica? --------------------------------------- */
    if (!existe(() => filas) || typeof window.construirTabla !== "function") {
        MEUI.log("La lógica del cierre masivo no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("me-api.js")) MEUI.log("· Falta assets/me-api.js antes de la lógica.", "err");
        else if (!cargado("logica-casos.js")) MEUI.log("· Falta assets/logica-casos.js en el HTML.", "err");
        else MEUI.log("· Hay un error dentro de assets/logica-casos.js; el detalle está arriba "
            + "en este registro (archivo:línea:columna).", "err");
        MEUI.toast("La lógica no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión del CM en la cabecera ----------------------------
       me-api.js ya avisa al shell cada vez que guarda un token; aquí solo
       se atienden los botones de la cabecera. */
    document.addEventListener("me:sesion-iniciar", () => el("btnConectar").click());
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        if (el("cfgPass")) el("cfgPass").value = "";
    });

    async function conectar(silencioso) {
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            auth.leerCampos();
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("cfgUser").value.trim(), clave: el("cfgPass").value });
            MEUI.log("Sesión lista para " + auth.username + ".", "ok");
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast(e.message, "err");
            return false;
        }
    }

    el("btnConectar").addEventListener("click", () =>
        MEUI.conSpinner(el("btnConectar"), "Conectando…", () => conectar(false)));
    el("btnRenovar").addEventListener("click", () =>
        MEUI.conSpinner(el("btnRenovar"), "Renovando…", () =>
            auth.reauth(auth.version).catch(e => MEUI.log("✖ " + e.message, "err"))));

    /* --- 2 · Credenciales compartidas con las otras herramientas ------ */
    const c = MEUI.cred.get("cm");
    if (c) {
        if (!el("cfgUser").value) el("cfgUser").value = c.usuario || "";
        if (!el("cfgPass").value) el("cfgPass").value = c.clave || "";
    }
    if (el("cfgUser").value && el("cfgPass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true).then(ok => { if (ok) MEUI.abrirPaso(2, true); });
    } else {
        MEUI.log("Escribe usuario y contraseña del CM y presiona «Iniciar sesión».");
    }
    MEUI.enterEjecuta(el("cfgPass"), el("btnConectar"));

    /* --- 3 · Tablas: alto útil y pestañas ----------------------------
       Una DataTable dentro de una pestaña oculta mide cero: al cambiar de
       pestaña hay que descubrirla y rehacer los anchos. */
    document.addEventListener("shown.bs.tab", ev => {
        const destino = ev.target.getAttribute("data-bs-target");
        if (destino === "#paneCasos") MEUI.prepararTabla("#tablaCasos");
        if (destino === "#paneInforme") MEUI.prepararTabla("#tablaResultados");
        setTimeout(MEUI.ajustarTablas, 60);
    });

    /* --- 4 · Las tarjetas de arriba filtran por estado del proceso ---- */
    document.querySelectorAll("[data-festado]").forEach(k => {
        k.addEventListener("click", () => {
            const v = k.dataset.festado;
            const f = el("fEstado");
            const yaEstaba = f.value === v;
            f.value = yaEstaba ? "" : v;
            f.dispatchEvent(new Event("change"));
            document.querySelectorAll("[data-festado]").forEach(o =>
                o.classList.toggle("activo", !yaEstaba && o === k));
            const tab = document.querySelector('[data-bs-target="#paneCasos"]');
            if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
        });
    });

    /* --- 5 · Retroalimentación en las acciones lentas ----------------- */
    MEUI.autoSpinner("#btnBuscar", "Buscando tickets…");
    MEUI.autoSpinner("#btnCerrar", "Cerrando casos…");
    MEUI.autoSpinner("#btnReintentar", "Reintentando…");
    // Estos botones no se deshabilitan solos: el spinner se libera al terminar
    // la tanda, que es cuando «Pausar» vuelve a quedar deshabilitado.
    const obs = new MutationObserver(() => {
        if (el("btnPausa").disabled) {
            ["btnBuscar", "btnCerrar", "btnReintentar"].forEach(id => MEUI.libre(el(id)));
            // libre() reactiva el botón: hay que devolverle el estado que le toca
            // (p. ej. «Cerrar casos» sigue bloqueado si ya no queda nada listo).
            if (typeof window.actualizarBotones === "function") actualizarBotones();
        }
    });
    obs.observe(el("btnPausa"), { attributes: true, attributeFilter: ["disabled"] });

    /* --- 6 · Registro ------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("consola").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista.", "ok");
})();