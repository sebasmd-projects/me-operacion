# Inicio de sesión en Genesis

Análisis del HAR `login_genesis.har` (captura del 02/10/2026, 128 de 130
entradas: el archivo venía truncado a mitad de una cadena y se reparó
decodificando entrada por entrada).

Este documento existe porque la forma de entrar a Genesis **no es la que
suponía `genesis-api.js`**, y eso cambia qué se puede automatizar y qué no.

---

## 1 · El flujo real, paso a paso

| # | Qué pasa | Dónde |
|---|---|---|
| 1 | `GET /realms/GrupoExito/protocol/openid-connect/auth` con `client_id=genesismovilexito`, `response_type=code`, `response_mode=fragment`, `scope=openid` | `genesisv2.grupo-exito.com` |
| 2 | Keycloak **no pide contraseña**: delega en un proveedor externo. `GET /realms/GrupoExito/broker/oidc/login` → **303** | `genesisv2` |
| 3 | Redirige al **Azure AD / Entra ID corporativo**, tenant `40f94963-1b34-45ce-a5fb-6f1fde2f1a27` | `login.microsoftonline.com` |
| 4 | `POST /common/GetCredentialType`, dos sondas de SSO de Windows (`autologon.microsoftazuread-sso.com`, ambas **401**: la máquina no está en el dominio) | Microsoft |
| 5 | `POST /{tenant}/login` — aquí va la contraseña | Microsoft |
| 6 | `POST /common/SAS/BeginAuth` con `"AuthMethodId":"PhoneAppNotification"` → **2FA por notificación push** | Microsoft |
| 7 | **13 × `GET /common/SAS/EndAuth`**, devolviendo `"ResultValue":"AuthenticationPending"` hasta que el usuario aprueba en el móvil y sale `"Success":true` | Microsoft |
| 8 | `POST /common/SAS/ProcessAuth` → **302** de vuelta a `genesisv2/realms/GrupoExito/broker/oidc/endpoint?code=…` | Microsoft |
| 9 | `broker/oidc/endpoint` → `login-actions/first-broker-login` → `broker/after-first-broker-login`: Keycloak **crea la cuenta local** a partir de la identidad de Microsoft | `genesisv2` |
| 10 | **302** a la app con el código en el **fragmento**: `…/shell/esme/reportes/efectividad-campana#state=…&code=…` | `genesisme` |
| 11 | `POST /realms/GrupoExito/protocol/openid-connect/token` con `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri` — **sin `client_secret` y sin PKCE** | `genesisv2` |

Lo que devuelve el paso 11:

```
access_token       (JWT RS256)
expires_in         3595     ~1 hora
refresh_token      (JWT HS512)
refresh_expires_in 3595     ¡LA MISMA hora!
id_token, token_type: Bearer, session_state, scope
```

---

## 2 · Las cuatro consecuencias que importan

### 2.1 · No hay «usuario y contraseña de Genesis»

La cuenta de Keycloak se crea por `first-broker-login` a partir de la
identidad de Microsoft, y **no tiene contraseña local**. Por eso
`grant_type=password` contra `genesisv2` no puede funcionar para esta gente:
no hay credencial que verificar ahí. El código lo intenta y cae con elegancia,
pero conviene no prometer que algún día funcionará.

### 2.2 · El 2FA hace imposible el camino «usuario + contraseña + 2FA» dentro de la herramienta

El segundo factor es `PhoneAppNotification`: una aprobación **fuera de banda**,
sin código que teclear. No hay nada que un formulario pueda pedir y reenviar.

Y por abajo tampoco: el flujo de contraseña directa de Microsoft (ROPC) **no
soporta MFA** —falla con `AADSTS50076` cuando hay segundo factor—, y
reimplementar `BeginAuth`/`EndAuth` significaría copiar la página de login de
Microsoft con sus `ctx` y `FlowToken`, que cambian sin avisar y que además es
exactamente lo que los controles de seguridad corporativos están puestos para
detectar. **No se va a hacer.**

### 2.3 · El `refresh_token` no sirve para durar más de una hora

`refresh_expires_in` es **igual** a `expires_in`. Renovar con el refresh no
compra tiempo extra: a la hora hay que volver a pasar por el navegador.

Lo que sí funciona es la cookie de sesión de Keycloak. En la captura, la
**entrada 93** es un `/auth` idéntico al primero que devuelve **302 con un
`code` nuevo sin ninguna interacción**, porque la cookie SSO ya estaba. O sea:
mientras el analista tenga su sesión de Genesis viva en Edge, conseguir un
token nuevo **no le cuesta ni un clic de 2FA**.

### 2.4 · El intercambio del código no necesita secreto

`POST /token` viaja **sin `client_secret`** (el `app.config.json` de la app
lleva `"secret": "1"`, un relleno) y **sin PKCE** (no hay `code_challenge` ni
`code_verifier`). Cliente público. Cualquiera que tenga el `code` puede
cambiarlo por un token.

Esto es lo que hace viables las soluciones de abajo. También es, dicho de
paso, una debilidad del cliente `genesismovilexito` que conviene mencionarle
al equipo de Genesis: **un cliente público debería usar PKCE.**

---

