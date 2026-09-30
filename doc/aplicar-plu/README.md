# Aplicar PLU de paquete — Documentación técnica

> **Versión: v1.5.0** · Convención de versionado: *Major.Minor.Patch* · fix/documentación incrementa **Patch**.
> Base compartida: ver `doc/lanzador/README.md`.

Aplica un **PLU de paquete** sobre una línea prepagada llamando a `RecargaPaquete` en **Tulio**, y después verifica **contra el CM** qué quedó: por cada paquete nuevo o con saldo sumado muestra el **total**, el **valor anterior** y **cuánto se sumó**.

Es el porte de la operación «Agregar PLU» de la consola local `consola_bundles_movil_exito`, que corría con un servidor Python. **Aquí no hay Python**: solo HTML, JS y CSS, como el resto de la suite.

> **Escribe en producción.** La recarga suma saldo real a la línea. Está limitada a usuarios autorizados y pide doble confirmación, línea por línea.

---

## 1. Objetivos

- Aplicar un PLU a una línea **sin pasar por la consola local** ni por un servidor propio.
- **Probar qué hizo el PLU**: no basta con que Tulio responda «Transacción Exitosa»; hay que ver el saldo en el CM antes y después.
- Dejar a la vista **cuánto se sumó**, que es el dato que se viene a comprobar.
- No dejar que una **cuenta equivocada** llegue a una operación de escritura (ver §6).

Trabaja en **secuencia**: una línea y varios PLU, uno detrás de otro, agregando y eliminando los bolsillos de cada uno (§7).

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/aplicar_plu.html` | Marcado. Sin lógica. |
| `assets/logica-plu.js` | Cuenta de la línea, paquetes, token y recarga en Tulio, comparación antes/después. |
| `assets/me-plu-puente.js` | Sesión del CM, credenciales de Tulio, tabla, modal, doble confirmación y exportaciones. |

Comparte con las demás herramientas: `me-ui.js` (marco, sesión, tablas, exportación) y `me-api.js` (Keycloak y GET autenticado al CM).

---

## 3. Herramientas de terceros

Bootstrap 5.3.3, Bootstrap Icons 1.11.3, DataTables 2.3.2, SheetJS 0.18.5 y jQuery 3.7.1, todas por CDN — las mismas versiones que el resto de la suite.

---

## 4. Endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `{apiBase}/api/v1/subscribers?msisdnList&offset&limit` | Resuelve la línea y **sus cuentas**. Paginado. |
| `GET` | `{apiBase}/api/v1/billingAccount?externalID&offset&limit=10` | Cuenta en el CRM del CM: titular y, sobre todo, **si la cuenta existe** (§6). |
| `GET` | `{apiBase}/api/v1/subscription/bundleBalance?subscriptionID` | Paquetes activos (`status=0`) con sus saldos. |
| `POST` | `https://tulio.grupo-exito.com/identity/connect/token` | Token de Tulio, grant `client_credentials`, cuerpo **multipart**. |
| `POST` | `https://tulio.grupo-exito.com/apimew/api/v1/MFYGS4TFMNQQ/Recarga/RecargaPaquete` | **La recarga.** Bearer + `X-Api-Key`. |

`{apiBase}` es el del CM y vive en `me-api.js`, compartido con las otras herramientas.

**Por qué funciona sin servidor.** La consola usaba Python para evitar CORS, pero esta suite ya llama a `tulio.grupo-exito.com` desde el navegador en Prepagadas (`simeBase`) y a `tulioqa.grupo-exito.com` en las herramientas de HLR: el gateway acepta peticiones del navegador.

**Multipart sin fijar `Content-Type`.** El token se pide con `FormData`, y el navegador pone el `boundary` solo. Si se fijara `Content-Type: multipart/form-data` a mano, el boundary faltaría y Tulio responde 400.

### Cuerpo de la recarga

Misma forma exacta que armaba el servidor Python:

