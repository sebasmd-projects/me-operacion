/* =====================================================================
   me-hlr-hss-puente.js · Interruptor de pestañas de hlr_hss.html
   ---------------------------------------------------------------------
   No es un puente como los demás (no conecta UNA lógica con el shell):
   conecta TRES motores independientes (logica-hlr-hss-tigo.js, -claro.js,
   -ambos.js) con un único documento, montando y desmontando el
   <template> de la pestaña activa, y reengancha en CADA montaje lo que
   antes vivía en tres puentes separados (me-qdn-puente.js,
   me-qdn-tigo-puente.js, me-hlr-cruzado-puente.js): Enter para consultar,
   exportaciones CSV/Excel/JSON, spinners automáticos, botones de
   registro y -solo en Claro- la sesión QDN de la cabecera.

   Por qué desmontar y no solo ocultar con CSS: los tres motores fueron
   escritos como páginas independientes y comparten (por diseño, de
   antes de esta fusión) los mismos ids -#tablaResultados, #inputLineas,
   #modalDetalle, #logConexion...-. Si dos pestañas estuvieran montadas a
   la vez (aunque una estuviera oculta con `hidden`), habría DOS
   elementos con el mismo id en el documento, y `MEUI.$("#id")` /
   `document.getElementById` solo encuentran el primero: la pestaña
   "de atrás" quedaría rota. Por eso solo la pestaña activa vive en el
   DOM en cada momento, y por lo que TODO el enganche de esta pestaña
   -no solo el motor- se rehace en cada montaje: los elementos son
   nodos nuevos (clonados del <template>), sin ningún listener todavía.

   Va SIEMPRE al final del <body>, después de los tres motores:

       <script src="assets/logica-hlr-hss-tigo.js"></script>
       <script src="assets/logica-hlr-hss-claro.js"></script>
       <script src="assets/logica-hlr-hss-ambos.js"></script>
       <script src="assets/me-hlr-hss-puente.js"></script>
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    const MOTORES = {
        tigo: {
            template: "panelTigo", motor: () => window.MotorTigo, etiqueta: "Tigo",
            exportBase: "hlr_hss_tigo", exportHoja: "QDN Tigo",
            spinnerConsultar: "Consultando HLR Tigo…"
        },
        claro: {
            template: "panelClaro", motor: () => window.MotorClaro, etiqueta: "Claro",
            exportBase: "hlr_hss_claro", exportHoja: "QDN Claro",
            spinnerConsultar: "Consultando QDN Claro…",
            sesionQdn: true
        },
        ambos: {
            template: "panelAmbos", motor: () => window.MotorAmbos, etiqueta: "Ambos",
            exportBase: "hlr_hss_ambos", exportHoja: "Cruce HLR",
            spinnerConsultar: "Consultando Claro y Tigo…"
        }
    };

    const montado = document.getElementById("panelMontado");
    let actual = null;

    /** Todo lo que antes vivía en el puente de cada herramienta por separado
     *  (no en el motor): se rehace en cada montaje porque los elementos son
     *  nodos nuevos, recién clonados del <template>, sin listeners. */
    function engancharComun(cfg, motor) {
        MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

        const reemplazar = (id, fn) => {
            const b = el(id); if (!b) return;
            const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
        };
        if (typeof motor.filasExport === "function") {
            reemplazar("btnCSV", () => { const d = motor.filasExport(); MEUI.exportarCSV(d.head, d.rows, cfg.exportBase); });
            reemplazar("btnXLSX", () => { const d = motor.filasExport(); MEUI.exportarXLSX(d.head, d.rows, cfg.exportBase, cfg.exportHoja); });
        }
        if (el("btnJSON") && typeof motor.filasParaExportar === "function")
            el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(motor.filasParaExportar(), cfg.exportBase));

        MEUI.autoSpinner("#btnConsultar", cfg.spinnerConsultar);

        if (el("btnLimpiarLog")) el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
        if (el("btnCopiarLog")) el("btnCopiarLog").addEventListener("click", () => {
            navigator.clipboard.writeText(el("logConexion").innerText)
                .then(() => MEUI.toast("Registro copiado.", "ok"))
                .catch(() => MEUI.toast("No se pudo copiar.", "err"));
        });

        // Sesión QDN (solo Claro): si la cabecera ya tiene credenciales
        // guardadas, se usan en vez de las de fábrica.
        if (cfg.sesionQdn) {
            const cQdn = MEUI.cred.get("qdn");
            if (cQdn && el("cfgClientSecret") && !el("cfgClientSecret").value) {
                if (cQdn.token_url) el("cfgTokenUrl").value = cQdn.token_url;
                if (cQdn.client_id) el("cfgClientId").value = cQdn.client_id;
                if (cQdn.base_apigw) el("cfgBaseApigw").value = cQdn.base_apigw;
            }
            engancharSesionCm();
        }
    }

    /** Sesión del CM en la pestaña Claro. No se usa para consultar nada:
     *  solo identifica QUIÉN está operando (el login de Keycloak) y con eso
     *  se habilita el aprovisionamiento a los usuarios autorizados. Mismo
     *  patrón que el paso "Sesión del CM" de Portabilidad Tigo. */
    async function conectarCm(silencioso) {
        const auth = window.MEAPI && MEAPI.auth;
        if (!auth) return false;
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
            return false;
        }
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("user").value.trim(), clave: el("pass").value });
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    function engancharSesionCm() {
        if (!el("btnLogin")) return;
        el("btnLogin").addEventListener("click", () =>
            MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectarCm(false)));
        MEUI.enterEjecuta(el("pass"), el("btnLogin"));

        // Credenciales compartidas con las demás herramientas: si ya se
        // inició sesión en otra pestaña, se entra solo -así el usuario
        // autorizado ve el aprovisionamiento sin hacer nada más-.
        const credCm = MEUI.cred.get("cm");
        if (credCm) {
            if (!el("user").value) el("user").value = credCm.usuario || "";
            if (!el("pass").value) el("pass").value = credCm.clave || "";
        }
        const auth = window.MEAPI && MEAPI.auth;
        if (auth && el("user").value && el("pass").value && !auth.token) {
            MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
            conectarCm(true);
        }
    }

    function montar(clave) {
        const cfg = MOTORES[clave];
        if (!cfg) return;
        if (actual === clave) return;   // ya está esta pestaña activa

        // Se desmonta TODO lo anterior antes de montar lo nuevo (ver el
        // porqué en el encabezado del archivo).
        montado.innerHTML = "";

        const tpl = document.getElementById(cfg.template);
        if (!tpl) {
            MEUI.log(`No se encontró la plantilla "${cfg.template}" para la pestaña ${cfg.etiqueta}.`, "err");
            return;
        }
        montado.appendChild(tpl.content.cloneNode(true));

        document.querySelectorAll("[data-tab]").forEach(b => {
            const activa = b.dataset.tab === clave;
            b.classList.toggle("activa", activa);
            b.setAttribute("aria-selected", activa ? "true" : "false");
        });
        actual = clave;

        // MEUI.montarPasos() (el plegado de las secciones [data-me-paso])
        // solo corre una vez, dentro de MEUI.init(); el marcado que se
        // acaba de clonar no ha pasado por ahí todavía. Se repite aquí
        // para esta tanda de elementos nuevos -montarPasos() ya se
        // encarga de no tocar dos veces lo que ya estaba montado.
        MEUI.montarPasos();
        MEUI.aplicarAperturaPasos();
        // Y lo mismo con el botón "Contraer" de la columna de pasos: cuando
        // MEUI.init() corrió, .me-trabajo todavía vivía dentro del
        // <template> (no existía en el documento), así que no se montó
        // nunca; y cada cambio de pestaña destruye el que hubiera. Sin esto
        // la columna de pasos no se puede contraer en ninguna pestaña.
        MEUI.montarTogglePasos();

        const motor = cfg.motor();
        if (!motor || typeof motor.iniciar !== "function") {
            MEUI.log(`No se pudo iniciar el motor "${cfg.etiqueta}": revisa que su script haya cargado sin errores (ver más arriba en este registro).`, "err");
            MEUI.toast(`La pestaña ${cfg.etiqueta} no cargó. Mira el registro.`, "err");
            return;
        }
        try {
            // reiniciar() limpia el dataTable de la visita anterior a esta
            // MISMA pestaña (si la hubo): sin esto, construirDataTable()
            // vería su variable ya asignada y no crearía una tabla nueva
            // sobre el <table> recién clonado, que quedaría en blanco.
            if (typeof motor.reiniciar === "function") motor.reiniciar();
            motor.iniciar();
            engancharComun(cfg, motor);
            MEUI.log(`Pestaña "${cfg.etiqueta}" lista.`, "ok");
        } catch (e) {
            MEUI.log(`Error iniciando la pestaña "${cfg.etiqueta}": ${e.message}`, "err");
            MEUI.toast(`No se pudo iniciar la pestaña ${cfg.etiqueta}. Mira el registro.`, "err");
        }
        setTimeout(MEUI.ajustarTablas, 250);
    }

    document.querySelectorAll("[data-tab]").forEach(b =>
        b.addEventListener("click", () => montar(b.dataset.tab)));

    // Sesión QDN de la cabecera: es el único lugar desde donde se conecta a
    // mano (la pestaña Claro ya no tiene botón de "Probar conexión": el
    // token se pide solo al consultar). Solo aplica con Claro montado.
    document.addEventListener("me:sesion-iniciar", e => {
        if (actual !== "claro") {
            MEUI.toast("Las sesiones se inician desde la pestaña Claro.", "warn");
            return;
        }
        if (e.detail.clave === "cm") {
            // Sin credenciales a la mano: se abre el paso 1 para escribirlas.
            if (el("user") && el("user").value && el("pass") && el("pass").value) { el("btnLogin").click(); return; }
            MEUI.abrirPaso(1, true);
            if (el("user")) el("user").focus();
            return;
        }
        if (e.detail.clave !== "qdn") return;
        const claro = window.MotorClaro;
        if (!claro || typeof claro.conectar !== "function") return;
        MEUI.cred.set("qdn", {
            token_url: el("cfgTokenUrl") ? el("cfgTokenUrl").value.trim() : "",
            client_id: el("cfgClientId") ? el("cfgClientId").value.trim() : "",
            base_apigw: el("cfgBaseApigw") ? el("cfgBaseApigw").value.trim() : ""
        });
        claro.conectar();
    });
    document.addEventListener("me:sesion-renovar", e => {
        const auth = window.MEAPI && MEAPI.auth;
        if (e.detail && e.detail.clave === "cm" && auth && auth.token) {
            auth.reauth(auth.version).catch(err => MEUI.log("No se pudo renovar el CM: " + err.message, "err"));
        }
    });
    document.addEventListener("me:sesion-cerrar", e => {
        if (e.detail.clave === "cm") {
            const auth = window.MEAPI && MEAPI.auth;
            if (auth) { auth.token = null; auth.refreshToken = null; auth.expiresAt = null; }
            if (el("pass")) el("pass").value = "";
            return;
        }
        if (e.detail.clave !== "qdn") return;
        const claro = window.MotorClaro;
        if (claro && claro.gestorQdn) claro.gestorQdn.reset();
        MEUI.log("Sesión QDN cerrada.", "warn");
    });

    // Al cambiar la sesión del CM (entrar, vencer, salir) el menú de
    // operaciones de Claro se vuelve a pintar: "Aprovisionamiento" aparece
    // o desaparece según quién esté y si su sesión sigue vigente.
    document.addEventListener("me:sesion-cambio", () => {
        const claro = window.MotorClaro;
        if (actual === "claro" && claro && typeof claro.repintarOperaciones === "function") claro.repintarOperaciones();
    });

    // Arranca en "Tigo": es la pestaña de solo lectura y menor riesgo -no
    // tiene sentido que el primer vistazo a la herramienta aterrice en
    // Claro, que trae operaciones de escritura sobre la línea.
    montar("tigo");
})();
