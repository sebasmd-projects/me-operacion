# me-operacion

Suite de herramientas internas para operación de líneas móviles: SIME,
CM/BSS (Optiva), CRM, QDN (Claro) y HLR de Tigo. Reemplaza macros de Excel
y procesos manuales por páginas HTML autocontenidas que corren en el
navegador, sin instalar nada ni depender de dominio interno, SharePoint,
GitHub ni permisos de administrador.

> **¿Primera vez con esta carpeta?** Ve directo a
> **[GETTINGSTARTED.md](GETTINGSTARTED.md)**. Este `README.md` es el mapa
> del proyecto; el otro archivo es la guía paso a paso para usarlo o para
> tocar el código.

---

## Qué hay aquí

| Herramienta | Qué hace | Documentación |
| --- | --- | --- |
| **Prepagadas · SIME ⇄ CM** | Verificación cruzada de líneas prepagadas y alta de suscripciones en SIME. | [reporte-prepagadas](reporte-prepagadas/README.md) |
| **Cierre masivo de casos** | Búsqueda del ticket de cada caso y cierre por lotes en el CM, con simulación previa. | [cerrar-casos](cerrar-casos/README.md) |
| **Exportar casos · Tipificación** | Descarga masiva de casos del CRM por rango de fechas y estados. | [reporte-tipificacion](reporte-tipificacion/README.md) |
| **Ajustes y paquetes** | Consulta y exportación de ajustes de dinero y de paquetes, con catálogos editables. | [reporte-ajustes](reporte-ajustes/README.md) · [análisis: recarga de paquetes](reporte-ajustes/recarga-de-paquetes-cm.md) |
| **HLR/HSS · Claro y Tigo** | Tres pestañas en una: Tigo (solo lectura), Claro (lectura + opera la línea: bloqueo/desbloqueo/conciliación) y Ambos (cruce Claro ⇄ Tigo). | [hlr-hss](hlr-hss/README.md) |
| **Validador Portabilidad · Tigo** | Igual motor que la pestaña Tigo de arriba, con el marco de negocio de portabilidad (Creada / Sin perfil / Residuo) y estado ME (CM) opcional. | [portabilidad-tigo](portabilidad-tigo/README.md) |
| **Generar archivo de rechazo** | Arma el PDF de un rechazo de portabilidad (FC / LS / LD); reemplaza las tres macros de Excel. | [generar-rechazo](generar-rechazo/README.md) |
| **Consumos y Paquetes · CM** | Datos de línea, paquetes, movimientos e histórico de consumo, con gráficas y exportación. | [reporte-consumos](reporte-consumos/README.md) |
| **Convertir audio a MP3** | Convierte localmente uno o varios audios OGG, M4A u otros formatos compatibles y genera archivos `mp3-*.mp3`. | [audio-mp3](audio-mp3/README.md) |

Todas comparten una **base común** (marco visual, sesión, acceso al CM) y
un **lanzador** que deja la sesión lista antes de abrir la primera
página — eso está documentado aparte porque no es de ninguna herramienta
en particular:

| Pieza | Qué es | Documentación |
| --- | --- | --- |
| `dame click.bat` / `scripts\lanzador.ps1` | Abre las herramientas con la sesión de SIME y las credenciales del CM ya listas. | [lanzador](lanzador/README.md) |
| `actualizar.bat` / `scripts\actualizar.ps1` | Instala una versión nueva cuando el lanzador avisa que hay una (paso aparte, siempre a mano). | [lanzador § Aviso de versión nueva](lanzador/README.md#aviso-de-versión-nueva-e-instalarla-aparte-actualizarbat) |
| `assets/me-ui.*`, `assets/me-api.js` | Diseño, shell, sesión, tablas, exportación y llamadas al CM que usan las diez herramientas. | [lanzador](lanzador/README.md) |

---

## Estructura del proyecto

Solo tres archivos quedan «externos», a la vista, en la raíz del
proyecto — el resto vive ordenado en subcarpetas:

```txt
me-operacion/
├─ index.html                  portada: catálogo de herramientas y descargas
├─ dame click.bat               lanzador delgado (solo invoca scripts\lanzador.ps1)
├─ actualizar.bat                lanzador delgado (solo invoca scripts\actualizar.ps1)
│
├─ scripts/                     TODA la lógica en PowerShell
│   ├─ lanzador.ps1                lógica real del lanzador (firmable con Authenticode)
│   ├─ actualizar.ps1               instala una versión nueva, siempre a mano
│   ├─ empaquetar-release.bat/.ps1  arma el .zip + version.json para publicar (no se distribuye)
│   └─ VERSION                      número de versión de esta copia
│
├─ herramientas/                un .html por herramienta (solo marcado)
├─ assets/                      lógica de negocio + base común (me-ui, me-api)
├─ doc/                         este archivo + un README.md por herramienta + lanzador
└─ release/                     salida de empaquetar-release.ps1 (no se versiona a mano)
```

Cada herramienta sigue el mismo patrón de tres capas — el porqué está en
[lanzador/README.md](lanzador/README.md):

```txt
herramientas/<algo>.html        marcado, sin lógica
assets/logica-<algo>.js         reglas de negocio (consultas, validaciones, formato)
assets/me-<algo>-puente.js      enganche entre esa lógica y el shell común
```

---

## Por qué existe

Estas herramientas reemplazan macros de Excel y pasos manuales que
dependían de copiar y pegar entre SIME, el CM y hojas de cálculo — con los
problemas que eso trae: archivos que se truncan al subirlos (ver
[generar-rechazo](generar-rechazo/README.md)), convenciones de
nombre mezcladas, datos copiados a mano que se desactualizan. Cada
herramienta documenta en su propio `README.md` el problema puntual que
resuelve y por qué se resolvió así.

No usa git, GitHub, SharePoint ni un dominio corporativo para
distribuirse — cada equipo tiene su propia copia de la carpeta, y
`dame click.bat` avisa solo cuando hay una versión nueva publicada (ver
[lanzador](lanzador/README.md)). Esa decisión, y sus
contrapartidas (antivirus, transporte HTTP plano, credenciales
compartidas por sesión), están explicadas en la sección **Riesgos** de
ese mismo documento.

---

## Versionado

`Major.Minor.Patch` (`2.2.0`, `2.2.1`, `2.3.0`...): **Major** (`X`) identifica
un cambio mayor o incompatible, **Minor** (`Y`) una funcionalidad compatible y
**Patch** (`Z`) una corrección o cambio de documentación. Al incrementar Major
se reinician Minor y Patch; al incrementar Minor se reinicia Patch. Las
versiones históricas de uno o dos componentes se interpretan con ceros a la
derecha (`2.2` equivale a `2.2.0`). El número de la suite vive en
`scripts\VERSION`; cada herramienta muestra además su propia versión mediante
`MEUI.init()`. `scripts\empaquetar-release.ps1` permite elegir el tipo de
incremento al armar una release — ver
[lanzador](lanzador/README.md) para el detalle completo del
mecanismo de publicación y actualización.

---

## Documentación

- **[GETTINGSTARTED.md](GETTINGSTARTED.md)** — usar la suite día a día, o
  ponerse a tocar el código por primera vez.
- **[lanzador](lanzador/README.md)** — arquitectura de la base
  común, el lanzador, la auto-actualización y los riesgos conocidos.
- **`<herramienta>/README.md`** — una por cada herramienta de la
  tabla de arriba: qué problema resuelve, cómo se usa, y las reglas de
  negocio que aplica. Cada una también se abre desde dentro de su propia
  herramienta (botón de ayuda) y desde la portada (`index.html`).