```json
{
  "cabeceraEntrada": {
    "uuid": "…", "idAplicacion": "API_MOVIL_EXITO", "fechaTransaccion": "…",
    "host": "1.1.1.1", "usuario": "<usuario del CM>",
    "objetoNegocio": "test", "operacion": "RecargaPaquete"
  },
  "DatosEntradaRecargaPaquete": {
    "idTransaccion": "…", "canalVenta": "PPrepagadaTP", "lineaTelefonica": "3332949603",
    "pluPaquete": "10021", "costoPaquete": 0, "fechaSolicitud": "…"
  }
}
```

`host` y `objetoNegocio` van con los valores del ejemplo recibido (`1.1.1.1` y `test`): **no están confirmados** con el equipo de API. `usuario` es el del login del CM, así queda registrado quién recargó.

### Qué se considera una recarga exitosa

El HTTP 200 **no** basta. Tulio marca el resultado en el cuerpo y tienen que venir los dos en `"000"`:

- `cabeceraSalida.estado.estado`
- `datosSalida.estado`

Si alguno difiere, se reporta la descripción de Tulio como falla. Un **401** renueva el token y repite **una** vez. Un **timeout no se reintenta**: la recarga pudo haberse aplicado y repetirla sumaría dos veces.

---

## 5. Credenciales de Tulio

Están en `logica-plu.js` (`TULIO_CRED`: `api_key`, `client_id`, `client_secret`, `scope`), igual que el `client_secret` del QDN en `logica-qdn.js`: la herramienta funciona sin pedirle nada al analista. Salieron del `tulio_credentials.json` que acompañaba al servidor de la consola y **cuando roten se cambian ahí**.

> **Cuidado al repartir.** Con esas credenciales se puede pedir un token y recargar **cualquier** línea, y el archivo viaja a todas las máquinas que tengan la suite. La carpeta y el ZIP van en un lugar de acceso restringido. La guarda de `USUARIO_AGREGAR_PLU` evita recargas por accidente desde la interfaz, pero no impide que alguien con el archivo llame al servicio por fuera.

## 6. Elección de la cuenta de la línea (y el error 500 al eliminar)

Una línea puede tener **varias suscripciones** en el CM: normalmente una activa y el resto desactivadas. Se aplica el mismo criterio que Prepagadas y «Bolsillos, paquetes y consumos»: **la activa más reciente** y, si ninguna está activa, la última creada. A diferencia de la consola, **las demás no se esconden**: se listan en el detalle de la línea y quedan en el registro, con un aviso aparte si hubiera más de una activa.

Además se descarta lo que no sea exactamente esa línea: el servicio filtra por `msisdnList`, pero se compara `profile.mobileNumber` para no quedarse con el vecino de página.

### El defecto que hacía fallar la eliminación

Síntoma reportado: para la línea `3332917510` (cuenta activa `41041232645`, con otra cuenta `41021951844`) la operación terminaba consultando **una cuenta que no aparecía entre las de la línea** y el CM respondía **500** al eliminar paquetes.

Causa: `billingAccount?externalID=<X>` **no es una consulta de igualdad**. El mismo parámetro admite un filtro compuesto por `%3B` sobre varios campos, así que puede devolver **otra** cuenta parecida. El código compartido de la suite (`buscarBillingAccount()` en `logica-consumos.js` y `logica-rechazo.js`) pedía `limit=1` y tomaba `lista[0]` **a ciegas**: con eso se acababa operando sobre una cuenta ajena, que es justo lo que el CM rechaza al crear la orden.

Corrección aplicada en los tres sitios (esta herramienta, Consumos y Rechazo):

1. Se pide **`limit=10`**, no 1: con 1 no se puede ni ver si había una mejor.
2. Se acepta **solo** la cuenta cuyo `externalID` (o `id`, para las relaciones entre cuentas) sea **exactamente** el pedido.
3. Si ninguna coincide, se devuelve «no encontrada» **y se avisa con las que sí devolvió** — nunca se sigue con una cuenta ajena.

