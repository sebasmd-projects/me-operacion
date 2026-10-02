/* =====================================================================
   genesis-api.js · Sesión y consultas a Genesis (apimew / tulio)
   ---------------------------------------------------------------------
   Genesis expone el log del proceso de comprobación de titularidad
   («FechaExpedicion»): cada bloqueo o desbloqueo de SIM, con la línea, el
   documento y cómo terminó. Es el punto de partida de la herramienta de
   titularidad.

   Dos cosas que no son obvias:

     · La paginación NO va en la URL. Va en una cabecera `pagination` con
       un JSON en base64. El servidor devuelve esa misma estructura ya
       resuelta (con `count`), y de ahí sale cuántas páginas quedan.

     · La sesión es un Keycloak DISTINTO al del CM (otro host, otro realm,
       otro cliente), así que no se puede reutilizar `MEAPI.auth`: son dos
       sesiones a la vez, cada una con su token.

   Sobre el inicio de sesión: Genesis, en el navegador, usa el flujo de
   código de autorización, que redirige a `genesisme.grupo-exito.com`.
   Estas herramientas se abren desde `file://`, y ahí ese flujo no puede
   completarse: el redirect no vuelve a una página local y el fragmento con
   el código no se puede leer entre orígenes. Por eso hay dos caminos:

     1. Usuario y contraseña contra el token endpoint (`password`). Es lo
        mismo que ya hace `me-api.js` con el realm del CM. Funciona solo
        si el cliente `genesismovilexito` tiene habilitado ese flujo.
     2. Pegar el token de una sesión de Genesis ya abierta. Es el camino
        que siempre funciona, y es lo que de verdad significa «tomar la
        sesión activa»: desde file:// no hay forma de leerla sola.

   Se intenta el 1 y, si el realm no lo permite, se dice con todas las
   letras y queda el 2.

   Depende de me-ui.js (MEUI). No depende de me-api.js.
===================================================================== */
(function (global) {
    "use strict";

    const CONFIG = {
        /* Gateway donde vive el API. `apimew` es el mismo gateway que usa
           el HLR de Tigo, pero con otra ruta y otra autenticación. */
        apiBase: "https://tulio.grupo-exito.com/apimew/api/v1",

        /* El tramo `RXDUURMWEECCKC` es parte fija de la ruta publicada.
           No es un identificador de usuario ni de sesión: es el mismo para
           todos y viene así en la captura. */
        rutaFechaExpedicion: "/RXDUURMWEECCKC/FechaExpedicion",

        kcBase: "https://genesisv2.grupo-exito.com",
        realm: "GrupoExito",
        clientId: "genesismovilexito",

        paginaTam: 500,      // lo que se PIDE; manda lo que el servidor conceda
        rangoLargoDias: 93,  // más allá se avisa (no se prohíbe): cada día es al menos una consulta
        margenRenovacion: 30
    };

    const log = (m, n) => (global.MEUI ? global.MEUI.log(m, n) : console.log(m));

    /* =====================================================================
       1 · SESIÓN
    ===================================================================== */

    /** Lee `exp` de un JWT sin validarlo: solo sirve para saber cuándo se
        vence el token pegado y pintar la cuenta atrás del chip. Si no se
        puede leer, se asume una vida corta y ya se renovará a mano. */
    function vencimientoJwt(token) {
        try {
            const carga = String(token).split(".")[1];
            if (!carga) return null;
            const json = atob(carga.replace(/-/g, "+").replace(/_/g, "/")
                + "=".repeat((4 - carga.length % 4) % 4));
            const exp = JSON.parse(json).exp;
            return exp ? exp * 1000 : null;
        } catch (e) { return null; }
    }

    function usuarioJwt(token) {
        try {
            const carga = String(token).split(".")[1];
            const json = atob(carga.replace(/-/g, "+").replace(/_/g, "/")
                + "=".repeat((4 - carga.length % 4) % 4));
            const d = JSON.parse(json);
            return d.preferred_username || d.name || d.email || d.sub || "Genesis";
        } catch (e) { return "Genesis"; }
    }

    const auth = {
        token: null, refreshToken: null, usuario: null,
        expiresAt: null, version: 0, _renovando: null,

        get urlToken() {
            return `${CONFIG.kcBase}/realms/${CONFIG.realm}/protocol/openid-connect/token`;
        },

        _guardar(tok, quien) {
            this.token = tok.access_token;
            this.refreshToken = tok.refresh_token || this.refreshToken;
            const vida = Number(tok.expires_in) || 300;
            this.expiresAt = Date.now() + Math.max(15, vida - CONFIG.margenRenovacion) * 1000;
            this.usuario = quien || usuarioJwt(this.token);
            this.version++;
            if (global.MEUI) {
                global.MEUI.sesion.set("genesis", { usuario: this.usuario, duracion: vida });
            }
        },

        /** Token pegado de una sesión de Genesis ya abierta. */
        usarToken(token) {
            const t = String(token || "").trim().replace(/^Bearer\s+/i, "");
            if (t.length < 20) throw new Error("Ese no parece un token: es demasiado corto.");
            const exp = vencimientoJwt(t);
            if (exp && exp <= Date.now()) {
                throw new Error("El token pegado ya está vencido. Recárgalo desde Genesis.");
            }
            this.token = t;
            this.refreshToken = null;
            this.expiresAt = exp || (Date.now() + 5 * 60 * 1000);
            this.usuario = usuarioJwt(t);
            this.version++;
            if (global.MEUI) {
                global.MEUI.sesion.set("genesis", {
                    usuario: this.usuario,
                    duracion: Math.max(1, Math.round((this.expiresAt - Date.now()) / 1000))
                });
            }
            log(`✔ Token de Genesis aceptado (${this.usuario}).`, "ok");
            return true;
        },

        async _pedir(datos) {
            const r = await fetch(this.urlToken, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(datos)
            });
            const texto = await r.text();
            let cuerpo = null;
            try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
            if (!r.ok) {
                const err = new Error(descripcionErrorKc(r.status, cuerpo, texto));
                err.status = r.status;
                err.kcError = cuerpo && cuerpo.error;
                throw err;
            }
            if (!cuerpo || !cuerpo.access_token) throw new Error("Keycloak respondió sin access_token.");
            return cuerpo;
        },

        async login(usuario, clave) {
            const tok = await this._pedir({
                grant_type: "password", client_id: CONFIG.clientId,
                username: usuario, password: clave, scope: "openid"
            });
            this._guardar(tok, usuario);
            log(`✔ Sesión de Genesis iniciada (${usuario}).`, "ok");
            return true;
        },

        async refrescar() {
            if (!this.refreshToken) return false;
            const tok = await this._pedir({
                grant_type: "refresh_token", client_id: CONFIG.clientId,
                refresh_token: this.refreshToken
            });
            this._guardar(tok, this.usuario);
            return true;
        },

        /** Token vigente. Renueva si puede; si el token fue pegado y venció,
            lo dice claro en vez de fallar con un 401 sin explicación. */
        async vigente() {
            if (!this.token) throw new Error("No hay sesión de Genesis.");
            if (this.expiresAt && Date.now() >= this.expiresAt) {
                if (this.refreshToken) {
                    if (this._renovando) { await this._renovando; return this.token; }
                    this._renovando = this.refrescar().finally(() => { this._renovando = null; });
                    try { await this._renovando; }
                    catch (e) { throw new Error("La sesión de Genesis venció y no se pudo renovar: " + e.message); }
                } else {
                    throw new Error("El token de Genesis venció. Pega uno nuevo desde una sesión abierta.");
                }
            }
            return this.token;
        },

        salir() {
            this.token = null; this.refreshToken = null;
            this.expiresAt = null; this.usuario = null; this.version++;
            if (global.MEUI) global.MEUI.sesion.cerrar("genesis", false);
        }
    };

    /** Traduce los errores típicos del realm a algo accionable. */
    function descripcionErrorKc(status, cuerpo, texto) {
        const e = cuerpo && cuerpo.error;
        const d = (cuerpo && (cuerpo.error_description || cuerpo.errorMessage)) || "";
        if (e === "invalid_grant") return "Usuario o contraseña incorrectos para Genesis.";
        if (e === "unauthorized_client" || e === "invalid_client") {
            return "El cliente «" + CONFIG.clientId + "» no permite iniciar sesión con usuario y contraseña "
                + "(solo el flujo del navegador). Usa la opción de pegar el token de una sesión de Genesis abierta.";
        }
        if (status === 404) return "No se encontró el realm «" + CONFIG.realm + "» en " + CONFIG.kcBase + ".";
        return `Keycloak ${status}${e ? " (" + e + ")" : ""}: ${d || String(texto || "").slice(0, 200)}`;
    }

    /* =====================================================================
       2 · PAGINACIÓN
       ---------------------------------------------------------------------
       La cabecera `pagination` es el JSON de la página PEDIDA, en base64.
       La respuesta trae ese mismo objeto ya resuelto (con `count`) tanto en
       el cuerpo como —según el caso— en sus cabeceras.
    ===================================================================== */
    function cabeceraPaginacion(obj) {
        // btoa no acepta caracteres fuera de latin1; el objeto es ASCII, pero
        // se codifica igual por si un filtro trae texto con tildes.
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    }

    function paginaPedida(numero, tam, extra) {
        return Object.assign({
            pageNumber: numero,
            pageSize: tam,
            sort: "id",
            sortOrder: "ASC"
        }, extra || {});
    }

    async function pedirPagina(numero, tam, extra) {
        const token = await auth.vigente();
        const r = await fetch(CONFIG.apiBase + CONFIG.rutaFechaExpedicion, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "pagination": cabeceraPaginacion(paginaPedida(numero, tam, extra))
            }
        });
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
        if (!r.ok) {
            const err = new Error(`Genesis respondió HTTP ${r.status} en la página ${numero}`
                + (texto ? ": " + texto.slice(0, 200) : "."));
            err.status = r.status;
            throw err;
        }
        return {
            items: (cuerpo && cuerpo.items) || [],
            paginacion: (cuerpo && cuerpo.pagination) || null
        };
    }

    /* =====================================================================
       3 · RANGO DE FECHAS
       ---------------------------------------------------------------------
       El servidor acepta, dentro de la cabecera `pagination`, un filtro de
       UN SOLO DÍA (confirmado con una captura real):

           "filter": "FechaHoraTransaccion", "filterValue": "12/03/2026"

       con el día en dd/MM/yyyy (día/mes/año; "12/03/2026" es el 12 de marzo).
       Con él, `count` baja a lo que tiene ese día (200 en la captura, frente
       a 208.249 sin filtro).

       NO hay ningún filtro de rango confirmado. Las capturas traen `valor` y
       `valor2` siempre en null, y sospechamos que podrían ser desde/hasta,
       pero NO ESTÁ PROBADO, así que no se usan: se mandan en null. Si alguien
       consigue una captura de Genesis filtrando por un rango, `valor` y
       `valor2` se podrían usar para colapsar el bucle de días en una sola
       consulta (N días = N series de peticiones hoy, 1 entonces). Hasta que
       exista esa captura, el recorrido día por día es lo único que sabemos
       que funciona, y por eso es lo que se implementa.
    ===================================================================== */
    const dos = n => (n < 10 ? "0" : "") + n;

    /** dd/MM/yyyy, el formato que el servidor espera en `filterValue`. */
    function fechaGenesis(p) { return `${dos(p.d)}/${dos(p.m)}/${p.y}`; }

    /** Convierte la entrada a {y, m, d}. Se aceptan DOS formas y se documentan
        porque la diferencia importa:
          · "YYYY-MM-DD" (recomendada): es el valor de un <input type="date">
            y no hay ambigüedad de zona horaria.
          · Date: se toman sus componentes LOCALES (el día que ve el analista
            en su reloj, America/Bogota). OJO: `new Date("2026-03-12")` el JS
            lo interpreta como medianoche UTC, que en Bogotá es el 11 de marzo
            a las 19:00, y saldría el día anterior. Por eso las cadenas no se
            pasan por `new Date`: se leen a mano. */
    function partesDeFecha(v, nombre) {
        let y, m, d;
        if (v instanceof Date) {
            if (isNaN(v.getTime())) throw new Error(`La fecha «${nombre}» no es válida.`);
            y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate();
        } else {
            const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v == null ? "" : v).trim());
            if (!x) throw new Error(`La fecha «${nombre}» debe ser un Date o una cadena YYYY-MM-DD.`);
            y = Number(x[1]); m = Number(x[2]); d = Number(x[3]);
        }
        // Ida y vuelta por UTC: rechaza días que no existen (2026-02-30) en
        // vez de dejar que se desborden al mes siguiente sin avisar.
        const t = new Date(Date.UTC(y, m - 1, d));
        if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
            throw new Error(`La fecha «${nombre}» no existe en el calendario.`);
        }
        return { y, m, d };
    }

    /**
     * Lista los días de un rango, ambos extremos incluidos.
     * @returns {{desde:string, hasta:string, dias:Array, largo:boolean}}
     *   cada día: {y, m, d, iso:"YYYY-MM-DD", fecha:"dd/MM/yyyy"}.
     * Exige los DOS extremos: con uno solo habría que adivinar si el otro es
     * «hoy» o «el mismo día», y adivinar aquí significa traer datos que nadie
     * pidió (o no traer los que sí). Un solo día se pide con desde == hasta.
     */
    function rangoDias(desde, hasta) {
        if (desde == null || hasta == null) {
            throw new Error("Un rango necesita «desde» y «hasta». Para un solo día, usa el mismo valor en los dos.");
        }
        const a = partesDeFecha(desde, "desde"), b = partesDeFecha(hasta, "hasta");
        const ta = Date.UTC(a.y, a.m - 1, a.d), tb = Date.UTC(b.y, b.m - 1, b.d);
        if (tb < ta) throw new Error("El rango está al revés: «hasta» es anterior a «desde».");
        const dias = [];
        // Se avanza en UTC de a 24 h exactas: en hora local, un cambio de
        // horario (que Colombia no tiene, pero la máquina sí podría) duplicaría
        // o saltaría un día.
        for (let t = ta; t <= tb; t += 86400000) {
            const f = new Date(t);
            const p = { y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
            p.iso = `${p.y}-${dos(p.m)}-${dos(p.d)}`;
            p.fecha = fechaGenesis(p);
            dias.push(p);
        }
        return {
            desde: dias[0].iso, hasta: dias[dias.length - 1].iso, dias,
            largo: dias.length > CONFIG.rangoLargoDias
        };
    }

    /** Lo que se suma a la cabecera `pagination` para acotar a un día.
        `valor` y `valor2` van en null a propósito: ver el comentario de la
        sección. Se mandan explícitos porque así viaja la petición capturada. */
    function filtroDeDia(dia) {
        return {
            filter: "FechaHoraTransaccion",
            filterValue: dia.fecha,
            valor: null,
            valor2: null
        };
    }

    /* =====================================================================
       4 · CARGA COMPLETA
       ---------------------------------------------------------------------
       Dos decisiones que importan con 200.000+ registros:

       · Se ordena por id ASCENDENTE. Con DESC, cada registro nuevo que entra
         mientras se descarga corre todas las páginas una posición y se
         empiezan a repetir y a perder filas. Ascendente, lo nuevo se agrega
         al final y las páginas ya leídas no se mueven. Aun así se deduplica
         por `id`, que es la única garantía real.

       · Se DESCARTAN `request` y `response`. Son el SOAP/JSON crudo de cada
         operación: unos 2 KB por registro, que a 200.000 registros son
         cientos de megas solo para tenerlos guardados sin mirarlos. La
         herramienta los vuelve a pedir, de a una página, cuando alguien abre
         el detalle de una fila.

       Con rango, cada día es una serie completa e independiente de páginas
       (con su propia primera página, su propio `count` y su propio
       `pageSize` concedido). La deduplicación por `id` es UNA sola para toda
       la carga y NO se reinicia por día: un registro cerca de medianoche
       puede caer en dos consultas contiguas (zona horaria del servidor,
       reintentos), y contarlo dos veces ensuciaría la tabla.
    ===================================================================== */
    const LIGERO = ["id", "fechaHoraTransaccion", "tipoOperacion", "linea",
        "canal", "documento", "resultado", "usuario", "descripcionResultado"];

    function aligerar(item) {
        const o = {};
        LIGERO.forEach(k => { o[k] = item[k]; });
        return o;
    }

    /**
     * Trae TODAS las páginas de FechaExpedicion, o las de un rango de días.
     * @param {object} opciones
     *   - desde, hasta: acotan la carga a un rango de fechas, AMBOS
     *     extremos incluidos. Cada uno es una cadena "YYYY-MM-DD" (la forma
     *     recomendada) o un Date (se usa su día LOCAL). Se piden los dos o
     *     ninguno. Sin rango, se trae todo, como siempre. Con rango se hace
     *     UNA SERIE DE PETICIONES POR DÍA (el filtro confirmado es de un
     *     solo día): un mes son 31 series, no una.
     *   - alLote(nuevos) con los registros NUEVOS de cada página, para que
     *     quien llama los pinte mientras siguen llegando. Si se pasa, este
     *     módulo NO se los queda: con 200.000 registros, guardarlos aquí y
     *     además en la tabla es duplicar cientos de megas para nada.
     *   - alProgresar(p) por cada página, con
     *       {leidos, total, pagina, paginas}           (siempre; no cambian)
     *       {dia, dias, fecha, leidosDia, totalDia, fraccion}  (añadidos)
     *     `pagina`/`paginas` son las del día en curso. `leidos` y `total` son
     *     de TODA la carga; con rango, `total` suma los `count` de los días
     *     ya consultados, así que CRECE a medida que se avanza (no se puede
     *     saber lo que tiene un día sin preguntarle): no lo uses solo para un
     *     porcentaje, para eso está `fraccion` (0 a 1, por días y páginas).
     *     Sin rango, `dia`, `dias` y `fecha` son null y `fraccion` es
     *     leidos/total.
     *   - cancelado() -> true para cortar entre páginas y entre días
     *   - tam: tamaño de página a pedir (el servidor puede conceder menos)
     *   - filtro: campos extra para la cabecera `pagination`; si hay rango,
     *     `filter` y `filterValue` los pone el rango y mandan sobre estos.
     * @returns {{registros: Array, total: number, completo: boolean,
     *            leidos: number, cancelado: boolean, rango: object|null,
     *            diasTotal: number|null, diasRecorridos: number|null,
     *            consultas: number, detalleDias: Array}}
     *   `registros` viene vacío si se usó `alLote` (los tiene quien llamó).
     *   `completo` es false si se canceló. Con rango: `diasRecorridos` son
     *   los días leídos hasta el final (un día cortado a medias NO cuenta),
     *   `diasTotal` los del rango, `rango` = {desde, hasta, largo} y
     *   `detalleDias` = [{fecha, total, leidos, completo}] de los días que
     *   se llegaron a consultar. `total` suma solo los días consultados: si
     *   se canceló, los que faltaban no están en la cuenta. `consultas` es
     *   cuántas peticiones HTTP se hicieron. Sin rango, `rango`, `diasTotal`
     *   y `diasRecorridos` son null.
     */
    async function cargarTodo(opciones) {
        const o = opciones || {};
        const tamPedido = Math.max(1, Number(o.tam) || CONFIG.paginaTam);
        const alProgresar = typeof o.alProgresar === "function" ? o.alProgresar : () => { };
        const cancelado = typeof o.cancelado === "function" ? o.cancelado : () => false;
        const alLote = typeof o.alLote === "function" ? o.alLote : null;

        /* Se valida el rango ANTES de la primera petición: un «hasta» antes
           que «desde» o un día inexistente debe fallar sin haber gastado ni
           una consulta. */
        const rango = (o.desde != null || o.hasta != null) ? rangoDias(o.desde, o.hasta) : null;
        const dias = rango ? rango.dias : [null];
        if (rango) {
            const n = dias.length;
            if (rango.largo) {
                log(`⚠ Rango de ${n} días (${rango.desde} a ${rango.hasta}): son al menos ${n} consultas `
                    + `al servidor, una serie por día, más páginas si algún día trae mucho. `
                    + `Va a tardar; se puede cancelar.`, "warn");
            } else {
                log(`Rango ${rango.desde} a ${rango.hasta}: ${n} día${n === 1 ? "" : "s"}, `
                    + `una serie de consultas por día.`, "info");
            }
        }

        /* El deduplicado necesita recordar qué ids ya se vieron, pero NO los
           registros: un Set de números cuesta una fracción de lo que cuesta
           guardar 200.000 objetos que ya tiene la tabla. Solo se retienen
           cuando nadie los está recogiendo con `alLote`. El Set es uno solo
           para toda la carga, así que también vale ENTRE días. */
        const vistos = new Set();
        const retenidos = alLote ? null : [];
        let leidos = 0;
        let consultas = 0;

        const agregar = items => {
            const nuevos = [];
            items.forEach(it => {
                if (!it || it.id == null || vistos.has(it.id)) return;
                vistos.add(it.id);
                nuevos.push(aligerar(it));
            });
            leidos += nuevos.length;
            if (retenidos) retenidos.push(...nuevos);
            if (alLote && nuevos.length) alLote(nuevos);
            return nuevos.length;
        };

        const pedir = async (n, tam, filtro) => {
            consultas++;
            return pedirPagina(n, tam, filtro);
        };

        let completo = true;
        let totalPrevio = 0;          // suma de los `count` de los días ya cerrados
        let tamAvisado = null;        // para no repetir el aviso de página concedida en cada día
        let diasRecorridos = 0;
        const detalleDias = [];

        for (let i = 0; i < dias.length; i++) {
            const dia = dias[i];
            /* Entre días se mira `cancelado` ANTES de empezar el siguiente:
               si no, cancelar en el último segundo de un día dispararía igual
               la primera petición del día que viene. */
            if (dia && cancelado()) { completo = false; break; }

            const filtro = dia ? Object.assign({}, o.filtro, filtroDeDia(dia)) : o.filtro;

            const primera = await pedir(1, tamPedido, filtro);
            const totalDia = Number(primera.paginacion && primera.paginacion.count) || primera.items.length;

            /* Cuánto concedió DE VERDAD el servidor. Si se pide 500 y entrega 100,
               avanzar de 500 en 500 se saltaría cuatro de cada cinco registros, y
               la carga quedaría incompleta sin que nada lo avisara. Se calcula en
               cada día, porque cada día arranca con su propia primera página y
               nada garantiza que el servidor conceda lo mismo siempre. */
            const eco = Number(primera.paginacion && primera.paginacion.pageSize) || 0;
            const tam = primera.items.length
                ? Math.min(eco || primera.items.length, primera.items.length)
                : tamPedido;
            if (tam !== tamPedido && tam !== tamAvisado) {
                tamAvisado = tam;
                log(`Genesis concede páginas de ${tam} (se pidieron ${tamPedido}); se ajusta el recorrido.`, "info");
            }

            const leidosAntesDia = leidos;
            const paginas = Math.max(1, Math.ceil(totalDia / tam));

            const avisar = pagina => {
                const total = totalPrevio + totalDia;
                alProgresar({
                    leidos, total, pagina, paginas,
                    dia: dia ? i + 1 : null,
                    dias: dia ? dias.length : null,
                    fecha: dia ? dia.fecha : null,
                    leidosDia: leidos - leidosAntesDia,
                    totalDia,
                    // Avance real de 0 a 1. Con rango el `total` va creciendo y
                    // leidos/total daría ~100% en cada día; esto cuenta los días
                    // cerrados más la fracción de páginas del actual.
                    fraccion: dia
                        ? Math.min(1, (i + pagina / paginas) / dias.length)
                        : (total ? Math.min(1, leidos / total) : 0)
                });
            };

            agregar(primera.items);
            avisar(1);

            let diaCompleto = true;
            for (let n = 2; n <= paginas; n++) {
                if (cancelado()) { diaCompleto = false; completo = false; break; }
                const p = await pedir(n, tam, filtro);
                if (!p.items.length) break;          // el servidor se quedó sin datos antes de la cuenta
                agregar(p.items);
                avisar(n);
            }

            totalPrevio += totalDia;
            if (dia) {
                detalleDias.push({
                    fecha: dia.fecha, total: totalDia,
                    leidos: leidos - leidosAntesDia, completo: diaCompleto
                });
                if (diaCompleto) {
                    diasRecorridos++;
                    log(`Día ${i + 1}/${dias.length} · ${dia.fecha}: ${totalDia.toLocaleString("es-CO")} registros.`, "info");
                }
            }
            if (!diaCompleto) break;
        }

        if (rango && !completo) {
            log(`Rango cortado: ${diasRecorridos} de ${dias.length} días leídos por completo.`, "warn");
        }

        return {
            registros: retenidos || [], total: totalPrevio, completo, leidos,
            cancelado: !completo,
            rango: rango ? { desde: rango.desde, hasta: rango.hasta, largo: rango.largo } : null,
            diasTotal: rango ? dias.length : null,
            diasRecorridos: rango ? diasRecorridos : null,
            consultas, detalleDias
        };
    }

    /** Vuelve a pedir la página donde cae un id, para ver su SOAP crudo.
        Con orden ascendente e ids correlativos la página es calculable, pero
        no se supone: se pide y se busca el id dentro. */
    async function detalleDe(id, tam) {
        const t = Math.max(1, Number(tam) || CONFIG.paginaTam);
        const n = Math.max(1, Math.ceil(Number(id) / t));
        for (const intento of [n, n + 1, n - 1]) {
            if (intento < 1) continue;
            const p = await pedirPagina(intento, t);
            const hit = p.items.find(x => String(x.id) === String(id));
            if (hit) return hit;
        }
        return null;
    }

    function configurar(opciones) { Object.assign(CONFIG, opciones || {}); return CONFIG; }

    global.GENESIS = {
        CONFIG, auth, cargarTodo, detalleDe, pedirPagina,
        configurar, vencimientoJwt, usuarioJwt,
        rangoDias, fechaGenesis      // para avisar «son N consultas» ANTES de cargar
    };
})(window);
