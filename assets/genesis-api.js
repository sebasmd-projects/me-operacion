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
       3 · CARGA COMPLETA
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
    ===================================================================== */
    const LIGERO = ["id", "fechaHoraTransaccion", "tipoOperacion", "linea",
        "canal", "documento", "resultado", "usuario", "descripcionResultado"];

    function aligerar(item) {
        const o = {};
        LIGERO.forEach(k => { o[k] = item[k]; });
        return o;
    }

    /**
     * Trae TODAS las páginas de FechaExpedicion.
     * @param {object} opciones
     *   - alLote(nuevos) con los registros NUEVOS de cada página, para que
     *     quien llama los pinte mientras siguen llegando. Si se pasa, este
     *     módulo NO se los queda: con 200.000 registros, guardarlos aquí y
     *     además en la tabla es duplicar cientos de megas para nada.
     *   - alProgresar({leidos, total, pagina, paginas}) por cada página
     *   - cancelado() -> true para cortar entre páginas
     *   - tam: tamaño de página a pedir (el servidor puede conceder menos)
     * @returns {{registros: Array, total: number, completo: boolean}}
     *   `registros` viene vacío si se usó `alLote` (los tiene quien llamó).
     */
    async function cargarTodo(opciones) {
        const o = opciones || {};
        const tamPedido = Math.max(1, Number(o.tam) || CONFIG.paginaTam);
        const alProgresar = typeof o.alProgresar === "function" ? o.alProgresar : () => { };
        const cancelado = typeof o.cancelado === "function" ? o.cancelado : () => false;
        const alLote = typeof o.alLote === "function" ? o.alLote : null;

        const primera = await pedirPagina(1, tamPedido, o.filtro);
        const total = Number(primera.paginacion && primera.paginacion.count) || primera.items.length;

        /* Cuánto concedió DE VERDAD el servidor. Si se pide 500 y entrega 100,
           avanzar de 500 en 500 se saltaría cuatro de cada cinco registros, y
           la carga quedaría incompleta sin que nada lo avisara. */
        const eco = Number(primera.paginacion && primera.paginacion.pageSize) || 0;
        const tam = primera.items.length
            ? Math.min(eco || primera.items.length, primera.items.length)
            : tamPedido;
        if (tam !== tamPedido) {
            log(`Genesis concede páginas de ${tam} (se pidieron ${tamPedido}); se ajusta el recorrido.`, "info");
        }

        /* El deduplicado necesita recordar qué ids ya se vieron, pero NO los
           registros: un Set de números cuesta una fracción de lo que cuesta
           guardar 200.000 objetos que ya tiene la tabla. Solo se retienen
           cuando nadie los está recogiendo con `alLote`. */
        const vistos = new Set();
        const retenidos = alLote ? null : [];
        let leidos = 0;

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

        agregar(primera.items);

        const paginas = Math.max(1, Math.ceil(total / tam));
        alProgresar({ leidos, total, pagina: 1, paginas });

        let completo = true;
        for (let n = 2; n <= paginas; n++) {
            if (cancelado()) { completo = false; break; }
            const p = await pedirPagina(n, tam, o.filtro);
            if (!p.items.length) break;          // el servidor se quedó sin datos antes de la cuenta
            agregar(p.items);
            alProgresar({ leidos, total, pagina: n, paginas });
        }

        return { registros: retenidos || [], total, completo, leidos };
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
        configurar, vencimientoJwt, usuarioJwt
    };
})(window);