El tercer camino de `buscarBillingAccount()` (GET `billingAccount/{id}`) se deja como estaba: ahí la ruta ya identifica el recurso y no hay ambigüedad que validar.

En esta herramienta, si la cuenta no existe en el CRM la línea **se puede consultar igual** pero queda marcada con ⚠ y el motivo, porque es la línea que va a fallar cuando se intente operar.

---

## 7. Funcionalidad

### Tarjetas resumen

Líneas consultadas · PLU aplicados · Paquetes nuevos o con saldo sumado · Recargas fallidas.

### Paso 1 · Conexión con el CM

La sesión del CM hace dos cosas: consultar la línea **y decir quién eres**. Credenciales compartidas con las demás herramientas: si ya se inició sesión en otra pestaña, llegan solas. Debajo, plegado, el bloque de credenciales de Tulio (§5).

### Paso 2 · Líneas

Hasta **50** por consulta, separadas por espacio, coma, `;` o salto de línea (`MEUI.parseLineas`, que deduplica y quita el `57` del indicativo). Enter consulta.

### Paso 3 · Secuencia de PLU

**Una línea** y **los PLU que se le van a aplicar, uno detrás de otro**. Cada fila es un PLU con su propio costo y canal de venta (`0` y `PPrepagadaTP` por defecto).

Atajos, pensados para escribir muchos PLU seguidos:

| Tecla | Qué hace |
| --- | --- |
| **Enter** | Agrega otra fila debajo y salta a ella. Si ya existe la de abajo, salta a esa. |
| **Tab** | Pasa al campo siguiente **y selecciona su contenido**, para sobrescribirlo sin borrar a mano (costo y canal casi siempre se reemplazan). En el último campo salta a la fila siguiente, creándola si hace falta. |
| **Shift+Tab** | No se intercepta: retrocede como siempre. |
| **Pegar** | En el campo de PLU también funciona el pegado desde Excel, pero para listas está el cuadro de texto de arriba. |

Arriba del formulario hay un **cuadro de texto que acepta la lista tal cual venga**, un PLU por renglón: `PLU costo canal` separados por **espacio, tabulación, coma, `;` o `|`**. Con solo el PLU se usan el costo y el canal por defecto, y si el primer renglón es un encabezado (`plu,costo,canal`) se salta — pero solo si la primera columna se llama de verdad `plu`, para que un PLU mal escrito no se trague como encabezado.

```
10021 0 PPrepagadaTP
10020 0 PPrepagadaTP
```

Lo pegado y lo escrito fila a fila **se suman**, en ese orden. Debajo, una **vista previa** muestra cómo se interpretó cada renglón y bloquea la ejecución si alguno tiene error.

El botón **×** quita una fila y siempre deja al menos una. Debajo se ve cuántos PLU quedaron válidos y, si alguno tiene error, cuál es.

Si el usuario no está autorizado, este paso se reemplaza por un aviso de **solo consulta**: la línea y sus paquetes sí se pueden ver.

### Qué hace la secuencia por cada PLU

1. **Consultar el estado actual** de la línea y sus bolsillos.
2. **Aplicar el PLU** en Tulio (`RecargaPaquete`) — agrega los bolsillos.
3. **Esperar a que el CM lo muestre** y anotar **qué entró y cuánto** (§8).
4. **Eliminar los bolsillos de ese PLU** con una orden `ChangeOffer` del CM (§9).
5. **Verificar** que ya no estén.
6. Si hay más PLU, **repetir** con el siguiente.

**Un PLU a la vez, en el orden de la lista.** Dos PLU simultáneos sobre la misma línea mezclarían la evidencia y la eliminación de uno se llevaría los bolsillos del otro.

**Doble confirmación** antes de arrancar: el primer clic arma el botón (que pasa a decir cuántos PLU y a qué línea) y el segundo ejecuta. Durante la corrida aparece **«Detener al terminar el PLU actual»**: no corta a mitad de un PLU —eso dejaría bolsillos a medio camino—, termina el que está y para; los pendientes quedan como *Cancelado*.

