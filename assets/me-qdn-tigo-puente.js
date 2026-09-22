/* =====================================================================
   me-qdn-tigo-puente.js
   ---------------------------------------------------------------------
   Conecta la lógica de la consulta QDN Tigo con el shell común (me-ui).
   No modifica esa lógica: la envuelve desde fuera.

   Va SIEMPRE al final del <body>, después del <script> de la lógica:

       <script src="assets/me-ui.js"></script>
       <script> MEUI.init({...}); </script>
       <script src="assets/logica-qdn-tigo.js"></script>
       <script src="assets/me-qdn-tigo-puente.js"></script>
===================================================================== */
(function puente() {
    "use strict";

    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";
    const el = id => document.getElementById(id);
    const faltantes = [];

    /* --- 0 · ¿Cargó la lógica de la herramienta? ---------------------- */
    if (!existe(() => cfgTigo) || !esFn("render")) {
        MEUI.log("La lógica de la consulta no se ejecutó. Diagnóstico:", "err");
        const cargado = n => Array.from(document.scripts).some(sc => (sc.src || "").indexOf(n) >= 0);
        if (!cargado("logica-qdn-tigo.js")) {
            MEUI.log("· Falta <script src=\"assets/logica-qdn-tigo.js\"></script> en el HTML.", "err");
        } else {
            MEUI.log("· El archivo está enlazado, así que hay un error dentro de "
                + "assets/logica-qdn-tigo.js. El detalle aparece arriba en este registro "
                + "(archivo:línea:columna).", "err");
        }
        MEUI.toast("La lógica de la consulta no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Enter en el campo de líneas lanza la consulta ------------- */
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 2 · Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "consulta_qdn_tigo";
    if (esFn("filasExport")) {
        reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
        reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "QDN Tigo"); });
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
