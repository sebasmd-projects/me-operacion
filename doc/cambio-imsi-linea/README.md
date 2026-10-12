# Cambio IMSI y línea Claro|Tigo — Documentación técnica

> **Versión: v2.0.0** · Convención de versionado: *Major.Minor.Patch* · fix/documentación incrementa **Patch**.
> Base compartida: ver `doc/lanzador/README.md`.

**Cambia en el CM, en masivo, la SIM (IMSI) o el número (MSISDN) de líneas**, en una sola herramienta con dos pestañas que comparten la sesión del CM:

- **Cambio IMSI**: un renglón por cambio, `línea;imsi_nueva`; a los marcados se les envía la orden `ChangeSim` y después se vuelve a consultar cada línea para confirmar que quedó con la SIM nueva.
- **Cambio de línea (MSISDN)**: un renglón por cambio, `línea;línea_nueva` (escritos o desde un Excel/CSV, con cualquier separador); a los marcados se les envía la orden de portabilidad `PortInExistingSubscription`.

En las dos se **validan** todos los renglones, se marcan en una tabla con casillas —mismo manejo que «Cierre masivo de casos»— y el envío exige una **nota obligatoria**.

> **Escribe en producción.** Pide sesión del CM vigente; sin ella solo se puede validar.

> **El cambio de línea es una portabilidad.** La orden que usa la interfaz del CM para el cambio de número es `PortInExistingSubscription`: queda en **«Order Created»** y el número cambia cuando la portabilidad se completa, no en el momento. En la herramienta esa fila queda como **«Solicitada»**.

---

## 1. Objetivos

- Cambiar la SIM o el número de muchas líneas sin hacerlo una por una en la interfaz del CM.
- **No mandar ningún cambio que el CM vaya a rechazar**: todo se valida antes de dejarlo marcar.
- Dejar constancia: la nota, el número y estado de cada orden, y la petición y respuesta completas.

---

## 2. Arquitectura y archivos

Un solo marcado y un solo juego de controles (entrada, tabla, filtros, selección, barra de lote, nota, exportación). Lo que cambia según la pestaña activa sale de un objeto de configuración por pestaña en `cambio-imsi-linea.js`: textos, cabecera de entrada, columna propia, motor y nombres de exportación. Cada pestaña **conserva su estado** (filas cargadas, texto de entrada, nota y bitácora) al ir y volver; la tabla se desmonta y se rehace con las columnas de la otra pestaña.

| Archivo | Qué hace |
| --- | --- |
| `herramientas/cambio_imsi_linea.html` | Marcado único. Sin lógica ni estilos. |
| `assets/compartido/cm-lineas.js` | **Compartido con «Bloquear/Inactivar líneas»**: resolver la línea, cuenta del CRM y su dirección, SIM en el inventario, órdenes pendientes (`ordenesPendientes`), las órdenes `ChangeSim` (`cambiarImsi`) y `PortInExistingSubscription` (`cambiarMsisdn`), seguimiento y tabla con casillas (con `destruir()` para rehacerla por pestaña). |
| `assets/herramientas/cambio-imsi-linea/imsi.js` | Motor de «Cambio IMSI» (`window.CambioIMSI`): lectura de `línea;imsi`, validaciones, revalidación antes de enviar, cambio y verificación, exportación. |
| `assets/herramientas/cambio-imsi-linea/msisdn.js` | Motor de «Cambio de línea» (`window.CambioMSISDN`): lectura de `línea;línea_nueva` (texto o Excel), validaciones, revalidación antes de enviar, envío y exportación. |
| `assets/herramientas/cambio-imsi-linea/cambio-imsi-linea.js` | Pestañas, sesión, carga del archivo, tabla, filtros, nota obligatoria, confirmación con resumen y exportaciones. Configuración por pestaña en `PESTANAS`. |
| `assets/herramientas/cambio-imsi-linea/cambio-imsi-linea.css` | Estilos propios: pestañas, insignias, filas ocultas y barra de lote. |

Los dos motores exponen la misma interfaz (`CONFIG`, `PROCESO`, `procesosOk`, `leerEntrada`, `filaNueva`, `consultarFila`, `marcarRepetidos`, `noAplica`, `revalidarAntesDeEnviar`, `cambiarFila`, `registroBitacora`, `filasExport`, `filasBitacora`; el de MSISDN suma `textoDesdeHoja`). Para añadir otra pestaña basta un motor con esa interfaz y una entrada en `PESTANAS`.