## 3 · Datos de la captura, para no volver a buscarlos

```
Keycloak     https://genesisv2.grupo-exito.com
realm        GrupoExito
client_id    genesismovilexito        (público, sin secreto, sin PKCE)
redirect_uri https://genesisme.grupo-exito.com/apimew/genesis/shell/esme/reportes/efectividad-campana
Azure tenant 40f94963-1b34-45ce-a5fb-6f1fde2f1a27
2FA          PhoneAppNotification (push, aprobación fuera de banda)
CSP de la app  default-src *; script-src * 'unsafe-inline' 'unsafe-eval'
X-Frame-Options de la app  DENY      (un iframe oculto NO sirve; un popup sí)
CORS de /token  Access-Control-Allow-Origin: https://genesisme.grupo-exito.com
app.config   authqueryapi: https://platino.grupo-exito.com/apimew/autorizadorquery/
```

---

## 4 · El inicio de sesión de Genesis es OPCIONAL

Implementado (`me-ui.js`): una herramienta puede declarar sesiones
**necesarias** y **opcionales**.

```js
sesiones: ["cm"],              // sin esto la herramienta no sirve
sesionesOpcionales: ["genesis"] // sale el chip, pero no bloquea
```

`haySesionValida()` solo mira las necesarias. El chip de una opcional sin
iniciar sale al 55 % de opacidad, para que no parezca un error ni una tarea
pendiente, y recupera su aspecto normal en cuanto se inicia, porque entonces su
estado sí importa. Las otras herramientas no declaran `sesionesOpcionales` y se
comportan exactamente como antes.

---

## 5 · Cómo entra el analista, en la práctica

Decisión tomada: **nada que pedirle al equipo de Genesis y nada que el
operador tenga que instalar o configurar.** De ahí sale el favorito
(*bookmarklet*).

### Una sola vez

Arrastrar el botón «Token de Genesis» del paso 1 de la herramienta a la barra
de favoritos de Edge (`Ctrl`+`Shift`+`B` si no se ve). Si arrastrar no va,
el enlace «o copia su código» pone la URL en el portapapeles para pegarla en
la dirección de un favorito nuevo.

### Cada hora

1. En la pestaña de Genesis que ya tiene abierta, pulsar el favorito.
2. Vuelve a la herramienta y pega (`Ctrl`+`V`). No hay que pulsar nada más:
   al pegar un token válido la sesión se abre sola.

### Qué hace el favorito por dentro

Dos caminos, el barato primero:

1. **Mira lo que la app ya tiene guardado** (`sessionStorage` y
   `localStorage`, también dentro de valores JSON). Si encuentra un access
   token de este realm sin vencer, lo muestra y no abre ninguna ventana.
   Descarta el `id_token` (`typ: ID`), el refresh (`typ: Refresh`), los
   vencidos y los de otros realms: son JWT igual de válidos y **no sirven**
   como `Authorization`.
2. **Si no hay nada, pide uno nuevo** con `prompt=none` en una ventana
   emergente. Como la cookie SSO de Keycloak ya está, responde con un `code`
   nuevo **sin contraseña y sin aprobación en el móvil** (es la entrada 93 del
   HAR). Se verifica el `state`, se cambia el `code` por el token y se copia.
   Si no hubiera sesión, Keycloak contesta `error=login_required` y el aviso
   dice qué hacer, en vez de abrir una pantalla de login dentro de una
   ventanita.

### Por qué un favorito y no un botón de la herramienta

Porque el token vive en el origen `genesisme.grupo-exito.com` y las
herramientas se abren con `file://`. Un botón puede abrir una ventana a
Genesis, pero **no puede leer nada de ella**: son orígenes distintos. El
favorito se ejecuta *dentro* de esa página, y ahí sí.

Tampoco sirve un iframe oculto: la app manda `X-Frame-Options: DENY`. Una
ventana emergente no está sujeta a eso, y es lo que se usa.

### Lo que falta por confirmar

Esto está probado contra un navegador simulado y contra Chromium real, con
24 + 14 comprobaciones, **pero no contra el servidor de Genesis**, que desde
aquí no se alcanza. Hacen falta dos cosas de una pasada de verdad:

1. **Cuál de los dos caminos entra.** Si la app guarda el token en
   `sessionStorage`, gana el primero y no se abre ninguna ventana. Si lo
   mantiene solo en memoria, se usa el segundo.
2. **La carrera del segundo camino.** La ventana aterriza en la app de
   Genesis; si la app arranca antes de que leamos el fragmento, consume ella
   el `code` (son de un solo uso). Se sondea cada 25 ms para ganar esa
   carrera, y perderla no rompe nada: basta repetir. Si resultara que se
   pierde a menudo, la solución limpia es pedirle al equipo de Genesis un
   `redirect_uri` que no monte la aplicación.

### Mantenimiento

El código vive en `assets/genesis-bookmarklet.js` como una **función normal**,
legible y editable. La URL `javascript:` se genera de ella con `toString()`,
así que no hay una segunda copia que se quede atrás. Las cuatro reglas al
editarla están en la cabecera del archivo (solo comentarios de bloque, sin
plantillas multilínea, sin `/*` dentro de cadenas, solo ASCII).
