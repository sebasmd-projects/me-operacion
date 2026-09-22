# Validador QDN · Claro (HLR/HSS) — Documentación técnica

> **Versión: v3.3** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Consulta por **MSISDN** el estado de una línea en el HLR/HSS de Claro a través del servicio **QDN** de Móvil Éxito, de forma individual o masiva. Implementa la HU *"Validador HLR/HSS mediante consulta QDN Movil Éxito - Claro"*.

> Todo corre en el navegador del analista. No hay backend propio: la página autentica contra el servicio OAuth2 de Claro y consulta el API gateway directamente.

---

## 1. Objetivos

- Resolver, para una o miles de líneas, **cuál es el estado real en HLR/HSS** sin entrar a consolas técnicas.
- Identificar **bloqueos y restricciones** (nacionales, datos, roaming, VLR) con su interpretación de negocio.
- Dejar disponible el **response completo** organizado por categorías, y el **JSON original** para QA, auditoría y troubleshooting.
- **No generar ruido**: si un dato no vino en la respuesta, no se inventa.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `herramientas/validador_qdn.html` | Solo marcado: KPIs, pasos, filtros, tabla y modal de detalle. |
| `assets/logica-qdn.js` | Autenticación OAuth2 propia de QDN, parseo del response, concurrencia, reintentos, filtros y tabla. |
| `assets/logica-qdn-operaciones.js` | Operaciones que **escriben** en la red: bloqueos, desbloqueos y conciliación (§11). Se carga después y reusa el token, las filas y los filtros de `logica-qdn.js`. |
| `assets/me-qdn-puente.js` | Enganche con el shell: sesión, exportaciones, spinners, registro. |
| `assets/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

QDN **no** usa el Keycloak del CM (`me-api.js`): tiene su propio OAuth2, por eso la autenticación vive en `logica-qdn.js`.

---

## 3. Conexión

Solo está confirmado el ambiente **PDN (Producción)**. Los valores vienen precargados y quedan ocultos tras *"Ver / editar datos de conexión (avanzado)"*.

| Parámetro | Valor por defecto |
|---|---|
| Token URL | `https://apim.claro.com.co/MsCommunicatAuthToken/User/authenticate` |
| Client ID | `MOVILEXITO` |
| Base API gateway | `https://msapigateway-nm-apigateway-aro-prod...aroapp.io` |
| Ruta QDN | `/APIMParOrdeConsQDN/MS/CUS/Customer/RSParOrdeConsQDN/V1/ValideQDN/{msisdn}` |

El gestor de token replica las estrategias de `interfaz.py`: `client_credentials` en el cuerpo (PDN), Basic + `client_credentials`, JSON usuario/clave, *password grant* con el usuario de API y JSON `clientId/clientSecret`. El token se renueva solo; **Probar conexión** solo sirve para verificar antes de una carga masiva.

---

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
| Concurrencia | Configurable, **8 por defecto** (tope técnico del servicio: 15 TPS). Nunca secuencial. |
| Timeout | 30 s por intento. |
| Reintentos | **Solo por timeout**: hasta 2 adicionales (3 intentos totales). |
| 401/403 | Renueva el token una vez y repite **sin gastar** reintento. |
| Errores funcionales | 400/401/403/404 y 5xx **no** se reintentan. |
| Fallo individual | No detiene el lote. |

Estados por línea: `EN COLA`, `CONSULTANDO`, `ACTIVE`/`INACTIVE` (según `operationalState`), `INCONSISTENTE`, `TIMEOUT`, `ERROR`, `INVALID`.

---

## 6. Qué se considera una consulta exitosa

**El HTTP 200 no basta.** Igual que `evaluar_negocio()` de `interfaz.py`, se recorre el cuerpo completo buscando marcas de fallo:

- `responseCode` o `statusCode` **≥ 400**
- `success: false`
- un objeto `error` con contenido (se extrae su `message`/`description` y `messageCode`)

Si aparece cualquiera, la línea queda en **ERROR** aunque el HTTP haya sido 200.

Además se valida la **coherencia**: `result.id` debe corresponder al MSISDN consultado y debe venir `operationalState`. Si no, la línea queda en **INCONSISTENTE** — se muestra el detalle, pero encabezado por el aviso *"no usar como evidencia sin verificar"*.

---

## 7. Regla de "no inventar datos"

| Situación | Qué se muestra |
|---|---|
| La característica **vino** con el texto `No Registra` | `No Registra` (es una afirmación del HLR) |
| La característica **no vino** en el response | `—` (no hay dato) |
| No llegó ninguna característica de bloqueo | Bloqueos: **`Sin datos`** (no "Sin bloqueos") |
| Roaming sin campo `odbBaroam`/`odbr` | `—` (no "Sin restricción") |
| Hay bloqueos activos del grupo Roaming | La columna Roaming los refleja, no dice "Sin restricción" |

