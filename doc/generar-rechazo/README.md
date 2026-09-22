# Generar archivo de rechazo — Documentación técnica

> **Versión: v2.1.1** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Arma el soporte PDF que se adjunta a un rechazo de portabilidad. Reemplaza las
tres macros de Excel: `MACRO DE PORTABILIDAD.xlsx` (FC titularidad),
`MACRO DE PORTABILIDAD LS.xlsx` (Línea Suspendida) y
`MACRO DE PORTABILIDAD LD.xlsx` (Línea Desactivada).

---

## 1. Objetivos y por qué se dejó el Excel

- Reemplazar las tres macros de Excel por un flujo único para las causales FC,
  Línea Suspendida y Línea Desactivada.
- Prellenar desde el CM los datos disponibles sin inventar los que no lleguen.
- Generar un PDF liviano, verificable y ajustado a una sola página.
- Estandarizar el nombre de archivo y evitar consecutivos repetidos durante el
  trabajo diario.

El PDF que exportaba Excel pesaba **217 KB**, de los cuales **190 KB (el 87,5 %)**
eran las fuentes Calibri y Aptos incrustadas completas. El contenido real del
documento son 18 KB: el texto del formato y tres logos.

Ese peso es lo que hacía que la plataforma truncara el archivo. De once soportes
analizados, **dos llegaron cortados**, y los dos en una frontera de bloque exacta:

| Archivo | Bytes | ÷ 4096 | ÷ 8192 | `%%EOF` |
| --- | --- | --- | --- | --- |
| `000082026080100028-FC` | 139.264 | 34 exactos | 17 exactos | **0** |
| `000082026090100001-FC` | 122.880 | 30 exactos | 15 exactos | **0** |
| Los otros nueve | — | resto arbitrario | resto arbitrario | 2 |

Un PDF sin su marca de fin de archivo no lo abre ningún lector: por eso salían
«corruptos» tanto en la plataforma como al descargarlos.

Esta herramienta genera el PDF con **Helvetica**, una de las catorce fuentes
estándar del formato PDF, que **no se incrusta y no pesa**. Medido sobre las
tres causales:

| Caso | Peso | Páginas |
| --- | --- | --- |
| Sin imagen adjunta | 12 KB | 1 |
| Con manifestación típica (829×61) | 24 KB | 1 |
| Con captura grande (1000×1400) | 35 KB | 1 |
| **Macro de Excel, para comparar** | **217 KB** | 1 |

De 217 KB a 24 KB: **unas 18 veces menos**. Un archivo de ese tamaño atraviesa
el cargue en un instante y deja de estar expuesto al corte.

> El truncamiento en sí es un fallo de la plataforma, que además acepta y guarda
> anexos incompletos sin detectarlo. Bajar el peso elimina el síntoma, no la
> causa: el escalamiento a la plataforma sigue haciendo falta.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
| --- | --- |
| `herramientas/generar_rechazo.html` | Marcado de pasos, campos, zona de imágenes y visor. No contiene reglas de negocio. |
| `assets/logica-rechazo.js` | Catálogo de causales, validaciones, nombres, consulta al CM, compresión de imágenes y generación del PDF. |
| `assets/me-rechazo-puente.js` | Estado de la interfaz, reloj de fechas, eventos, vista previa y guardado. |
| `assets/me-api.js` | Sesión de Keycloak y acceso compartido al API del CM. |
| `assets/me-ui.js` · `assets/me-ui.css` | Shell común, pasos, registro, avisos y estilos. |

Todo corre en el navegador del analista. No existe un backend propio: la página
consulta directamente el CM y genera el PDF localmente. Los logos se incluyen
como base64 en `logica-rechazo.js`, por lo que no dependen de archivos vecinos.

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
| --- | --- | --- |
| **Bootstrap** | 5.3.3 | Rejilla, formularios, botones, modal y componentes visuales. |
| **Bootstrap Icons** | 1.11.3 | Iconos de acciones y estados. |
| **jsPDF** | 2.5.1 | Construcción en memoria del PDF y de su vista previa. |
| **Archivo / IBM Plex Mono** | Google Fonts | Tipografía de la interfaz; no se incrusta en el PDF. |

