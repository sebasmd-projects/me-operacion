/* =====================================================================
   titularidad.js · Bloqueos de SIM por titularidad
   ---------------------------------------------------------------------
   Para qué existe: las llamadas al call por «me bloquearon la SIM» salen,
   en su mayoría, del proceso de comprobación de titularidad. Genesis deja
   el log de ese proceso (quién, qué línea, cómo terminó), pero no dice en
   qué red está la línea, y sin eso el asesor no puede resolver en la
   llamada. Esta herramienta junta las tres cosas en una tabla:

     1. Genesis   · el bloqueo/desbloqueo y cómo terminó  (los más nuevos, o un rango)
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

   Orden del archivo:
     1 · Configuración (CONFIG)
     2 a 14 · Reglas de negocio y pintado: modelo de fila, estado, carga
              desde Genesis, enriquecimiento CM y HLR/HSS, filtros, tabla,
              tarjetas, exportación y detalle
     15 · Interfaz: sesiones, botones y eventos, enganchados con MEUI
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
    maxSeleccion: 500,

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

/** Escribe un texto solo si cambió. Asignar `textContent` con el mismo valor
    igual invalida el layout: en un repintado que ocurre cada pocos segundos
    durante minutos, esos «mismos valores» eran casi todas las escrituras. */
function ponerTexto(el, texto) {
    if (el && el.textContent !== texto) el.textContent = texto;
}

