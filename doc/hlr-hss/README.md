# HLR/HSS · Claro y Tigo — Documentación técnica

> **Versión: v2.7** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Junta en **una sola página con pestañas** lo que antes eran **tres herramientas separadas**:

| Pestaña | Reemplaza a | Qué hace |
| --- | --- | --- |
| **Tigo** | Consulta QDN · Tigo | Consulta el HLR/HSS de Tigo por autogestión. Solo lectura. |
| **Claro** | Validador QDN · Claro | Consulta el QDN de Claro y **opera la línea** (bloqueo/desbloqueo/conciliación). Escribe en producción: cada envío pasa por el resumen de confirmación. |
| **Ambos** | ¿En qué HLR está? | Consulta Claro y Tigo **en paralelo** y concluye en cuál de las dos redes está la línea. Solo lectura. |

Cada pestaña es **la misma herramienta de antes, sin cambios de lógica** — ver «Por qué» más abajo. El detalle técnico de cada operador está integrado en las secciones [Claro](#claro), [Tigo](#tigo) y [Ambos](#ambos) de este documento; los motores aquí descritos son la única fuente de código de esas pestañas.

---

## Por qué se fusionaron

Las tres herramientas consultaban cosas relacionadas (HLR/HSS por operador) pero vivían en pestañas del menú distintas, obligando a abrir una, anotar, cerrar, abrir la siguiente. Juntarlas bajo un solo punto de entrada con pestañas internas reduce ese salto sin tocar ninguna regla de negocio ya probada en producción.

**Cómo se hizo, con el mínimo riesgo posible:**

1. Cada motor (`tigo.js`, `claro.js` —con las operaciones de escritura— y `ambos.js`) vive en su propio `(function(){ ... })()`. Estos archivos son hoy la **única fuente** de sus reglas de negocio.
2. El envoltorio es necesario porque los tres motores declaran los mismos nombres de nivel superior (`filas`, `render`, `consultar`, `dataTable`, `ejecutarPool`...) — al vivir antes en páginas separadas nunca chocaban; en una sola página sí lo harían.
3. `claro.js` tiene dos bloques (consulta QDN y operaciones de escritura) dentro de un **mismo IIFE compartido**: las operaciones referencian variables de la consulta por nombre suelto (`gestorQdn`, `cfgQdn`, `filas`, `render`, etc.). Un cierre compartido preserva ese acople.
4. El marcado (KPIs, pasos, tabla, modal) de cada herramienta original se copió, también tal cual, dentro de un `<template>` propio. Un `<template>` no forma parte del DOM activo, así que los tres pueden convivir en el archivo sin que sus ids choquen.
5. Al cambiar de pestaña, `hlr-hss.js` **desmonta por completo** la pestaña anterior antes de montar la siguiente — nunca hay más de un `<template>` clonado en el documento a la vez. Es necesario porque los tres motores comparten ids (`#tablaResultados`, `#inputLineas`, `#modalDetalle`...); tenerlos montados a la vez duplicaría esos ids y solo el primero respondería.

**Verificación de fidelidad**: el contenido de cada motor envuelto se comparó línea por línea (`diff`) contra el archivo original antes de esta fusión — la única diferencia son los comentarios nuevos explicando el envoltorio.

---

## Arquitectura y archivos

| Archivo | Qué contiene |
| --- | --- |
| `herramientas/hlr_hss.html` | Solo marcado: pestañas, y un `<template>` por operador con el marcado original de esa herramienta. |
| `assets/herramientas/hlr-hss/tigo.js` | Motor Tigo. |
| `assets/herramientas/hlr-hss/claro.js` | Motor Claro: consulta QDN + operaciones de escritura (mismo IIFE). |
| `assets/herramientas/hlr-hss/ambos.js` | Motor Ambos (cruce Claro/Tigo). |
| `assets/herramientas/hlr-hss/hlr-hss.css` | Estilos de la herramienta (antes incrustados en el HTML). |
| `assets/herramientas/hlr-hss/hlr-hss.js` | Interruptor de pestañas: monta/desmonta el `<template>` activo y llama a `MotorX.iniciar()` (y `MotorX.reiniciar()` si ya se había visitado esa pestaña, para no reusar un `DataTable` apuntando a una tabla ya desmontada). |
| `assets/base/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

Cada motor expone un objeto global mínimo:

```js
window.MotorTigo  = { iniciar, desmontar, reiniciar, filasExport, filasParaExportar };
window.MotorClaro = { iniciar, desmontar, reiniciar, ... };   // iniciar() llama a inicializarQdn() + inicializarOperaciones()
window.MotorAmbos = { iniciar, desmontar, reiniciar, filasExport, filasParaExportar };
```

`desmontar()` lo llama `hlr-hss.js` al salir de la pestaña: abandona la consulta en vuelo (deja de tocar el progreso del pie y la tabla de la pestaña siguiente) y marca el progreso como interrumpido.

`iniciar()` es exactamente la función que antes se auto-ejecutaba sola al cargar el script (`inicializarQdn();` / `inicializarTigo();` / `inicializarCruce();`); aquí se difiere hasta que esa pestaña se monta de verdad en el DOM, porque antes de eso `MEUI.$("#tablaResultados")` y compañía no encontrarían nada.

---

## Cambiar de pestaña reinicia esa consulta

Al volver a Tigo después de haber estado en Claro, la pestaña Tigo **empieza vacía otra vez** — no se guardan los resultados de una pestaña mientras se está en otra. Es consecuencia directa de desmontar/remontar el `<template>`: cada motor mantiene su tabla y sus filas en variables privadas de su propio cierre, y esas variables no sobreviven a que su `<table>` se haya ido del documento.

Si esto resulta molesto en el uso diario, la mejora natural sería que cada motor exponga también un `guardarEstado()`/`restaurarEstado()` — no se hizo en esta primera versión para no tocar más de lo necesario la lógica ya probada.

---

## Interfaz común (v2.6)

Las tres pestañas usan las mismas piezas de `me-ui.js`; cada una mantiene sus propios KPI, filtros y tabla, sin mezclar estados.

- **Filtros**: todos van en la barra `.me-filtros` como desplegables `MEUI.filtroMulti` (Tigo: Estado y Restricciones · Claro: Estado, Bloqueos, 5G, Roaming y Marcación · Ambos: Ubicación), seguidos de «Limpiar filtros» y «Columnas»; a la derecha, separador y exportaciones. El único buscador de texto es el «Buscar» de DataTables. Las tarjetas KPI siguen filtrando y quedan sincronizadas con los desplegables (una tarjeta se enciende solo si su valor es la selección de su dimensión). Las opciones «Errores / timeout (todos)», «Ambos / no concluyente (todos)» y «Residuo en Tigo (todos)» agrupan igual que sus tarjetas.
- **Progreso**: la barra propia desaparece; `MEUI.progreso` (pie) muestra N/M líneas de la pestaña activa y, al terminar, «Consultado a las HH:MM». Si hubo fallas aparece **«Reintentar fallidas (k)»**, que vuelve a consultar solo esas líneas con la misma función de consulta (Tigo y Claro: `ERROR`, `ERROR_RETCODE` y `TIMEOUT`, excepto el 404 de Claro, que es una respuesta válida; Ambos: solo el operador que falló). Las operaciones de escritura de Claro muestran su avance con el mismo pie, sin botón de reintento (repetir una escritura puede duplicarla).
- **Estados de la tabla** (`MEUI.estadoTabla`): «cargando» mientras consulta, «vacío» si los filtros no dejan filas (la barra de filtros no se oculta) y «error» con **Reintentar** si ninguna línea respondió bien.
- **Selección (Claro)**: «Marcar todo» (filas filtradas), «Desmarcar todo», «Marcar visibles» y «Desmarcar visibles» (página actual) siempre a la vista. Las acciones sobre lo marcado (**Conciliación** y **Aprovisionar**, esta última solo para usuarios autorizados) están en la barra de lote `.me-lote`, que solo aparece con líneas marcadas («N marcadas»). El filtro «Marcación» reemplaza al selector `#fSel`.
- **Escrituras (Claro)**: todo botón que escribe en el HLR/HSS lleva `btn-me-peligro` y va en un grupo `.me-acciones-escritura` aparte (menú «Operaciones» de bloqueos y desbloqueos sobre lo filtrado, barra de lote y operaciones del detalle de la línea). El formulario de la operación (datos editables, nota) termina en **«Revisar y ejecutar»**: se cierra y `MEUI.confirmarEscritura` muestra el resumen (operación, líneas, nota, entorno, usuario y las primeras líneas). Aplica a **toda** operación, también al desbloqueo; reemplaza la doble confirmación anterior. La lista `USUARIOS_PROVISION` se conserva.
- **Ayuda**: los párrafos explicativos pasaron a botones «?» (`data-me-ayuda`); se quedan los avisos de riesgo real.
- **Modales**: el detalle de la pestaña Ambos pasa a `modal-xl`; se quitaron las alturas máximas propias de la tabla de confirmación y del detalle por categorías.

---

## Riesgos y límites

- **Claro escribe en producción.** El motor Claro incluye bloqueo, desbloqueo y conciliación de línea, más (desde v2.1 de ese motor, ya con la fusión hecha) **cambio de IMSI/ICCID/KI y cambio de MSISDN** — las dos últimas marcadas como **riesgo alto**, solo disponibles por línea individual (nunca en el menú masivo), con resumen de confirmación y vista antes/después de cada campo. Detalle completo en [Claro: operaciones](#claro-operaciones).
- **Un solo `<template>` montado a la vez.** Es la pieza que hace posible la fusión sin renombrar ids; si algún día se quisiera ver dos pestañas simultáneamente (por ejemplo, para comparar), habría que namespacing real de ids, que sí toca la lógica de cada motor.
- **Las páginas originales ya no existen** (Validador QDN, QDN Tigo y Validador HLR cruzado, junto con su código independiente, se eliminaron): los motores de esta carpeta son la única fuente.
- **Distribución**: igual que las demás herramientas de esta suite — se descargan y ejecutan localmente en los PC administrados, no se publican en un servidor.

---

<a id="claro"></a>

## Pestaña Claro · detalle técnico

La numeración 3–11 de las subsecciones conserva las referencias técnicas del motor original.

## 3. Conexión

Solo está confirmado el ambiente **PDN (Producción)**. Los valores vienen precargados y quedan ocultos tras *"Ver / editar datos de conexión (avanzado)"*.

| Parámetro | Valor por defecto |
|---|---|
| Token URL | `https://apim.claro.com.co/MsCommunicatAuthToken/User/authenticate` |
| Client ID | `MOVILEXITO` |
| Base API gateway | `https://msapigateway-nm-apigateway-aro-prod.apps.prd-claro-co.eastus2.aroapp.io` |
| Ruta QDN | `/APIMParOrdeConsQDN/MS/CUS/Customer/RSParOrdeConsQDN/V1/ValideQDN/{msisdn}` |

El gestor de token replica las estrategias de `interfaz.py`: `client_credentials` en el cuerpo (PDN), Basic + `client_credentials`, JSON usuario/clave, *password grant* con el usuario de API y JSON `clientId/clientSecret`. El token se renueva solo; el chip de sesión permite conectar manualmente y la consulta obtiene el token cuando lo necesita.

## 4. Entrada de líneas

- **Escribir/pegar**: acepta espacio, tabulación, salto de línea, coma, punto y coma y `|`.
- **Excel (.xlsx) / CSV**: zona de arrastrar y soltar, con selección de hoja y columna (detecta `msisdn`/`linea` sola).
- Se normaliza a solo dígitos y se valida longitud **7–15**. Se informan **recibidos, válidos, inválidos y duplicados**; los duplicados se consultan una sola vez y los inválidos no llegan al servicio.

---

### 4.1 Texto pegado con encabezado

El cuadro de texto acepta dos cosas. **Solo líneas**, separadas por lo que sea (espacio, coma, `;`, salto de línea) — como siempre. O una **tabla pegada con encabezado** (CSV, punto y coma, tabulaciones de Excel), por ejemplo:

```
imsi,iccid,pin1,puk1,pin2,puk2,adm1,ki,msisdn
732157000000000,8957732157000000000,0000,50056336,1640,60482134,AA105D033B17C4A8,D2D642BC5670C80C55E968E7178FE391,3332949603
```

Se reconoce como tabla si la primera fila tiene un separador y alguna columna cuyo nombre, **normalizado** (minúsculas, sin tildes), sea el de la línea: `msisdn`, `linea`, `celular`, `telefono`, `numero`, `movil`, `min`, `abonado`… (`MEUI.detectarColumna`; "Línea", "CELULAR", "Telefono" valen igual). La línea sale de esa columna; si además hay columnas `imsi`, `iccid` o `ki`, se toman para las operaciones exactamente igual que cuando vienen en un archivo. Una sola columna con encabezado (`Telefono` y debajo las líneas) también se entiende. Si no se reconoce encabezado, todo el texto se lee como líneas sueltas.

### 4.2 La entrada contra el QDN: discrepancias

**El QDN es el dato real y actual de la línea.** Cuando la entrada (archivo o texto) trae IMSI o ICCID y el QDN responde otros, **no se corrige nada solo**: la fila queda marcada con ⚠ en la columna Estado (el tooltip dice qué difiere), sale un aviso por línea en el registro y un resumen al final de la consulta, y en el detalle de la línea aparece la alerta con los dos valores. En el formulario de una operación el valor que se envía es el de la entrada, con el origen marcado como `entrada ≠ QDN (…)` bajo el campo, para que el analista lo corrija ahí si corresponde. Si el QDN no trae el dato (línea inactiva), no hay con qué comparar y no se marca nada.

## 5. Ejecución

| Regla | Comportamiento |
|---|---|
| Concurrencia | Configurable, **5 por defecto** (tope técnico del servicio: 15 TPS). Nunca secuencial. |
| Timeout | 30 s por intento. |
| Reintentos | **Solo por timeout**: hasta 2 adicionales (3 intentos totales). |
| 401/403 | Renueva el token una vez y repite **sin gastar** reintento. |
| Errores funcionales | 400/401/403/404 y 5xx **no** se reintentan. |
| Fallo individual | No detiene el lote. |

Estados por línea: `EN COLA`, `CONSULTANDO`, `ACTIVE`/`INACTIVE` (según `operationalState`), `INCONSISTENTE`, `TIMEOUT`, `ERROR`, `INVALID`.

## 6. Qué se considera una consulta exitosa

**El HTTP 200 no basta.** Igual que `evaluar_negocio()` de `interfaz.py`, se recorre el cuerpo completo buscando marcas de fallo:

- `responseCode` o `statusCode` **≥ 400**
- `success: false`
- un objeto `error` con contenido (se extrae su `message`/`description` y `messageCode`)

Si aparece cualquiera, la línea queda en **ERROR** aunque el HTTP haya sido 200.

Además se valida la **coherencia**: `result.id` debe corresponder al MSISDN consultado y debe venir `operationalState`. Si no, la línea queda en **INCONSISTENTE** — se muestra el detalle, pero encabezado por el aviso *"no usar como evidencia sin verificar"*.

## 7. Regla de "no inventar datos"

| Situación | Qué se muestra |
|---|---|
| La característica **vino** con el texto `No Registra` | `No Registra` (es una afirmación del HLR) |
| La característica **no vino** en el response | `—` (no hay dato) |
| No llegó ninguna característica de bloqueo | Bloqueos: **`Sin datos`** (no "Sin bloqueos") |
| Roaming sin campo `odbBaroam`/`odbr` | `—` (no "Sin restricción") |
| Hay bloqueos activos del grupo Roaming | La columna Roaming los refleja, no dice "Sin restricción" |

Una línea inactiva o inexistente sale con todo en `—`, no con datos afirmativos.

## 8. Interpretación de bloqueos

Regla de negocio de la HU sobre las características de bloqueo:

| Valor QDN | Interpretación |
|---|---|
| `No Registra` (también `0`, `Ninguno`, vacío) | Sin bloqueo |
| `4` | **Bloqueo activo** |
| `5` | Bloqueo **histórico** (no activo hoy) |
| Otro valor | Se muestra crudo, **no** se cuenta como activo |

Se evalúan bloqueos **nacionales** (entrantes, salientes, SMS, identificador, LDI total / otros indicativos / 444 / sin implementación, video llamada), **de datos** (GPRS, SGSN, redes de otros operadores), **de roaming** (barring general, entrantes, salientes, desvíos, otros operadores) y **de VLR** (voz, SMS, fax, datos asíncronos/síncronos, PAD).

## 9. Tabla y detalle

Columnas: **MSISDN, Estado, IMSI, IMEI, 5G, Telefonía, SMS, Datos, Roaming, Bloqueos, Desvío, APN, IP, Portabilidad, Detalle (👁)**.

El modal organiza el response en las 10 categorías de la HU — Identidad, Servicios, Bloqueos, Datos/Internet, Roaming, Desvíos, VLR/MSC, VoLTE, Portabilidad y COTA — más **Información técnica** (`responseCode`, `messageCode`, `message`, `legacy`, `transactionId`, `timestamp`, `startOperatingDate`, intentos, duración) y el **JSON original**.

> El parser **no asume que `name` es único**: conserva cada característica con su `name`, `friendly_name` y `value`, porque el response repite nombres con significados distintos (p. ej. `UDC_SRVBSVOZ-csiState`, `TITAN_SRVVOLTE-order`).
<a id="claro-operaciones"></a>

## 11. Operaciones sobre la línea (bloqueo, desbloqueo y conciliación)

Hasta la v1.1 la herramienta era de **solo lectura**. Desde la v2.0 puede además **escribir en la red de Claro**, con el mismo servicio y los mismos cuerpos que usa `interfaz.py`:

```
PATCH {base_apigw}/APIMParOrdeProvision/MSParOrdeProvision/SVC/Service/RSParOrdeProvision/V1/ModifingService
```

Usa el **mismo token OAuth2** de la consulta QDN (`gestorQdn`): no hay una segunda autenticación.

### 11.1 Catálogo

El menú va en este orden, lo más usado primero: **Procesos** (conciliación y, para usuarios autorizados, aprovisionar / desaprovisionar), **SIM y número** (cambios en la SIM y cambio de MSISDN) y al final **Bloqueos**, **plegados** porque se usan poco: una fila por familia —bloqueo total, llamada saliente, llamada entrante, SMS saliente, SMS entrante, larga distancia, roaming— cada una con su icono y su par *bloquear | desbloquear* al lado, nunca mezclados en una sola lista. El modal de operación es ancho (`modal-xl`).

| Grupo | Operación | `process` / `action` | Confirmación |
|---|---|---|---|
| Bloqueo total | Bloqueo TOTAL | `lockall` · `level=2` | Resumen común |
| Bloqueo total | Desbloqueo TOTAL | `unlockall` | Resumen común |
| Bloqueos individuales | Bloquear / desbloquear llamada ENTRANTE | `blqinccl` · `activate`/`deactivate` | Resumen común |
| Bloqueos individuales | Bloquear / desbloquear llamada SALIENTE | `blqoutcl` · `activate`/`deactivate` | Resumen común |
| Bloqueos individuales | Bloquear / desbloquear SMS ENTRANTE | `blqincsms` · `activate`/`deactivate` | Resumen común |
| Bloqueos individuales | Bloquear / desbloquear SMS SALIENTE | `blqoutsms` · `activate`/`deactivate` | Resumen común |
| Bloqueos individuales | Bloquear / desbloquear larga distancia (LDI) | `blqldi` · `activate`/`deactivate` | Resumen común |
| Roaming | Activar / desactivar ROAMING | `roaming` · `activate`/`deactivate` · `features=roaming` | Resumen común |
| Procesos | Conciliación de línea | `conciliation` | Resumen común |
| **Riesgo alto** | Cambio de SIM (IMSI / ICCID / KI) | `change_imsi` | Resumen común |
| **Riesgo alto** | Cambio de MSISDN | `change_msisdn` | Resumen común |

`features` **nunca** viaja como `""`: vacío se envía como `" "`, igual que en `interfaz.py`. Desde v2.1 también viaja en **todas** las operaciones (no solo roaming): ver §11.6.

**"Riesgo alto" solo se ofrece por línea, nunca en el menú masivo.** Cambian un identificador propio de la línea (IMSI, ICCID, KI o MSISDN): el valor nuevo tiene que ser distinto para cada línea, así que aplicar "el mismo IMSI nuevo" a varias líneas de una sola vez sería un error, no una operación válida — por diseño no aparecen en el botón **Operaciones** de la barra (masivo), solo en el modal de detalle de una línea.

### 11.2 De dónde salen IMSI, ICCID y KI

| Origen | Cuándo | Nota |
|---|---|---|
| **manual** | Se escribió en el modal de la operación | Gana sobre todo lo demás |
| **archivo** | Columnas opcionales `imsi` / `iccid` / `ki` del Excel o CSV | Basta con subir `msisdn,imsi` |
| **QDN** | `UDC_PRSSIMCD-imsi` · `COTA_PRSSIMCD-iccid` | Lo trae la consulta |
| **derivado** | `ICCID = 8957 + IMSI` | Solo si el ICCID falta. Ej.: `732157001050037` → `8957732157001050037` |

El origen de **cada valor** se muestra bajo su campo: nunca se presenta un dato derivado o escrito a mano como si lo hubiera dicho el HLR. Todos los campos son **editables** antes de ejecutar, y los que falten se piden ahí mismo (el botón no se habilita hasta completarlos). La **KI** nunca la devuelve el QDN: o viene del archivo (columna `ki`), o se escribe. Es **obligatoria en la conciliación** —por dentro hace un delete/post de la línea, igual que aprovisionar— y en «Aprovisionar»; los bloqueos no la usan.

### 11.3 Individual y masivo

- **Individual**: bloque *Operaciones sobre la línea* dentro del modal de detalle.
- **Masivo**: botón **Operaciones** en la barra de acciones; aplica a las líneas **visibles tras los filtros**. Antes de ejecutar se listan **todas** las líneas afectadas, con las que se omiten y el motivo.

Tras ejecutar, la herramienta **vuelve a consultar el QDN** de las líneas tocadas y refresca la tabla: es el mismo `qdn → operación → qdn` de los escenarios de `interfaz.py`. Sin eso la tabla seguiría mostrando el estado anterior.

### 11.4 Éxito real y bitácora

El éxito **no** es el HTTP 200: se evalúa el cuerpo con el mismo `evaluarNegocio()` de la consulta. Un 200 con `success:false` o `responseCode >= 400` cuenta como **FALLA**.

Cada ejecución queda en la **bitácora** de la sesión con fecha/hora, **usuario que la ejecutó** (el de la sesión CM o SIME que dejó el lanzador), MSISDN, operación, `process`/`action`, IMSI, ICCID, HTTP, resultado, código y `transactionId`. Se ve en el registro y se descarga con el botón **Bitácora**.

> El token de QDN es de servicio (`client_credentials MOVILEXITO`) y no identifica a la persona. La bitácora es local; el PATCH también envía el usuario en `note`, como se detalla en §11.7.

**Un timeout NO se reintenta**: la operación pudo haberse aplicado y repetirla la duplicaría. Se reporta como tal para verificar con una consulta antes de repetir.

**Un error de conexión (`conn-err`) sí se reintenta** en el motor actual, hasta 2 veces adicionales con espera creciente (600 ms × intento). Es el caso en que el gateway cierra o resetea la conexión sin respuesta, frecuente en lotes grandes. Si los reintentos fallan se registra `conn-err` y el número de intentos. Esta política se conserva en el refactor, pero no recibir una respuesta no prueba que la escritura no se haya procesado; una respuesta incierta requiere comprobar el QDN antes de repetir manualmente.

### 11.5 Riesgo alto: cambio de IMSI/ICCID/KI y cambio de MSISDN

Estas dos operaciones cambian **identificadores propios de la línea**, no una restricción reversible con un clic — un dato nuevo incorrecto puede dejarla sin servicio. Por eso, además del resumen de confirmación:

- Se muestran **antes → después** de cada campo que cambia, en la propia tabla de confirmación (no hay que adivinar qué va a quedar).
- Como el servicio es un **PATCH**, no hace falta llenar todos los campos: solo el valor nuevo del dato que de verdad cambia. `change_imsi` solo exige el **IMSI nuevo**; ICCID y KI nuevos son opcionales. `change_msisdn` solo exige el **MSISDN nuevo**.
- **El ICCID nuevo se deriva igual que el actual**: si se escribe un IMSI nuevo y no se escribe un ICCID nuevo, se calcula solo como `8957 + IMSI nuevo` — mismo criterio que el ICCID actual (§11.2). Si el ICCID (actual o nuevo) **no empieza por `8957`**, se avisa en pantalla — **nunca se corrige solo**.
- `change_msisdn` también manda `portation_status`. No hay documentación propia de este campo: se deja editable con `"0"` de partida, que es el único valor visto en un ejemplo real. Revísalo antes de confirmar si el caso lo amerita.

Ejemplo real de `change_imsi` (cambia IMSI, ICCID y KI a la vez — un cambio de SIM típico):

```json
{
  "process": "change_imsi", "relatedParty": [{"id": "EXITO", "role": "ServiceProvider", "name": "MOVIL EXITO"}], "tier": "prepaid",
  "msisdn": "3332949607",
  "imsi": "732157000000003", "imsi_new": "732157000000004",
  "iccid": "8957732157000000003", "iccid_new": "8957732157000000004",
  "ki": "B7F657E350B0AA90400ED533840C950D", "ki_new": "2F782E7A124E7393D265006D1951B70A",
  "features": " ", "note": "usuario"
}
```

Ejemplo real de `change_msisdn`:

```json
{
  "process": "change_msisdn", "relatedParty": [{"id": "EXITO", "role": "ServiceProvider", "name": "MOVIL EXITO"}], "tier": "prepaid",
  "msisdn": "3332949604", "msisdn_new": "3332949605",
  "imsi": "732157000000001", "portation_status": "0",
  "features": "blqinccl", "note": "usuario"
}
```

### 11.6 `features`: los bloqueos activos viajan solos, en todas las operaciones

Antes de v2.1, `features` solo se usaba en roaming (`"roaming"` fijo); el resto mandaba `" "`. El riesgo: si una línea **ya tenía** bloqueos activos y se ejecutaba otra operación sin mencionarlos, el servicio podía interpretarlo como que esos bloqueos ya no aplican.

Desde v2.1, la tabla de confirmación trae una columna **Features** en **todas** las operaciones, pre-llenada así:

1. Se leen los bloqueos activos de la consulta QDN (`bloqueosActivos`).
2. Los que se pueden traducir **con confianza** al nombre que espera el PATCH se unen con `|` — hoy: llamadas entrantes (`blqinccl`), llamadas salientes (`blqoutcl`) y roaming (`roaming`).
3. Los que **no** tienen una traducción confiable (por ejemplo, "SMS" a secas: el QDN no distingue si el bloqueo activo es de SMS entrante o saliente, y `blqincsms`/`blqoutsms` son procesos distintos; o los LDI más granulares — otros indicativos, 444/Infracel, sin implementación de red — que no se sabe con certeza si equivalen al mismo `blqldi`) **no se adivinan**: se listan aparte en un aviso, para que el analista los agregue a mano si corresponde. Solo se traduce el LDI "total" (`UDC_BRRLDIFL-osb4` / `UDC_SRVLDIFL-osb4`) a `blqldi`.
4. El campo queda **editable**: lo escrito a mano siempre gana sobre lo detectado.
5. Sin bloqueos detectados ni nada escrito, viaja como `" "` (nunca `""`, igual que siempre).

### 11.7 Nota de la operación

El campo `note` del PATCH lleva **siempre** el usuario que ejecuta (mismo criterio que la bitácora) y, si el analista escribió algo en el campo **Nota** del modal de confirmación, se agrega después de un `". "` — mismo formato visto en un ejemplo real: `"usuario. Se realiza cambio de línea por x o y motivo"`. La nota es **una por confirmación** (no una por línea en masivo): es el motivo de la operación, no un dato propio de cada MSISDN.

---

### 11.8 Aprovisionamiento: crear o eliminar la línea en el HLR/HSS (usuarios autorizados)

Dos operaciones más, **no son PATCH** al `ModifingService` sino `DELETE` y `POST` a otros dos recursos del mismo servicio, tomadas de `reset-linea-me-claro/main.py`:

| Operación | Método y recurso | Cuerpo |
|---|---|---|
| **Desaprovisionar** (eliminar del HLR/HSS) | `DELETE …/RSParOrdeProvision/V1/DeletingService` | `relatedParty, iccid, imsi, msisdn, tier` |
| **Aprovisionar** (crear en el HLR/HSS) | `POST …/RSParOrdeProvision/V1/provisionServiceRED` | lo anterior + `ki` (**obligatoria**), `technology` (`4G`), `note` (usuario + nota) |

Van por el **mismo gateway y la misma ruta base** que el `ModifingService` que la herramienta ya usa en PDN; solo cambia el último tramo, tomado de `main.py`. `main.py` apunta esos recursos a un host de QA directo (sin el prefijo `APIMParOrdeProvision`): aquí se sigue el patrón que ya funciona en producción para el mismo servicio. Si el gateway respondiera 404 en alguno de los dos, la ruta es lo primero que hay que revisar.

**Quién lo ve.** Solo aparece el grupo «Aprovisionamiento» si se cumplen las dos cosas: (1) hay **sesión del CM vigente** en la cabecera —es el login de Keycloak el que dice quién es el usuario— y (2) ese usuario está en `USUARIOS_PROVISION` (`assets/herramientas/hlr-hss/claro.js`; hoy: `jpelaezg`). Para autorizar a alguien más se agrega ahí. En cuanto la sesión del CM vence o se cierra, el grupo desaparece; al entrar, aparece (los menús se vuelven a pintar con cada cambio de sesión). Es una **guarda de interfaz** para que nadie lo ejecute por accidente, no un control de acceso del servicio: el token de Claro es el mismo para todos.

**Línea que no existe.** Una línea que el QDN responde con **404** no se puede bloquear ni conciliar (no hay nada que tocar)… pero sí **aprovisionar**: es exactamente el caso. Para esa línea el QDN no tiene IMSI/ICCID/KI, así que tienen que venir del archivo (columnas `imsi`, `iccid`, `ki`) o escribirse en el formulario. El detalle de una línea 404 ahora sí pinta el bloque de operaciones (antes se quedaba con el de la línea anterior).

**KI.** Confirmado en PDN con la prueba individual (2026-09-17, línea 3332949603): el `DELETE` no la necesita y el `POST` **sin `ki` responde 400**. Por eso en «Aprovisionar» la KI es campo obligatorio (el botón no se habilita sin ella) y el QDN nunca la da: viene de la columna `ki` del archivo o se escribe en el formulario.

**Qué deja el DELETE.** También confirmado: tras el `DELETE` la línea **no desaparece** del HLR/HSS, queda `inactive` en el QDN (no 404). Es decir, el ciclo normal es `active → DELETE → inactive → POST → active`; el caso 404 (línea que nunca existió) es el otro origen posible del POST, no el habitual.



### Contrato común de las cargas útiles

`payloadOperacion()` en `claro.js` define el cuerpo. Todo PATCH lleva `process`, `relatedParty=[{id:"EXITO",role:"ServiceProvider",name:"MOVIL EXITO"}]`, `tier="prepaid"`, `msisdn`, `features` y `note`. Los bloqueos/desbloqueos agregan `imsi`; `lockall` añade `level="2"`, y las operaciones con acción añaden `action="activate"` o `"deactivate"`. Conciliación añade además `iccid` y `ki`. Roaming fija `features="roaming"`; los demás usan los bloqueos detectados o editados de esa línea. Los campos nuevos de SIM/número son los de §11.5. DELETE y POST de aprovisionamiento tienen sus propios cuerpos (§11.8), sin `process` ni `features`.

### Riesgos específicos de Claro

`portation_status="0"` viene de un ejemplo real y carece de especificación confirmada. Los bloqueos desconocidos se muestran crudos; la traducción a `features` avisa lo que no puede deducir. Las escrituras no tienen deshacer; hay que verificar una respuesta incierta con QDN antes de repetir. Un error de conexión sin respuesta no demuestra por sí solo que el servidor no haya procesado la petición: el motor conserva sus reintentos actuales por `conn-err`, pero ese resultado debe tratarse con cautela. Las consultas a gran volumen cuestan aproximadamente `líneas ÷ concurrencia × ~3 s`; CSV evita el coste de Excel en lotes muy grandes.


---

<a id="tigo"></a>

## Pestaña Tigo · detalle técnico

## 2. Servicio

```
POST {base}/apimew/api/v1/autogestion/HLR/consulta
Headers: Content-Type: application/json · X-Api-Key: <llave fija>
Body:    { "TransactionID": "...", "FechaConsulta": "<ISO 8601>", "Linea": "57XXXXXXXXXX" }
```

- Endpoint: `tulioqa.grupo-exito.com`. No hay OAuth.
- **El nombre engaña**: el gateway se llama «qa», pero detrás hay **un solo HLR/HSS** y es el de **producción**. No existe un HLR de pruebas: lo que devuelve son datos reales.
- El campo `Linea` viaja **con indicativo 57**: la herramienta lo antepone sola, no hay que escribirlo.
- La respuesta es **JSON**, no texto plano:

```json
{ "perfilHLR": "<volcado de texto del comando HLR>", "transaccionID": "...",
  "fechaHora": "...", "error": [] }
```

Con éxito, `perfilHLR` trae el volcado del comando (tipo USCDB) y `error` va vacío. Con fallo, `perfilHLR` va vacío y el detalle crudo llega dentro de `error[0]`.

## 3. Estados (RETCODE)

| RETCODE | Estado | Significado | Qué hacer |
|---|---|---|---|
| `0` | **Activa** | El suscriptor tiene perfil creado en el HLR/HSS. | Nada. |
| `3001` | **Sin perfil** | `Subscriber not defined`: la línea **no tiene perfil** en el HLR. | Depende del estado en ME — ver tabla siguiente. |
| `1033` | **Residuo en Tigo** | `Number threshold exceeded`: la línea se portó a Móvil Éxito pero **Tigo no la eliminó de su HLR/HSS**. | **Escalar a Tigo** para que depuren. Tras la depuración la consulta pasa a responder `3001`. |
| otro | Error (RETCODE) | Código no catalogado: se muestra crudo. | Revisar el detalle crudo. |

### 3.1 El `3001` por sí solo no concluye nada

`3001` dice que **no hay perfil**, no de quién es el número. Hay que cruzarlo con el estado de la línea en ME (Optiva):

| Estado en ME | Lectura | Qué hacer |
|---|---|---|
| **Activa** | Inconsistencia: está activa en ME pero sin perfil en el HLR. | **Escalar a Optiva.** |
| **Inactiva** | Esperado: si está inactiva, obvio que no tiene perfil. | Nada. |
| **No pertenece a ME** | El número no es de Móvil Éxito (puede ser un Port Out). | Descartar del lote. |

### 3.2 La cadena del proceso

```
1033 ──(Tigo depura su HLR/HSS)──▶ 3001 ──(se crea el perfil)──▶ 0
```

## 4. Coherencia de la respuesta (anti-ruido)

Antes de dar por buena una consulta se verifica que la respuesta **hable de la línea consultada**. Si no, el estado pasa a **`Revisar respuesta`** (`INCONSISTENTE`):

- El `ISDN` del perfil **no coincide** con el MSISDN consultado.
- `RETCODE 0` pero **sin perfil HLR**.
- `RETCODE 0` con perfil pero **sin ISDN**, imposible de atribuir a una línea.
- La respuesta trae perfil **y además** errores.

Esta validación es la que evita que un servicio que devuelva siempre el mismo perfil (o un stub de QA) haga que **todas** las líneas salgan como Activa.

## 5. Ejecución

| Regla | Comportamiento |
|---|---|
| Entrada | Pegar, CSV o Excel, con los mismos separadores del resto de la suite. |
| Validación | Solo dígitos, longitud 7–15; se informan inválidos y duplicados. |
| Concurrencia | Configurable, **8 por defecto**. Nunca secuencial. |
| Timeout | 30 s por intento. |
| Reintentos | **Solo por timeout**: hasta 2 adicionales (3 intentos totales). |
| Fallo individual | No detiene el lote. |

## 6. Parseo del perfil HLR

El volcado no es JSON: es la salida de un comando propietario con **secciones entre comillas** y pares `CAMPO = VALOR`.

```
                          IMSI = 732111256404516
                          ISDN = 573057888636
"LOCK"
                            IC = FALSE
"ODB Data"
                         ODBOC = BOCROAM
```

El parser conserva **orden y repeticiones**, descarta las líneas de eco del comando (`+++`, `PGW`, `%%`, `---`) y agrupa todo en las secciones tal como vinieron: Identidad, LOCK, SABLOCK, Basic Service, ODB Data, SS Data, O-CSI, T-CSI, MO-SMS-CSI, TIF-CSI, VLR/SGSN Roaming Restrict y GPRS Data.

## 7. Bloqueos: heurística declarada

> El formato del HLR **no tiene documentación pública** y solo se dispone de una respuesta real exitosa de referencia. La detección de bloqueos es **best-effort** y así está marcada en la interfaz.

Se marcan como restricción:

- Secciones `LOCK` y `SABLOCK`: `IC`, `OC`, `GPRSLOCK`, `EPSLOCK`, `NON3GPPLOCK`, `CSUPLLCK`, `PSUPLLCK` con valor `TRUE`.
- Sección `ODB Data`, **solo** los campos con mapeo estándar de barring (3GPP TS 23.015): `ODBSS`, `ODBOC`, `ODBIC`, `ODBPB1-4`, `ODBROAM`, `ODBRCF`, `ODBECT`, `ODBPOS`. Se consideran sin restricción cuando valen `FALSE` o empiezan por `NOB` (`NOBAR`, `NOBRCF`, …).

Quedan **fuera del resumen a propósito** `ODBENTE`, `ODBINFO`, `ODBPOSTYPE`, `ODBENTEROAM`, `ODBINFOROAM`, `ODBDECT` y `ODBMECT`: no tienen mapeo confiable y marcarlos generaría falsos positivos. Siguen visibles en el detalle crudo.

**Desvíos**: se listan los tipos con `= PROV` (`CFU`, `CFB`, `CFNRY`, `CFNRC`, `CFD`) y se rotulan como *"Provisionados"* — `PROV` significa configurado, no necesariamente desviando ahora; el estado real (`PROV | REG | ACT`) está en la sección `SS Data` del detalle.

---

<a id="ambos"></a>

## Pestaña Ambos · evaluación cruzada

Ambas consultas corren con `Promise.all` por línea, usando los endpoints y la autenticación descritos arriba. Concurrencia: **5 líneas por defecto**, equivalentes a 10 peticiones simultáneas; timeout de 30 s y hasta dos reintentos solo por timeout. No mezcla ambientes: las dos redes consultadas son productivas.

## 4. Regla de conclusión

Punto de partida, confirmado por el equipo:

- **Claro no distingue** "no existe" de "inactiva": ambos casos responden `operationalState = inactive` con HTTP 200. Solo aporta Activa / Inactiva.
- **Tigo** aporta tres señales por `RETCODE`:

| RETCODE Tigo | Estado | Qué significa |
|---|---|---|
| `0` | **Activa** | La línea tiene perfil en el HLR/HSS de Tigo. |
| `3001` | **Sin perfil** | `Subscriber not defined`. **No es presencia en Tigo** ni prueba de quién es el número: puede estar inactiva en ME, ser una inconsistencia a escalar a Optiva si en ME figura activa, o no ser de Móvil Éxito. |
| `1033` | **Residuo en Tigo** | `Number threshold exceeded`. La línea se portó a Móvil Éxito pero Tigo **no la eliminó** de su HLR/HSS. **Sí queda registro en Tigo**, pero no es un perfil utilizable: se escala a Tigo y, una vez depurado, pasa a responder `3001`. |

Matriz de conclusión:

| Claro | Tigo | Conclusión |
|---|---|---|
| Activa | `0` | **Ambos — revisar** (no debería pasar) |
| Activa | `1033` | **Claro + residuo en Tigo** (escalar a Tigo) |
| Activa | `3001` / error | **Claro** |
| Inactiva | `0` | **Tigo** |
| Inactiva | `1033` | **Residuo en Tigo (escalar)** |
| Inactiva | `3001` | **Ninguno** |
| error/timeout en ambos | — | **No concluyente** |

*Ambos* y *No concluyente* existen a propósito: es preferible marcar un caso para revisión manual que forzar una conclusión que el dato no sostiene.

La tarjeta **Residuo en Tigo** agrupa los dos casos que terminan en el mismo escalamiento (`Residuo en Tigo` y `Claro + residuo en Tigo`).

El orden efectivo de `concluirUbicacion()` importa cuando falla un operador: si ambos fallan devuelve **No concluyente**; si hay presencia activa o residuo válido en uno, conserva esa conclusión aunque el otro falle. Solo cuando no hay ninguna presencia válida y falla al menos uno devuelve **No concluyente**. No se interpreta un error como ausencia confirmada. La tarjeta Residuo agrupa Residuo en Tigo y Claro + residuo; el detalle conserva los JSON de ambos.


---

## Historial de los motores integrados

Las versiones siguientes pertenecen a las herramientas retiradas; la versión de HLR/HSS sigue siendo la del encabezado.

| Motor | Evolución conservada |
|---|---|
| Claro 1.0–3.5 | Consulta concurrente y detalle; 1.1: éxito funcional, coherencia y datos ausentes; 2.0: bloqueos/desbloqueos y conciliación; 2.1: cambios de SIM/número, features dinámicos y nota; 2.2: confirmación legible; 3.0: KI obligatoria, aprovisionamiento por usuario y sesión CM; 3.1: encabezados y discrepancias de entrada; 3.2: conciliación/aprovisionar sobre marcadas; 3.3: reintentos por conexión; 3.4: IMSI copiable; 3.5: filtros, progreso, selección y confirmación comunes. |
| Tigo 1.0–1.4 | Consulta neutral concurrente, perfil por secciones y JSON; 1.1: coherencia ISDN y Observaciones; 1.2: 3001 = Sin perfil y 1033 = Residuo en Tigo; 1.3: IMSI copiable; 1.4: filtros, progreso, reintentos de fallidas y accesibilidad comunes. |
| Ambos 1.0–1.3 | Consulta paralela y matriz comparativa; 1.1: matriz actualizada para 3001/1033 y Claro + residuo; 1.2: filtro agrupado Ambos/no concluyente; 1.3: filtros, progreso, reintentos por operador y detalle comunes. |

---

## Historial de cambios

| Versión | Cambios |
|---|---|
| 2.7 | Pestaña Claro: concurrencia de consultas por defecto ajustada a 5. El valor del input y el respaldo usan la misma constante de configuración del motor. |
| 2.6 (refactor) | Refactor interno, sin cambios de comportamiento: los archivos pasan a `assets/herramientas/hlr-hss/` (`tigo.js`, `claro.js`, `ambos.js`, `hlr-hss.js`), el CSS sale del HTML a `hlr-hss.css`, y se eliminan comentarios y ramas que solo existían para las páginas sueltas y algo de código sin uso. |
| **2.6** | Migración a la base de UI común, sin cambios de lógica de negocio: filtros como `MEUI.filtroMulti` en las tres pestañas (KPI sincronizadas), progreso en el pie con `MEUI.progreso` y **«Reintentar fallidas»**, estados de tabla con `MEUI.estadoTabla`, textos largos a «?». Claro: controles de selección siempre visibles y barra de lote para Conciliación/Aprovisionar, filtro «Marcación» en lugar de `#fSel`, y las escrituras con `btn-me-peligro`, grupo aparte y `MEUI.confirmarEscritura` (reemplaza la doble confirmación). Al cambiar de pestaña se abandona la consulta en vuelo. |
| 2.5 | IMSI copiable en las tablas de las pestañas Claro y Tigo (el detalle ya lo tenía). |
| 2.4 | Pestaña Claro: las operaciones (bloqueos, conciliación, aprovisionar…) reintentan solas los **errores de conexión** (conexión cerrada/reseteada sin respuesta, frecuente en lotes grandes), hasta 2 veces con espera creciente. El **timeout** sigue sin reintentarse solo. Ver `doc/hlr-hss/README.md#claro-operaciones` §11.4. |
| 2.3 | Pestaña Claro: **Aprovisionar y Conciliación** ya se ofrecen también en el menú masivo, pero solo sobre las líneas **marcadas con checkbox** (columna nueva al frente de la tabla, más un filtro `#fSel`) — no sobre todo lo filtrado, como bloqueos/desbloqueos. Desaprovisionar se queda fuera del masivo. Ver `doc/hlr-hss/README.md#claro-operaciones` §11.8. |
| 2.2 | Pestaña Ambos: la tarjeta **Ambos / no concluyente** ahora filtra los dos resultados que requieren revisión; el desplegable de Ubicación ofrece el mismo filtro agrupado y conserva las opciones individuales. |
| 2.1 | Pestaña Claro: menú de operaciones reorganizado (Procesos → SIM y número → Bloqueos plegados por familia, con iconos), modal de operación más ancho, entrada de texto con encabezado (la línea por nombre de columna normalizado, más `imsi`/`iccid`/`ki` si vienen) y aviso de discrepancias entre la entrada y el QDN. Ver `doc/hlr-hss/README.md#claro-operaciones` §4.1, §4.2 y §11.1. |
| 2.0 | **Sesión del CM en la pestaña Claro** (bloque dentro del paso 1, chip en la cabecera, credenciales compartidas con las demás herramientas): no consulta nada, solo identifica quién opera. Con ella, los usuarios autorizados ven el grupo **Aprovisionamiento** (crear/eliminar la línea en el HLR/HSS) — ver `doc/hlr-hss/README.md#claro-operaciones` §11.8. **Esc con modales anidados** cierra primero el formulario de la operación y después el detalle (antes cerraba el detalle y dejaba el formulario). El paso «Líneas a consultar» de Claro pasa a abrirse siempre (antes dependía de la sesión). |
| 1.1 | Arreglos de interfaz reportados en uso: **(1)** la columna de pasos no se podía contraer en ninguna pestaña — `montarTogglePasos()` corre dentro de `MEUI.init()`, cuando `.me-trabajo` todavía vive dentro del `<template>` y no existe en el documento, así que el botón «Contraer» no se montaba nunca (y cada cambio de pestaña destruye el que hubiera); ahora el puente lo vuelve a montar en cada montaje, igual que ya hacía con los pasos. **(2)** La **Conexión QDN** de Claro ahora viene **contraída** y **sin botón «Probar conexión»**, igual que la de Tigo: el token se pide solo al consultar, y conectar a mano se hace desde el chip de sesión de la cabecera (que ahora llama a `MotorClaro.conectar()` en vez de simular un clic en un botón que ya no existe). **(3)** En el modal de operación, «Se omiten» y **«Cuerpo que se envía» vienen plegados** (`<details>`), para que el formulario se lea de corrido. **(4)** La **tabla de confirmación** se rediseñó: ancho de columnas fijo (`table-layout: fixed`) en vez de automático —era la causa de que el valor actual y el input se encimaran—, línea y estado en una sola columna, el cambio se lee como **«antes / después»** en dos renglones etiquetados y alineados (antes era el valor viejo con una flecha suelta encima del input, sin decir cuál era cuál), encabezado fijo al hacer scroll, y la columna **Features** pasa de listar todo el detalle a un resumen corto («2 bloqueos detectados»), con el detalle completo en el tooltip. |
| 1.0 | Primera versión: fusiona Validador QDN · Claro, Consulta QDN · Tigo y ¿En qué HLR está? en una sola herramienta con pestañas, reusando los tres motores sin cambios de lógica. |