Las dependencias se cargan desde CDN. El documento PDF usa Helvetica, una
fuente estándar del formato PDF que no necesita incrustarse.

---

## 4. Endpoints

Todos los endpoints se resuelven sobre `MEAPI.CONFIG.apiBase` y requieren la
sesión del CM.

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/api/v1/subscribers` | Buscar la línea, sus BAN, estado y fecha de desactivación. |
| `GET` | `/api/v1/billingAccount` | Localizar una cuenta por `externalID`. |
| `GET` | `/api/v1/billingAccount/{id}` | Resolver directamente una cuenta relacionada o padre. |
| `GET` | `/api/v1/individual/{id}` | Obtener identificación, tipo y nombre individual. |
| `GET` | `/api/v1/customer/{id}` | Obtener el nombre del cliente. |

La búsqueda del titular puede subir hasta cinco niveles por `parentId` y
`accountRelationship[]`, porque el BAN de la línea suele ser una cuenta hija y
el documento está registrado en una cuenta superior.

---

## 5. Funcionalidad

### 5.1. Sesión del CM

El token del CM vive en **memoria de cada página**, así que no se hereda al
cambiar de herramienta. Lo que sí se comparte por `localStorage` son las
credenciales: si ya iniciaste sesión en otra herramienta, aquí se reutilizan y
la sesión se abre sola al cargar.

Sin este paso, cualquier consulta devuelve *«No hay token ni usuario/clave del
CM»* aunque haya sesión abierta en otra pestaña.

### 5.2. Causal

Tres botones: **FC**, **LS**, **LD**. El formulario cambia según la causal —
cada una tiene sus propios campos de fecha y su propio cierre. Al cambiar de
causal se conserva lo que ya estaba escrito.

### 5.3. Línea y consulta al CM

Se escribe el MSISDN (10 dígitos que empiezan por 3; si se pega con el `57`
delante, se quita solo) y se presiona **CM**. La herramienta consulta el BSS por
el mismo camino que la herramienta de Prepagadas:

| Dato | De dónde sale |
| --- | --- |
| Estado de la línea | `/api/v1/subscribers` → `subscriberResponseList[].status.state` |
| Fecha y hora de desactivación | `status.startDate` cuando el estado es 2 (Desactivado) |
| Identificación y tipo | cadena de cuentas: `billingAccount` → `individual.individualIdentification` |
| Nombre del titular | `customer.name`, o `individual.givenName` + `familyName` |
| **No. solicitud rollback (CUN)** | **pendiente — hoy se digita a mano** |

Este bloque es un **porte de la lógica ya probada de Prepagadas**, no una
reimplementación: mismos servicios, mismos fallbacks de `billingAccount` y la
misma forma de subir por la cadena de cuentas. Importa porque el BAN de la línea
suele ser una **cuenta hija sin documento**, y la cédula está en la cuenta de
arriba: se sube por `parentId` y por `accountRelationship[]` hasta encontrarla,
con un tope de 5 saltos. El `accountID` viene como `41041348619-1` y el
`externalID` de la cuenta es la parte antes del guion, así que se prueban las dos
formas.

Si cambia algo aquí, conviene mirar también `assets/logica-prepagadas.js`.

> **Pendiente de conectar.** El CUN todavía se escribe a mano: no está
> identificado qué servicio del CM lo expone. En cuanto se sepa, basta con
> llenar `salida.cun` dentro de `consultarCM()` en `logica-rechazo.js` y el
> campo se rellena solo, sin tocar nada más.
>
> El mapeo de la **fecha de desactivación** (`status.startDate` con el estado en
> 2) está deducido de la estructura que devuelve el BSS, no confirmado contra un
> caso real. Conviene validarlo con una línea desactivada conocida y comparar
> contra lo que muestra el CM en pantalla.

**Lo que el CM no devuelva queda en `N/A`** y se completa a mano. La herramienta
no inventa datos: cada dato que no llegó se anota en el registro y se muestra
como aviso.

> **Nombre de prueba «FirstName LastName».** Algunas cuentas del BSS sin datos
> reales cargados devuelven ese nombre literal (con distinto espaciado o
> mayúsculas). No es el nombre de nadie: se detecta y se descarta igual que si
> el CM no hubiera devuelto nombre, con un aviso en el registro explicando por
> qué el campo quedó vacío. Ver `esNombrePlaceholder()` en `logica-rechazo.js`.

### 5.4. Datos del formato

Los campos **no se agrupan como salen en el PDF, sino por lo que hay que hacer
con ellos**, en el orden de trabajo del analista:

| Grupo | Qué contiene |
| --- | --- |
| **Llenar** | Vacíos, hay que escribirlos: nombre, identificación, fecha de expedición, CUN, y las fechas propias de la causal (suspensión / desactivación). |
| **Revisar** | Traen un valor que conviene confirmar: tipo de identificación, tipo de persona, tipo de servicio, estado de la línea y motivo. |
| **Automáticos** | Se calculan solos y casi nunca se tocan: fecha de extracción, fecha de consulta, fecha según causal, sistema y anexo. Van al final y se ven atenuados. |

El orden del PDF **no cambia**: lo fija el catálogo de la causal, no esta
pantalla.

#### Fechas automáticas: siguen el reloj

Las fechas del grupo **Automáticos** (*fecha de extracción*, *fecha de consulta*,
*fecha según causal*) llevan **día, hora, minutos y segundos** y se actualizan
**cada segundo con la hora real**.

Antes se calculaban una sola vez al pintar el formulario, así que se quedaban en
la hora en que se había abierto la herramienta: un rechazo generado a las cinco
de la tarde salía con la hora de la mañana. Además el valor se recortaba a
minutos, aunque el formato de la macro imprime segundos.

Las reglas del reloj:

- **Se detiene en cuanto el analista escribe** en el campo: lo que se digita
  manda sobre el reloj.
- **Vuelve a arrancar si el campo se devuelve a la fecha de hoy**, y en ese
  momento se pone en hora de inmediato.
- **Cambiar solo la hora dentro del día de hoy no lo reactiva**: se mira el
  cambio de *día*, no de hora, justo para poder fijar una hora concreta de hoy
  sin que el reloj la pise.
- **No se pisa el campo que está enfocado**, para no estorbar mientras se edita.

El PDF **se vuelve a generar justo antes de guardar**, para que las fechas del
archivo sean las del momento en que se produjo y no las de la última tecla que
se pulsó. La vista previa puede ir unos segundos atrasada respecto a los campos;
el archivo guardado no.

Las fechas que **no** son automáticas (*fecha y hora de la suspensión* y *de la
desactivación*) no las toca el reloj: son un dato del caso, no del momento de
generación. También admiten segundos.

> Un detalle del navegador: cuando los segundos son `00`, el control muestra y
> guarda `07:00` en vez de `07:00:00`. El PDF igual imprime `07:00:00`.

#### Campos vacíos

Un campo en blanco **se imprime como `N/A`** en el PDF, pero el formulario lo
deja vacío y muestra `N/A` solo como marcador. Así no se hace pasar por dato
diligenciado algo que nadie escribió, y de un vistazo se ve qué falta.

#### Reglas que se aplican solas

- **NIT ⇒ persona jurídica.** Al elegir `NIT` en tipo de identificación, *TIPO
  PERSONA* pasa a `JURIDICA` y **se bloquea**: es regla de negocio, no una
  preferencia.
- **Representante legal solo en persona jurídica.** Los tres campos del
  representante legal aparecen únicamente con `JURIDICA`. Al volver a `NATURAL`
  se ocultan **y se limpian**, para que no quede colgado el dato de un titular
  jurídico anterior.
- **Estado de la línea: desplegable abierto.** Sugiere Activa, Disponible,
  Inactiva, Bloqueada, Portada, Línea Suspendida, DESACTIVADA y N/A, pero admite
  escribir uno que no esté en la lista.
- **El motivo sigue a la causal.** Al pasar de FC a LS, el motivo y el estado de
  la línea se actualizan al valor de la causal nueva **mientras nadie los haya
  tocado**. Si el analista los editó —o si el dato vino del CM— se respetan.
- **Formato de la identificación.** Se valida el número según el tipo (CC 6–10
  dígitos, CE 5–7, NIT 9–10) y se marca en rojo si no cuadra. `N/A` es válido.

> **Nota sobre el representante legal en el PDF.** En el formulario los campos
> desaparecen con persona natural, pero en el documento **las filas se siguen
> imprimiendo con `N/A`**, porque así vienen los nueve soportes que la
> plataforma ya aceptó. Si se confirma que la plataforma admite el documento sin
> esas filas, se quitan filtrando `soloJuridica` en `recorrer()`.

### 5.5. Imagen de manifestación

Se arrastra, se elige con clic o **se pega con `Ctrl+V`**, que es como llega
normalmente una captura.

Se comprime antes de incrustarla: se reescala a 1000 px de ancho y se guarda
como JPEG de calidad 0,72. Una captura de texto queda indistinguible a simple
vista y pesa entre 15 y 40 veces menos.

**Lo normal es una sola imagen.** Adjuntar más de una es el caso excepcional —
algunos rechazos necesitan más de una evidencia — y por eso no es el flujo por
defecto: una vez hay una imagen adjunta aparece **«+ Añadir otra imagen»**, y
cada nueva se agrega a una lista. Las imágenes se apilan en el PDF **en el
mismo orden en que aparecen en esa lista**, una debajo de otra — la lista en
pantalla se ve tal como queda el documento. Se pueden quitar una por una, y el
tope es de **6 imágenes** por documento (más que eso ya no es razonable en un
formato de una sola página).

Sin ninguna imagen, el PDF deja el recuadro rotulado y vacío, para que se vea
que el anexo falta.

### 5.6. Nombre del archivo

El nombre sigue una **plantilla** con tres partes: un **prefijo**, la **fecha**
en formato `AAAAMMDD` (fija: es la única forma que se ve en los archivos
reales) y un **consecutivo** con el ancho de dígitos que se elija.

```
0008 20260909 0000007 -FC.pdf
└┬─┘ └───┬──┘ └──┬──┘  └┬┘
 │       │       │      └── causal: FC / LS / LD (la pone la causal activa)
 │       │       └───────── consecutivo del día, ancho configurable
 │       └───────────────── fecha AAAAMMDD, fija
 └───────────────────────── prefijo, configurable