Una línea inactiva o inexistente sale con todo en `—`, no con datos afirmativos.

---

## 8. Interpretación de bloqueos

Regla de negocio de la HU sobre las características de bloqueo:

| Valor QDN | Interpretación |
|---|---|
| `No Registra` (también `0`, `Ninguno`, vacío) | Sin bloqueo |
| `4` | **Bloqueo activo** |
| `5` | Bloqueo **histórico** (no activo hoy) |
| Otro valor | Se muestra crudo, **no** se cuenta como activo |

Se evalúan bloqueos **nacionales** (entrantes, salientes, SMS, identificador, LDI total / otros indicativos / 444 / sin implementación, video llamada), **de datos** (GPRS, SGSN, redes de otros operadores), **de roaming** (barring general, entrantes, salientes, desvíos, otros operadores) y **de VLR** (voz, SMS, fax, datos asíncronos/síncronos, PAD).

---

## 9. Tabla y detalle

Columnas: **MSISDN, Estado, IMSI, IMEI, 5G, Telefonía, SMS, Datos, Roaming, Bloqueos, Desvío, APN, IP, Portabilidad, Detalle (👁)**.

El modal organiza el response en las 10 categorías de la HU — Identidad, Servicios, Bloqueos, Datos/Internet, Roaming, Desvíos, VLR/MSC, VoLTE, Portabilidad y COTA — más **Información técnica** (`responseCode`, `messageCode`, `message`, `legacy`, `transactionId`, `timestamp`, `startOperatingDate`, intentos, duración) y el **JSON original**.

> El parser **no asume que `name` es único**: conserva cada característica con su `name`, `friendly_name` y `value`, porque el response repite nombres con significados distintos (p. ej. `UDC_SRVBSVOZ-csiState`, `TITAN_SRVVOLTE-order`).

---

## 10. Filtros, KPIs y exportación

- **Tarjetas (filtran al hacer clic)**: Activas · Inactivas · Con bloqueos · **Revisar respuesta** · Errores/timeout.
- **Filtros**: Estado, Bloqueos, 5G, Roaming; mostrar/ocultar columnas.
- **Exportación** CSV / Excel / JSON de lo que quede a la vista, con columna **Observaciones** para que los avisos de inconsistencia no se pierdan.

---

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
| Bloqueo total | Bloqueo TOTAL | `lockall` · `level=2` | **Doble** |
| Bloqueo total | Desbloqueo TOTAL | `unlockall` | Simple |
| Bloqueos individuales | Bloquear / desbloquear llamada ENTRANTE | `blqinccl` · `activate`/`deactivate` | **Doble** / simple |
| Bloqueos individuales | Bloquear / desbloquear llamada SALIENTE | `blqoutcl` · `activate`/`deactivate` | **Doble** / simple |
| Bloqueos individuales | Bloquear / desbloquear SMS ENTRANTE | `blqincsms` · `activate`/`deactivate` | **Doble** / simple |
| Bloqueos individuales | Bloquear / desbloquear SMS SALIENTE | `blqoutsms` · `activate`/`deactivate` | **Doble** / simple |
| Bloqueos individuales | Bloquear / desbloquear larga distancia (LDI) | `blqldi` · `activate`/`deactivate` | **Doble** / simple |
| Roaming | Activar / desactivar ROAMING | `roaming` · `activate`/`deactivate` · `features=roaming` | Simple / **doble** |
| Procesos | Conciliación de línea | `conciliation` | **Doble** |
| **Riesgo alto** | Cambio de SIM (IMSI / ICCID / KI) | `change_imsi` | **Doble** |
| **Riesgo alto** | Cambio de MSISDN | `change_msisdn` | **Doble** |

**Doble confirmación** = revisar (líneas, datos y cuerpo que se envía) → *"¿seguro?"*. La piden las que **restringen** el servicio, la conciliación y las dos de **riesgo alto**; desbloquear pide una sola. Desactivar roaming cuenta como bloqueo.

`features` **nunca** viaja como `""`: vacío se envía como `" "`, igual que en `interfaz.py`. Desde v2.1 también viaja en **todas** las operaciones (no solo roaming): ver §11.5.

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

> El usuario queda **en la herramienta, no en el payload**: `ModifingService` no define un campo de nota y no se inventa uno. El token de QDN es de servicio (`client_credentials MOVILEXITO`) y no identifica a nadie, por eso la trazabilidad de la persona es local.