**Un PLU que falla no detiene la secuencia**: se registra con su motivo y sigue el siguiente, como en la consola. Detenerla es decisión del analista.

**Barra de avance por etapas.** El título de cada PLU lleva una barra partida en sus cinco etapas —**Consultar · Aplicar PLU · Evidencia · Eliminar · Verificar**— con el rótulo `3/5 · Evidencia`. Cada aviso dice en qué etapa va: las pasadas quedan en verde y la actual se llena en azul según su propio avance (las esperas al CM por intento, «Esperando al CM (6/15)» = 40 %; la eliminación por cada uno de sus pasos internos). Al terminar, todo en verde si salió bien; si no, el tramo donde se detuvo queda en rojo (error), ámbar (novedad) o gris (cancelado). El título del panel tiene otra barra igual, pero con un tramo por PLU: `2/4 PLU`.

**Bolsillos plegables.** Los cuadros de cada PLU vienen **plegados**: el resumen dice cuántos bolsillos entraron y cuánto sumó cada uno (`2 bolsillos · 578 +1 GB · 394 +16 min`), y avisa en rojo si alguno siguió activo tras la eliminación. Al abrirlo se ven los cuadros completos. Lo que se abre se mantiene abierto aunque la lista se repinte con cada aviso.

Cada PLU se ve en su propio renglón con su estado (*En cola · En curso · Correcto · Con novedad · Error · Cancelado*), el paso en curso, el detalle y los cuadros de lo que sumó. **Evidencia Excel** descarga `evidencias_plu_AAAAMMDD_HHMM.xlsx` con **el mismo formato que la consola**: hoja **Resumen** (una fila por PLU: estado, paso con falla, respuesta de Tulio, paquetes activados, eliminados y no eliminables, orden de eliminación y paquetes remanentes) y **una hoja por PLU** (`01 PLU 10021`…) con los bloques *paquetes activados por el PLU* (con el asignado antes), *eliminados* (valores al momento de eliminar), *no eliminables*, *activos por fase* (consulta inicial / tras aplicar / tras eliminar) y el **request/response** de Tulio (`RecargaPaquete`) y del CM (`shoppingCart`, `productOrder` y la orden final con su historial), también cuando la llamada falla. Mismas columnas y anchos que la consola; datos en kb y voz en minutos. Las cabeceras con token o API key no se guardan.

El botón **Evidencia CSV** sigue descargando el CSV de la secuencia: una fila por bolsillo con total, valor anterior, valor agregado, la orden de eliminación, su estado y si el bolsillo siguió activo.

### Tabla y detalle

La tabla de arriba es la consulta masiva (hasta 50 líneas) para revisar antes de operar. Desde el detalle de una línea, **«Usar esta línea en la secuencia»** la lleva al paso 3.

### Eliminar paquetes sin aplicar PLU

Después de consultar, cada fila trae un botón **🗑** y el detalle un **«Eliminar paquetes»**: la misma orden `ChangeOffer` de la secuencia (§9), a demanda, para limpiar la línea sin recargar nada. Pide confirmación recordando que la orden del CM **elimina todos los paquetes opcionales habilitados**, no solo los de un PLU, y al terminar vuelve a consultar para mostrar lo que quedó. El botón se deshabilita cuando la línea no tiene nada eliminable. Solo aparece para usuarios autorizados.

### Esperar a que el CM refleje el cambio

Tras la recarga el CM tarda en mostrarla. Se relee hasta que la **huella** de los paquetes cambie respecto a la de antes **y se repita en dos lecturas seguidas** (ya está estable), hasta 15 intentos cada 2 s. Sin esa segunda lectura se puede fotografiar el momento en que el CM ya cargó un paquete pero todavía no el otro.

La huella es `bundleId:asignado` de cada paquete, no solo la lista de IDs: cuando el PLU solo **suma saldo** a un paquete que ya estaba, la lista de IDs no cambia y esperar por ella no terminaría nunca.

