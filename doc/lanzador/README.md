# Base compartida y lanzador `dame click.bat` — Documentación técnica

> **Versión: v2.4** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).

Las cuatro herramientas de operación son archivos HTML independientes, pero **comparten una base**: el mismo marco visual, la misma sesión y el mismo acceso al CM. Esa base son tres archivos (`me-ui.css`, `me-ui.js`, `me-api.js`) más el lanzador `dame click.bat` + `scripts\lanzador.ps1`, que deja la sesión lista antes de que aparezca la primera página.

> **En la raíz del proyecto solo quedan tres archivos «externos»**: `index.html`, `dame click.bat` y `actualizar.bat`. Todo lo demás vive ordenado en subcarpetas — **todo `.ps1` en `scripts\`** (incluido el empaquetador, que nunca se distribuye), toda la documentación en `doc\`. Ver el árbol completo en §2.

> **`dame click.bat` es un lanzador delgado.** Desde v2.3 no ejecuta lógica
> propia: solo invoca `lanzador.ps1` como archivo real. Antes el `.bat`
> se leía a sí mismo y ejecutaba el bloque de PowerShell embebido con
> `Invoke-Expression` — un patrón ("script que se decodifica y se ejecuta
> a sí mismo") que varios antivirus vigilan de cerca, aunque el contenido
> fuera inofensivo. Separar la lógica en un `.ps1` real también es lo que
> permite firmarla con Authenticode (ver §7). Del mismo modo,
> **instalar una actualización quedó en `actualizar.bat`, aparte y
> siempre a mano** — ver §7.

> Cambiar una URL del CM, una cabecera o el manejo del token se hace **una vez** en `me-api.js`. Cambiar un color, el alto de las tablas o el formato de exportación se hace **una vez** en `me-ui`.

---

## 1. Objetivos

- Que las cuatro herramientas se vean y se usen igual, sin copiar código entre ellas.
- Tener **un solo lugar** para los endpoints, las credenciales y la renovación del token.
- Que el analista abra el lanzador y encuentre la sesión iniciada, sin escribir nada.
- Que cada `.html` sea **solo marcado**: la lógica vive en archivos aparte y se puede editar sin abrir el HTML.

---

## 2. Arquitectura y archivos

```txt
dame click.bat                lanzador delgado: solo invoca scripts\lanzador.ps1
actualizar.bat                 lanzador delgado: solo invoca scripts\actualizar.ps1

scripts\                      TODO archivo .ps1 del proyecto vive aquí
  lanzador.ps1                  lógica real del lanzador (firmable con Authenticode)
  actualizar.ps1                 instala una versión nueva, siempre a mano (§7)
  empaquetar-release.bat/.ps1    arma el paquete de una release; NUNCA se distribuye
  VERSION                        número de versión de esta copia

assets\
  me-ui.css                 sistema de diseño: color, shell, pasos, tablas, log
  me-ui.js                  shell (lateral/cabecera/pie), sesión compartida,
                            registro, defaults y alto de DataTables,
                            lectura de líneas/Excel y exportación
  me-api.js                 endpoints, cabeceras, objeto auth y llamadas al CM
  logica-<herramienta>.js    reglas de negocio propias de cada herramienta
  me-<herramienta>-puente.js enganche entre esa lógica y el shell
