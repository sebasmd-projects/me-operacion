# Base compartida y lanzador `dame click.bat` — Documentación técnica

> **Versión: v4.0.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
>
> **Dónde vive cada versión (una sola vez):** la de la **base** (esta documentación, el shell, el lanzador) está en `scripts\VERSION` y en `ME_CATALOGO.version` de `assets/base/catalogo.js`, que el empaquetador mantiene iguales; la de **cada herramienta** está únicamente en su entrada del catálogo (`version`). El HTML ya no la repite en `MEUI.init`; el **historial del README** de la herramienta sí menciona cada versión (una fila por cambio), y al subirla se tocan solo esos dos sitios: el catálogo y el historial.

Las herramientas de operación son archivos HTML independientes, pero **comparten una base**: el mismo marco visual, la misma sesión y el mismo acceso al CM. Esa base son cinco archivos en `assets/base/` (`me-ui.css`, `me-ui.js`, `me-api.js`, `catalogo.js`, `dependencias.js`) más el lanzador `dame click.bat` + `scripts\lanzador.ps1`, que deja la sesión lista antes de que aparezca la primera página.

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

> Cambiar una URL del CM, una cabecera o el manejo del token se hace **una vez** en `me-api.js`. Cambiar un color, el alto de las tablas o el formato de exportación se hace **una vez** en `me-ui`. Agregar o renombrar una herramienta se hace **una vez** en `catalogo.js`. Cambiar la versión de una librería se hace **una vez** en `dependencias.js`.

---

## 1. Objetivos

- Que todas las herramientas se vean y se usen igual, sin copiar código entre ellas.
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
  reiniciar-credenciales.bat     doble clic = dame click.bat /reset: borra las credenciales
                                 guardadas (CM y SIME), las vuelve a pedir y abre las
                                 herramientas; se distribuye en el paquete
  empaquetar-release.bat/.ps1    arma el paquete de una release; NUNCA se distribuye
  VERSION                        número de versión de esta copia

assets\
  base\                     la base: la usan todas las herramientas
    me-ui.css                 sistema de diseño: color, shell, pasos, tablas, log
    me-ui.js                  shell (lateral/cabecera/pie), sesión compartida,
                              registro, defaults y alto de DataTables,
                              lectura de líneas/Excel y exportación
    me-api.js                 endpoints, cabeceras, objeto auth y llamadas al CM
    catalogo.js               catálogo ÚNICO de herramientas (window.ME_CATALOGO)
    dependencias.js           registro ÚNICO de librerías de CDN (versión y URLs)
  compartido\               módulos que usan varias herramientas, sin ser la base
    cm-lineas.js              operaciones de línea del CM (Bloquear/Inactivar, Cambio IMSI y línea, Titularidad)
    hlr-consulta.js           motor de ubicación Claro + Tigo (Titularidad)
    tulio-plu.js              Tulio RecargaPaquete (Aplicar PLU y Consumos)
    genesis-api.js            sesión y paginación de Genesis
    genesis-bookmarklet.js    código del marcador que lleva el token de Genesis
  herramientas/<id>/        una carpeta por herramienta, incluida inicio
    <id>.js                 configuración, reglas de negocio e interfaz (lógica y puente unidos)
    <id>.css                estilos exclusivos, fuera del HTML
    motores adicionales     solo cuando la herramienta los necesita
```

Cada herramienta (y la portada) trae en su `<head>` el registro de librerías y, al final, el catálogo y el shell. Orden de carga, idéntico en todas las páginas (en `index.html`, en la raíz, sin el `../`):

```html
<head>
  <script src="../assets/base/dependencias.js" data-me-deps="datatables xlsx"></script>
  <link rel="stylesheet" href="../assets/base/me-ui.css">
  <link rel="stylesheet" href="../assets/herramientas/prepagadas/prepagadas.css">
</head>
...
<script src="../assets/base/catalogo.js"></script>
<script src="../assets/base/me-ui.js"></script>
<script> MEUI.init({ app: "prepagadas", sesiones: ["sime", "cm"], instrucciones: [...] }); </script>
<script src="../assets/base/me-api.js"></script>
<script src="../assets/compartido/<módulo>.js"></script>     <!-- solo los que use -->
<script src="../assets/herramientas/prepagadas/prepagadas.js"></script>
```

El orden importa: `dependencias.js` va primero en el `<head>` y antes de `me-ui.css`, para que las librerías estén cargadas y el CSS propio pise al de Bootstrap; `MEUI.init()` va **antes** de la lógica porque mueve el contenido dentro del shell y porque consume los parámetros que deja el lanzador en la URL. En `MEUI.init` solo quedan lo propio de la página (`app`, `sesiones`, `sesionesOpcionales`, `instrucciones`…): el **título, la descripción, la versión y la documentación se toman del catálogo** por el `app`. Lo que la página pase aparte tiene prioridad sobre el catálogo.

Cada herramienta vive en `assets/herramientas/<id>/`: su JS une configuración, reglas de negocio e interfaz; su CSS se enlaza después de la base. Inicio sigue la misma regla (`assets/herramientas/inicio/inicio.js` e `inicio.css`). HLR/HSS, Cambio IMSI y línea y otras herramientas con motores adicionales conservan esos archivos en su propia carpeta, listados en `codigo.archivos` en orden de carga.

**Dónde va cada estilo:** si se usa en dos o más herramientas, va a «Componentes compartidos» de `assets/base/me-ui.css`; si solo lo usa una, va a su `<id>.css`. No se incrusta CSS en el HTML ni se copia un componente compartido. Los colores equivalentes usan `.badge-estado`; las diferencias necesarias de tamaño o estado se definen una sola vez en la base, con variantes por `body[data-me-herramienta]` y `:where` para conservar la especificidad. El atributo del body coincide con el `app` del catálogo.

### El catálogo (`assets/base/catalogo.js`)

Define `window.ME_CATALOGO` con:

| Campo | Qué es |
|---|---|
| `version` | Versión de la base. Igual a `scripts\VERSION`: el empaquetador la reescribe en este archivo. |
| `grupos` | Los grupos del menú lateral, en orden (`Inicio`, `Consultas`, `Operaciones`, `HLR/HSS`, `Utilidades`). |
| `herramientas` | Una entrada por página, **en el orden de las tarjetas y del Backlog de Inicio**. |
| `base` | La base compartida: no es una página, pero sus archivos van en el Backlog y en las descargas. |
| `buscar(id)` | La entrada con ese `id`. |

Cada herramienta lleva `id`, `nombre` (título de la página, de la tarjeta y del Backlog), `menu` (etiqueta más corta del menú, opcional), `grupo` y `orden` (posición dentro del grupo; sin `grupo` no sale en el menú), `icono`, `resumen` (la línea bajo el título), `descripcion` (la tarjeta), `estado`, `version`, `html`, `doc`, `codigo` (`descripcion` y `archivos` `{ ruta, tipo }`, además del HTML), `docDescripcion` y, si la página existe pero no debe salir en Inicio, `enInicio: false`. Todas las rutas son relativas a la **raíz** del proyecto; `me-ui.js` las traduce según la página que las use. La prueba de la suite comprueba que cada ruta del catálogo exista.

### Las dependencias (`assets/base/dependencias.js`)

Es un registro de librerías: para cada una, `nombre`, `version`, `requiere` (otras librerías que van antes: DataTables arrastra a jQuery), `css` y `js` (con `{v}` donde va la versión). Cada página declara lo que usa en `data-me-deps` (`datatables`, `xlsx`, `tomselect`, `jszip`, `jspdf`, `lamejs`, `chartjs`, `marked`) y el script escribe los `<link>` y `<script>` con `document.write`. Bootstrap, Bootstrap Icons y las fuentes se cargan **siempre**. Se usa `document.write` y no `createElement` porque las herramientas son scripts clásicos que se abren sobre `file://`, no hay paso de construcción y los `<script>` escritos durante el análisis del HTML se descargan y ejecutan **en orden y de forma síncrona**, antes de los scripts de la página; con `createElement` el orden no está garantizado y `import`/`fetch` los bloquea `file://`. `jspdf` se marca `defer` para no retrasar el primer pintado de la página (pesa unos 350 KB).