---

## 3. Herramientas de terceros

Las mismas del resto de la suite (Bootstrap, Bootstrap Icons, DataTables, SheetJS, jQuery) por CDN. SheetJS lee el Excel/CSV de entrada del cambio de línea.

---

## 4. Endpoints

### 4.1 Cambio IMSI

Tomados de la captura `har nuevas/Cambio IMSI Claro|Tigo.har` (línea 3054164491 → IMSI 732157001066358).

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/api/v1/subscribers?msisdnList` | La línea, su suscripción activa y su SIM actual (`cardPackageID`). |
| `GET` | `/api/v1/cardPackage/{id}` | SIM actual y **SIM nueva**: existencia y estado en el inventario. |
| `GET` | `/api/v1/billingAccount?externalID&limit=10` | Cuenta (coincidencia **exacta**) y su id interno. |
| `GET` | `/api/v1/billingAccount/{id}` | Dirección de facturación para `ADDRESS` / `state` / `CITY`. |
| `POST` | `/api/v1/shoppingCart` | Carrito `ChangeSim`. |
| `POST` | `/api/v1/productOrder` | **La orden** `ChangeSim`, desde el carrito. |
| `GET` | `/api/v1/productOrder?customerBan="…"` | Seguimiento hasta el estado final. |
| `DELETE` | `/api/v1/shoppingCart/{id}` | Borrar el carrito, **siempre**. |

#### El carrito

Oferta **10012** «SIM Category-EXITO» con el producto **10010**, y en `userData` los 28 campos que manda la interfaz del CM, en el mismo orden. Los que importan:

| Campo | Valor |
| --- | --- |
| `<grupo>_MSISDN` | la línea |
| `<grupo>_ICCID` | identificador de la SIM nueva en el inventario |
| `<grupo>_OLD_ICCID` | la SIM actual (`cardPackageID` de la línea) |
| `<grupo>_NEW_IMSI` | la IMSI nueva |
| `SUBSCRIPTION_ID` | la suscripción **activa** |
| `ADDRESS` / `state` / `CITY` | de la dirección de facturación: `Colombia billingAddress Colombia 410-3 Direcc1 Direcc2` |
| `PAIDTYPE`, `notificationPreference` | del perfil de la línea |

La nota va en el `cartItem` y, como en el resto de la suite, **siempre con el usuario delante**: `jpelaezg. motivo`.

Verificado contra la captura: mismos 28 campos de `userData` en el mismo orden, con los mismos valores (dirección incluida), mismo `productOffering`, mismo `relatedParty`; la orden con las mismas claves y `AMOUNT_PAID`/`AMOUNT` en 0; y el carrito borrado al final.

#### Una orden de la captura que NO es el cambio de IMSI

En la captura hay **otra** orden antes del cambio de SIM: un **`SwitchCarrier`** para otra línea (3338066365, nota «Carrier Swap QA Prueba HLR/HSS»), armado con un carrito viejo del 2026-09-15 que la interfaz del CM tenía pendiente. Se envió durante la captura y generó la orden **`SOI7869437`**. No forma parte de este flujo y **no se replica**. Conviene revisar en el CM qué hizo esa orden.

Es también la razón de que esta herramienta **borre siempre el carrito**, salga bien o mal: un carrito que queda colgado lo puede volver a enviar la interfaz del CM más adelante.

### 4.2 Cambio de línea (MSISDN)

Tomados de la captura `cambio de numero.har` (línea 3052619570 → 3016999316, cuenta 41041474069, orden **SOI7935503**).

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/api/v1/subscribers?msisdnList` | La línea (suscripción activa, SIM `cardPackageID`, plan) y la línea nueva (que no sea ya una línea activa). |
| `GET` | `/api/v1/productOrder?customerBan&type&state` | Órdenes pendientes `ChangeMSISDN` y `portInExistingSubscription` en «Order Created» / «Order Initiated» (lo mismo que revisa la interfaz del CM antes de dejar pedirlo). |
| `GET` | `/api/v1/billingAccount?externalID&limit=10` | Cuenta (coincidencia **exacta**). |
| `GET` | `/api/v1/billingAccount/{id}` | Dirección de facturación (con código postal) y correo. |
| `POST` | `/api/v1/shoppingCart` | Carrito `PortInExistingSubscription`. |
| `POST` | `/api/v1/productOrder` | **La orden**, desde el carrito. |
| `GET` | `/api/v1/productOrder?customerBan="…"` | Seguimiento: se acepta «Order Created» como recibida. |
| `DELETE` | `/api/v1/shoppingCart/{id}` | Borrar el carrito, **siempre**. |

