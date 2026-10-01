/* =====================================================================
   hlr-consulta.js · ¿En qué HLR está la línea? (Claro / Tigo / Ambos)
   ---------------------------------------------------------------------
   Motor compartido: por cada MSISDN consulta EN PARALELO el QDN de Claro
   (OAuth2) y el HLR de Tigo (X-Api-Key), y concluye en cuál de las dos
   redes está la línea — o en ninguna.

   ATENCIÓN · ESTO ES UNA TERCERA COPIA DE LAS MISMAS REGLAS.
   Las otras dos son `logica-hlr-cruzado.js` («¿En qué HLR está?») y
   `logica-hlr-hss-ambos.js` (pestaña «Ambos» de HLR/HSS), que ya eran
   copias deliberadas entre sí. El texto de los ambientes, del gestor de
   token, de las dos consultas y de la conclusión se copió de ahí SIN
   cambiar una línea: cualquier diferencia introducida aquí sería una
   regla de negocio distinta que nadie decidió.

   Si se cambia una regla (un RETCODE nuevo, otra conclusión, otro
   ambiente), hay que cambiarla en las TRES. Lo sano sería que las tres
   pasaran a usar este archivo; no se hizo en el mismo cambio que lo creó
   porque tocar dos herramientas en producción que no se pueden probar
   contra los gateways reales es un riesgo que no hace falta correr hoy.

   Va dentro de un IIFE y se publica como `window.HLRConsulta`: comparte
   página con la lógica de la herramienta y no pueden declarar los mismos
   nombres globales.

   Depende de me-ui.js (MEUI) solo para el registro.
===================================================================== */
(function (global) {
    "use strict";

    const AMBIENTE_CLARO = {
        token_url: "https://apim.claro.com.co/MsCommunicatAuthToken/User/authenticate",
        client_id: "MOVILEXITO",
        client_secret: "ebaee6c9-513b-4ee6-abc4-c88924006bb8",
        base_apigw: "https://msapigateway-nm-apigateway-aro-prod.apps.prd-claro-co.eastus2.aroapp.io",
        auth_en_cuerpo: true,
        api_usuario: "exitoapi",
        api_clave: "exitoapi"
    };
    const RUTA_QDN_CLARO = "/APIMParOrdeConsQDN/MS/CUS/Customer/RSParOrdeConsQDN/V1/ValideQDN/";

    const AMBIENTE_TIGO = {
        base_url: "https://tulioqa.grupo-exito.com/apimew/api/v1/autogestion/HLR/consulta",
        api_key: "5tVBWu5xdItBcC/4x9ohCBoEQTZ+PCiTpinT1hT+1eeiOCmq7dr+CZgZprcklYN4FJmPJBHoE1C6gkEYA2pqfA=="
    };

    const cfgCruce = {
        claro: Object.assign({}, AMBIENTE_CLARO, { timeoutMs: 30000, reintentos: 2 }),
        tigo: Object.assign({}, AMBIENTE_TIGO, { timeoutMs: 30000, reintentos: 2 }),
        concurrencia: 5 // cada línea dispara 2 peticiones (Claro + Tigo) en paralelo
    };

    const gestorClaro = {
        token: null, exp: 0, renovando: null,

        intentos(cfg) {
            const basic = btoa(`${cfg.client_id}:${cfg.client_secret}`);
            const form = { "Content-Type": "application/x-www-form-urlencoded" };
            const enCuerpo = ["client_credentials en el cuerpo", {
                headers: form,
                body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.client_id, client_secret: cfg.client_secret })
            }];
            const enCabecera = ["Basic + client_credentials", {
                headers: Object.assign({}, form, { Authorization: "Basic " + basic }),
                body: new URLSearchParams({ grant_type: "client_credentials" })
            }];
            const lista = [];
            if (cfg.auth_en_cuerpo) lista.push(enCuerpo, enCabecera);
            else {
                lista.push(["JSON username/password", {
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: cfg.client_id, password: cfg.client_secret })
                }]);
                lista.push(enCabecera, enCuerpo);
            }
            if (cfg.api_usuario) {
                lista.push(["password grant con usuario de API", {
                    headers: form,
                    body: new URLSearchParams({
                        grant_type: "password", client_id: cfg.client_id, client_secret: cfg.client_secret,
                        username: cfg.api_usuario, password: cfg.api_clave || ""
                    })
                }]);
            }
            lista.push(["JSON clientId/clientSecret", {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: cfg.client_id, clientSecret: cfg.client_secret })
            }]);
            return lista;
        },

        extraerToken(obj, profundidad) {
            profundidad = profundidad || 0;
            if (profundidad > 4 || obj == null) return null;
            const llaves = ["access_token", "accessToken", "token", "id_token", "jwt", "access_Public", "api_request"];
            if (typeof obj === "object" && !Array.isArray(obj)) {
                for (const k of llaves) if (typeof obj[k] === "string" && obj[k].length > 20) return obj[k];
                for (const v of Object.values(obj)) { const r = this.extraerToken(v, profundidad + 1); if (r) return r; }
            } else if (Array.isArray(obj)) {
                for (const v of obj) { const r = this.extraerToken(v, profundidad + 1); if (r) return r; }
            }
            return null;
        },

        async solicitar(cfg) {
            let ultimo = null;
            for (const [nombre, opts] of this.intentos(cfg)) {
                try {
                    const r = await fetch(cfg.token_url, Object.assign({ method: "POST" }, opts));
                    const texto = await r.text();
                    let cuerpo; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { cuerpo = texto; }
                    if (r.ok) {
                        const token = typeof cuerpo === "string" ? cuerpo : this.extraerToken(cuerpo);
                        if (token) {
                            this.token = token;
                            const vida = (cuerpo && cuerpo.expires_in) ? Number(cuerpo.expires_in) : 1500;
                            this.exp = Date.now() + Math.max(30, vida - 30) * 1000;
                            return token;
                        }
                        ultimo = nombre + ": respuesta 200 sin token";
                    } else ultimo = nombre + `: HTTP ${r.status}`;
                } catch (e) { ultimo = nombre + ": " + e.message; }
            }
            throw new Error("No se pudo obtener el token Claro. Último error → " + ultimo);
        },

        async obtener(cfg, forzar) {
            if (!forzar && this.token && Date.now() < this.exp) return this.token;
            if (this.renovando) return this.renovando;
            this.renovando = this.solicitar(cfg).finally(() => { this.renovando = null; });
            return this.renovando;
        },

        reset() { this.token = null; this.exp = 0; }
    };

    async function consultarClaroUnaVez(msisdn, cfg, token) {
        const url = cfg.base_apigw.replace(/\/$/, "") + RUTA_QDN_CLARO + msisdn;
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
        try {
            const r = await fetch(url, {
                method: "GET", signal: controlador.signal,
                headers: {
                    "Accept": "application/json", "Authorization": "Bearer " + token,
                    "transactionId": (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())
                }
            });
            const texto = await r.text();
            let cuerpo = null; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
            return { ok: r.ok, status: r.status, cuerpo, texto };
        } finally { clearTimeout(temporizador); }
    }

    async function consultarClaro(msisdn, cfg) {
        let intentos = 0;
        while (true) {
            intentos++;
            let token;
            try { token = await gestorClaro.obtener(cfg); }
            catch (e) { return { fuente: "claro", estado: "ERROR", mensaje: "Autenticación: " + e.message, raw: null }; }

            let resp;
            try { resp = await consultarClaroUnaVez(msisdn, cfg, token); }
            catch (e) {
                const esTimeout = e && e.name === "AbortError";
                if (esTimeout && intentos < cfg.reintentos + 1) continue;
                if (esTimeout) return { fuente: "claro", estado: "TIMEOUT", mensaje: "Se agotaron los reintentos por timeout.", raw: null };
                return { fuente: "claro", estado: "ERROR", mensaje: "Error de comunicación: " + (e.message || e), raw: null };
            }

            if (resp.status === 401 || resp.status === 403) { gestorClaro.reset(); if (intentos === 1) continue; }

            if (!resp.ok) return { fuente: "claro", estado: "ERROR", mensaje: "HTTP " + resp.status, raw: resp.cuerpo };
            const res = resp.cuerpo && resp.cuerpo.result;
            if (!res) return { fuente: "claro", estado: "ERROR", mensaje: "Respuesta sin 'result'.", raw: resp.cuerpo };

            const operationalState = (res.operationalState || "").toLowerCase();
            const estado = operationalState === "active" ? "ACTIVA" : "INACTIVA";
            const nota = Array.isArray(res.note) ? res.note.map(n => n.text).filter(Boolean).join(" · ") : "";
            // Mismo endpoint que logica-qdn.js: el detalle completo (categorías,
            // bloqueos) se consulta allá; aquí solo se rescata el IMSI para el
            // título del modal.
            const rc = Array.isArray(res.resourceCharacteristic) ? res.resourceCharacteristic : [];
            const imsiCar = rc.find(c => c.name === "UDC_PRSSIMCD-imsi" || c.name === "UDC_SRV5GNE-imsi");
            const imsi = imsiCar && imsiCar.value ? imsiCar.value : null;
            return { fuente: "claro", estado, operationalState, mensaje: nota, imsi, raw: resp.cuerpo };
        }
    }

    function extraerRetcode(texto) {
        const m = String(texto || "").match(/RETCODE\s*=\s*(\d+)\s*(.*)/i);
        return m ? { retcode: m[1], retmsg: (m[2] || "").split(/\r?\n/)[0] } : { retcode: null, retmsg: "" };
    }

    const RETCODES_TIGO = { "0": "ACTIVA", "3001": "SIN_PERFIL", "1033": "RESIDUO_TIGO" };

    /** Arma el valor `Linea` tal como lo espera Tigo (con indicativo 57). */
    function lineaTigo(msisdn) { return msisdn.indexOf("57") === 0 ? msisdn : "57" + msisdn; }

    async function consultarTigoUnaVez(linea, cfg) {
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
        try {
            const r = await fetch(cfg.base_url, {
                method: "POST", signal: controlador.signal,
                headers: { "Content-Type": "application/json", "X-Api-Key": cfg.api_key },
                body: JSON.stringify({
                    TransactionID: String(Date.now()) + Math.floor(Math.random() * 1000),
                    FechaConsulta: new Date().toISOString(), Linea: linea
                })
            });
            const texto = await r.text();
            let cuerpo = null; try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { }
            return { ok: r.ok, status: r.status, cuerpo, texto };
        } finally { clearTimeout(temporizador); }
    }

    async function consultarTigo(msisdn, cfg) {
        let intentos = 0;
        const linea = lineaTigo(msisdn);
        while (true) {
            intentos++;
            let resp;
            try { resp = await consultarTigoUnaVez(linea, cfg); }
            catch (e) {
                const esTimeout = e && e.name === "AbortError";
                if (esTimeout && intentos < cfg.reintentos + 1) continue;
                if (esTimeout) return { fuente: "tigo", estado: "TIMEOUT", mensaje: "Se agotaron los reintentos por timeout.", raw: null };
                return { fuente: "tigo", estado: "ERROR", mensaje: "Error de comunicación: " + (e.message || e), raw: null };
            }
            if (!resp.ok || !resp.cuerpo) return { fuente: "tigo", estado: "ERROR", mensaje: "HTTP " + resp.status, raw: resp.cuerpo || resp.texto };

            const perfil = resp.cuerpo.perfilHLR || "";
            const errores = Array.isArray(resp.cuerpo.error) ? resp.cuerpo.error : [];
            const { retcode, retmsg } = extraerRetcode(perfil || errores[0] || "");
            const estado = RETCODES_TIGO[retcode] || (retcode ? "ERROR_RETCODE" : "ERROR");
            // El categorizado completo del volcado vive en logica-qdn-tigo.js;
            // aquí solo se rescata el IMSI con una lectura ligera para el título.
            const imsiM = perfil.match(/\bIMSI\s*=\s*([^\r\n]+)/i);
            const imsi = imsiM ? imsiM[1].trim() : null;
            return { fuente: "tigo", estado, retcode, retmsg, mensaje: retmsg, imsi, raw: resp.cuerpo };
        }
    }

    function concluirUbicacion(claro, tigo) {
        const errClaro = claro.estado === "ERROR" || claro.estado === "TIMEOUT";
        const errTigo = tigo.estado === "ERROR" || tigo.estado === "ERROR_RETCODE" || tigo.estado === "TIMEOUT";
        if (errClaro && errTigo) return "NO_CONCLUYENTE";

        const enClaro = claro.estado === "ACTIVA";
        // 0 = perfil creado en el HLR de Tigo. 1033 = registro residual que Tigo
        // no depuró tras la portación a ME: también es presencia en Tigo, pero
        // no es un perfil utilizable, por eso no se mezcla con "Tigo".
        // 3001 (sin perfil) NO es presencia: cae a Claro o a Ninguno.
        const enTigo = tigo.estado === "ACTIVA";
        const residuoTigo = tigo.estado === "RESIDUO_TIGO";

        if (enClaro && enTigo) return "AMBOS";
        if (enClaro && residuoTigo) return "CLARO_RESIDUO";
        if (enClaro) return "CLARO";
        if (enTigo) return "TIGO";
        if (residuoTigo) return "RESIDUO_TIGO";
        if (errClaro || errTigo) return "NO_CONCLUYENTE";
        return "NINGUNO";
    }

    /** Ubicaciones que agrupa la tarjeta "Residuo en Tigo" (escalamiento a Tigo). */
    const UBICACIONES_RESIDUO = ["RESIDUO_TIGO", "CLARO_RESIDUO"];

    const ETIQUETA_UBICACION = {
        CLARO: "Claro", TIGO: "Tigo",
        RESIDUO_TIGO: "Residuo en Tigo (escalar)", CLARO_RESIDUO: "Claro + residuo en Tigo",
        AMBOS: "Ambos — revisar", NINGUNO: "Ninguno", NO_CONCLUYENTE: "No concluyente"
    };
    const ETIQUETA_CLARO = { ACTIVA: "Activa", INACTIVA: "Inactiva", ERROR: "Error", TIMEOUT: "Timeout" };
    const ETIQUETA_TIGO = {
        ACTIVA: "Activa", SIN_PERFIL: "Sin perfil", RESIDUO_TIGO: "Residuo en Tigo",
        ERROR: "Error", ERROR_RETCODE: "Error (RETCODE)", TIMEOUT: "Timeout"
    };

    /* ---------------------------------------------------------------------
       Consulta de UNA línea: las dos redes a la vez, y la conclusión.
    --------------------------------------------------------------------- */
    async function consultarLinea(msisdn, cfg) {
        const c = cfg || CFG;
        const [claro, tigo] = await Promise.all([
            consultarClaro(msisdn, c.claro),
            consultarTigo(msisdn, c.tigo)
        ]);
        return {
            msisdn,
            claro, tigo,
            ubicacion: concluirUbicacion(claro, tigo),
            etiquetaUbicacion: ETIQUETA_UBICACION[concluirUbicacion(claro, tigo)] || "—",
            etiquetaClaro: ETIQUETA_CLARO[claro.estado] || claro.estado || "—",
            etiquetaTigo: ETIQUETA_TIGO[tigo.estado] || tigo.estado || "—",
            imsi: (claro && claro.imsi) || (tigo && tigo.imsi) || null
        };
    }

    /** Pool de concurrencia: Claro no tiene servicio de lote, así que
        «en batch» es esto — tandas controladas, no mil peticiones a la vez. */
    async function consultarVarias(msisdns, opciones) {
        const o = opciones || {};
        const cfg = o.cfg || CFG;
        const limite = Math.max(1, Math.min(15, Number(o.concurrencia) || cfg.concurrencia || 5));
        const alTerminarUna = typeof o.alTerminarUna === "function" ? o.alTerminarUna : () => { };
        const cancelado = typeof o.cancelado === "function" ? o.cancelado : () => false;

        const lista = Array.from(msisdns || []);
        const salida = new Map();
        let i = 0, hechas = 0;

        const trabajador = async () => {
            while (i < lista.length) {
                if (cancelado()) return;
                const msisdn = lista[i++];
                let r;
                try { r = await consultarLinea(msisdn, cfg); }
                catch (e) {
                    r = {
                        msisdn, claro: { estado: "ERROR", mensaje: e.message },
                        tigo: { estado: "ERROR", mensaje: e.message },
                        ubicacion: "NO_CONCLUYENTE",
                        etiquetaUbicacion: ETIQUETA_UBICACION.NO_CONCLUYENTE,
                        etiquetaClaro: "Error", etiquetaTigo: "Error", imsi: null
                    };
                }
                salida.set(msisdn, r);
                hechas++;
                alTerminarUna(r, hechas, lista.length);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limite, lista.length || 1) }, trabajador));
        return salida;
    }

    const CFG = cfgCruce;

    global.HLRConsulta = {
        CFG, consultarLinea, consultarVarias,
        consultarClaro, consultarTigo, concluirUbicacion,
        ETIQUETA_UBICACION, ETIQUETA_CLARO, ETIQUETA_TIGO, UBICACIONES_RESIDUO,
        gestorClaro
    };
})(window);
