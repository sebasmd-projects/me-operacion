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
        /* Más allá de esto se avisa (no se prohíbe). Se cuenta en TRAMOS, no
           en días: con el «contiene», un año entero es un tramo y 30 días
           sueltos son 30. Lo que duele son las peticiones. */
        rangoLargoTramos: 31,


        /* Tope de páginas al buscar el detalle de una fila dentro de su día.
           Un día con más de ~20.000 registros no es un día normal: si no
           apareció, es que ya no está, y seguir pidiendo no lo va a traer. */
        detalleMaxPaginas: 40,

        /* Cuántos registros trae la carga por defecto, la que no lleva
           fechas. Son los MÁS NUEVOS porque el orden es DESC, y 2.000 es lo
           que cabe en unas pocas peticiones (a 500 por página, cuatro). */
        topeRegistros: 2000,

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

    /* `DESC` y no `ASC`, aunque ascendente sea más estable para paginar.
       La razón es de riesgo, no de gusto: DESC es el ÚNICO valor que hemos
       visto funcionar contra el servidor real —lo usan las dos capturas que
       tenemos, la de producción y la de QA— y aquí no hay forma de probar
       otra cosa sin romper una carga de verdad. Entre una elección elegante
       sin probar y la que sabemos que responde, gana la probada.

       Lo que ASC protegía —que un registro nuevo durante la descarga corra
       las páginas y se dupliquen o se pierdan filas— lo cubre igual el
       deduplicado por `id`, que es la garantía de verdad. Y con el filtro
       por día el riesgo casi desaparece: un día cerrado ya no recibe
       registros nuevos. */
    function paginaPedida(numero, tam, extra) {
        return Object.assign({
            pageNumber: numero,
            pageSize: tam,
            sort: "id",
            sortOrder: "DESC"
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
       Con él, `count` baja a lo que tiene ese día: en la captura de
       producción, 200 ese día frente a 208.249 sin filtro.

       OJO con esos 208.249: es la foto del momento en que se capturó, no una
       constante. La tabla crece cada vez que se bloquea o desbloquea una SIM.
       Aquí y en los comentarios aparece solo como orden de magnitud, para
       justificar decisiones («con esto no se puede cargar todo de golpe»). El
       código NUNCA lo supone: el total sale del `count` que devuelve el
       servidor en la primera página de cada tramo, en cada carga.

       Pero `filterValue` NO es una igualdad: es un «contiene» sobre la fecha ya
       formateada como dd/MM/yyyy. Probado contra QA el 02/10/2026, con
       `pageSize: 1` para leer solo el `count`:

           "12/03/2026"  ->  count    200   (un día)
           "03/2026"     ->  count    200   (todo marzo de 2026)
           "/2026"       ->  count    219   (todo 2026)
           "request" / "soapenv:Envelope" -> count 23.551 (la tabla entera)

       Las tres primeras son coherentes entre sí: en QA, los 200 registros de
       marzo están todos el día 12, y el año tiene 19 más en otros meses. La
       cuarta prueba que `filter` acepta CUALQUIER campo, no solo la fecha.

       La consecuencia práctica es grande: un mes NO son 31 series de
       peticiones, es UNA. Por eso un rango no se recorre día por día a
       ciegas, sino que se descompone en los tramos más grandes que lo
       cubren exactamente (ver `tramosDeRango`): años completos, meses
       completos y los días sueltos de las puntas.

       Qué queda sin probar, por honestidad:

         · Si el «contiene» es en cualquier posición o solo al final. Los tres
           valores probados ("12/03/2026", "03/2026", "/2026") son los tres
           SUFIJOS de dd/MM/yyyy, así que los datos no distinguen una cosa de
           la otra. Da igual para lo que se usa aquí —día, mes y año son
           sufijos—, pero significa que un "12/03" (prefijo) podría no filtrar
           nada. No se usa.
         · `valor` y `valor2`. Siempre llegan en null en las capturas y
           sospechamos que son un desde/hasta, pero no está probado: se
           mandan en null, como viaja la petición real. Con el «contiene» ya
           no hacen falta.
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
     * Lista los días de un rango, ambos extremos incluidos. Es la base de
     * `tramosDeRango`; para cargar, usa esa, que agrupa y pide mucho menos.
     * @returns {{desde:string, hasta:string, dias:Array}}
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
        return { desde: dias[0].iso, hasta: dias[dias.length - 1].iso, dias };
    }

    /** Lo que se suma a la cabecera `pagination` para acotar a un tramo.
        `valor` y `valor2` van en null a propósito: ver el comentario de la
        sección. Se mandan explícitos porque así viaja la petición capturada. */
    function filtroDeTramo(tramo) {
        return {
            filter: "FechaHoraTransaccion",
            filterValue: tramo.filtro,
            valor: null,
            valor2: null
        };
    }

    const ULTIMO_DIA = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

    /**
     * Descompone un rango en los tramos MÁS GRANDES que lo cubren exacto, sin
     * sobrar ni faltar un día. Aprovecha que `filterValue` es un «contiene»
     * sobre dd/MM/yyyy: un año completo se pide con "/yyyy", un mes completo
     * con "MM/yyyy" y un día con "dd/MM/yyyy".
     *
     * Es una descomposición voraz de izquierda a derecha: en cada posición se
     * intenta el tramo más grande que CABE ENTERO en el rango (año, luego mes,
     * luego día). Eso da el mínimo de peticiones sin traer ni un registro de
     * fuera del rango, que es la condición que no se puede negociar: pedir
     * "03/2026" para un rango que termina el 15 de marzo traería medio mes de
     * más, y la tabla mostraría datos que nadie pidió.
     *
     *   2026-03-01 .. 2026-03-31  ->  1 tramo  (mes 03/2026)      antes: 31
     *   2026-01-01 .. 2026-12-31  ->  1 tramo  (año /2026)        antes: 365
     *   2026-02-15 .. 2026-04-10  ->  14 días + 03/2026 + 10 días antes: 55
     *   2026-03-12 .. 2026-03-12  ->  1 tramo  (día)              antes: 1
     *
     * @returns {{desde:string, hasta:string, tramos:Array, dias:number, largo:boolean}}
     *   cada tramo: {tipo:"anio"|"mes"|"dia", filtro, etiqueta, dias,
     *                desde:"YYYY-MM-DD", hasta:"YYYY-MM-DD"}.
     *   `dias` (el de arriba) son los días naturales que abarca el rango, para
     *   poder decir «un mes» o «tres meses»; `tramos.length` es lo que de
     *   verdad cuesta en peticiones, y es lo que hay que mirar.
     */
    function tramosDeRango(desde, hasta) {
        const r = rangoDias(desde, hasta);
        const dias = r.dias;
        const tramos = [];
        let i = 0;
        while (i < dias.length) {
            const p = dias[i];
            const quedan = dias.length - i;

            // ¿Cabe el año entero? Solo si empieza el 1 de enero y el 31 de
            // diciembre de ese año sigue dentro del rango.
            const delAnio = ((p.y % 4 === 0 && p.y % 100 !== 0) || p.y % 400 === 0) ? 366 : 365;
            if (p.m === 1 && p.d === 1 && quedan >= delAnio) {
                tramos.push({
                    tipo: "anio", filtro: `/${p.y}`, etiqueta: String(p.y),
                    dias: delAnio, desde: p.iso, hasta: dias[i + delAnio - 1].iso
                });
                i += delAnio;
                continue;
            }

            const delMes = ULTIMO_DIA(p.y, p.m);
            if (p.d === 1 && quedan >= delMes) {
                tramos.push({
                    tipo: "mes", filtro: `${dos(p.m)}/${p.y}`, etiqueta: `${dos(p.m)}/${p.y}`,
                    dias: delMes, desde: p.iso, hasta: dias[i + delMes - 1].iso
                });
                i += delMes;
                continue;
            }

            tramos.push({
                tipo: "dia", filtro: p.fecha, etiqueta: p.fecha,
                dias: 1, desde: p.iso, hasta: p.iso
            });
            i += 1;
        }
        return {
            desde: r.desde, hasta: r.hasta, tramos,
            dias: dias.length,
            // El aviso ahora mira PETICIONES, no días: un año son 365 días y
            // una sola petición, y avisar «365 consultas» sería mentir.
            largo: tramos.length > CONFIG.rangoLargoTramos
        };
    }

    /* =====================================================================
       4 · CARGA COMPLETA
       ---------------------------------------------------------------------
       Dos decisiones que importan con 200.000+ registros:

       · Se ordena por id DESCENDENTE (ver el comentario de `paginaPedida`:
         es el único valor que hemos visto responder contra el servidor
         real). Lo que eso cuesta —que un registro nuevo durante la descarga
         corra las páginas y se repitan o se pierdan filas— lo cubre el
         deduplicado por `id`, que es la única garantía real.

         A cambio, DESC da gratis algo que la herramienta necesita: la
         página 1 son los registros MÁS NUEVOS. Por eso «últimos N» (la
         carga por defecto) es simplemente leer sin filtro hasta juntar N,
         y no hay que recorrer 200.000 filas para ver las de hoy.

       · Se DESCARTAN `request` y `response`. Son el SOAP/JSON crudo de cada
         operación: unos 2 KB por registro, que a 200.000 registros son
         cientos de megas solo para tenerlos guardados sin mirarlos. La
         herramienta los vuelve a pedir, de a una página, cuando alguien abre
         el detalle de una fila.

       Con rango, cada TRAMO (ver `tramosDeRango`: un año, un mes o un día)
       es una serie completa e independiente de páginas, con su propia
       primera página, su propio `count` y su propio `pageSize` concedido.
       La deduplicación por `id` es UNA sola para toda la carga y NO se
       reinicia por tramo: un registro en el límite de dos tramos puede caer
       en dos consultas contiguas (zona horaria del servidor, reintentos), y
       contarlo dos veces ensuciaría la tabla.
    ===================================================================== */
    const LIGERO = ["id", "fechaHoraTransaccion", "tipoOperacion", "linea",
        "canal", "documento", "resultado", "usuario", "descripcionResultado"];

    function aligerar(item) {
        const o = {};
        LIGERO.forEach(k => { o[k] = item[k]; });
        return o;
    }

    /**
     * Trae las páginas de FechaExpedicion: un rango de fechas, los N más
     * nuevos, o la tabla entera.
     *
     * Hay TRES formas de llamarla, y conviene elegir a conciencia:
     *
     *   cargarTodo({desde, hasta})  un rango, descompuesto en tramos
     *   cargarTodo({tope: 2000})    los 2.000 más nuevos (4 peticiones)
     *   cargarTodo({})              TODO (200.000+ registros; muy lento)
     *
     * @param {object} opciones
     *   - desde, hasta: acotan la carga a un rango de fechas, AMBOS
     *     extremos incluidos. Cada uno es una cadena "YYYY-MM-DD" (la forma
     *     recomendada) o un Date (se usa su día LOCAL). Se piden los dos o
     *     ninguno. El rango se descompone en tramos (año/mes/día) con
     *     `tramosDeRango`, así que un mes completo cuesta UNA serie de
     *     peticiones y no 31.
     *   - tope: corta la carga al juntar esos registros. Como el orden es
     *     DESC, son los MÁS NUEVOS, y es la forma barata de arrancar («los
     *     últimos 2.000» son 4 peticiones). Llegar al tope NO es cancelar:
     *     `completo` sigue en true y lo que lo cuenta es `topeAlcanzado`.
     *     Se combina con el rango si se quiere «los últimos N de marzo».
     *   - alLote(nuevos) con los registros NUEVOS de cada página, para que
     *     quien llama los pinte mientras siguen llegando. Si se pasa, este
     *     módulo NO se los queda: con 200.000 registros, guardarlos aquí y
     *     además en la tabla es duplicar cientos de megas para nada.
     *   - alProgresar(p) por cada página, con
     *       {leidos, total, pagina, paginas}           (siempre; no cambian)
     *       {tramo, tramos, etiqueta, granularidad,
     *        leidosTramo, totalTramo, tope, fraccion}  (añadidos)
     *     `pagina`/`paginas` son las del tramo en curso; `etiqueta` es cómo
     *     se llama ese tramo ("12/03/2026", "03/2026", "2026") y
     *     `granularidad` es "dia" | "mes" | "anio". `leidos` y `total` son
     *     de TODA la carga; con rango, `total` suma los `count` de los
     *     tramos ya consultados, así que CRECE a medida que se avanza (no se
     *     puede saber lo que tiene un tramo sin preguntarle): no lo uses
     *     solo para un porcentaje, para eso está `fraccion` (0 a 1). Sin
     *     rango, `tramo`, `tramos`, `etiqueta` y `granularidad` son null.
     *   - cancelado() -> true para cortar entre páginas y entre tramos
     *   - tam: tamaño de página a pedir (el servidor puede conceder menos)
     *   - filtro: campos extra para la cabecera `pagination`; si hay rango,
     *     `filter` y `filterValue` los pone el rango y mandan sobre estos.
     * @returns {{registros: Array, total: number, completo: boolean,
     *            leidos: number, cancelado: boolean, tope: number|null,
     *            topeAlcanzado: boolean, rango: object|null,
     *            tramosTotal: number|null, tramosRecorridos: number|null,
     *            consultas: number, detalleTramos: Array}}
     *   `registros` viene vacío si se usó `alLote` (los tiene quien llamó).
     *   `completo` es false SOLO si se canceló (no si se llegó al tope).
     *   Con rango: `tramosRecorridos` son los tramos leídos hasta el final
     *   (uno cortado a medias NO cuenta), `tramosTotal` los del rango,
     *   `rango` = {desde, hasta, dias, largo} y `detalleTramos` =
     *   [{etiqueta, tipo, total, leidos, completo}] de los que se llegaron a
     *   consultar. `total` suma solo los tramos consultados: si se canceló,
     *   los que faltaban no están en la cuenta. `consultas` es cuántas
     *   peticiones HTTP se hicieron. Sin rango, `rango`, `tramosTotal` y
     *   `tramosRecorridos` son null.
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
        const rango = (o.desde != null || o.hasta != null) ? tramosDeRango(o.desde, o.hasta) : null;
        const tramos = rango ? rango.tramos : [null];
        if (rango) {
            const n = tramos.length;
            const serie = `${n} serie${n === 1 ? "" : "s"} de consultas (${rango.dias} día${rango.dias === 1 ? "" : "s"})`;
            if (rango.largo) {
                log(`⚠ Rango ${rango.desde} a ${rango.hasta}: ${serie}, más páginas si algún tramo `
                    + `trae mucho. Va a tardar; se puede cancelar.`, "warn");
            } else {
                log(`Rango ${rango.desde} a ${rango.hasta}: ${serie} · ${tramos.map(t => t.etiqueta).join(", ")}.`, "info");
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

        /* Tope de registros: la carga por defecto («los últimos N») es leer
           sin filtro de fecha hasta juntar N. Funciona porque el orden es
           DESC y la página 1 son los más nuevos. Se corta EXACTO en N y no
           «en la página donde se pase», para que «últimos 2.000» sean 2.000
           y no 2.000 y pico: la diferencia se nota en la tabla y en lo que
           dice el contador. */
        const tope = Math.max(0, Number(o.tope) || 0);
        let topeAlcanzado = false;

        const agregar = items => {
            const cupo = tope ? tope - leidos : Infinity;
            const nuevos = [];
            items.forEach(it => {
                if (nuevos.length >= cupo) return;
                if (!it || it.id == null || vistos.has(it.id)) return;
                vistos.add(it.id);
                nuevos.push(aligerar(it));
            });
            leidos += nuevos.length;
            if (tope && leidos >= tope) topeAlcanzado = true;
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
        let tramosRecorridos = 0;
        const detalleTramos = [];

        for (let i = 0; i < tramos.length; i++) {
            const tramo = tramos[i];
            /* Entre tramos se mira `cancelado` ANTES de empezar el siguiente:
               si no, cancelar en el último segundo de un tramo dispararía
               igual la primera petición del que viene. */
            if (tramo && cancelado()) { completo = false; break; }

            const filtro = tramo ? Object.assign({}, o.filtro, filtroDeTramo(tramo)) : o.filtro;

            const primera = await pedir(1, tamPedido, filtro);
            const totalTramo = Number(primera.paginacion && primera.paginacion.count) || primera.items.length;

            /* Cuánto concedió DE VERDAD el servidor. Si se pide 500 y entrega 100,
               avanzar de 500 en 500 se saltaría cuatro de cada cinco registros, y
               la carga quedaría incompleta sin que nada lo avisara. Se calcula en
               cada tramo, porque cada tramo arranca con su propia primera
               página y nada garantiza que el servidor conceda lo mismo. */
            const eco = Number(primera.paginacion && primera.paginacion.pageSize) || 0;
            const tam = primera.items.length
                ? Math.min(eco || primera.items.length, primera.items.length)
                : tamPedido;
            if (tam !== tamPedido && tam !== tamAvisado) {
                tamAvisado = tam;
                log(`Genesis concede páginas de ${tam} (se pidieron ${tamPedido}); se ajusta el recorrido.`, "info");
            }

            const leidosAntesTramo = leidos;
            const paginas = Math.max(1, Math.ceil(totalTramo / tam));

            const avisar = pagina => {
                const total = totalPrevio + totalTramo;
                alProgresar({
                    leidos, total, pagina, paginas,
                    tramo: tramo ? i + 1 : null,
                    tramos: tramo ? tramos.length : null,
                    etiqueta: tramo ? tramo.etiqueta : null,
                    granularidad: tramo ? tramo.tipo : null,
                    leidosTramo: leidos - leidosAntesTramo,
                    totalTramo,
                    tope: tope || null,
                    // Avance real de 0 a 1. Con rango el `total` va creciendo y
                    // leidos/total daría ~100% en cada tramo; esto cuenta los
                    // tramos cerrados más la fracción de páginas del actual.
                    fraccion: tope
                        ? Math.min(1, leidos / tope)
                        : (tramo
                            ? Math.min(1, (i + pagina / paginas) / tramos.length)
                            : (total ? Math.min(1, leidos / total) : 0))
                });
            };

            agregar(primera.items);
            avisar(1);

            let tramoCompleto = true;
            for (let n = 2; n <= paginas && !topeAlcanzado; n++) {
                if (cancelado()) { tramoCompleto = false; completo = false; break; }
                const p = await pedir(n, tam, filtro);
                if (!p.items.length) break;          // el servidor se quedó sin datos antes de la cuenta
                agregar(p.items);
                avisar(n);
            }

            totalPrevio += totalTramo;
            if (tramo) {
                detalleTramos.push({
                    etiqueta: tramo.etiqueta, tipo: tramo.tipo, total: totalTramo,
                    leidos: leidos - leidosAntesTramo, completo: tramoCompleto
                });
                if (tramoCompleto) {
                    tramosRecorridos++;
                    log(`Tramo ${i + 1}/${tramos.length} · ${tramo.etiqueta}: `
                        + `${totalTramo.toLocaleString("es-CO")} registros.`, "info");
                }
            }
            if (!tramoCompleto) break;
            /* Llegar al tope NO es cancelar: es haber traído lo que se pidió.
               Por eso `completo` sigue en true y lo que se informa aparte es
               `topeAlcanzado`, para que quien llama pueda decir «2.000 de
               los N que hay, los más nuevos» —con la N que haya devuelto el
               servidor en `total`— en vez de «carga incompleta». */
            if (topeAlcanzado) break;
        }

        if (rango && !completo) {
            log(`Rango cortado: ${tramosRecorridos} de ${tramos.length} tramos leídos por completo.`, "warn");
        }

        return {
            registros: retenidos || [], total: totalPrevio, completo, leidos,
            cancelado: !completo, tope: tope || null, topeAlcanzado,
            rango: rango ? { desde: rango.desde, hasta: rango.hasta, dias: rango.dias, largo: rango.largo } : null,
            tramosTotal: rango ? tramos.length : null,
            tramosRecorridos: rango ? tramosRecorridos : null,
            consultas, detalleTramos
        };
    }

    /**
     * Vuelve a pedir el registro completo de un id, para ver su SOAP crudo
     * (`cargarTodo` descarta `request` y `response` para no cargar cientos de
     * megas que nadie mira).
     *
     * @param {number|string} id
     * @param {object|number} opciones  {fecha, tam}. Por compatibilidad, un
     *   número se interpreta como `tam`.
     *   - fecha: la fecha del registro. Vale el `fechaHoraTransaccion` tal
     *     como viene ("2026-03-12T19:40:05.767"), un "YYYY-MM-DD" o un Date.
     *     PÁSALA SIEMPRE que la tengas: es la diferencia entre encontrarlo y
     *     no encontrarlo (abajo se explica).
     *
     * Con la fecha se acota al día y se recorren sus páginas: un día son
     * cientos de registros, así que son una o dos peticiones y el resultado
     * es exacto.
     *
     * Sin la fecha hay que ADIVINAR la página, y con el orden DESC adivinar
     * es frágil: la página de un id es `ceil((idMayor - id + 1) / tam)`, que
     * necesita saber el id mayor (una petición más) y además supone que los
     * ids no tienen huecos. Si hay huecos —y los hay en cuanto se borra algo—
     * el cálculo se desvía y el registro no aparece. Antes se calculaba
     * `ceil(id / tam)`, que era lo correcto para ASCENDENTE y dejó de serlo
     * al pasar a DESC: no encontraba nada. Por eso este camino es el de
     * último recurso y puede devolver null legítimamente.
     */
    async function detalleDe(id, opciones) {
        const o = (opciones && typeof opciones === "object") ? opciones : { tam: opciones };
        const tamPedido = Math.max(1, Number(o.tam) || CONFIG.paginaTam);
        const dia = o.fecha != null ? diaDe(o.fecha) : null;
        return dia ? buscarEnElDia(id, dia, tamPedido) : adivinarPagina(id, tamPedido);
    }

    /** Tolera lo que traiga la fila: "2026-03-12T19:40:05.767", "2026-03-12"
        o un Date. Devuelve null en vez de lanzar: no encontrar el detalle de
        una fila no debe tumbar la pantalla. */
    function diaDe(valor) {
        try {
            const v = typeof valor === "string" ? valor.slice(0, 10) : valor;
            return partesDeFecha(v, "fecha");
        } catch (e) { return null; }
    }

    /** Recorre las páginas de UN día buscando el id. Con el tamaño que el
        servidor CONCEDE, no con el pedido: si se piden 500 y concede 100,
        avanzar de 500 en 500 se saltaría cuatro de cada cinco páginas. */
    async function buscarEnElDia(id, dia, tamPedido) {
        const filtro = filtroDeTramo({ filtro: fechaGenesis(dia) });
        let paginas = 1;
        for (let n = 1; n <= paginas && n <= CONFIG.detalleMaxPaginas; n++) {
            const p = await pedirPagina(n, tamPedido, filtro);
            const hit = p.items.find(x => String(x.id) === String(id));
            if (hit) return hit;
            if (!p.items.length) break;
            if (n === 1) {
                const eco = Number(p.paginacion && p.paginacion.pageSize) || p.items.length;
                const tam = Math.max(1, Math.min(eco, p.items.length));
                const total = Number(p.paginacion && p.paginacion.count) || p.items.length;
                paginas = Math.max(1, Math.ceil(total / tam));
            }
        }
        return null;
    }

    /** Último recurso, sin fecha. Ver la advertencia de `detalleDe`. */
    async function adivinarPagina(id, tamPedido) {
        const cabeza = await pedirPagina(1, 1);            // con DESC, el id mayor
        const mayor = Number(cabeza.items[0] && cabeza.items[0].id);
        if (!mayor || !Number.isFinite(Number(id))) return null;
        const eco = Number(cabeza.paginacion && cabeza.paginacion.pageSize) || 1;
        const tam = Math.max(1, Math.min(tamPedido, eco === 1 ? tamPedido : eco));
        const n = Math.max(1, Math.ceil((mayor - Number(id) + 1) / tam));
        for (const intento of [n, n + 1, n - 1]) {
            if (intento < 1) continue;
            const p = await pedirPagina(intento, tam);
            const hit = p.items.find(x => String(x.id) === String(id));
            if (hit) return hit;
        }
        return null;
    }

    function configurar(opciones) { Object.assign(CONFIG, opciones || {}); return CONFIG; }

    global.GENESIS = {
        CONFIG, auth, cargarTodo, detalleDe, pedirPagina,
        configurar, vencimientoJwt, usuarioJwt,
        // para avisar «son N consultas» ANTES de cargar
        tramosDeRango, rangoDias, fechaGenesis
    };
})(window);