```

Orden de carga, idéntico en las cuatro páginas:

```html
<script src="assets/me-ui.js"></script>
<script> MEUI.init({ app, version, titulo, sesiones, instrucciones }); </script>
<script src="assets/me-api.js"></script>
<script src="assets/logica-<herramienta>.js"></script>
<script src="assets/me-<herramienta>-puente.js"></script>
```

El orden importa: `MEUI.init()` va **antes** de la lógica porque mueve el contenido dentro del shell y porque consume los parámetros que deja el lanzador en la URL.

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, dropdowns, pestañas, modales, badges. |
| **Bootstrap Icons** | 1.11.3 | Iconos del menú, botones y estados. |
| **DataTables** | 2.3.2 (+ integración `bootstrap5`) | Tablas con paginado, búsqueda y orden en pantalla. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Leer `.xlsx`/`.csv` y exportar a `.xlsx`. |
| **Tom Select** | 2.4.3 | Selects con búsqueda y etiquetas editables. |
| **marked** | última | Renderiza los README en el inicio. |
| **Archivo / IBM Plex Mono** | — | Tipografías (Google Fonts). |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** (`optiva`) | Autenticación OpenID Connect del CM: *direct grant* y *refresh token*. |
| **API Gateway OBP** | Todas las consultas al CM de las cuatro herramientas. |
| **SIME / SIME Web** | Solo lo usa el reporte de prepagadas (token `prf` por NTLM). |

CDNs usados: jsdelivr, datatables.net, code.jquery.com, cdnjs. Todos externos (ver §9).

---

## 4. Endpoints

Todos los que centraliza `me-api.js`:

| Método | Endpoint | Para qué |
|---|---|---|
| `POST` | `{kcBase}/auth/realms/{realm}/protocol/openid-connect/token` | Login (`grant_type=password`) y renovación (`grant_type=refresh_token`). |
| `GET` | `{apiBase}{ruta}` vía `MEAPI.getJson(ruta, params)` | Cualquier consulta autenticada al CM. |
| `*` | `{apiBase}{ruta}` vía `MEAPI.api(ruta, {method, body, headers})` | Llamadas con cuerpo: `PATCH`, `POST`, `PUT`. |

Configuración fija:

```js
MEAPI.CONFIG = {
  apiBase : "http://obp-apigw.exito-prod.movil-exito.internal",
  kcBase  : "http://keycloak.exito-prod.movil-exito.internal",
  realm   : "optiva",
  clientId: "optiva",
  locale  : "es",            // cada herramienta lo ajusta con MEAPI.configurar()
  spid    : "410",
  tenant  : "optiva",
  camposUsuario: ["#cfgUser", "#user", "#username"],   // de dónde lee las credenciales
  camposClave  : ["#cfgPass", "#pass", "#password"],
  margenRenovacion: 30       // segundos antes del vencimiento
};
```

Cabeceras que agrega `MEAPI.cabeceras()` a cada llamada: `Accept`, `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0`, `locale`, `spid`, `tenant` y `Authorization: Bearer …`.

---

## 5. Funcionalidad

### Shell (lo que ve el analista en todas las herramientas)

- **Menú lateral** con las páginas registradas en `APPS`, contraíble a solo iconos (la flecha cambia de sentido) y recordado entre archivos. Bajo 992 px se convierte en menú deslizante con botón hamburguesa. Las rutas de `APPS` están escritas desde `herramientas/`; `rutaNav()` las traduce cuando quien pinta el menú es la portada, que vive en la raíz.
- **Cabecera**: título, descripción y un **chip por sesión** (SIME y/o CM) con semáforo: verde activa, naranja por expirar, rojo expirada, gris sin sesión. Muestra el usuario y los segundos que faltan. Al hacer clic se abre un menú con *iniciar sesión*, *cerrar* y *olvidar credenciales*.
- **Pie** con el título, la versión, la fecha de apertura (la que pasa el lanzador) y el tiempo que lleva abierta.
- **Pasos plegables** (`data-me-paso`): se abren solos según haya sesión o no (`sin-sesion` / `con-sesion` / `siempre` / `nunca`), y muestran un resumen gris a la derecha.
- **Registro** con las instrucciones de uso impresas al abrir, más cada evento con hora y color. Captura además cualquier error de JavaScript de la página, así que no hace falta abrir la consola.
- **Avisos flotantes** y **spinner dentro del botón** para toda acción que tarde.

### Dar de alta una herramienta nueva

Una herramienta se registra en **dos sitios distintos**, y hay que tocar los dos
o queda a medias: si falta el primero no aparece en el menú lateral y **no se
puede llegar a ella navegando**; si falta el segundo no sale en la portada.

| Dónde | Qué se agrega | Para qué |
| --- | --- | --- |
| `assets/me-ui.js` → `APPS` | `{ id, titulo, icono, url }` dentro del grupo que corresponda | El **menú lateral**, que es el mismo en todas las páginas |
| `assets/logica-inicio.js` → `PROYECTOS` | La tarjeta con sus entregables y rutas | La **portada**: descarga de código y documentación |

El `id` debe ser el mismo en los dos sitios y coincidir con el `app` que la
página pasa a `MEUI.init()`; es lo que marca el elemento activo del menú.

El lanzador `dame click.bat` no hace falta tocarlo: abre solo dos páginas de
entrada y desde ahí se navega con el menú.

### Sesión compartida

Cada página maneja su propio token en memoria (no se puede compartir un objeto JS entre archivos abiertos por separado), pero **el estado y las credenciales sí se comparten** por `localStorage` + `BroadcastChannel`: al iniciar sesión en una pestaña, las demás lo reflejan y pueden autenticarse solas.

Si el navegador bloquea el almacenamiento (Edge lo hace en `file://` con la prevención de seguimiento), se usa un **respaldo en memoria**: la herramienta funciona igual y solo se pierde el compartir entre pestañas. Queda avisado en el registro.