**Un timeout NO se reintenta**: la operación pudo haberse aplicado y repetirla la duplicaría. Se reporta como tal para verificar con una consulta antes de repetir.

**Un error de conexión (`conn-err`) sí se reintenta**, hasta 2 veces adicionales con espera creciente (600 ms × intento) — es el caso, frecuente en lotes grandes con muchas peticiones seguidas, en el que el gateway cierra o resetea la conexión **antes de que exista ninguna respuesta** (por ejemplo `Connection aborted / Remote end closed connection without response`): ahí no hay forma de que el servicio la haya procesado, así que reintentar es seguro. Si los reintentos también fallan, se reporta como `conn-err` con el detalle de cuántos intentos se hicieron. La diferencia con el timeout de arriba es esa: **timeout** hubo conexión y se agotó esperando la respuesta (pudo procesarse); **`conn-err`** nunca hubo respuesta (no pudo procesarse).

### 11.5 Riesgo alto: cambio de IMSI/ICCID/KI y cambio de MSISDN

Estas dos operaciones cambian **identificadores propios de la línea**, no una restricción reversible con un clic — un dato nuevo incorrecto puede dejarla sin servicio. Por eso, además de la doble confirmación:

- Se muestran **antes → después** de cada campo que cambia, en la propia tabla de confirmación (no hay que adivinar qué va a quedar).
- Como el servicio es un **PATCH**, no hace falta llenar todos los campos: solo el valor nuevo del dato que de verdad cambia. `change_imsi` solo exige el **IMSI nuevo**; ICCID y KI nuevos son opcionales. `change_msisdn` solo exige el **MSISDN nuevo**.
- **El ICCID nuevo se deriva igual que el actual**: si se escribe un IMSI nuevo y no se escribe un ICCID nuevo, se calcula solo como `8957 + IMSI nuevo` — mismo criterio que el ICCID actual (§11.2). Si el ICCID (actual o nuevo) **no empieza por `8957`**, se avisa en pantalla — **nunca se corrige solo**.
- `change_msisdn` también manda `portation_status`. No hay documentación propia de este campo: se deja editable con `"0"` de partida, que es el único valor visto en un ejemplo real. Revísalo antes de confirmar si el caso lo amerita.

Ejemplo real de `change_imsi` (cambia IMSI, ICCID y KI a la vez — un cambio de SIM típico):

```json
{
  "process": "change_imsi", "relatedParty": [...], "tier": "prepaid",
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
  "process": "change_msisdn", "relatedParty": [...], "tier": "prepaid",
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

**Quién lo ve.** Solo aparece el grupo «Aprovisionamiento» si se cumplen las dos cosas: (1) hay **sesión del CM vigente** en la cabecera —es el login de Keycloak el que dice quién es el usuario— y (2) ese usuario está en `USUARIOS_PROVISION` (`logica-qdn-operaciones.js`; hoy: `jpelaezg`). Para autorizar a alguien más se agrega ahí. En cuanto la sesión del CM vence o se cierra, el grupo desaparece; al entrar, aparece (los menús se vuelven a pintar con cada cambio de sesión). Es una **guarda de interfaz** para que nadie lo ejecute por accidente, no un control de acceso del servicio: el token de Claro es el mismo para todos.

**Línea que no existe.** Una línea que el QDN responde con **404** no se puede bloquear ni conciliar (no hay nada que tocar)… pero sí **aprovisionar**: es exactamente el caso. Para esa línea el QDN no tiene IMSI/ICCID/KI, así que tienen que venir del archivo (columnas `imsi`, `iccid`, `ki`) o escribirse en el formulario. El detalle de una línea 404 ahora sí pinta el bloque de operaciones (antes se quedaba con el de la línea anterior).

**KI.** Confirmado en PDN con la prueba individual (2026-09-17, línea 3332949603): el `DELETE` no la necesita y el `POST` **sin `ki` responde 400**. Por eso en «Aprovisionar» la KI es campo obligatorio (el botón no se habilita sin ella) y el QDN nunca la da: viene de la columna `ki` del archivo o se escribe en el formulario.

**Qué deja el DELETE.** También confirmado: tras el `DELETE` la línea **no desaparece** del HLR/HSS, queda `inactive` en el QDN (no 404). Es decir, el ciclo normal es `active → DELETE → inactive → POST → active`; el caso 404 (línea que nunca existió) es el otro origen posible del POST, no el habitual.

Doble confirmación, bitácora, verificación posterior con QDN: igual que las demás.

**Masivo, pero solo sobre lo marcado.** Ya validado el comportamiento en PDN (§ KI y § DELETE más arriba), **Aprovisionar** y **Conciliación** se ofrecen también en el menú masivo del dropdown «Operaciones» — pero no sobre "todo lo que pasó el filtro", como bloqueos y desbloqueos: crear o conciliar líneas de producción a partir de un archivo pide una selección explícita, fila por fila. Para eso la tabla tiene una **columna de checkbox** al frente (marca de a una, o toda la página visible con la casilla de la cabecera — `chk-todas` solo marca/desmarca lo que pasa los filtros puestos en ese momento) y un filtro nuevo **`#fSel`** ("Marcadas: todas" / "Solo marcadas" / "Solo sin marcar") para revisar la selección antes de lanzar la operación. El ítem del menú lo indica con un `(marcadas)` al lado del nombre, y el hint del dropdown muestra el conteo de marcadas por separado del conteo de visibles por filtro. El resto del flujo -listado previo, doble confirmación, campos obligatorios, bitácora, reconsulta- no cambia: solo cambia de dónde sale la lista de MSISDN objetivo. **Desaprovisionar (DELETE)** se queda **fuera** del menú masivo: es la operación más destructiva del catálogo y sigue siendo línea por línea.