Si se agotan los intentos se muestra la última lectura avisando que el CM no dio un resultado estable.

### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV): una fila por cada paquete que cambió, con total, valor anterior, valor agregado y unidad, más el resultado de Tulio. Si una recarga no produjo cambios, queda una fila con el motivo.

---

## 8. El cuadro de «cuánto se sumó»

Un PLU puede dejar un paquete **nuevo** o **sumarle saldo** a uno que ya estaba. En los dos casos se muestra el mismo trío, en un solo cuadro y uno debajo del otro:

| Fila | Qué es |
| --- | --- |
| **Total** | Lo que quedó asignado después. |
| **Valor anterior** | Lo que tenía antes (`0` si el paquete es nuevo). |
| **Valor agregado / nuevo** | La diferencia. **Es la fila resaltada**: es el dato que se viene a comprobar. |

La comparación es sobre el **asignado** (`personalLimit + groupLimit`), no sobre el disponible: el disponible baja solo con el consumo y no serviría para probar qué cargó el PLU.

**Unidades.** Datos en **kb** (valor ÷ 1024) y voz en **minutos** (valor ÷ 60), igual que la consola y que la tabla del CM, para poder cruzar el número con lo que se ve en pantalla. Como en kb un giga son siete dígitos, en datos se añade el equivalente entre paréntesis: `+1.048.576 kb (1 GB)`.

Cuando Tulio confirma la recarga pero el CM no muestra ningún paquete nuevo ni saldo sumado, se avisa explícitamente y **no** se marca como éxito silencioso: puede ser que el CM aún no lo refleje o que el PLU no cargara nada, y repetirlo a ciegas sumaría doble.

---

## 9. Eliminar los bolsillos (orden ChangeOffer)

El CM no tiene un «borrar paquete». Hay que armar un **carrito** con *todos* los productos del plan, marcar cada uno con su acción, y convertir ese carrito en una **orden**:

| Acción | A qué productos |
| --- | --- |
| `NO_CHANGE` | Los tres servicios base del plan (voz, datos, SMS) y los paquetes **no eliminables**. |
| `DELETE` | El resto de los paquetes opcionales habilitados. |

Secuencia de llamadas, igual que la del servidor de la consola:

1. `GET /subscriptionProfile` → plan, `enabledOptionalBundles` e ICCID.
2. `GET /productOffering?offeringType=PRICE_PLAN&primaryPricePlanId=…` → tiene que devolver **exactamente uno**.
3. `POST /productOffering/{id}/selectableProducts` con `PROD_COMP_TPS` → servicios base.
4. `POST /productOffering/{id}/selectableProducts` con `PROD_COMP_BDLE` → productos de cada paquete.
5. `POST /shoppingCart` → carrito con `itemGroupId` de cuatro dígitos, consistente con `<grupo>_MSISDN` y `<grupo>_ICCID` de `userData`.
6. `POST /productOrder` (`type: ChangeOffer`, cabecera `Transaction-Id`).
7. `GET /productOrder?customerBan=…` hasta `Order Fulfilled` / `Order Failed`, máximo 30 s.
8. `DELETE /shoppingCart/{id}` para no dejar el carrito colgado (que falle no cambia el resultado: la orden ya se envió).

Antes de armar nada se comprueba que **los paquetes no hayan cambiado** desde la consulta; si cambiaron, no se opera a ciegas.

### Productos dependientes (`ERCRT1002`)

El CM valida que el carrito lleve los productos **dependientes** de los que se mandan. Cuando falta alguno rechaza el carrito con un 500 y, afortunadamente, dice cuál:

```
ERCRT1002 · Failed to create shopping cart.
detail: "Missing dependent product null having product id:10185"
```

Pasaba porque al carrito solo entraban los paquetes de `enabledOptionalBundles`: un producto del plan del que estos dependan nunca se incluía. Es exactamente el caso que la consola avisaba como **no demostrado** («no se ha demostrado que un lote con todos los paquetes opcionales vaya a completarse»).