### Tablas

`MEUI.tabla()` aplica los mismos defaults: idioma en español, `scrollX`, orden y búsqueda, y un `lengthMenu` con valores pequeños para revisar línea por línea. `MEUI.registrarTabla()` calcula **al píxel** el alto del cuerpo para que filtros, controles, filas y paginación quepan en pantalla sin scroll de página, y lo rehace al cambiar el tamaño de la ventana, al plegar un paso o al contraer el menú. `MEUI.mostrarSiHayDatos()` esconde la tabla mientras no haya datos y la muestra al llegar el primer resultado.

### Entrada y salida de datos

- `MEUI.parseLineas(texto)` acepta espacio, tabulación, salto de línea, `,`, `;` y `|`, y limpia `+57`, guiones y paréntesis.
- `MEUI.leerLibro(file)` / `filasDeHoja` / `detectarColumna` leen Excel y CSV con SheetJS.
- `MEUI.exportarCSV / exportarXLSX / exportarJSON` con separador **`;` por defecto**, cambiable desde cualquier control `data-me-sep` y compartido entre herramientas.

---

## 6. Estructura y lógica general

```txt
dame click.bat
   ├─ credenciales locales (DPAPI)  ──> usuario/clave del CM y, si aplica, de SIME
   ├─ login NTLM a SIME/Web         ──> token prf
   ├─ login Keycloak                ──> valida usuario/clave del CM
   └─ abre Edge con:  ?prf=…&abierto=…#cm_user=…&cm_pass=…
                                  │
                                  v
   me-ui.js  ── init() ──> lee la URL, la limpia, monta el shell,
                           comparte credenciales y estado de sesión
                                  │
                                  v
   me-api.js ── auth ────> token del CM, renovación y re-auth en 401
                                  │
                                  v
   logica-<herramienta>.js ─────> reglas de negocio (consultas propias)
                                  │
                                  v
   me-<herramienta>-puente.js ──> conecta ambas: chips, pasos, tablas,
                                  spinners y exportaciones
```

---

## 7. Flujo del lanzador

0. **Avisa si hay una versión nueva** (ver más abajo). Solo consulta y avisa — **nunca la descarga ni la aplica sola**; si no hay internet en ese momento o el host no responde, sigue de largo con la copia local sin más aviso.
1. **Verifica los archivos** en su carpeta. Si falta alguno, lo dice y sigue con los que haya.
2. **Lee las credenciales** del archivo local cifrado; si no existen, las pide por consola.
3. **SIME**: pide el token `prf` a `SIME/Web` con la sesión de Windows (NTLM). Si falla, ofrece reintentar, escribir usuario y clave de dominio, o saltarse el reporte de prepagadas y abrir el resto.
4. **CM**: valida usuario y clave contra Keycloak. Si Keycloak los rechaza, **borra** esas credenciales guardadas para que la próxima ejecución las vuelva a pedir.
5. **Prepara Edge**: borra el perfil temporal de la ejecución anterior.
6. **Abre la página** —una sola pestaña, ventana maximizada (`--start-maximized`)— con el `prf` en la query y las credenciales del CM en el fragmento.

