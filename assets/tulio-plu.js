/* =====================================================================
   tulio-plu.js · Aplicar un PLU en Tulio (RecargaPaquete) — compartido
   ---------------------------------------------------------------------
   Lo usan «Aplicar PLU de paquete» (logica-plu.js) y la carga de PLU en
   «Bolsillos, paquetes y consumos» (logica-paquetes-carga.js). Antes vivía
   dentro de logica-plu.js, que declara globales (CONFIG, auth…) y no se
   puede cargar en otra página sin pisar las suyas. Aquí todo queda dentro
   de un IIFE y se publica como window.TulioPLU.

   Credenciales, token (client_credentials), payload y la regla de éxito
   (cabeceraSalida.estado.estado y datosSalida.estado en "000") son los
   mismos de siempre; ver doc/aplicar-plu/README.md.
===================================================================== */
(function (global) {
    "use strict";

    const CFG = {
        tulioBase: "https://tulio.grupo-exito.com",
        rutaToken: "/identity/connect/token",
        rutaRecarga: "/apimew/api/v1/MFYGS4TFMNQQ/Recarga/RecargaPaquete",
        // Valores del ejemplo recibido. `host` y `objetoNegocio` van tal cual
        // vinieron: no están confirmados con el equipo de API (ver README).
        hostRecarga: "1.1.1.1",
        objetoNegocio: "test",
        idAplicacion: "API_MOVIL_EXITO",
        canalPorDefecto: "PPrepagadaTP",
        costoPorDefecto: "0",
        timeoutMs: 60000
    };

    /* Credenciales de Tulio (las que traía `tulio_credentials.json` junto al
       servidor de la consola). Van aquí, igual que el client_secret del QDN en
       logica-qdn.js: la herramienta tiene que funcionar sin pedirle nada al
       analista.

       OJO al repartir: con estas credenciales se puede pedir un token y
       recargar cualquier línea, y este archivo viaja a todas las máquinas con
       la suite. La carpeta y el ZIP van en un lugar de acceso restringido, y
       cuando roten se cambian aquí (ver el apartado de riesgos del README). */
    const TULIO_CRED = {
        api_key: "3PKRxw0LZTFXQ+9RUM3B5f0z8Slcn7VFbboJaXuekSGyd+e9ZzBsXtBShyECqSZYt3DUM4rEiF5Pmte31gMNeg==",
        client_id: "3ef5559a-99d8-43c8-b2af-d9c66abd01bb",
        client_secret: "AY5W76jSIfhhhc+rmwlO9bTrfZa2Nqz8l033U/F38t8=",
        scope: "UAIUGTFEYFUAPOIYO"
    };

    /* Quién puede aplicar PLU. Se compara contra el usuario de la sesión del
       CM (el login de Keycloak): hace falta sesión vigente. Es una guarda de
       interfaz para que nadie recargue por accidente, no un control de acceso
       del servicio —la API key de Tulio es la misma para todos—. Para
       habilitar a alguien más se agrega aquí. */
    const USUARIOS = ["jpelaezg"];

    /** Usuario de la sesión del CM (el que queda en la nota y en la bitácora). */
    function usuarioOperador() {
        const st = MEUI.sesion.estado("cm");
        return (st && st.usuario) ? st.usuario : "sin sesión identificada";
    }

    /** Sesión del CM vigente Y usuario autorizado. */
    function puedeAgregarPlu() {
        const st = MEUI.sesion.estado("cm");
        if (!st || (st.estado !== "ok" && st.estado !== "warn")) return false;
        const usuario = String(st.usuario || "").trim().toLowerCase();
        return USUARIOS.some(u => u.toLowerCase() === usuario);
    }

    /** Por qué no se puede aplicar PLU (texto para la interfaz), o "". */
    function motivoSinPlu() {
        const st = MEUI.sesion.estado("cm");
        if (!st || (st.estado !== "ok" && st.estado !== "warn")) {
            return "hace falta una sesión del CM vigente: es la que dice quién eres";
        }
        return `el usuario «${st.usuario || "—"}» no está autorizado para aplicar PLU`;
    }
    /* =====================================================================
       4 · TOKEN DE TULIO (client_credentials)
       ---------------------------------------------------------------------
       El cuerpo va como multipart/form-data, igual que lo mandaba el servidor
       Python. Con FormData el navegador pone el boundary solo: por eso NO se
       fija Content-Type a mano (si se fija, el boundary falta y Tulio
       responde 400).
    ===================================================================== */
    const gestorTulio = {
        token: null, exp: 0, renovando: null,

        async solicitar() {
            const cred = TULIO_CRED;
            const cuerpo = new FormData();
            cuerpo.append("client_id", cred.client_id);
            cuerpo.append("client_secret", cred.client_secret);
            cuerpo.append("grant_type", "client_credentials");
            cuerpo.append("scope", cred.scope);

            const r = await fetch(CFG.tulioBase + CFG.rutaToken, { method: "POST", body: cuerpo });
            const texto = await r.text();
            let datos = null;
            try { datos = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
            if (!r.ok) {
                throw new Error(`Tulio ${r.status} pidiendo el token: ${String(texto).slice(0, 200)}`);
            }
            const token = datos && typeof datos.access_token === "string" ? datos.access_token : "";
            if (!token) throw new Error("Tulio no devolvió access_token.");

            this.token = token;
            const vida = Number(datos.expires_in || 300);
            this.exp = Date.now() + Math.max(30, vida - 60) * 1000;
            MEUI.log(`✔ Token de Tulio obtenido (vence en ${vida}s).`, "ok");
            return token;
        },

        async obtener(forzar) {
            if (!forzar && this.token && Date.now() < this.exp) return this.token;
            if (this.renovando) return this.renovando;
            this.renovando = this.solicitar().finally(() => { this.renovando = null; });
            return this.renovando;
        },

        reset() { this.token = null; this.exp = 0; }
    };

    /* =====================================================================
       5 · APLICAR EL PLU (RecargaPaquete)
    ===================================================================== */
    const idTransaccion = () => (crypto.randomUUID ? crypto.randomUUID()
        : "ME-" + Date.now() + "-" + Math.random().toString(16).slice(2));

    function payloadRecarga(msisdn, plu, costo, canal, usuario) {
        const sello = new Date().toISOString().replace("Z", "-05:00");
        return {
            cabeceraEntrada: {
                uuid: idTransaccion(),
                idAplicacion: CFG.idAplicacion,
                fechaTransaccion: sello,
                host: CFG.hostRecarga,
                usuario,
                objetoNegocio: CFG.objetoNegocio,
                operacion: "RecargaPaquete"
            },
            DatosEntradaRecargaPaquete: {
                idTransaccion: idTransaccion(),
                canalVenta: canal,
                lineaTelefonica: msisdn,
                pluPaquete: plu,
                costoPaquete: Number(costo),
                fechaSolicitud: sello
            }
        };
    }

    async function recargaUnaVez(payload, token) {
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), CFG.timeoutMs);
        const t0 = performance.now();
        try {
            const r = await fetch(CFG.tulioBase + CFG.rutaRecarga, {
                method: "POST", signal: controlador.signal,
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token,
                    "X-Api-Key": TULIO_CRED.api_key
                },
                body: JSON.stringify(payload)
            });
            const texto = await r.text();
            let cuerpo = null;
            try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
            return { ok: r.ok, status: r.status, cuerpo, texto, ms: Math.round(performance.now() - t0) };
        } finally {
            clearTimeout(temporizador);
        }
    }

    /**
     * Aplica el PLU. El éxito NO es el HTTP 200: Tulio marca el resultado en
     * `cabeceraSalida.estado.estado` y en `datosSalida.estado`, y los dos
     * tienen que venir en "000" (mismo criterio que el servidor Python).
     */
    async function aplicarPlu(msisdn, plu, costo, canal, usuario) {
        const payload = payloadRecarga(msisdn, plu, costo, canal, usuario);
        const evidencia = { request: { url: CFG.tulioBase + CFG.rutaRecarga, body: payload } };

        for (let intento = 1; intento <= 2; intento++) {
            let token;
            try {
                token = await gestorTulio.obtener(intento === 2);
            } catch (e) {
                return { ok: false, detalle: "No se pudo autenticar en Tulio: " + e.message, evidencia };
            }

            let resp;
            try {
                resp = await recargaUnaVez(payload, token);
            } catch (e) {
                const esTimeout = e && e.name === "AbortError";
                return {
                    ok: false, evidencia,
                    // Un timeout NO se reintenta: la recarga pudo haberse
                    // aplicado y repetirla la sumaría dos veces.
                    detalle: esTimeout
                        ? "Tiempo de espera agotado. NO se reintenta: verifica los paquetes antes de repetir."
                        : "Error de comunicación con Tulio: " + (e.message || e)
                };
            }

            // 401: el token venció → se renueva UNA vez y se repite.
            if (resp.status === 401 && intento === 1) { gestorTulio.reset(); continue; }

            evidencia.response = resp.cuerpo || { httpStatus: resp.status, texto: (resp.texto || "").slice(0, 500) };
            const estado = resp.cuerpo?.cabeceraSalida?.estado || {};
            const estadoDatos = resp.cuerpo?.datosSalida?.estado;
            const exito = resp.ok && String(estado.estado) === "000" && String(estadoDatos) === "000";

            return {
                ok: exito, httpStatus: resp.status, ms: resp.ms, evidencia,
                codigo: estado.estado != null ? String(estado.estado) : String(resp.status),
                detalle: exito
                    ? String(estado.descripcion || "Transacción Exitosa")
                    : "Tulio no confirmó la recarga: " + String(estado.descripcion || (resp.texto || "").slice(0, 200) || "error desconocido")
            };
        }
        return { ok: false, detalle: "No se pudo aplicar el PLU.", evidencia };
    }


    /** PLU escritos: «10021», «10021 0 PPrepagadaTP», uno por renglón o
        separados por coma/espacio. Devuelve [{plu, costo, canal}] y errores. */
    function leerPlus(texto, canal, costo) {
        const items = [], errores = [];
        String(texto || "").split(/\r?\n/).forEach((renglon, i) => {
            const t = renglon.trim();
            if (!t) return;
            // Un renglón con solo números separados por coma/espacio = varios PLU.
            const soloPlus = /^\d{3,10}([\s,;|]+\d{3,10})*$/.test(t) && !/[A-Za-z]/.test(t)
                && t.split(/[\s,;|]+/).every(x => x.length >= 4);
            const partes = t.split(/\s*[\t;,|]\s*|\s+/).filter(Boolean);
            if (soloPlus) { partes.forEach(p => items.push({ plu: p, costo: costo ?? CFG.costoPorDefecto, canal: canal || CFG.canalPorDefecto })); return; }
            const [plu, cos, can] = partes;
            if (!/^\d{3,10}$/.test(plu || "")) { errores.push(`Renglón ${i + 1}: «${plu || t}» no es un PLU`); return; }
            if (cos !== undefined && !/^\d+(\.\d+)?$/.test(cos)) { errores.push(`Renglón ${i + 1}: costo «${cos}» inválido`); return; }
            items.push({ plu, costo: cos ?? costo ?? CFG.costoPorDefecto, canal: can || canal || CFG.canalPorDefecto });
        });
        return { items, errores };
    }

    global.TulioPLU = {
        CONFIG: CFG, USUARIOS,
        usuario: usuarioOperador, puede: puedeAgregarPlu, motivo: motivoSinPlu,
        gestor: gestorTulio, idTransaccion, payloadRecarga, aplicar: aplicarPlu, leerPlus
    };
})(window);