---

## 3. Herramientas de terceros

Las versiones de esta tabla viven en `assets/base/dependencias.js`; aquí se resumen.

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, dropdowns, pestañas, modales, badges. |
| **Bootstrap Icons** | 1.11.3 | Iconos del menú, botones y estados. |
| **DataTables** | 2.3.2 (+ integración `bootstrap5`) | Tablas con paginado, búsqueda y orden en pantalla. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Leer `.xlsx`/`.csv` y exportar a `.xlsx`. |
| **Tom Select** | 2.4.3 | Selects con búsqueda y etiquetas editables. |
| **marked** | 12.0.2 | Renderiza los README en el inicio y en el modal de documentación. |
| **JSZip** · **jsPDF** · **lamejs** · **Chart.js** | 3.10.1 · 2.5.1 · 1.2.1 · 4.4.1 | ZIP de filiales y de audios · PDF del rechazo · MP3 · gráficas de Consumos. Solo las páginas que los declaran. |
| **Archivo / IBM Plex Mono** | — | Tipografías (Google Fonts). |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** (`optiva`) | Autenticación OpenID Connect del CM: *direct grant* y *refresh token*. |
| **API Gateway OBP** | Todas las consultas y órdenes al CM de todas las herramientas. |
| **SIME / SIME Web** | Solo lo usa el reporte de prepagadas (token `prf` por NTLM). |
| **Tulio** | Aplicar PLU y Consumos (`client_credentials` + `RecargaPaquete`); la autenticación vive en `assets/compartido/tulio-plu.js`, no en `me-api.js`. |
| **QDN Claro / HLR Tigo** | Motores de HLR/HSS y validadores; cada uno con su propia autenticación en su carpeta de `assets/herramientas/`. |

CDNs usados: jsdelivr, datatables.net, code.jquery.com, cdnjs y Google Fonts. Todos externos (ver §9).

---

## 4. Endpoints

Todos los que centraliza `me-api.js`:

| Método | Endpoint | Para qué |
|---|---|---|
| `POST` | `{kcBase}/auth/realms/{realm}/protocol/openid-connect/token` | Login (`grant_type=password`) y renovación (`grant_type=refresh_token`). |
| `GET` | `{apiBase}{ruta}` vía `MEAPI.getJson(ruta, params)` | Cualquier consulta autenticada al CM. |
| `*` | `{apiBase}{ruta}` vía `MEAPI.api(ruta, {method, body, headers})` | Llamadas con cuerpo: `PATCH`, `POST`, `PUT`. |

Fuera de `me-api.js`, el lanzador y el actualizador leen las releases de la **carpeta de red** `\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release` (`version.json` + `me-operacion-X.Y.Z.zip`; ver §7). No es un endpoint HTTP: es una ruta de red de Windows que exige VPN.

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

- **Menú lateral** armado desde `ME_CATALOGO` (grupos, `orden`, `menu`/`nombre` e `icono`), contraíble a solo iconos (la flecha cambia de sentido) y recordado entre archivos. Bajo 992 px se convierte en menú deslizante con botón hamburguesa. Las rutas del catálogo son relativas a la raíz; `rutaDesdeRaiz()` les antepone `../` cuando quien pinta el menú es una herramienta (carpeta `herramientas/`).
- **Cabecera**: título, descripción y un **chip por sesión** (SIME y/o CM) con semáforo: verde activa, naranja por expirar, rojo expirada, gris sin sesión. Muestra el usuario y los segundos que faltan. Al hacer clic se abre un menú con *iniciar sesión*, *cerrar* y *olvidar credenciales*.
- **Pie** con el título, la versión, la fecha de apertura (la que pasa el lanzador) y el tiempo que lleva abierta.
- **Pasos plegables** (`data-me-paso`): se abren solos según haya sesión o no (`sin-sesion` / `con-sesion` / `siempre` / `nunca`), y muestran un resumen gris a la derecha.
- **Registro** con las instrucciones de uso impresas al abrir, más cada evento con hora y color. Captura además cualquier error de JavaScript de la página, así que no hace falta abrir la consola.
- **Avisos flotantes** y **spinner dentro del botón** para toda acción que tarde.