> El cierre masivo de casos **ya no se abre solo**: se pide aparte con `/solo-casos`. La razón es que abrir dos pestañas dejaba una herramienta activa que nadie había pedido.

Cada paso se imprime en pantalla (`[1/6]`…`[6/6]`) y cualquier error queda visible con una pausa antes de cerrar.

### Credenciales

Se guardan en `%APPDATA%\reporte_prepagadas\` con `Export-Clixml` de un `PSCredential`: la contraseña queda cifrada con **DPAPI**, así que el archivo solo lo puede descifrar el mismo usuario de Windows en el mismo equipo. Son dos: `credenciales_cm.xml` (siempre) y `credenciales_sime.xml` (solo si se pide login explícito de SIME).

Todo se pide **por consola**: no se usa `Get-Credential`, porque su cuadro de diálogo puede quedar detrás de la ventana o estar bloqueado por política del equipo, y en ese caso el lanzador se queda mudo. La contraseña se escribe con `Read-Host -AsSecureString`.

### Cómo llegan los datos a la página

El `prf` viaja en la **query** (igual que el redirect de SIME) y las credenciales del CM en el **fragmento** (`#cm_user=…&cm_pass=…`), que no se envía en ninguna petición. Al cargar, `MEUI.init()` los lee, los comparte con las demás herramientas y **limpia la URL** con `history.replaceState`; si el navegador lo bloquea (pasa en `file://`), al menos borra el fragmento.

### Aviso de versión nueva, e instalarla aparte (`actualizar.bat`)

Cada equipo corporativo tiene su propia copia de esta carpeta (no hay dominio interno ni git/GitHub para distribuirla), así que actualizarla a mano en cada máquina no escala. Pero **descargar código nuevo, sobrescribir la carpeta y relanzarse solo, sin que nadie lo pida, es exactamente el patrón de comportamiento de un dropper de malware** — varios antivirus lo bloquean por eso, aunque el contenido sea inofensivo (fue justo lo que pasaba antes de v2.3: se bloqueaba al encontrar versión nueva, no al hacer la consulta). Por eso desde v2.3 el aviso y la instalación son **dos pasos separados**:

**`dame click.bat` (vía `scripts\lanzador.ps1`), como paso 0, SOLO consulta:**

1. Lee el archivo `scripts\VERSION` — un número `Major.Minor.Patch` como `2.2.1`, comparado como `[version]` de .NET: ordena bien `2.2.9 < 2.2.10 < 2.3.0`. Los números históricos incompletos se rellenan con ceros (`2.2` = `2.2.0`).
2. Pide `https://sebasmd.com/me/operacion/version.json` — dominio propio, **aprobado por la compañía y sin bloqueos de proxy**, y no depende de la VPN (a diferencia de SIME y del CM). Timeout corto (6 s): si no responde, se sigue con la copia local sin más aviso que una nota en pantalla.
3. Si `version.json.version` es mayor que el `VERSION` local, **avisa en pantalla** («hay una versión nueva: X → Y») y dice que corras `actualizar.bat` cuando quieras instalarla. No descarga nada más.

Se puede omitir con `dame click.bat /sinupdate` (útil para depurar sin depender de la red, o si se está editando la copia local a propósito).

**`actualizar.bat` (vía `scripts\actualizar.ps1`), aparte y siempre a mano, es el que de verdad instala:**

