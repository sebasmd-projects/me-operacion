# Estado de líneas — Documentación técnica

> **Versión: v1.0.0** · Convención de versionado: *Major.Minor.Patch* · fix/documentación incrementa **Patch**.
> Base compartida: ver `doc/lanzador/README.md`.

**Bloquea o inactiva líneas en el CM, en masivo.** Se pegan las líneas, se consultan, se marcan en una tabla con casillas —con el mismo manejo de filtros y ocultar/mostrar que «Cierre masivo de casos»— y a las marcadas se les envía la orden de cambio de estado. Después de cada orden la línea se vuelve a consultar, así que la tabla muestra el estado que el CM tiene **de verdad**, no el que se pidió.

> **Escribe en producción.** Solo los usuarios autorizados pueden cambiar el estado; los demás pueden consultar.

---

## 1. Objetivos

- Cambiar el estado de muchas líneas sin hacerlo una por una en la interfaz del CM.
- Ver antes de actuar el estado de cada línea y el de su IMSI en el inventario.
- Dejar constancia de cada orden: número, estado final, petición y respuesta.
- Recordar lo que el CM **no** hace solo: al inactivar, la IMSI queda en **HELD**.

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/estado_lineas.html` | Marcado. Sin lógica. |
| `assets/cm-lineas.js` | **Compartido con «Cambio de IMSI»**: resolver la línea, cuenta del CRM, SIM en el inventario, órdenes del CM, seguimiento y la tabla con casillas. Se publica como `window.CMLineas`. |
| `assets/logica-estado-lineas.js` | Consulta por línea, cambio de estado, exportación. |
| `assets/me-estado-lineas-puente.js` | Sesión, tabla, filtros, doble confirmación y exportaciones. |

Comparte con el resto de la suite `me-ui.js` y `me-api.js`.

---

## 3. Herramientas de terceros

Bootstrap 5.3.3, Bootstrap Icons 1.11.3, DataTables 2.3.2, SheetJS 0.18.5 y jQuery 3.7.1 por CDN, las mismas versiones que el resto de la suite.

---

## 4. Endpoints

Tomados de las capturas `har nuevas/Cambio de estado Bloqueada.har` y `Cambio de estado Inactiva.har`.

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/api/v1/subscribers?msisdnList&offset&limit` | Resolver la línea y sus suscripciones. |
| `GET` | `/api/v1/cardPackage/{id}` | La SIM/IMSI de la línea y su estado en el inventario. |
| `GET` | `/api/v1/billingAccount?externalID&limit=10` | Nombres de la cuenta para `relatedParty` (coincidencia **exacta**). |
| `POST` | `/api/v1/productOrder` | **La orden** (`ChangeSubscriptionState`). |
| `GET` | `/api/v1/productOrder?customerBan="…"` | Seguimiento de la orden hasta su estado final. |

### La orden

La misma que manda la interfaz del CM: la oferta **10008** «Subscription state change» con **un** producto destino.

| Acción | Producto | Estado resultante | `REASON` por defecto |
| --- | --- | --- | --- |
| Bloquear | `10006` Barred/Locked | 5 (Bloqueada) | `Exito Razón bloqueo` |
| Inactivar | `10007` Deactivate | 2 (Inactiva) | `Exito Razón Inactividad` |

```json
{
  "type": "ChangeSubscriptionState",
  "relatedParty": [{ "id": "<BAN>", "firstName": "…", "lastName": "…", "role": "Customer" }],
  "productOrderItem": [{
    "action": "ADD", "index": 0, "itemGroupId": "<4 dígitos>",
    "productOffering": { "id": "10008", "quantity": 1, "includedItems": [{ "id": "10006", "quantity": 1 }] },
    "note": [{ "author": "<usuario>", "text": "<usuario>. <nota>" }]
  }],
  "note": [ … la misma … ],
  "orderDate": "2026-09-28T21:02:51Z",
  "userData": [
    { "name": "<grupo>_MSISDN", "value": "<línea>" }, { "name": "SPID", "value": "410" },
    { "name": "SUBSCRIPTION_ID", "value": "<BAN>-1" }, { "name": "REASON", "value": "Exito Razón bloqueo" }
  ]
}
```

Cabecera `Transaction-Id` con el formato de la interfaz del CM (`DCRM-TRX20260928160249-922`). Verificado campo por campo contra la petición de la captura: mismas claves, mismo orden de `userData`, mismo `productOffering` y mismo `relatedParty`.

La oferta 10008 también trae **Activar** (`10005`, estado 1), pero no hay captura de esa orden y **no se incluyó**: agregarla es una línea en `DESTINOS_ESTADO` de `cm-lineas.js` cuando se confirme con una orden real.

La `REASON` no viene de ningún servicio: la interfaz del CM la trae incorporada y no aparece en las capturas. Por eso se precarga con la que usa el CM para cada estado y **se puede editar**. Si nadie la tocó, sigue al estado elegido.

