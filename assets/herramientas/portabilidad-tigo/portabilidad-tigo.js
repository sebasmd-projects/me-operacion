/* =====================================================================
   portabilidad-tigo.js · Validador de portabilidad HLR/HSS Tigo
   ---------------------------------------------------------------------
   Valida por MSISDN si la línea quedó CREADA en el HLR de Tigo tras un
   proceso de portabilidad, consultando el mismo endpoint que usaba
   CheckPortabilidad.html (autogestión HLR), pero con:

     · concurrencia real controlada (no secuencial),
     · reintentos SOLO por timeout,
     · parseo del volcado de texto `perfilHLR` (comando HLR tipo USCDB)
       en secciones + pares CAMPO=VALOR, para un detalle categorizado,
     · tabla, KPIs, filtros y exportación con el mismo shell (me-ui.js).

   Autenticación: header fijo `X-Api-Key` (no hay OAuth como en QDN/CM).

   IMPORTANTE — sobre la interpretación de bloqueos/restricciones:
   El formato de `perfilHLR` es un volcado de un comando propietario del
   HLR (Huawei/ZTE) sin documentación pública. Solo se dispone de UNA
   respuesta real exitosa de referencia, así que la detección de
   bloqueos (sección 2.3 de este archivo) es una HEURÍSTICA best-effort:
   se muestra siempre el valor crudo junto a la interpretación, y el
   detalle completo (todas las secciones) queda disponible sin filtrar.

   Contenido:
     1 · Configuración y constantes (ambiente, catálogos, columnas, cabeceras)
     2 · Reglas de negocio (estado en el CM, parseo del perfil HLR,
         bloqueos, consulta con reintentos, concurrencia, entrada)
     3 · Interfaz (tabla, filtros, KPIs, detalle, exportación, archivo y
         enganche con el shell común me-ui: sesión del CM, registro)

   Va SIEMPRE al final del <body>, después de me-ui.js y me-api.js.
===================================================================== */
(function () {
    "use strict";

    /* =================================================================
       1 · CONFIGURACIÓN Y CONSTANTES
    ================================================================= */

    /* ---------------------------------------------------------------------
       1.1 · AMBIENTE Y ENDPOINT
    --------------------------------------------------------------------- */
    const AMBIENTE_TIGO = {
        // El gateway se llama "qa", pero detrás hay UN SOLO HLR/HSS: la
        // respuesta es de PRODUCCIÓN. No existe un HLR de pruebas.
        etiqueta: "Gateway QA · HLR/HSS de producción",
        base_url: "https://tulioqa.grupo-exito.com/apimew/api/v1/autogestion/HLR/consulta",
        api_key: "5tVBWu5xdItBcC/4x9ohCBoEQTZ+PCiTpinT1hT+1eeiOCmq7dr+CZgZprcklYN4FJmPJBHoE1C6gkEYA2pqfA=="
    };

    const cfgTigo = Object.assign({}, AMBIENTE_TIGO, {
        timeoutMs: 30000,
        reintentos: 2,
        concurrencia: 8
    });

    /* ---------------------------------------------------------------------
       1.2 · CATÁLOGOS: estados del CM, RETCODE, bloqueos y desvíos
    --------------------------------------------------------------------- */
    const ESTADOS_CM = { 1: "Activa", 2: "Desactivada", 3: "Disponible", 4: "Bloqueada" };

    const RETCODES = {
        // El proceso avanza en cadena: 1033 -> (Tigo depura) -> 3001 -> (se crea
        // el perfil) -> 0.
        //
        // 0     -> ya tiene perfil en el HLR: portación completada.
        // 3001  -> "Subscriber not defined": la línea NO tiene perfil en el HLR.
        //          Por sí solo NO prueba que el número sea de Móvil Éxito; hay
        //          que cruzarlo con el estado en ME (Optiva):
        //            · activa en ME pero sin perfil -> se consulta Claro antes de escalar;
        //            · inactiva en ME -> sin perfil es lo esperado;
        //            · el número no es de Móvil Éxito (puede ser un Port Out).
        // 1033  -> "Number threshold exceeded": la línea era de Tigo y se portó a
        //          Móvil Éxito, pero Tigo no la eliminó de su HLR/HSS. Ese
        //          residuo bloquea la creación: se escala a Tigo y, una vez
        //          depurado, la consulta pasa a responder 3001.
        "0": { estado: "CREADA", etiqueta: "Creada" },
        "3001": { estado: "SIN_PERFIL", etiqueta: "Sin perfil (pendiente de creación)" },
        "1033": { estado: "RESIDUO_TIGO", etiqueta: "Residuo en Tigo (escalar a Tigo)" }
    };

    const CAMPOS_LOCK_BOOL = ["GPRSLOCK", "EPSLOCK", "NON3GPPLOCK", "CSUPLLCK", "PSUPLLCK"];

    const TIPOS_DESVIO = ["CFU", "CFB", "CFNRY", "CFNRC", "CFD"];

    /* ---------------------------------------------------------------------
       1.3 · TABLA Y EXPORTACIÓN: columnas, etiquetas y cabeceras
    --------------------------------------------------------------------- */
    const ETIQUETA_COLUMNA = {
        msisdn: "MSISDN", estado: "Estado", estadoCm: "Estado ME", claro: "HLR Claro", conclusion: "Conclusión", retcode: "RETCODE", imsi: "IMSI", imei: "IMEI",
        card: "Tipo SIM", bloqueos: "Bloqueos", roaming: "Roaming", desvios: "Desvíos", detalle: "Acciones"
    };
    const columnas = Object.keys(ETIQUETA_COLUMNA);
    /* Las columnas salen de ETIQUETA_COLUMNA (un solo lugar): el orden de las claves es el de la tabla. */

    const ETIQUETA_ESTADO = {
        CREADA: "Creada", SIN_PERFIL: "Sin perfil (pendiente)", RESIDUO_TIGO: "Residuo en Tigo",
        INCONSISTENTE: "Revisar respuesta",
        ERROR_RETCODE: "Error (RETCODE)", ERROR: "Error", TIMEOUT: "Timeout",
        INVALID: "Inválida", EN_COLA: "En cola", PROCESSING: "Consultando"
    };

    const PROCESOS_FALLIDOS = ["ERROR", "ERROR_RETCODE", "TIMEOUT", "INVALID"];

    const CABECERA_EXPORT = ["MSISDN", "Estado", "Estado ME", "HLR Claro", "Conclusión", "RETCODE", "Mensaje", "IMSI", "IMEI", "Tipo SIM",
        "Restricciones", "Roaming", "Desvíos", "Transaction ID", "Fecha/hora", "Observaciones"];

    /* =================================================================
       2 · REGLAS DE NEGOCIO
    ================================================================= */

    /* ---------------------------------------------------------------------
       2.1 · ESTADO DE LA LÍNEA EN EL CM (Optiva) — el diferencial frente a
       consultar el HLR de Tigo a secas: el RETCODE 3001 ("sin perfil") no
       prueba por sí solo que el número sea de Móvil Éxito (ver doc §2.1);
       hay que cruzarlo con el estado en el CM. Mismo servicio y mismo
       criterio de "cuenta activa más reciente" que usan Prepagadas/Consumos
       (ver la lógica de Consumos).

       Es OPCIONAL a propósito: sin sesión del CM, auth.token es null y esta
       función no intenta nada — la herramienta sigue funcionando igual,
       solo que la columna "Estado ME" queda vacía. No se fuerza el login.
    --------------------------------------------------------------------- */
    const auth = MEAPI.auth;
    const getJson = MEAPI.getJson;

    /**
     * Estado de una línea en el CM. Devuelve:
     *   null                              -> sin sesión del CM (no se consultó)
     *   { pertenece: false }              -> el CM no tiene esa línea
     *   { pertenece: true, estado: "..." } -> estado de la cuenta más reciente
     *   { pertenece: null, error: "..." }  -> la consulta falló (se avisa y sigue)
     */
    async function estadoCM(msisdn) {
        if (!auth.token) return null;
        try {
            const data = await getJson(`${MEAPI.CONFIG.apiBase}/api/v1/subscribers`, { msisdnList: msisdn, offset: 0, limit: 10 });
            const lista = data?.subscriberResponseList || [];
            if (!lista.length) return { pertenece: false };

            // Varias cuentas (BAN) -> la activa más reciente; si ninguna está
            // activa, la última creada. Mismo criterio que Prepagadas/Consumos.
            const porFecha = (a, b) => Number(b?.profile?.created || 0) - Number(a?.profile?.created || 0);
            const activos = lista.filter(s => s?.status?.state === 1).sort(porFecha);
            const sub = activos[0] || lista.slice().sort(porFecha)[0];
            const codigo = sub?.status?.state;
            return { pertenece: true, estado: ESTADOS_CM[codigo] || (codigo != null ? `Estado ${codigo}` : null) };
        } catch (e) {
            MEUI.log(`⚠ CM ${msisdn}: no se pudo consultar el estado (${e.message})`, "warn");
            return { pertenece: null, error: e.message };
        }
    }

    /** Claro solo aporta evidencia adicional cuando falta el perfil en Tigo
     *  y el CM confirma que la línea sigue activa en ME. */
    function necesitaClaro(f) {
        return f.retcode === "3001" && f.cm && f.cm.pertenece === true && f.cm.estado === "Activa";
    }

    function textoEstadoClaro(f) {
        return f.claro ? (HLRConsulta.ETIQUETA_CLARO[f.claro.estado] || f.claro.estado) : "No consultado";
    }

    function conclusionClaro(f) {
        if (!necesitaClaro(f)) return "";
        if (!f.claro) return "Consulta a Claro pendiente.";
        if (f.claro.estado === "ACTIVA") return "Sigue en Claro: la portabilidad no se completó.";
        if (f.claro.estado === "INACTIVA") return "Claro no la reporta activa: activa en ME y sin perfil en Tigo; escalar a Optiva.";
        return "No se pudo confirmar el estado en Claro: reintentar la consulta antes de concluir.";
    }

    /* ---------------------------------------------------------------------
       2.2 · PARSEO DE perfilHLR (comando HLR: secciones "..." + CAMPO = VALOR)
    --------------------------------------------------------------------- */
    function parsearPerfilHLR(texto) {
        const secciones = [];
        let actual = { nombre: "Identidad", items: [] };
        secciones.push(actual);
        let retcode = null, retmsg = "";

        String(texto || "").split(/\r?\n/).forEach(cruda => {
            const l = cruda.trim();
            if (!l) return;

            const mSec = l.match(/^"(.+)"$/);
            if (mSec) { actual = { nombre: mSec[1], items: [] }; secciones.push(actual); return; }

            // Líneas de cabecera/eco del comando USCDB: se descartan.
            if (/^\+\+\+/.test(l) || /^PGW\b/.test(l) || /^%%/.test(l) || /^---/.test(l)
                || /^There is together/i.test(l)) return;

            const mRet = l.match(/^RETCODE\s*=\s*(\d+)\s*(.*)$/i);
            if (mRet) { retcode = mRet[1]; retmsg = mRet[2] || ""; return; }

            const mKV = l.match(/^(\S+)\s*=\s*(.*)$/);
            if (mKV) actual.items.push({ clave: mKV[1], valor: mKV[2] });
            else actual.items.push({ texto: l });
        });

        return { secciones: secciones.filter(s => s.items.length), retcode, retmsg };
    }

    function buscarSeccion(secciones, nombre) {
        return secciones.find(s => s.nombre.toLowerCase() === nombre.toLowerCase()) || null;
    }
    function valorClave(seccion, clave) {
        if (!seccion) return null;
        const it = seccion.items.find(i => i.clave === clave);
        return it ? it.valor : null;
    }

    /* ---------------------------------------------------------------------
       2.3 · BLOQUEOS / RESTRICCIONES (heurística — ver nota al inicio del archivo)
    --------------------------------------------------------------------- */
    function calcularBloqueos(secciones) {
        const activos = [];
        const lock = buscarSeccion(secciones, "LOCK");
        if (lock) {
            ["IC", "OC"].forEach(k => {
                const v = valorClave(lock, k);
                if (v === "TRUE") activos.push({ etiqueta: "Bloqueo " + (k === "IC" ? "llamadas entrantes" : "llamadas salientes"), origen: "LOCK." + k, valor: v });
            });
            CAMPOS_LOCK_BOOL.forEach(k => {
                const v = valorClave(lock, k);
                if (v === "TRUE") activos.push({ etiqueta: k, origen: "LOCK." + k, valor: v });
            });
        }
        const sablock = buscarSeccion(secciones, "SABLOCK");
        if (sablock) {
            ["IC", "OC"].forEach(k => {
                const v = valorClave(sablock, k);
                if (v === "TRUE") activos.push({ etiqueta: "SABLOCK " + k, origen: "SABLOCK." + k, valor: v });
            });
        }
        // Campos ODB (Operator Determined Barring) que sí mapean a categorías
        // estándar de barring (3GPP TS 23.015): SS, PB1-4, OC/IC, ROAM, RCF, ECT,
        // POS. Otros campos "ODB*" del volcado (ODBENTE, ODBINFO, ODBPOSTYPE,
        // ODBENTEROAM, ODBINFOROAM, ODBDECT, ODBMECT) NO tienen un mapeo de
        // barring confiable sin documentación del fabricante — se dejan FUERA
        // del resumen a propósito para no marcar falsos positivos; siguen
        // visibles en la sección "ODB Data" del detalle crudo.
        const CAMPOS_ODB_BARRING = ["ODBSS", "ODBOC", "ODBIC", "ODBPB1", "ODBPB2", "ODBPB3", "ODBPB4",
            "ODBROAM", "ODBRCF", "ODBECT", "ODBPOS"];
        const odb = buscarSeccion(secciones, "ODB Data");
        if (odb) {
            odb.items.forEach(it => {
                if (!it.clave || CAMPOS_ODB_BARRING.indexOf(it.clave) < 0) return;
                const v = String(it.valor || "").toUpperCase();
                const sinRestriccion = v === "FALSE" || v.indexOf("NOB") === 0;
                if (!sinRestriccion) activos.push({ etiqueta: it.clave, origen: "ODB Data." + it.clave, valor: it.valor });
            });
        }
        return activos;
    }


    function desviosConfigurados(textoOriginal) {
        return TIPOS_DESVIO.filter(t => new RegExp(`\\b${t}\\s*=\\s*PROV\\b`).test(textoOriginal || ""));
    }

    /* ---------------------------------------------------------------------
       2.4 · CONSULTA (fetch, timeout, reintentos SOLO por timeout)
    --------------------------------------------------------------------- */
    async function consultarUnaVez(linea, cfg) {
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
        const t0 = performance.now();
        try {
            const r = await fetch(cfg.base_url, {
                method: "POST", signal: controlador.signal,
                headers: { "Content-Type": "application/json", "X-Api-Key": cfg.api_key },
                body: JSON.stringify({
                    TransactionID: String(Date.now()) + Math.floor(Math.random() * 1000),
                    FechaConsulta: new Date().toISOString(),
                    Linea: linea
                })
            });
            const ms = Math.round(performance.now() - t0);
            const texto = await r.text();
            let cuerpo = null;
            try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
            return { ok: r.ok, status: r.status, cuerpo, texto, ms };
        } finally {
            clearTimeout(temporizador);
        }
    }

    function procesarRespuestaTigo(msisdn, cuerpo, meta) {
        const perfil = cuerpo.perfilHLR || "";
        const errores = Array.isArray(cuerpo.error) ? cuerpo.error : [];
        const textoOrigen = perfil || errores[0] || "";
        const { secciones, retcode, retmsg } = parsearPerfilHLR(textoOrigen);

        const catalogo = RETCODES[retcode] || null;
        let estadoProceso = catalogo ? catalogo.estado : (retcode ? "ERROR_RETCODE" : "ERROR");

        const identidad = buscarSeccion(secciones, "Identidad");

        /* ---- coherencia: la respuesta debe hablar de la línea consultada -----
           Sin esta validación un servicio que devuelva siempre el mismo perfil
           (o un stub de QA) haría que TODAS las líneas salgan como "Creada".
           Se compara el ISDN del perfil contra el MSISDN que se pidió. */
        const inconsistencias = [];
        const isdnPerfil = String(valorClave(identidad, "ISDN") || "").replace(/\D/g, "");
        const pedido = lineaTigo(msisdn).replace(/\D/g, "");
        if (isdnPerfil && isdnPerfil !== pedido) {
            inconsistencias.push(`El HLR respondió con el perfil de ${isdnPerfil}, no de ${pedido}.`);
        }
        if (retcode === "0" && !perfil.trim()) {
            inconsistencias.push("RETCODE 0 pero la respuesta no trae perfil HLR.");
        }
        if (retcode === "0" && perfil.trim() && !isdnPerfil) {
            inconsistencias.push("El perfil no trae ISDN: no se puede confirmar a qué línea corresponde.");
        }
        if (errores.length && perfil.trim()) {
            inconsistencias.push("La respuesta trae perfil y además errores: " +
                String(errores[0]).replace(/\s+/g, " ").slice(0, 160));
        }
        if (inconsistencias.length) estadoProceso = "INCONSISTENTE";
        const bloqueosActivos = perfil ? calcularBloqueos(secciones) : [];
        const roamOdb = buscarSeccion(secciones, "ODB Data");
        const roamValor = valorClave(roamOdb, "ODBROAM");
        const desvios = perfil ? desviosConfigurados(perfil) : [];

        return {
            msisdn, linea: cuerpo.linea || msisdn,
            estadoProceso, inconsistencias,
            retcode, retmsg,
            transaccionId: cuerpo.transaccionID, fechaHora: cuerpo.fechaHora,
            intentos: meta.intentos, ms: meta.ms, httpStatus: meta.httpStatus,
            resumen: {
                imsi: valorClave(identidad, "IMSI") || "—",
                imei: valorClave(identidad, "IMEI") || "—",
                isdn: valorClave(identidad, "ISDN") || "—",
                hlrsn: valorClave(identidad, "HLRSN") || "—",
                cardType: valorClave(identidad, "CardType") || "—",
                roaming: roamValor ? (roamValor.toUpperCase() === "NOBAR" ? "Sin restricción" : roamValor) : "—",
                // "PROV" = provisionado/configurado en el perfil, no necesariamente
                // desviando llamadas ahora mismo (para eso hay que leer STATUS en
                // el detalle de "SS Data": PROV | REG | ACT).
                desvios: desvios.length ? "Provisionados: " + desvios.join(", ") : (perfil ? "Ninguno" : "—")
            },
            bloqueosActivos,
            secciones,
            raw: cuerpo
        };
    }

    function filaError(msisdn, estadoProceso, detalle, meta) {
        return {
            msisdn, estadoProceso, detalle: detalle || "",
            intentos: (meta && meta.intentos) || 0, ms: (meta && meta.ms) || null,
            httpStatus: meta && meta.httpStatus,
            resumen: {}, bloqueosActivos: [], secciones: [],
            raw: (meta && meta.raw) || null
        };
    }

    /** Arma el valor `Linea` tal como lo espera Tigo (con indicativo 57). */
    function lineaTigo(msisdn) {
        return msisdn.indexOf("57") === 0 ? msisdn : "57" + msisdn;
    }

    async function consultarConReintentos(msisdn, cfg) {
        let intentos = 0;
        const linea = lineaTigo(msisdn);

        while (true) {
            intentos++;
            let resp;
            try {
                resp = await consultarUnaVez(linea, cfg);
            } catch (e) {
                const esTimeout = e && e.name === "AbortError";
                if (esTimeout && intentos < cfg.reintentos + 1) continue;
                if (esTimeout) return filaError(msisdn, "TIMEOUT", "Se agotaron los reintentos por timeout.", { intentos });
                return filaError(msisdn, "ERROR", "Error de comunicación: " + (e.message || e), { intentos });
            }

            if (!resp.ok) {
                const msg = (resp.cuerpo && (resp.cuerpo.mensaje || resp.cuerpo.message))
                    || (resp.texto || "").slice(0, 200) || ("HTTP " + resp.status);
                return filaError(msisdn, "ERROR", msg, { intentos, httpStatus: resp.status, raw: resp.cuerpo });
            }
            if (!resp.cuerpo) {
                return filaError(msisdn, "ERROR", "La respuesta no es JSON válido.", { intentos, httpStatus: resp.status, raw: resp.texto });
            }

            return procesarRespuestaTigo(msisdn, resp.cuerpo, { intentos, ms: resp.ms, httpStatus: resp.status });
        }
    }

    /* ---------------------------------------------------------------------
       2.5 · CONCURRENCIA
    --------------------------------------------------------------------- */
    async function ejecutarPool(items, limite, worker) {
        let i = 0;
        const total = items.length;
        const n = Math.max(1, Math.min(limite || 8, total || 1));
        const ejecutores = Array.from({ length: n }, async () => {
            while (i < total) {
                const idx = i++;
                await worker(items[idx], idx);
            }
        });
        await Promise.all(ejecutores);
    }

    /* ---------------------------------------------------------------------
       2.6 · ENTRADA: MSISDN individual y masivo (pegar / CSV / Excel)
    --------------------------------------------------------------------- */
    function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }

    function parseMsisdns(texto) {
        const vistos = new Set(), orden = [], invalidas = [];
        let total = 0, duplicados = 0;
        String(texto || "").split(/[\s,;|\t\r\n]+/).forEach(bruto => {
            const crudo = String(bruto).trim();
            if (!crudo) return;
            total++;
            const num = soloDigitos(crudo);
            if (num.length < 7 || num.length > 15) { invalidas.push(crudo); return; }
            if (vistos.has(num)) { duplicados++; return; }
            vistos.add(num); orden.push(num);
        });
        return { lineas: orden, invalidas, total, duplicados };
    }

    let lineasArchivo = null;
    function obtenerLineas() {
        if (lineasArchivo && lineasArchivo.lineas && lineasArchivo.lineas.length) return lineasArchivo;
        const el = MEUI.$("#inputLineas");
        return el ? parseMsisdns(el.value) : { lineas: [], invalidas: [], total: 0, duplicados: 0 };
    }

    /* =================================================================
       3 · INTERFAZ
    ================================================================= */

    /* ---------------------------------------------------------------------
       3.1 · ESTADO DE LA HERRAMIENTA
    --------------------------------------------------------------------- */
    let filas = [];
    let dataTable = null;
    let corriendo = false;
    const filtros = { proceso: new Set(), bloqueo: new Set() };
    const columnasOcultas = new Set();

    /** Celda de "Estado ME": "—" sin sesión del CM, "No está en el CM" si el
     *  CM no tiene la línea, o el estado (Activa/Desactivada/...) si sí. */
    function celdaEstadoCM(f) {
        if (!f.cm) return `<span class="text-muted">—</span>`;
        if (f.cm.pertenece === false) return `<span class="badge-estado neutro">No está en el CM</span>`;
        if (f.cm.pertenece === null) return `<span class="badge-estado err" title="${MEUI.esc(f.cm.error || '')}">Error CM</span>`;
        if (!f.cm.estado) return `<span class="text-muted">—</span>`;
        return `<span class="badge-estado ${f.cm.estado === "Activa" ? "ok" : "off"}">${MEUI.esc(f.cm.estado)}</span>`;
    }

    function textoBloqueos(f) {
        const n = (f.bloqueosActivos || []).length;
        return n ? `⚠ ${n} restricción${n > 1 ? "es" : ""}` : "Sin restricciones";
    }

    /* ---------------------------------------------------------------------
       3.2 · CONSULTA MASIVA
    --------------------------------------------------------------------- */
    function actualizarProgreso(hechas, total) {
        MEUI.progreso.paso(hechas, total, `Consultas completadas: ${hechas} / ${total}`);
    }

    /** Solo errores de consulta: las entradas inválidas se corrigen en el origen. */
    function consultaFallida(f) {
        return ["ERROR", "ERROR_RETCODE", "TIMEOUT"].includes(f.estadoProceso) || !!(f.cm && f.cm.error)
            || !!(f.claro && ["ERROR", "TIMEOUT"].includes(f.claro.estado));
    }

    function finalizarConsulta() {
        const fallidas = filas.filter(consultaFallida).length;
        MEUI.progreso.fin({ ok: fallidas === 0,
            fallidas, reintentar: () => consultar(true) });
    }

    async function consultar(soloFallidas = false) {
        if (corriendo) return;
        const entrada = soloFallidas
            ? { lineas: filas.filter(consultaFallida).map(f => f.msisdn), invalidas: [], duplicados: 0, total: filas.filter(consultaFallida).length }
            : obtenerLineas();
        if (!entrada.lineas.length) { MEUI.toast("No hay líneas válidas para consultar.", "warn"); return; }
        MEUI.log(`Registros recibidos: ${entrada.total}  ·  MSISDN válidos: ${entrada.lineas.length}  ·  ` +
            `Inválidos: ${entrada.invalidas.length}  ·  Duplicados: ${entrada.duplicados}`, "info");

        corriendo = true;
        const btn = MEUI.$("#btnConsultar");
        if (btn) btn.disabled = true;

        if (!soloFallidas) filas = entrada.lineas.map(m => ({ msisdn: m, estadoProceso: "EN_COLA", resumen: {}, cm: null }));
        entrada.invalidas.forEach(v => filas.push(filaError(v, "INVALID", "MSISDN con formato inválido.")));
        render();

        const cfg = cfgTigo;
        const concurrencia = Math.max(1, Math.min(15, Number(MEUI.$("#cfgConcurrencia").value) || 8));
        cfg.concurrencia = concurrencia;

        let hechas = 0, lineasHechas = 0, ultimoRender = 0;
        let total = entrada.lineas.length * (auth.token ? 2 : 1);
        MEUI.progreso.iniciar(total, "Consultando Tigo y estado ME");
        const contarConsulta = () => { hechas++; actualizarProgreso(hechas, total); };
        const porMsisdn = new Map(filas.map(f => [f.msisdn, f]));

        try {
            await ejecutarPool(entrada.lineas, concurrencia, async (msisdn) => {
                const fila = porMsisdn.get(msisdn);
                fila.estadoProceso = "PROCESSING";
                // Tigo (HLR) y CM corren EN PARALELO por línea: son servicios
                // distintos y no hay que esperar al uno para pedir el otro.
                const [resultado, cm] = await Promise.all([
                    consultarConReintentos(msisdn, cfg).catch(e => filaError(msisdn, "ERROR", e.message)).finally(contarConsulta),
                    estadoCM(msisdn).catch(e => ({ pertenece: null, error: e.message })).then(cm => {
                        if (cm) contarConsulta();
                        return cm;
                    })
                ]);
                Object.assign(fila, resultado);
                fila.cm = cm;
                // Borrar el cruce anterior evita conservar evidencia vieja al reintentar.
                fila.claro = null;
                if (necesitaClaro(fila)) {
                    total++;
                    actualizarProgreso(hechas, total);
                    fila.claro = await HLRConsulta.consultarClaro(msisdn, HLRConsulta.CFG.claro)
                        .catch(e => ({ fuente: "claro", estado: "ERROR", mensaje: e.message, raw: null }))
                        .finally(contarConsulta);
                }
                lineasHechas++;
                const ahora = performance.now();
                if (ahora - ultimoRender > 400 || lineasHechas === entrada.lineas.length) { ultimoRender = ahora; render(); }
            });

        } catch (e) {
            filas.filter(f => ["PROCESSING", "PENDING", "EN_COLA"].includes(f.estadoProceso))
                .forEach(f => Object.assign(f, filaError(f.msisdn, "ERROR", e.message)));
            MEUI.log(e.message, "err");
        } finally {
            corriendo = false;
            if (btn) btn.disabled = false;
            render();
            finalizarConsulta();
        }

        const c = { CREADA: 0, SIN_PERFIL: 0, RESIDUO_TIGO: 0, TIMEOUT: 0, ERROR: 0, ERROR_RETCODE: 0, INVALID: 0, INCONSISTENTE: 0 };
        filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
        MEUI.log(`Resultado — Total: ${filas.length}  ·  Creadas: ${c.CREADA}  ·  Sin perfil: ${c.SIN_PERFIL}  ·  ` +
            `Residuo en Tigo: ${c.RESIDUO_TIGO}  ·  Timeout: ${c.TIMEOUT}  ·  Errores: ${c.ERROR + c.ERROR_RETCODE}  ·  ` +
            `Inválidas: ${c.INVALID}`, "ok");
        MEUI.toast(`Consulta terminada: ${filas.length} líneas procesadas.`, "ok");
    }

    /* ---------------------------------------------------------------------
       3.3 · FILTROS Y KPIs
    --------------------------------------------------------------------- */
    /** Filas filtradas por desplegables y por el buscador de DataTables. */
    function filasFiltradas() {
        return dataTable ? dataTable.rows({ search: "applied" }).data().toArray() : filas.filter(filaPasaFiltros);
    }

    function filaPasaFiltros(f) {
        if (filtros.proceso.size) {
            // "FALLIDAS" agrupa todo lo que no dejó un resultado utilizable.
            const agrupado = filtros.proceso.has("FALLIDAS")
                && PROCESOS_FALLIDOS.indexOf(f.estadoProceso) >= 0;
            if (!agrupado && !filtros.proceso.has(f.estadoProceso)) return false;
        }
        if (filtros.bloqueo.size === 1) {
            const con = (f.bloqueosActivos || []).length > 0;
            if (filtros.bloqueo.has("CON") && !con) return false;
            if (filtros.bloqueo.has("SIN") && con) return false;
        }
        return true;
    }

    const controlesFiltro = new Map();
    function pintarFiltro(ul, dim, opciones) {
        if (!ul) return;
        const titulos = { estado: "Estado", proceso: "Resultado", bloqueo: "Restricciones",
            cincoG: "5G", roaming: "Roaming", seleccion: "Marcadas" };
        // Conserva la selección de KPI aunque aún no haya filas de ese estado.
        filtros[dim].forEach(v => { if (!opciones.some(o => o[0] === v)) opciones.push([v, v, 0]); });
        const firma = JSON.stringify(opciones.map(([v, t]) => [v, t]));
        let previo = controlesFiltro.get(dim);
        if (!previo || previo.firma !== firma || !previo.control.el.isConnected) {
            ul.replaceChildren();
            const control = MEUI.filtroMulti(ul, { titulo: titulos[dim],
                valores: opciones.map(([valor, texto, n]) => ({ valor, texto, n })),
                seleccion: filtros[dim], alCambiar: seleccion => {
                    if (!control.el.isConnected || controlesFiltro.get(dim)?.sincronizando) return;
                    filtros[dim] = seleccion;
                    render();
                } });
            previo = { control, firma, sincronizando: false };
            controlesFiltro.set(dim, previo);
        }
        previo.control.el.querySelectorAll("input[data-indice]").forEach((c, i) => {
            const cuenta = c.closest("label").querySelector("small");
            if (cuenta) cuenta.textContent = opciones[i][2];
        });
        previo.sincronizando = true;
        previo.control.set(filtros[dim]);
        previo.sincronizando = false;
        MEUI.$$(".kpi-click").forEach(k => k.classList.toggle("kpi-activo",
            !!filtros[k.dataset.fdim]?.has(k.dataset.fval)));
    }

    function actualizarFiltros() {
        const cont = v => filas.filter(f => f.estadoProceso === v).length;
        const estados = [...new Set(filas.map(f => f.estadoProceso))].sort();
        pintarFiltro(MEUI.$("#fEstado"), "proceso", estados.map(v => [v, ETIQUETA_ESTADO[v] || v, cont(v)]));

        const con = filas.filter(f => (f.bloqueosActivos || []).length).length;
        const sin = filas.length - con;
        pintarFiltro(MEUI.$("#fBloqueo"), "bloqueo", [["CON", "Con restricciones", con], ["SIN", "Sin restricciones", sin]]);
    }

    function actualizarKPIs() {
        const c = { CREADA: 0, SIN_PERFIL: 0, RESIDUO_TIGO: 0, TIMEOUT: 0, ERROR: 0, ERROR_RETCODE: 0, INVALID: 0, INCONSISTENTE: 0 };
        filas.forEach(f => { if (c[f.estadoProceso] !== undefined) c[f.estadoProceso]++; });
        MEUI.$("#kpiCreadas").textContent = c.CREADA;
        MEUI.$("#kpiSinPerfil").textContent = c.SIN_PERFIL;
        MEUI.$("#kpiResiduoTigo").textContent = c.RESIDUO_TIGO;
        MEUI.$("#kpiRevisar").textContent = c.INCONSISTENTE;
        MEUI.$("#kpiErrores").textContent = c.ERROR + c.ERROR_RETCODE + c.TIMEOUT + c.INVALID;
    }

    function alternarKpi(el) {
        const dim = el.dataset.fdim, val = el.dataset.fval;
        const activo = el.classList.toggle("kpi-activo");
        MEUI.$$(`.me-kpi[data-fdim="${dim}"]`).forEach(o => { if (o !== el) o.classList.remove("kpi-activo"); });
        filtros[dim].clear();
        if (activo) filtros[dim].add(val);
        render();
    }

    function limpiarFiltros() {
        Object.values(filtros).forEach(s => s.clear());
        if (dataTable) dataTable.search("");
        MEUI.$$(".me-kpi.kpi-activo").forEach(k => k.classList.remove("kpi-activo"));
        render();
    }

    /* ---------------------------------------------------------------------
       3.4 · COLUMNAS
    --------------------------------------------------------------------- */
    const COLUMNAS_TABLA = [
        {
            data: null, title: ETIQUETA_COLUMNA.detalle, orderable: false, className: "col-accion",
            render: f => `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                title="Ver detalle completo" aria-label="Ver detalle completo">👁</button>`
        },
        { data: "msisdn", title: ETIQUETA_COLUMNA.msisdn, render: v => MEUI.copiable(v, "línea") },
        { data: null, title: ETIQUETA_COLUMNA.estado, render: f => celdaEstado(f) },
        { data: null, title: ETIQUETA_COLUMNA.estadoCm, render: f => celdaEstadoCM(f) },
        { data: null, title: ETIQUETA_COLUMNA.claro, render: f => MEUI.esc(textoEstadoClaro(f)) },
        { data: null, title: ETIQUETA_COLUMNA.conclusion, render: f => MEUI.esc(conclusionClaro(f)) },
        { data: null, title: ETIQUETA_COLUMNA.retcode, render: f => MEUI.esc(f.retcode || "—") },
        { data: null, title: ETIQUETA_COLUMNA.imsi, render: f => MEUI.copiable(f.resumen && f.resumen.imsi !== "—" ? f.resumen.imsi : "", "IMSI") },
        { data: null, title: ETIQUETA_COLUMNA.imei, render: f => MEUI.esc((f.resumen && f.resumen.imei) || "—") },
        { data: null, title: ETIQUETA_COLUMNA.card, render: f => MEUI.esc((f.resumen && f.resumen.cardType) || "—") },
        {
            data: null, title: ETIQUETA_COLUMNA.bloqueos, render: f => f.estadoProceso === "CREADA"
                ? `<span class="${(f.bloqueosActivos || []).length ? "chip-bloqueo activo" : "chip-bloqueo"}">${MEUI.esc(textoBloqueos(f))}</span>`
                : "—"
        },
        { data: null, title: ETIQUETA_COLUMNA.roaming, render: f => MEUI.esc((f.resumen && f.resumen.roaming) || "—") },
        { data: null, title: ETIQUETA_COLUMNA.desvios, render: f => MEUI.esc((f.resumen && f.resumen.desvios) || "—") }
    ];

    function pintarMenuColumnas() {
        const ul = MEUI.$("#menuColumnas");
        if (!ul) return;
        ul.innerHTML = columnas.map((c, i) => `
            <li class="form-check px-2">
                <input class="form-check-input" type="checkbox" data-col="${i}"
                    id="col_${c}" ${columnasOcultas.has(c) ? "" : "checked"}>
                <label class="form-check-label" for="col_${c}">${ETIQUETA_COLUMNA[c]}</label>
            </li>`).join("");
        ul.querySelectorAll("input").forEach(chk => chk.addEventListener("change", () => {
            const c = columnas[Number(chk.dataset.col)];
            if (chk.checked) columnasOcultas.delete(c); else columnasOcultas.add(c);
            if (dataTable) { dataTable.column(COLUMNAS_TABLA.findIndex(col => col.title === ETIQUETA_COLUMNA[c])).visible(chk.checked); MEUI.ajustarTablas(); }
        }));
    }

    /* ---------------------------------------------------------------------
       3.5 · TABLA
    --------------------------------------------------------------------- */
    function celdaEstado(f) {
        const e = f.estadoProceso;
        const cls = { CREADA: "ok", SIN_PERFIL: "off", RESIDUO_TIGO: "warn", TIMEOUT: "warn", INCONSISTENTE: "warn",
            ERROR: "err", ERROR_RETCODE: "err", INVALID: "err", EN_COLA: "neutro", PROCESSING: "info" }[e] || "neutro";
        return `<span class="badge-estado ${cls}">${MEUI.esc(ETIQUETA_ESTADO[e] || e)}</span>`;
    }

    function construirDataTable() {
        dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
            data: [],
            order: [[COLUMNAS_TABLA.findIndex(c => c.data === "msisdn"), "asc"]],
            columns: COLUMNAS_TABLA
        }));
        dataTable.on("click", "button.btn-detalle", function (e) {
            e.stopPropagation();
            abrirDetalle(this.dataset.msisdn);
        });
        dataTable.on("click", "tbody tr", function (e) {
            if (e.target.closest(".btn-copy")) return;
            const fila = dataTable.row(this).data();
            if (fila && fila.msisdn) abrirDetalle(fila.msisdn);
        });
        dataTable.on("draw", () => {
            if (!corriendo && filas.length && !dataTable.rows({ search: "applied" }).count())
                MEUI.estadoTabla("#tablaResultados", "vacio");
            else if (!corriendo) MEUI.estadoTabla("#tablaResultados", "listo");
        });
        MEUI.registrarTabla(dataTable);
    }

    function render() {
        MEUI.prepararTabla("#tablaResultados");
        if (!dataTable) construirDataTable();
        const visibles = filas.filter(filaPasaFiltros);
        dataTable.clear();
        dataTable.rows.add(visibles);
        dataTable.draw(false);
        actualizarKPIs();
        actualizarFiltros();
        pintarMenuColumnas();
        MEUI.prepararTabla("#tablaResultados");
        MEUI.$("#msgVacio").hidden = filas.length > 0;
        const fallidas = filas.filter(consultaFallida).length;
        MEUI.estadoTabla("#tablaResultados", corriendo ? "cargando" :
            fallidas && fallidas === filas.length ? "error" :
            filas.length && !dataTable.rows({ search: "applied" }).count() ? "vacio" : "listo",
            { reintentar: () => consultar(true) });
        MEUI.resumenPaso(2, filas.length ? `${filas.length} líneas consultadas` : "");
        MEUI.ajustarTablas();
    }

    /* ---------------------------------------------------------------------
       3.6 · MODAL DE DETALLE
    --------------------------------------------------------------------- */
    function filaDe(msisdn) { return filas.find(f => f.msisdn === msisdn); }

    function gridSeccion(seccion) {
        if (!seccion || !seccion.items.length) return `<p class="me-hint mb-0">Sin datos.</p>`;
        return `<dl class="dl-grid mb-0">` + seccion.items.map(it => it.clave
            ? `<dt>${MEUI.esc(it.clave)}</dt><dd>${MEUI.esIdentificacion(it.clave) ? MEUI.copiable(it.valor, it.clave) : MEUI.esc(it.valor === "" ? "—" : it.valor)}</dd>`
            : `<dt class="text-muted">—</dt><dd>${MEUI.esc(it.texto)}</dd>`
        ).join("") + `</dl>`;
    }

    function abrirDetalle(msisdn) {
        const f = filaDe(msisdn);
        if (!f) return;
        MEUI.$("#mdMsisdn").textContent = f.msisdn;
        MEUI.$("#mdImsi").textContent = (f.resumen && f.resumen.imsi) || "—";
        MEUI.$("#mdImei").textContent = (f.resumen && f.resumen.imei) || "—";

        if (f.estadoProceso === "INVALID" || f.estadoProceso === "TIMEOUT" || f.estadoProceso === "ERROR") {
            MEUI.$("#mdResumen").innerHTML = `<div class="alert alert-warning mb-0">
                <b>${MEUI.esc(ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso)}</b> — ${MEUI.esc(f.detalle || "Sin detalle adicional.")}
                ${f.intentos ? `<div class="me-hint mt-1">Intentos realizados: ${f.intentos}</div>` : ""}
            </div>`;
            MEUI.$("#mdCategorias").innerHTML = "";
            MEUI.$("#mdTecnico").innerHTML = "";
            MEUI.$("#mdJson").textContent = f.raw ? JSON.stringify(f.raw, null, 2) : "(sin respuesta)";
            new bootstrap.Modal("#modalDetalle").show();
            return;
        }

        const cls = { CREADA: "ok", SIN_PERFIL: "off", RESIDUO_TIGO: "warn", ERROR_RETCODE: "err", INCONSISTENTE: "warn" }[f.estadoProceso] || "neutro";
        MEUI.$("#mdResumen").innerHTML = `
            ${(f.inconsistencias || []).length ? `<div class="alert alert-warning py-2 mb-2">
                <b>Respuesta inconsistente — no usar como evidencia sin verificar:</b>
                <ul class="mb-0">${f.inconsistencias.map(t => `<li>${MEUI.esc(t)}</li>`).join("")}</ul>
            </div>` : ""}
            <div class="d-flex flex-wrap gap-3 align-items-center">
                <span class="badge-estado ${cls}">${MEUI.esc(ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso)}</span>
                <span class="me-mono text-muted">RETCODE ${MEUI.esc(f.retcode || "—")} ${MEUI.esc(f.retmsg || "")}</span>
                <span>Estado ME: ${celdaEstadoCM(f)}</span>
                ${f.bloqueosActivos.length ? `<span class="chip-bloqueo activo">${MEUI.esc(textoBloqueos(f))}</span>` : ""}
            </div>
            ${f.claro || necesitaClaro(f) ? `
                <div class="alert alert-warning py-2 mt-2 mb-0">
                    <b>HLR Claro: ${MEUI.esc(textoEstadoClaro(f))}</b>
                    <div>${MEUI.esc(conclusionClaro(f))}</div>
                    ${f.claro && f.claro.mensaje ? `<div class="me-hint">${MEUI.esc(f.claro.mensaje)}</div>` : ""}
                </div>` : ""}
            ${f.bloqueosActivos.length ? `
                <div class="mt-2">
                    <div class="fw-bold small mb-1">Restricciones detectadas (heurística — ver detalle crudo abajo)</div>
                    <ul class="mb-0">${f.bloqueosActivos.map(b => `<li>${MEUI.esc(b.etiqueta)}
                        <span class="me-mono text-muted">(${MEUI.esc(b.origen)} = ${MEUI.esc(b.valor)})</span></li>`).join("")}</ul>
                </div>` : ""}`;

        MEUI.$("#mdCategorias").innerHTML = f.secciones.length
            ? f.secciones.map(s => `
            <div class="mb-3">
                <h6 class="fw-bold">${MEUI.esc(s.nombre)} <small class="text-muted fw-normal">(${s.items.length})</small></h6>
                ${gridSeccion(s)}
            </div>`).join("")
            : `<p class="me-hint">No se recibió perfil detallado en esta respuesta.</p>`;

        MEUI.$("#mdTecnico").innerHTML = gridSeccion({
            items: [
                { clave: "RETCODE", valor: f.retcode }, { clave: "Mensaje", valor: f.retmsg },
                { clave: "Transaction ID", valor: f.transaccionId }, { clave: "Fecha/hora", valor: f.fechaHora },
                { clave: "Intentos realizados", valor: f.intentos }, { clave: "Duración (ms)", valor: f.ms }
            ]
        });

        MEUI.$("#mdJson").textContent = JSON.stringify(f.claro ? { tigo: f.raw, claro: f.claro.raw } : f.raw, null, 2);
        new bootstrap.Modal("#modalDetalle").show();
    }

    /* ---------------------------------------------------------------------
       3.7 · EXPORTACIÓN
    --------------------------------------------------------------------- */
    /** Texto plano del estado ME para exportar (CSV/Excel no llevan HTML). */
    function textoEstadoCM(f) {
        if (!f.cm) return "";
        if (f.cm.pertenece === false) return "No está en el CM";
        if (f.cm.pertenece === null) return "Error CM: " + (f.cm.error || "");
        return f.cm.estado || "";
    }

    function filasExport() {
        const rows = filasFiltradas().map(f => [
            f.msisdn, ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso, textoEstadoCM(f), textoEstadoClaro(f), conclusionClaro(f), f.retcode || "", f.retmsg || f.detalle || "",
            (f.resumen && f.resumen.imsi) || "", (f.resumen && f.resumen.imei) || "", (f.resumen && f.resumen.cardType) || "",
            (f.bloqueosActivos || []).map(b => b.etiqueta).join(" | "),
            (f.resumen && f.resumen.roaming) || "", (f.resumen && f.resumen.desvios) || "",
            f.transaccionId || "", f.fechaHora || "",
            (f.inconsistencias || []).join(" | ")
        ]);
        return { head: CABECERA_EXPORT, rows };
    }

    function filasParaExportar() {
        return filasFiltradas().map(f => ({
            msisdn: f.msisdn, estado: ETIQUETA_ESTADO[f.estadoProceso] || f.estadoProceso, estadoCm: textoEstadoCM(f), claro: f.claro || null, conclusion: conclusionClaro(f),
            retcode: f.retcode, retmsg: f.retmsg, resumen: f.resumen, bloqueosActivos: f.bloqueosActivos,
            transaccionId: f.transaccionId, fechaHora: f.fechaHora, raw: f.raw
        }));
    }

    /* ---------------------------------------------------------------------
       3.8 · CARGA DE ARCHIVO (Excel / CSV) — mismo patrón del validador QDN
    --------------------------------------------------------------------- */
    function configurarArchivo() {
        const zona = MEUI.$("#dropzone"), input = MEUI.$("#inputArchivo");
        const selHoja = MEUI.$("#selHoja"), selColumna = MEUI.$("#selColumna");
        const info = MEUI.$("#fileInfo"), btnQuitar = MEUI.$("#btnQuitarArchivo");
        let libro = null;

        function limpiar() {
            libro = null; lineasArchivo = null;
            MEUI.zonaArchivo(input).limpiar();
            selHoja.innerHTML = '<option value="">— carga un archivo —</option>'; selHoja.disabled = true;
            selColumna.innerHTML = '<option value="">— carga un archivo —</option>'; selColumna.disabled = true;
            info.textContent = ""; btnQuitar.classList.add("d-none");
        }

        function extraerColumna() {
            if (!libro || !selHoja.value || !selColumna.value) { lineasArchivo = null; return; }
            const filasHoja = MEUI.filasDeHoja(libro.wb, selHoja.value);
            const valores = filasHoja.map(r => r[selColumna.value]).filter(v => v !== undefined && v !== "");
            lineasArchivo = parseMsisdns(valores.join("\n"));
            info.innerHTML = `${filasHoja.length} filas · ${lineasArchivo.lineas.length} MSISDN válidos` +
                (lineasArchivo.invalidas.length ? ` · ${lineasArchivo.invalidas.length} inválidos` : "") +
                (lineasArchivo.duplicados ? ` · ${lineasArchivo.duplicados} duplicados` : "");
        }

        function pintarColumnas() {
            const filasHoja = MEUI.filasDeHoja(libro.wb, selHoja.value);
            const columnasHoja = filasHoja.length ? Object.keys(filasHoja[0]) : [];
            selColumna.disabled = !columnasHoja.length;
            selColumna.innerHTML = columnasHoja.map(c => `<option value="${MEUI.esc(c)}">${MEUI.esc(c)}</option>`).join("");
            const auto = MEUI.detectarColumna(columnasHoja);
            if (auto) selColumna.value = auto;
            extraerColumna();
        }

        async function procesar(file) {
            try {
                libro = await MEUI.leerLibro(file);
                selHoja.disabled = false;
                selHoja.innerHTML = libro.hojas.map(h => `<option value="${MEUI.esc(h)}">${MEUI.esc(h)}</option>`).join("");
                selHoja.value = libro.hojas[0];
                pintarColumnas();
                btnQuitar.classList.remove("d-none");
                MEUI.log(`Archivo cargado: ${file.name} (${libro.hojas.length} hoja(s)).`, "ok");
            } catch (e) {
                MEUI.toast("No se pudo leer el archivo: " + e.message, "err");
                limpiar();
            }
        }

        MEUI.zonaArchivo(zona, { alElegir: procesar });
        selHoja.addEventListener("change", pintarColumnas);
        selColumna.addEventListener("change", extraerColumna);
        btnQuitar.addEventListener("click", limpiar);
    }

    /* ---------------------------------------------------------------------
       3.9 · INICIALIZACIÓN
    --------------------------------------------------------------------- */
    function inicializarTigo() {
        MEUI.$("#cfgBaseUrl").value = AMBIENTE_TIGO.base_url;
        MEUI.$("#cfgApiKey").value = AMBIENTE_TIGO.api_key;

        MEUI.$("#btnConsultar").addEventListener("click", () => {
            cfgTigo.base_url = MEUI.$("#cfgBaseUrl").value.trim() || AMBIENTE_TIGO.base_url;
            cfgTigo.api_key = MEUI.$("#cfgApiKey").value.trim() || AMBIENTE_TIGO.api_key;
            consultar();
        });
        MEUI.$("#btnLimpiarFiltros").addEventListener("click", limpiarFiltros);
        MEUI.$$(".me-kpi.kpi-click").forEach(k => k.addEventListener("click", () => alternarKpi(k)));

        configurarArchivo();
        render();
    }
    inicializarTigo();

    /* ---------------------------------------------------------------------
       3.10 · ENGANCHE CON EL SHELL COMÚN (sesión del CM, exportaciones, registro)
    --------------------------------------------------------------------- */
    const el = id => document.getElementById(id);

    /* --- Sesión del CM (opcional: da el "Estado ME" de cada línea) */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
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
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    if (el("btnLogin")) el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", () => { if (el("btnLogin")) el("btnLogin").click(); });
    document.addEventListener("me:sesion-renovar", () => {
        if (!auth.token) return;
        MEUI.log("Renovando el token del CM antes de que venza…");
        auth.reauth(auth.version).catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
    });
    document.addEventListener("me:sesion-cerrar", () => {
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        if (el("pass")) el("pass").value = "";
    });

    // Credenciales compartidas: si ya se inició sesión en otra herramienta,
    // se reutilizan solas — el "Estado ME" queda disponible sin pedir nada.
    const credCm = MEUI.cred.get("cm");
    if (credCm && el("user")) {
        if (!el("user").value) el("user").value = credCm.usuario || "";
        if (!el("pass").value) el("pass").value = credCm.clave || "";
    }
    if (el("user") && el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true);
    } else {
        MEUI.log("Sin sesión del CM: la columna «Estado ME» quedará vacía (opcional, ver paso 2).");
    }

    /* --- Enter en el campo de líneas lanza la consulta ------------- */
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- Exportaciones comunes (separador «;» por defecto) -------- */
    const reemplazar = (id, fn) => {
        const b = el(id); if (!b) return;
        const n = b.cloneNode(true); b.replaceWith(n); n.addEventListener("click", fn);
    };
    const base = "validador_portabilidad_tigo";
    reemplazar("btnCSV", () => { const d = filasExport(); MEUI.exportarCSV(d.head, d.rows, base); });
    reemplazar("btnXLSX", () => { const d = filasExport(); MEUI.exportarXLSX(d.head, d.rows, base, "Portabilidad Tigo"); });
    if (el("btnJSON"))
        el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filasParaExportar(), base));

    /* --- Retroalimentación visible -------------------------------- */
    MEUI.autoSpinner("#btnConsultar", "Consultando HLR Tigo…");

    /* --- Registro --------------------------------------------------- */
    if (el("btnLimpiarLog")) el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    if (el("btnCopiarLog")) el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.log("Herramienta lista.", "ok");
})();