### Buscador global

La cabecera permite buscar herramientas con `/` o `Ctrl+K`. Busca sin distinguir
mayúsculas ni tildes y separa los términos por espacios, `/`, `|` y comas: basta
que coincida cualquiera. Prioriza nombre, después contexto y finalmente
descripción o resumen; los empates conservan el orden del catálogo.

Las palabras se agregan **solo en `contexto: [...]` de cada herramienta en
`assets/base/catalogo.js`**: sistemas que consulta, operadores, datos y acciones
que realiza. Por ejemplo, el contexto HLR/HSS permite encontrar también
Portabilidad Tigo y Titularidad. `ME_CATALOGO.buscar(texto)` devuelve un arreglo
ordenado de herramientas; `ME_CATALOGO.obtener(id)` recupera una por su id.
La consulta vacía devuelve todas las herramientas visibles en Inicio.

En Inicio filtra tarjetas y Backlog. En las demás páginas muestra enlaces con
icono, nombre y resumen: flechas para elegir, Enter para abrir y Escape para
cerrar. En móvil la lupa despliega el campo.

### Dar de alta una herramienta nueva

Una herramienta se registra en **un solo sitio**: un objeto nuevo en `herramientas` de `assets/base/catalogo.js`. De ahí salen el menú lateral, la tarjeta y el Backlog de la portada, y el título, la descripción, la versión y la documentación que `MEUI.init` muestra en la página.

1. Crea `herramientas/<nombre>.html` y copia el `<head>` de otra: `dependencias.js` con las librerías que use en `data-me-deps`, y después `me-ui.css`. Al final del `<body>`: `catalogo.js`, `me-ui.js`, `MEUI.init({ app: "<id>", sesiones, instrucciones })`, `me-api.js`, los módulos de `assets/compartido/` que use, los motores adicionales que necesite y `assets/herramientas/<id>/<id>.js`. Crea en esa misma carpeta `<id>.css` y enlázalo después de la base.
2. Crea `doc/<carpeta>/README.md` con su historial (la versión inicial va en la primera fila).
3. Agrega la entrada al catálogo: `id` (el mismo `app` de la página), `nombre`, `grupo` y `orden` en el menú, `icono`, `resumen`, `descripcion`, `contexto` (sistemas, operadores, datos y acciones reales; alimenta el buscador global), `estado`, `version`, `html`, `doc`, `codigo.archivos` y `docDescripcion`. Su posición en el arreglo es su posición en Inicio.
4. Si necesita una librería que no está en `dependencias.js`, agrégala ahí una vez (nombre, versión, URLs) y decláralo en `data-me-deps`.
5. Corre la prueba: comprueba que cada ruta del catálogo exista, que el HTML y el catálogo coincidan y que la página cargue sin errores.

No hay que tocar `me-ui.js`, `assets/herramientas/inicio/inicio.js` ni `dame click.bat` (que abre solo dos páginas de entrada; desde ahí se navega con el menú).

### Sesión compartida

Cada página maneja su propio token en memoria (no se puede compartir un objeto JS entre archivos abiertos por separado), pero **el estado y las credenciales sí se comparten** por `localStorage` + `BroadcastChannel`: al iniciar sesión en una pestaña, las demás lo reflejan y pueden autenticarse solas.

Si el navegador bloquea el almacenamiento (Edge lo hace en `file://` con la prevención de seguimiento), se usa un **respaldo en memoria**: la herramienta funciona igual y solo se pierde el compartir entre pestañas. Queda avisado en el registro.

### Tablas

`MEUI.tabla()` aplica los mismos defaults: idioma en español, `scrollX`, orden y búsqueda, y un `lengthMenu` con valores pequeños para revisar línea por línea. En escritorio (≥1200px), el área de trabajo con tablas ocupa el alto disponible mediante flex: las barras y controles conservan su alto y solo el cuerpo de DataTables se desplaza. `MEUI.registrarTabla()` ajusta los anchos; el alto lo reparte CSS, también dentro de pestañas. Los paneles `data-me-alto="fijo"` conservan su alto explícito y las pantallas menores usan un cuerpo de tabla de 42vh. `MEUI.mostrarSiHayDatos()` esconde la tabla mientras no haya datos y la muestra al llegar el primer resultado.

**Convención de barras:** filtros, selección y lote de una misma tabla son hijos de un único `<div class="me-barras">`, antes de `.me-tabla-panel`, tanto en `.me-trabajo-datos` como dentro de una pestaña. La selección usa `.me-filtros`. Las barras comparten filas cuando caben y hacen wrap cuando falta ancho; ninguna barra ni control de DataTables es sticky. En escritorio permanecen visibles porque solo se desplazan las filas. En pantallas menores la columna de pasos es sticky, con su propio scroll y el botón de contraer siempre accesible. La base observa tamaños con `ResizeObserver` y cambios de visibilidad/marcado con `MutationObserver`: filtros, lote, estados, avisos y paneles montados disparan un reajuste con debounce de 120ms, sin código por herramienta ni observar el interior de DataTables.

### Entrada y salida de datos

- `MEUI.parseLineas(texto)` acepta espacio, tabulación, salto de línea, `,`, `;` y `|`, y limpia `+57`, guiones y paréntesis.
- `MEUI.leerLibro(file)` / `filasDeHoja` / `detectarColumna` leen Excel y CSV con SheetJS.
- `MEUI.exportarCSV / exportarXLSX / exportarJSON` con separador **`;` por defecto**, cambiable desde cualquier control `data-me-sep` y compartido entre herramientas.
- `MEUI.formatearPayload(texto)` → `{ tipo: "json"|"xml"|"texto", texto }`: sangra (2 espacios) JSON y XML/SOAP para leerlos; si no es ni uno ni otro, o está roto, devuelve el original idéntico. Función pura. `MEUI.htmlPayload({tipo, texto})` devuelve ese texto como HTML con la sintaxis pintada (clases `me-sx-*`, tokens `--me-sx-*` en `me-ui.css`); **escapa cada trozo del texto** antes de envolverlo, así que es seguro para datos de sistemas externos. Úsalas siempre juntas: no hagas `innerHTML` con texto del servidor por tu cuenta.

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
   herramientas/<id>/<id>.js ──> configuración, reglas e interfaz:
                                  chips, pasos, tablas, spinners y exportaciones
