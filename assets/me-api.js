/* =====================================================================
   me-api.js · Acceso al CM — común a las herramientas de esta suite
   ---------------------------------------------------------------------
   Aquí vive TODO lo que antes estaba copiado en cada archivo:

     · las direcciones del API (OBP) y de Keycloak
     · las cabeceras que el CM espera (locale, spid, tenant)
     · el objeto `auth`: login, refresh, renovación proactiva y re-auth en 401
     · getJson() para consultas y api() para PATCH/POST/PUT

   Si mañana cambia una URL, el realm o una cabecera, se cambia UNA vez
   en este archivo y las cuatro herramientas quedan al día.

   Se carga DESPUÉS de me-ui.js y ANTES de la lógica de cada herramienta.
===================================================================== */
(function (global) {
    "use strict";

    const CONFIG = {
        apiBase: "http://obp-apigw.exito-prod.movil-exito.internal",
        kcBase: "http://keycloak.exito-prod.movil-exito.internal",
        realm: "optiva",
        clientId: "optiva",

        // Cabeceras del CM. locale lo cambia cada herramienta si lo necesita.
        locale: "es",
        spid: "410",
        tenant: "optiva",

        // De dónde salen usuario y clave. Se prueba en orden: así sirve para
        // los cuatro archivos sin configurar nada.
        camposUsuario: ["#cfgUser", "#user", "#username"],
        camposClave: ["#cfgPass", "#pass", "#password"],

        // Margen para renovar el token antes de que venza (segundos)
        margenRenovacion: 30
    };

    const log = (m, n) => (global.MEUI ? global.MEUI.log(m, n) : console.log(m));

    const primerCampo = selectores => {
        for (const s of selectores) {
            const el = document.querySelector(s);
            if (el) return el;
        }
        return null;
    };

    /** Cabeceras estándar del CM; `extra` sobreescribe lo que haga falta. */
    function cabeceras(extra) {
        return Object.assign({
            "Accept": "application/json",
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "locale": CONFIG.locale,
            "spid": CONFIG.spid,
            "tenant": CONFIG.tenant
        }, extra || {});
    }

    /* =====================================================================
       Sesión del CM (Keycloak direct grant + re-auth en 401)
    ===================================================================== */
    const auth = {
        token: null, refreshToken: null, username: null, password: null,
        version: 0, expiresAt: null, _renovando: null,

        async _tokenRequest(data) {
            const url = `${CONFIG.kcBase}/auth/realms/${CONFIG.realm}/protocol/openid-connect/token`;
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(data)
            });
            if (!r.ok) {
                const t = await r.text();
                throw new Error(`Keycloak ${r.status}: ${t.slice(0, 300)}`);
            }
            return r.json();
        },

        // Guarda el token, calcula cuándo renovarlo y avisa a la cabecera.
        _guardar(tok) {
            this.token = tok.access_token;
            this.refreshToken = tok.refresh_token || this.refreshToken;
            const vida = tok.expires_in || 300;
            this.expiresAt = Date.now() + (vida - CONFIG.margenRenovacion) * 1000;
            this.version++;
            if (global.MEUI) {
                global.MEUI.sesion.set("cm", { usuario: this.username || "CM", duracion: vida });
            }
            if (typeof global.pintarSesion === "function") {
                try { global.pintarSesion(); } catch (e) { }
            }
        },

        async _login() {
            await this._tokenRequest({
                grant_type: "password", client_id: CONFIG.clientId,
                username: this.username, password: this.password, scope: "openid"
            }).then(t => this._guardar(t));
        },

        async _refresh() {
            await this._tokenRequest({
                grant_type: "refresh_token", client_id: CONFIG.clientId,
                refresh_token: this.refreshToken
            }).then(t => this._guardar(t));
        },

        /** Toma usuario y clave de los campos de la página. */
        leerCampos() {
            const u = primerCampo(CONFIG.camposUsuario);
            const p = primerCampo(CONFIG.camposClave);
            this.username = (u && u.value.trim()) || null;
            this.password = (p && p.value) || null;
        },

        /** Garantiza un token válido; renueva antes de que venza. */
        async ensure() {
            if (!this.token) {
                this.leerCampos();
                if (!(this.username && this.password))
                    throw new Error("No hay token ni usuario/clave del CM.");
                await this._login();
                log("✔ Token CM obtenido de Keycloak.", "ok");
            } else if (this.expiresAt && Date.now() >= this.expiresAt) {
                try { await this.reauth(this.version); }
                catch (e) { log("⚠ No se pudo refrescar el token del CM: " + e.message, "warn"); }
            }
            return { token: this.token, version: this.version };
        },

        /** Renueva una sola vez aunque la llamen N consultas en paralelo. */
        async reauth(seenVersion) {
            if (this.version !== seenVersion) return true;
            if (this._renovando) { await this._renovando; return true; }
            this._renovando = (async () => {
                try {
                    if (this.refreshToken) {
                        try { await this._refresh(); log("✔ Token CM renovado (refresh).", "ok"); return; }
                        catch (e) { /* cae a login */ }
                    }
                    this.leerCampos();
                    if (this.username && this.password) {
                        await this._login(); log("✔ Token CM renovado (login).", "ok"); return;
                    }
                    if (global.MEUI) global.MEUI.sesion.caida("cm");
                    throw new Error("No fue posible renovar el token del CM.");
                } finally { this._renovando = null; }
            })();
            await this._renovando;
            return true;
        },

        salir() {
            this.token = null; this.refreshToken = null; this.expiresAt = null; this.version++;
            if (global.MEUI) global.MEUI.sesion.cerrar("cm", false);
        }
    };

    /* =====================================================================
       Llamadas
    ===================================================================== */
    /** GET autenticado. `url` absoluta (o ruta si empieza por «/»). */
    async function getJson(url, params) {
        const destino = url.charAt(0) === "/" ? CONFIG.apiBase + url : url;
        for (let intento = 1; intento <= 2; intento++) {
            const { token, version } = await auth.ensure();
            const qs = params ? "?" + new URLSearchParams(params) : "";
            const r = await fetch(destino + qs, {
                headers: cabeceras({ "Authorization": "Bearer " + token })
            });
            if (r.status === 401 && intento === 1 && await auth.reauth(version)) continue;
            if (!r.ok) {
                const t = await r.text();
                const err = new Error(`Error ${r.status} en ${destino}: ${t.slice(0, 200)}`);
                err.status = r.status; err.cuerpo = t;
                throw err;
            }
            return r.json();
        }
        throw new Error("No se pudo autenticar para " + destino);
    }

    /** Llamada con método/cuerpo (PATCH, POST, PUT…). Devuelve JSON o texto. */
    async function api(ruta, opciones) {
        const o = opciones || {};
        const destino = ruta.charAt(0) === "/" ? CONFIG.apiBase + ruta : ruta;
        for (let intento = 1; intento <= 2; intento++) {
            const ses = await auth.ensure();
            const qs = o.params ? "?" + new URLSearchParams(o.params) : "";
            const r = await fetch(destino + qs, {
                method: o.method || "GET",
                headers: cabeceras(Object.assign({ "Authorization": "Bearer " + ses.token }, o.headers)),
                body: o.body
            });
            if (r.status === 401 && intento === 1 && await auth.reauth(ses.version)) continue;
            const texto = await r.text();
            if (!r.ok) {
                const err = new Error(`HTTP ${r.status} en ${ruta}: ${texto.slice(0, 300)}`);
                err.status = r.status; err.cuerpo = texto;
                throw err;
            }
            try { return texto ? JSON.parse(texto) : null; } catch (e) { return texto; }
        }
        throw new Error("No se pudo autenticar para " + ruta);
    }

    /** Ajustes por herramienta: MEAPI.configurar({ locale:"en" }) */
    function configurar(opciones) { Object.assign(CONFIG, opciones || {}); return CONFIG; }

    global.MEAPI = { CONFIG, auth, getJson, api, cabeceras, configurar };
})(window);