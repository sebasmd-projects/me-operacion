/* =====================================================================
   me-ui.js · Shell común — Herramientas Operación Móvil Éxito
   ---------------------------------------------------------------------
   Se carga DESPUÉS de dependencias.js (Bootstrap, DataTables, SheetJS…) y de
   catalogo.js (las herramientas). No toca la lógica de negocio de cada
   herramienta: solo aporta

     · el marco visual (lateral, cabecera, pie) alrededor del contenido; el
       menú, el título, la versión y la documentación salen de ME_CATALOGO
     · una única sesión (SIME y CM) compartida entre los 4 archivos
     · el registro (log) con las instrucciones de uso al abrir
     · defaults de DataTables, altura de tablas y ajuste automático
     · lectura de líneas/archivos y exportación CSV/XLSX/JSON

   Uso mínimo en cada HTML:
       <body class="me-body">
       ...
       <script src="assets/base/catalogo.js"></script>
       <script src="assets/base/me-ui.js"></script>
       <script> MEUI.init({ app: "prepagadas", sesiones: ["sime", "cm"], ... }); </script>
===================================================================== */
(function (global) {
  "use strict";

  /* ---------- utilidades ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = v => String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const hoy = () => new Date();
  const dosCifras = n => String(n).padStart(2, "0");
  /* Almacén con respaldo en memoria.
     Edge puede bloquear localStorage en páginas file:// («Tracking Prevention
     blocked access to storage»). Cuando pasa, la herramienta sigue funcionando:
     lo único que se pierde es compartir la sesión ENTRE archivos. */
  const memoria = Object.create(null);
  let almacenBloqueado = false;

  const guardar = (k, v) => {
    memoria[k] = v;
    try { localStorage.setItem(k, v); } catch (e) { almacenBloqueado = true; }
  };
  const leer = k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) return v;
    } catch (e) { almacenBloqueado = true; }
    return (k in memoria) ? memoria[k] : null;
  };
  const olvidar = k => {
    delete memoria[k];
    try { localStorage.removeItem(k); } catch (e) { almacenBloqueado = true; }
  };

  /* =====================================================================
     Catálogo de herramientas: assets/base/catalogo.js (ME_CATALOGO).
     Aquí solo se LEE: el menú, el título, la versión y la documentación de
     cada página salen de ahí, así que no se repiten en ningún otro sitio.
  ===================================================================== */
  const CATALOGO = global.ME_CATALOGO;
  if (!CATALOGO) {
    throw new Error("me-ui.js: falta <script src=\"…/assets/base/catalogo.js\"> antes de me-ui.js.");
  }

  const CFG = {
    app: "", version: CATALOGO.version, titulo: document.title || "Herramienta",
    descripcion: "", marca: "Herramientas", submarca: "Operación · Móvil Éxito",
    sesiones: ["sime", "cm"],      // sesiones NECESARIAS: sin ellas la herramienta no sirve

    /* Sesiones OPCIONALES. Sale su chip y se puede iniciar, pero la
       herramienta no las exige para abrirse. Es para los sistemas que solo
       usa parte de la gente: Genesis, por ejemplo, requiere un login
       corporativo con 2FA que muchos analistas no tienen, y pedírselo a todos
       al entrar convierte un paso opcional en un muro. */
    sesionesOpcionales: [],
    instrucciones: [],             // líneas que abren el registro
    doc: "",                       // README.md de la herramienta (pie + modal XL)
    umbralRenovar: 15,             // segundos antes de vencer para pedir renovación
    umbralAviso: 60                // segundos en los que el chip se pone naranja
  };

  const NOMBRE_SESION = { cm: "CM", sime: "SIME", qdn: "QDN", genesis: "Genesis" };

  /* =====================================================================
     1 · SESIÓN COMPARTIDA
     Cada página maneja su propio token (no se puede compartir un objeto JS
     entre archivos), pero el ESTADO y las CREDENCIALES sí se comparten por
     localStorage + BroadcastChannel: al iniciar sesión en una pestaña, las
     demás lo reflejan y pueden autenticarse solas sin volver a preguntar.

     Aviso: localStorage no es un almacén seguro. Se usa el mismo criterio
     que ya tenía el lanzador (.bat), que pasaba usuario y clave en el
     fragmento de la URL. Se limpia con MEUI.sesion.cerrar(...).
  ===================================================================== */
  const canal = ("BroadcastChannel" in global) ? new BroadcastChannel("me-ui") : null;
  const K_SES = c => "me.sesion." + c;
  const K_CRED = c => "me.cred." + c;
  const ofusca = s => { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ""; } };
  const desofusca = s => { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return ""; } };

  const sesion = {
    _avisado: {},

    /** Estado actual de una sesión: {estado, usuario, expira} */
    estado(clave) {
      let d = null;
      try { d = JSON.parse(leer(K_SES(clave)) || "null"); } catch (e) { }
      if (!d) return { estado: "off", usuario: "", expira: null, restan: null };
      const restan = d.expira ? Math.max(0, Math.round((d.expira - Date.now()) / 1000)) : null;
      let estado = d.estado || "ok";
      if (estado === "ok" && restan !== null) {
        if (restan <= 0) estado = "err";
        else if (restan <= CFG.umbralAviso) estado = "warn";
      }
      return { estado, usuario: d.usuario || "", expira: d.expira || null, restan };
    },

    /**
     * Registra una sesión activa.
     * @param clave  'cm' | 'sime'
     * @param datos  {usuario, duracion (seg) | expira (ms epoch), estado}
     */
    set(clave, datos) {
      const d = {
        usuario: datos.usuario || "",
        estado: datos.estado || "ok",
        expira: datos.expira || (datos.duracion ? Date.now() + datos.duracion * 1000 : null),
        sello: Date.now()
      };
      guardar(K_SES(clave), JSON.stringify(d));
      sesion._avisado[clave] = false;
      difundir({ tipo: "sesion", clave });
      pintarSesiones();
      return d;
    },

    /** Marca la sesión como caída/expirada sin borrar credenciales. */
    caida(clave, motivo) {
      guardar(K_SES(clave), JSON.stringify({ usuario: sesion.estado(clave).usuario, estado: "err", expira: null }));
      difundir({ tipo: "sesion", clave });
      pintarSesiones();
      if (motivo) api.log("Sesión " + (NOMBRE_SESION[clave] || clave) + " caída: " + motivo, "err");
    },

    /** Cierra sesión y (opcional) olvida las credenciales guardadas. */
    cerrar(clave, olvidarCredenciales) {
      olvidar(K_SES(clave));
      if (olvidarCredenciales) olvidar(K_CRED(clave));
      difundir({ tipo: "sesion", clave });
      pintarSesiones();
      document.dispatchEvent(new CustomEvent("me:sesion-cerrar", { detail: { clave, olvidarCredenciales } }));
    }
  };

  const cred = {
    /** Devuelve {usuario, clave} para 'cm' o {prf} para 'sime'. */
    get(c) {
      const v = leer(K_CRED(c));
      if (!v) return null;
      try { return JSON.parse(desofusca(v)); } catch (e) { return null; }
    },
    set(c, obj) {
      if (!obj) return;
      guardar(K_CRED(c), ofusca(JSON.stringify(obj)));
      difundir({ tipo: "cred", clave: c });
    },
    borrar(c) { olvidar(K_CRED(c)); }
  };

  function difundir(msg) { if (canal) { try { canal.postMessage(msg); } catch (e) { } } }
  if (canal) canal.onmessage = () => pintarSesiones();
  global.addEventListener("storage", e => { if (e.key && e.key.indexOf("me.") === 0) pintarSesiones(); });

  /* Lee lo que dejó el lanzador (.bat) en la URL y lo comparte con el resto
     de herramientas. Después limpia la URL para que no quede en el historial. */
  function leerArranque() {
    const q = new URLSearchParams(location.search.slice(1));
    const h = new URLSearchParams(location.hash.slice(1));
    const dato = k => q.get(k) || h.get(k) || "";
    const prf = dato("prf"), u = dato("cm_user"), p = dato("cm_pass"), abierto = dato("abierto");
    // Versión nueva publicada (la detecta dame click.bat): se avisa una sola
    // vez, al abrir. Al navegar entre herramientas ya no está en la URL.
    const nv = dato("nv"), va = dato("va");
    if (/^\d+(\.\d+){0,2}$/.test(nv)) avisoVersion = { nueva: nv, actual: /^\d+(\.\d+){0,2}$/.test(va) ? va : "" };

    if (abierto) guardar("me.abierto", abierto);
    if (prf) cred.set("sime", { prf });
    if (u || p) {
      const previo = cred.get("cm") || {};
      cred.set("cm", { usuario: u || previo.usuario || "", clave: p || previo.clave || "" });
    }
    if (prf || u || p || abierto || nv) {
      try { history.replaceState(null, "", location.pathname); } catch (e) { location.hash = ""; }
      return true;
    }
    return false;
  }

  /* =====================================================================
     2 · SHELL (lateral + cabecera + pie)
  ===================================================================== */
  /* El mismo menú se pinta en dos sitios que están a distinta profundidad:
     la portada (index.html, en la raíz) y las herramientas (en la carpeta
     «herramientas»). Las rutas del catálogo son relativas a la RAÍZ, así que
     hay que traducirlas según quién las use; si no, los enlaces del lateral
     y la documentación apuntarían a archivos que no existen. */
  function rutaDesdeRaiz(ruta) {
    return /\/herramientas\//i.test(location.pathname) ? "../" + ruta : ruta;
  }

  /** Los grupos del menú, en el orden del catálogo, con sus herramientas. */
  function gruposDelMenu() {
    return CATALOGO.grupos.map(grupo => ({
      grupo,
      items: CATALOGO.herramientas
        .filter(h => h.grupo === grupo)
        .sort((a, b) => a.orden - b.orden)
    })).filter(g => g.items.length);
  }

  function navHTML() {
    return gruposDelMenu().map(g => `
      <div class="me-nav-grupo">${esc(g.grupo)}</div>
      ${g.items.map(it => {
        const etiqueta = it.menu || it.nombre;
        return `
        <a class="me-nav-item ${it.id === CFG.app ? "activo" : ""}" href="${esc(rutaDesdeRaiz(it.html))}" title="${esc(etiqueta)}">
          <i class="bi ${esc(it.icono)}"></i><span>${esc(etiqueta)}</span>
        </a>`;
      }).join("")}`).join("");
  }

  /** Las necesarias y las opcionales, en ese orden y sin repetidas. */
  function todasLasSesiones() {
    const vistas = new Set();
    return [].concat(CFG.sesiones || [], CFG.sesionesOpcionales || [])
      .filter(c => c && !vistas.has(c) && vistas.add(c));
  }

  const esOpcional = clave => (CFG.sesionesOpcionales || []).indexOf(clave) >= 0;

  function chipHTML(clave) {
    const opc = esOpcional(clave);
    return `<button type="button" class="me-sesion" data-me-sesion="${clave}" data-estado="off"
              ${opc ? 'data-me-opcional="1"' : ""}
              title="Sesión ${esc(NOMBRE_SESION[clave] || clave)}${opc ? " (opcional)" : ""}">
        <span class="me-dot"></span>
        <span class="me-sesion-txt">
          <span class="me-sesion-quien">${esc(NOMBRE_SESION[clave] || clave)}</span>
          <span class="me-sesion-reloj"></span>
        </span>
      </button>`;
  }

  /* 2 · BUSCADOR GLOBAL
     Inicio consume el mismo resultado mediante un evento; las demás
     páginas usan enlaces relativos a la raíz, también sobre file://. */
  function montarBuscador() {
    const contenedor = $("#meBuscador");
    const campo = $("#meBuscar");
    const boton = $("#meBuscarToggle");
    const lista = $("#meBuscarResultados");
    let activo = -1;

    function cerrar() {
      lista.hidden = true;
      if (CFG.app !== "inicio") campo.setAttribute("aria-expanded", "false");
      campo.removeAttribute("aria-activedescendant");
      activo = -1;
    }

    function enfocar() {
      contenedor.classList.add("abierto");
      boton.setAttribute("aria-expanded", "true");
      campo.focus();
    }

    function seleccionar(posicion) {
      const opciones = Array.from(lista.querySelectorAll('[role="option"]'));
      if (lista.hidden || !opciones.length) return;
      activo = (posicion + opciones.length) % opciones.length;
      opciones.forEach((opcion, i) => opcion.setAttribute("aria-selected", String(i === activo)));
      campo.setAttribute("aria-activedescendant", opciones[activo].id);
      if (opciones[activo].scrollIntoView) opciones[activo].scrollIntoView({ block: "nearest" });
    }

    function actualizar() {
      const texto = campo.value;
      const resultados = CATALOGO.buscar(texto);
      cerrar();
      if (CFG.app === "inicio") {
        document.dispatchEvent(new CustomEvent("me:buscar", {
          detail: { texto, ids: resultados.map(h => h.id) }
        }));
        return;
      }
      if (!texto.trim()) return;
      lista.innerHTML = resultados.length ? resultados.map((h, i) => `
        <a id="meBuscarOpcion-${i}" role="option" aria-selected="false" tabindex="-1"
           href="${esc(rutaDesdeRaiz(h.html))}">
          <i class="bi ${esc(h.icono)}" aria-hidden="true"></i>
          <span><b>${esc(h.nombre)}</b><small>${esc(h.resumen || "")}</small></span>
        </a>`).join("") : `<p role="status">Sin herramientas para “${esc(texto)}”</p>`;
      lista.hidden = false;
      campo.setAttribute("aria-expanded", "true");
    }

    boton.addEventListener("click", () => {
      if (contenedor.classList.contains("abierto")) {
        contenedor.classList.remove("abierto");
        boton.setAttribute("aria-expanded", "false");
        cerrar();
      } else enfocar();
    });
    campo.addEventListener("input", actualizar);
    campo.addEventListener("focus", actualizar);
    campo.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cerrar();
        contenedor.classList.remove("abierto");
        boton.setAttribute("aria-expanded", "false");
      } else if (CFG.app !== "inicio" && ["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        if (lista.hidden) actualizar();
        seleccionar(activo < 0 ? (e.key === "ArrowDown" ? 0 : -1)
          : activo + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter" && !lista.hidden) {
        const enlace = lista.querySelectorAll('[role="option"]')[activo < 0 ? 0 : activo];
        if (enlace) { e.preventDefault(); enlace.click(); }
      }
    });
    document.addEventListener("click", e => {
      if (!contenedor.contains(e.target)) cerrar();
    });
    document.addEventListener("keydown", e => {
      const editando = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
      if ((e.key === "/" && !editando && !e.ctrlKey && !e.metaKey && !e.altKey)
          || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        enfocar();
      }
    });
  }

  function montarShell() {
    document.body.classList.add("me-body");

    // Todo lo que ya existía en el <body> pasa al área de contenido,
    // menos los modales (Bootstrap los prefiere colgando del body).
    const previos = Array.from(document.body.childNodes).filter(n =>
      !(n.nodeType === 1 && (n.tagName === "SCRIPT" || n.classList.contains("modal"))));

    const app = document.createElement("div");
    app.className = "me-app";
    app.innerHTML = `
      <a class="me-saltar" href="#meContent">Saltar al contenido</a>
      <aside class="me-side${leer("me.side") === "mini" ? " mini" : ""}" id="meSide">
        <div class="me-side-brand">
          <div class="me-side-logo">MÉ</div>
          <div class="me-side-titulo"><b>${esc(CFG.marca)}</b><small>${esc(CFG.submarca)}</small></div>
        </div>
        <nav class="me-side-nav">${navHTML()}</nav>
        <div class="me-side-pie">
          <button class="me-side-toggle" id="meSideToggle" type="button"
                  title="Contraer o expandir el menú" aria-label="Contraer o expandir el menú">
            <i class="bi bi-chevron-double-left"></i>
          </button>
          <span class="me-side-version">v${esc(CFG.version)}</span>
        </div>
      </aside>
      <div class="me-backdrop" id="meBackdrop"></div>
      <div class="me-main">
        <header class="me-top">
          <button class="me-hamburger" id="meHamburger" type="button" aria-label="Mostrar el menú">
            <i class="bi bi-list"></i>
          </button>
          <div class="me-top-titulo">
            <b>${esc(CFG.titulo)}</b>
            <span class="me-top-separador" aria-hidden="true">|</span>
            <small title="${esc(CFG.descripcion)}">${esc(CFG.descripcion)}</small>
          </div>
          <div class="me-buscador" id="meBuscador">
            <button class="me-buscador-toggle" id="meBuscarToggle" type="button"
                    aria-label="Buscar herramienta" aria-controls="meBuscarCampo" aria-expanded="false">
              <i class="bi bi-search" aria-hidden="true"></i>
            </button>
            <div class="me-buscador-campo" id="meBuscarCampo">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input id="meBuscar" type="search" aria-label="Buscar herramienta"
                     placeholder="Buscar herramienta…" autocomplete="off"
                     ${CFG.app !== "inicio" ? 'role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="meBuscarResultados" aria-expanded="false"' : ""}>
            </div>
            <div id="meBuscarResultados" class="me-buscador-resultados" role="listbox"
                 aria-label="Herramientas encontradas" hidden></div>
          </div>
          <div class="me-top-derecha">
            ${todasLasSesiones().map(chipHTML).join("")}
          </div>
        </header>
        <div class="me-content" id="meContent" tabindex="-1"></div>
        <footer class="me-foot">
          <div class="me-foot-izq">
          <b>${esc(CFG.titulo)}</b>
          <span>·</span><span>v${esc(CFG.version)}</span>
          ${CFG.doc ? `<span>·</span>
          <button type="button" class="me-foot-doc" id="meVerDoc"
                  title="Abrir la documentación de esta herramienta">
            <i class="bi bi-book"></i> Documentación
          </button>` : ""}
          </div>
          <div class="me-foot-centro" id="meProgreso" hidden>
            <div data-me-progreso-barra hidden>
              <div class="progress"><div class="progress-bar" role="progressbar" aria-label="Progreso de la consulta"
                aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div></div>
              <span data-me-progreso-texto aria-live="polite"></span>
            </div>
            <span id="meSello"></span>
            <button type="button" class="btn btn-sm btn-me-line" data-me-reintentar hidden></button>
          </div>
          <div class="me-foot-der">
            <span id="meAbierto">—</span>
            <span id="meUptime">00:00:00</span>
          </div>
        </footer>
      </div>`;
    document.body.appendChild(app);

    const cont = $("#meContent");
    previos.forEach(n => cont.appendChild(n));
    if (leer("me.pasos") === "mini") $$(".me-trabajo", cont).forEach(el => el.classList.add("pasos-mini"));
    // Dos frames: el estado recordado ya se pintó antes de habilitar transiciones.
    requestAnimationFrame(() => requestAnimationFrame(() => app.classList.add("me-transiciones")));
    accesibilidadContenido(cont);

    // Scroll del menú de herramientas: se recuerda entre archivos para que al
    // abrir otra herramienta el menú siga donde estaba (cada herramienta es
    // una página nueva y el navegador lo devolvería arriba).
    const nav = $(".me-side-nav", app);
    if (nav) {
      const previo = Number(leer("me.navScroll"));
      if (previo > 0) nav.scrollTop = previo;
      else {
        const activo = $(".me-nav-item.activo", nav);
        if (activo && activo.offsetTop > nav.clientHeight) activo.scrollIntoView({ block: "center" });
      }
      let tScroll = null;
      nav.addEventListener("scroll", () => {
        clearTimeout(tScroll);
        tScroll = setTimeout(() => guardar("me.navScroll", String(Math.round(nav.scrollTop))), 120);
      }, { passive: true });
      // Al hacer clic en una herramienta se guarda en el acto (la página se va).
      nav.addEventListener("click", e => {
        if (e.target.closest("a")) guardar("me.navScroll", String(Math.round(nav.scrollTop)));
      });
    }

    // Menú lateral: contraído/expandido, recordado entre archivos
    const side = $("#meSide");
    pintarFlechaLateral();
    $("#meSideToggle").addEventListener("click", () => {
      if (global.innerWidth < 992) { cerrarLateralMovil(); return; }
      side.classList.toggle("mini");
      guardar("me.side", side.classList.contains("mini") ? "mini" : "full");
      pintarFlechaLateral();
      setTimeout(api.ajustarTablas, 220);
    });
    $("#meHamburger").addEventListener("click", () => {
      side.classList.add("abierta");
      $("#meBackdrop").classList.add("visible");
    });
    $("#meBackdrop").addEventListener("click", cerrarLateralMovil);

    // Chips de sesión → menú de inicio/cierre
    $$("[data-me-sesion]").forEach(b =>
      b.addEventListener("click", e => menuSesion(b, b.dataset.meSesion, e)));

    // Pie → documentación de la propia herramienta
    const btnDoc = $("#meVerDoc");
    if (btnDoc) btnDoc.addEventListener("click", () => abrirDoc());
  }

  /* Aviso de versión nueva: modal simple con el número actual y el nuevo.
     Solo lo dispara leerArranque (la URL que arma dame click.bat), así que
     aparece al abrir la herramienta y no al cambiar de una a otra. */
  let avisoVersion = null;
  function mostrarAvisoVersion() {
    if (!avisoVersion) return;
    const v = avisoVersion;
    avisoVersion = null;
    const abrir = () => {
      if (!global.bootstrap || !global.bootstrap.Modal) {
        api.log(`Hay una versión nueva: ${v.actual || "?"} → ${v.nueva}. Corre «actualizar.bat» para instalarla.`, "warn");
        return;
      }
      const m = document.createElement("div");
      m.className = "modal fade";
      m.id = "meModalVersion";
      m.tabIndex = -1;
      m.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Nueva versión ${esc(v.nueva)}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div class="modal-body">
              <p class="mb-2 fs-5">Actual <b class="me-mono">${esc(v.actual || "?")}</b> → Nueva <b class="me-mono">${esc(v.nueva)}</b></p>
              <p class="mb-0 small text-muted">Para instalarla, cierra las herramientas y ejecuta <b>actualizar.bat</b>.</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-sm btn-me" data-bs-dismiss="modal">Entendido</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.addEventListener("hidden.bs.modal", () => m.remove());
      global.bootstrap.Modal.getOrCreateInstance(m).show();
      api.log(`Hay una versión nueva: ${v.actual || "?"} → ${v.nueva}.`, "warn");
    };
    // Bootstrap puede cargarse después de me-ui.js: se espera a la página.
    if (document.readyState === "complete") abrir();
    else global.addEventListener("load", abrir, { once: true });
  }

  /* =====================================================================
     2.b · DOCUMENTACIÓN DE LA HERRAMIENTA (pie -> modal XL)
     El README de cada página sale del catálogo (campo `doc`).
     El modal se arma una sola vez y el renderizador de Markdown se carga
     solo cuando de verdad se abre.
  ===================================================================== */
  function montarModalDoc() {
    if ($("#meModalDoc")) return;
    const m = document.createElement("div");
    m.className = "modal fade";
    m.id = "meModalDoc";
    m.tabIndex = -1;
    m.innerHTML = `
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="meModalDocTitulo">Documentación</h5>
            <div class="ms-auto d-flex gap-2 align-items-center">
              <a class="btn btn-sm btn-me-line" id="meModalDocBajar" download>
                <i class="bi bi-download"></i> Descargar
              </a>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"
                      aria-label="Cerrar"></button>
            </div>
          </div>
          <div class="modal-body markdown" id="meModalDocCuerpo"></div>
        </div>
      </div>`;
    document.body.appendChild(m);
  }

  function cargarMarked() {
    if (global.marked) return Promise.resolve(global.marked);
    if (cargarMarked._p) return cargarMarked._p;
    cargarMarked._p = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = global.ME_DEPENDENCIAS.urls("marked").js[0];   // versión: assets/base/dependencias.js
      s.onload = () => res(global.marked);
      s.onerror = () => rej(new Error("no se pudo cargar el renderizador de Markdown"));
      document.head.appendChild(s);
    });
    return cargarMarked._p;
  }

  /* Esc con modales anidados (p. ej. el formulario de una operación abierto
     encima del detalle de la línea): Bootstrap no los soporta -el foco
     rebota entre las dos trampas de foco y el Esc terminaba cerrando el de
     ATRÁS, el que tenía la información-. Se intercepta en fase de captura,
     antes de que Bootstrap lo vea, y se cierra solo el de más arriba (el
     último de los .modal.show en el DOM, que es el que se pinta encima).
     Con un solo modal abierto no interviene: ahí Bootstrap lo hace bien. */
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !global.bootstrap) return;
    const abiertos = $$(".modal.show");
    if (abiertos.length < 2) return;
    e.stopPropagation();
    e.preventDefault();
    const tope = abiertos[abiertos.length - 1];
    const inst = global.bootstrap.Modal.getInstance(tope);
    if (inst) inst.hide();
  }, true);

  async function abrirDoc(ruta, titulo) {
    ruta = ruta || CFG.doc;
    if (!ruta) { toast("Esta herramienta no tiene documentación registrada.", "warn"); return; }
    montarModalDoc();
    $("#meModalDocTitulo").textContent = titulo || ("Documentación · " + CFG.titulo);
    const bajar = $("#meModalDocBajar");
    bajar.href = ruta;
    bajar.setAttribute("download", ruta.split("/").pop() || "README.md");
    const cuerpo = $("#meModalDocCuerpo");
    cuerpo.innerHTML = `<p class="me-hint">Cargando ${esc(ruta)}…</p>`;
    global.bootstrap.Modal.getOrCreateInstance("#meModalDoc").show();
    try {
      const r = await fetch(ruta);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const md = await r.text();
      try {
        const mk = await cargarMarked();
        cuerpo.innerHTML = mk.parse(md);
      } catch (e) {
        // Sin marked se muestra el Markdown tal cual: se lee igual.
        cuerpo.innerHTML = `<pre class="me-mono" style="white-space:pre-wrap">${esc(md)}</pre>`;
      }
    } catch (e) {
      cuerpo.innerHTML = `<div class="alert alert-warning mb-0">
        No se pudo abrir <code>${esc(ruta)}</code>: ${esc(e.message)}.
        ${location.protocol === "file:"
          ? "Con <code>file://</code> el navegador bloquea la lectura de archivos vecinos: ábrela desde <b>dame click.bat</b>."
          : ""}
      </div>`;
    }
  }

  function cerrarLateralMovil() {
    $("#meSide").classList.remove("abierta");
    $("#meBackdrop").classList.remove("visible");
  }

  function pintarFlechaLateral() {
    const mini = $("#meSide").classList.contains("mini");
    $("#meSideToggle").innerHTML = `<i class="bi bi-chevron-double-${mini ? "right" : "left"}"></i>`;
    $("#meSideToggle").title = mini ? "Expandir el menú" : "Contraer el menú";
  }

  /* ---------- pintado del semáforo de sesión ---------- */
  // Última "foto" (estado + usuario) de cada sesión: pintarSesiones() corre
  // cada segundo, y me:sesion-cambio solo debe salir cuando algo cambió de
  // verdad (entrar, vencer, salir, otro usuario), no en cada tic del reloj.
  const fotoSesion = {};

  function pintarSesiones() {
    todasLasSesiones().forEach(clave => {
      const chip = $(`[data-me-sesion="${clave}"]`);
      if (!chip) return;
      const st = sesion.estado(clave);
      chip.dataset.estado = st.estado;
      const foto = st.estado + "|" + st.usuario;
      if (fotoSesion[clave] !== undefined && fotoSesion[clave] !== foto) {
        document.dispatchEvent(new CustomEvent("me:sesion-cambio", { detail: { clave, estado: st.estado, usuario: st.usuario } }));
      }
      fotoSesion[clave] = foto;
      const quien = st.usuario ? st.usuario : (NOMBRE_SESION[clave] || clave);
      $(".me-sesion-quien", chip).textContent = quien;
      const reloj = $(".me-sesion-reloj", chip);
      reloj.textContent = st.restan !== null
        ? (st.restan > 0 ? " · " + st.restan + "s" : " · expirada")
        : (st.estado === "ok" ? " · activa" : st.estado === "err" ? " · expirada" : " · sin sesión");
      chip.title = `${NOMBRE_SESION[clave] || clave}${esOpcional(clave) ? " (opcional)" : ""} — ` + ({
        ok: "sesión activa", warn: "por expirar", err: "sesión expirada", off: "sin sesión"
      })[st.estado] + " · clic para iniciar o cerrar sesión";

      // Aviso de renovación: se pide con margen (≥10 s antes de vencer)
      if (st.estado !== "off" && st.restan !== null && st.restan <= CFG.umbralRenovar && st.restan > 0
        && !sesion._avisado[clave]) {
        sesion._avisado[clave] = true;
        document.dispatchEvent(new CustomEvent("me:sesion-renovar", { detail: { clave, restan: st.restan } }));
      }
    });
  }

  function menuSesion(btn, clave, ev) {
    ev.stopPropagation();
    $$(".me-menu-sesion").forEach(m => m.remove());
    const st = sesion.estado(clave);
    const c = cred.get(clave) || {};
    const guardadas = clave === "sime"
      ? (c.prf ? "token del lanzador" : "ninguna")
      : (c.usuario ? c.usuario : "ninguna");

    const m = document.createElement("div");
    m.className = "me-menu-sesion";
    m.innerHTML = `
      <h6>Sesión ${esc(NOMBRE_SESION[clave] || clave)}</h6>
      <div class="dato"><span>Estado</span><b>${({ ok: "activa", warn: "por expirar", err: "expirada", off: "sin sesión" })[st.estado]}</b></div>
      <div class="dato"><span>Usuario</span><b>${esc(st.usuario || "—")}</b></div>
      <div class="dato"><span>Vence en</span><b>${st.restan !== null ? st.restan + " s" : "—"}</b></div>
      <div class="dato"><span>Credenciales</span><b>${esc(guardadas)}</b></div>
      <div class="acciones">
        <button class="btn btn-sm btn-me" data-acc="login">Iniciar sesión</button>
        <button class="btn btn-sm btn-me-line" data-acc="logout">Cerrar</button>
      </div>
      <div class="me-hint mt-2">«Cerrar» solo termina la sesión de estas páginas; las
      credenciales del lanzador siguen guardadas. Usa «Olvidar» para borrarlas también.</div>
      <div class="acciones"><button class="btn btn-sm btn-me-line" data-acc="olvidar">Olvidar credenciales</button></div>`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + 6) + "px";
    m.style.left = Math.max(8, Math.min(r.left, global.innerWidth - m.offsetWidth - 10)) + "px";

    m.addEventListener("click", e => {
      const acc = e.target.closest("[data-acc]");
      if (!acc) return;
      m.remove();
      if (acc.dataset.acc === "login") {
        document.dispatchEvent(new CustomEvent("me:sesion-iniciar", { detail: { clave } }));
      } else if (acc.dataset.acc === "logout") {
        sesion.cerrar(clave, false);
        api.log("Sesión " + (NOMBRE_SESION[clave] || clave) + " cerrada por el usuario.", "warn");
      } else {
        sesion.cerrar(clave, true);
        api.log("Credenciales de " + (NOMBRE_SESION[clave] || clave) + " borradas de este navegador.", "warn");
      }
    });
    setTimeout(() => document.addEventListener("click", function fuera() {
      m.remove(); document.removeEventListener("click", fuera);
    }), 0);
  }

  /* ---------- pie: apertura y tiempo abierto ---------- */
  function iniciarPie() {
    let abierto = leer("me.abierto");
    const t = abierto ? new Date(abierto) : null;
    // Si no hay marca (o es de otro día de trabajo), se usa este momento.
    const inicio = (t && !isNaN(t) && (Date.now() - t.getTime()) < 14 * 3600e3) ? t : hoy();
    if (!abierto || inicio !== t) guardar("me.abierto", inicio.toISOString());
    $("#meAbierto").textContent = "Abierto: " + inicio.toLocaleString("es-CO", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
    const tic = () => {
      const s = Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 1000));
      $("#meUptime").textContent = `${dosCifras(Math.floor(s / 3600))}:${dosCifras(Math.floor(s / 60) % 60)}:${dosCifras(s % 60)}`;
    };
    tic();
    setInterval(tic, 1000);
  }

  /* =====================================================================
     3 · REGISTRO (log transaccional)
  ===================================================================== */
  function cajasLog() { return $$("[data-me-log]"); }

  function escribirLog(html) {
    cajasLog().forEach(caja => {
      caja.classList.add("me-log");
      const l = document.createElement("div");
      l.innerHTML = html;
      caja.appendChild(l);
      while (caja.childElementCount > 3000) caja.removeChild(caja.firstChild);
      caja.scrollTop = caja.scrollHeight;
    });
  }

  /* =====================================================================
     4 · PASOS PLEGABLES
     <section data-me-paso="1" data-me-titulo="Conexión"
              data-me-abierto="sin-sesion">  ...contenido... </section>
     data-me-abierto: siempre | nunca | sin-sesion | con-sesion
  ===================================================================== */
  function montarPasos() {
    $$("[data-me-paso]").forEach(el => {
      if (el.dataset.meMontado) return;
      el.dataset.meMontado = "1";
      const n = el.dataset.mePaso;
      const titulo = el.dataset.meTitulo || "";
      const cuerpo = document.createElement("div");
      cuerpo.className = "me-paso-cuerpo";
      while (el.firstChild) cuerpo.appendChild(el.firstChild);
      el.classList.add("me-paso");
      el.innerHTML = `
        <button class="me-paso-cab" type="button">
          <span class="me-paso-n">${esc(n)}</span>
          <span class="me-paso-tit">${esc(titulo)}</span>
          <span class="me-paso-resumen" data-me-resumen></span>
          <span class="me-paso-flecha"><i class="bi bi-chevron-down"></i></span>
        </button>`;
      el.appendChild(cuerpo);
      $(".me-paso-cab", el).addEventListener("click", () => {
        el.classList.toggle("abierto");
        setTimeout(api.ajustarTablas, 200);
      });
    });
    aplicarAperturaPasos();
  }

  /* =====================================================================
     4.b · COLUMNA DE PASOS CONTRAÍBLE EN X
     El lateral de navegación ya se contrae con su propio botón; esto hace
     lo mismo con la columna de pasos, para dejarle todo el ancho a la
     tabla. Contraída queda un riel con solo el número de cada paso: al
     hacer clic en uno, la columna se expande y abre ese paso.
  ===================================================================== */
  function montarTogglePasos() {
    const trabajo = $(".me-trabajo");
    const lateral = $(".me-trabajo-lateral", trabajo || document);
    if (!trabajo || !lateral || $("#mePasosToggle")) return;
    trabajo.classList.toggle("pasos-mini", leer("me.pasos") === "mini");

    // Los pasos pasan a un contenedor propio con scroll; el botón queda
    // arriba, fuera de él (no se desplaza ni tapa ningún paso).
    let pasos = $(".me-trabajo-pasos", lateral);
    if (!pasos) {
      pasos = document.createElement("div");
      pasos.className = "me-trabajo-pasos";
      while (lateral.firstChild) pasos.appendChild(lateral.firstChild);
      lateral.appendChild(pasos);
    }

    const b = document.createElement("button");
    b.type = "button";
    b.id = "mePasosToggle";
    b.className = "me-pasos-toggle";
    lateral.insertBefore(b, pasos);

    const pintar = () => {
      const mini = trabajo.classList.contains("pasos-mini");
      b.innerHTML = `<span>${mini ? "" : "Contraer"}</span>`
        + `<i class="bi bi-chevron-double-${mini ? "right" : "left"}"></i>`;
      b.title = mini ? "Expandir la columna de pasos" : "Contraer la columna de pasos";
      b.setAttribute("aria-expanded", mini ? "false" : "true");
      // Con el riel contraído el nombre del paso solo vive en el tooltip.
      $$("[data-me-paso]").forEach(el => {
        const cab = $(".me-paso-cab", el);
        if (cab) cab.title = mini ? (el.dataset.meTitulo || "") : "";
      });
    };

    const aplicar = (mini, sinGuardar) => {
      trabajo.classList.toggle("pasos-mini", mini);
      if (!sinGuardar) guardar("me.pasos", mini ? "mini" : "full");
      pintar();
      // DataTables mide anchos: hay que recalcular al cambiar el ancho útil.
      setTimeout(api.ajustarTablas, 220);
    };
    contraerPasos = () => { if (!trabajo.classList.contains("pasos-mini")) aplicar(true, true); };

    b.addEventListener("click", () => aplicar(!trabajo.classList.contains("pasos-mini")));

    // Clic en un paso mientras está contraída -> expande y abre ese paso.
    lateral.addEventListener("click", e => {
      if (!trabajo.classList.contains("pasos-mini")) return;
      const paso = e.target.closest("[data-me-paso]");
      if (!paso) return;
      e.stopPropagation();
      aplicar(false);
      paso.dataset.meTocado = "1";
      paso.classList.add("abierto");
    }, true);

    aplicar(leer("me.pasos") === "mini");
  }

  /** ¿Se puede trabajar? Solo lo deciden las sesiones NECESARIAS. Una
      opcional sin iniciar no bloquea nada: quien la necesite la inicia desde
      su chip cuando le toque. */
  function haySesionValida() {
    return (CFG.sesiones || []).every(c => {
      const e = sesion.estado(c).estado;
      return e === "ok" || e === "warn";
    });
  }

  function aplicarAperturaPasos() {
    const conSesion = haySesionValida();
    $$("[data-me-paso]").forEach(el => {
      const regla = el.dataset.meAbierto || "nunca";
      if (el.dataset.meTocado === "1") return;   // el usuario ya decidió
      let abrir = regla === "siempre";
      if (regla === "sin-sesion") abrir = !conSesion;
      if (regla === "con-sesion") abrir = conSesion;
      el.classList.toggle("abierto", abrir);
    });
  }

  /* =====================================================================
     5 · TABLAS
  ===================================================================== */
  const IDIOMA_DT = {
    search: "Buscar:", searchPlaceholder: "Buscar en la tabla…",
    lengthMenu: "Mostrar _MENU_ líneas",
    info: "Mostrando _START_–_END_ de _TOTAL_ líneas",
    infoEmpty: "Sin líneas", infoFiltered: "(filtrado de _MAX_)",
    zeroRecords: "Sin coincidencias", emptyTable: "Sin resultados",
    loadingRecords: "Cargando…", processing: "Procesando…",
    paginate: { first: "«", last: "»", next: "›", previous: "‹" }
  };

  const tablas = [];

  function opcionesTabla(extra) {
    return Object.assign({
      scrollX: true,
      scrollY: "40vh",          // alto inicial; ajustarTabla aplica flex o alto móvil
      scrollCollapse: false,
      deferRender: true,
      autoWidth: false,
      paging: true,
      pageLength: 10,
      lengthMenu: [5, 10, 15, 25, 50, 100, 250],
      searching: true,
      ordering: true,
      layout: {
        topStart: "pageLength",
        topEnd: "search",
        bottomStart: "info",
        bottomEnd: "paging"
      },
      language: IDIOMA_DT
    }, extra || {});
  }

  /** Crea la DataTable con los defaults del sistema y la deja auto-ajustada. */
  function tabla(selector, extra) {
    const dt = new global.DataTable(selector, opcionesTabla(extra));
    registrarTabla(dt);
    return dt;
  }

  function registrarTabla(dt) {
    if (tablas.indexOf(dt) < 0) {
      tablas.push(dt);
      dt.on("draw", programarAjusteTablas);
    }
    vigilarDatos(dt);
    setTimeout(() => ajustarTabla(dt), 30);
  }

  /* Al llegar resultados (la tabla pasa de vacía a tener filas) se contraen
     el menú y la columna de pasos para dejarle el ancho a los datos. No se
     guarda: la próxima vez la herramienta abre completa para escribir, y si
     el analista los vuelve a abrir no se cierran otra vez con cada filtro.
     Las tablas dentro de un modal (detalle de una línea) no cuentan. */
  function vigilarDatos(dt) {
    let nodo;
    try { nodo = dt.table().node(); } catch (e) { return; }
    if (!nodo || nodo.dataset.meVigila || nodo.closest(".modal")) return;
    nodo.dataset.meVigila = "1";
    let antes = 0;
    const ver = () => {
      let n = 0;
      try { n = dt.rows().count(); } catch (e) { return; }
      if (antes === 0 && n > 0) enfocarDatos();
      antes = n;
    };
    dt.on("draw", ver);
    ver();
  }

  let contraerPasos = null;   // lo define montarTogglePasos
  function enfocarDatos() {
    const side = $("#meSide");
    if (side && global.innerWidth >= 992 && !side.classList.contains("mini")) {
      side.classList.add("mini");
      pintarFlechaLateral();
    }
    if (contraerPasos) contraerPasos();
    setTimeout(ajustarTablas, 230);
  }

  // Tablas de detalle con etiquetas variables (CM/HLR): criterio único.
  const esIdentificacion = nombre => /^(?!estado|tipo|otras)(?:.*\b(?:msisdn|imsi|iccid|subscription.?id|subscriber.?id|documento|c[eé]dula|identificaci[oó]n|ban|cuenta|l[ií]nea|caso|ticket)\b)/i.test(String(nombre || ""));

  /** Valor con botón de copiar (usa el .btn-copy común). */
  function copiable(valor, nombre) {
    const v = String(valor ?? "").trim();
    if (!v) return "—";
    return `<span class="me-copiable"><button type="button" class="btn-copy" data-copy-text="${esc(v)}" title="Copiar ${esc(nombre || "dato")}" aria-label="Copiar ${esc(nombre || "dato")}">⧉</button><span class="me-mono">${esc(v)}</span></span>`;
  }

  /* 5.1 · Archivo: el input original conserva sus eventos y su accept.
     La misma zona sirve para archivos únicos y múltiples, también al
     montar pestañas dinámicamente. Nunca enganchar dos veces el input. */
  const zonasArchivo = new WeakMap();
  function zonaArchivo(contenedor, opciones) {
    const raiz = elemento(contenedor), o = opciones || {};
    if (!raiz) return null;
    const input = raiz.matches('input[type="file"]') ? raiz : $('input[type="file"]', raiz);
    if (!input) return null;
    if (zonasArchivo.has(input)) {
      const control = zonasArchivo.get(input);
      Object.assign(control.opciones, o);
      if (o.texto) { $("p", control.el).textContent = o.texto; control.el.setAttribute("aria-label", o.texto); }
      if (o.accept) input.accept = o.accept;
      return control;
    }
    let zona = input.closest("[data-me-dropzone], .dropzone");
    if (!zona) {
      zona = document.createElement("div");
      input.before(zona);
      zona.appendChild(input);
    }
    zona.classList.add("dropzone");
    zona.setAttribute("data-me-dropzone", "");
    zona.setAttribute("role", "button");
    zona.tabIndex = 0;
    const texto = o.texto || ($("p", zona) && $("p", zona).textContent.trim().replace(/\s+/g, " "))
      || zona.getAttribute("aria-label") || "Arrastra un archivo o haz clic para elegirlo";
    zona.setAttribute("aria-label", texto);
    // El marcado anterior se reemplaza para que iconos y texto vivan aquí.
    Array.from(zona.childNodes).forEach(n => { if (n !== input) n.remove(); });
    const mensaje = document.createElement("p");
    mensaje.textContent = texto;
    const nombre = document.createElement("small");
    nombre.className = "me-archivo-nombre";
    nombre.setAttribute("aria-live", "polite");
    zona.prepend(mensaje);
    zona.appendChild(nombre);
    input.hidden = true;
    if (o.accept) input.accept = o.accept;
    const control = { el: zona, opciones: o, limpiar() { input.value = ""; nombre.textContent = ""; } };
    zonasArchivo.set(input, control);
    function elegir(archivos, soltado) {
      const seleccion = Array.from(archivos || []).slice(0, input.multiple ? undefined : 1);
      if (!seleccion.length) return;
      nombre.textContent = seleccion.map(f => f.name).join(", ");
      if (typeof control.opciones.alElegir === "function") {
        control.opciones.alElegir(seleccion[0], seleccion);
      } else if (soltado) {
        // FileList procede del navegador; conserva los handlers de negocio.
        input.files = archivos;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    zona.addEventListener("click", e => { if (e.target !== input) input.click(); });
    zona.addEventListener("keydown", e => {
      if (e.target === zona && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", () => elegir(input.files, false), true);
    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault(); zona.classList.add("drag");
    }));
    zona.addEventListener("dragleave", e => {
      if (!zona.contains(e.relatedTarget)) zona.classList.remove("drag");
    });
    zona.addEventListener("drop", e => {
      e.preventDefault(); zona.classList.remove("drag");
      elegir(e.dataTransfer && e.dataTransfer.files, true);
    });
    return control;
  }

  function montarZonasArchivo() {
    $$('input[type="file"]').forEach(input => zonaArchivo(input));
  }

  /* En el área de trabajo de escritorio el alto lo reparte el flex.
     Fuera de ella se conserva el cálculo para paneles independientes;
     en pantallas chicas se deja un alto fijo cómodo. */
  function ajustarTabla(dt) {
    let nodo;
    try { nodo = dt.table().node(); } catch (e) { return; }
    const cont = nodo.closest(".dt-container");
    if (!cont) return;
    const panel = cont.closest(".me-tabla-panel") || cont.parentElement;
    const cuerpo = $(".dt-scroll-body", cont);
    if (!cuerpo || !panel) return;

    // Si la tabla está oculta, medir da cero y la cabecera queda sin ancho.
    // Mejor no tocar nada: ya se reajustará cuando vuelva a verse.
    if (!cont.offsetWidth || !panel.offsetWidth) return;

    const grande = global.innerWidth >= 1200;
    const altoPorFlex = grande && panel.closest(".me-trabajo-datos")
      && panel.dataset.meAlto !== "fijo";
    if (altoPorFlex) {
      // El panel recibe el espacio restante por CSS. No imponer mínimos:
      // una barra nueva debe quitarle alto a las filas, no al shell.
      panel.style.height = "";
      try { dt.columns.adjust(); } catch (e) { }
      cuerpo.style.height = "0px";
      cuerpo.style.maxHeight = "none";
      return;
    }
    const foot = document.querySelector(".me-foot");
    const altoFoot = foot ? foot.offsetHeight : 30;

    if (grande && panel.dataset.meAlto !== "fijo") {
      const top = panel.getBoundingClientRect().top;
      const alto = Math.max(280, global.innerHeight - top - altoFoot - 14);
      panel.style.height = alto + "px";
    } else if (panel.dataset.meAlto !== "fijo") {
      panel.style.height = "";
    }

    const filas = $$(":scope > .dt-layout-row", cont);
    let usado = 0;
    filas.forEach(f => { if (!f.classList.contains("dt-layout-table")) usado += f.offsetHeight; });
    const head = $(".dt-scroll-head", cont);
    if (head) usado += head.offsetHeight;

    const disponible = grande && panel.dataset.meAlto !== "fijo"
      ? panel.clientHeight - usado - 12
      : Math.round(global.innerHeight * 0.42);

    const px = Math.max(160, disponible) + "px";
    cuerpo.style.height = px;
    cuerpo.style.maxHeight = px;
    try { dt.columns.adjust(); } catch (e) { }
  }

  function ajustarTablas() { tablas.forEach(ajustarTabla); }

  /* Se llama JUSTO ANTES de crear o redibujar una DataTable.
     DataTables mide los anchos al dibujarse: si en ese momento la tabla
     está oculta, todas las columnas miden cero y la cabecera no se ve.
     Por eso se descubre primero y se decide después si hay datos. */
  function prepararTabla(selector) {
    const t = typeof selector === "string" ? $(selector) : selector;
    if (!t) return;
    t.style.display = "";
    const caja = t.closest(".dt-container");
    if (caja) caja.style.display = "";
  }

  /* Muestra u oculta la tabla según tenga o no filas.
     Regla: se oculta solo cuando NO hay datos cargados. Si hay datos y un
     filtro deja cero coincidencias, la tabla sigue a la vista con su
     mensaje: si se ocultara, se llevaría también el buscador y no habría
     forma de deshacer el filtro.

     MEUI.mostrarSiHayDatos("#tablaLineas", { vacio:"#msgVacio", tabla: dt })  */
  function mostrarSiHayDatos(selector, opciones) {
    const t = typeof selector === "string" ? $(selector) : selector;
    if (!t) return 0;
    const o = Object.assign({ vacio: null, tabla: null }, opciones || {});

    // Filas reales: se descarta la fila de relleno que pone DataTables
    // cuando no hay resultados ("Sin coincidencias").
    const cuerpo = t.querySelector("tbody");
    const filasDom = cuerpo ? Array.from(cuerpo.rows).filter(tr => {
      const c = tr.cells[0];
      return !(c && (c.classList.contains("dt-empty") || c.classList.contains("dataTables_empty")));
    }).length : 0;

    let total = filasDom;
    if (o.tabla) { try { total = o.tabla.rows().count(); } catch (e) { } }
    const hay = total > 0;

    // La tabla nunca debe quedar con display:none teniendo datos: se limpia
    // el estilo en línea con el que viene el marcado.
    t.style.display = hay ? "" : "none";
    const caja = t.closest(".dt-container");
    if (caja) caja.style.display = hay ? "" : "none";

    const vacio = o.vacio ? (typeof o.vacio === "string" ? $(o.vacio) : o.vacio) : null;
    if (vacio) vacio.style.display = hay ? "none" : "";

    // Los anchos se calculan mal si la tabla estaba oculta al dibujarse:
    // al mostrarla hay que rehacerlos. Dos pasadas porque la primera ocurre
    // antes de que el navegador termine de aplicar el layout.
    if (hay) {
      const rehacer = () => {
        if (o.tabla) { try { o.tabla.columns.adjust(); } catch (e) { } }
        ajustarTablas();
      };
      setTimeout(rehacer, 0);
      setTimeout(rehacer, 180);
    }
    return total;
  }

  let tAjuste = null;
  function programarAjusteTablas() {
    clearTimeout(tAjuste);
    tAjuste = setTimeout(ajustarTablas, 120);
  }
  global.addEventListener("resize", programarAjusteTablas);
  document.addEventListener("shown.bs.tab", programarAjusteTablas);
  document.addEventListener("shown.bs.collapse", () => setTimeout(ajustarTablas, 180));
  document.addEventListener("hidden.bs.collapse", () => setTimeout(ajustarTablas, 180));

  /* Barras, avisos y paneles pueden cambiar sin redimensionar la ventana.
     Observar el layout común también cubre HLR/HSS al montar otra pestaña.
     No observar el interior de DataTables: ajustar sus columnas no debe
     volver a provocar el mismo ajuste indefinidamente. */
  function vigilarLayoutTablas() {
    const contenido = $("#meContent");
    if (!contenido) return;
    const observados = new Set();
    const observador = global.ResizeObserver
      ? new global.ResizeObserver(programarAjusteTablas) : null;
    const observar = () => {
      if (!observador) return;
      // HLR/HSS reemplaza paneles completos: liberar los ya desmontados.
      observados.forEach(el => {
        if (el.isConnected) return;
        observador.unobserve(el);
        observados.delete(el);
      });
      const elementos = [contenido, $(".me-foot"),
        ...$$(".me-trabajo-datos, .me-barras, .me-trabajo-datos > *, .me-tabla-panel > :not(.dt-container), .me-trabajo-datos > .tab-content > .tab-pane > *", contenido)];
      elementos.forEach(el => {
        if (!el || observados.has(el) || el.closest(".modal, .dt-container")) return;
        observados.add(el);
        observador.observe(el);
      });
    };
    observar();
    new MutationObserver(cambios => {
      const externos = cambios.filter(c => !c.target.closest(".dt-container, .modal"));
      if (!externos.length) return;
      if (externos.some(c => c.type === "childList")) observar();
      programarAjusteTablas();
    }).observe(contenido, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["hidden", "class"]
    });
  }

  /* =====================================================================
     6 · ENTRADA DE DATOS
  ===================================================================== */
  /* Separadores aceptados al pegar líneas a mano o al leer una columna:
     espacio, tabulación, salto de línea, coma, punto y coma y barra vertical,
     con o sin espacios alrededor. También quita +57, guiones y paréntesis. */
  const SEPARADORES = /[\s\t\r\n,;|]+/;

  function parseLineas(texto, opciones) {
    const o = Object.assign({ min: 7, max: 12, quitarIndicativo: true }, opciones || {});
    const vistos = new Set(), fuera = [];
    String(texto || "").split(SEPARADORES).forEach(bruto => {
      let v = String(bruto).trim();
      if (!v) return;
      v = v.replace(/[\s\-.()]/g, "");
      if (o.quitarIndicativo) v = v.replace(/^\+?57(?=3\d{9}$)/, "");
      if (new RegExp(`^\\d{${o.min},${o.max}}$`).test(v)) vistos.add(v);
      else fuera.push(bruto.trim());
    });
    return { lineas: [...vistos], descartadas: fuera };
  }

  /* --- Excel / CSV con SheetJS --- */
  function leerLibro(file) {
    return new Promise((res, rej) => {
      if (typeof global.XLSX === "undefined") { rej(new Error("Falta la librería XLSX (SheetJS).")); return; }
      const fr = new FileReader();
      fr.onerror = () => rej(new Error("No se pudo leer el archivo."));
      fr.onload = e => {
        try {
          const wb = global.XLSX.read(e.target.result, { type: "array", cellDates: true });
          res({ wb, hojas: wb.SheetNames, nombre: file.name, tam: file.size });
        } catch (err) { rej(err); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  const filasDeHoja = (wb, hoja) =>
    global.XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: "", raw: false });

  const normalizar = s => String(s).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // Nombres con los que llega la columna de la línea (se comparan ya
  // normalizados: minúsculas, sin tildes). "Línea", "CELULAR", "Telefono"…
  const ALIAS_LINEA = ["linea", "lineas", "msisdn", "numero", "numero de linea", "celular",
    "movil", "telefono", "numero celular", "numero de telefono", "telefono celular",
    "linea celular", "abonado", "numero movil"];
  // Solo por coincidencia EXACTA: son tan cortos que por inclusión matarían
  // a "terminal" (min), "nombre" (no) o "numero de documento" (num).
  const ALIAS_LINEA_EXACTO = ["min", "nro", "num", "no", "tel", "cel"];

  function detectarColumna(columnas, alias) {
    const lista = alias || ALIAS_LINEA;
    const norm = columnas.map(normalizar);
    for (const a of lista) { const i = norm.indexOf(a); if (i >= 0) return columnas[i]; }
    if (!alias) for (const a of ALIAS_LINEA_EXACTO) { const i = norm.indexOf(a); if (i >= 0) return columnas[i]; }
    for (const a of lista) { const i = norm.findIndex(h => h.includes(a)); if (i >= 0) return columnas[i]; }
    return null;
  }

  /* =====================================================================
     7 · SALIDA DE DATOS
     El separador por defecto es «;» (Excel en español), pero queda a mano
     en cualquier control con data-me-sep.
  ===================================================================== */
  function separador() { return leer("me.sep") || ";"; }

  function montarSelectoresSeparador() {
    $$("[data-me-sep]").forEach(sel => {
      if (sel.dataset.meMontado) return;
      sel.dataset.meMontado = "1";
      if (sel.tagName === "SELECT" && !sel.options.length) {
        sel.innerHTML = `<option value=";">CSV separado por ;</option>
                         <option value=",">CSV separado por ,</option>
                         <option value="\t">CSV separado por tabulación</option>`;
      }
      sel.value = separador();
      sel.addEventListener("change", () => {
        guardar("me.sep", sel.value);
        $$("[data-me-sep]").forEach(o => { o.value = sel.value; });
        api.log("Separador de exportación: «" + (sel.value === "\t" ? "tab" : sel.value) + "».");
      });
    });
  }

  function descargar(blob, nombre) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  const sello = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  function exportarCSV(cabecera, filas, base) {
    const sep = separador();
    const celda = v => {
      let s = (v === null || v === undefined) ? "" : String(v);
      if (typeof v === "number" && sep === ";") s = s.replace(".", ",");
      return (s.includes(sep) || /["\n\r]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [cabecera, ...filas].map(f => f.map(celda).join(sep)).join("\r\n");
    descargar(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), `${base}_${sello()}.csv`);
    api.log(`CSV exportado: ${filas.length} filas (separador «${sep === "\t" ? "tab" : sep}»).`, "ok");
  }

  /** opciones.numFmt = { 3: "#,##0.0000" } aplica formato a esa columna. */
  function exportarXLSX(cabecera, filas, base, hoja, opciones) {
    if (typeof global.XLSX === "undefined") { api.toast("Falta la librería XLSX.", "err"); return; }
    const o = opciones || {};
    const ws = global.XLSX.utils.aoa_to_sheet([cabecera, ...filas]);
    ws["!autofilter"] = { ref: ws["!ref"] };
    ws["!cols"] = cabecera.map(h => ({ wch: Math.min(42, Math.max(12, String(h).length + 4)) }));

    // Montos y cantidades: se marcan como número para que Excel los sume
    // y se les pone el formato de la herramienta.
    if (o.numFmt) {
      Object.entries(o.numFmt).forEach(([col, formato]) => {
        for (let r = 1; r <= filas.length; r++) {
          const celda = ws[global.XLSX.utils.encode_cell({ r, c: Number(col) })];
          if (celda && celda.v !== "" && celda.v !== null) { celda.t = "n"; celda.z = formato; }
        }
      });
    }
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, ws, (hoja || "Datos").slice(0, 31));
    global.XLSX.writeFile(wb, `${base}_${sello()}.xlsx`);
    api.log(`Excel exportado: ${filas.length} filas.`, "ok");
  }

  function exportarJSON(datos, base) {
    descargar(new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" }),
      `${base}_${sello()}.json`);
    api.log("JSON exportado.", "ok");
  }

  /* =====================================================================
     8 · RETROALIMENTACIÓN
  ===================================================================== */
  function ocupado(btn, texto) {
    const b = typeof btn === "string" ? $(btn) : btn;
    if (!b || b.dataset.meOcupado) return;
    b.dataset.meOcupado = "1";
    b.dataset.meTexto = b.innerHTML;
    b.disabled = true;
    b.innerHTML = `<span class="me-spin"></span>${esc(texto || "Trabajando…")}`;
  }

  function libre(btn, textoFinal) {
    const b = typeof btn === "string" ? $(btn) : btn;
    if (!b || !b.dataset.meOcupado) return;
    b.innerHTML = textoFinal || b.dataset.meTexto || b.innerHTML;
    b.disabled = false;
    delete b.dataset.meOcupado;
    delete b.dataset.meTexto;
  }

  /** Envuelve una promesa: spinner en el botón mientras corre. */
  async function conSpinner(btn, texto, fn) {
    ocupado(btn, texto);
    try { return await fn(); }
    finally { libre(btn); }
  }

  /* Para botones cuya lógica ya existe y no se quiere tocar: pone el spinner
     al hacer clic y lo quita cuando el propio código vuelve a habilitarlos. */
  function autoSpinner(selector, texto) {
    const b = typeof selector === "string" ? $(selector) : selector;
    if (!b || b.dataset.meAuto) return;
    b.dataset.meAuto = "1";
    b.addEventListener("click", () => {
      if (b.dataset.meOcupado) return;
      ocupado(b, texto || "Cargando datos…");
      // El código de la herramienta hace btn.disabled = false al terminar.
      const obs = new MutationObserver(() => {
        if (!b.disabled && b.dataset.meOcupado) { libre(b); obs.disconnect(); }
      });
      obs.observe(b, { attributes: true, attributeFilter: ["disabled"] });
      // Red de seguridad: si nadie lo libera, se libera solo.
      setTimeout(() => { if (b.dataset.meOcupado) { libre(b); obs.disconnect(); } }, 15 * 60000);
    }, true);
  }

  /** Enter en un input dispara un botón, con retroalimentación visible. */
  function enterEjecuta(input, boton) {
    const i = typeof input === "string" ? $(input) : input;
    const b = typeof boton === "string" ? $(boton) : boton;
    if (!i || !b) return;
    i.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      i.classList.add("border-dark");
      setTimeout(() => i.classList.remove("border-dark"), 350);
      b.click();
    });
  }

  function toast(msg, nivel, ms) {
    let zona = $(".me-toasts");
    if (!zona) { zona = document.createElement("div"); zona.className = "me-toasts"; document.body.appendChild(zona); }
    const t = document.createElement("div");
    t.className = "me-toast " + (nivel || "");
    t.innerHTML = esc(msg);
    zona.appendChild(t);
    setTimeout(() => t.remove(), ms || 4200);
  }

  /** Copia al portapapeles, con respaldo para contexto HTTP interno
      (páginas file:// o intranets sin HTTPS, donde navigator.clipboard falla). */
  /** Copia al portapapeles. Resuelve si pudo y RECHAZA si no.
      El camino bueno es la API de portapapeles, pero `file://` cuenta como
      contexto seguro y aun así el navegador puede denegar el permiso: antes,
      ese rechazo salía sin más y el respaldo no se llegaba a intentar. Ahora
      se intenta igual, que es justo donde se abren estas herramientas. */
  function copiarTexto(txt) {
    const aLaVieja = () => new Promise((res, rej) => {
      const ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      ok ? res() : rej(new Error("El navegador no permitió copiar."));
    });
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(txt).catch(aLaVieja);
    }
    return aLaVieja();
  }

  /* Botón "copiar" reutilizable en cualquier herramienta: basta con
         <button class="btn-copy" data-copy-target="idDelElemento">⧉</button>
     (copia el texto de #idDelElemento) o data-copy-text="texto literal"
     cuando no hay un elemento del que tomarlo. Delegado en document: no hace
     falta cablear el clic modal por modal ni tabla por tabla. Se escucha en
     fase de CAPTURA y se corta la propagación: un botón de copiar dentro de
     una fila no debe disparar el clic de la fila (que abre el detalle). */
  document.addEventListener("click", e => {
    const btn = e.target.closest(".btn-copy");
    if (!btn) return;
    e.stopPropagation();
    let txt = btn.dataset.copyText;
    if (txt === undefined) {
      const destino = btn.dataset.copyTarget && document.getElementById(btn.dataset.copyTarget);
      txt = destino ? destino.textContent.trim() : "";
    }
    if (!txt || txt === "—") return;
    copiarTexto(txt).then(() => {
      const prev = btn.innerHTML;
      btn.classList.add("copiado"); btn.innerHTML = "✓";
      setTimeout(() => { btn.classList.remove("copiado"); btn.innerHTML = prev; }, 1200);
    }).catch(() => toast("No se pudo copiar al portapapeles.", "err"));
  }, true);

  /* =====================================================================
     8.1 · Cargas JSON / XML legibles (petición y respuesta de los sistemas)
     ---------------------------------------------------------------------
     `formatearPayload(texto)` → { tipo: "json" | "xml" | "texto", texto }
     `htmlPayload({ tipo, texto })` → HTML ya escapado, con la sintaxis pintada

     Reglas que no se negocian:
       · Funciones PURAS: no tocan el DOM ni guardan estado.
       · Nunca lanzan ni pierden contenido: si lo recibido no es JSON ni XML
         bien formado, `texto` vuelve IDÉNTICO al original y `tipo` es "texto".
       · El JSON NO se re-serializa con JSON.stringify(JSON.parse(x)): eso
         altera enteros de más de 15 dígitos, `1.0`, `1e3`, el orden de las
         claves numéricas y las claves repetidas. Aquí se valida con
         JSON.parse y la sangría se hace sobre el texto original, dejando
         intactos cadenas y números tal como llegaron.
       · El HTML sale de trocear el texto CRUDO y escapar cada trozo con `esc`
         (también el que va entre etiquetas <span>). Nunca se aplica una
         expresión regular sobre texto ya escapado y jamás se concatena texto
         del servidor sin pasar por `esc`: el contenido viene de sistemas
         externos y lleva <, > y & de verdad.
     ===================================================================== */
  const SANGRIA = "  ";

  /** Sangra un JSON YA VALIDADO sin tocar cadenas ni números. */
  function sangrarJSON(t) {
    const out = []; let nivel = 0, i = 0;
    const n = t.length;
    const salto = () => "\n" + SANGRIA.repeat(nivel);
    const blanco = c => c === " " || c === "\n" || c === "\r" || c === "\t";
    while (i < n) {
      const c = t[i];
      if (c === '"') {
        let j = i + 1;
        while (j < n && t[j] !== '"') j += t[j] === "\\" ? 2 : 1;
        out.push(t.slice(i, j + 1)); i = j + 1;
      } else if (c === "{" || c === "[") {
        let j = i + 1;
        while (j < n && blanco(t[j])) j++;
        if (t[j] === (c === "{" ? "}" : "]")) { out.push(c + t[j]); i = j + 1; }   // vacío: {} / []
        else { nivel++; out.push(c + salto()); i++; }
      } else if (c === "}" || c === "]") {
        nivel--; out.push(salto() + c); i++;
      } else if (c === ",") { out.push("," + salto()); i++; }
      else if (c === ":") { out.push(": "); i++; }
      else if (blanco(c)) i++;
      else {                                   // número, true, false, null
        let j = i;
        while (j < n && !blanco(t[j]) && ",:{}[]\"".indexOf(t[j]) < 0) j++;
        out.push(t.slice(i, j)); i = j;
      }
    }
    return out.join("");
  }

  /** Trocea XML en {k, s}: txt | com | cdata | pi | decl | open | close | self.
      Devuelve null si algo no cuadra (etiqueta sin cerrar, `<` suelto…). */
  function tokensXML(t) {
    const toks = []; const n = t.length; let i = 0;
    const hasta = (marca, desde, largo) => { const f = t.indexOf(marca, desde); return f < 0 ? -1 : f + largo; };
    while (i < n) {
      if (t[i] !== "<") {
        let j = t.indexOf("<", i); if (j < 0) j = n;
        toks.push({ k: "txt", s: t.slice(i, j) }); i = j; continue;
      }
      let fin, k;
      if (t.startsWith("<!--", i)) { k = "com"; fin = hasta("-->", i + 4, 3); }
      else if (t.startsWith("<![CDATA[", i)) { k = "cdata"; fin = hasta("]]>", i + 9, 3); }
      else if (t.startsWith("<?", i)) { k = "pi"; fin = hasta("?>", i + 2, 2); }
      else if (t.startsWith("<!", i)) {
        k = "decl";                              // <!DOCTYPE …> (con o sin subconjunto interno [ … ])
        const c = t.indexOf("[", i), g = t.indexOf(">", i);
        fin = (c >= 0 && g >= 0 && c < g) ? hasta("]>", c, 2) : (g < 0 ? -1 : g + 1);
      } else {
        let j = i + 1, q = null;
        for (; j < n; j++) {                     // `>` dentro de un atributo entrecomillado no cierra
          const ch = t[j];
          if (q) { if (ch === q) q = null; }
          else if (ch === '"' || ch === "'") q = ch;
          else if (ch === ">") break;
          else if (ch === "<") return null;
        }
        if (j >= n) return null;
        const s = t.slice(i, j + 1);
        if (!/^<\/?[A-Za-z_:][^\s\/>]*/.test(s)) return null;      // «a < b», «<3»…: no es una etiqueta
        k = s[1] === "/" ? "close" : (s[s.length - 2] === "/" ? "self" : "open");
        fin = j + 1;
      }
      if (fin < 0) return null;
      toks.push({ k, s: t.slice(i, fin) }); i = fin;
    }
    return toks;
  }
  const nombreEtiqueta = s => /^<\/?([^\s\/>]+)/.exec(s)[1];

  /** Sangra XML bien formado. Quita solo el espacio que separa etiquetas y
      recorta los bordes del texto; el texto, comentarios, CDATA y atributos
      se conservan tal cual. null si no está bien formado. */
  function sangrarXML(t) {
    const toks = tokensXML(t);
    if (!toks) return null;
    const pila = [], lineas = [];
    let hayEtiqueta = false;
    const pon = s => lineas.push(SANGRIA.repeat(pila.length) + s);
    for (let x = 0; x < toks.length; x++) {
      const { k, s } = toks[x];
      if (k === "txt") { const r = s.trim(); if (r) pon(r); continue; }
      if (k === "open") {
        hayEtiqueta = true;
        /* Hoja (solo texto/CDATA/nada dentro): va en una línea, <a>valor</a>. */
        const a = toks[x + 1], b = toks[x + 2];
        if (a && a.k === "close" && nombreEtiqueta(a.s) === nombreEtiqueta(s)) { pon(s + a.s); x += 1; continue; }
        if (a && b && (a.k === "txt" || a.k === "cdata") && b.k === "close" && nombreEtiqueta(b.s) === nombreEtiqueta(s)) {
          pon(s + (a.k === "txt" ? a.s.trim() : a.s) + b.s); x += 2; continue;
        }
        pon(s); pila.push(nombreEtiqueta(s)); continue;
      }
      if (k === "close") {
        if (!pila.length || pila.pop() !== nombreEtiqueta(s)) return null;
        pon(s); continue;
      }
      if (k === "self") hayEtiqueta = true;
      pon(s);
    }
    if (pila.length || !hayEtiqueta) return null;
    return lineas.join("\n");
  }

  function formatearPayload(texto) {
    const original = texto === null || texto === undefined ? "" : String(texto);
    const crudo = { tipo: "texto", texto: original };
    const t = original.trim();
    if (!t) return crudo;
    try {
      if (t[0] === "{" || t[0] === "[") {
        JSON.parse(t);                           // solo valida; lanza si está roto o truncado
        return { tipo: "json", texto: sangrarJSON(t) };
      }
      if (t[0] === "<") {
        const x = sangrarXML(t);
        if (x !== null) return { tipo: "xml", texto: x };
      }
    } catch (e) { /* no era lo que parecía: se muestra tal cual */ }
    return crudo;
  }

  /** Recorre `t` con la expresión global `re`: lo que casa va por `pinta`
      (que decide la clase) y lo que queda en medio se escapa sin pintar. */
  function pintarCon(t, re, pinta) {
    let out = "", ultimo = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(t)) !== null) {
      out += esc(t.slice(ultimo, m.index)) + pinta(m);
      ultimo = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + esc(t.slice(ultimo));
  }
  const span = (clase, txt) => `<span class="me-sx-${clase}">${esc(txt)}</span>`;

  const RE_JSON = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const RE_ATTR = /([^\s=\/>]+)(\s*=\s*)("[^"]*"|'[^']*')/g;

  function pintarEtiqueta(s) {
    const m = /^(<\/?)([^\s\/>]+)([\s\S]*?)(\/?>)$/.exec(s);
    if (!m) return esc(s);
    return esc(m[1]) + span("tag", m[2])
      + pintarCon(m[3], RE_ATTR, a => span("attr", a[1]) + esc(a[2]) + span("cadena", a[3]))
      + esc(m[4]);
  }

  function htmlPayload(r) {
    const tipo = r && r.tipo, t = r && r.texto !== undefined && r.texto !== null ? String(r.texto) : "";
    if (tipo === "json") {
      return pintarCon(t, RE_JSON, m =>
        m[1] !== undefined ? (m[2] ? span("clave", m[1]) + esc(m[2]) : span("cadena", m[1]))
          : span(/^[tfn]/.test(m[0]) ? "lit" : "num", m[0]));
    }
    if (tipo === "xml") {
      const toks = tokensXML(t);
      if (!toks) return esc(t);
      return toks.map(({ k, s }) =>
        k === "txt" ? esc(s)
          : k === "com" ? span("com", s)
            : k === "cdata" ? span("cadena", s)
              : k === "pi" || k === "decl" ? span("attr", s)
                : pintarEtiqueta(s)).join("");
    }
    return esc(t);
  }

  /* =====================================================================
     8.2 · Controles compartidos de consulta y escritura
  ===================================================================== */
  const elemento = el => typeof el === "string" ? $(el) : el;

  /** Muestra la barra de lote y actualiza «N marcadas» (o el texto indicado). */
  function lote(selectorBarra, n, texto) {
    const el = elemento(selectorBarra);
    if (!el) return;
    el.hidden = !(n > 0);
    const cuenta = $("[data-me-lote-n]", el);
    if (cuenta) cuenta.textContent = n + " " + (texto === undefined ? "marcadas" : texto);
  }

  const filtrosMulti = new Set();
  /** Crea un desplegable múltiple; set/limpiar también notifican alCambiar. */
  function filtroMulti(contenedor, opciones) {
    const raiz = elemento(contenedor), o = opciones || {};
    const valores = o.valores || [];
    let seleccionados = new Set(o.seleccion || []);
    const el = document.createElement("div");
    el.className = "dropdown me-filtro-multi";
    el.innerHTML = `<button type="button" class="btn btn-sm btn-me-line dropdown-toggle"
      data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false"></button>
      <ul class="dropdown-menu p-2">
        <li class="d-flex gap-2 mb-2"><button type="button" class="btn btn-sm btn-me-line" data-todos>Todos</button>
        <button type="button" class="btn btn-sm btn-me-line" data-ninguno>Ninguno</button></li>
        ${valores.map((v, i) => `<li><label class="d-flex align-items-center gap-2">
          <input type="checkbox" data-indice="${i}"><span>${esc(v.texto === undefined ? v.valor : v.texto)}</span>
          ${v.n === undefined ? "" : `<small class="ms-auto">${esc(v.n)}</small>`}</label></li>`).join("")}
      </ul>`;
    raiz.appendChild(el);
    const boton = $("button", el);
    function pintar(notificar) {
      seleccionados = new Set(valores.filter(v => seleccionados.has(v.valor)).map(v => v.valor));
      boton.textContent = (o.titulo || "Filtro") + (seleccionados.size ? " (" + seleccionados.size + ")" : "");
      boton.classList.toggle("activo", seleccionados.size > 0);
      $$("input", el).forEach(c => { c.checked = seleccionados.has(valores[Number(c.dataset.indice)].valor); });
      if (notificar && typeof o.alCambiar === "function") o.alCambiar(new Set(seleccionados));
    }
    const control = {
      set(v) { seleccionados = new Set(v || []); pintar(true); },
      limpiar() { control.set([]); },
      seleccion() { return new Set(seleccionados); },
      /** Quita el desplegable (p. ej. para rehacerlo con valores nuevos). */
      destruir() { el.remove(); filtrosMulti.delete(control); },
      el
    };
    el.addEventListener("change", e => {
      if (!e.target.matches("input[data-indice]")) return;
      const valor = valores[Number(e.target.dataset.indice)].valor;
      if (e.target.checked) seleccionados.add(valor); else seleccionados.delete(valor);
      pintar(true);
    });
    $("[data-todos]", el).onclick = () => control.set(valores.map(v => v.valor));
    $("[data-ninguno]", el).onclick = () => control.limpiar();
    pintar(false);
    filtrosMulti.add(control);
    return control;
  }

  /** Limpia todos los desplegables creados por filtroMulti. */
  function limpiarFiltros() { filtrosMulti.forEach(f => f.limpiar()); }

  let totalProgreso = 0, hechosProgreso = 0, etiquetaProgreso = "", ocultarProgreso;
  function pintarProgreso(texto) {
    const el = $("#meProgreso");
    if (!el) return;
    el.hidden = false;
    $("[data-me-progreso-barra]", el).hidden = false;
    const barra = $(".progress-bar", el);
    const porcentaje = totalProgreso > 0 ? Math.min(100, Math.max(0, hechosProgreso / totalProgreso * 100)) : 0;
    barra.style.width = porcentaje + "%";
    barra.setAttribute("aria-valuenow", String(porcentaje));
    $("[data-me-progreso-texto]", el).textContent = texto;
  }

  /** Progreso de consultas: iniciar/avanzar o paso; fin conserva el sello. */
  const progreso = {
    iniciar(total, etiqueta) {
      clearTimeout(ocultarProgreso);
      totalProgreso = Math.max(0, Number(total) || 0); hechosProgreso = 0;
      etiquetaProgreso = etiqueta || "";
      const el = $("#meProgreso");
      if (el) {
        $(".progress-bar", el).style.backgroundColor = "";
        const btn = $("[data-me-reintentar]", el);
        btn.hidden = true; btn.onclick = null;
        $("#meSello", el).textContent = "";
      }
      progreso.avanzar(0);
    },
    avanzar(hechos, etiqueta) {
      hechosProgreso = Math.max(0, Number(hechos) || 0);
      if (etiqueta !== undefined) etiquetaProgreso = etiqueta;
      pintarProgreso(hechosProgreso + "/" + totalProgreso + (etiquetaProgreso ? " · " + etiquetaProgreso : ""));
    },
    paso(i, n, nombre) {
      totalProgreso = Math.max(0, Number(n) || 0); hechosProgreso = Math.max(0, Number(i) || 0);
      etiquetaProgreso = nombre || "";
      pintarProgreso("Paso " + hechosProgreso + "/" + totalProgreso + (etiquetaProgreso ? " · " + etiquetaProgreso : ""));
    },
    fin(opciones) {
      const o = opciones || {}, ok = o.ok === undefined ? !(o.fallidas > 0) : o.ok;
      clearTimeout(ocultarProgreso);
      const el = $("#meProgreso");
      if (!el) return;
      if (ok) hechosProgreso = totalProgreso;
      pintarProgreso(o.mensaje || (ok ? "Consulta completada" : "Consulta con errores"));
      const barra = $(".progress-bar", el);
      barra.style.backgroundColor = ok ? "var(--me-ok)" : "var(--me-err)";
      progreso.sello();
      const btn = $("[data-me-reintentar]", el);
      btn.hidden = !(o.fallidas > 0 && typeof o.reintentar === "function");
      btn.textContent = "Reintentar fallidas (" + (o.fallidas || 0) + ")";
      btn.onclick = btn.hidden ? null : () => o.reintentar();
      if (ok) ocultarProgreso = setTimeout(() => { $("[data-me-progreso-barra]", el).hidden = true; }, 6000);
    },
    sello(fecha) {
      const el = $("#meProgreso");
      if (!el) return;
      el.hidden = false;
      $("#meSello", el).textContent = "Consultado a las " + new Date(fecha === undefined ? Date.now() : fecha)
        .toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
  };

  const estadosTabla = new WeakMap();
  /** Pinta cargando/vacio/error junto a la tabla; listo retira el aviso. */
  function estadoTabla(selectorTabla, estado, opciones) {
    const tabla = elemento(selectorTabla), o = opciones || {};
    if (!tabla) return;
    let el = estadosTabla.get(tabla);
    const tieneFilas = () => !!$("tbody tr", tabla) && $$("tbody tr", tabla).some(tr =>
      tr.cells.length && !tr.querySelector(".dt-empty, .dataTables_empty"));
    if (estado === "vacio" && tieneFilas()) estado = "listo";
    if (estado === "listo") { if (el) el.remove(); estadosTabla.delete(tabla); return; }
    if (!["cargando", "vacio", "error"].includes(estado)) return;
    if (!el) { el = document.createElement("div"); estadosTabla.set(tabla, el); }
    el.dataset.meEstado = estado;
    if (!tabla.dataset.meVigilaEstado) {
      tabla.dataset.meVigilaEstado = "1";
      new MutationObserver(() => {
        const aviso = estadosTabla.get(tabla);
        if (aviso && aviso.dataset.meEstado === "vacio" && tieneFilas()) estadoTabla(tabla, "listo");
      }).observe(tabla, { childList: true, subtree: true });
    }
    el.className = "me-estado-tabla" + (estado === "error" ? " alert alert-danger" : "");
    el.setAttribute("role", estado === "error" ? "alert" : "status");
    el.innerHTML = (estado === "cargando" ? '<span class="me-spin" aria-hidden="true"></span>' :
      '<i class="bi ' + (estado === "error" ? "bi-exclamation-triangle" : "bi-inbox") + '" aria-hidden="true"></i>')
      + "<span>" + esc(o.mensaje || (estado === "cargando" ? "Consultando…" : estado === "vacio" ? "Sin resultados" : "No se pudo consultar")) + "</span>";
    if (estado === "error" && typeof o.reintentar === "function") {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn btn-sm btn-me-line"; btn.textContent = "Reintentar";
      btn.onclick = () => o.reintentar(); el.appendChild(btn);
    }
    const destino = tabla.closest(".dt-container") || tabla;
    destino.before(el);
  }

  let modalEscritura, resolverEscritura, aceptadaEscritura = false;
  /** Confirma una escritura; cerrar por cualquier vía equivale a Cancelar. */
  function confirmarEscritura(opciones) {
    const o = opciones || {};
    if (!global.bootstrap || !global.bootstrap.Modal || resolverEscritura) return Promise.resolve(false);
    if (!modalEscritura) {
      modalEscritura = document.createElement("div");
      modalEscritura.className = "modal fade me-confirmar-escritura";
      modalEscritura.tabIndex = -1;
      modalEscritura.setAttribute("aria-labelledby", "meEscrituraTitulo");
      modalEscritura.innerHTML = `<div class="modal-dialog modal-lg"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title" id="meEscrituraTitulo"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
        <div class="modal-body"></div><div class="modal-footer">
        <button type="button" class="btn btn-me-line" data-bs-dismiss="modal" data-cancelar>Cancelar</button>
        <button type="button" class="btn btn-me-peligro" data-confirmar></button></div></div></div>`;
      document.body.appendChild(modalEscritura);
      // Puede abrirse encima del detalle de una línea: Bootstrap no apila
      // modales, así que este y su fondo suben por encima del que ya está.
      modalEscritura.addEventListener("show.bs.modal", () => {
        modalEscritura.style.zIndex = "1070";
        setTimeout(() => {
          const fondos = $$(".modal-backdrop");
          if (fondos.length > 1) fondos[fondos.length - 1].style.zIndex = "1065";
        }, 0);
      });
      modalEscritura.addEventListener("shown.bs.modal", () => $("[data-cancelar]", modalEscritura).focus());
      // Al cerrarse, el detalle de abajo sigue abierto: body conserva modal-open.
      modalEscritura.addEventListener("hidden.bs.modal", () => {
        if ($(".modal.show")) document.body.classList.add("modal-open");
      });
      modalEscritura.addEventListener("hidden.bs.modal", () => {
        const resolver = resolverEscritura; resolverEscritura = null;
        if (resolver) resolver(aceptadaEscritura);
      });
      $("[data-confirmar]", modalEscritura).onclick = () => {
        aceptadaEscritura = true;
        global.bootstrap.Modal.getOrCreateInstance(modalEscritura).hide();
      };
    }
    aceptadaEscritura = false;
    $("#meEscrituraTitulo", modalEscritura).innerHTML = '<i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>' + esc(o.titulo || "Confirmar escritura");
    const items = o.items || [];
    $(".modal-body", modalEscritura).innerHTML = `<table class="table table-sm"><tbody>
      ${(o.resumen || []).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
      ${items.length ? "<ul>" + items.slice(0, 50).map(v => "<li>" + esc(v) + "</li>").join("") +
        (items.length > 50 ? "<li>… y " + (items.length - 50) + " más</li>" : "") + "</ul>" : ""}
      ${o.aviso ? '<p class="mb-0">' + esc(o.aviso) + "</p>" : ""}`;
    $("[data-confirmar]", modalEscritura).textContent = o.accion || "Confirmar";
    return new Promise(resolve => {
      resolverEscritura = resolve;
      global.bootstrap.Modal.getOrCreateInstance(modalEscritura).show();
    });
  }

  /** Devuelve un botón de ayuda; texto y título siempre se muestran como texto. */
  function ayuda(texto, titulo) {
    return `<button type="button" class="me-ayuda" data-me-ayuda="${esc(texto)}"${titulo ? ' data-me-ayuda-titulo="' + esc(titulo) + '"' : ""} aria-label="Ayuda">?</button>`;
  }

  let ayudaAbierta = null, popoverAyuda = null, pulsacionAyuda = null;
  function cerrarAyuda() {
    if (popoverAyuda) popoverAyuda.dispose();
    ayudaAbierta = null; popoverAyuda = null;
  }
  function abrirAyuda(el) {
    if (el === ayudaAbierta || !global.bootstrap || !global.bootstrap.Popover) return;
    cerrarAyuda();
    popoverAyuda = new global.bootstrap.Popover(el, {
      trigger: "manual", html: false, container: "body",
      content: el.dataset.meAyuda, title: el.dataset.meAyudaTitulo || ""
    });
    ayudaAbierta = el; popoverAyuda.show();
  }
  // mouseenter/leave no burbujean: se delegan con over/out y relatedTarget.
  document.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-me-ayuda]");
    if (el && !el.contains(e.relatedTarget)) abrirAyuda(el);
  });
  document.addEventListener("mouseout", e => {
    if (ayudaAbierta && ayudaAbierta.contains(e.target) && !ayudaAbierta.contains(e.relatedTarget)) cerrarAyuda();
  });
  document.addEventListener("focusin", e => {
    const el = e.target.closest("[data-me-ayuda]");
    if (el) abrirAyuda(el);
  });
  document.addEventListener("focusout", e => {
    if (ayudaAbierta && ayudaAbierta.contains(e.target)) cerrarAyuda();
  });
  // En táctil el foco llega antes del click: se conserva el estado al pulsar.
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest("[data-me-ayuda]");
    pulsacionAyuda = el ? { el, abierta: ayudaAbierta === el } : null;
  });
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-me-ayuda]");
    if (el) {
      const cerrar = pulsacionAyuda && pulsacionAyuda.el === el ? pulsacionAyuda.abierta : ayudaAbierta === el;
      if (cerrar) cerrarAyuda(); else abrirAyuda(el);
    }
    else if (!e.target.closest(".popover")) cerrarAyuda();
    pulsacionAyuda = null;
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarAyuda(); });
  document.addEventListener("show.bs.modal", e => {
    const dialogo = $(".modal-dialog.modal-xl", e.target);
    if (dialogo) dialogo.classList.add("me-modal-detalle");
  });

  /** KPI y filas con clic explícito: el teclado activa el mismo click. */
  function accesibilidadContenido(cont) {
    const selector = '.kpi-click, [data-fdim], tr[onclick], tr[role="button"]';
    const preparar = () => $$(selector, cont).forEach(el => {
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    });
    preparar();
    let pendiente;
    new MutationObserver(() => {
      clearTimeout(pendiente); pendiente = setTimeout(preparar, 60);
    }).observe(cont, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-fdim", "onclick"] });
    cont.addEventListener("keydown", e => {
      const el = e.target.closest(selector);
      if (!el || e.target !== el || el.matches("button, a, input, select, textarea")) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) el.click(); }
    });
  }

  /* =====================================================================
     9 · API pública
  ===================================================================== */
  const api = {
    cfg: CFG,
    sesion, cred,
    $, $$, esc,

    log(msg, nivel) {
      const hora = new Date().toLocaleTimeString("es-CO", { hour12: false });
      escribirLog(`<span class="l-hora">${hora}</span> <span class="l-${nivel || "info"}">${esc(msg)}</span>`);
    },

    /** Reimprime el encabezado de instrucciones en el registro. */
    instrucciones(lineas) {
      const txt = lineas || CFG.instrucciones;
      if (!txt || !txt.length) return;
      escribirLog(`<span class="l-guia"><b>${esc(CFG.titulo)}</b> · cómo usarla\n`
        + txt.map(l => "  " + esc(l)).join("\n") + "\n</span>");
    },

    limpiarLog() { cajasLog().forEach(c => { c.innerHTML = ""; }); api.instrucciones(); },

    toast, ocupado, libre, conSpinner, autoSpinner, enterEjecuta, abrirDoc, enfocarDatos, copiable, esIdentificacion,
    copiarTexto, formatearPayload, htmlPayload, zonaArchivo,
    lote, filtroMulti, limpiarFiltros, progreso, estadoTabla, confirmarEscritura, ayuda,
    tabla, registrarTabla, ajustarTabla, ajustarTablas, opcionesTabla, idiomaTabla: IDIOMA_DT,
    mostrarSiHayDatos, prepararTabla,
    parseLineas, leerLibro, filasDeHoja, detectarColumna, normalizar,
    separador, exportarCSV, exportarXLSX, exportarJSON, descargar,
    montarPasos, aplicarAperturaPasos, montarTogglePasos,
    almacenBloqueado: () => almacenBloqueado,

    /** ¿Están listas las sesiones NECESARIAS? Las opcionales no cuentan. */
    haySesionValida, sesionOpcional: esOpcional,

    /** Texto gris al lado del título de un paso ("41 líneas · hoja Datos"). */
    resumenPaso(nPaso, texto) {
      const el = $(`[data-me-paso="${nPaso}"]`);
      if (el) $("[data-me-resumen]", el).textContent = texto || "";
    },

    abrirPaso(nPaso, abrir) {
      const el = $(`[data-me-paso="${nPaso}"]`);
      if (!el) return;
      el.dataset.meTocado = "1";
      el.classList.toggle("abierto", abrir !== false);
      setTimeout(ajustarTablas, 200);
    },

    init(opciones) {
      /* Título, descripción, versión y documentación vienen del catálogo,
         por el `app` de la página. Lo que la página pase en `opciones` manda
         sobre el catálogo (por si una página necesita algo propio). */
      const herramienta = CATALOGO.obtener((opciones || {}).app);
      if (!herramienta) {
        console.error("MEUI.init: «" + (opciones || {}).app + "» no está en assets/base/catalogo.js");
      } else {
        Object.assign(CFG, {
          titulo: herramienta.nombre,
          descripcion: herramienta.resumen,
          version: herramienta.version,
          doc: rutaDesdeRaiz(herramienta.doc)
        });
      }
      Object.assign(CFG, opciones || {});
      if (!CFG.descripcion) CFG.descripcion = "";
      document.title = `${CFG.titulo} · v${CFG.version}`;
      leerArranque();
      montarShell();
      montarBuscador();
      montarZonasArchivo();
      iniciarPie();
      montarPasos();
      montarTogglePasos();
      vigilarLayoutTablas();
      montarSelectoresSeparador();
      pintarSesiones();
      setInterval(pintarSesiones, 1000);
      api.instrucciones();

      /* Cualquier error de JavaScript de la página (incluidos los errores
         de sintaxis del bloque de lógica) queda escrito en el registro:
         así no hay que abrir la consola para saber qué pasó. */
      global.addEventListener("error", ev => {
        const archivo = String(ev.filename || "").split("/").pop();
        api.log("Error de JavaScript: " + (ev.message || "desconocido")
          + (archivo ? ` — ${archivo}:${ev.lineno}:${ev.colno}` : ""), "err");
      });
      global.addEventListener("unhandledrejection", ev => {
        const m = ev.reason && ev.reason.message ? ev.reason.message : ev.reason;
        api.log("Promesa sin capturar: " + m, "err");
      });

      // Prueba real de escritura: si Edge bloquea el almacenamiento en
      // file://, se avisa una vez y se sigue con el respaldo en memoria.
      guardar("me.prueba", "1");
      if (almacenBloqueado) {
        api.log("El navegador está bloqueando el almacenamiento local (Prevención de seguimiento). "
          + "La herramienta funciona igual, pero la sesión no se comparte con las otras pestañas.", "warn");
      }
      document.addEventListener("me:sesion-cambio", aplicarAperturaPasos);
      setTimeout(ajustarTablas, 250);
      mostrarAvisoVersion();
      return api;
    }
  };

  global.MEUI = api;
})(window);