```

---

## 7. Flujo del lanzador

0. **Avisa si hay una versión nueva** (ver más abajo). Solo consulta y avisa — **nunca la descarga ni la aplica sola**; si la carpeta de releases no responde (sin VPN, NAS caído), sigue de largo con la copia local en 6 s como máximo.
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

Cada equipo corporativo tiene su propia copia de esta carpeta (se distribuye por ZIP, no por Git), así que actualizarla a mano en cada máquina no escala. Pero **descargar código nuevo, sobrescribir la carpeta y relanzarse solo, sin que nadie lo pida, es exactamente el patrón de comportamiento de un dropper de malware** — varios antivirus lo bloquean por eso, aunque el contenido sea inofensivo (fue justo lo que pasaba antes de v2.3: se bloqueaba al encontrar versión nueva, no al hacer la consulta). Por eso desde v2.3 el aviso y la instalación son **dos pasos separados**:

**`dame click.bat` (vía `scripts\lanzador.ps1`), como paso 0, SOLO consulta:**

1. Lee el archivo `scripts\VERSION` — un número `Major.Minor.Patch` como `2.2.1`, comparado como `[version]` de .NET: ordena bien `2.2.9 < 2.2.10 < 2.3.0`. Los números históricos incompletos se rellenan con ceros (`2.2` = `2.2.0`).
2. Lee `version.json` de la **carpeta de releases** en la red de la compañía (`\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release`; desde la v3.0.0 es la **única** fuente —antes era `https://sebasmd.com/me/operacion/`—). Se llega con la VPN, igual que a SIME y al CM. La lectura corre aparte con un tope de **6 s**: un recurso de red inaccesible puede bloquear Windows 20-60 s, y el lanzador no espera eso; si no responde, sigue con la copia local y deja una nota en pantalla. Para probar contra otra carpeta: `dame click.bat /origen:"<carpeta>"`.
3. Si `version.json.version` es mayor que el `VERSION` local, **avisa en pantalla** («hay una versión nueva: X → Y») y dice que corras `actualizar.bat` cuando quieras instalarla. No descarga nada más.
4. Además pasa la versión a la página que abre (`?nv=<nueva>&va=<actual>` en la URL). `MEUI.init()` la lee junto con el resto de lo que deja el lanzador y muestra un **modal** «Nueva versión X» — «Actual Y → Nueva X». Como la URL se limpia al leerla, el aviso sale **solo al abrir** la herramienta desde `dame click.bat`, no al cambiar de herramienta ni al volver a una.

Se puede omitir con `dame click.bat /sinupdate` (útil para depurar sin depender de la red, o si se está editando la copia local a propósito).

**`actualizar.bat` (vía `scripts\actualizar.ps1`), aparte y siempre a mano, es el que de verdad instala:**

1. Repite la misma consulta a `version.json`. Si ya está al día, lo dice y termina — y muestra **las dos versiones** (local y publicada), no solo la local: así, si algún día la comparación da un resultado raro, se puede confirmar desde la propia pantalla qué fue lo que se leyó.
2. Si hay versión nueva, muestra las notas (si trae) y **pregunta antes de tocar nada** (`¿Instalar esta version ahora? [S/n]`; se puede saltar con `/sinconfirmar`).
3. Copia el `.zip` que indica `version.json.zip` desde la carpeta de releases a `%TEMP%` (no se extrae directo desde la red). `zip` tiene que ser **solo un nombre de archivo** (`me-operacion-X.Y.Z.zip`): una ruta, una unidad o `..` se rechazan sin aplicar nada. También acepta `/origen:"<carpeta>"`.
4. **Verifica su SHA-256** contra el que trae `version.json` — desde la v3.0.0 es **obligatorio**: sin `sha256`, o si no coincide, **se detiene sin aplicar nada**. Cubre un `.zip` copiado a medias o reemplazado sin volver a empaquetar; no protege de alguien que publique a propósito un `.zip` y un `version.json` nuevos (ver §9). Al terminar, registra como versión local la versión publicada, incluso si el ZIP reutilizado traía un `scripts\VERSION` anterior.
5. Lo descomprime **ahí mismo** (no sobre la carpeta en uso) con `Expand-Archive`, y solo si eso termina bien copia el contenido encima de la carpeta real con `robocopy … /E` (sobrescribe, pero **no borra** archivos locales que ya no vengan en el `.zip` — más seguro que `/MIR` frente a un error de rutas).
6. **Limpia restos de una versión anterior a v2.4** — antes del reordenamiento a `scripts\`, `lanzador.ps1`/`actualizar.ps1`/`VERSION` vivían sueltos en la raíz; como el paso anterior no borra nada que no venga en el `.zip` nuevo, esos archivos quedarían huérfanos en la raíz (sin romper nada: el `dame click.bat` nuevo ya apunta a `scripts\lanzador.ps1`). Tanto `actualizar.ps1` como `lanzador.ps1` detectan y borran esos restos solos, así que actualizar desde una versión anterior a v2.4 termina con la raíz limpia igual, aunque no sea en el mismo instante.
7. Avisa que ya quedó instalado y que corras `dame click.bat` cuando quieras abrir las herramientas. **No se relanza nada solo.**

Si cualquier parte de esto falla (sin VPN, carpeta inaccesible, `.zip` corrupto, hash que no coincide, `robocopy` falla), se avisa en rojo/amarillo y **no se cambia nada** — nunca deja la carpeta a medias.

**Armar una versión nueva para publicar** (no usa git, GitHub ni Python — solo PowerShell). Se corre con `scripts\empaquetar-release.bat`, no llamando al `.ps1` directo: así tampoco choca con la `ExecutionPolicy` del equipo (mismo motivo por el que `dame click.bat` no es un `.ps1` suelto). Se corre desde la raíz del proyecto:

```bat
scripts\empaquetar-release.bat
scripts\empaquetar-release.bat -Version 3.0.0 -Notas "que trae"
scripts\empaquetar-release.bat -Incremento Fix -Notas "que trae"