1. Repite la misma consulta a `version.json`. Si ya está al día, lo dice y termina — y muestra **las dos versiones** (local y publicada), no solo la local: así, si algún día la comparación da un resultado raro, se puede confirmar desde la propia pantalla qué fue lo que se leyó.
2. Si hay versión nueva, muestra las notas (si trae) y **pregunta antes de tocar nada** (`¿Instalar esta version ahora? [S/n]`; se puede saltar con `/sinconfirmar`).
3. Descarga el `.zip` que indica `version.json.zip` a una carpeta temporal.
4. **Verifica su SHA-256** contra el que trae `version.json` — si `version.json` incluye `sha256` (todo release generado desde v2.3 lo trae) y no coincide, **se detiene sin aplicar nada**. HTTPS ya protege el transporte; esto además cubre que el `.zip` publicado sea justo el que se generó con `empaquetar-release.ps1`, no uno corrupto o distinto. Al terminar, registra como versión local la versión publicada, incluso si el ZIP reutilizado traía un `scripts\VERSION` anterior.
5. Lo descomprime **ahí mismo** (no sobre la carpeta en uso) con `Expand-Archive`, y solo si eso termina bien copia el contenido encima de la carpeta real con `robocopy … /E` (sobrescribe, pero **no borra** archivos locales que ya no vengan en el `.zip` — más seguro que `/MIR` frente a un error de rutas).
6. **Limpia restos de una versión anterior a v2.4** — antes del reordenamiento a `scripts\`, `lanzador.ps1`/`actualizar.ps1`/`VERSION` vivían sueltos en la raíz; como el paso anterior no borra nada que no venga en el `.zip` nuevo, esos archivos quedarían huérfanos en la raíz (sin romper nada: el `dame click.bat` nuevo ya apunta a `scripts\lanzador.ps1`). Tanto `actualizar.ps1` como `lanzador.ps1` detectan y borran esos restos solos, así que actualizar desde una versión anterior a v2.4 termina con la raíz limpia igual, aunque no sea en el mismo instante.
7. Avisa que ya quedó instalado y que corras `dame click.bat` cuando quieras abrir las herramientas. **No se relanza nada solo.**

Si cualquier parte de esto falla (sin internet, host caído, `.zip` corrupto, hash que no coincide, `robocopy` falla), se avisa en rojo/amarillo y **no se cambia nada** — nunca deja la carpeta a medias.

**Armar una versión nueva para publicar** (no usa git, GitHub ni Python — solo PowerShell). Se corre con `scripts\empaquetar-release.bat`, no llamando al `.ps1` directo: así tampoco choca con la `ExecutionPolicy` del equipo (mismo motivo por el que `dame click.bat` no es un `.ps1` suelto). Se corre desde la raíz del proyecto:

```bat
scripts\empaquetar-release.bat
scripts\empaquetar-release.bat -Version 3.0.0 -Notas "que trae"
scripts\empaquetar-release.bat -Incremento Fix -Notas "que trae"

REM Firmando lanzador.ps1 y actualizar.ps1 con Authenticode (opcional):
scripts\empaquetar-release.bat -CertThumbprint 0123456789ABCDEF0123456789ABCDEF01234567
scripts\empaquetar-release.bat -CertPfx C:\ruta\certificado.pfx
```

Sin `-Version` ni `-Incremento`, lee `scripts\VERSION` y ofrece **Fix/documentación** (`Z+1`, recomendado), **Minor** (`Y+1`, reinicia Z), **Major** (`X+1`, reinicia Y/Z) o una versión `X.Y.Z` personalizada. Para automatización se usa `-Version 3.0.0` o `-Incremento Fix|Minor|Major`. Genera `release\me-operacion-<version>.zip` y `release\version.json` (con el `sha256` del `.zip` incluido). Hay que subir **esos dos archivos** a `https://sebasmd.com/me/operacion/` (el `.zip` con nombre nuevo cada vez, no hace falta borrar los viejos; `version.json` siempre reemplaza al que ya esté). El script también deja `scripts\VERSION` en el número nuevo.

**Firma (Authenticode).** Los `.bat` (`dame click.bat`, `actualizar.bat`) **no se pueden firmar de ninguna forma** — Windows no tiene un formato de firma para archivos batch. Por eso la lógica pesada vive en `scripts\lanzador.ps1` y `scripts\actualizar.ps1`: son los que de verdad hacen llamadas de red y tocan archivos, y son los que sí se pueden firmar. Sin `-CertThumbprint` ni `-CertPfx`, este paso se omite — igual que la consulta de versión, nunca bloquea el empaquetado por no tener un certificado configurado. Un certificado de firma de código (OV, ~USD 70-200/año) ayuda tanto al escaneo estático como a la reputación de SmartScreen; uno EV (más caro) da reputación inmediata en vez de tener que "ganarla" con volumen de descargas.

