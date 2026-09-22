# Primeros pasos

Dos caminos según lo que necesites: **usar** la suite (analista) o
**tocar el código** (desarrollador). El mapa general del proyecto está en
[README.md](README.md).

---

## Para analistas: usar la suite

### Requisitos

- Windows con **Microsoft Edge** instalado (rutas estándar de programa).
- **PowerShell** en el `PATH` (viene con Windows; no hace falta instalar nada).
- Red interna / VPN con acceso a SIME y al CM (`obp-apigw...internal`, `keycloak...internal`).
- Usuario y clave del CM (Keycloak); opcionalmente, credenciales de dominio para SIME si no vas a usar tu sesión de Windows.
- **No se necesita ser administrador** para nada de lo siguiente.

### Primera vez

1. Copia toda la carpeta `me-operacion` a tu equipo (no hace falta instalador).
2. Doble clic en **`dame click.bat`** (en la raíz de la carpeta).
3. La primera vez te va a pedir, **por consola** (nunca por una ventana emergente):
   - Usuario y clave del **CM** (Keycloak).
   - Usuario y clave de **SIME**, solo si no se puede usar tu sesión de Windows automáticamente.
4. Las credenciales quedan guardadas **cifradas en tu equipo** (`%APPDATA%\reporte_prepagadas\`, con DPAPI de tu usuario de Windows — no sirven en otro equipo ni con otro usuario). Las siguientes veces no te las vuelve a pedir.
5. Se abre una ventana de Edge, maximizada, con el reporte de líneas prepagadas ya con la sesión lista. Desde el menú lateral navegas a cualquier otra herramienta.

> Esa ventana de Edge es **solo para estas herramientas** — no la uses para navegar a otras páginas (ver por qué en [lanzador § Riesgos](lanzador/README.md#9-riesgos)).

En la raíz de la carpeta solo hay tres archivos «externos»:
`index.html`, `dame click.bat` y `actualizar.bat`. Todo lo demás —la
lógica en PowerShell, la documentación, los archivos de cada
herramienta— vive ordenado en `scripts\`, `doc\`, `assets\` y
`herramientas\`; no hace falta abrir esas carpetas para el uso normal.

### Qué hace `dame click.bat` en cada apertura

1. **Avisa** si hay una versión nueva publicada (nunca la instala solo — ver «Actualizar» abajo).
2. Verifica que los archivos de la herramienta estén completos.
3. Lee tus credenciales guardadas (o las pide si es la primera vez).
4. Consigue el token de SIME.
5. Valida tu usuario y clave del CM contra Keycloak.
6. Abre Edge con la sesión lista.

Si algo falla a mitad de camino (SIME no responde, Keycloak rechaza la clave), el lanzador **no se cae**: explica qué pasó y ofrece reintentar o continuar sin esa parte.

### Parámetros útiles

| Comando | Qué hace |
| --- | --- |
| `dame click.bat` | Flujo normal: reporte de líneas prepagadas, en una ventana maximizada. |
| `dame click.bat /solo-casos` | Solo el cierre masivo de casos. |
| `dame click.bat /sinsesion` | Pide usuario y clave de dominio para SIME en vez de tu sesión de Windows. |
| `dame click.bat /reset` | Borra **todas** las credenciales guardadas (para empezar de cero). |
| `dame click.bat /resetcm` · `/resetsime` | Borra solo las credenciales del CM o solo las de SIME. |
| `dame click.bat /debug` | Muestra el detalle técnico si algo falla. |

Para escribir un parámetro: clic derecho sobre `dame click.bat` → *Crear acceso directo*, y en el acceso directo agregas el parámetro al final del campo «Destino» (después de las comillas). O ábrelo desde una consola: `"dame click.bat" /solo-casos`.

### Actualizar

Cuando `dame click.bat` avisa que hay una versión nueva, **no se instala sola** — hazlo tú, cuando quieras, con:

```
actualizar.bat
```

Te muestra la versión nueva y sus novedades, pregunta si quieres instalarla, y si dices que sí descarga, verifica y aplica el cambio. Al terminar, corre `dame click.bat` normalmente para abrir las herramientas ya actualizadas. Por qué es un paso aparte y no automático: [lanzador § Aviso de versión nueva](lanzador/README.md#aviso-de-versión-nueva-e-instalarla-aparte-actualizarbat).

### Problemas comunes

| Síntoma | Qué revisar |
| --- | --- |
| «No se encontró msedge.exe» | Microsoft Edge no está instalado en las rutas estándar del equipo. |
| SIME rechaza el login varias veces | El lanzador ofrece reintentar, cambiar de credenciales, o saltar el reporte y abrir solo el cierre de casos (que no necesita SIME). |
| Keycloak rechaza la clave del CM | El lanzador borra esa credencial guardada automáticamente; corre `dame click.bat` de nuevo para volver a escribirla. |
| El antivirus bloquea o marca el `.bat` | Ver [lanzador § Riesgos](lanzador/README.md#9-riesgos) — es un problema conocido y documentado, con el porqué explicado ahí. |
| Una herramienta puntual falla | Cada `<herramienta>/README.md` tiene su propia sección de reglas y casos borde; el botón de ayuda dentro de la herramienta abre ese mismo documento. |
| Nada de lo anterior explica el problema | Revisa el **Registro** dentro de la herramienta (captura cualquier error de JavaScript, con hora) antes de abrir la consola del navegador. |

---

## Para desarrolladores: tocar el código

### Cómo está armada cada herramienta

```txt
herramientas/<algo>.html        marcado, SIN lógica
assets/logica-<algo>.js         reglas de negocio: consultas, validaciones, formato
assets/me-<algo>-puente.js      enganche entre esa lógica y el shell común
```

Más lo que comparten las diez:

```txt
assets/me-ui.css / me-ui.js     diseño, shell, sesión compartida, registro, tablas
assets/me-api.js                endpoints del CM/Keycloak, auth, getJson()/api()
```

Detalle completo de esta arquitectura, el orden de carga y por qué está separada así: [lanzador/README.md § 2](lanzador/README.md#2-arquitectura-y-archivos).

### Agregar una herramienta nueva

Se registra en **dos sitios** (si falta uno, queda a medias):

| Dónde | Qué agregar |
| --- | --- |
| `assets/me-ui.js` → `APPS` | Entrada del **menú lateral**, igual en las diez páginas. |
| `assets/logica-inicio.js` → `PROYECTOS` | Tarjeta en la **portada** (`index.html`), con sus entregables y su doc. |

El `id` debe coincidir en los dos sitios y con el `app` que la página pasa a `MEUI.init()`. `dame click.bat` no hace falta tocarlo. Detalle: [lanzador/README.md § "Dar de alta una herramienta nueva"](lanzador/README.md#dar-de-alta-una-herramienta-nueva).

### Probar cambios localmente

Editar los archivos y abrir la herramienta con `dame click.bat` — corre por `file://`, con `--disable-web-security` para saltarse CORS contra el CM/Keycloak. Se probó un servidor local (`http://localhost` + proxy al CM/Keycloak) para eventualmente quitar esa bandera, pero quedó bloqueado en la prueba real (antivirus/EDR) y se descartó — ver [lanzador § Riesgos](lanzador/README.md#9-riesgos).

### Empaquetar una release

Desde la raíz del proyecto:

```
scripts\empaquetar-release.bat
scripts\empaquetar-release.bat -Version 3.0.0 -Notas "que trae"
scripts\empaquetar-release.bat -Incremento Fix -Notas "que trae"

REM Firmando lanzador.ps1 / actualizar.ps1 con Authenticode (opcional):
scripts\empaquetar-release.bat -CertThumbprint <thumbprint>
scripts\empaquetar-release.bat -CertPfx C:\ruta\certificado.pfx
```

Sin `-Version` ni `-Incremento`, muestra la versión guardada en
`scripts\VERSION` y ofrece: **Fix/documentación** (`Z+1`, recomendado),
**Minor** (`Y+1` y `Z=0`), **Major** (`X+1`, `Y=0`, `Z=0`) o una versión
`X.Y.Z` personalizada. `-Version 3.0.0` fija un valor y
`-Incremento Fix|Minor|Major` selecciona el tipo sin interacción.

Genera `release\me-operacion-<version>.zip` y `release\version.json`
(con el SHA-256 del `.zip` incluido, que `actualizar.ps1` verifica antes
de instalar en cada equipo). Hay que subir esos dos archivos a
`https://sebasmd.com/me/operacion/`. Detalle completo del mecanismo de
publicación, firma y verificación de integridad:
[lanzador/README.md](lanzador/README.md).

### Convenciones del proyecto

- **Sin dependencias que instalar**: no usa git, GitHub, Node, Python ni build step — HTML/JS servido tal cual, y PowerShell nativo para el lanzador y el empaquetado.
- **Marcado sin lógica**: cada `.html` en `herramientas/` es solo estructura; toda regla de negocio vive en `assets/logica-<algo>.js`.
- **La herramienta no inventa datos**: un campo que el CM no devuelve queda vacío (o en `N/A` al imprimir), nunca se rellena con un supuesto.
- **Versionado `Major.Minor.Patch`**: Major = cambio mayor, Minor = funcionalidad compatible y Patch = corrección/documentación — ver [README.md § Versionado](README.md#versionado).
- **Todo interactivo por consola**: el lanzador y el actualizador nunca abren cuadros de diálogo de Windows (pueden quedar ocultos o bloqueados por política del equipo).
- **En la raíz del proyecto, solo tres archivos «externos»**: `index.html`, `dame click.bat` y `actualizar.bat`. Todo script PowerShell nuevo va en `scripts\`; toda documentación nueva va en `doc\`.

### Dónde profundizar

| Tema | Documento |
| --- | --- |
| Arquitectura de la base común, lanzador, auto-actualización, riesgos | [lanzador/README.md](lanzador/README.md) |
| Reglas de negocio de cada herramienta | `<herramienta>/README.md` — tabla completa en [README.md](README.md#qué-hay-aquí) |
