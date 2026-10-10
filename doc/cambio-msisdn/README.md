# Cambio MSISDN Claro|Tigo — Documentación técnica

> **Versión: v1.0.0** · Convención de versionado: *Major.Minor.Patch* · fix/documentación incrementa **Patch**.
> Base compartida: ver `doc/lanzador/README.md`.

**Cambia el número (MSISDN) de líneas en el CM, en masivo.** Se cargan los cambios como `línea;línea_nueva` —escritos o desde un Excel/CSV, con cualquier separador—, se **validan** todos, se marcan en una tabla con casillas —mismo manejo que «Cambio IMSI Claro|Tigo» y el cierre de casos— y a los marcados se les envía la orden de cambio de número con una **nota obligatoria**.

> **Escribe en producción.** Pide sesión del CM vigente; sin ella solo se puede validar.

> **Es una portabilidad.** La orden que usa la interfaz del CM para el cambio de número es `PortInExistingSubscription`: queda en **«Order Created»** y el número cambia cuando la portabilidad se completa, no en el momento. En la herramienta esa fila queda como **«Solicitada»**.

---

## 1. Objetivos

- Pedir el cambio de número de muchas líneas sin hacerlo una por una en la interfaz del CM.
- **No mandar ningún cambio que el CM vaya a rechazar**: todo se valida antes de dejarlo marcar.
- Dejar constancia: la nota, el número y el estado de cada orden, y la petición y respuesta completas.

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/cambio_msisdn.html` | Marcado. Sin lógica. |
| `assets/cm-lineas.js` | **Compartido** con «Bloquear/Inactivar líneas» y «Cambio IMSI Claro\|Tigo»: resolver la línea, cuenta del CRM y su dirección, órdenes pendientes (`ordenesPendientes`), la orden `PortInExistingSubscription` (`cambiarMsisdn`), seguimiento y tabla con casillas. |
| `assets/logica-cambio-msisdn.js` | Lectura de `línea;línea_nueva` (texto o Excel), validaciones, envío y exportación. |
| `assets/me-cambio-msisdn-puente.js` | Sesión, carga del archivo, tabla, filtros, nota obligatoria, doble confirmación y exportaciones. |

---

## 3. Herramientas de terceros

Las mismas del resto de la suite (Bootstrap, Bootstrap Icons, DataTables, SheetJS, jQuery) por CDN. SheetJS lee el Excel/CSV de entrada.

---

## 4. Endpoints

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

### El carrito

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

### Paso 2 · Cambios a validar

- **Desde Excel o CSV**: se toman las **dos primeras columnas** de la primera hoja (con o sin encabezado) y se pasan al cuadro de texto, para poder revisarlas antes de validar.
- **Escritos o pegados**: un renglón por cambio, `línea;línea_nueva`, separados por `;`, coma, tabulación, `|` o espacio.

Hasta **100** cambios. Los renglones mal escritos no entran a la tabla y quedan en el registro con el motivo.

### Tabla

La de «Cambio IMSI Claro|Tigo»: casillas, marcar/desmarcar lo visible, filtros combinables y ocultar/mostrar por fila y en lote. Línea y línea nueva copiables.

### Paso 3 · Cambio MSISDN Claro|Tigo

**Nota obligatoria** y **doble confirmación**. Los cambios van **de uno en uno**. Cada orden se sigue hasta que el CM la registra: con «Order Created» queda **«Solicitada»** (la portabilidad sigue su curso); si el CM ya muestra la suscripción con el número nuevo, **«Cambiada»**; si falla, **«Falló»** con el motivo. La fila se bloquea para no volver a mandarla.

### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV) con usuario, línea, línea nueva, nota, orden, estado, y la petición y respuesta del carrito y de la orden.

---

## 7. Riesgos y límites

- **Escribe en producción** y lo que se pide es una **portabilidad**: una vez creada, se gestiona en el CM.
- **«Solicitada» no es «cambiada»**: el número cambia cuando la portabilidad se completa. Revisarlo después en el CM o volviendo a validar.
- **Solo está capturado el flujo de portabilidad.** La interfaz del CM también revisa órdenes `ChangeMSISDN` (cambio de número sin portabilidad); esa orden no está capturada y no se usa.
- **Sin lista de usuarios**: cualquiera con sesión del CM vigente puede pedir el cambio; la validación previa y la doble confirmación son las guardas.

---

## 8. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **1.0.0** | Primera versión. Cambio de número en masivo desde `línea;línea_nueva` (texto o Excel/CSV, cualquier separador) con la orden `PortInExistingSubscription` de la interfaz del CM (carrito + orden, verificados contra la captura `cambio de numero.har`), validación previa (línea activa con SIM, línea nueva que no sea ya activa, sin cambios pendientes en la cuenta, sin repetidos), revalidación antes de enviar, nota obligatoria, estado «Solicitada» mientras la portabilidad sigue su curso, tabla con casillas y bitácora con petición y respuesta. Lógica compartida en `cm-lineas.js`. |