**Probar el mecanismo sin preparar una release real**: sube a cPanel un `version.json` con un número mayor apuntando al **mismo** `.zip` que ya esté ahí (no hace falta tocar el `.zip`; el hash publicado seguirá siendo el de ese archivo y `actualizar.ps1` lo verificará normalmente). `dame click.bat` lo detecta y avisa; al correr `actualizar.bat`, la versión local queda en el número publicado aunque el ZIP reutilizado contenga un `scripts\VERSION` anterior.

Qué entra en el paquete (lista fija, no "todo lo que haya en la carpeta"): `index.html`, `assets\`, `herramientas\`, `doc\`, `dame click.bat`, `actualizar.bat`, `scripts\lanzador.ps1`, `scripts\actualizar.ps1` y `scripts\VERSION`. **`scripts\empaquetar-release.ps1`/`.bat` NUNCA se incluyen** — es una herramienta de quien mantiene el proyecto, no algo que necesite un analista. Por dentro, `empaquetar-release.ps1` arma esta estructura copiando cada pieza a una carpeta temporal antes de comprimir (`Compress-Archive`, al recibir la ruta de un archivo suelto, lo deja en la raíz del `.zip`; no hay forma de pedirle que quede dentro de una subcarpeta `scripts\` sin antes tenerlo de verdad ahí). Las credenciales guardadas (`%APPDATA%\reporte_prepagadas\`) nunca viajan: viven fuera de esta carpeta.

### Parámetros

| Comando | Qué hace |
|---|---|
| `dame click.bat` | Flujo normal: **una sola pestaña** con el reporte de líneas prepagadas, en una ventana **maximizada**. |
| `dame click.bat /solo-reporte` | Lo mismo que sin parámetros (explícito). |
| `dame click.bat /solo-casos` | Solo el cierre masivo de casos. |
| `dame click.bat /sinsesion` | Pide usuario y clave de Windows para SIME en vez de usar la sesión activa. |
| `dame click.bat /reset` | Borra todas las credenciales guardadas. |
| `dame click.bat /resetsime` · `/resetcm` | Borra solo las de SIME o solo las del CM. |
| `dame click.bat /sinupdate` | No avisa de actualizaciones esta vez. |
| `dame click.bat /debug` | Muestra la excepción completa y el stack trace. |
| `actualizar.bat` | Instala la versión nueva, si hay una (pregunta antes de aplicar). |
| `actualizar.bat /sinconfirmar` | Igual, sin preguntar (para correrlo desde otro script propio). |
| `actualizar.bat /debug` | Muestra la excepción completa y el stack trace. |

> Desde v2.3, `dame click.bat` y `actualizar.bat` son lanzadores delgados: cada uno solo invoca a su `.ps1` real (`scripts\lanzador.ps1` / `scripts\actualizar.ps1`) con `-ExecutionPolicy Bypass`. Antes `dame click.bat` era un archivo mixto que `cmd` ejecutaba en sus primeras líneas y que después de un marcador `#POWERSHELL#` se leía a sí mismo y corría ese bloque con `Invoke-Expression` — un patrón ("script que se decodifica y se ejecuta a sí mismo") que varios antivirus vigilan de cerca, independientemente de qué tan inofensivo fuera el contenido. Ninguno de los dos genera archivos temporales. Desde v2.4, además, los `.ps1` viven en `scripts\` y no sueltos en la raíz — ver el historial de cambios (§10).

---

## 8. API de los módulos compartidos