---

## 5. Estados de la línea y de la IMSI

| Qué | Código | Etiqueta | Confirmado |
| --- | --- | --- | --- |
| Línea (`status.state`) | 1 | Activa | sí |
| | 2 | Inactiva | sí (resultado de `10007`) |
| | 5 | Bloqueada | sí (resultado de `10006`) |
| IMSI (`cardPackage.state`) | 1 | Disponible | sí (la IMSI que se pudo asignar en un cambio de IMSI) |
| | 2 | En uso | sí (la de una línea activa; **bloquear no la cambia**) |
| | ? | HELD | **no**: no quedó capturado su código |

Lo que no está confirmado se muestra con su código crudo (`Estado 7 (¿HELD?)`) en lugar de inventar una etiqueta.

### Inactivar deja la IMSI en HELD

Al inactivar una línea, su IMSI pasa a **HELD** en el inventario y **no queda libre sola**. Para volver a usarla —por ejemplo en un «Cambio de IMSI»— hay que pasarla a disponible **a mano en el BSS**. La herramienta lo avisa al elegir «Inactivar», al terminar la tanda y en el detalle de cada línea inactivada (con el estado en que quedó su IMSI).

Bloquear **no** cambia la IMSI: en la captura, la de 3332463394 siguió «En uso» después de bloquearla.

---

## 6. Funcionalidad

### Paso 1 · Conexión

Sesión del CM, compartida con las demás herramientas. Además de consultar, dice **quién opera**: cambiar el estado solo está habilitado para los usuarios de `USUARIOS_AUTORIZADOS` en `cm-lineas.js` (hoy `jpelaezg`) con sesión vigente.

### Paso 2 · Líneas

Hasta **200**, separadas por lo que sea (espacio, coma, `;`, salto de línea; se puede pegar una columna de Excel). Se quita el `57` del indicativo. Por cada línea se trae: cuenta, estado, cuántas suscripciones tiene (⚠ si más de una: se usa la activa más reciente), IMSI y estado de la IMSI.

### Tabla

Como en «Cierre masivo de casos»:

- **Casilla** por fila y otra en el encabezado que marca/desmarca **lo visible**. Las líneas que no se pueden operar (no existen, error de consulta) tienen la casilla deshabilitada.
- **Filtros** que se combinan: texto libre, estado en el CM, proceso, selección y «ver ocultas».
- **Ocultar/mostrar** por fila, y en lote: ocultar marcadas, ocultar no marcadas, mostrar todas.
- Contadores y el resumen «N de M marcadas · K visibles».

Solo se opera lo **marcado y visible**: una fila oculta no se envía aunque esté marcada.

### Paso 3 · Cambio de estado

Estado destino, razón y nota (opcional; siempre viaja con el usuario delante: `jpelaezg. motivo`). El botón dice cuántas líneas cambiarían y descuenta las que **ya están** en ese estado —a esas no se les manda nada—. **Doble confirmación**: el primer clic arma el botón y el segundo ejecuta.

Las órdenes van **de una en una**: cada una se sigue hasta su estado final antes de mandar la siguiente. Al terminar cada línea:

1. se vuelve a consultar en el CM;
2. **Proceso** queda en «Cambiada» si el CM ya muestra el estado nuevo, u «Orden OK, CM sin reflejar» si la orden se cumplió pero el estado todavía no aparece;
3. la línea se **desmarca**, para que no se vuelva a mandar por error.

### Exportación

CSV / Excel / JSON de la tabla, y **Bitácora** (CSV) con cada orden enviada: usuario, acción, razón, nota, número y estado de la orden, y la petición y respuesta completas.

---

## 7. Riesgos y límites

- **Escribe en producción.** Bloquear e inactivar se hacen sobre la línea real.
- **Inactivar retiene la IMSI (HELD)** y liberarla es manual en el BSS.
- **Guarda de interfaz, no control de acceso**: `USUARIOS_AUTORIZADOS` evita operaciones por accidente, pero el CM acepta la orden de cualquier sesión válida.
- **`REASON` sin catálogo**: solo se conocen los dos valores de las capturas.
- **Activar no está incluido** hasta confirmarlo con una orden real.
- **Una orden aceptada no es una orden aplicada**: se sigue hasta `Order Fulfilled`/`Order Failed` (45 s) y, además, se relee la línea.

---

## 8. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **1.0.0** | Primera versión. Bloquear e inactivar en masivo con la orden `ChangeSubscriptionState` de la interfaz del CM (verificada contra las capturas), tabla con casillas, filtros y ocultar/mostrar como el cierre de casos, estado real tras cada orden, aviso de HELD al inactivar, bitácora con petición y respuesta. Lógica compartida con «Cambio de IMSI» en `cm-lineas.js`. |
