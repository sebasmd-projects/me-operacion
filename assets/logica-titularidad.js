/* =====================================================================
   logica-titularidad.js · Bloqueos de SIM por titularidad
   ---------------------------------------------------------------------
   Para qué existe: las llamadas al call por «me bloquearon la SIM» salen,
   en su mayoría, del proceso de comprobación de titularidad. Genesis deja
   el log de ese proceso (quién, qué línea, cómo terminó), pero no dice en
   qué red está la línea, y sin eso el asesor no puede resolver en la
   llamada. Esta herramienta junta las tres cosas en una tabla:

     1. Genesis   · el bloqueo/desbloqueo y cómo terminó  (se carga al abrir)
     2. CM        · titular, cuenta y estado de la línea   (bajo demanda)
     3. HLR/HSS   · Claro, Tigo, ambos o ninguno           (bajo demanda)

   Los pasos 2 y 3 son BAJO DEMANDA y sobre las filas marcadas, de 1 a n.
   No se lanzan solos: son miles de líneas y cada una cuesta peticiones a
   tres gateways distintos.

   Lo que NO vive aquí:
     · sesión y paginación de Genesis   → genesis-api.js  (GENESIS)
     · consulta Claro + Tigo            → hlr-consulta.js (HLRConsulta)
     · resolver la línea en el CM       → cm-lineas.js    (CMLineas)
     · shell, tablas, exportación       → me-ui.js        (MEUI)
     · enganche con la interfaz         → me-titularidad-puente.js
===================================================================== */

/* =====================================================================
   1 · CONFIGURACIÓN
===================================================================== */
const CONFIG = {
    /* Genesis responde ~150 ms por página; de a 500 son unas 420 páginas
       para 208.000 registros. Se piden de a una (el servidor devuelve la
       cuenta total y no hay forma de saltar sin leer), pero se deja
       configurable por si el gateway concede páginas más grandes. */
    paginaGenesis: 500,

    /* Cada línea dispara 2 peticiones (Claro + Tigo) a la vez. 5 en
       paralelo = 10 peticiones en vuelo: es el máximo que el cruce ya
       probado usa sin que los gateways empiecen a cortar. */
    concurrenciaHlr: 5,

    /* El CM es una sola petición por línea y aguanta más holgura. */
    concurrenciaCm: 6,

    /* Guarda de interfaz: marcar 5.000 filas y mandarlas a consultar es
       casi siempre un clic por accidente en «seleccionar todas». */
    maxSeleccion: 2000
};

/* =====================================================================
   2 · MODELO DE UNA FILA
   ---------------------------------------------------------------------
   Genesis manda `tipoOperacion` como booleano y `resultado` como número.
   Ninguno de los dos se muestra crudo: un «true/2» en una tabla no le
   dice nada a quien atiende la llamada.

   `resultado` se interpretó leyendo las descripciones que vienen con cada
   valor en la propia captura. No hay catálogo publicado, así que un valor
   nuevo se muestra como «Resultado N» y no se inventa un significado.
===================================================================== */
const OPERACION = { true: "Bloqueo", false: "Desbloqueo" };
const RESULTADO = {
    0: { texto: "Sin acción necesaria", clase: "info" },
    1: { texto: "Estado inválido", clase: "warn" },
    2: { texto: "Terminó en estado inesperado", clase: "err" }
};

const textoOperacion = v => OPERACION[String(v)] || "—";
const infoResultado = v => RESULTADO[v] || { texto: v != null ? `Resultado ${v}` : "—", clase: "neutro" };

/** Estado del enriquecimiento de cada fila (columnas CM y HLR). */
const PASO = { PENDIENTE: "Pendiente", CONSULTANDO: "Consultando", LISTA: "Lista", ERROR: "Error" };

function filaDesdeGenesis(g) {
    return {
        __id: g.id,
        id: g.id,
        fecha: g.fechaHoraTransaccion || "",
        linea: String(g.linea || "").trim(),
        documento: String(g.documento || "").trim(),
        operacion: textoOperacion(g.tipoOperacion),
        resultado: g.resultado,
        resultadoTexto: infoResultado(g.resultado).texto,
        canal: g.canal || "",
        usuario: g.usuario || "",
        descripcion: g.descripcionResultado || "",

        sel: false,

        // Se llenan bajo demanda; vacías no es lo mismo que consultadas.
        cmPaso: PASO.PENDIENTE, cmTitular: "", cmCuenta: "", cmSim: "",
        cmEstado: "", cmError: "",

        hlrPaso: PASO.PENDIENTE, hlrUbicacion: "", hlrClaro: "", hlrTigo: "",
        hlrImsi: "", hlrError: ""
    };
}