```

**La plantilla no está limitada a una convención fija.** Se crean, usan y
borran desde el propio formulario, con «+ Nueva plantilla…» en el desplegable,
y **quedan guardadas de forma permanente en el navegador** (`localStorage`), no
solo durante la sesión. Combinaciones ya vistas en archivos reales:

| Prefijo | Dígitos del consecutivo |
| --- | --- |
| `0008` | 3, 4, 5 o 7 |
| `00008` | 3, 4 o 5 |

La primera vez que se abre la herramienta en un navegador se siembran las dos
convenciones originalmente observadas (`0008`+7 y `00008`+5), para no perder lo
que ya se usaba; a partir de ahí la lista la administra el analista. Se
conserva siempre al menos una plantilla — no se puede borrar la última.

- El **consecutivo es diario**: arranca en 1 cada día y se recuerda en el
  navegador para no repetirlo. Solo se consume cuando el archivo **se guarda
  de verdad** (no si se cancela el diálogo de guardado).
- La plantilla elegida se recuerda entre sesiones.
- Si se edita el nombre a mano, deja de recalcularse solo y no consume el
  consecutivo. El botón ↺ vuelve al nombre sugerido.

### 5.7. Vista previa y guardado

**La vista previa es el PDF real**, no una maqueta en HTML: lo que se ve en el
visor es byte por byte lo que se guarda. Se regenera sola al cambiar cualquier
campo.

El botón dice **«Guardar PDF como…»** y abre el selector nativo del sistema
operativo (File System Access API) para elegir dónde queda el archivo en
**cada** descarga — no depende de que en el navegador esté activada la opción
*«Preguntar dónde guardar cada archivo antes de descargar»*. Donde el
navegador no lo soporte (o el contexto no sea seguro, como puede pasar al
abrir por `file://` en algunos casos), cae automáticamente a la descarga
normal hacia la carpeta de Descargas — se avisa en el registro, pero el
archivo siempre queda guardado. Si se cancela el selector, no se consume el
consecutivo ni se registra nada, porque no se guardó nada.

