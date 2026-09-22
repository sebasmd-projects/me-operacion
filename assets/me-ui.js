/* =====================================================================
   me-ui.js · Shell común — Herramientas Operación Móvil Éxito
   ---------------------------------------------------------------------
   Se carga DESPUÉS de Bootstrap, DataTables y (si se usa) SheetJS.
   No toca la lógica de negocio de cada herramienta: solo aporta

     · el marco visual (lateral, cabecera, pie) alrededor del contenido
     · una única sesión (SIME y CM) compartida entre los 4 archivos
     · el registro (log) con las instrucciones de uso al abrir
     · defaults de DataTables, altura de tablas y ajuste automático
     · lectura de líneas/archivos y exportación CSV/XLSX/JSON

   Uso mínimo en cada HTML:
       <body class="me-body">
       ...
       <script src="assets/me-ui.js"></script>
       <script> MEUI.init({ app:'prepagadas', version:'9.0', ... }); </script>
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
     Catálogo de herramientas: el mismo menú en las 4 páginas.
     Si un archivo se renombra, se cambia AQUÍ y las 4 páginas lo reflejan.
  ===================================================================== */
  const APPS = [
    {
      grupo: "Inicio", items: [
        { id: "inicio", titulo: "Inicio", icono: "bi-house", url: "../index.html" }
      ]
    },
    {
      grupo: "Consultas", items: [
        { id: "prepagadas", titulo: "Prepagadas SIME ⇄ CM", icono: "bi-arrow-left-right", url: "reporte_prepagadas.html" },
        { id: "consumos", titulo: "Bolsillos, Paquetes, Consumos", icono: "bi-bar-chart", url: "reporte_consumos.html" },
        { id: "tipificacion", titulo: "Exportar casos tipificación", icono: "bi-download", url: "export_tipificacion.html" },
        { id: "ajustes", titulo: "Ajustes y paquetes", icono: "bi-cash-coin", url: "export_ajustes.html" },
      ]
    },
    {
      grupo: "Operaciones", items: [
        { id: "casos", titulo: "Cierre masivo de casos", icono: "bi-check2-square", url: "reporte_casos_masivos.html" },
        { id: "rechazo", titulo: "Generar archivo de rechazo", icono: "bi-file-earmark-pdf", url: "generar_rechazo.html" }
      ]
    },
    {
      grupo: "HLR/HSS", items: [
        { id: "hlr-hss", titulo: "HLR/HSS · Claro y Tigo", icono: "bi-speedometer2", url: "hlr_hss.html" },
        { id: "portabilidad-tigo", titulo: "Validador Portabilidad · Tigo", icono: "bi-arrow-repeat", url: "validador_portabilidad_tigo.html" }
      ]
    },
    {
      grupo: "Utilidades", items: [
        { id: "audio-mp3", titulo: "Convertir audio a MP3", icono: "bi-file-earmark-music", url: "convertir_audio_mp3.html" }
      ]
    }
  ];

  const CFG = {
    app: "", version: "1.0", titulo: document.title || "Herramienta",
    descripcion: "", marca: "Herramientas", submarca: "Operación · Móvil Éxito",
    sesiones: ["sime", "cm"],      // qué chips se muestran en la cabecera
    instrucciones: [],             // líneas que abren el registro
    doc: "",                       // README.md de la herramienta (pie + modal XL)
    apps: APPS,
    umbralRenovar: 15,             // segundos antes de vencer para pedir renovación
    umbralAviso: 60                // segundos en los que el chip se pone naranja
  };

  const NOMBRE_SESION = { cm: "CM", sime: "SIME", qdn: "QDN" };

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

    if (abierto) guardar("me.abierto", abierto);
    if (prf) cred.set("sime", { prf });
    if (u || p) {
      const previo = cred.get("cm") || {};
      cred.set("cm", { usuario: u || previo.usuario || "", clave: p || previo.clave || "" });
    }
    if (prf || u || p || abierto) {
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
     «herramientas»). Las rutas de APPS están escritas desde «herramientas»,
     así que hay que traducirlas cuando quien pinta el menú es la portada;
     si no, todos los enlaces del lateral apuntan a archivos que no existen. */
  function rutaNav(url) {
    if (/\/herramientas\//i.test(location.pathname)) return url;
    return url.startsWith("../") ? url.slice(3) : "herramientas/" + url;
  }

  function navHTML() {
    return CFG.apps.map(g => `
      <div class="me-nav-grupo">${esc(g.grupo)}</div>
      ${g.items.map(it => `
        <a class="me-nav-item ${it.id === CFG.app ? "activo" : ""}" href="${esc(rutaNav(it.url))}" title="${esc(it.titulo)}">
          <i class="bi ${esc(it.icono)}"></i><span>${esc(it.titulo)}</span>
        </a>`).join("")}`).join("");
  }

  function chipHTML(clave) {
    return `<button type="button" class="me-sesion" data-me-sesion="${clave}" data-estado="off"
              title="Sesión ${esc(NOMBRE_SESION[clave] || clave)}">
        <span class="me-dot"></span>
        <span class="me-sesion-txt">
          <span class="me-sesion-quien">${esc(NOMBRE_SESION[clave] || clave)}</span>
          <span class="me-sesion-reloj"></span>
        </span>
      </button>`;
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
      <aside class="me-side" id="meSide">
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
            <small>${esc(CFG.descripcion)}</small>
          </div>
          <div class="me-top-derecha">
            ${CFG.sesiones.map(chipHTML).join("")}
          </div>
        </header>
        <div class="me-content" id="meContent"></div>
        <footer class="me-foot">
          <b>${esc(CFG.titulo)}</b>
          <span>·</span><span>v${esc(CFG.version)}</span>
          ${CFG.doc ? `<span>·</span>
          <button type="button" class="me-foot-doc" id="meVerDoc"
                  title="Abrir la documentación de esta herramienta">
            <i class="bi bi-book"></i> Documentación
          </button>` : ""}
          <div class="me-foot-der">
            <span id="meAbierto">—</span>
            <span id="meUptime">00:00:00</span>
          </div>
        </footer>
      </div>`;
    document.body.appendChild(app);

    const cont = $("#meContent");
    previos.forEach(n => cont.appendChild(n));

    // Menú lateral: contraído/expandido, recordado entre archivos
    const side = $("#meSide");
    if (leer("me.side") === "mini") side.classList.add("mini");
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

  /* =====================================================================
     2.b · DOCUMENTACIÓN DE LA HERRAMIENTA (pie -> modal XL)
     Cada página declara su README con MEUI.init({ doc: "../doc/x/README.md" }).
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
      s.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
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
    CFG.sesiones.forEach(clave => {
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
      chip.title = `${NOMBRE_SESION[clave] || clave} — ` + ({
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

    const b = document.createElement("button");
    b.type = "button";
    b.id = "mePasosToggle";
    b.className = "me-pasos-toggle";
    lateral.insertBefore(b, lateral.firstChild);

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

    const aplicar = mini => {
      trabajo.classList.toggle("pasos-mini", mini);
      guardar("me.pasos", mini ? "mini" : "full");
      pintar();
      // DataTables mide anchos: hay que recalcular al cambiar el ancho útil.
      setTimeout(api.ajustarTablas, 220);
    };

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

  function haySesionValida() {
    return CFG.sesiones.every(c => {
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
    search: "Buscar:", searchPlaceholder: "filtrar…",
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
      scrollY: "40vh",          // lo recalcula ajustarTabla() al píxel
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
    if (tablas.indexOf(dt) < 0) tablas.push(dt);
    setTimeout(() => ajustarTabla(dt), 30);
  }

  /* Ajusta al píxel el alto del cuerpo de la tabla para que el panel entero
     (filtros + controles + filas + paginación) quepa en pantalla sin que la
     página haga scroll. En pantallas chicas se deja un alto fijo cómodo. */
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
    const foot = document.querySelector(".me-foot");
    const altoFoot = foot ? foot.offsetHeight : 30;

    if (grande && panel.dataset.meAlto !== "fijo") {
      const top = panel.getBoundingClientRect().top;
      const alto = Math.max(280, global.innerHeight - top - altoFoot - 14);
      panel.style.height = alto + "px";
    } else {
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
  global.addEventListener("resize", () => {
    clearTimeout(tAjuste);
    tAjuste = setTimeout(ajustarTablas, 120);
  });
  document.addEventListener("shown.bs.collapse", () => setTimeout(ajustarTablas, 180));
  document.addEventListener("hidden.bs.collapse", () => setTimeout(ajustarTablas, 180));

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
  function copiarTexto(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise((res, rej) => {
      const ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); res(); } catch (err) { rej(err); }
      document.body.removeChild(ta);
    });
  }

  /* Botón "copiar" reutilizable en cualquier herramienta: basta con
         <button class="btn-copy" data-copy-target="idDelElemento">⧉</button>
     (copia el texto de #idDelElemento) o data-copy-text="texto literal"
     cuando no hay un elemento del que tomarlo. Delegado en document: no hace
     falta cablear el clic modal por modal ni tabla por tabla. */
  document.addEventListener("click", e => {
    const btn = e.target.closest(".btn-copy");
    if (!btn) return;
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
  });

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

    toast, ocupado, libre, conSpinner, autoSpinner, enterEjecuta, abrirDoc,
    copiarTexto,
    tabla, registrarTabla, ajustarTabla, ajustarTablas, opcionesTabla, idiomaTabla: IDIOMA_DT,
    mostrarSiHayDatos, prepararTabla,
    parseLineas, leerLibro, filasDeHoja, detectarColumna, normalizar,
    separador, exportarCSV, exportarXLSX, exportarJSON, descargar,
    montarPasos, aplicarAperturaPasos, montarTogglePasos,
    almacenBloqueado: () => almacenBloqueado,

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
      Object.assign(CFG, opciones || {});
      if (!CFG.descripcion) CFG.descripcion = "";
      document.title = `${CFG.titulo} · v${CFG.version}`;
      leerArranque();
      montarShell();
      iniciarPie();
      montarPasos();
      montarTogglePasos();
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
      return api;
    }
  };

  global.MEUI = api;
})(window);