## 12. Riesgos y límites

- **Ambiente productivo**: las consultas son de solo lectura, pero golpean PDN.
- **Las operaciones de §11 escriben en producción y no se deshacen solas.** La doble confirmación y el listado previo de líneas son la única red de seguridad: no hay "deshacer".
- **Cambio de IMSI/ICCID/KI y de MSISDN (§11.5) son las de mayor consecuencia de toda la herramienta**: cambian un identificador propio de la línea, y un dato nuevo incorrecto puede dejarla sin servicio. Pruébalas primero sobre una línea de bajo riesgo antes de confiar en ellas para un caso real.
- **`portation_status` no tiene documentación propia** (§11.5): el valor por defecto (`"0"`) sale del único ejemplo real disponible, no de una especificación confirmada.
- **La traducción de bloqueos activos a `features` (§11.6) es best-effort**, igual que la interpretación de bloqueos de la consulta (§8): lo que no se puede traducir con confianza se avisa, no se adivina.
- **Masivo**: en bloqueos y desbloqueos el alcance lo define el filtro puesto en ese momento; en Conciliación y Aprovisionar lo define lo **marcado con checkbox** (§11.8). Revisa siempre el listado de la confirmación, no el número.
- **Distribución**: los archivos se descargan y ejecutan **localmente en los PC administrados de backoffice**, no se publican en un servidor. Bajo ese modelo las credenciales viajan en el archivo por diseño, igual que `interfaz.py` y el lanzador. Solo habría que moverlas a un proxy si algún día la herramienta se publicara en un servidor accesible fuera del equipo.
- **CORS**: si se abre con doble clic (`file://`) el navegador puede bloquear las llamadas. Abrir siempre desde `dame click.bat`.
- **Interpretación de códigos no documentados**: valores distintos de `4`/`5` se muestran crudos y **no** se cuentan como bloqueo activo, a propósito.
- **Volumen**: `tiempo ≈ líneas ÷ concurrencia × ~3 s`. Con volúmenes muy grandes conviene exportar a CSV en vez de Excel.

---

## 13. Historial de cambios