El indicador de peso compara contra los 217 KB de la macro y avisa en ámbar
por encima de 60 KB y en rojo por encima de 120 KB.

> **Archivos guardados en 0 KB (v2.1).** El selector nativo escribía el
> `Blob` del PDF directamente con `writable.write(blob)`. En Chromium/Edge
> —sobre todo en la ventana `--inPrivate` con la que abre `dame click.bat`—
> esa llamada puede resolver sin error y dejar el archivo en disco con
> **0 bytes**: es un bug conocido del File System Access API. Ahora se
> escribe un `ArrayBuffer` (`await blob.arrayBuffer()`), que no lo tiene, y
> además se relee el archivo recién guardado (`handle.getFile()`) para
> comparar su peso con el del PDF: si no coincide, se avisa en el registro
> y se repite el guardado por la vía clásica (`MEUI.descargar`) en vez de
> dejar pasar un archivo vacío sin que nadie se entere.

### 5.8. Ajuste a una página

El documento **siempre cabe en una página**, como las macros. Antes de dibujar
nada se mide el alto que ocuparía y se busca la mayor escala que quepa —el mismo
«ajustar a una página» que hacía Excel, que imprimía al 36-57 %—. La medición y
el dibujo son el mismo código recorrido dos veces, así que no pueden
desincronizarse.