/* =====================================================================
   3 · ESTADO
===================================================================== */
let filas = [];
let porLinea = new Map();      // línea -> [filas] (una línea puede repetirse)
let cargando = false;
let cancelar = false;
let tabla = null;

const vivas = () => filas;
const seleccionadas = () => filas.filter(f => f.sel);

/** Las líneas ÚNICAS de lo marcado: una línea repetida en diez bloqueos se
    consulta una sola vez y el resultado se copia a sus diez filas. */
function lineasSeleccionadas() {
    const s = new Set();
    seleccionadas().forEach(f => { if (f.linea) s.add(f.linea); });
    return Array.from(s);
}

function indexar() {
    porLinea = new Map();
    filas.forEach(f => {
        if (!f.linea) return;
        if (!porLinea.has(f.linea)) porLinea.set(f.linea, []);
        porLinea.get(f.linea).push(f);
    });
}

/* =====================================================================
   4 · CARGA DESDE GENESIS
===================================================================== */
function progreso(texto, pct) {
    const w = MEUI.$("#progresoWrap");
    if (!w) return;
    w.style.display = texto ? "" : "none";
    if (!texto) return;
    MEUI.$("#progresoTexto").textContent = texto;
    MEUI.$("#progresoPct").textContent = (pct == null ? "" : Math.round(pct) + "%");
    MEUI.$("#progresoBar").style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + "%";
}

async function cargarGenesis() {
    if (cargando) return;
    if (!GENESIS.auth.token) {
        MEUI.toast("Inicia la sesión de Genesis primero.", "warn");
        MEUI.abrirPaso(1, true);
        return;
    }
    cargando = true; cancelar = false;
    MEUI.$("#btnCargar").disabled = true;
    MEUI.$("#btnCancelar").classList.remove("d-none");

    const t0 = performance.now();
    try {
        MEUI.log("Cargando el log de titularidad de Genesis…", "info");
        const r = await GENESIS.cargarTodo({
            tam: Number(MEUI.$("#cfgPagina").value) || CONFIG.paginaGenesis,
            cancelado: () => cancelar,
            alProgresar: p => progreso(
                `Genesis: ${p.leidos.toLocaleString("es-CO")} de ${p.total.toLocaleString("es-CO")} registros `
                + `(página ${p.pagina} de ${p.paginas})`,
                p.total ? (p.leidos / p.total) * 100 : null)
        });

        filas = r.registros.map(filaDesdeGenesis);
        indexar();
        render();

        const seg = ((performance.now() - t0) / 1000).toFixed(1);
        if (!r.completo) {
            MEUI.log(`⚠ Carga cancelada: ${filas.length.toLocaleString("es-CO")} de `
                + `${r.total.toLocaleString("es-CO")} registros. Lo que ves está completo hasta ahí.`, "warn");
            MEUI.toast("Carga cancelada; se conserva lo que alcanzó a llegar.", "warn");
        } else if (filas.length < r.total) {
            // Genesis dijo una cuenta y entregó menos: se dice, no se calla.
            MEUI.log(`⚠ Genesis reportó ${r.total.toLocaleString("es-CO")} registros pero entregó `
                + `${filas.length.toLocaleString("es-CO")}. Puede que entraran registros nuevos durante la `
                + `descarga, o que alguna página viniera vacía.`, "warn");
        } else {
            MEUI.log(`✔ ${filas.length.toLocaleString("es-CO")} registros de Genesis en ${seg} s.`, "ok");
        }
    } catch (e) {
        MEUI.log("✖ No se pudo cargar Genesis: " + e.message, "err");
        MEUI.toast("Falló la carga de Genesis. Mira el registro.", "err");
    } finally {
        cargando = false; cancelar = false;
        progreso("");
        MEUI.$("#btnCargar").disabled = false;
        MEUI.$("#btnCancelar").classList.add("d-none");
    }
}

/* =====================================================================
   5 · ENRIQUECIMIENTO · CM (titular y estado de la línea)
===================================================================== */
function aplicarACadaFila(linea, cambios) {
    (porLinea.get(linea) || []).forEach(f => Object.assign(f, cambios));
}