| Versión | Cambios |
|---|---|
| **3.3** | **Reintentos por error de conexión en las operaciones** (§11.4): un lote grande con muchas peticiones seguidas puede hacer que el gateway cierre/resetee la conexión antes de dar respuesta (`Connection aborted / Remote end closed connection without response`, reportado como `conn-err`); ahora eso se reintenta solo, hasta 2 veces con espera creciente (600 ms × intento), porque nunca hubo respuesta y no hay riesgo de duplicar la operación. El **timeout** (sí hubo conexión, se agotó esperando respuesta) sigue sin reintentarse solo, por el riesgo de duplicar. |
| 3.2 | **Aprovisionar y Conciliación en masivo** (§11.8): ya no son solo por línea. Se agrega una **columna de checkbox** al frente de la tabla (marcar de a una o toda la página visible con la casilla de la cabecera, que solo afecta lo que pasa el filtro) y un filtro **`#fSel`** ("todas" / "solo marcadas" / "solo sin marcar"). En el menú masivo, **Conciliación** y **Aprovisionar** actúan sobre lo **marcado** (no sobre todo lo filtrado, como bloqueos/desbloqueos), con un `(marcadas)` en el ítem del menú y un conteo separado en el hint. **Desaprovisionar** se queda fuera del masivo. El resto del flujo (confirmación, bitácora, reconsulta) es el mismo, ya genérico sobre una lista de MSISDN. |
| 3.1 | **Menú de operaciones reorganizado**: Procesos → SIM y número → Bloqueos plegados por familia con iconos y su par bloquear/desbloquear al lado (§11.1); modal de operación más ancho. **Texto pegado con encabezado** (§4.1): el cuadro de líneas reconoce tablas CSV/`;`/tab con la columna de la línea por nombre normalizado (msisdn, línea, celular, teléfono, número, min…) y toma `imsi`/`iccid`/`ki` si vienen, igual que un archivo. **Discrepancias contra el QDN** (§4.2): si la entrada trae IMSI/ICCID distintos a los del QDN se marca la fila, se avisa y el formulario muestra los dos valores; nada se corrige solo. |
| 3.0 | **Conciliación exige KI**: como por dentro hace un delete/post de la línea, la KI pasa de opcional a obligatoria (el botón no se habilita sin ella); viene del archivo o se escribe. **Aprovisionamiento** (§11.8): dos operaciones nuevas, `DELETE …/DeletingService` (desaprovisionar) y `POST …/provisionServiceRED` (aprovisionar), con la misma forma de cuerpo que `reset-linea-me-claro/main.py`. Solo las ve un usuario de `USUARIOS_PROVISION` (hoy `jpelaezg`) con **sesión del CM vigente**; los menús se repintan al cambiar la sesión. Una línea **404** en el QDN ahora se puede aprovisionar (y su detalle pinta el bloque de operaciones, que antes quedaba con el de la línea anterior). La KI del POST es obligatoria (probado en PDN: sin ella, 400); el DELETE no la lleva y deja la línea `inactive`, no la borra. El envío ya no está atado a PATCH: cada operación trae método y ruta. **Esc con modales anidados**: cierra el formulario de operación primero y el detalle después (antes cerraba el de atrás: las trampas de foco de Bootstrap se peleaban); los modales se abren con `getOrCreateInstance` (antes cada apertura apilaba otra instancia con sus listeners). Sesión del CM disponible en la pestaña Claro de HLR/HSS. |
| 2.2 | Rediseño de la **tabla de confirmación** de las operaciones (mismo cambio que en la pestaña Claro de HLR/HSS, que comparte esta lógica): ancho de columnas fijo para que el valor actual y el input dejen de encimarse, línea y estado en una sola columna, el cambio leído como **«antes / después»** en dos renglones alineados y etiquetados, encabezado fijo al hacer scroll, y la columna **Features** resumida («2 bloqueos detectados») con el detalle en el tooltip en vez de tres renglones de texto. «Se omiten» y **«Cuerpo que se envía» ahora vienen plegados**. |
| **2.1** | Dos operaciones de **riesgo alto**, solo por línea (nunca en el menú masivo): **cambio de IMSI/ICCID/KI** (`change_imsi`, PATCH parcial, ICCID nuevo derivado de `8957+IMSI nuevo` si no se escribe uno) y **cambio de MSISDN** (`change_msisdn`, incluye `portation_status`). Ambas muestran antes → después de cada campo y piden doble confirmación. Además, `features` deja de ser fijo (solo roaming) y pasa a **detectar los bloqueos activos de la línea y pre-llenarlos, editables, en todas las operaciones** (§11.6), para no perderlos al ejecutar algo que no es sobre ellos. Se agrega un campo **Nota** (opcional) al PATCH, que siempre lleva el usuario que ejecuta. La bitácora suma columnas para los valores nuevos y la nota. Se agrega también **bloqueo/desbloqueo de larga distancia** (`blqldi`), con el mismo patrón que los demás bloqueos individuales. |
| 2.0 | La herramienta deja de ser solo de lectura: **operaciones de bloqueo, desbloqueo y conciliación** sobre `ModifingService` (§11), individuales desde el modal y masivas sobre lo filtrado, con doble confirmación en bloqueo y conciliación, listado previo de todas las líneas afectadas, campos IMSI/ICCID/KI pedibles y editables (archivo, QDN o `ICCID = 8957 + IMSI`), reconsulta de verificación y bitácora con el usuario que ejecutó. |
| 1.1 | Éxito real evaluado sobre el cuerpo (`evaluar_negocio`), estado `INCONSISTENTE` por respuesta que no corresponde a la línea, fin de los valores inventados (`—` vs `No Registra`), `Sin datos` en bloqueos no evaluados, coherencia Roaming ⇄ Bloqueos, KPIs por estado real y columna Observaciones en la exportación. |
| 1.0 | Versión inicial sobre la HU: consulta individual y masiva, concurrencia 8, reintentos por timeout, tabla de 15 columnas, detalle por categorías y JSON original. |