`crearCarrito()` ahora lee ese id del mensaje, **agrega el producto con `NO_CHANGE`** —se declara para satisfacer la dependencia, no se toca— y reintenta, hasta `MAX_DEPENDENCIAS` (10). Cada producto agregado queda en el registro con lo que se sabe de él (a qué paquete corresponde, si el CM lo marca como no opcional).

Dos cortes para no girar en vacío:

- Si el CM vuelve a pedir un producto que **ya va** en el carrito, no se insiste: el mensaje apunta a otra cosa y se dice así, nombrando el producto.
- Si tras 10 dependencias sigue pidiendo más, se corta listando las que se agregaron.

Cuando el carrito no se puede crear, el registro imprime además el **inventario de productos que el CM listó para el plan** (base y opcionales, con su `bundleId`): es lo que hace falta para entender un `ERCRT1002` que no se resolvió solo.

### Paquetes que el CM no deja eliminar

`NO_ELIMINABLES` en `logica-plu.js` (era `paquetes_no_eliminables.json`) lista los paquetes que el CM **reporta como habilitados pero rechaza** al darlos de baja, con `Specified bundle is not Enabled of the subscriber`. Una sola opción rechazada hace fallar **toda** la orden y el CM no indica cuál fue, así que se excluyen de entrada y se marcan como «no eliminable».

Caso confirmado: **394 Promo 1x1 minutos 2 dias**, que el CM otorga como promoción al recargar (la orden SOI7854736 falló al incluirlo; SOI7854750, idéntica sin él, se cumplió). El paquete técnico **205** va como obligatorio del plan. Para agregar otro caso basta con añadir su ID y el motivo.

Si tras excluirlos no queda nada que borrar, no se envía la orden y se dice por qué.

---

## 10. Riesgos y límites

- **Escribe en producción.** La recarga suma saldo real y no se deshace desde aquí.
- **Credenciales de Tulio en el navegador.** Aunque no están en el código, quedan en el almacenamiento local de la máquina donde se peguen. `localStorage` no es un almacén seguro (mismo criterio que el resto de la suite). Quien tenga esas credenciales puede recargar cualquier línea.
- **Guarda de interfaz, no control de acceso.** `USUARIO_AGREGAR_PLU` evita recargas por accidente, pero la API key de Tulio es la misma para todos: quien la tenga puede llamar al servicio por fuera de la herramienta.
- **`host` y `objetoNegocio` sin confirmar** (`1.1.1.1`, `test`): vienen del ejemplo recibido y falta validarlos con el equipo de API.
- **Timeout de la recarga: no se reintenta.** Si Tulio no responde, hay que verificar los paquetes de la línea antes de repetir, para no sumar dos veces.
- **Un PLU a la vez por línea.** No hay ejecución masiva: la evidencia de dos recargas simultáneas sobre la misma línea se mezclaría.
- **La eliminación borra TODOS los paquetes opcionales habilitados**, no solo los del PLU: así funciona la orden `ChangeOffer` del CM, que se arma con el plan completo. Es el mismo comportamiento de la consola. Los servicios base del plan y los no eliminables se mandan como `NO_CHANGE`.
- **Una orden aceptada no es una orden aplicada.** Se sigue hasta `Order Fulfilled` / `Order Failed` (30 s); si no da estado final queda `Order Pending` y se avisa. Un solo paquete rechazado hace fallar toda la orden y el CM no dice cuál: por eso los conocidos se excluyen de entrada (§9).
- **Credenciales de Tulio en el código** (§5): con el archivo se puede recargar cualquier línea.
- **Depende de CDNs externos.** Sin ellos la página no carga, igual que las demás.

---