async function consultarCm() {
    const lineas = lineasSeleccionadas();
    if (!lineas.length) { MEUI.toast("Marca al menos una línea.", "warn"); return; }
    if (lineas.length > CONFIG.maxSeleccion) {
        MEUI.toast(`Son ${lineas.length} líneas; el tope es ${CONFIG.maxSeleccion}. Filtra o marca menos.`, "err");
        return;
    }
    try { await MEAPI.auth.ensure(); }
    catch (e) { MEUI.toast("Inicia la sesión del CM primero.", "err"); MEUI.abrirPaso(1, true); return; }

    cancelar = false;
    MEUI.$("#btnCancelar").classList.remove("d-none");
    lineas.forEach(l => aplicarACadaFila(l, { cmPaso: PASO.CONSULTANDO }));
    render();

    let hechas = 0;
    MEUI.log(`CM: consultando ${lineas.length} línea(s) en tandas de ${CONFIG.concurrenciaCm}.`, "info");

    await ejecutarPool(lineas, CONFIG.concurrenciaCm, async linea => {
        if (cancelar) { aplicarACadaFila(linea, { cmPaso: PASO.PENDIENTE }); return; }
        try {
            const r = await CMLineas.resolverLinea(linea);
            if (!r) {
                aplicarACadaFila(linea, {
                    cmPaso: PASO.LISTA, cmEstado: "No existe en el CM",
                    cmTitular: "", cmCuenta: "", cmSim: "", cmError: ""
                });
            } else {
                const c = r.elegida;
                // `resolverLinea` da la línea y su estado, pero no el titular:
                // ese vive en la cuenta de facturación, que es otra consulta.
                let titular = "";
                try {
                    const cc = await CMLineas.cuentaCrm(c.ban);
                    const a = cc && cc.cuenta;
                    if (a) {
                        titular = a.name
                            || [a.givenName, a.familyName].filter(Boolean).join(" ").trim()
                            || "";
                    }
                } catch (e) { /* el estado de la línea ya sirve; el nombre es un extra */ }

                aplicarACadaFila(linea, {
                    cmPaso: PASO.LISTA,
                    cmEstado: c.estadoTexto || CMLineas.textoEstadoLinea(c.estado),
                    cmTitular: titular,
                    cmCuenta: c.ban || "",
                    cmSim: c.simId || "",
                    cmError: ""
                });
            }
        } catch (e) {
            aplicarACadaFila(linea, { cmPaso: PASO.ERROR, cmError: e.message || String(e) });
        }
        hechas++;
        progreso(`CM: ${hechas} de ${lineas.length} línea(s)`, (hechas / lineas.length) * 100);
        if (hechas % 10 === 0 || hechas === lineas.length) render();
    });

    progreso("");
    MEUI.$("#btnCancelar").classList.add("d-none");
    render();
    MEUI.log(`CM: ${hechas} línea(s) consultada(s).`, "ok");
}

/* =====================================================================
   6 · ENRIQUECIMIENTO · HLR/HSS (Claro, Tigo, ambos o ninguno)
   ---------------------------------------------------------------------
   Claro NO tiene servicio de lote: su QDN es una petición por línea. Por
   eso «en batch» aquí significa tandas controladas (pool de concurrencia),
   que es lo mismo que hacen el cruce y los validadores. Mil líneas salen
   en tandas, con progreso y sin tumbar el gateway.
===================================================================== */
async function consultarHlr() {
    const lineas = lineasSeleccionadas();
    if (!lineas.length) { MEUI.toast("Marca al menos una línea.", "warn"); return; }
    if (lineas.length > CONFIG.maxSeleccion) {
        MEUI.toast(`Son ${lineas.length} líneas; el tope es ${CONFIG.maxSeleccion}. Filtra o marca menos.`, "err");
        return;
    }

    cancelar = false;
    MEUI.$("#btnCancelar").classList.remove("d-none");
    lineas.forEach(l => aplicarACadaFila(l, { hlrPaso: PASO.CONSULTANDO }));
    render();

    const concurrencia = Math.max(1, Math.min(15,
        Number(MEUI.$("#cfgConcurrencia").value) || CONFIG.concurrenciaHlr));
    MEUI.log(`HLR/HSS: ${lineas.length} línea(s) en tandas de ${concurrencia} `
        + `(cada una consulta Claro y Tigo a la vez).`, "info");

    await HLRConsulta.consultarVarias(lineas, {
        concurrencia,
        cancelado: () => cancelar,
        alTerminarUna: (r, hechas, total) => {
            aplicarACadaFila(r.msisdn, {
                hlrPaso: PASO.LISTA,
                hlrUbicacion: r.etiquetaUbicacion,
                hlrClaro: r.etiquetaClaro,
                hlrTigo: r.etiquetaTigo,
                hlrImsi: r.imsi || "",
                hlrError: r.ubicacion === "NO_CONCLUYENTE"
                    ? [r.claro && r.claro.mensaje, r.tigo && r.tigo.mensaje].filter(Boolean).join(" · ")
                    : ""
            });
            progreso(`HLR/HSS: ${hechas} de ${total} línea(s)`, (hechas / total) * 100);
            if (hechas % 10 === 0 || hechas === total) render();
        }
    });

    // Lo que quedó marcado como «consultando» es lo que se canceló.
    filas.forEach(f => { if (f.hlrPaso === PASO.CONSULTANDO) f.hlrPaso = PASO.PENDIENTE; });

    progreso("");
    MEUI.$("#btnCancelar").classList.add("d-none");
    render();
    MEUI.log("HLR/HSS: consulta terminada.", "ok");
}

