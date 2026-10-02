/* =====================================================================
   me-titularidad-puente.js
   ---------------------------------------------------------------------
   Conecta logica-titularidad.js con el shell común (me-ui). No modifica
   esa lógica: la envuelve desde fuera, igual que los demás puentes.
   Va SIEMPRE al final del <body>.

   Esta herramienta tiene DOS sesiones a la vez (Genesis y CM), así que
   los eventos del chip de sesión hay que mirarlos por `detail.clave`: en
   las demás herramientas basta con disparar el único botón de login que
   hay, aquí eso iniciaría la sesión equivocada.
===================================================================== */
(function puente() {
    "use strict";

    const el = id => document.getElementById(id);
    const existe = f => { try { return f() !== undefined; } catch (e) { return false; } };
    const esFn = n => typeof window[n] === "function";

    /* --- 0 · ¿Cargó todo lo que hace falta? --------------------------- */
    const piezas = [
        ["me-api.js", () => window.MEAPI],
        ["genesis-api.js", () => window.GENESIS],
        ["hlr-consulta.js", () => window.HLRConsulta],
        ["cm-lineas.js", () => window.CMLineas]
    ];
    const faltan = piezas.filter(([, hay]) => !hay()).map(([n]) => n);
    if (faltan.length || !esFn("render")) {
        MEUI.log("La herramienta no arrancó. Diagnóstico:", "err");
        faltan.forEach(n => MEUI.log(`· Falta <script src="assets/${n}"></script> antes de la lógica.`, "err"));
        if (!faltan.length) {
            MEUI.log("· Los archivos están enlazados, así que hay un error dentro de "
                + "assets/logica-titularidad.js. El detalle aparece arriba en este registro.", "err");
        }
        MEUI.toast("La herramienta no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 1 · Sesión de Genesis ---------------------------------------- */
    async function entrarGenesis() {
        const u = (el("gUser").value || "").trim();
        const p = el("gPass").value || "";
        if (!u || !p) {
            MEUI.toast("Escribe usuario y contraseña de Genesis, o pega un token.", "warn");
            return false;
        }
        try {
            await GENESIS.auth.login(u, p);
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ Genesis: " + e.message, "err");
            MEUI.toast("No se pudo iniciar sesión en Genesis.", "err");
            return false;
        }
    }

    function usarToken() {
        const t = el("gToken").value || "";
        try {
            GENESIS.auth.usarToken(t);
            el("gToken").value = "";
            MEUI.toast("Token de Genesis aceptado.", "ok");
            MEUI.aplicarAperturaPasos();
        } catch (e) {
            MEUI.log("✖ Token de Genesis: " + e.message, "err");
            MEUI.toast(e.message, "err");
        }
    }

    el("btnLoginGenesis").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLoginGenesis"), "Conectando…", entrarGenesis));
    el("btnTokenGenesis").addEventListener("click", usarToken);
    MEUI.enterEjecuta(el("gPass"), el("btnLoginGenesis"));

    /* --- 2 · Sesión del CM (misma mecánica que las demás herramientas) - */
    async function entrarCm(silencioso) {
        const auth = MEAPI.auth;
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            MEUI.abrirPaso(1, true);
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
            MEUI.log("✖ CM: " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => entrarCm(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    /* --- 3 · Eventos del chip, cada uno a SU sesión -------------------- */
    document.addEventListener("me:sesion-iniciar", ev => {
        const clave = ev.detail && ev.detail.clave;
        if (clave === "genesis") el("btnLoginGenesis").click();
        else if (clave === "cm") el("btnLogin").click();
    });
    document.addEventListener("me:sesion-cerrar", ev => {
        const clave = ev.detail && ev.detail.clave;
        if (clave === "genesis") { GENESIS.auth.salir(); el("gPass").value = ""; }
        else if (clave === "cm") {
            MEAPI.auth.token = null; MEAPI.auth.refreshToken = null; MEAPI.auth.expiresAt = null;
            el("pass").value = "";
        }
    });
    document.addEventListener("me:sesion-renovar", ev => {
        const clave = ev.detail && ev.detail.clave;
        if (clave === "cm" && MEAPI.auth.token) {
            MEAPI.auth.reauth(MEAPI.auth.version)
                .catch(e => MEUI.log("No se pudo renovar el CM: " + e.message, "err"));
        }
        if (clave === "genesis" && GENESIS.auth.refreshToken) {
            GENESIS.auth.refrescar()
                .catch(e => MEUI.log("No se pudo renovar Genesis: " + e.message, "err"));
        }
    });

    /* --- 4 · Credenciales del CM compartidas con las otras pestañas ---- */
    const c = MEUI.cred.get("cm");
    if (c && el("user")) {
        if (!el("user").value) el("user").value = c.usuario || "";
        if (!el("pass").value) el("pass").value = c.clave || "";
    }
    if (el("user").value && el("pass").value && !MEAPI.auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        entrarCm(true);
    }

    /* --- 5 · Carga y acciones sobre lo marcado ------------------------- */
    // Rango de fechas: el aviso de «N días · N tramos · N peticiones» se rehace con
    // cada cambio, ANTES de que nadie pulse el botón.
    el("fDesde").addEventListener("input", () => actualizarAvisoRango());
    el("fHasta").addEventListener("input", () => actualizarAvisoRango());
    // Tres formas de cargar, de la más barata a la más cara (ver «Qué se
    // carga» en la lógica): los más nuevos (por defecto), un rango, o todo.
    el("btnCargar").addEventListener("click", () => cargarGenesis());
    el("btnCargarRango").addEventListener("click", () => cargarGenesis({ modo: "rango" }));

    // Traer TODO sin rango ni tope: cerrado por defecto y con casilla. Son miles
    // de peticiones y de 5 a 10 minutos; no debe ser el camino fácil ni algo que
    // se lance con un clic suelto. La casilla se vuelve a desmarcar tras cada
    // uso: cada carga completa se confirma de nuevo.
    const armarTodo = () => { el("btnCargarTodo").disabled = !el("chkEntiendoTodo").checked; };
    el("chkEntiendoTodo").addEventListener("change", armarTodo);
    el("btnCargarTodo").addEventListener("click", () => {
        const lanzada = cargarGenesis({ modo: "todo" });
        el("chkEntiendoTodo").checked = false;
        Promise.resolve(lanzada).finally(armarTodo);   // `libre` lo habilita al terminar; sin casilla, debe quedar apagado
        armarTodo();
    });

    el("btnCancelar").addEventListener("click", () => {
        cancelarTrabajo();
        MEUI.log("Cancelando…", "warn");
    });
    el("btnConsultarHlr").addEventListener("click", () =>
        MEUI.conSpinner(el("btnConsultarHlr"), "Consultando…", consultarHlr));
    el("btnConsultarCm").addEventListener("click", () =>
        MEUI.conSpinner(el("btnConsultarCm"), "Consultando…", consultarCm));

    // Selección. La casilla de la cabecera de la tabla (solo la página) la
    // engancha la lógica, porque nace con la tabla.
    el("btnSelTodos").addEventListener("click", () => seleccionarTodos());
    el("btnSelPrimeros").addEventListener("click", () => seleccionarPrimeros(CONFIG.maxSeleccion));
    el("btnDesmarcar").addEventListener("click", () => desmarcarTodo());

    // Ocultar / Mostrar: mismos nombres y comportamiento que en «Estado de
    // líneas» y «Cierre masivo de casos».
    el("btnOcultarSel").addEventListener("click", () => ocultarMarcadas());
    el("btnOcultarNoSel").addEventListener("click", () => ocultarNoMarcadas());
    el("btnRestaurarOcultas").addEventListener("click", () => mostrarTodas());
    el("chkVerOcultas").addEventListener("change", ev => fijarFiltro("verOcultas", ev.target.checked ? "1" : ""));

    /* --- 6 · Filtros --------------------------------------------------- */
    const liga = (id, campo) => {
        const e = el(id);
        if (!e) return;
        const ev = e.tagName === "INPUT" ? "input" : "change";
        let t = null;
        e.addEventListener(ev, () => {
            clearTimeout(t);
            t = setTimeout(() => { fijarFiltro(campo, e.value); }, ev === "input" ? 200 : 0);
        });
    };
    liga("fTexto", "texto");
    liga("fOperacion", "operacion");
    liga("fResultado", "resultado");
    liga("fUbicacion", "ubicacion");
    liga("fCanal", "canal");
    liga("fSel", "sel");

    // Si llegó un valor nuevo mientras un filtro tenía el foco, sus opciones
    // se dejaron para después (reescribir un <select> abierto lo cierra):
    // este es ese «después».
    ["fOperacion", "fResultado", "fCanal"].forEach(id =>
        el(id).addEventListener("blur", () => refrescarOpcionesFiltros()));

    el("btnLimpiarFiltros").addEventListener("click", () => {
        ["fTexto", "fOperacion", "fResultado", "fUbicacion", "fCanal", "fSel"]
            .forEach(id => { if (el(id)) el(id).value = ""; });
        el("chkVerOcultas").checked = false;
        limpiarFiltros();
    });

    /* --- 7 · Detalle al hacer clic en una fila ------------------------- */
    document.querySelector("#tablaTitularidad").addEventListener("click", ev => {
        if (ev.target.closest("input, button, a")) return;   // marcar no es abrir
        const tr = ev.target.closest("tbody tr");
        if (!tr) return;
        const chk = tr.querySelector(".chk-fila");
        if (chk) verDetalle(chk.dataset.id);
    });

    /* --- 8 · Exportación ---------------------------------------------- */
    const base = "titularidad";
    el("btnCSV").addEventListener("click", () => {
        const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base);
    });
    el("btnXLSX").addEventListener("click", () => {
        const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "Titularidad");
    });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 9 · Registro -------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        MEUI.copiarTexto(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista. Inicia sesión en Genesis para cargar los datos.", "ok");
})();
