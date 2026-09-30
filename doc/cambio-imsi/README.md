# Cambio de IMSI — Documentación técnica

> **Versión: v1.0.0** · Convención de versionado: *Major.Minor.Patch* · fix/documentación incrementa **Patch**.
> Base compartida: ver `doc/lanzador/README.md`.

**Cambia la SIM (IMSI) de líneas en el CM, en masivo.** Se pega un renglón por cambio, `línea;imsi_nueva`, se **validan** todos, se marcan en una tabla con casillas —mismo manejo que «Cierre masivo de casos»— y a los marcados se les envía la orden de cambio de SIM con una **nota obligatoria**. Después se vuelve a consultar cada línea para confirmar que quedó con la SIM nueva.

> **Escribe en producción.** Solo los usuarios autorizados pueden cambiar la IMSI; los demás pueden validar.

---

## 1. Objetivos

- Cambiar la SIM de muchas líneas sin hacerlo una por una en la interfaz del CM.
- **No mandar ningún cambio que el CM vaya a rechazar**: todo se valida antes de dejarlo marcar.
- Dejar constancia: la nota, el número y estado de cada orden, y la petición y respuesta completas.

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/cambio_imsi.html` | Marcado. Sin lógica. |
| `assets/cm-lineas.js` | **Compartido con «Estado de líneas»**: resolver la línea, cuenta del CRM y su dirección, SIM en el inventario, orden `ChangeSim`, seguimiento y tabla con casillas. |
| `assets/logica-cambio-imsi.js` | Lectura de `línea;imsi`, validaciones, cambio y verificación, exportación. |
| `assets/me-cambio-imsi-puente.js` | Sesión, tabla, filtros, nota obligatoria, doble confirmación y exportaciones. |

---

## 3. Herramientas de terceros

Las mismas del resto de la suite (Bootstrap, Bootstrap Icons, DataTables, SheetJS, jQuery) por CDN.

---

## 4. Endpoints

Tomados de la captura `har nuevas/Cambio de IMSI.har` (línea 3054164491 → IMSI 732157001066358).

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

### El carrito

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

### Una orden de la captura que NO es el cambio de IMSI

En la captura hay **otra** orden antes del cambio de SIM: un **`SwitchCarrier`** para otra línea (3338066365, nota «Carrier Swap QA Prueba HLR/HSS»), armado con un carrito viejo del 2026-09-15 que la interfaz del CM tenía pendiente. Se envió durante la captura y generó la orden **`SOI7869437`**. No forma parte de este flujo y **no se replica**. Conviene revisar en el CM qué hizo esa orden.

Es también la razón de que esta herramienta **borre siempre el carrito**, salga bien o mal: un carrito que queda colgado lo puede volver a enviar la interfaz del CM más adelante.

---

## 5. Validaciones (antes de poder marcar)

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

### IMSI en HELD

Una IMSI que sale de una línea **inactivada** queda en **HELD** y no se puede asignar hasta pasarla a disponible **a mano en el BSS**. Es exactamente el caso de la prueba: 732157001066358 era de 3332463395, que se inactivó; se liberó en el BSS y recién entonces se pudo asignar a 3054164491.

| `cardPackage.state` | Etiqueta | Confirmado |
| --- | --- | --- |
| 1 | Disponible | sí |
| 2 | En uso | sí |
| otro | `Estado N (¿HELD?)` | el código de HELD no quedó capturado |

---

## 6. Funcionalidad

### Paso 2 · Cambios a validar

Un renglón por cambio: `línea;imsi_nueva`, separados por `;`, coma, tabulación, `|` o espacio. Se puede pegar desde Excel, con o sin encabezado. Hasta **100** cambios. Los renglones mal escritos no entran a la tabla y quedan en el registro con el motivo.

### Tabla

La misma de «Estado de líneas» y del cierre de casos: casillas, marcar/desmarcar lo visible, filtros combinables (texto, estado de la línea, proceso, selección, ver ocultas) y ocultar/mostrar por fila y en lote. La columna **IMSI actual → nueva** muestra las dos con el estado de cada una en el inventario.

### Paso 3 · Cambio de IMSI

**Nota obligatoria**: sin ella el botón no se habilita. **Doble confirmación**. Los cambios van **de uno en uno**, cada uno seguido hasta su estado final. Después de cada uno:

1. se relee la línea y se compara su SIM con la nueva;
2. **Proceso** queda en «Cambiada» o en «Orden OK, CM sin reflejar»;
3. se muestra el estado en que quedó la **IMSI anterior**;
4. la fila se bloquea, para que no se vuelva a mandar.

### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV) con usuario, IMSI anterior y nueva, nota, orden, estado, y la petición y respuesta del carrito y de la orden.

---

## 7. Riesgos y límites

- **Escribe en producción.** Una IMSI equivocada deja la línea sin servicio: por eso la validación previa y la doble confirmación.
- **HELD es manual**: si la IMSI nueva viene de una línea inactivada, hay que liberarla en el BSS antes.
- **El código de HELD no está confirmado**: cualquier estado distinto de 1 se trata como no disponible, que es lo seguro.
- **Guarda de interfaz, no control de acceso** (`USUARIOS_AUTORIZADOS` en `cm-lineas.js`).
- **Una orden aceptada no es una orden aplicada**: se sigue hasta el estado final (45 s) y además se relee la línea.

---

## 8. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **1.0.0** | Primera versión. Cambio de IMSI en masivo desde `línea;imsi_nueva` con la orden `ChangeSim` de la interfaz del CM (carrito + orden, verificados contra la captura), validación previa (línea activa, IMSI nueva existente y disponible, sin repetidos), revalidación justo antes de enviar, nota obligatoria, verificación posterior, tabla con casillas y filtros como el cierre de casos, y bitácora con petición y respuesta. Lógica compartida con «Estado de líneas» en `cm-lineas.js`. |