```js
// --- me-ui.js ---
MEUI.init({ app, version, titulo, descripcion, sesiones, instrucciones, apps })
MEUI.log(mensaje, "ok|err|warn|info") / MEUI.limpiarLog() / MEUI.toast(msg, nivel)
MEUI.ocupado(btn, texto) / MEUI.libre(btn) / MEUI.conSpinner(btn, texto, fn)
MEUI.autoSpinner("#btn", texto) / MEUI.enterEjecuta(input, boton)
MEUI.tabla(sel, opciones) / registrarTabla(dt) / ajustarTablas()
MEUI.prepararTabla(sel) / mostrarSiHayDatos(sel, {vacio, tabla})
MEUI.parseLineas(txt) / leerLibro(file) / filasDeHoja(wb, hoja) / detectarColumna(cols)
MEUI.exportarCSV(cab, filas, base) / exportarXLSX(cab, filas, base, hoja, {numFmt})
MEUI.exportarJSON(datos, base) / MEUI.descargar(blob, nombre)
MEUI.sesion.set|caida|cerrar|estado("cm"|"sime") / MEUI.cred.get|set|borrar(...)
MEUI.abrirPaso(n, bool) / MEUI.resumenPaso(n, texto)

// --- me-api.js ---
MEAPI.CONFIG / MEAPI.configurar({ locale: "en" })
MEAPI.auth.ensure() / reauth(version) / leerCampos() / salir()
MEAPI.getJson(ruta, params)
MEAPI.api(ruta, { method, body, headers, params })
MEAPI.cabeceras(extra)
```

Eventos que emite el shell y atiende cada puente: `me:sesion-iniciar`, `me:sesion-renovar` (a 15 s del vencimiento) y `me:sesion-cerrar`, todos con `detail.clave`.

---

## 9. Riesgos

- **Transporte**: los endpoints del CM y de Keycloak son **HTTP plano**. Usuario y clave viajan en el direct grant y el token queda en memoria del navegador.
- **Credenciales compartidas**: para que la sesión se sienta única entre archivos, quedan en `localStorage` ofuscadas (no cifradas) mientras dure la jornada. Es el mismo nivel de exposición que el `#cm_pass` de la URL. «Olvidar credenciales» las borra al instante.
- **`--disable-web-security`**: la ventana de Edge que abre el lanzador no tiene aislamiento de origen. No debe usarse para navegar a nada más. Esta bandera (junto con `--inPrivate` y el perfil temporal desechable) es una combinación que varios antivirus/EDR vigilan de cerca, porque es la misma firma que usan herramientas para saltarse el aislamiento de origen del navegador. Se probó un servidor local (`http://localhost` + proxy al CM/Keycloak) como camino para quitar esta bandera, pero la prueba real quedó **bloqueada por el antivirus/EDR** del equipo — el mismo tipo de detección que se buscaba evitar — así que se descartó. Sigue siendo un riesgo abierto, sin una alternativa que no requiera dominio interno, admin, SharePoint o GitHub (ver también §10, v2.4).
- **Dependencia de CDNs externos**: si un CDN está bloqueado o caído, las herramientas no cargan. Mezclan red interna con CDN público.
- **Almacenamiento bloqueado**: con la prevención de seguimiento de Edge activa, la sesión no se comparte entre pestañas (funciona igual, pero hay que iniciar sesión en cada una).
- **Dependencia de la sesión de Windows**: obtener el `prf` automáticamente requiere sesión NTLM válida y, normalmente, abrir desde el `.bat`.
- **Un cambio en la base afecta a las cuatro**: es la contraparte de no duplicar código. Conviene probar las cuatro páginas después de tocar `me-ui` o `me-api`.
- **Auto-actualización desde un dominio personal**: `sebasmd.com` no es infraestructura de la compañía. Si esa cuenta o ese servidor se vieran comprometidos, es una vía para distribuir código a todos los equipos que corran el lanzador. El paquete se descarga y se extrae en una carpeta temporal antes de tocar nada (un `.zip` corrupto nunca llega a aplicarse), pero no hay firma ni verificación de integridad del contenido: quien pueda publicar en esa ruta, puede publicar lo que sea.

---

## 10. Historial de cambios