## 11. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **1.5.0** | **Evidencia en Excel con el formato de la consola**: `evidencias_plu_AAAAMMDD_HHMM.xlsx` con hoja Resumen y una hoja por PLU (activados con el asignado antes, eliminados, no eliminables, activos por fase y request/response de Tulio y del CM). Para eso la eliminación ahora **guarda la petición y la respuesta** del carrito, de la orden y la orden final, incluso cuando fallan. Se mantiene el CSV. |
| 1.4.0 | **Barra de avance por etapas** en el título de cada PLU de la secuencia (Consultar · Aplicar PLU · Evidencia · Eliminar · Verificar), que avanza con cada aviso —incluidos los intentos de espera al CM y los pasos internos de la eliminación— y marca en rojo, ámbar o gris dónde se detuvo; y otra en el título del panel con un tramo por PLU. Los **bolsillos de cada PLU pasan a ser plegables**, cerrados por defecto, con un resumen de cuánto sumó cada uno, y conservan su estado abierto entre repintados. |
| 1.3.0 | **Resuelve el `ERCRT1002` del CM al crear el carrito** («Missing dependent product … product id:N», que dejaba la eliminación en 500 — caso real: línea 3332917510, producto 10185). El carrito solo llevaba los paquetes de `enabledOptionalBundles`, así que los productos del plan de los que estos dependen nunca entraban. Ahora se lee el id del propio mensaje del CM, se agrega ese producto como `NO_CHANGE` y se reintenta (hasta 10), con corte si el CM pide uno que ya va incluido o si sigue pidiendo más. Al fallar, el registro imprime el inventario de productos del plan para poder diagnosticarlo (§9). |
| 1.2.0 | Corrige que el botón **Consultar se quedaba con el spinner** girando: `MEUI.autoSpinner` libera el botón cuando la herramienta le pone `disabled = false`, y el manejador no lo hacía — ahora lo hace en un `finally` y en cada salida temprana. Se agrega **eliminar paquetes sin aplicar PLU** (botón 🗑 en la fila y «Eliminar paquetes» en el detalle), que faltaba tras la consulta. El paso 3 suma un **cuadro de texto genérico** para pegar la lista de PLU en cualquier separador (espacio, tabulación, coma, `;`, `\|`), con costo y canal por defecto si solo va el PLU, encabezado opcional y **vista previa** de cómo quedó interpretada cada fila. |
| 1.1.0 | **Secuencia de PLU**: una línea y N PLU, uno detrás de otro, con el flujo completo *consultar → agregar bolsillos → verificar → eliminar bolsillos → siguiente PLU* (§7), y por tanto el porte de la orden **ChangeOffer** del CM para eliminar (§9), con los paquetes no eliminables que el CM rechaza (394, 205). Formulario de PLU con **Enter** para agregar fila, **Tab** que pasa al campo siguiente **seleccionando su contenido** y pegado desde Excel. Doble confirmación, botón «Detener al terminar el PLU actual», un renglón de estado por PLU y CSV de **Evidencia**. Las **credenciales de Tulio pasan a `logica-plu.js`** (`TULIO_CRED`): ya no se piden en el paso 1 (§5). |
| 1.0.0 | Primera versión. Porte de «Agregar PLU» de la consola local `consola_bundles_movil_exito` sin servidor Python: token `client_credentials` y `RecargaPaquete` contra Tulio desde el navegador, con el mismo cuerpo y el mismo criterio de éxito (`estado` en `"000"` en cabecera y datos). Guarda por usuario (`USUARIO_AGREGAR_PLU`, hoy `jpelaezg`) con sesión del CM vigente; sin autorización la herramienta queda de solo consulta. Credenciales de Tulio **fuera del código**, pegadas por el analista y guardadas en su navegador (§5). Cuadro de **total / valor anterior / valor agregado** por cada paquete nuevo o con saldo sumado, resaltando el agregado (§8), con equivalente en MB/GB para datos. Espera a que el CM se estabilice usando una huella que incluye el asignado, para detectar también las sumas de saldo. Corrección de la **elección de cuenta** que provocaba el error 500 del CM al eliminar: `billingAccount` ahora exige coincidencia exacta de `externalID`/`id` y pide `limit=10` en vez de tomar el primer resultado con `limit=1` — aplicado también a `logica-consumos.js` y `logica-rechazo.js` (§6). |