REM Firmando lanzador.ps1 y actualizar.ps1 con Authenticode (opcional):
scripts\empaquetar-release.bat -CertThumbprint 0123456789ABCDEF0123456789ABCDEF01234567
scripts\empaquetar-release.bat -CertPfx C:\ruta\certificado.pfx
```

Sin `-Version` ni `-Incremento`, lee `scripts\VERSION` y ofrece **Fix/documentación** (`Z+1`, recomendado), **Minor** (`Y+1`, reinicia Z), **Major** (`X+1`, reinicia Y/Z) o una versión `X.Y.Z` personalizada. Para automatización se usa `-Version 3.0.0` o `-Incremento Fix|Minor|Major`. Genera `release\me-operacion-<version>.zip` y `release\version.json` (con el `sha256` del `.zip` incluido) y, desde la v3.0.0, **los publica él mismo en la carpeta de releases**:

1. Antes de tocar nada comprueba la carpeta. Si esa versión **ya está publicada**, se detiene (no se reutiliza un número; `-Forzar` para reemplazarla a propósito). Si la carpeta no es accesible (sin VPN), **no se detiene**: genera en `release\` y al final dice qué copiar y en qué orden.
2. Copia el `.zip`, **vuelve a calcular el SHA-256 de la copia** y, solo si coincide, escribe `version.json` **al final**. Así nadie que abra `dame click.bat` en medio de la publicación ve una versión cuyo `.zip` no está completo.
3. Deja `scripts\VERSION` en el número nuevo.

Otras opciones: `-SinPublicar` (solo `release\`), `-Destino "<carpeta>"` (publicar en otra carpeta, para pruebas), `-TimeoutRed N` (segundos de espera para la carpeta, 8 por defecto) y `-Puente` (ver abajo).

**Sin acceso a la carpeta de red** (sin VPN, NAS caído) el script **no se detiene**: avisa, genera la versión igual en `release\` y al final dice qué dos archivos copiar y en qué orden cuando vuelva el acceso. La comprobación corre en un runspace aparte con tope de tiempo, igual que la del lanzador: `Test-Path` sobre una UNC inalcanzable puede tardar un minuto en contestar y puede lanzar un error que, con `$ErrorActionPreference='Stop'`, mataría el script entero — que es justo lo que no se quiere, porque el paquete se genera local perfectamente sin ver la carpeta. Si la carpeta **sí** contesta pero la comprobación de «esta versión ya está publicada» falla, ahí sí se detiene: no se publica a ciegas sobre una release existente. Para saltarse la comprobación desde el principio, `-SinPublicar`.

**Puente 2.x → 3.0.0.** Las copias 2.x solo consultan `https://sebasmd.com/me/operacion/`. La 3.0.0 se empaqueta con `-Puente`, que además de publicarla en la carpeta recuerda subir **esos mismos dos archivos** a `sebasmd.com` una última vez. Cada analista corre `actualizar.bat` (el suyo, 2.x): baja la 3.0.0 del dominio y desde ahí su lanzador y su actualizador ya leen la carpeta de red. Después no se vuelve a publicar en el dominio.

**Firma (Authenticode).** Los `.bat` (`dame click.bat`, `actualizar.bat`) **no se pueden firmar de ninguna forma** — Windows no tiene un formato de firma para archivos batch. Por eso la lógica pesada vive en `scripts\lanzador.ps1` y `scripts\actualizar.ps1`: son los que de verdad hacen llamadas de red y tocan archivos, y son los que sí se pueden firmar. Sin `-CertThumbprint` ni `-CertPfx`, este paso se omite — igual que la consulta de versión, nunca bloquea el empaquetado por no tener un certificado configurado. Un certificado de firma de código (OV, ~USD 70-200/año) ayuda tanto al escaneo estático como a la reputación de SmartScreen; uno EV (más caro) da reputación inmediata en vez de tener que "ganarla" con volumen de descargas.

**Probar el mecanismo sin preparar una release real**: empaquetar con `-Destino` apuntando a una carpeta local de pruebas y abrir `dame click.bat /origen:"<esa carpeta>"` / `actualizar.bat /origen:"<esa carpeta>"` desde **otra copia** del proyecto con un `scripts\VERSION` menor. O, en la carpeta real, un `version.json` con un número mayor apuntando al **mismo** `.zip` que ya esté ahí (el hash sigue siendo el de ese archivo). `dame click.bat` lo detecta y avisa; al correr `actualizar.bat`, la versión local queda en el número publicado aunque el ZIP reutilizado contenga un `scripts\VERSION` anterior.