#### El carrito

Oferta **10012** «SIM Category-EXITO» con el producto **10010** (la misma categoría de SIM del cambio de IMSI) y, en `userData`, los campos que manda la interfaz del CM, en el mismo orden:

| Campo | Valor |
| --- | --- |
| `orderType` / `type` | `PortInExistingSubscription` |
| `<grupo>_ICCID` | la SIM **actual** de la línea (`cardPackageID`) |
| `<grupo>_MSISDN` | la **línea nueva** |
| `<grupo>_OLD_MSISDN` | la línea actual |
| `PORTIN` | `true` |
| `ADDITIONAL_DETAIL` | JSON de la portabilidad: `numberToPort` = línea actual, `contactNumberAlternate` = línea nueva, `orderTypeInfo` `EXITO-PORT_IN_CM`, `simPackage`, la dirección (`ospStreet1/2`, `ospCity`, `ospState`, `ospZip`), `accNumber`, y `subscriberPlanId` (plan de la línea) |
| `ADDRESS`, `ZIP`, `state`, `CITY` | dirección de facturación, **con código postal** («Bogota billingAddress Colombia T1234580 410-1 Main Street18 31») |
| `CUSTOMER_EMAIL` | correo de la cuenta |
| `reservationProfile` | `Exito` |
| `SUBSCRIPTION_ID` | la suscripción activa |

La nota va en el `cartItem`, como en el resto de la suite, **con el usuario delante**: `usuario. motivo`.

Verificado contra la captura con sus propias respuestas: mismos campos de `userData` en el mismo orden y con los mismos valores, `ADDITIONAL_DETAIL` idéntico, mismo `productOffering` y `relatedParty`, la orden con las mismas claves, y el carrito borrado al final.

---

## 5. Validaciones (antes de poder marcar)

### 5.1 Cambio IMSI

Por renglón, en este orden. Lo que no pasa queda en **«No se puede»**, con el motivo y la casilla deshabilitada.

| Regla | Por qué |
| --- | --- |
| La línea tiene 10 dígitos (se quita el `57`) y la IMSI 15 | formato |
| La **línea** no se repite en la tanda | se toma el primer renglón |
| La **IMSI nueva** no se repite en la tanda | no se puede asignar a dos líneas |
| La línea existe y está **activa** | el cambio de SIM es sobre una línea activa (se usa la suscripción activa más reciente) |
| La IMSI nueva **existe** en el inventario | |
| No es la IMSI que la línea **ya tiene** | |
| La IMSI nueva está **disponible** (`cardPackage.state = 1`) | si está **en uso** (2) la tiene otra línea; cualquier otro estado es típicamente **HELD** |

Justo antes de enviar cada cambio se **revalida** que la IMSI nueva siga disponible: entre la validación y la ejecución otra persona pudo haberla asignado.

#### IMSI en HELD

Una IMSI que sale de una línea **inactivada** queda en **HELD** y no se puede asignar hasta pasarla a disponible **a mano en el BSS**. Es exactamente el caso de la prueba: 732157001066358 era de 3332463395, que se inactivó; se liberó en el BSS y recién entonces se pudo asignar a 3054164491.

| `cardPackage.state` | Etiqueta | Confirmado |
| --- | --- | --- |
| 1 | Disponible | sí |
| 2 | En uso | sí |
| otro | `Estado N (¿HELD?)` | el código de HELD no quedó capturado |

### 5.2 Cambio de línea (MSISDN)

Por renglón; lo que no pasa queda en **«No se puede»**, con el motivo y la casilla deshabilitada.

| Regla | Por qué |
| --- | --- |
| La línea y la línea nueva tienen 10 dígitos y empiezan por 3 (se quita el `57`) | formato |
| La línea nueva no es la misma línea | |
| La **línea** y la **línea nueva** no se repiten en la tanda | se toma el primer renglón |
| La línea existe, está **activa** y tiene SIM | la orden lleva su `cardPackageID` |
| La línea nueva **no es ya una línea activa** de Móvil Éxito | |
| La cuenta no tiene otro **cambio de número o portabilidad pendiente** | lo revisa también la interfaz del CM |

