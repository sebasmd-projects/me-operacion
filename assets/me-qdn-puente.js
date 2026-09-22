/* =====================================================================
   me-qdn-puente.js
   ---------------------------------------------------------------------
   Conecta la lógica del validador QDN con el shell común (me-ui). No
   modifica esa lógica: la envuelve desde fuera, igual que los demás
   puentes de esta suite.

   Va SIEMPRE al final del <body>, después del <script> de la lógica:

       <script src="assets/me-ui.js"></script>
       <script> MEUI.init({...}); </script>
       <script src="assets/logica-qdn.js"></script>
       <script src="assets/me-qdn-puente.js"></script>
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";
    const el = id => document.getElementById(id);
    const faltantes = [];

    /* --- 0 · ¿Cargó la lógica de la herramienta? ---------------------- */
    if (!existe(() => cfgQdn) || !esFn("render")) {
        MEUI.log("La lógica del validador no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("logica-qdn.js")) {
            MEUI.log("· Falta <script src=\"assets/logica-qdn.js\"></script> en el HTML.", "err");
        } else {
            MEUI.log("· El archivo está enlazado, así que hay un error dentro de "
                + "assets/logica-qdn.js. El detalle aparece arriba en este registro "
                + "(archivo:línea:columna).", "err");
        }
        MEUI.toast("La lógica del validador no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión QDN en la cabecera --------------------------------- */
    const cQdn = MEUI.cred.get("qdn");
    if (cQdn && el("cfgClientSecret") && !el("cfgClientSecret").value) {
        if (cQdn.token_url) el("cfgTokenUrl").value = cQdn.token_url;
        if (cQdn.client_id) el("cfgClientId").value = cQdn.client_id;
        if (cQdn.base_apigw) el("cfgBaseApigw").value = cQdn.base_apigw;
    }
    document.addEventListener("me:sesion-iniciar", e => {
        if (e.detail.clave === "qdn" && el("btnProbarQdn")) el("btnProbarQdn").click();
    });
    document.addEventListener("me:sesion-cerrar", e => {
        if (e.detail.clave !== "qdn") return;
        gestorQdn.reset();
        MEUI.log("Sesión QDN cerrada.", "warn");
    });
    if (el("btnProbarQdn")) el("btnProbarQdn").addEventListener("click", () =>
        MEUI.cred.set("qdn", {
            token_url: el("cfgTokenUrl").value.trim(),
            client_id: el("cfgClientId").value.trim(),
            base_apigw: el("cfgBaseApigw").value.trim()
        }));

    /* --- 2 · Enter en el campo de líneas lanza la consulta ------------- */
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 3 · Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "validador_qdn";
    if (esFn("filasExport")) {
        reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
        reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "QDN"); });
    } else faltantes.push("filasExport");
    if (el("btnJSON") && esFn("filasParaExportar"))
        el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 4 · Retroalimentación visible -------------------------------- */
    MEUI.autoSpinner("#btnConsultar", "Consultando QDN…");
    MEUI.autoSpinner("#btnProbarQdn", "Obteniendo token…");

    /* --- 5 · Registro --------------------------------------------------- */
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