Qué entra en el paquete (lista fija, no "todo lo que haya en la carpeta"): `index.html`, `assets\`, `herramientas\`, `doc\`, `dame click.bat`, `actualizar.bat`, `scripts\lanzador.ps1`, `scripts\actualizar.ps1` y `scripts\VERSION`. **`scripts\empaquetar-release.ps1`/`.bat` NUNCA se incluyen** — es una herramienta de quien mantiene el proyecto, no algo que necesite un analista. Por dentro, `empaquetar-release.ps1` arma esta estructura copiando cada pieza a una carpeta temporal antes de comprimir (`Compress-Archive`, al recibir la ruta de un archivo suelto, lo deja en la raíz del `.zip`; no hay forma de pedirle que quede dentro de una subcarpeta `scripts\` sin antes tenerlo de verdad ahí). Las credenciales guardadas (`%APPDATA%\reporte_prepagadas\`) nunca viajan: viven fuera de esta carpeta.

### Parámetros

| Comando | Qué hace |
|---|---|
| `dame click.bat` | Flujo normal: **una sola pestaña** con el reporte de líneas prepagadas, en una ventana **maximizada**. |
| `dame click.bat /solo-reporte` | Lo mismo que sin parámetros (explícito). |
| `dame click.bat /solo-casos` | Solo el cierre masivo de casos. |
| `dame click.bat /sinsesion` | Pide usuario y clave de Windows para SIME en vez de usar la sesión activa. |
| `dame click.bat /reset` · doble clic en `scripts\reiniciar-credenciales.bat` | Borra todas las credenciales guardadas (p. ej. si se escribió mal el usuario), las vuelve a pedir y abre las herramientas. |
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
MEUI.init({ app, sesiones, sesionesOpcionales, instrucciones })   // titulo, descripcion, version y doc salen del catálogo
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
MEUI.montarPasos() / aplicarAperturaPasos() / montarTogglePasos()
MEUI.copiarTexto(texto) / MEUI.abrirDoc(ruta) / MEUI.normalizar(txt) / separador()

// --- me-api.js ---
MEAPI.CONFIG / MEAPI.configurar({ locale: "en" })
MEAPI.auth.ensure() / reauth(version) / leerCampos() / salir()
MEAPI.getJson(ruta, params)
MEAPI.api(ruta, { method, body, headers, params })
MEAPI.cabeceras(extra)
```

Eventos que emite el shell y atiende cada puente: `me:sesion-iniciar`, `me:sesion-renovar` (a 15 s del vencimiento) y `me:sesion-cerrar`, todos con `detail.clave`, y `me:sesion-cambio` (`detail.clave`, `estado`, `usuario`), que sale **solo cuando algo cambió** y sirve para habilitar o bloquear acciones según quién opera.

Otros comportamientos del shell que conviene conocer:

- **Esc con modales anidados** cierra primero el de encima (p. ej. un formulario) y después el de información que quedó debajo.
- **Columna de línea** en CSV/Excel: `detectarColumna` acepta los alias en cualquier mayúscula y, si ninguno aparece como parte del nombre, prueba los exactos `min`, `nro`, `num`, `no`, `tel`, `cel`.
- **`autoSpinner`** se libera cuando el código de la herramienta pone `btn.disabled = false`: si una acción no reactiva el botón (p. ej. falta el `finally`), el spinner queda atascado.

Módulos compartidos fuera de la base, por página:

| Objeto | Archivo | Lo usan |
|---|---|---|
| `window.ME_CATALOGO` | `base/catalogo.js` | Menú, Inicio y `MEUI.init` (§2). |
| `window.ME_DEPENDENCIAS` | `base/dependencias.js` | `me-ui.js` (URL de `marked`). |
| `window.MEPAQ` | `assets/herramientas/consumos/paquetes.js` | Consumos (carga de paquetes). |
| `window.CMLineas` | `compartido/cm-lineas.js` | Bloquear/Inactivar líneas y Cambio IMSI y línea Claro\|Tigo (resolver línea, cuenta exacta, SIM, órdenes y tabla con casillas). |

---

## 9. Riesgos

- **Transporte**: los endpoints del CM y de Keycloak son **HTTP plano**. Usuario y clave viajan en el direct grant y el token queda en memoria del navegador.
- **Credenciales compartidas**: para que la sesión se sienta única entre archivos, quedan en `localStorage` ofuscadas (no cifradas) mientras dure la jornada. Es el mismo nivel de exposición que el `#cm_pass` de la URL. «Olvidar credenciales» las borra al instante.
- **`--disable-web-security`**: la ventana de Edge que abre el lanzador no tiene aislamiento de origen. No debe usarse para navegar a nada más. Esta bandera (junto con `--inPrivate` y el perfil temporal desechable) es una combinación que varios antivirus/EDR vigilan de cerca, porque es la misma firma que usan herramientas para saltarse el aislamiento de origen del navegador. Se probó un servidor local (`http://localhost` + proxy al CM/Keycloak) como camino para quitar esta bandera, pero la prueba real quedó **bloqueada por el antivirus/EDR** del equipo — el mismo tipo de detección que se buscaba evitar — así que se descartó. Sigue siendo un riesgo abierto, sin una alternativa que no requiera dominio interno, admin, SharePoint o GitHub (ver también §10, v2.4).
- **Dependencia de CDNs externos**: si un CDN está bloqueado o caído, las herramientas no cargan. Mezclan red interna con CDN público.
- **Almacenamiento bloqueado**: con la prevención de seguimiento de Edge activa, la sesión no se comparte entre pestañas (funciona igual, pero hay que iniciar sesión en cada una).
- **Dependencia de la sesión de Windows**: obtener el `prf` automáticamente requiere sesión NTLM válida y, normalmente, abrir desde el `.bat`.
- **Un cambio en la base afecta a todas**: es la contraparte de no duplicar código. Conviene probar todas las páginas del menú después de tocar `me-ui` o `me-api`.
- **Carpeta de releases abierta**: la carpeta de red (v3.0.0) es infraestructura de la compañía, pero **cualquiera con VPN puede leer y escribir** en ella: no hay control de permisos. Quien escriba ahí puede publicar un `.zip` y un `version.json` con su propio hash y los analistas lo instalarían al correr `actualizar.bat`. El SHA-256 solo protege de copias incompletas o de un `.zip` reemplazado sin tocar `version.json`. Mitigaciones posibles: pedir a TI que la carpeta sea de solo lectura salvo para quien publica, o firmar `lanzador.ps1`/`actualizar.ps1` (Authenticode) — aunque la firma no cubre el HTML/JS. Antes (hasta 2.x) el riesgo equivalente era el dominio personal `sebasmd.com`.

---

### Componentes y criterios comunes