Justo antes de enviar cada cambio se vuelve a revisar que no haya aparecido otra orden pendiente en la cuenta. La columna **Línea nueva** muestra cómo está ese número en el CM (no está, activa, inactiva…).

---

## 6. Funcionalidad

### 6.1 Cambio IMSI

#### Paso 2 · Cambios a validar

Un renglón por cambio: `línea;imsi_nueva`, separados por `;`, coma, tabulación, `|` o espacio. Se puede pegar desde Excel, con o sin encabezado. Hasta **100** cambios. Los renglones mal escritos no entran a la tabla y quedan en el registro con el motivo.

#### Tabla

La misma de «Bloquear/Inactivar líneas» y del cierre de casos: casillas, marcar/desmarcar la página visible o todas las filas filtradas, filtros combinables (Buscar de DataTables, estado de la línea, proceso, selección, ver ocultas) y ocultar/mostrar por fila y en lote. La columna **IMSI actual → nueva** muestra las dos con el estado de cada una en el inventario.

#### Paso 3 · Cambio IMSI Claro|Tigo

**Nota obligatoria**: sin ella el botón no se habilita. **Confirmación con resumen**. Los cambios van **de uno en uno**, cada uno seguido hasta su estado final. Después de cada uno:

1. se relee la línea y se compara su SIM con la nueva;
2. **Proceso** queda en «Cambiada» o en «Orden OK, CM sin reflejar»;
3. se muestra el estado en que quedó la **IMSI anterior**;
4. la fila se bloquea, para que no se vuelva a mandar.

#### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV) con usuario, IMSI anterior y nueva, nota, orden, estado, y la petición y respuesta del carrito y de la orden.

### 6.2 Cambio de línea (MSISDN)

#### Paso 2 · Cambios a validar

- **Desde Excel o CSV**: se toman las **dos primeras columnas** de la primera hoja (con o sin encabezado) y se pasan al cuadro de texto, para poder revisarlas antes de validar.
- **Escritos o pegados**: un renglón por cambio, `línea;línea_nueva`, separados por `;`, coma, tabulación, `|` o espacio.

Hasta **100** cambios. Los renglones mal escritos no entran a la tabla y quedan en el registro con el motivo.

#### Tabla

La misma de la pestaña Cambio IMSI: casillas, marcar/desmarcar la página visible o todas las filas filtradas, filtros combinables y ocultar/mostrar por fila y en lote. Línea y línea nueva copiables.

#### Paso 3 · Cambio MSISDN Claro|Tigo

**Nota obligatoria** y **confirmación con resumen**. Los cambios van **de uno en uno**. Cada orden se sigue hasta que el CM la registra: con «Order Created» queda **«Solicitada»** (la portabilidad sigue su curso); si el CM ya muestra la suscripción con el número nuevo, **«Cambiada»**; si falla, **«Falló»** con el motivo. La fila se bloquea para no volver a mandarla.

#### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV) con usuario, línea, línea nueva, nota, orden, estado, y la petición y respuesta del carrito y de la orden.

---

## 7. Riesgos y límites

### 7.1 Cambio IMSI

- **Escribe en producción.** Una IMSI equivocada deja la línea sin servicio: por eso la validación previa y la confirmación con resumen.
- **HELD es manual**: si la IMSI nueva viene de una línea inactivada, hay que liberarla en el BSS antes.
- **El código de HELD no está confirmado**: cualquier estado distinto de 1 se trata como no disponible, que es lo seguro.
- **Sin lista de usuarios**: cualquiera con sesión del CM vigente puede cambiar la IMSI; la validación previa y la confirmación con resumen son las guardas.
- **Una orden aceptada no es una orden aplicada**: se sigue hasta el estado final (45 s) y además se relee la línea.

### 7.2 Cambio de línea (MSISDN)

- **Escribe en producción** y lo que se pide es una **portabilidad**: una vez creada, se gestiona en el CM.
- **«Solicitada» no es «cambiada»**: el número cambia cuando la portabilidad se completa. Revisarlo después en el CM o volviendo a validar.
- **Solo está capturado el flujo de portabilidad.** La interfaz del CM también revisa órdenes `ChangeMSISDN` (cambio de número sin portabilidad); esa orden no está capturada y no se usa.
- **Sin lista de usuarios**: cualquiera con sesión del CM vigente puede pedir el cambio; la validación previa y la confirmación con resumen son las guardas.