/* =====================================================================
   7 · POOL
===================================================================== */
async function ejecutarPool(items, limite, worker) {
    let i = 0;
    const n = Math.max(1, Math.min(limite || 5, items.length || 1));
    await Promise.all(Array.from({ length: n }, async () => {
        while (i < items.length) {
            const idx = i++;
            await worker(items[idx], idx);
        }
    }));
}

/* =====================================================================
   8 · FILTROS
===================================================================== */
const filtros = { operacion: "", resultado: "", canal: "", ubicacion: "", sel: "", texto: "" };

const normaliza = s => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

function filaPasaFiltros(f) {
    if (filtros.operacion && f.operacion !== filtros.operacion) return false;
    if (filtros.resultado && f.resultadoTexto !== filtros.resultado) return false;
    if (filtros.canal && f.canal !== filtros.canal) return false;
    if (filtros.ubicacion && (f.hlrUbicacion || "—") !== filtros.ubicacion) return false;
    if (filtros.sel === "marcadas" && !f.sel) return false;
    if (filtros.sel === "sin-marcar" && f.sel) return false;
    if (filtros.texto) {
        const q = normaliza(filtros.texto);
        const heno = normaliza([f.linea, f.documento, f.descripcion, f.cmTitular,
            f.cmCuenta, f.usuario, f.hlrImsi].join(" "));
        if (heno.indexOf(q) < 0) return false;
    }
    return true;
}

const visibles = () => filas.filter(filaPasaFiltros);

/* =====================================================================
   9 · TABLA
===================================================================== */
const esc = s => MEUI.esc(s);
const badge = (t, c) => `<span class="badge-estado ${c || "neutro"}">${esc(t || "—")}</span>`;

const CLASE_UBICACION = {
    "Claro": "info", "Tigo": "ok", "Ambos — revisar": "warn",
    "Residuo en Tigo (escalar)": "warn", "Claro + residuo en Tigo": "warn",
    "Ninguno": "off", "No concluyente": "err"
};
const CLASE_ESTADO_CM = {
    "Activa": "ok", "Bloqueada": "err", "Inactiva": "off",
    "Disponible": "info", "No existe en el CM": "warn"
};

function celdaPaso(paso, error) {
    if (paso === PASO.PENDIENTE) return '<span class="paso-pend">—</span>';
    if (paso === PASO.CONSULTANDO) return badge("Consultando", "info");
    if (paso === PASO.ERROR) return `<span title="${esc(error)}">${badge("Error", "err")}</span>`;
    return "";
}