- **Copiar:** `MEUI.copiable(valor, nombre)` devuelve `.me-copiable` con el botón compacto a la izquierda y el dato en la misma línea. Se usa para línea/MSISDN, línea nueva, IMSI, ICCID, cuenta/BAN, SubscriptionID, documento y caso/ticket. En cabeceras estáticas, envolver botón y dato con esa clase, en ese orden, conservando `data-copy-target` y el id del dato. Los payloads conservan su botón para copiar el contenido completo. `MEUI.esIdentificacion(nombre)` centraliza el criterio para etiquetas variables de los detalles del CM y HLR.
- **Acciones primero:** las tablas principales colocan «Acciones» antes de los datos; cuando hay selección, el orden es casilla, Acciones y datos. Cabecera, menú y exportación se derivan de las definiciones de columnas; los índices se resuelven desde ellas, no mediante desplazamientos manuales. Las tablas de cálculo o informes sin acciones conservan sus columnas de datos.
- **Archivo:** `MEUI.zonaArchivo(contenedor, { accept, texto, alElegir(archivo, archivos) })` prepara el input existente dentro de `[data-me-dropzone]`. Incluye clic, Enter/Espacio, arrastrar/soltar, estado de arrastre y nombre(s) seleccionado(s); respeta `multiple` y `accept`. Sin callback, mantiene los listeners `change` del input. `MEUI.init` prepara todos los inputs de archivo, y las pestañas dinámicas llaman al componente al montar. Devuelve `{ el, limpiar() }`; volver a llamarlo actualiza las opciones sin duplicar eventos. El componente no lee ni transforma el archivo: eso corresponde a cada herramienta.
- **Cabecera:** una línea de 44 px con título en negrita, separador `|`, descripción gris truncada, buscador global centrado y sesiones a la derecha. Se conservan la búsqueda del catálogo, los atajos `/` y Ctrl/Cmd+K, navegación por flechas, Enter y Escape y el filtro de tarjetas de Inicio. En móvil, la lupa despliega el campo.
- **Layout de escritorio:** desde 1200 px el área de trabajo ocupa el alto disponible, incluidos sus ancestros y pestañas; el cuerpo de la tabla y los pasos tienen su propio scroll. «Contraer» permanece fuera del scroll de los pasos. Un estado vacío se retira al dibujarse filas reales. El estado recordado del lateral y de los pasos se aplica antes del primer pintado, y las transiciones del lateral se habilitan tras ese pintado.

## 10. Historial de cambios

