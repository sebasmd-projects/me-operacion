/* =====================================================================
   genesis-bookmarklet.js · El favorito que saca el token de Genesis
   ---------------------------------------------------------------------
   POR QUÉ EXISTE

   El login de Genesis no es de Genesis: Keycloak delega en el Azure AD
   corporativo y el segundo factor es una notificación push al móvil (ver
   doc/genesis-login.md). Eso descarta por completo pedir usuario,
   contraseña y 2FA desde estas herramientas:

     · La cuenta de Keycloak se crea por `first-broker-login` desde la
       identidad de Microsoft y NO tiene contraseña local, así que
       `grant_type=password` no tiene nada que verificar.
     · El segundo factor es una aprobación fuera de banda. No hay código
       que teclear, así que no hay formulario posible.

   Lo que sí se puede: que el analista pulse un favorito en la pestaña de
   Genesis que ya tiene abierta, y que el token acabe en el portapapeles.
   Sin DevTools, sin instalar nada y sin pedirle permiso a nadie.

   POR QUÉ UN FAVORITO Y NO UN BOTÓN DE LA HERRAMIENTA

   Porque el token vive en el origen `genesisme.grupo-exito.com` y las
   herramientas se abren con `file://`. Un botón de la herramienta puede
   abrir una ventana a Genesis, pero NO puede leer nada de ella: son
   orígenes distintos y el navegador lo impide. Un favorito, en cambio,
   se ejecuta DENTRO de esa página, y ahí sí.

   CÓMO SE MANTIENE

   El código de abajo es una función normal: se lee y se edita como
   cualquier otra. La URL `javascript:` del favorito se GENERA a partir de
   ella con `toString()`, así que no hay una segunda copia que se quede
   atrás. Dos reglas al editar `tomarTokenGenesis`:

     1. Solo comentarios de bloque. La minificación colapsa los saltos de
        línea, y un comentario de línea se comería el resto del código.
     2. Nada de plantillas con saltos de línea dentro, por lo mismo.
     3. Ningún `/*` dentro de una cadena: el minificado quita comentarios de
        bloque con una expresión regular y se comería desde ahí. (Los `//` de
        las URL sí son seguros: no se tocan los comentarios de línea, y la
        prueba verifica que el resultado sigue parseando.)
     4. Solo ASCII. Una URL `javascript:` guardada como favorito puede
        acabar percent-codificada o mal convertida según el navegador.
===================================================================== */
(function (global) {
    "use strict";

    /* El cuerpo del favorito. Se ejecuta en la pestaña de Genesis. */
    function tomarTokenGenesis() {
        var KC = "https://genesisv2.grupo-exito.com";
        var REALM = "GrupoExito";
        var CLIENTE = "genesismovilexito";
        var REDIR = "https://genesisme.grupo-exito.com/apimew/genesis/shell/esme/reportes/efectividad-campana";

        /* ---- 0 · estar en el sitio correcto ---- */
        if (location.host.indexOf("genesisme.grupo-exito.com") < 0) {
            alert("Este favorito hay que pulsarlo con la pestana de Genesis abierta "
                + "(genesisme.grupo-exito.com).\n\nAhora estas en: " + location.host);
            return;
        }

        /* ---- utilidades ---- */
        /* El relleno es "===" y NO "====": para una cadena de longitud L hacen
           falta (4 - L%4) % 4 iguales, que es exactamente "===".slice((L+3)%4).
           Con "====" se anade uno de mas en los tres casos y `atob` revienta.
           Lo cazo la prueba; no es un detalle: casi ningun token habria
           pasado por aqui. */
        function b64url(s) {
            var t = String(s).replace(/-/g, "+").replace(/_/g, "/");
            return atob(t + "===".slice((t.length + 3) % 4));
        }

        /* Un access token de Keycloak de ESTE realm y sin vencer. Se exige
           typ=Bearer para no confundirlo con el id_token (typ=ID) ni con el
           refresh (typ=Refresh), que son JWT igual de validos y no sirven
           como Authorization. */
        function claimsSiSirve(v) {
            if (typeof v !== "string" || v.length < 60 || v.slice(0, 2) !== "ey") return null;
            var p = v.split(".");
            if (p.length !== 3) return null;
            try {
                var c = JSON.parse(b64url(p[1]));
                if (!c.iss || c.iss.indexOf("genesisv2") < 0) return null;
                if (c.typ && c.typ !== "Bearer") return null;
                if (!c.exp || c.exp * 1000 < Date.now() + 30000) return null;
                return c;
            } catch (e) { return null; }
        }

        /* Busca tokens dentro de un valor guardado: puede ser el JWT pelado
           o un JSON que lo contenga en algun campo. */
        function buscarEn(valor, salida) {
            var c = claimsSiSirve(valor);
            if (c) { salida.push({ token: valor, claims: c }); return; }
            if (typeof valor !== "string" || valor.indexOf("ey") < 0) return;
            try {
                var o = JSON.parse(valor);
                Object.keys(o || {}).forEach(function (k) {
                    var cc = claimsSiSirve(o[k]);
                    if (cc) salida.push({ token: o[k], claims: cc });
                });
            } catch (e) { /* no era JSON */ }
        }

        function enAlmacen() {
            var out = [];
            [sessionStorage, localStorage].forEach(function (alm) {
                try {
                    for (var i = 0; i < alm.length; i++) buscarEn(alm.getItem(alm.key(i)), out);
                } catch (e) { /* almacen bloqueado */ }
            });
            out.sort(function (a, b) { return b.claims.exp - a.claims.exp; });
            return out[0] || null;
        }

        /* ---- presentacion ---- */
        function mostrar(token, claims, comoSalio) {
            var quien = claims.preferred_username || claims.email || claims.name || "(sin nombre)";
            var minutos = Math.max(0, Math.round((claims.exp * 1000 - Date.now()) / 60000));
            var viejo = document.getElementById("meTokenGenesis");
            if (viejo) viejo.remove();
            var caja = document.createElement("div");
            caja.id = "meTokenGenesis";
            caja.setAttribute("style", "position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.55);"
                + "display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif");
            var panel = document.createElement("div");
            panel.setAttribute("style", "background:#fff;border-radius:10px;padding:18px 20px;max-width:620px;"
                + "width:92%;box-shadow:0 10px 40px rgba(0,0,0,.4)");
            var h = document.createElement("div");
            h.setAttribute("style", "font-weight:700;font-size:15px;margin-bottom:6px");
            h.textContent = "Token de Genesis listo";
            var p = document.createElement("div");
            p.setAttribute("style", "color:#444;margin-bottom:10px;line-height:1.45");
            p.textContent = quien + " - vence en " + minutos + " min - " + comoSalio
                + ". Pegalo en la herramienta (Ctrl+V) en el campo del token.";
            var ta = document.createElement("textarea");
            ta.setAttribute("style", "width:100%;height:84px;font:11px ui-monospace,monospace;"
                + "border:1px solid #ccc;border-radius:6px;padding:8px");
            ta.value = token;
            var pie = document.createElement("div");
            pie.setAttribute("style", "margin-top:10px;display:flex;gap:8px;align-items:center");
            var bCopiar = document.createElement("button");
            bCopiar.setAttribute("style", "padding:7px 14px;border:0;border-radius:6px;background:#1a1a1a;"
                + "color:#fff;cursor:pointer;font-weight:600");
            bCopiar.textContent = "Copiar";
            var estado = document.createElement("span");
            estado.setAttribute("style", "color:#1b7f3b;font-weight:600");
            var bCerrar = document.createElement("button");
            bCerrar.setAttribute("style", "padding:7px 14px;border:1px solid #ccc;border-radius:6px;"
                + "background:#fff;cursor:pointer;margin-left:auto");
            bCerrar.textContent = "Cerrar";
            function copiar() {
                ta.focus(); ta.select();
                var listo = function () { estado.textContent = "Copiado"; };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(token).then(listo, function () {
                        estado.textContent = document.execCommand("copy")
                            ? "Copiado" : "Copialo a mano: Ctrl+C";
                    });
                } else {
                    estado.textContent = document.execCommand("copy") ? "Copiado" : "Copialo a mano: Ctrl+C";
                }
            }
            bCopiar.addEventListener("click", copiar);
            bCerrar.addEventListener("click", function () { caja.remove(); });
            caja.addEventListener("click", function (e) { if (e.target === caja) caja.remove(); });
            pie.appendChild(bCopiar); pie.appendChild(estado); pie.appendChild(bCerrar);
            panel.appendChild(h); panel.appendChild(p); panel.appendChild(ta); panel.appendChild(pie);
            caja.appendChild(panel);
            document.body.appendChild(caja);
            copiar();
        }

        /* ---- 1 · lo barato: lo que la propia app ya tiene guardado ---- */
        var ya = enAlmacen();
        if (ya) { mostrar(ya.token, ya.claims, "tomado de la sesion abierta"); return; }

        /* ---- 2 · pedir uno nuevo con la cookie SSO ----
           `prompt=none` es la clave: con la sesion de Genesis viva, Keycloak
           responde con un `code` nuevo y CERO interaccion (ni contrasena ni
           2FA); y si no hay sesion, contesta `error=login_required` en vez de
           abrir una pantalla de login dentro de una ventanita. */
        var est = "me" + Math.random().toString(36).slice(2);
        var url = KC + "/realms/" + REALM + "/protocol/openid-connect/auth"
            + "?client_id=" + encodeURIComponent(CLIENTE)
            + "&redirect_uri=" + encodeURIComponent(REDIR)
            + "&response_type=code&response_mode=fragment&scope=openid&prompt=none"
            + "&state=" + est + "&nonce=" + est;

        var pop = window.open(url, "meTokenGenesis", "width=520,height=380");
        if (!pop) {
            alert("El navegador bloqueo la ventana emergente.\n\nPermitela para "
                + "genesisme.grupo-exito.com y vuelve a pulsar el favorito.");
            return;
        }

        /* Se sondea rapido (cada 25 ms) a proposito: la ventana aterriza en la
           app de Genesis, y si la app arranca antes de que leamos el hash,
           consume ella el `code` (son de un solo uso) y nos quedamos sin el.
           Leer el hash en cuanto la navegacion llega gana esa carrera casi
           siempre; si se pierde, no se rompe nada y basta repetir. */
        var t0 = Date.now();
        var reloj = setInterval(function () {
            var h = null;
            try { h = pop.location.hash; } catch (e) { /* aun en genesisv2: otro origen */ }
            if (h && h.length > 1) {
                var q = new URLSearchParams(h.slice(1));
                if (q.get("code") || q.get("error")) {
                    clearInterval(reloj);
                    var code = q.get("code");
                    var err = q.get("error");
                    var devuelto = q.get("state");
                    try { pop.close(); } catch (e) { }
                    if (err || !code) {
                        alert(err === "login_required"
                            ? "Genesis dice que no hay sesion abierta.\n\nEntra a Genesis "
                              + "normalmente (usuario, contrasena y aprobacion en el movil) y "
                              + "vuelve a pulsar el favorito."
                            : "Genesis respondio: " + (err || "sin codigo"));
                        return;
                    }
                    if (devuelto !== est) {
                        alert("La respuesta no corresponde a esta peticion. Vuelve a intentarlo.");
                        return;
                    }
                    var cuerpo = new URLSearchParams();
                    cuerpo.set("grant_type", "authorization_code");
                    cuerpo.set("code", code);
                    cuerpo.set("client_id", CLIENTE);
                    cuerpo.set("redirect_uri", REDIR);
                    fetch(KC + "/realms/" + REALM + "/protocol/openid-connect/token", {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: cuerpo.toString()
                    }).then(function (r) { return r.text(); }).then(function (txt) {
                        var j = null;
                        try { j = JSON.parse(txt); } catch (e) { }
                        var tk = j && j.access_token;
                        var c = tk && claimsSiSirve(tk);
                        if (!c) {
                            alert("No se pudo cambiar el codigo por un token.\n\n" + txt.slice(0, 300));
                            return;
                        }
                        mostrar(tk, c, "sesion renovada sin 2FA");
                    }, function (e) {
                        alert("Fallo la peticion del token: " + e.message);
                    });
                    return;
                }
            }
            if (Date.now() - t0 > 20000) {
                clearInterval(reloj);
                try { pop.close(); } catch (e) { }
                alert("Genesis no respondio en 20 s. Comprueba que tu sesion de "
                    + "Genesis sigue abierta y vuelve a intentarlo.");
            }
        }, 25);
    }

    /* La URL del favorito, generada de la funcion de arriba: una sola copia
       del codigo. El colapso de espacios basta como minificado (y por eso la
       funcion no lleva comentarios de linea: ver la cabecera). */
    function uriFavorito() {
        return "javascript:(" + String(tomarTokenGenesis)
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .replace(/\s+/g, " ")
            .trim() + ")();void 0;";
    }

    global.GENESIS_BOOKMARKLET = { fuente: tomarTokenGenesis, uri: uriFavorito };
})(window);