Las imágenes **reducen su tamaño antes que el texto**: cada una se ajusta
dentro de una caja de 62 mm de alto máximo. Con varias imágenes, el ajuste
automático de la página entera (medir → probar una escala menor → repetir) se
encarga de que todas quepan sin que el texto se vuelva ilegible: con 3 o más
imágenes anchas la escala baja de forma perceptible, y es la señal de que
conviene revisar si hacen falta todas.

---

## 6. Estructura del documento

Se reproduce la macro para que la plataforma reciba exactamente el mismo
documento que ya conoce:

```
[logos Móvil Éxito]
RECHAZO PORTABILIDAD          ← barra negra
CAUSAL DE RECHAZO             ← barra amarilla
<causal>
INFORMACION DE LA LINEA       ← sección
  NÚMERO DE LÍNEA
INFORMACION DEL CLIENTE       ← sección
  <fechas de la causal>
  <10 campos del cliente>
  <campos extra de la causal>
  MOTIVO / IDENTIFICACION SISTEMA / ANEXO
IMAGEN MANIFESTACIÓN          ← sección
  <una o varias imágenes apiladas, o recuadro vacío>
INFORMACIÓN CLIENTE           ← sección, resumen repetido
  <espejo de los campos clave>
  <cola: CUN y motivo, en LS y LD>
```

### 6.1. Campos por causal

| | FC titularidad | Línea Suspendida | Línea Desactivada |
| --- | --- | --- | --- |
| Fecha de arriba | FECHA: SEGÚN CAUSAL | FECHA Y HORA DE LA SUSPENCIÓN + FECHA: SEGÚN CAUSAL | FECHA Y HORA DESACTIVACIÓN + FECHA DE EXTRACCION |
| Después del cliente | FECHA DE EXTRACCION + FECHA DE CONSULTA | FECHA Y HORA DE LA SUSPENCIÓN + FECHA DE CONSULTA | — |
| Cola del resumen | — | CUN + Motivo de Bloqueo/suspención | CUN + Motivo |
| Estado por defecto | Activa | Línea Suspendida | DESACTIVADA |
| Se trae del CM | identificación, nombre y estado | identificación, nombre y estado | **fecha de desactivación**, identificación, nombre y estado |

Los diez campos del cliente son iguales en las tres causales: nombre,
identificación, identificación del representante legal, tipo de identificación,
fecha de expedición, tipo de persona, tipo de servicio, estado de la línea, tipo
de identificación del representante legal y su fecha de expedición.