| Versión | Cambios |
|---|---|
| **4.0.0** | **Ronda 4 · Base común:** copiar a la izquierda con `MEUI.copiable`, Acciones primero e índices derivados, corrección del alto en pestañas y del estado vacío con filas, cabecera de 44 px con buscador global, lateral y pasos sin parpadeo inicial y componente único `MEUI.zonaArchivo` para todos los inputs de archivo. |
| **4.0.0** | **Corrección de barras y scroll:** convención `.me-barras` para filtros, selección y lote, sin sticky superpuestos; layout flex de escritorio con scroll exclusivo en el cuerpo de DataTables, incluidas pestañas; pasos y botón siempre accesibles y reajuste automático con observadores y debounce al aparecer barras, estados o avisos. |
| **4.0.0** | **Una sola fuente de verdad y carpetas de la base.** `assets/base/catalogo.js` es el catálogo único de herramientas (id, nombre, grupo, icono, descripción, HTML, doc, versión, estado y archivos): de él salen el menú lateral, las tarjetas y el Backlog de Inicio y el título, la descripción, la versión y el README de cada página; `APPS` y `PROYECTOS` desaparecen y `MEUI.init` conserva solo lo propio de la página. `assets/base/dependencias.js` registra las librerías de CDN (versión y URLs) y cada HTML declara lo que usa con `data-me-deps`; cambiar una versión ya no obliga a tocar 18 archivos. La base queda en `assets/base/` (`me-ui.js`, `me-ui.css`, `me-api.js`, `catalogo.js`, `dependencias.js`) y lo compartido en `assets/compartido/` (`cm-lineas.js`, `hlr-consulta.js`, `tulio-plu.js`, `genesis-api.js`, `genesis-bookmarklet.js`). Inicio muestra «Exportar casos · Tipificación» de última. `empaquetar-release.ps1` mantiene `ME_CATALOGO.version` igual a `scripts\VERSION`. Resume además el trabajo de UX de esta tanda: tarjetas KPI compactas, filtros y lote fijos arriba de la tabla, barra de progreso en el pie, confirmación antes de escribir en producción, ayudas «?» en los controles, modal de detalle de 90vw × 90vh, accesibilidad, Inicio en cuadrícula de tarjetas y la unión de Cambio IMSI y Cambio de línea en una sola herramienta con pestañas. **Consolidación:** una carpeta por herramienta en `assets/herramientas/<id>/`, lógica y puente unidos y CSS fuera del HTML (incluida Inicio); componentes compartidos en `assets/base/me-ui.css`; eliminación de Validador QDN, QDN Tigo y Validador HLR cruzado y de su código, reemplazadas por HLR/HSS, cuya documentación integra el detalle técnico e historial de los tres motores. |
| 3.3.0 | El menú de herramientas **recuerda su posición de scroll** entre archivos: al abrir otra herramienta queda donde estaba (si no hay posición guardada, se centra en la herramienta abierta). El botón «Contraer» de la columna de pasos queda **fijo arriba, fuera del scroll**: los pasos van en su propio contenedor con scroll (`.me-trabajo-pasos`), así el botón no se desplaza ni tapa ningún paso. |
| 3.2.0 | Base compartida: al llegar resultados (una tabla pasa de vacía a tener filas) se **contraen el menú y la columna de pasos** para dejarle el ancho a los datos; no se guarda y no se repite con cada filtro (`MEUI.enfocarDatos`). `MEUI.copiable(valor, nombre)`: valor con botón de copiar. `MEAPI.imsi(cardPackageID)`: IMSI de la línea desde la SIM del CM, con caché. El botón de copiar ya no dispara el clic de la fila (no abre el detalle). |
| 3.1.0 | **Aviso de versión nueva en la página**: cuando `dame click.bat` encuentra una versión publicada mayor, la pasa en la URL (`nv`, `va`) y `MEUI` muestra un modal «Nueva versión X» con «Actual Y → Nueva X», una sola vez, al abrir. Al navegar entre herramientas no se repite. Solo acepta números de versión (`X.Y.Z`). |
| 3.0.0 | **Releases desde la carpeta de red de la compañía** (`\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release`), única fuente en lugar de `https://sebasmd.com/me/operacion/`. `empaquetar-release` publica ahí solo (`.zip` primero, hash de la copia verificado, `version.json` al final; no reutiliza una versión ya publicada salvo `-Forzar`; sin acceso deja todo en `release\`), con `-SinPublicar`, `-Destino` y `-Puente` (recuerda subir la 3.0.0 también a sebasmd.com para las copias 2.x). `dame click.bat` lee `version.json` de la carpeta con tope de 6 s (runspace aparte, para no quedar colgado 20-60 s sin VPN). `actualizar.bat` copia el `.zip` a `%TEMP%`, rechaza nombres de `.zip` que no sean un archivo suelto y exige `sha256`. Ambos aceptan `/origen:"<carpeta>"`. Fix: el mensaje de hash que no coincide mostraba `Esperado: {0}` sin el valor. |
| 2.4.1 | Documentación: el texto deja de hablar de «cuatro herramientas»; se agregan Tulio, QDN Claro y HLR Tigo a los servicios; la API de `me-ui.js` incluye `montarTogglePasos`, `copiarTexto`, `abrirDoc`, el evento `me:sesion-cambio`, Esc con modales anidados, los alias de la columna de línea y los módulos `MEPAQ`/`CMLineas`; y el riesgo de la auto-actualización se corrige: sí hay verificación SHA-256, aunque no protege de una publicación maliciosa. |
| 2.4 | Reordenamiento de archivos: en la raíz del proyecto solo quedan `index.html`, `dame click.bat` y `actualizar.bat`; **todo `.ps1` se mueve a `scripts\`** (`lanzador.ps1`, `actualizar.ps1` y también `empaquetar-release.ps1`/`.bat`, que nunca se distribuye), y `VERSION` se mueve a `scripts\VERSION`. `dame click.bat`/`actualizar.bat` pasan a invocar `scripts\lanzador.ps1` / `scripts\actualizar.ps1`. `lanzador.ps1` y `actualizar.ps1` limpian solos, la primera vez que los ven, los restos de `lanzador.ps1`/`actualizar.ps1`/`VERSION` sueltos en la raíz que deja una actualización desde una versión anterior a esta (robocopy sin `/MIR` no los borra solo). `actualizar.ps1` ahora muestra la versión publicada además de la local al decir "ya estás al día". Se corrige además un bug real: `version.json` se generaba con BOM (`Set-Content -Encoding UTF8` en Windows PowerShell 5.1 siempre lo agrega), lo que hacía que `Invoke-RestMethod` devolviera un objeto vacío sin avisar de ningún error — la versión publicada se leía como "0.0". Se corrigió en el origen, en `empaquetar-release.ps1`, que escribe UTF-8 sin BOM. El lanzador y el actualizador también leen los bytes explícitamente como UTF-8 y normalizan Unicode para tolerar encabezados HTTP incompletos o alterados por un proxy. `GETTINGSTARTED.md` y el `README.md` general se mueven a `doc\`. Guía de instalación y mapa del proyecto: `doc/GETTINGSTARTED.md` y `doc/README.md`. Se retira el servidor local experimental (`server\`, `doc/servidor-local` y el modo dual de `assets/base/me-api.js`): la prueba real en un equipo de analista quedó bloqueada por el antivirus/EDR, el mismo problema que se buscaba evitar. Queda como riesgo abierto sin solución (ver §9). |
| 2.3 | `dame click.bat` pasa a ser un lanzador delgado: la lógica real se movió a `lanzador.ps1` (invocado como archivo, no como bloque embebido con `Invoke-Expression` — patrón que varios antivirus bloqueaban justo al encontrar versión nueva). Instalar una actualización se separó en `actualizar.bat`/`actualizar.ps1`, aparte y siempre a mano (antes se aplicaba sola y se relanzaba en silencio, otro patrón vigilado por antivirus); `actualizar.ps1` además verifica el SHA-256 del `.zip` contra `version.json` antes de aplicar. `empaquetar-release.ps1` gana firma Authenticode opcional (`-CertThumbprint` / `-CertPfx`) para `lanzador.ps1`/`actualizar.ps1` (los `.bat` no se pueden firmar) y genera el `sha256` en `version.json`. Se agrega `server/` (experimental, no conectado al lanzador): sirve las herramientas por `http://localhost` con proxy hacia el CM/Keycloak, como camino para eventualmente quitar `--disable-web-security` — ver `doc/servidor-local/README.md`. |
| 2.2 | Auto-actualización: `dame click.bat` revisa `https://sebasmd.com/me/operacion/version.json` antes de todo lo demás y, si hay una versión nueva, la descarga, la aplica y se relanza solo (flag `/sinupdate` para omitirlo). Versión tipo `1.0`/`1.1` (comparada como `[version]`, no como número entero). Se agregan `empaquetar-release.ps1` + `empaquetar-release.bat` (este último para no chocar con la `ExecutionPolicy` del equipo) para armar el `.zip` + `version.json` que hay que subir, y el archivo `VERSION` en la raíz del proyecto. |
| 2.1 | El lanzador abre **una sola pestaña** (el reporte de líneas prepagadas) y la ventana de Edge sale **maximizada**. El cierre masivo de casos deja de abrirse por defecto: se pide con `/solo-casos`. |
| 2.0 | Se extraen `me-ui.css`, `me-ui.js` y `me-api.js` como base común de las cuatro herramientas: shell, sesión compartida, registro, tablas, importación y exportación, más los endpoints y el `auth` que antes estaban copiados en cada archivo. Los `.html` quedan solo con marcado. El lanzador pasa la marca de apertura (`abierto=`) para el pie. |
| 1.0 | `dame click.bat`: credenciales en archivo local cifrado con DPAPI, login NTLM a SIME, validación del CM contra Keycloak y apertura de Edge con la sesión lista. |