| Versión | Cambios |
|---|---|
| **2.4** | Reordenamiento de archivos: en la raíz del proyecto solo quedan `index.html`, `dame click.bat` y `actualizar.bat`; **todo `.ps1` se mueve a `scripts\`** (`lanzador.ps1`, `actualizar.ps1` y también `empaquetar-release.ps1`/`.bat`, que nunca se distribuye), y `VERSION` se mueve a `scripts\VERSION`. `dame click.bat`/`actualizar.bat` pasan a invocar `scripts\lanzador.ps1` / `scripts\actualizar.ps1`. `lanzador.ps1` y `actualizar.ps1` limpian solos, la primera vez que los ven, los restos de `lanzador.ps1`/`actualizar.ps1`/`VERSION` sueltos en la raíz que deja una actualización desde una versión anterior a esta (robocopy sin `/MIR` no los borra solo). `actualizar.ps1` ahora muestra la versión publicada además de la local al decir "ya estás al día". Se corrige además un bug real: `version.json` se generaba con BOM (`Set-Content -Encoding UTF8` en Windows PowerShell 5.1 siempre lo agrega), lo que hacía que `Invoke-RestMethod` devolviera un objeto vacío sin avisar de ningún error — la versión publicada se leía como "0.0". Se corrigió en el origen, en `empaquetar-release.ps1`, que escribe UTF-8 sin BOM. El lanzador y el actualizador también leen los bytes explícitamente como UTF-8 y normalizan Unicode para tolerar encabezados HTTP incompletos o alterados por un proxy. `GETTINGSTARTED.md` y el `README.md` general se mueven a `doc\`. Guía de instalación y mapa del proyecto: `doc/GETTINGSTARTED.md` y `doc/README.md`. Se retira el servidor local experimental (`server\`, `doc/servidor-local` y el modo dual de `assets/me-api.js`): la prueba real en un equipo de analista quedó bloqueada por el antivirus/EDR, el mismo problema que se buscaba evitar. Queda como riesgo abierto sin solución (ver §9). |
| 2.3 | `dame click.bat` pasa a ser un lanzador delgado: la lógica real se movió a `lanzador.ps1` (invocado como archivo, no como bloque embebido con `Invoke-Expression` — patrón que varios antivirus bloqueaban justo al encontrar versión nueva). Instalar una actualización se separó en `actualizar.bat`/`actualizar.ps1`, aparte y siempre a mano (antes se aplicaba sola y se relanzaba en silencio, otro patrón vigilado por antivirus); `actualizar.ps1` además verifica el SHA-256 del `.zip` contra `version.json` antes de aplicar. `empaquetar-release.ps1` gana firma Authenticode opcional (`-CertThumbprint` / `-CertPfx`) para `lanzador.ps1`/`actualizar.ps1` (los `.bat` no se pueden firmar) y genera el `sha256` en `version.json`. Se agrega `server/` (experimental, no conectado al lanzador): sirve las herramientas por `http://localhost` con proxy hacia el CM/Keycloak, como camino para eventualmente quitar `--disable-web-security` — ver `doc/servidor-local/README.md`. |
| 2.2 | Auto-actualización: `dame click.bat` revisa `https://sebasmd.com/me/operacion/version.json` antes de todo lo demás y, si hay una versión nueva, la descarga, la aplica y se relanza solo (flag `/sinupdate` para omitirlo). Versión tipo `1.0`/`1.1` (comparada como `[version]`, no como número entero). Se agregan `empaquetar-release.ps1` + `empaquetar-release.bat` (este último para no chocar con la `ExecutionPolicy` del equipo) para armar el `.zip` + `version.json` que hay que subir, y el archivo `VERSION` en la raíz del proyecto. |
| 2.1 | El lanzador abre **una sola pestaña** (el reporte de líneas prepagadas) y la ventana de Edge sale **maximizada**. El cierre masivo de casos deja de abrirse por defecto: se pide con `/solo-casos`. |
| 2.0 | Se extraen `me-ui.css`, `me-ui.js` y `me-api.js` como base común de las cuatro herramientas: shell, sesión compartida, registro, tablas, importación y exportación, más los endpoints y el `auth` que antes estaban copiados en cada archivo. Los `.html` quedan solo con marcado. El lanzador pasa la marca de apertura (`abierto=`) para el pie. |
| 1.0 | `dame click.bat`: credenciales en archivo local cifrado con DPAPI, login NTLM a SIME, validación del CM contra Keycloak y apertura de Edge con la sesión lista. |