---

## 7. Mejoras frente a la macro de Excel

| | Macro de Excel | Esta herramienta |
| --- | --- | --- |
| Peso del PDF | 217 KB | ~12-35 KB |
| Riesgo de truncamiento | alto | prácticamente nulo |
| Nombre del archivo | a mano, con convenciones mezcladas y erratas | plantillas guardadas de forma permanente, editable |
| Datos del cliente | se copian a mano del CM | se traen del CM y se corrigen |
| Nombre de prueba del BSS | se pegaba tal cual («FirstName LastName») | se detecta y se descarta solo |
| NIT / persona jurídica | a criterio de quien diligencia | forzado y bloqueado |
| Formato de fechas | mezclaba `03-08-2026` y `03/08/2026` | siempre `DD/MM/AAAA HH:MM:SS` |
| Bloque de resumen | fórmulas que se rompen al mover filas | se arma solo desde los datos |
| Imagen | se pegaba una sola, sin comprimir | una o varias, comprimidas, con el ahorro a la vista |
| Dónde se guarda | siempre la carpeta de Descargas | se elige en cada archivo |
| Área de impresión | LD no la tenía definida | no aplica: el PDF se arma directo |
| Vista previa | ninguna hasta exportar | el PDF real, en vivo |

---

## 8. Riesgos y límites

- **El CUN no está conectado al CM.** Se digita manualmente hasta identificar
  el servicio que lo expone.
- **La fecha de desactivación necesita validación funcional.** Se toma de
  `status.startDate` cuando el estado es 2, según la estructura observada del
  BSS, pero debe contrastarse con una línea desactivada conocida.
- **Dependencia de CDN.** Sin acceso a jsDelivr, cdnjs o Google Fonts la página
  puede perder estilos o no generar el PDF. Los datos y logos propios sí viven
  localmente.
- **Estado local del navegador.** Plantillas y consecutivos viven en
  `localStorage`; borrar los datos del sitio, usar otro perfil o cambiar de
  equipo reinicia esa información.
- **File System Access API.** No existe en todos los navegadores o contextos.
  En ese caso se usa la descarga tradicional y el destino depende de la
  configuración del navegador.
- **Cantidad y tamaño de imágenes.** Se admiten hasta seis. Varias capturas
  altas obligan a reducir la escala de toda la página y pueden afectar la
  legibilidad.
- **Truncamiento externo.** Reducir el peso evita el caso observado, pero no
  corrige el fallo de la plataforma que acepta anexos incompletos.

### 8.1. Verificación después de subir el archivo

Descárgalo de la plataforma y **compara el tamaño con el del original**. Si no
coinciden exactamente, se truncó y hay que volver a cargarlo. Regla rápida: si
el tamaño del archivo descargado es un múltiplo exacto de 4096, está truncado.

---

## 9. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **2.1.1** | La resolución del titular incorpora los respaldos confirmados con la colección de Postman: usa `individual.fullName` y prueba el `id` de la cuenta como `individualID` cuando no llega una relación `Individual`, sin perder la búsqueda de hasta cinco niveles. |
| 2.1 | Se corrige el guardado de archivos de 0 KB en Chromium/Edge: el selector nativo escribe un `ArrayBuffer`, relee el archivo y compara su tamaño; si la verificación falla, repite mediante la descarga clásica. Cancelar el selector no consume el consecutivo. |
| 2.0 | Migración a la base compartida (`me-ui.js`, `me-api.js` y puente separado); HTML solo con marcado. Se incorporan sesión compartida del CM, formulario por causal, consulta de línea y titular, fechas automáticas con segundos, múltiples imágenes comprimidas, plantillas persistentes de nombre, consecutivo diario, vista previa del PDF real y selector de destino. |
| 1.0 | Versión inicial para reemplazar las macros FC, Línea Suspendida y Línea Desactivada con un PDF de una página generado mediante jsPDF y fuentes estándar, reduciendo el peso aproximado de 217 KB a 12–35 KB. |