function construirTabla() {
    tabla = new DataTable("#tablaTitularidad", MEUI.opcionesTabla({
        data: [],
        // `deferRender` y `orderClasses:false` no son adorno: con cientos de
        // miles de filas, pintarlas todas o recalcular clases al ordenar
        // bloquea el navegador varios segundos.
        deferRender: true,
        orderClasses: false,
        pageLength: 50,
        lengthMenu: [25, 50, 100, 250],
        order: [],
        columns: [
            {
                title: '<input type="checkbox" id="chkTodas" title="Marcar lo visible">',
                data: null, orderable: false, width: "28px",
                render: f => `<input type="checkbox" class="chk-fila" data-id="${esc(f.__id)}"${f.sel ? " checked" : ""}>`
            },
            { title: "Línea", data: "linea", render: l => `<span class="me-mono">${esc(l)}</span>` },
            { title: "HLR/HSS", data: "hlrUbicacion", render: (v, t, f) => v ? badge(v, CLASE_UBICACION[v]) : celdaPaso(f.hlrPaso, f.hlrError) },
            { title: "Estado línea (CM)", data: "cmEstado", render: (v, t, f) => v ? badge(v, CLASE_ESTADO_CM[v]) : celdaPaso(f.cmPaso, f.cmError) },
            { title: "Claro", data: "hlrClaro", render: v => esc(v || "—") },
            { title: "Tigo", data: "hlrTigo", render: v => esc(v || "—") },
            { title: "Titular (CM)", data: "cmTitular", render: v => esc(v || "—") },
            { title: "Documento", data: "documento", render: v => `<span class="me-mono">${esc(v)}</span>` },
            { title: "Cuenta (BAN)", data: "cmCuenta", render: v => `<span class="me-mono">${esc(v || "—")}</span>` },
            { title: "Operación", data: "operacion", render: v => badge(v, v === "Bloqueo" ? "err" : "ok") },
            { title: "Resultado", data: "resultadoTexto", render: (v, t, f) => badge(v, infoResultado(f.resultado).clase) },
            { title: "Fecha", data: "fecha", render: v => `<span class="me-mono">${esc(String(v).replace("T", " ").slice(0, 19))}</span>` },
            { title: "Canal", data: "canal", render: v => esc(v || "—") },
            { title: "Usuario", data: "usuario", render: v => esc(v || "—") },
            { title: "Descripción", data: "descripcion", render: v => `<span class="desc" title="${esc(v)}">${esc(v)}</span>` },
            { title: "ID", data: "id", render: v => `<span class="me-mono">${esc(v)}</span>` }
        ]
    }));
    if (MEUI.registrarTabla) MEUI.registrarTabla(tabla);

    // Marcar/desmarcar: delegado, porque DataTables redibuja las filas.
    document.querySelector("#tablaTitularidad").addEventListener("change", ev => {
        const c = ev.target.closest(".chk-fila");
        if (!c) return;
        const f = filas.find(x => String(x.__id) === c.dataset.id);
        if (f) { f.sel = c.checked; actualizarResumenSeleccion(); }
    });
    const todas = document.getElementById("chkTodas");
    if (todas) todas.addEventListener("change", () => marcarVisibles(todas.checked));
}

/** Marca o desmarca lo que pasa los filtros, no la página visible: el
    analista filtra y marca «todas» esperando eso. */
function marcarVisibles(valor) {
    visibles().forEach(f => { f.sel = !!valor; });
    render();
}

function actualizarResumenSeleccion() {
    const n = seleccionadas().length;
    const l = lineasSeleccionadas().length;
    const el = MEUI.$("#resumenSeleccion");
    if (el) {
        el.textContent = n
            ? `${n.toLocaleString("es-CO")} fila(s) · ${l.toLocaleString("es-CO")} línea(s) única(s)`
            : "Nada marcado";
    }
    ["btnConsultarCm", "btnConsultarHlr"].forEach(id => {
        const b = MEUI.$("#" + id);
        if (b) b.disabled = n === 0;
    });
}

function render() {
    if (!tabla) construirTabla();
    const v = visibles();
    tabla.clear();
    tabla.rows.add(v);
    tabla.draw(false);
    actualizarKpis();
    actualizarResumenSeleccion();
    refrescarOpcionesFiltros();
    MEUI.mostrarSiHayDatos("#tablaTitularidad", { vacio: "#msgVacio", tabla });
    MEUI.resumenPaso(2, filas.length ? `${filas.length.toLocaleString("es-CO")} registros` : "");
    if (MEUI.ajustarTablas) MEUI.ajustarTablas();
}

/* =====================================================================
   10 · TARJETAS
===================================================================== */
function actualizarKpis() {
    const v = visibles();
    const cuenta = p => v.filter(p).length;
    const set = (id, n) => { const e = MEUI.$("#" + id); if (e) e.textContent = n.toLocaleString("es-CO"); };
    set("kpiTotal", v.length);
    set("kpiLineas", new Set(v.map(f => f.linea).filter(Boolean)).size);
    set("kpiBloqueos", cuenta(f => f.operacion === "Bloqueo"));
    set("kpiRevisar", cuenta(f => f.hlrUbicacion === "Ambos — revisar" || f.hlrUbicacion === "No concluyente"));
}

