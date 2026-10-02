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

    /* El HLR/HSS va en CASCADA por defecto: cada línea tiene ~1 petición en
       vuelo (Tigo y, solo si Tigo no la encuentra, después Claro), así que 5
       líneas en paralelo son ~5 peticiones. Con «Consultar en ambos» cada
       línea dispara Claro y Tigo a la vez: 5 en paralelo = 10 en vuelo, que
       es el máximo que el cruce ya probado usa sin que los gateways
       empiecen a cortar. El 5 se dejó igual a propósito: en cascada eso es
       menos presión, no más. */
    concurrenciaHlr: 5,

    /* El CM es una sola petición por línea y aguanta más holgura. */
    concurrenciaCm: 6,

    /* Guarda de interfaz: marcar 5.000 filas y mandarlas a consultar es
       casi siempre un clic por accidente en «seleccionar todas». Se cuenta
       en líneas ÚNICAS, no en filas: una línea repetida se consulta una vez.
       La acción «Seleccionar primeros N» existe justo por este tope. */
    maxSeleccion: 2000,

    /* Zona del proyecto. «El mes en curso» es el de Bogotá aunque el equipo
       del analista tenga otra zona configurada. */
    zona: "America/Bogota"
};

/* =====================================================================
   2 · MODELO DE UNA FILA
   ---------------------------------------------------------------------
   Genesis manda `tipoOperacion` como booleano y `resultado` como número.
   Ninguno de los dos se muestra crudo: un «true/2» en una tabla no le
   dice nada a quien atiende la llamada.

   `resultado` se interpretó cruzando cada valor con TODAS las descripciones
   que lo acompañan en la captura. No hay catálogo publicado, así que un
   valor nuevo se muestra como «Resultado N» y no se le inventa significado.

     0 (114)  «ya estaba en el estado correcto» (96) · sin descripción (18)
     1  (15)  «estado inválido» (12) · «Respuesta fallida … SOAP 500» (3)
     2 (120)  «finalizó, pero la línea quedó en un estado inesperado»

   El 1 se llama «Falló» y no «Estado inválido» justamente por esas 3: la
   etiqueta tiene que ser cierta para TODAS las filas del grupo, no para la
   mayoría. El código crudo va igual en la tabla y en la exportación, así
   que quien quiera afinar no pierde el dato.

   Para el call, 1 y 2 significan lo mismo en la práctica: la línea NO quedó
   como se pedía. Se separan porque en 1 la orden no se ejecutó y en 2 sí,
   y eso cambia a quién se escala.
===================================================================== */
const OPERACION = { true: "Bloqueo", false: "Desbloqueo" };
const RESULTADO = {
    0: { texto: "Sin cambio necesario", clase: "info" },
    1: { texto: "Falló", clase: "err" },
    2: { texto: "Terminó en estado inesperado", clase: "warn" }
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
        oculta: false,     // fuera de la vista, de la exportación y de las consultas

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
let cargando = false;      // carga de Genesis en curso
let trabajando = false;    // una tanda de CM o de HLR en curso
let cancelar = false;
let tabla = null;
let nOcultas = 0;          // filas ocultas; se recuenta al ocultar/mostrar, no en cada repintado

const vivas = () => filas;

/** Marcadas Y no ocultas: es lo que se consulta. Una fila oculta puede seguir
    marcada, pero no entra en ninguna consulta (misma regla que «Estado de
    líneas» y «Cierre masivo de casos»). */
const seleccionadas = () => filas.filter(f => f.sel && !f.oculta);

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

/** Escribe un texto solo si cambió. Asignar `textContent` con el mismo valor
    igual invalida el layout: en un repintado que ocurre cada pocos segundos
    durante minutos, esos «mismos valores» eran casi todas las escrituras. */
function ponerTexto(el, texto) {
    if (el && el.textContent !== texto) el.textContent = texto;
}

/* =====================================================================
   4 · CARGA DESDE GENESIS
===================================================================== */
const _prog = { visible: null, texto: null, pct: null, ancho: null };

function progreso(texto, pct) {
    const w = MEUI.$("#progresoWrap");
    if (!w) return;
    /* «block», no «»: la hoja de estilos trae `#progresoWrap { display:none }`
       y vaciar el estilo en linea devuelve el control a esa regla, con lo que
       la barra no se mostraba NUNCA. Tiene que ganar el estilo en linea. */
    const visible = texto ? "block" : "none";
    if (_prog.visible !== visible) { w.style.display = visible; _prog.visible = visible; }
    if (!texto) return;
    ponerTexto(MEUI.$("#progresoTexto"), texto);
    ponerTexto(MEUI.$("#progresoPct"), pct == null ? "" : Math.round(pct) + "%");
    const ancho = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + "%";
    if (_prog.ancho !== ancho) { MEUI.$("#progresoBar").style.width = ancho; _prog.ancho = ancho; }
}

/* Cada cuánto repintar la tabla mientras entra la carga.

   DataTables rehace el conjunto ENTERO en cada repintado, así que el coste
   sube con cada página que llega. La pauta separa dos momentos que sirven
   para cosas distintas:

     · los primeros 2 s, cada 0,5 s → es cuando hay que ver que la cosa
       arrancó y que están entrando datos de verdad;
     · de ahí en adelante, cada 5 s → eso ya se sabe; lo que falta es que
       termine, y repintar seguido solo le quita tiempo a eso.

   Se mide por TIEMPO DE CARGA, no por número de filas: lo que hay que
   cubrir es la incertidumbre de los primeros segundos, y esa no depende de
   cuántos registros traiga el día. */
const PINTADO = { rapido: 500, lento: 5000, cambioMs: 2000 };

function intervaloPintado(msDesdeInicio) {
    return msDesdeInicio < PINTADO.cambioMs ? PINTADO.rapido : PINTADO.lento;
}

/* ---------------------------------------------------------------------
   Qué se carga
   ---------------------------------------------------------------------
   Hay TRES formas, de la más barata a la más cara, y el orden de los botones
   es ese:

     · «Cargar los más nuevos» (por defecto): los últimos N registros, con N =
       GENESIS.CONFIG.topeRegistros. Como Genesis ordena DESC, la página 1
       son los más nuevos, así que son unas pocas peticiones y la herramienta
       sirve en segundos, en vez de esperar un mes entero antes de poder
       mirar nada. NO es la carga completa y la interfaz lo dice.
     · «Cargar rango»: un rango de fechas, SIN tope. Se descompone en tramos
       (año / mes / días sueltos) porque el filtro de Genesis es un
       «contiene» sobre dd/MM/yyyy: un mes completo es UNA consulta, no 31.
       Ya no hace falta limitarlo a un mes.
     · «Traer todo»: sin rango ni tope; miles de peticiones, de 5 a 10
       minutos. Cerrado y con casilla de confirmación.

   Los dos campos de fecha arrancan con el mes en curso solo como sugerencia
   visible: el botón por defecto NO los usa. Si lo hiciera, quien solo quiere
   «ver lo último» esperaría un mes de datos, y quien dejó las fechas por
   defecto sin mirarlas cargaría algo que no pidió.

   Las fechas viajan como cadenas «YYYY-MM-DD» (lo que da <input type=date>)
   y GENESIS las valida y las convierte; aquí no se pasan por `new Date`
   porque «2026-03-12» se lee como medianoche UTC y en Bogotá sería el día
   anterior.
--------------------------------------------------------------------- */

/** Día 1 y último día del mes de `ahora`, en la zona del proyecto: la sugerencia
    con que arrancan los campos de fecha. */
function rangoMesEnCurso(ahora) {
    const partes = new Intl.DateTimeFormat("en-US", {
        timeZone: CONFIG.zona, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(ahora || new Date());
    const dato = t => Number(partes.find(p => p.type === t).value);
    const y = dato("year"), m = dato("month");
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();   // día 0 del mes siguiente
    const dos = n => String(n).padStart(2, "0");
    return { desde: `${y}-${dos(m)}-01`, hasta: `${y}-${dos(m)}-${dos(ultimo)}` };
}

/** Lee los dos campos y dice cuánto cuesta el rango, ANTES de lanzar. Es la
    misma cuenta que hace GENESIS.cargarTodo (`tramosDeRango`), para que el
    aviso y lo que de verdad pasa no puedan decir cosas distintas.

    Se cuenta en TRAMOS, no en días: Genesis filtra por «contiene» sobre
    dd/MM/yyyy, así que un mes completo es UN tramo (una petición como mínimo)
    y no 31. Decir «31 días = 31 consultas» sería falso. */
function infoRango() {
    const desde = (MEUI.$("#fDesde") || {}).value || "";
    const hasta = (MEUI.$("#fHasta") || {}).value || "";
    try {
        const r = GENESIS.tramosDeRango(desde, hasta);
        const f = n => n.toLocaleString("es-CO");
        const k = r.tramos.length;
        const etiquetas = k > 6
            ? r.tramos.slice(0, 6).map(t => t.etiqueta).join(", ") + "…"
            : r.tramos.map(t => t.etiqueta).join(", ");
        const dias = `${f(r.dias)} día${r.dias === 1 ? "" : "s"}`;
        return {
            ok: true, desde: r.desde, hasta: r.hasta, dias: r.dias, tramos: k, largo: r.largo,
            texto: r.largo
                ? `⚠ ${dias} en ${f(k)} tramos (${etiquetas}): al menos ${f(k)} peticiones. Va a tardar; ¿cabe un rango más corto?`
                : `${dias} · ${f(k)} tramo${k === 1 ? "" : "s"} (${etiquetas}): al menos ${f(k)} ${k === 1 ? "petición" : "peticiones"} a Genesis, más páginas si alguno trae mucho.`
        };
    } catch (e) {
        return { ok: false, desde, hasta, dias: 0, tramos: 0, largo: false, texto: e.message };
    }
}

/** Pinta el aviso bajo las fechas y habilita o no «Cargar rango». («Cargar los
    más nuevos» no depende de las fechas.) */
function actualizarAvisoRango() {
    const info = infoRango();
    const aviso = MEUI.$("#rangoAviso");
    if (aviso) {
        ponerTexto(aviso, info.texto);
        aviso.className = "rango-aviso" + (!info.ok ? " error" : info.largo ? " largo" : "");
    }
    const b = MEUI.$("#btnCargarRango");
    // Un botón con spinner (MEUI.ocupado) se queda deshabilitado hasta que
    // termine la carga; no se le debe volver a habilitar desde aquí.
    if (b && !b.dataset.meOcupado) b.disabled = !info.ok;
    return info;
}

/* El texto de «no hay nada» se cambia según el momento (cargando, rango
   vacío) y se restituye al original: el del marcado, que explica el primer
   uso. */
let _vacioOriginal = null;
function textoVacio(html) {
    const e = MEUI.$("#msgVacio");
    if (!e) return;
    if (_vacioOriginal === null) _vacioOriginal = e.innerHTML;
    e.innerHTML = html == null ? _vacioOriginal : html;
}

/** Qué decir mientras carga. Con rango, `total` CRECE (solo suma los tramos ya
    consultados), así que «X de Y» sería una cuenta que se mueve: se dice qué
    tramo va y cuántos registros llegan. Con tope, el objetivo es el menor de
    (tope, lo que Genesis dice que hay): «249 de 2.000» sería mentira si en
    total hay 249. */
const NOMBRE_TRAMO = { dia: "día", mes: "mes", anio: "año" };

function objetivoTope(p) { return Math.min(p.tope, p.total || p.tope); }

function textoProgreso(p) {
    const f = n => n.toLocaleString("es-CO");
    const pag = p.paginas > 1 ? ` · página ${p.pagina} de ${p.paginas}` : "";
    if (p.tramo != null) {
        return `Genesis · ${NOMBRE_TRAMO[p.granularidad] || "tramo"} ${p.etiqueta} (tramo ${p.tramo} de ${p.tramos}) · `
            + `${f(p.leidos)} registros` + pag;
    }
    if (p.tope) return `Genesis: ${f(p.leidos)} de ${f(objetivoTope(p))} registros (los más nuevos)` + pag;
    return `Genesis: ${f(p.leidos)} de ${f(p.total)} registros (página ${p.pagina} de ${p.paginas})`;
}

/** Porcentaje de 0 a 100. `fraccion` es monótona con rango; leidos/total NO
    lo es (el total crece y la barra retrocedería). Con tope, `fraccion` es
    leidos/tope, y si la tabla tiene menos que el tope la barra se quedaría en
    el 12 %: se mide contra lo que de verdad se va a leer. */
function porcentajeProgreso(p) {
    if (p.tope && p.tramo == null) return Math.min(100, (p.leidos / objetivoTope(p)) * 100);
    if (p.fraccion != null) return p.fraccion * 100;
    return p.total ? (p.leidos / p.total) * 100 : null;
}

/** Lo que se dice al terminar, que tiene que ser cierto en los TRES modos.

    · Con tope, llegar al tope no es cancelar ni es una carga completa: es
      «los N más nuevos de T», y se dice así, sin rodeos.
    · Con rango, `r.total` es la suma de lo que Genesis contó en cada tramo
      consultado y `cargadas` ya viene sin los repetidos entre tramos: comparar
      una con la otra como se hace sin rango («Genesis reportó X pero entregó
      Y») daría un aviso falso en el caso normal, y un «X de Y» no tendría
      sentido cuando Y solo cuenta los tramos que se llegaron a consultar.
    Devuelve {nivel, texto}; el llamador lo registra. */
function resumenCarga(r, cargadas, seg) {
    const f = n => n.toLocaleString("es-CO");
    if (r.rango) {
        const tramos = `${r.tramosRecorridos} de ${r.tramosTotal} tramos`;
        const lapso = `${r.rango.desde} a ${r.rango.hasta}`;
        if (!r.completo) {
            const cortado = (r.detalleTramos || []).find(d => !d.completo);
            return {
                nivel: "warn",
                texto: `⚠ Carga cancelada: ${f(cargadas)} registros, ${tramos} completos (${lapso}).`
                    + (cortado ? ` El tramo ${cortado.etiqueta} quedó a medias.` : "")
                    + ` Lo que falta no se consultó.`
            };
        }
        if (!cargadas) {
            return { nivel: "info", texto: `Genesis no devolvió registros entre ${lapso} (${f(r.consultas)} petición(es)).` };
        }
        const base = `✔ ${f(cargadas)} registros de Genesis (${lapso}: ${f(r.rango.dias)} día(s) · `
            + `${f(r.tramosTotal)} tramo(s) · ${f(r.consultas)} petición(es)) en ${seg} s.`;
        const repetidos = r.total - cargadas;
        if (repetidos > 0) {
            return {
                nivel: "warn",
                texto: `${base} Sumando los tramos, Genesis contó ${f(r.total)}: ${f(repetidos)} no se guardaron. `
                    + `Lo normal es que sean registros repetidos entre tramos contiguos (se descartan a propósito), `
                    + `pero también puede ser una página que vino vacía.`
            };
        }
        return { nivel: "ok", texto: base };
    }
    if (!r.completo) {
        return {
            nivel: "warn",
            texto: `⚠ Carga cancelada: ${f(cargadas)} de ${f(r.total)} registros`
                + (r.tope ? " (los más nuevos)" : "") + `. Lo que ves está completo hasta ahí.`
        };
    }
    if (r.topeAlcanzado) {
        return {
            nivel: "warn",
            texto: `⚠ ${f(cargadas)} registros (los más nuevos) de ${f(r.total)}. No es la carga completa: `
                + `elige un rango de fechas para ver más.`
        };
    }
    if (cargadas < r.total) {
        // Genesis dijo una cuenta y entregó menos: se dice, no se calla.
        return {
            nivel: "warn",
            texto: `⚠ Genesis reportó ${f(r.total)} registros pero entregó ${f(cargadas)}. Puede que entraran `
                + `registros nuevos durante la descarga, o que alguna página viniera vacía.`
        };
    }
    return { nivel: "ok", texto: `✔ ${f(cargadas)} registros de Genesis${r.tope ? " (todos los que hay)" : ""} en ${seg} s.` };
}

/** Lo que queda escrito bajo los botones mientras haya datos: qué es lo que
    se está viendo. Una carga con tope no debe poder confundirse con la
    completa. {texto, tope:boolean} */
function notaDeCarga(r, cargadas, modo) {
    const f = n => n.toLocaleString("es-CO");
    if (r.rango) {
        return { texto: `Viendo ${f(cargadas)} registros del ${r.rango.desde} al ${r.rango.hasta}`
            + (r.completo ? "." : " (carga cancelada: puede faltar lo último)."), tope: !r.completo };
    }
    if (modo === "ultimos") {
        return r.topeAlcanzado
            ? { texto: `Viendo los ${f(cargadas)} registros más nuevos de ${f(r.total)}. Elige un rango de fechas para ver más.`, tope: true }
            : { texto: r.completo
                ? `Viendo los ${f(cargadas)} registros que hay.`
                : `Viendo ${f(cargadas)} registros (carga cancelada).`, tope: !r.completo };
    }
    return { texto: `Viendo ${f(cargadas)} de ${f(r.total)} registros${r.completo ? " (todo el log)" : " (carga cancelada)"}.`, tope: !r.completo };
}

/** Qué se cargó, para el resumen del paso 2. */
let etiquetaCarga = "";

/** Los tres modos de carga y el botón de cada uno. */
const MODOS_CARGA = { ultimos: "#btnCargar", rango: "#btnCargarRango", todo: "#btnCargarTodo" };

/** Cuántos registros trae «los más nuevos». Sale de GENESIS.CONFIG: es la
    decisión de ese módulo, no se repite aquí a mano. */
const topeUltimos = () => Number(GENESIS.CONFIG.topeRegistros) || 2000;

/** Carga el log de Genesis.
    `opciones.modo`:
      · "ultimos" (por defecto) los N más nuevos;
      · "rango"   el rango de los dos campos de fecha, sin tope;
      · "todo"    todo el log, sin rango ni tope (lento). */
async function cargarGenesis(opciones) {
    const modo = (opciones && opciones.modo) || "ultimos";
    if (!MODOS_CARGA[modo]) throw new Error("Modo de carga desconocido: " + modo);
    if (cargando) { MEUI.toast("Ya hay una carga en curso.", "warn"); return; }
    if (!GENESIS.auth.token) {
        MEUI.toast("Inicia la sesión de Genesis primero.", "warn");
        MEUI.abrirPaso(1, true);
        return;
    }
    // Se valida el rango ANTES de tocar nada: un «hasta» anterior a «desde»
    // no debe vaciar la tabla ni gastar una sola consulta.
    let rango = null;
    if (modo === "rango") {
        const info = actualizarAvisoRango();
        if (!info.ok) { MEUI.toast(info.texto, "err"); return; }
        rango = { desde: info.desde, hasta: info.hasta };
    }
    const tope = modo === "ultimos" ? topeUltimos() : 0;

    cargando = true; cancelar = false;
    const btn = MODOS_CARGA[modo];
    MEUI.ocupado(btn, "Cargando…");
    MEUI.$("#btnCancelar").classList.remove("d-none");
    ponerNotaCarga("", false);

    const t0 = performance.now();
    try {
        MEUI.log(modo === "todo" ? "Cargando TODO el log de titularidad de Genesis (sin rango ni tope)…"
            : modo === "rango" ? `Cargando el log de titularidad de Genesis: ${rango.desde} a ${rango.hasta}…`
            : `Cargando los ${tope.toLocaleString("es-CO")} registros más nuevos del log de titularidad de Genesis…`, "info");

        // Se empieza de cero: una carga nueva reemplaza lo anterior, no se
        // suma a ello.
        filas = [];
        porLinea = new Map();
        nOcultas = 0;
        etiquetaCarga = modo === "todo" ? "todo el log"
            : modo === "rango" ? `${rango.desde} a ${rango.hasta}`
            : `los ${tope.toLocaleString("es-CO")} más nuevos`;
        // Sin `render()` aquí: la tabla sigue mostrando lo anterior hasta que
        // llega la primera tanda (que la reemplaza). Repintar ahora sería un
        // dibujado más, vacío, justo antes del primero de verdad.
        textoVacio("Cargando el log de Genesis…");
        let ultimoPintado = 0;

        const r = await GENESIS.cargarTodo(Object.assign({
            tam: Number(MEUI.$("#cfgPagina").value) || CONFIG.paginaGenesis,
            cancelado: () => cancelar,

            // Cada página se agrega y se pinta: con 200.000 registros, esperar
            // al final son minutos mirando una barra sin ver un solo dato.
            alLote: nuevos => {
                nuevos.forEach(g => {
                    const f = filaDesdeGenesis(g);
                    filas.push(f);
                    registrarValoresFiltro(f);
                    if (f.linea) {
                        if (!porLinea.has(f.linea)) porLinea.set(f.linea, []);
                        porLinea.get(f.linea).push(f);
                    }
                });
                const ahora = performance.now();
                if (ahora - ultimoPintado >= intervaloPintado(ahora - t0)) {
                    ultimoPintado = ahora;
                    render();
                }
            },

            alProgresar: p => progreso(textoProgreso(p), porcentajeProgreso(p))
        }, rango || {}, tope ? { tope } : {}));

        // Solo si la carga terminó: una carga cancelada sin filas no es «no hay registros».
        if (!filas.length) textoVacio(!r.completo ? null : modo === "rango"
            ? `Genesis no devolvió registros entre <strong>${esc(rango.desde)}</strong> y <strong>${esc(rango.hasta)}</strong>. Prueba con otro rango.`
            : "Genesis no devolvió registros.");
        render();   // el pintado final, ya con todo

        const seg = ((performance.now() - t0) / 1000).toFixed(1);
        const fin = resumenCarga(r, filas.length, seg);
        MEUI.log(fin.texto, fin.nivel);
        if (filas.length) { const n = notaDeCarga(r, filas.length, modo); ponerNotaCarga(n.texto, n.tope); }
        if (!r.completo) MEUI.toast("Carga cancelada; se conserva lo que alcanzó a llegar.", "warn");
    } catch (e) {
        MEUI.log("✖ No se pudo cargar Genesis: " + e.message, "err");
        MEUI.toast("Falló la carga de Genesis. Mira el registro.", "err");
        if (!filas.length) textoVacio(null);
    } finally {
        cargando = false; cancelar = false;
        progreso("");
        MEUI.libre(btn);
        MEUI.$("#btnCancelar").classList.add("d-none");
        actualizarAvisoRango();    // devuelve el botón de rango a lo que digan las fechas
    }
}

/** La nota fija bajo los botones (paso 2). `tope` la resalta: lo que se ve no es todo. */
function ponerNotaCarga(texto, tope) {
    const e = MEUI.$("#cargaNota");
    if (!e) return;
    ponerTexto(e, texto);
    e.className = "carga-nota mt-2" + (tope ? " tope" : "");
}

/* =====================================================================
   5 · ENRIQUECIMIENTO · CM (titular y estado de la línea)
===================================================================== */
function aplicarACadaFila(linea, cambios) {
    (porLinea.get(linea) || []).forEach(f => Object.assign(f, cambios));
}

async function consultarCm() {
    if (trabajando) { MEUI.toast("Espera a que termine la consulta en curso.", "warn"); return; }
    const lineas = lineasSeleccionadas();
    if (!lineas.length) { MEUI.toast("Marca al menos una línea.", "warn"); return; }
    if (lineas.length > CONFIG.maxSeleccion) {
        MEUI.toast(`Son ${lineas.length} líneas; el tope es ${CONFIG.maxSeleccion}. Marca menos o usa «Seleccionar primeros ${CONFIG.maxSeleccion.toLocaleString("es-CO")}».`, "err");
        return;
    }
    try { await MEAPI.auth.ensure(); }
    catch (e) { MEUI.toast("Inicia la sesión del CM primero.", "err"); MEUI.abrirPaso(1, true); return; }

    trabajando = true;
    cancelar = false;
    MEUI.$("#btnCancelar").classList.remove("d-none");
    lineas.forEach(l => aplicarACadaFila(l, { cmPaso: PASO.CONSULTANDO }));
    render();

    let hechas = 0;
    MEUI.log(`CM: consultando ${lineas.length} línea(s) en tandas de ${CONFIG.concurrenciaCm}.`, "info");

    try {
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

    } finally {
        // Pase lo que pase, la herramienta queda utilizable: un flag que se
        // quedara en true dejaría los botones muertos hasta recargar.
        trabajando = false;
        progreso("");
        MEUI.$("#btnCancelar").classList.add("d-none");
        filas.forEach(f => { if (f.cmPaso === PASO.CONSULTANDO) f.cmPaso = PASO.PENDIENTE; });
        render();
    }
    MEUI.log(`CM: ${hechas} línea(s) consultada(s).`, "ok");
}

/* =====================================================================
   6 · ENRIQUECIMIENTO · HLR/HSS (Claro, Tigo, ambos o ninguno)
   ---------------------------------------------------------------------
   Claro NO tiene servicio de lote: su QDN es una petición por línea. Por
   eso «en batch» aquí significa tandas controladas (pool de concurrencia),
   que es lo mismo que hacen el cruce y los validadores. Mil líneas salen
   en tandas, con progreso y sin tumbar el gateway.

   Por defecto va EN CASCADA (lo decide HLRConsulta): se pregunta a Tigo y
   solo si Tigo no la encuentra se pregunta a Claro. Es más rápido y manda
   menos peticiones, pero tiene un costo que hay que tener presente: una
   línea dada de alta en las DOS redes sale como «Tigo», porque a Claro
   nunca se le preguntó. Para detectar ese caso existe la casilla «Consultar
   en ambos HLR/HSS», que pasa `ambos: true`. Sin ella, «Ambos — revisar»
   no puede aparecer.
===================================================================== */
async function consultarHlr() {
    if (trabajando) { MEUI.toast("Espera a que termine la consulta en curso.", "warn"); return; }
    const lineas = lineasSeleccionadas();
    if (!lineas.length) { MEUI.toast("Marca al menos una línea.", "warn"); return; }
    if (lineas.length > CONFIG.maxSeleccion) {
        MEUI.toast(`Son ${lineas.length} líneas; el tope es ${CONFIG.maxSeleccion}. Marca menos o usa «Seleccionar primeros ${CONFIG.maxSeleccion.toLocaleString("es-CO")}».`, "err");
        return;
    }

    trabajando = true;
    cancelar = false;
    MEUI.$("#btnCancelar").classList.remove("d-none");
    lineas.forEach(l => aplicarACadaFila(l, { hlrPaso: PASO.CONSULTANDO }));
    render();

    const concurrencia = Math.max(1, Math.min(15,
        Number(MEUI.$("#cfgConcurrencia").value) || CONFIG.concurrenciaHlr));
    const chk = MEUI.$("#chkAmbos");
    const ambos = !!(chk && chk.checked);
    MEUI.log(`HLR/HSS: ${lineas.length} línea(s) en tandas de ${concurrencia}, `
        + (ambos
            ? "en ambos HLR/HSS (Claro y Tigo a la vez en cada línea)."
            : "en cascada (Tigo primero; Claro solo si Tigo no la encuentra)."), "info");

    try {
        await HLRConsulta.consultarVarias(lineas, {
            concurrencia,
            ambos,
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

    } finally {
        trabajando = false;
        progreso("");
        MEUI.$("#btnCancelar").classList.add("d-none");
        // Lo que quedó marcado como «consultando» es lo que se canceló o lo
        // que se quedó a medias por un error.
        filas.forEach(f => { if (f.hlrPaso === PASO.CONSULTANDO) f.hlrPaso = PASO.PENDIENTE; });
        render();
    }
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
const filtros = {
    operacion: "", resultado: "", canal: "", ubicacion: "", sel: "", texto: "",
    verOcultas: ""      // "1" = las ocultas también se ven (siguen sin exportarse ni consultarse)
};

const normaliza = s => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

function filaPasaFiltros(f) {
    if (f.oculta && !filtros.verOcultas) return false;
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

/* Filtrar 208.000 filas cuesta entre 7 y 54 ms (medido). Poco, pero la tabla
   pide datos en cada paginada y en cada orden, y repetirlo ahí no aporta
   nada: mientras no cambien ni los datos ni los filtros, el resultado es el
   mismo. Se invalida en `render()`, que es por donde pasa todo cambio. */
let _visibles = null;
let _ordenadas = null;      // las mismas, ya ordenadas; clave: "columna:sentido"
let _ordenClave = null;

function invalidarVistas() { _visibles = null; _ordenadas = null; _ordenClave = null; }

function visibles() {
    if (!_visibles) _visibles = filas.filter(filaPasaFiltros);
    return _visibles;
}

/** Lo que de verdad se puede operar de lo que pasa los filtros: sin las
    ocultas, aunque «Ver ocultas» las esté mostrando. Es la base de
    «Seleccionar todos», de la exportación y de los contadores. */
function filtradasActivas() {
    const v = visibles();
    return filtros.verOcultas ? v.filter(f => !f.oculta) : v;
}

/* Operador (Claro / Tigo / Ambos / Ninguno / No concluyente).
   Se filtra por la UBICACIÓN YA RESUELTA, no por las columnas Claro y Tigo:
   en cascada, la columna Claro dice «No consultado» cuando Tigo ya encontró
   la línea, y eso no es un operador. Las opciones son fijas y salen de
   HLRConsulta (una sola fuente de las etiquetas); se escriben UNA vez al
   arrancar, no en cada repintado, y se muestran todas aunque todavía no
   haya filas de ese tipo: así «Ambos» está a la vista como posibilidad. */
const OPERADORES = ["CLARO", "TIGO", "AMBOS", "NINGUNO", "NO_CONCLUYENTE", "CLARO_RESIDUO", "RESIDUO_TIGO"];

function llenarOperadores() {
    const s = MEUI.$("#fUbicacion");
    if (!s || s.options.length || typeof HLRConsulta === "undefined") return;
    const E = HLRConsulta.ETIQUETA_UBICACION;
    s.add(new Option("Operador: todos", ""));
    OPERADORES.forEach(k => { if (E[k]) s.add(new Option(E[k], E[k])); });
}

/* Opciones de los otros tres filtros: salen de los DATOS, así que se van
   sumando a medida que llegan.

   Reescribir un <select> en cada repintado destruía y recreaba sus
   <option>, también con el desplegable abierto o con el foco (que es lo que
   más se notaba). Ahora:
     · los valores se acumulan al CARGAR las filas (esos tres campos no
       cambian después), así que repintar no recorre 208.000 filas para
       recalcularlos;
     · si no hay valores nuevos, no se toca el DOM;
     · si los hay, se INSERTAN solo las <option> que faltan (la elegida y
       las demás se quedan donde estaban);
     · si el <select> tiene el foco, se espera a que lo suelte.
   Nunca se quitan opciones: al cargar otro rango, la que estaba elegida
   desaparecería del <select> mientras el filtro seguía activo con ese valor. */
const FILTROS_DATOS = [
    ["#fOperacion", "operacion", "Operación: todas"],
    ["#fResultado", "resultadoTexto", "Resultado: todos"],
    ["#fCanal", "canal", "Canal: todos"]
];
const _valoresFiltro = { operacion: new Set(), resultadoTexto: new Set(), canal: new Set() };
let _versionValores = 0;
let _versionEscrita = -1;

function registrarValoresFiltro(f) {
    Object.keys(_valoresFiltro).forEach(campo => {
        const v = f[campo], set = _valoresFiltro[campo];
        if (v != null && v !== "" && !set.has(v)) { set.add(v); _versionValores++; }
    });
}

/** @returns {boolean} true si el <select> quedó al día */
function sincronizarSelect(s, campo, vacio) {
    if (!s.options.length) s.add(new Option(vacio, ""));
    const presentes = new Set(Array.from(s.options, o => o.value));
    const faltan = [..._valoresFiltro[campo]].filter(v => !presentes.has(v)).sort();
    if (!faltan.length) return true;
    if (document.activeElement === s) return false;       // abierto o con foco: se espera
    faltan.forEach(v => {
        const despues = Array.from(s.options).find((o, i) => i > 0 && o.value > v);
        s.add(new Option(v, v), despues || null);
    });
    return true;
}

function refrescarOpcionesFiltros() {
    if (_versionEscrita === _versionValores) return;    // nada nuevo desde la última vez
    let alDia = true;
    FILTROS_DATOS.forEach(([sel, campo, vacio]) => {
        const s = MEUI.$(sel);
        if (s && !sincronizarSelect(s, campo, vacio)) alDia = false;
    });
    if (alDia) _versionEscrita = _versionValores;
}

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

/* Las columnas se declaran aparte porque ahora hacen DOS cosas: pintar, y
   decirle al ordenador por qué campo ordenar cuando el analista hace clic en
   una cabecera (la tabla manda el índice de la columna, no el nombre).

   Orden: casilla · Línea · Operación · Resultado · Fecha, que es lo primero
   que se mira en una llamada de «me bloquearon la SIM», y luego el resto. La
   última columna es el botón Ocultar/Mostrar de cada fila, igual que en
   «Estado de líneas» y «Cierre masivo de casos».

   `plano: true` = comparar el texto tal cual al ordenar. Las fechas son ISO
   y ya ordenan igual que el tiempo; `localeCompare` sobre 208.000 filas
   cuesta mucho más y no cambia el resultado. */
const COLUMNAS = [
    {
        // La casilla de la cabecera marca solo lo de la PÁGINA ACTUAL. Lleva
        // clase además del id porque DataTables clona la cabecera (scroll) y
        // el id queda repetido: los eventos se enganchan por clase.
        title: '<input type="checkbox" id="chkTodas" class="chk-todas" title="Marcar las filas de esta página">',
        data: null, orderable: false, width: "28px",
        render: f => `<input type="checkbox" class="chk-fila" data-id="${esc(f.__id)}"${f.sel ? " checked" : ""}>`
    },
    { title: "Línea", data: "linea", render: l => `<span class="me-mono">${esc(l)}</span>` },
    { title: "Operación", data: "operacion", render: v => badge(v, v === "Bloqueo" ? "err" : "ok") },
    { title: "Resultado", data: "resultadoTexto", render: (v, t, f) => badge(v, infoResultado(f.resultado).clase) },
    // `orderSequence` sin el estado «sin orden»: con DataTables 2 el tercer clic
    // quita el orden, y como lo más nuevo primero ya es el de respaldo, el
    // primer clic sobre «Fecha» (ya en descendente) parecería no hacer nada.
    { title: "Fecha", data: "fecha", plano: true, orderSequence: ["desc", "asc"], render: v => `<span class="me-mono">${esc(String(v).replace("T", " ").slice(0, 19))}</span>` },
    { title: "HLR/HSS", data: "hlrUbicacion", render: (v, t, f) => v ? badge(v, CLASE_UBICACION[v]) : celdaPaso(f.hlrPaso, f.hlrError) },
    { title: "Estado línea (CM)", data: "cmEstado", render: (v, t, f) => v ? badge(v, CLASE_ESTADO_CM[v]) : celdaPaso(f.cmPaso, f.cmError) },
    { title: "Claro", data: "hlrClaro", render: v => esc(v || "—") },
    { title: "Tigo", data: "hlrTigo", render: v => esc(v || "—") },
    { title: "Titular (CM)", data: "cmTitular", render: v => esc(v || "—") },
    { title: "Documento", data: "documento", render: v => `<span class="me-mono">${esc(v)}</span>` },
    { title: "Cuenta (BAN)", data: "cmCuenta", render: v => `<span class="me-mono">${esc(v || "—")}</span>` },
    { title: "Canal", data: "canal", render: v => esc(v || "—") },
    { title: "Usuario", data: "usuario", render: v => esc(v || "—") },
    { title: "Descripción", data: "descripcion", render: v => `<span class="desc" title="${esc(v)}">${esc(v)}</span>` },
    { title: "ID", data: "id", render: v => `<span class="me-mono">${esc(v)}</span>` },
    {
        title: "", data: null, orderable: false,
        render: f => `<button class="btn btn-sm btn-me-line btn-ocultar" data-id="${esc(f.__id)}" type="button">${f.oculta ? "Mostrar" : "Ocultar"}</button>`
    }
];

/* Lo más nuevo primero. Se declara en DataTables Y se usa como respaldo en
   `ordenadas`: si la tabla llegara a pedir datos sin orden, no debe caer en
   el orden de Genesis (ascendente por id: lo más viejo arriba). */
const COL_FECHA = COLUMNAS.findIndex(c => c.data === "fecha");
const ORDEN_INICIAL = { column: COL_FECHA, dir: "desc" };

/* =====================================================================
   9b · DE DÓNDE SACA LA TABLA SUS FILAS
   ---------------------------------------------------------------------
   DataTables va en modo `serverSide`, pero el «servidor» es este arreglo
   en memoria. La diferencia con dárselo entero no es de estilo, está
   medida en este mismo navegador:

     208.249 filas dentro de DataTables   un repintado cuesta 2.979 ms
                                          y el heap sube a ~242 MB
     208.249 filas en un arreglo plano    48 MB · filtrar 7 ms ·
                                          ordenar 26 ms · sacar 50 filas 0 ms

   Es decir: los datos no pesan; pesaba metérselos a la tabla. Así la tabla
   solo tiene nunca más de una página —las 50 filas que se ven— y filtrar,
   ordenar y paginar lo hacemos nosotros sobre el arreglo.
===================================================================== */
let _ordenVista = ORDEN_INICIAL;   // el orden con que se pidió la última página
let _pagina = [];                  // las filas que se están viendo (la página actual)
let _firmaVista = null;            // qué página/orden/filtros se dibujaron por última vez

function ordenadas(orden) {
    const o = (orden && COLUMNAS[orden.column] && COLUMNAS[orden.column].data) ? orden : ORDEN_INICIAL;
    const col = COLUMNAS[o.column];
    const campo = col.data;
    const clave = `${campo}:${o.dir}`;
    if (_ordenadas && _ordenClave === clave) return _ordenadas;

    const signo = o.dir === "desc" ? -1 : 1;
    const comparar = col.plano
        ? (x, y) => (x < y ? -1 : x > y ? 1 : 0)
        : (x, y) => typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x == null ? "" : x).localeCompare(String(y == null ? "" : y), "es");
    // Se ordena una COPIA: `visibles()` se reusa para las tarjetas y la
    // exportación, y no debe quedar reordenado por detrás. El `id` desempata
    // para que dos filas con el mismo valor no cambien de lugar entre
    // repintados (con 208.000 filas, muchas comparten fecha al segundo).
    _ordenadas = visibles().slice().sort((a, b) =>
        (comparar(a[campo], b[campo]) || (Number(a.id) - Number(b.id))) * signo);
    _ordenClave = clave;
    return _ordenadas;
}

/** Lo que DataTables llama «ajax»: aquí no sale ninguna petición. */
function fuenteDatos(peticion, responder) {
    // La tabla trae su propio buscador; se suma al de la barra de filtros en
    // vez de competir con él (los dos acotan, no se pisan).
    const suyo = (peticion.search && peticion.search.value || "").trim();
    const previo = filtros.texto;
    if (suyo) filtros.texto = previo ? previo + " " + suyo : suyo;
    if (suyo) invalidarVistas();

    const orden = (peticion.order && peticion.order[0]) || null;
    const lista = ordenadas(orden);
    const desde = peticion.start || 0;
    const cuantas = peticion.length > 0 ? peticion.length : lista.length;

    if (suyo) { filtros.texto = previo; invalidarVistas(); }

    _ordenVista = orden && COLUMNAS[orden.column] && COLUMNAS[orden.column].data ? orden : ORDEN_INICIAL;
    _pagina = lista.slice(desde, desde + cuantas);
    // Si la firma no cambia entre dos dibujados, el repintado es de DATOS
    // (llegó una tanda, terminó una consulta): ahí se conserva el scroll.
    // Si cambia (otra página, otro orden, otro filtro), arrancar arriba es lo
    // esperado.
    _firmaVista = [desde, cuantas, _ordenVista.column, _ordenVista.dir, suyo, JSON.stringify(filtros)].join("|");

    responder({
        draw: peticion.draw,
        recordsTotal: filas.length,
        recordsFiltered: lista.length,
        data: _pagina
    });
}

function construirTabla() {
    tabla = new DataTable("#tablaTitularidad", MEUI.opcionesTabla({
        serverSide: true,
        ajax: fuenteDatos,
        processing: true,        // «Procesando…» de la propia tabla
        orderClasses: false,
        pageLength: 50,
        lengthMenu: [25, 50, 100, 250],
        order: [[COL_FECHA, "desc"]],
        columns: COLUMNAS,
        createdRow: (tr, f) => { tr.classList.toggle("fila-oculta", !!f.oculta); }
    }));
    if (MEUI.registrarTabla) MEUI.registrarTabla(tabla);

    const t = document.querySelector("#tablaTitularidad");

    // Marcar/desmarcar y Ocultar/Mostrar: delegados, porque DataTables
    // redibuja las filas.
    t.addEventListener("change", ev => {
        const c = ev.target.closest(".chk-fila");
        if (!c) return;
        const f = filas.find(x => String(x.__id) === c.dataset.id);
        if (f) { f.sel = c.checked; actualizarResumenSeleccion(); }
    });
    t.addEventListener("click", ev => {
        const b = ev.target.closest(".btn-ocultar");
        if (b) alternarOculta(b.dataset.id);
    });

    // La casilla de la cabecera vive en otra tabla (la de la cabecera fija de
    // DataTables), así que el evento se engancha al documento.
    document.addEventListener("change", ev => {
        const c = ev.target;
        if (!c.classList || !c.classList.contains("chk-todas")) return;
        if (!c.closest("#tablaTitularidad, #tablaTitularidad_wrapper")) return;
        marcarPagina(c.checked);
    });
}

/* ---------------------------------------------------------------------
   Selección. La casilla de la cabecera marca SOLO lo que se ve en la página
   actual (lo que uno espera de una casilla en la cabecera). Marcar lo demás
   son dos acciones aparte, con su cuenta a la vista:
     · «Seleccionar todos (N)»       → todo lo que pasa los filtros;
     · «Seleccionar primeros 2.000»  → las primeras filas en el orden en que
       se ven, hasta el tope de consultas.
   Antes la casilla marcaba todo lo filtrado, y con 208.000 filas eso era un
   clic de más al pasar por la cabecera.
--------------------------------------------------------------------- */

/** Refleja `sel` en las casillas que ya están pintadas, sin redibujar. */
function sincronizarMarcasEnPagina() {
    const porId = new Map(_pagina.map(f => [String(f.__id), f]));
    document.querySelectorAll("#tablaTitularidad .chk-fila").forEach(c => {
        const f = porId.get(c.dataset.id);
        if (f && c.checked !== !!f.sel) c.checked = !!f.sel;
    });
}

/** Estado de la casilla de la cabecera: marcada si lo están todas las filas
    de la página, a medias si lo están algunas. */
function sincronizarCabecera() {
    const aptas = _pagina.filter(f => !f.oculta);
    const todas = aptas.length > 0 && aptas.every(f => f.sel);
    const alguna = aptas.some(f => f.sel);
    document.querySelectorAll("#tablaTitularidad .chk-todas, #tablaTitularidad_wrapper .chk-todas").forEach(c => {
        if (c.checked !== todas) c.checked = todas;
        const medio = !todas && alguna;
        if (c.indeterminate !== medio) c.indeterminate = medio;
    });
}

/** Tras cambiar marcas: si hay un filtro por marcadas, la lista cambia y hay
    que redibujar; si no, basta con ajustar las casillas y los contadores. */
function aplicarSeleccion() {
    if (filtros.sel) { render(); return; }
    sincronizarMarcasEnPagina();
    actualizarResumenSeleccion();
}

/** La casilla de la cabecera: solo la página que se ve. */
function marcarPagina(valor) {
    _pagina.forEach(f => { if (!f.oculta) f.sel = !!valor; });
    aplicarSeleccion();
}

/** «Seleccionar todos (N)»: todo lo que pasa los filtros, sin las ocultas.
    Suma a lo ya marcado fuera del filtro. */
function seleccionarTodos() {
    const lista = filtradasActivas();
    lista.forEach(f => { f.sel = true; });
    aplicarSeleccion();
    return lista.length;
}

/** «Seleccionar primeros N»: las primeras filas filtradas, en el orden en que
    se ven. REEMPLAZA la selección anterior: el sentido es «justo estas», y
    sumarlas a otras marcas podía pasarse del tope otra vez. */
function seleccionarPrimeros(n) {
    const tope = n > 0 ? n : CONFIG.maxSeleccion;
    filas.forEach(f => { f.sel = false; });
    let marcadas = 0;
    const lista = ordenadas(_ordenVista);
    for (let i = 0; i < lista.length && marcadas < tope; i++) {
        if (lista[i].oculta) continue;
        lista[i].sel = true; marcadas++;
    }
    aplicarSeleccion();
    return marcadas;
}

function desmarcarTodo() {
    filas.forEach(f => { f.sel = false; });
    aplicarSeleccion();
}

/* ---------------------------------------------------------------------
   Ocultar / Mostrar (mismo lenguaje que cm-lineas.js tablaSeleccionable)
   ---------------------------------------------------------------------
   Una fila oculta sale de la vista, de la exportación y de las consultas.
   Con «Ver ocultas» se ve (atenuada y tachada) pero sigue sin exportarse
   ni consultarse: ocultar es «esto no me interesa», no «escóndelo un rato».
--------------------------------------------------------------------- */
function recontarOcultas() {
    let n = 0;
    for (let i = 0; i < filas.length; i++) if (filas[i].oculta) n++;
    nOcultas = n;
}

function alternarOculta(id) {
    const f = filas.find(x => String(x.__id) === String(id));
    if (!f) return;
    f.oculta = !f.oculta;
    recontarOcultas();
    render();
}

function ocultarMarcadas() {
    visibles().forEach(f => { if (f.sel) f.oculta = true; });
    recontarOcultas();
    render();
}

function ocultarNoMarcadas() {
    visibles().forEach(f => { if (!f.sel) f.oculta = true; });
    recontarOcultas();
    render();
}

function mostrarTodas() {
    filas.forEach(f => { f.oculta = false; });
    nOcultas = 0;
    render();
}

function actualizarResumenSeleccion() {
    let n = 0;
    const lineas = new Set();
    for (let i = 0; i < filas.length; i++) {
        const f = filas[i];
        if (f.sel && !f.oculta) { n++; if (f.linea) lineas.add(f.linea); }
    }
    const l = lineas.size;
    const tope = CONFIG.maxSeleccion;
    ponerTexto(MEUI.$("#resumenSeleccion"), n
        ? `${n.toLocaleString("es-CO")} fila(s) · ${l.toLocaleString("es-CO")} línea(s) única(s)`
            + (l > tope ? ` · pasa el tope de ${tope.toLocaleString("es-CO")} para consultar` : "")
        : "Nada marcado");
    ["btnConsultarCm", "btnConsultarHlr"].forEach(id => {
        const b = MEUI.$("#" + id);
        // Un botón con spinner (MEUI.ocupado) se queda deshabilitado hasta
        // que termine. Sin esto, el repintado de mitad de tanda lo volvía a
        // habilitar y se podía lanzar una segunda consulta encima.
        if (b && !b.dataset.meOcupado) b.disabled = n === 0;
    });

    // Las dos acciones de selección llevan la cuenta de lo que van a marcar.
    const hay = filtradasActivas().length;
    const todos = MEUI.$("#btnSelTodos"), primeros = MEUI.$("#btnSelPrimeros");
    ponerTexto(todos, `Seleccionar todos (${hay.toLocaleString("es-CO")})`);
    ponerTexto(primeros, `Seleccionar primeros ${tope.toLocaleString("es-CO")}`);
    if (todos) todos.disabled = hay === 0;
    if (primeros) primeros.disabled = hay === 0;

    ponerTexto(MEUI.$("#numOcultas"), String(nOcultas));
    sincronizarCabecera();
}

/* ---------------------------------------------------------------------
   Repintado
   ---------------------------------------------------------------------
   `render()` se llama en cada tanda que llega y en cada consulta que
   termina. Antes hacía TRES recálculos de layout por llamada:
     1. `mostrarSiHayDatos`, que programa DOS temporizadores que ejecutan
        `columns.adjust()` + `ajustarTablas()` (alto del panel y ancho de
        todas las columnas);
     2. `ajustarTablas()` otra vez al final;
     3. reescribir el `innerHTML` de cuatro <select>.
   Ahora, en régimen normal, no hace ninguno de los tres:
     · `mostrarSiHayDatos` solo cuando la tabla pasa de vacía a con datos
       (o al revés), que es cuando cambia lo que hay que mostrar u ocultar;
     · las opciones de los filtros solo se tocan si llegó un valor nuevo;
     · `ajustarTablas` no se llama: el alto del panel y los anchos no
       dependen de cuántas filas llegaron, y la tabla ya se re-mide cuando
       aparece (lo hace `mostrarSiHayDatos`), al cambiar el tamaño de la
       ventana y al abrir o cerrar un paso (lo hace me-ui).
   Además conserva el scroll del cuerpo de la tabla entre dibujados.
--------------------------------------------------------------------- */
let _hayDatos = null;      // null = todavía no se ha decidido nunca
let _ultimoResumen = null;

function cuerpoScroll() {
    const t = document.querySelector("#tablaTitularidad");
    return t ? t.closest(".dt-scroll-body") : null;
}

/** Dibuja la página actual conservando el scroll del cuerpo de la tabla.

    Es un seguro, no la causa demostrada: medido en Chromium con DataTables
    2.3.2 real, el scroll del cuerpo sobrevivía a un `draw(false)` incluso
    antes de este cambio (ver doc/titularidad/README.md), así que lo de
    «salta al principio» que reporta el analista puede venir de otro lado
    (la página, el panel lateral, o que Edge/CSS reales se comporten
    distinto). Esto cubre el caso en que DataTables o el navegador SÍ lo
    reinicien al reemplazar las filas: se lee antes y se devuelve después,
    solo si lo que se dibujó es la misma vista (misma página, orden y
    filtros). Si cambió la vista, arrancar arriba es lo esperado. */
function dibujar() {
    const cuerpo = cuerpoScroll();
    const arriba = cuerpo ? cuerpo.scrollTop : 0;
    const izq = cuerpo ? cuerpo.scrollLeft : 0;
    const firmaAntes = _firmaVista;
    tabla.draw(false);
    if (cuerpo && _firmaVista === firmaAntes && (arriba || izq)) {
        cuerpo.scrollTop = arriba;
        cuerpo.scrollLeft = izq;
    }
}

/** `mostrarSiHayDatos` juzga por las filas que tiene la tabla EN PANTALLA, y
    con `serverSide` eso es la página: un filtro sin coincidencias la dejaría
    en cero y la ocultaría junto con el buscador, sin forma de deshacerlo
    (ya lo dice su propia regla: «solo se oculta cuando NO hay datos
    cargados»). Aquí «hay datos» es que haya filas cargadas. */
function tablaParaMostrar() {
    return { rows: () => ({ count: () => filas.length }), columns: tabla.columns };
}

function render() {
    // Todo cambio de datos o de filtros pasa por aquí, así que es el punto
    // donde las vistas memorizadas dejan de valer.
    invalidarVistas();
    if (!tabla) construirTabla();
    // `draw` le pide los datos a `fuenteDatos`: no se le entrega el arreglo.
    dibujar();
    actualizarKpis();
    actualizarResumenSeleccion();
    refrescarOpcionesFiltros();

    const hay = filas.length > 0;
    if (hay !== _hayDatos) {
        _hayDatos = hay;
        MEUI.mostrarSiHayDatos("#tablaTitularidad", { vacio: "#msgVacio", tabla: tablaParaMostrar() });
    }

    const resumen = filas.length
        ? `${filas.length.toLocaleString("es-CO")} registros` + (etiquetaCarga ? ` · ${etiquetaCarga}` : "")
        : "";
    if (resumen !== _ultimoResumen) { _ultimoResumen = resumen; MEUI.resumenPaso(2, resumen); }
}

/* =====================================================================
   10 · TARJETAS
===================================================================== */
const UBIC_NO_CONCLUYENTE = "No concluyente";

/* La tarjeta «HLR a revisar» contaba «Ambos — revisar» + «No concluyente».
   Con la cascada, «Ambos» ya no puede aparecer salvo que se marque «Consultar
   en ambos»: la tarjeta prometía algo que casi nunca iba a mostrar. Decisión:
   se renombra «HLR no concluyente» y cuenta SOLO eso, que es lo único que es
   verdad en los dos modos y lo que de verdad pide acción (las dos redes
   fallaron: hay que volver a consultar). «Ambos — revisar» sigue encontrándose
   con el filtro de operador, que lo lista siempre. Los residuos en Tigo
   («escalar») tampoco se sumaron: no estaban antes y nadie lo pidió. */
function actualizarKpis() {
    const v = visibles();
    const lineas = new Set();
    let bloqueos = 0, noConcluyente = 0;
    // Una sola pasada: antes eran cuatro filtros y un Set sobre 208.000 filas.
    for (let i = 0; i < v.length; i++) {
        const f = v[i];
        if (f.linea) lineas.add(f.linea);
        if (f.operacion === "Bloqueo") bloqueos++;
        if (f.hlrUbicacion === UBIC_NO_CONCLUYENTE) noConcluyente++;
    }
    const set = (id, n) => ponerTexto(MEUI.$("#" + id), n.toLocaleString("es-CO"));
    set("kpiTotal", v.length);
    set("kpiLineas", lineas.size);
    set("kpiBloqueos", bloqueos);
    set("kpiRevisar", noConcluyente);
}

/* =====================================================================
   11 · EXPORTACIÓN
   Lo que se exporta es lo que se ve: mismos filtros, mismo orden. Con una
   excepción deliberada: las filas ocultas NUNCA salen, ni siquiera cuando
   «Ver ocultas» las está mostrando.
===================================================================== */
/* Las columnas de la exportación NO siguen el orden nuevo de la tabla: quien
   ya procesa estos archivos (macros, tablas dinámicas) cuenta con las
   posiciones de hoy. Lo que sí cambia es el orden de las FILAS: ahora sale
   como se ve en la tabla, de más nuevo a más viejo. */
const CABECERA = ["Línea", "HLR/HSS", "Claro", "Tigo", "IMSI",
    "Estado línea (CM)", "Titular (CM)", "Cuenta (BAN)", "SIM (CM)", "Documento (Genesis)",
    "Operación", "Resultado", "Descripción", "Fecha", "Canal", "Usuario", "ID Genesis"];

const filaExport = f => [f.linea, f.hlrUbicacion || "", f.hlrClaro || "", f.hlrTigo || "", f.hlrImsi || "",
    f.cmEstado || "", f.cmTitular || "", f.cmCuenta || "", f.cmSim || "", f.documento,
    f.operacion, f.resultadoTexto, f.descripcion,
    String(f.fecha).replace("T", " ").slice(0, 19), f.canal, f.usuario, f.id];

/** Lo que se exporta: lo filtrado, sin ocultas, en el orden de la tabla. */
function exportables() {
    return ordenadas(_ordenVista).filter(f => !f.oculta);
}

function filasExport() { return { head: CABECERA, rows: exportables().map(filaExport) }; }
function filasParaExportar() { return exportables(); }

/* =====================================================================
   12 · DETALLE DE UNA FILA
   El SOAP crudo no se guarda en memoria (ver genesis-api.js): se vuelve a
   pedir cuando alguien abre la fila.

   `GENESIS.detalleDe` calcula la página como ceil(id / tamaño), lo que solo
   vale con orden ascendente, ids correlativos y un servidor que conceda el
   tamaño pedido. Genesis ordena DESC y concede 100 aunque se pidan 500, así
   que esa cuenta cae en otra página y casi nunca encuentra el registro
   (medido con un servidor simulado que respeta el orden). Aquí se busca
   dentro del DÍA de la fila: es el filtro confirmado, deja unos cientos de
   registros (pocas páginas) y no depende del orden ni del tamaño concedido.
===================================================================== */
async function buscarEnSuDia(f, tamPedido) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f.fecha || ""));
    if (!m || typeof GENESIS.pedirPagina !== "function") return null;
    const filtro = {
        filter: "FechaHoraTransaccion",
        filterValue: GENESIS.fechaGenesis({ y: +m[1], m: +m[2], d: +m[3] }),
        valor: null, valor2: null
    };
    const MAX_PAGINAS = 40;            // un día con más de ~4.000 registros no es normal: no insistir
    let paginas = 1;
    for (let n = 1; n <= paginas && n <= MAX_PAGINAS; n++) {
        const p = await GENESIS.pedirPagina(n, tamPedido, filtro);
        const hit = p.items.find(x => String(x.id) === String(f.id));
        if (hit) return hit;
        if (n === 1) {
            // Se recorre con el tamaño que CONCEDE el servidor, no con el pedido.
            const eco = Number(p.paginacion && p.paginacion.pageSize) || p.items.length;
            const tam = p.items.length ? Math.min(eco, p.items.length) : tamPedido;
            const total = Number(p.paginacion && p.paginacion.count) || p.items.length;
            paginas = Math.max(1, Math.ceil(total / Math.max(1, tam)));
        }
        if (!p.items.length) break;
    }
    return null;
}

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
        const tam = Number(MEUI.$("#cfgPagina").value) || CONFIG.paginaGenesis;
        // Primero dentro de SU día; si no aparece, el método general de GENESIS.
        const d = (await buscarEnSuDia(f, tam)) || await GENESIS.detalleDe(f.id, tam);
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

/** Limpia los filtros. NO muestra de nuevo las filas ocultas: eso es
    «Mostrar todas»; ocultar es una decisión del analista, no un filtro. */
function limpiarFiltros() {
    Object.keys(filtros).forEach(k => { filtros[k] = ""; });
    render();
}

/* =====================================================================
   14 · ARRANQUE
===================================================================== */
function inicializarTitularidad() {
    // Por defecto, el mes en curso: del día 1 al último día.
    const mes = rangoMesEnCurso(new Date());
    const d = MEUI.$("#fDesde"), h = MEUI.$("#fHasta");
    if (d && !d.value) d.value = mes.desde;
    if (h && !h.value) h.value = mes.hasta;
    actualizarAvisoRango();
    // El botón por defecto dice cuántos trae, con el tope de GENESIS.CONFIG.
    const b = MEUI.$("#btnCargar");
    if (b) b.textContent = `Cargar los últimos ${topeUltimos().toLocaleString("es-CO")}`;
    llenarOperadores();
    render();   // deja la tabla montada y el mensaje de «sin datos» a la vista
}
inicializarTitularidad();