---

### Controles y progreso

Los filtros múltiples de estado, proceso y selección están en `.me-filtros`, junto a limpiar filtros, Columnas y exportaciones. El único buscador es **Buscar** de DataTables. Los cuatro controles de selección permanecen visibles; las acciones de ocultar y escribir aparecen en `.me-lote` cuando hay líneas marcadas. La nota es obligatoria.

Consulta/validación y envío muestran progreso **N/M**. «Reintentar fallidas» reutiliza solo las consultas con error. Para escrituras, vuelve a pedir confirmación y solo incluye fallos anteriores a la petición de orden: nunca órdenes creadas ni respuestas inciertas del POST. Si se carga otra tanda, los reintentos de la anterior dejan de aplicar.

## 8. Historial de cambios

| Versión | Cambios |
| --- | --- |
| 2.0.0 (refactor) | Reorganización interna sin subir versión: los motores pasan a `assets/herramientas/cambio-imsi-linea/imsi.js` y `msisdn.js`, el puente a `cambio-imsi-linea.js` (con secciones numeradas) y el `<style>` de la página a `cambio-imsi-linea.css`. Sin cambios de comportamiento. |
| **2.0.0** | **Unión de «Cambio IMSI Claro\|Tigo» (1.2.0) y «Cambio MSISDN Claro\|Tigo» (1.1.0)** en una sola herramienta con pestañas, `cambio_imsi_linea.html`, y una sola sesión del CM. Un único juego de controles cuyo texto y comportamiento salen de una configuración por pestaña; cada pestaña conserva sus filas. Los motores (`logica-cambio-imsi.js`, `logica-cambio-msisdn.js`) pasan a publicarse como `window.CambioIMSI` / `window.CambioMSISDN` y absorben la revalidación previa al envío y el registro de bitácora que estaban en los puentes; los dos puentes se reemplazan por `me-cambio-imsi-linea-puente.js`. Las cargas útiles al CM no cambian. `cm-lineas.js`: la tabla gana `destruir()` (retrocompatible). |
| **1.2.0** · Cambio IMSI | Filtros múltiples, selección por página o todas las filtradas, barra de lote, confirmación con resumen y nota obligatoria, progreso N/M y reintentos seguros. |
| **1.1.0** · Cambio IMSI | Sin lista de usuarios: cambiar la IMSI solo pide sesión del CM vigente. Línea, IMSI actual e IMSI nueva copiables en la tabla. |
| 1.0.1 · Cambio IMSI | La herramienta pasa a llamarse **«Cambio IMSI Claro\|Tigo»** (antes «Cambio de IMSI»). |
| 1.0.0 · Cambio IMSI | Primera versión. Cambio IMSI Claro\|Tigo en masivo desde `línea;imsi_nueva` con la orden `ChangeSim` de la interfaz del CM (carrito + orden, verificados contra la captura), validación previa (línea activa, IMSI nueva existente y disponible, sin repetidos), revalidación justo antes de enviar, nota obligatoria, verificación posterior, tabla con casillas y filtros como el cierre de casos, y bitácora con petición y respuesta. Lógica compartida con «Bloquear/Inactivar líneas» en `cm-lineas.js`. |
| **1.1.0** · Cambio MSISDN | Filtros múltiples, selección por página o todas las filtradas, barra de lote, confirmación con resumen y nota obligatoria, progreso N/M y reintentos seguros. |
| **1.0.0** · Cambio MSISDN | Primera versión. Cambio de número en masivo desde `línea;línea_nueva` (texto o Excel/CSV, cualquier separador) con la orden `PortInExistingSubscription` de la interfaz del CM (carrito + orden, verificados contra la captura `cambio de numero.har`), validación previa (línea activa con SIM, línea nueva que no sea ya activa, sin cambios pendientes en la cuenta, sin repetidos), revalidación antes de enviar, nota obligatoria, estado «Solicitada» mientras la portabilidad sigue su curso, tabla con casillas y bitácora con petición y respuesta. Lógica compartida en `cm-lineas.js`. |