/* =====================================================================
   4 · CARGA DESDE GENESIS
===================================================================== */
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
        const dias = `${f(r.dias)} día${r.dias === 1 ? "" : "s"}`;
        return {
            ok: true, desde: r.desde, hasta: r.hasta, dias: r.dias, tramos: k, largo: r.largo,
            texto: r.largo ? `⚠ ${dias} · ${f(k)} tramos: va a tardar` : dias
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

/** Qué decir mientras carga, en la barra del pie (MEUI.progreso). Con rango,
    `total` CRECE (solo suma los tramos ya consultados), así que «X de Y» sería
    una cuenta que se mueve: se usa `paso` (tramo i de n) y se dice cuántos
    registros llegan. Con tope, el objetivo es el menor de (tope, lo que
    Genesis dice que hay): «249 de 500» sería mentira si en total hay 249. */
const NOMBRE_TRAMO = { dia: "día", mes: "mes", anio: "año" };

function objetivoTope(p) { return Math.min(p.tope, p.total || p.tope); }

let _totalCarga = -1;       // el total con que se inició la barra; si cambia, se reinicia

function progresoCarga(p) {
    const f = n => n.toLocaleString("es-CO");
    if (p.tramo != null) {
        _totalCarga = -1;
        MEUI.progreso.paso(p.tramo, p.tramos,
            `${NOMBRE_TRAMO[p.granularidad] || "tramo"} ${p.etiqueta} · ${f(p.leidos)} registros`);
        return;
    }
    const total = p.tope ? objetivoTope(p) : (p.total || 0);
    const etiqueta = p.tope ? "registros más nuevos" : "registros";
    if (total !== _totalCarga) { _totalCarga = total; MEUI.progreso.iniciar(total, etiqueta); }
    MEUI.progreso.avanzar(p.leidos, etiqueta);
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
            ? { texto: `Viendo los ${f(cargadas)} más nuevos de ${f(r.total)}.`, tope: true }
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
const topeUltimos = () => Number(GENESIS.CONFIG.topeRegistros) || 500;

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
    _totalCarga = -1;
    let falloCarga = false;
    // Cómo termina la barra del pie: se decide en el try/catch y se cierra una sola vez, en el finally.
    let finCarga = { ok: false, mensaje: "Carga fallida" };
    MEUI.estadoTabla("#tablaTitularidad", "cargando", { mensaje: "Cargando el log de Genesis…" });

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

            alProgresar: progresoCarga
        }, rango || {}, tope ? { tope } : {}));

        // Solo si la carga terminó: una carga cancelada sin filas no es «no hay registros».
        if (!filas.length) textoVacio(!r.completo ? null : modo === "rango"
            ? `Genesis no devolvió registros entre <strong>${esc(rango.desde)}</strong> y <strong>${esc(rango.hasta)}</strong>. Prueba con otro rango.`
            : "Genesis no devolvió registros.");
        render();   // el pintado final, ya con todo

        const seg = ((performance.now() - t0) / 1000).toFixed(1);
        finCarga = {
            ok: r.completo,
            mensaje: r.completo ? `Genesis: ${filas.length.toLocaleString("es-CO")} registros` : "Carga cancelada"
        };
        const fin = resumenCarga(r, filas.length, seg);
        MEUI.log(fin.texto, fin.nivel);
        if (filas.length) { const n = notaDeCarga(r, filas.length, modo); ponerNotaCarga(n.texto, n.tope); }
        if (!r.completo) MEUI.toast("Carga cancelada; se conserva lo que alcanzó a llegar.", "warn");
    } catch (e) {
        MEUI.log("✖ No se pudo cargar Genesis: " + e.message, "err");
        MEUI.toast("Falló la carga de Genesis. Mira el registro.", "err");
        if (!filas.length) textoVacio(null);
        falloCarga = true;
        MEUI.estadoTabla("#tablaTitularidad", "error", {
            mensaje: "No se pudo cargar Genesis: " + e.message,
            reintentar: () => cargarGenesis(opciones)
        });
    } finally {
        cargando = false; cancelar = false;
        if (!falloCarga) MEUI.estadoTabla("#tablaTitularidad", "listo");
        MEUI.progreso.fin(finCarga);
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

async function consultarCm(reintento) {
    if (trabajando) { MEUI.toast("Espera a que termine la consulta en curso.", "warn"); return; }
    // `reintento` (un arreglo de líneas) viene de «Reintentar fallidas»: solo esas.
    const lineas = Array.isArray(reintento) ? reintento : lineasSeleccionadas();
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
    MEUI.progreso.iniciar(lineas.length, "líneas en el CM");
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
            MEUI.progreso.avanzar(hechas);
            if (hechas % 10 === 0 || hechas === lineas.length) render();
        });

    } finally {
        // Pase lo que pase, la herramienta queda utilizable: un flag que se
        // quedara en true dejaría los botones muertos hasta recargar.
        trabajando = false;
        MEUI.$("#btnCancelar").classList.add("d-none");
        filas.forEach(f => { if (f.cmPaso === PASO.CONSULTANDO) f.cmPaso = PASO.PENDIENTE; });
        // Las que fallaron se pueden reconsultar solas, con la misma función que consulta una fila.
        const falladas = lineas.filter(l => (porLinea.get(l) || []).some(f => f.cmPaso === PASO.ERROR));
        MEUI.progreso.fin({
            ok: !cancelar && !falladas.length, fallidas: falladas.length,
            reintentar: () => consultarCm(falladas),
            mensaje: cancelar ? "Consulta cancelada" : undefined
        });
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
async function consultarHlr(reintento) {
    if (trabajando) { MEUI.toast("Espera a que termine la consulta en curso.", "warn"); return; }
    // `reintento` (un arreglo de líneas) viene de «Reintentar fallidas»: solo esas.
    const lineas = Array.isArray(reintento) ? reintento : lineasSeleccionadas();
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
    const falladas = new Set();     // las que salieron «No concluyente»
    MEUI.progreso.iniciar(lineas.length, "líneas en HLR/HSS");
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
                if (r.ubicacion === "NO_CONCLUYENTE") falladas.add(r.msisdn);
                MEUI.progreso.avanzar(hechas);
                if (hechas % 10 === 0 || hechas === total) render();
            }
        });

    } finally {
        trabajando = false;
        MEUI.$("#btnCancelar").classList.add("d-none");
        MEUI.progreso.fin({
            ok: !cancelar && !falladas.size, fallidas: falladas.size,
            reintentar: () => consultarHlr(Array.from(falladas)),
            mensaje: cancelar ? "Consulta cancelada" : undefined
        });
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
/* Cada filtro de la barra es un MEUI.filtroMulti: guarda un Set de valores
   (vacío = sin filtro). `texto` NO es un filtro de la barra: solo lo pone
   `fuenteDatos` con el «Buscar» de la tabla mientras arma una página. */
const filtros = {
    operacion: new Set(), resultado: new Set(), canal: new Set(), ubicacion: new Set(), sel: new Set(),
    texto: "",
    verOcultas: ""      // "1" = las ocultas también se ven (siguen sin exportarse ni consultarse)
};

/** Los filtros en una cadena, para la firma de la vista (un Set no sale en JSON). */
const firmaFiltros = () => JSON.stringify(Object.keys(filtros).map(k =>
    filtros[k] instanceof Set ? Array.from(filtros[k]).sort() : filtros[k]));

const normaliza = s => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function filaPasaFiltros(f) {
    if (f.oculta && !filtros.verOcultas) return false;
    if (filtros.operacion.size && !filtros.operacion.has(f.operacion)) return false;
    if (filtros.resultado.size && !filtros.resultado.has(f.resultadoTexto)) return false;
    if (filtros.canal.size && !filtros.canal.has(f.canal)) return false;
    if (filtros.ubicacion.size && !filtros.ubicacion.has(f.hlrUbicacion || "—")) return false;
    // «Solo marcadas» y «Solo sin marcar» a la vez es lo mismo que ninguna.
    if (filtros.sel.size === 1 && filtros.sel.has("marcadas") !== !!f.sel) return false;
    if (filtros.texto) {
        const q = normaliza(filtros.texto);
        const heno = normaliza([f.linea, f.documento, f.descripcion, f.cmTitular,
            f.cmCuenta, f.usuario, f.hlrImsi, f.canal, f.cmEstado, f.hlrUbicacion,
            f.operacion, f.resultadoTexto, f.id].join(" "));
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
   HLRConsulta (una sola fuente de las etiquetas); se muestran todas aunque
   todavía no haya filas de ese tipo: así «Ambos» está a la vista como
   posibilidad. */
const OPERADORES = ["CLARO", "TIGO", "AMBOS", "NINGUNO", "NO_CONCLUYENTE", "CLARO_RESIDUO", "RESIDUO_TIGO"];

/* Los filtros de la barra son MEUI.filtroMulti. Un filtroMulti no admite
   valores nuevos una vez creado, así que los que salen de los DATOS
   (operación, resultado, canal) se vuelven a crear cuando llega un valor
   que no estaba, conservando lo elegido. El control viejo se marca como
   muerto para que su `alCambiar` no repinte. */
const _controles = {};       // campo -> { ctl, valores, vivo }
let _suspendido = false;     // mientras se limpian todos a la vez: un solo repintado al final

function crearFiltro(campo, contenedor, titulo, valores) {
    const cont = MEUI.$(contenedor);
    if (!cont) return;
    const previo = _controles[campo];
    const seleccion = Array.from(previo ? previo.ctl.seleccion() : filtros[campo]);
    if (previo) { previo.vivo = false; previo.ctl.destruir(); }
    const reg = { vivo: true, valores };
    reg.ctl = MEUI.filtroMulti(cont, {
        titulo,
        valores: valores.map(v => (typeof v === "string" ? { valor: v } : v)),
        seleccion,
        alCambiar: set => {
            if (!reg.vivo || _suspendido) return;
            filtros[campo] = set;
            render();
        }
    });
    _controles[campo] = reg;
}

/* Operador y Marcadas: opciones fijas, se crean una sola vez al arrancar. */
function crearFiltrosFijos() {
    if (typeof HLRConsulta !== "undefined") {
        const E = HLRConsulta.ETIQUETA_UBICACION;
        crearFiltro("ubicacion", "#fUbicacion", "Operador", OPERADORES.filter(k => E[k]).map(k => E[k]));
    }
    crearFiltro("sel", "#fSel", "Marcadas", [
        { valor: "marcadas", texto: "Solo marcadas" },
        { valor: "sin-marcar", texto: "Solo sin marcar" }
    ]);
}

/* Operación, Resultado y Canal: salen de los DATOS, así que se van sumando
   a medida que llegan.

     · los valores se acumulan al CARGAR las filas (esos tres campos no
       cambian después), así que repintar no recorre 208.000 filas para
       recalcularlos;
     · si no hay valores nuevos, no se toca el DOM;
     · si el desplegable está abierto, se espera a que se cierre.
   Nunca se quitan valores: al cargar otro rango, el que estaba elegido
   desaparecería mientras el filtro seguía activo con él. */
const FILTROS_DATOS = [
    ["#fOperacion", "operacion", "operacion", "Operación"],
    ["#fResultado", "resultado", "resultadoTexto", "Resultado"],
    ["#fCanal", "canal", "canal", "Canal"]
];
// Operación y resultado arrancan con sus valores conocidos: se ven antes de cargar nada.
const _valoresFiltro = {
    operacion: new Set(Object.values(OPERACION)),
    resultadoTexto: new Set(Object.values(RESULTADO).map(r => r.texto)),
    canal: new Set()
};
let _versionValores = 1;
let _versionEscrita = -1;

function registrarValoresFiltro(f) {
    Object.keys(_valoresFiltro).forEach(campo => {
        const v = f[campo], set = _valoresFiltro[campo];
        if (v != null && v !== "" && !set.has(v)) { set.add(v); _versionValores++; }
    });
}

function refrescarOpcionesFiltros() {
    if (_versionEscrita === _versionValores) return;    // nada nuevo desde la última vez
    let alDia = true;
    FILTROS_DATOS.forEach(([cont, campo, campoFila, titulo]) => {
        const valores = Array.from(_valoresFiltro[campoFila]).sort();
        const reg = _controles[campo];
        if (reg && reg.valores.length === valores.length) return;
        if (reg && reg.ctl.el.querySelector(".dropdown-menu.show")) { alDia = false; return; }
        crearFiltro(campo, cont, titulo, valores);
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

   Orden: casilla · Acciones (Ocultar/Mostrar de cada fila, igual que en
   «Bloquear/Inactivar líneas» y «Cierre masivo de casos») · Línea · Operación
   · Resultado · Fecha · HLR/HSS · Estado CM · IMSI · ID, que es lo primero que
   se mira en una llamada de «me bloquearon la SIM». El resto queda oculto y
   se activa desde «Columnas».

   `plano: true` = comparar el texto tal cual al ordenar. Las fechas son ISO
   y ya ordenan igual que el tiempo; `localeCompare` sobre 208.000 filas
   cuesta mucho más y no cambia el resultado. */
const COLUMNAS = [
    {
        // La casilla de la cabecera marca solo lo de la PÁGINA ACTUAL. Lleva
        // clase además del id porque DataTables clona la cabecera (scroll) y
        // el id queda repetido: los eventos se enganchan por clase.
        title: '<input type="checkbox" id="chkTodas" class="chk-todas" title="Marcar las filas de esta página" aria-label="Marcar las filas de esta página">',
        nombre: "Selección",
        data: null, orderable: false, width: "28px",
        render: f => `<input type="checkbox" class="chk-fila" data-id="${esc(f.__id)}" aria-label="Marcar la fila"${f.sel ? " checked" : ""}>`
    },
    {
        title: "Acciones", data: null, orderable: false,
        render: f => `<button class="btn btn-sm btn-me-line btn-ocultar" data-id="${esc(f.__id)}" type="button">${f.oculta ? "Mostrar" : "Ocultar"}</button>`
    },
    { title: "Línea", data: "linea", render: l => MEUI.copiable(l, "línea") },
    { title: "Operación", data: "operacion", render: v => badge(v, v === "Bloqueo" ? "err" : "ok") },
    { title: "Resultado", data: "resultadoTexto", render: (v, t, f) => badge(v, infoResultado(f.resultado).clase) },
    // `orderSequence` sin el estado «sin orden»: con DataTables 2 el tercer clic
    // quita el orden, y como lo más nuevo primero ya es el de respaldo, el
    // primer clic sobre «Fecha» (ya en descendente) parecería no hacer nada.
    { title: "Fecha", data: "fecha", plano: true, orderSequence: ["desc", "asc"], render: v => `<span class="me-mono">${esc(String(v).replace("T", " ").slice(0, 19))}</span>` },
    { title: "HLR/HSS", data: "hlrUbicacion", render: (v, t, f) => v ? badge(v, CLASE_UBICACION[v]) : celdaPaso(f.hlrPaso, f.hlrError) },
    { title: "Estado CM", data: "cmEstado", render: (v, t, f) => v ? badge(v, CLASE_ESTADO_CM[v]) : celdaPaso(f.cmPaso, f.cmError) },
    { title: "IMSI", data: "hlrImsi", render: v => MEUI.copiable(v, "IMSI") },
    { title: "ID", data: "id", render: v => `<span class="me-mono">${esc(v)}</span>` },
    // A partir de aquí, ocultas por defecto: se activan desde el menú «Columnas».
    // La exportación las lleva todas igual (ver CABECERA).
    { title: "Claro", data: "hlrClaro", visible: false, render: v => esc(v || "—") },
    { title: "Tigo", data: "hlrTigo", visible: false, render: v => esc(v || "—") },
    { title: "Titular (CM)", data: "cmTitular", visible: false, render: v => esc(v || "—") },
    { title: "Documento", data: "documento", visible: false, render: v => MEUI.copiable(v, "identificación") },
    { title: "Cuenta (BAN)", data: "cmCuenta", visible: false, render: v => MEUI.copiable(v, "identificación") },
    { title: "Canal", data: "canal", visible: false, render: v => esc(v || "—") },
    { title: "Usuario", data: "usuario", visible: false, render: v => esc(v || "—") },
    { title: "Descripción", data: "descripcion", visible: false, render: v => `<span class="desc" title="${esc(v)}">${esc(v)}</span>` }
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
    // El «Buscar» de la tabla es el único buscador de texto: se aplica como
    // `filtros.texto` mientras se arma esta página.
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
    _firmaVista = [desde, cuantas, _ordenVista.column, _ordenVista.dir, suyo, firmaFiltros()].join("|");

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
    pintarMenuColumnas();

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

/** El menú «Columnas»: una casilla por columna (menos la de marcar). Las que
    no están en la vista por defecto se activan aquí; la exportación lleva
    todas igual. */
function pintarMenuColumnas() {
    const cont = MEUI.$("#menuColumnas");
    if (!cont) return;
    cont.innerHTML = COLUMNAS.map((c, i) => i === 0 ? "" :
        `<li><div class="form-check"><input class="form-check-input chk-col" type="checkbox"`
        + `${c.visible === false ? "" : " checked"} id="col${i}" data-col="${i}">`
        + `<label class="form-check-label small" for="col${i}">${esc(String(c.title).replace(/<[^>]*>/g, ""))}</label></div></li>`
    ).join("");
    cont.addEventListener("change", ev => {
        const chk = ev.target.closest(".chk-col");
        if (!chk) return;
        tabla.column(Number(chk.dataset.col)).visible(chk.checked);
        MEUI.ajustarTablas();
    });
}

/* ---------------------------------------------------------------------
   Selección. La casilla de la cabecera marca SOLO lo que se ve en la página
   actual (lo que uno espera de una casilla en la cabecera). Marcar lo demás
   son dos acciones aparte, con su cuenta a la vista:
     · «Seleccionar todos (N)»       → todo lo que pasa los filtros;
     · «Seleccionar primeros 500»    → las primeras filas en el orden en que
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
    // «N marcadas» lo escribe MEUI.lote; aquí va lo que no dice: las líneas únicas y el tope.
    MEUI.lote("#barraLote", n);
    ponerTexto(MEUI.$("#resumenSeleccion"), n
        ? `${l.toLocaleString("es-CO")} línea(s) única(s)`
            + (l > tope ? ` · pasa el tope de ${tope.toLocaleString("es-CO")} para consultar` : "")
        : "");
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
     · el aviso de «sin datos» solo cuando la tabla pasa de vacía a con datos
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
        // La tabla y los filtros se quedan siempre a la vista; sin datos solo se
        // ve, debajo, la línea de «Inicia sesión…».
        const vacio = MEUI.$("#msgVacio");
        if (vacio) vacio.style.display = hay ? "none" : "";
        setTimeout(() => MEUI.ajustarTablas(), 30);
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

   Se le pasa la FECHA de la fila, y eso no es opcional: con ella
   `GENESIS.detalleDe` acota la búsqueda al día del registro (pocas páginas,
   resultado exacto); sin ella tiene que adivinar la página a partir del id,
   que con el orden DESC y los huecos de ids falla casi siempre.
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
          <dt>Documento (Genesis)</dt><dd>${MEUI.copiable(f.documento, "documento")}</dd>
          <dt>Canal · Usuario</dt><dd>${esc(f.canal || "—")} · ${esc(f.usuario || "—")}</dd>
          <dt>HLR/HSS</dt><dd>${esc(f.hlrUbicacion || "sin consultar")}</dd>
          <dt>Estado en el CM</dt><dd>${esc(f.cmEstado || "sin consultar")}</dd>
        </dl>`;
    const mi = ++_detalleSeq;
    _payloads = null;
    mostrarEstadoDetalle("Pidiendo el detalle a Genesis…");
    new bootstrap.Modal("#modalDetalle").show();
    try {
        const tam = Number(MEUI.$("#cfgPagina").value) || CONFIG.paginaGenesis;
        const d = await GENESIS.detalleDe(f.id, { fecha: f.fecha, tam });
        if (mi !== _detalleSeq) return;         // se abrió otra fila mientras esta cargaba
        if (d) mostrarPayloads(d);
        else mostrarEstadoDetalle("Genesis ya no devuelve ese registro en la página esperada.");
    } catch (e) {
        if (mi !== _detalleSeq) return;
        mostrarEstadoDetalle("No se pudo traer el detalle: " + e.message);
    }
}

/* ---------------------------------------------------------------------
   Petición y respuesta del detalle: dos bloques, cada uno con su vista
   «Formateado» (sangrado y con la sintaxis pintada) o «Crudo» (tal como
   llegó). El formateo es de MEUI.formatearPayload y el HTML con colores, de
   MEUI.htmlPayload, que escapa todo lo que viene del servidor; aquí solo se
   decide qué vista se ve. Se guarda únicamente el detalle abierto (el crudo
   de miles de filas no cabe en memoria, ver genesis-api.js).
--------------------------------------------------------------------- */
let _payloads = null;       // { req|res: { crudo, fmt: {tipo, texto}, vista } } del detalle abierto
let _detalleSeq = 0;        // descarta la respuesta de una fila que ya no es la abierta

function mostrarEstadoDetalle(texto) {
    MEUI.$("#mdEstado").textContent = texto;
    MEUI.$("#mdPayloads").hidden = true;
}

function mostrarPayloads(d) {
    const nuevo = txt => {
        const crudo = txt === null || txt === undefined ? "" : String(txt);
        return { crudo, fmt: MEUI.formatearPayload(crudo), vista: "fmt" };
    };
    _payloads = { req: nuevo(d.request), res: nuevo(d.response) };
    MEUI.$("#mdEstado").textContent = "";
    MEUI.$("#mdPayloads").hidden = false;
    pintarPayload("req");
    pintarPayload("res");
}

function pintarPayload(clave) {
    const p = _payloads && _payloads[clave];
    const bloque = MEUI.$(`#mdPayloads [data-payload="${clave}"]`);
    if (!p || !bloque) return;
    const pre = MEUI.$("pre", bloque);
    const formateable = p.fmt.tipo !== "texto";
    const formateado = formateable && p.vista === "fmt";
    /* innerHTML SOLO con lo que devuelve MEUI.htmlPayload (cada trozo va por
       esc). El crudo y el texto plano van con textContent. */
    if (formateado) pre.innerHTML = MEUI.htmlPayload(p.fmt);
    else pre.textContent = p.crudo;
    MEUI.$("[data-payload-tipo]", bloque).textContent = p.crudo.trim() ? p.fmt.tipo.toUpperCase() : "";
    MEUI.$("[data-payload-conm]", bloque).hidden = !formateable;
    MEUI.$$("[data-vista]", bloque).forEach(b => {
        const activo = b.dataset.vista === (formateado ? "fmt" : "crudo");
        b.classList.toggle("active", activo);
        b.setAttribute("aria-pressed", String(activo));
    });
    MEUI.$("[data-payload-copiar]", bloque).disabled = !p.crudo.trim();
}

function cambiarVistaPayload(clave, vista) {
    const p = _payloads && _payloads[clave];
    if (!p || (vista !== "fmt" && vista !== "crudo")) return;
    p.vista = vista;
    pintarPayload(clave);
}

/* =====================================================================
   13 · ACCIONES QUE DISPARA LA INTERFAZ
===================================================================== */

/** Corta la carga de Genesis o una tanda de consultas, entre elementos.
    No aborta la petición en vuelo: deja terminar la que ya salió y no
    manda más. Lo que ya llegó se conserva. */
function cancelarTrabajo() { cancelar = true; }

function fijarFiltro(campo, valor) {
    if (!(campo in filtros) || filtros[campo] instanceof Set) return;
    filtros[campo] = valor || "";
    render();
}

/** Limpia los filtros. NO muestra de nuevo las filas ocultas: eso es
    «Mostrar todas»; ocultar es una decisión del analista, no un filtro. */
function limpiarFiltros() {
    _suspendido = true;
    try { MEUI.limpiarFiltros(); } finally { _suspendido = false; }
    Object.keys(filtros).forEach(k => { filtros[k] = filtros[k] instanceof Set ? new Set() : ""; });
    // También el «Buscar» de la tabla.
    if (tabla) tabla.search("");
    const buscar = document.querySelector("#tablaTitularidad_wrapper .dt-search input");
    if (buscar) buscar.value = "";
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
    crearFiltrosFijos();
    refrescarOpcionesFiltros();
    // Un desplegable que se quedó sin reconstruir por estar abierto, al cerrarse.
    const barra = MEUI.$("#barraFiltros");
    if (barra) barra.addEventListener("hidden.bs.dropdown", refrescarOpcionesFiltros);
    render();   // deja la tabla montada y el mensaje de «sin datos» a la vista
}
inicializarTitularidad();

/* =====================================================================
   15 · INTERFAZ · enganche con el shell común (MEUI)
   ---------------------------------------------------------------------
   Conecta las reglas de arriba con los botones y eventos de la página.
   Esta herramienta tiene DOS sesiones a la vez (Genesis y CM), así que
   los eventos del chip de sesión hay que mirarlos por `detail.clave`: en
   las demás herramientas basta con disparar el único botón de login que
   hay, aquí eso iniciaría la sesión equivocada.
===================================================================== */
(function interfaz() {
    "use strict";

    const el = id => document.getElementById(id);

    /* --- 15.0 · ¿Cargaron los accesos compartidos? --------------------- */
    const piezas = [
        ["me-api.js", () => window.MEAPI],
        ["genesis-api.js", () => window.GENESIS],
        ["hlr-consulta.js", () => window.HLRConsulta],
        ["cm-lineas.js", () => window.CMLineas]
    ];
    const faltan = piezas.filter(([, hay]) => !hay()).map(([n]) => n);
    if (faltan.length) {
        MEUI.log("La herramienta no arrancó. Diagnóstico:", "err");
        faltan.forEach(n => MEUI.log(`· Falta <script src="assets/${n}"></script> antes de la herramienta.`, "err"));
        MEUI.toast("La herramienta no cargó. Mira el registro.", "err");
        return;
    }

    /* --- 15.1 · Sesión de Genesis ---------------------------------------- */
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

    /* Pegar y listo: si lo que cae en el campo ya es un token válido, no hace
       falta pulsar nada más. El operador viene de copiar en otra pestaña; que
       encima tenga que acertarle a un botón es un paso de más. Si el token no
       vale, NO se grita: se deja el botón para que lo intente y lea el error. */
    el("gToken").addEventListener("paste", () => setTimeout(() => {
        if ((el("gToken").value || "").trim().length > 40) usarToken();
    }, 0));

    /* El favorito. El <a> tiene que llevar la URL `javascript:` de verdad para
       que arrastrarlo a la barra cree el favorito; por eso se pone aquí y no en
       el HTML, donde habría que escapar la mitad del código. */
    (function montarFavorito() {
        const a = el("bmGenesis"), copiar = el("btnCopiarBm");
        if (!a || !window.GENESIS_BOOKMARKLET) return;
        const uri = GENESIS_BOOKMARKLET.uri();
        a.href = uri;
        /* Pulsarlo AQUÍ no sirve de nada (esta página no es Genesis) y encima
           navegaría fuera. Se intercepta y se explica. */
        a.addEventListener("click", ev => {
            ev.preventDefault();
            MEUI.toast("Arrástralo a la barra de favoritos; luego púlsalo en la pestaña de Genesis.", "warn");
        });
        /* copiarTexto resuelve si pudo y RECHAZA si no (no devuelve un
           booleano): de ahí el try/catch y no un `if`. */
        if (copiar) copiar.addEventListener("click", async () => {
            try {
                await MEUI.copiarTexto(uri);
                MEUI.toast("Código copiado. Crea un favorito y pégalo en el campo de la dirección.", "ok");
            } catch (e) {
                MEUI.log("✖ No se pudo copiar el favorito: " + e.message
                    + " · el código está en assets/compartido/genesis-bookmarklet.js", "err");
                MEUI.toast("No se pudo copiar. Mira el registro.", "err");
            }
        });
    })();

    /* --- 15.2 · Sesión del CM (misma mecánica que las demás herramientas) - */
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

    /* --- 15.3 · Eventos del chip, cada uno a SU sesión -------------------- */
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

    /* --- 15.4 · Credenciales del CM compartidas con las otras pestañas ---- */
    const c = MEUI.cred.get("cm");
    if (c && el("user")) {
        if (!el("user").value) el("user").value = c.usuario || "";
        if (!el("pass").value) el("pass").value = c.clave || "";
    }
    if (el("user").value && el("pass").value && !MEAPI.auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        entrarCm(true);
    }

    /* --- 15.5 · Carga y acciones sobre lo marcado ------------------------- */
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

    /* --- 15.6 · Filtros --------------------------------------------------- */
    // Operación, Resultado, Operador, Canal y Marcadas son MEUI.filtroMulti y
    // los crea la lógica; el único buscador de texto es el «Buscar» de la tabla.
    el("btnLimpiarFiltros").addEventListener("click", () => {
        el("chkVerOcultas").checked = false;
        limpiarFiltros();
    });

    /* --- 15.7 · Detalle al hacer clic en una fila ------------------------- */
    document.querySelector("#tablaTitularidad").addEventListener("click", ev => {
        if (ev.target.closest("input, button, a")) return;   // marcar no es abrir
        const tr = ev.target.closest("tbody tr");
        if (!tr) return;
        const chk = tr.querySelector(".chk-fila");
        if (chk) verDetalle(chk.dataset.id);
    });

    /* Conmutador Formateado | Crudo de cada bloque del detalle. Delegado en el
       contenedor: los botones no se recrean, pero así no hay que cablear dos
       veces lo mismo. «Copiar» no necesita nada aquí: es el .btn-copy común
       de me-ui.js, y copia lo que el bloque muestra en ese momento. */
    el("mdPayloads").addEventListener("click", ev => {
        const b = ev.target.closest("[data-vista]");
        const bloque = b && b.closest("[data-payload]");
        if (bloque) cambiarVistaPayload(bloque.dataset.payload, b.dataset.vista);
    });

    /* --- 15.8 · Exportación ---------------------------------------------- */
    const base = "titularidad";
    el("btnCSV").addEventListener("click", () => {
        const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base);
    });
    el("btnXLSX").addEventListener("click", () => {
        const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "Titularidad");
    });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- 15.9 · Registro -------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        MEUI.copiarTexto(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista. Inicia sesión en Genesis para cargar los datos.", "ok");
})();