function refrescarOpcionesFiltros() {
    const llenar = (sel, campo, vacio) => {
        const s = MEUI.$(sel);
        if (!s) return;
        const actual = s.value;
        const valores = [...new Set(filas.map(f => f[campo]).filter(x => x != null && x !== ""))].sort();
        s.innerHTML = `<option value="">${vacio}</option>`
            + valores.map(x => `<option value="${esc(x)}"${x === actual ? " selected" : ""}>${esc(x)}</option>`).join("");
    };
    llenar("#fOperacion", "operacion", "Operación: todas");
    llenar("#fResultado", "resultadoTexto", "Resultado: todos");
    llenar("#fCanal", "canal", "Canal: todos");
    llenar("#fUbicacion", "hlrUbicacion", "HLR/HSS: todos");
}

/* =====================================================================
   11 · EXPORTACIÓN
   Lo que se exporta es lo que se ve: mismos filtros, mismo orden.
===================================================================== */
const CABECERA = ["Línea", "HLR/HSS", "Claro", "Tigo", "IMSI",
    "Estado línea (CM)", "Titular (CM)", "Cuenta (BAN)", "SIM (CM)", "Documento (Genesis)",
    "Operación", "Resultado", "Descripción", "Fecha", "Canal", "Usuario", "ID Genesis"];

const filaExport = f => [f.linea, f.hlrUbicacion || "", f.hlrClaro || "", f.hlrTigo || "", f.hlrImsi || "",
    f.cmEstado || "", f.cmTitular || "", f.cmCuenta || "", f.cmSim || "", f.documento,
    f.operacion, f.resultadoTexto, f.descripcion,
    String(f.fecha).replace("T", " ").slice(0, 19), f.canal, f.usuario, f.id];

function filasExport() { return { head: CABECERA, rows: visibles().map(filaExport) }; }
function filasParaExportar() { return visibles(); }

/* =====================================================================
   12 · DETALLE DE UNA FILA
   El SOAP crudo no se guarda en memoria (ver genesis-api.js): se vuelve a
   pedir la página de ese id cuando alguien lo abre.
===================================================================== */
async function verDetalle(id) {
    const f = filas.find(x => String(x.__id) === String(id));
    if (!f) return;
    MEUI.$("#mdLinea").textContent = f.linea;
    MEUI.$("#mdResumen").innerHTML = `
        <dl class="dl-grid">
          <dt>Operación</dt><dd>${esc(f.operacion)}</dd>
          <dt>Resultado</dt><dd>${esc(f.resultadoTexto)}</dd>
          <dt>Descripción</dt><dd>${esc(f.descripcion || "—")}</dd>
          <dt>Fecha</dt><dd>${esc(String(f.fecha).replace("T", " ").slice(0, 19))}</dd>
          <dt>Documento (Genesis)</dt><dd>${esc(f.documento || "—")}</dd>
          <dt>Canal · Usuario</dt><dd>${esc(f.canal || "—")} · ${esc(f.usuario || "—")}</dd>
          <dt>HLR/HSS</dt><dd>${esc(f.hlrUbicacion || "sin consultar")}</dd>
          <dt>Estado en el CM</dt><dd>${esc(f.cmEstado || "sin consultar")}</dd>
        </dl>`;
    MEUI.$("#mdCrudo").textContent = "Pidiendo el detalle a Genesis…";
    new bootstrap.Modal("#modalDetalle").show();
    try {
        const d = await GENESIS.detalleDe(f.id, Number(MEUI.$("#cfgPagina").value) || CONFIG.paginaGenesis);
        MEUI.$("#mdCrudo").textContent = d
            ? `--- request ---\n${d.request || "(vacío)"}\n\n--- response ---\n${d.response || "(vacío)"}`
            : "Genesis ya no devuelve ese registro en la página esperada.";
    } catch (e) {
        MEUI.$("#mdCrudo").textContent = "No se pudo traer el detalle: " + e.message;
    }
}

/* =====================================================================
   13 · LO QUE USA EL PUENTE
===================================================================== */

/** Corta la carga de Genesis o una tanda de consultas, entre elementos.
    No aborta la petición en vuelo: deja terminar la que ya salió y no
    manda más. Lo que ya llegó se conserva. */
function cancelarTrabajo() { cancelar = true; }

function fijarFiltro(campo, valor) {
    if (!(campo in filtros)) return;
    filtros[campo] = valor || "";
    render();
}

function limpiarFiltros() {
    Object.keys(filtros).forEach(k => { filtros[k] = ""; });
    render();
}

/* =====================================================================
   14 · ARRANQUE
===================================================================== */
function inicializarTitularidad() {
    render();   // deja la tabla montada y el mensaje de «sin datos» a la vista
}
inicializarTitularidad();
