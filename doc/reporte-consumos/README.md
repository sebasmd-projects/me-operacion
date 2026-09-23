# Consumos y Paquetes (CM) — Documentación técnica

> **Versión: v1.8.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Herramienta para traer, por línea, **datos básicos de la línea**, sus **paquetes activos** (uso y balance), sus **movimientos** (compras, paquetes, recurrencias) y su **histórico de consumo** (llamadas, datos y SMS) desde el CM (Optiva), con filtros, paginación, gráficas y exportación.

> **Desde v1.8.0 deja de ser solo lectura en un punto concreto:** dentro del detalle de una línea hay una sección **«Cargar paquete»** que agrega paquetes en el CM. Es lo único que escribe, vive en su propio archivo (`assets/logica-paquetes-carga.js`) y tiene su propio paso de revisión y confirmación. Todo lo demás sigue siendo consulta.

> A diferencia de "Prepagadas · SIME ⇄ CM", esta herramienta **no consulta SIME**: no verifica suscripciones, no cuenta periodos ni recurrencias — los movimientos que trae son los mismos que "Movimientos BSS" de Prepagadas, pero acotados al rango de fechas elegido, sin el cálculo de ciclos/cobertura. Tampoco es "Ajustes y paquetes" (que exporta el histórico **completo** de ajustes de dinero y de paquetes por rango, sin ligarlos a una línea puntual): esta trae, **por línea**, tanto los movimientos como los **eventos de consumo real** (CDR) y el balance vigente de los paquetes.

> Todo corre en el navegador del analista. No hay backend propio: la página habla directamente con Keycloak y con el API gateway del CM.

---

## 1. Objetivos

- Dar a la operación una vista rápida, por línea, de **qué paquetes tiene activos**, **qué compró/movió** y **cuánto ha consumido**, sin entrar al CM caso por caso.
- Separar el consumo por **tipo** (Datos / Voz / SMS) y los movimientos por **categoría** (1.ª compra, paquete, ingreso, recurrencia, otro), ambos por **rango de fechas**, con el mes en curso como valor por defecto.
- Resaltar visualmente compras y paquetes, y marcar qué movimiento es el **vigente** de su categoría o cae en el **mes en curso**, sin tener que leer fila por fila.
- Mostrarlo también en **gráficas** (barras por día, torta por proporción) para el consumo, y en tabla paginada y filtrable para los movimientos.
- Exportar el resumen por línea y, del detalle de una línea puntual, tanto los movimientos como el consumo — cada uno con su propio filtro y sus propios botones.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `reporte_consumos.html` | Solo marcado: KPIs, pasos, tabla principal y modal de detalle (paquetes + histórico + gráficas). |
| `assets/logica-consumos.js` | Reglas de negocio: consultas al CM, clasificación del histórico, tabla, filtros, gráficas y exportación. |
| `assets/logica-paquetes-carga.js` | **Cargar paquete**: única parte que escribe en el CM (catálogo de la oferta, carrito, orden y verificación). Va aparte para poder leerla y auditarla sin mezclarla con la consulta. |
| `assets/me-consumos-puente.js` | Enganche con el shell: sesión del CM, credenciales compartidas y exportación. |
| `assets/me-api.js` · `me-ui.js` · `me-ui.css` | Base común a las herramientas de esta suite. |

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, modal, dropdowns. |
| **Bootstrap Icons** | 1.11.3 | Iconos de la interfaz. |
| **DataTables** | 2.3.2 (+ `bootstrap5`) | Tabla de líneas, tabla de movimientos y tabla de detalle del histórico de consumo. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Exportar a `.xlsx`. |
| **Chart.js** | 4.4.1 | Gráfica de barras (registros por día) y de torta (proporción por categoría). |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** | Autenticación OpenID Connect del CM (lo maneja `me-api.js`). |
| **API Gateway OBP (CM/Optiva)** | Datos de la línea, paquetes y el histórico de consumo. |

---

## 4. Endpoints

| Método | Endpoint | Para qué |
|---|---|---|
| `GET` | `/api/v1/subscribers?msisdnList={linea}` | Resuelve la línea a su(s) cuenta(s): `subscriberId` (SubscriptionID), `accountID` (BAN), estado, plan. |
| `GET` | `/api/v1/billingAccount?externalID={ban}` | Cuenta de facturación del BAN (para subir por `parentId`/`accountRelationship` hasta el titular — ver "Titular de la línea" abajo). |
| `GET` | `/api/v1/individual/{id}` · `/api/v1/customer/{id}` | Identificación y nombre del titular, referenciados desde `billingAccount.relatedParty`. |
| `GET` | `/api/v1/subscription/bundleBalance?subscriptionID={id}` | Paquetes activos y su balance (mismo endpoint que "Uso y Balance" de Prepagadas). |
| `GET` | `/api/v1/subscription/{id}/detailedSubscriptionTransaction?limit&isAscending&start&end&nextPageKey` | **Movimientos**: compras, paquetes, recurrencias y otros ajustes. Mismo endpoint que "Movimientos BSS" de Prepagadas, pero acotado al rango de fechas del histórico (no todo el historial desde 2020). Paginado por `paginarHistorico()` (ver abajo). |
| `GET` | `/api/v1/listDetailedCallDetailsWithBundles?subscriptionID&limit&isAscending&start&end&nextPageKey` | **Histórico de consumo** (CDR): un registro por evento (llamada, sesión de datos, SMS). Paginado por `paginarHistorico()` (ver abajo). |

### Endpoints de «Cargar paquete» (escritura)

Solo se usan desde la sección «Cargar paquete» del detalle. El flujo completo, con los cuerpos reales y la captura de la que salió, está en [`doc/reporte-ajustes/recarga-de-paquetes-cm.md`](../reporte-ajustes/recarga-de-paquetes-cm.md).

| Método | Endpoint | Para qué |
|---|---|---|
| `GET` | `/api/v1/subscriberProfile?identifier={subscriptionId}` | Cuenta, MSISDN, ICCID, `spid`, `paidType`, plan y **`enabledOptionalBundles`**. Es la foto del «antes» y la que verifica el «después». |
| `GET` | `/api/v1/productOffering?offeringType=PRICE_PLAN&primaryPricePlanId={n}` | Traduce el plan de la línea a su **oferta** (`productOfferingId`), llave de todo lo demás. |
| `POST` | `/api/v1/productOffering/{offeringId}/selectableProducts` | Catálogo, en dos pasos encadenados: `PROD_COMP_TPS` (servicios obligatorios) y luego `PROD_COMP_BDLE` arrastrando esa selección (los ~469 paquetes). |
| ⚠️ `POST` | `/api/v1/shoppingCart` | Crea el carrito: obligatorios en `NO_CHANGE` y lo elegido en `ADD`. Devuelve `cartId` y el `noteId`. |
| ⚠️ `POST` | `/api/v1/productOrder` | Confirma la orden (`ChangeOffer`), con cabecera `Transaction-Id`. Devuelve el número `SOI…`. |
| ⚠️ `DELETE` | `/api/v1/shoppingCart/{cartId}` | Limpia el carrito. Se ejecuta **siempre**, salga bien o mal la orden. |

Dos cosas que no son obvias y están así a propósito:

- **Los paquetes que la línea ya tiene activos no se reenvían.** Solo van los componentes obligatorios de la oferta (`NO_CHANGE`) y los nuevos (`ADD`); los activos sobreviven igual. Verificado contra la captura.
- **La orden se arma desde la respuesta del carrito**, no se vuelve a construir a mano: se cambia `MODIFY` por `CHANGE`, se ordenan los componentes por id y se añaden `AMOUNT`, `AMOUNT_PAID` y `PAYMENT_METHOD`. Lo que el CM devolvió es lo que el CM espera de vuelta.

Movimientos e histórico se piden **juntos, en paralelo**, bajo demanda (al abrir el detalle de una línea o al presionar «Consultar»), no en la consulta masiva: son las únicas llamadas que pueden paginar varias veces y encarecer una carga de muchas líneas. Comparten el mismo rango de fechas (`mdHistDesde`/`mdHistHasta`); si la consulta de movimientos falla, se avisa y el histórico de consumo sigue mostrándose igual (y viceversa).

Formato de fecha que esperan los dos endpoints: el valor del input `datetime-local` (hora de Colombia) se envía **tal cual**, con `.000Z`/`.999Z` al final — mismo criterio que usa "Fecha y hora de compra" en Prepagadas, no es una conversión real de zona horaria.

**Registros repetidos**: el API a veces devuelve el mismo evento más de una vez (páginas solapadas), igual que le pasa a `detailedSubscriptionTransaction` en Prepagadas. El paginador deduplica (por `identifier` en el histórico; por `identifier|fecha|tipo|monto` en movimientos) antes de devolver los registros, así que la tabla, las gráficas y el conteo de KPIs nunca cuentan un mismo evento dos veces.

### Paginación del histórico (`paginarHistorico`)

Los dos listados (CDR y movimientos) comparten un solo paginador, porque el CM se comporta igual con ambos: devuelve los resultados **de más nuevo a más viejo** (`isAscending=false`) y **no siempre manda `nextPageKey`**. Cuando no lo manda, quedarse con la primera página es exactamente el bug que se corrigió en la v1.4: un mes con más eventos de los que cabe en una página se veía recortado sin avisar.

El paginador combina las dos formas de seguir:

1. **Por llave** — si la respuesta trae `nextPageKey`, se pide la siguiente página con esa llave (y se corta si la llave se repite, para no ciclar).
2. **Por ventana de fechas** — si no hay llave, se vuelve a pedir el mismo rango con `end` = la **fecha del registro más antiguo** ya recibido. La ventana se mueve **inclusiva** (ese registro vuelve a venir y se descarta al deduplicar): así el corte entre páginas **nunca deja huecos**.

**La única condición de fin es que una página no traiga nada nuevo.** El tamaño de la página NO se usa para decidir si quedan más registros. Esto fue un error de la v1.5 que costó datos: se tomaba por "última página" cualquiera más corta que la anterior, pero el CM **no devuelve páginas de tamaño constante**, así que la consulta terminaba antes de tiempo y traía *menos* registros que la versión previa. Pedir una vuelta de más —la que confirma que ya no hay nada nuevo— cuesta una petición y es lo que garantiza que el rango salga completo.

### Reintentos (v1.6)

El CM devuelve `500 Internal Server Error` de vez en cuando sin motivo aparente, y al repetir la **misma** petición responde bien. Antes eso cortaba la paginación y dejaba la lista a medias con un aviso. Ahora cada página se recupera en dos escalones:

1. **Reintento de la misma petición** — hasta `CONFIG.reintentosPagina` (2, misma convención que las otras herramientas: 3 intentos en total), con espera creciente (600 ms × intento).
2. **Bajar el tamaño de página** — si aun así no sale, se vuelve a pedir la *misma ventana* con la mitad de registros, y así hasta el piso de `CONFIG.minPaginaHistorico` (50). Cuando el 500 viene de que al CM le pesa la página, pedir menos la trae. El tamaño reducido **se mantiene** para las páginas siguientes (si le pesó una, le van a pesar las demás).

Solo si se agotan los reintentos **y** los tamaños se da la página por perdida, y aun entonces **se devuelven los registros ya traídos** (marcados como incompletos) en vez de perderlos. Si la que falla es la primera página no hay nada que salvar y el error sube tal cual. Se piden **500 por página**, que es el **máximo que acepta el CM** y lo dice él mismo: con `limit=1000` responde `500 Internal Server Error` con el texto *«The input limit is 1000, but the CRM Service Provider defined maximum allowed limit size is 500»*. Aplica a los dos endpoints.

> **500 es el límite de la API, no del resultado.** El rango de fechas elegido se trae **completo**: no hay tope de registros. El bucle termina por las condiciones reales del CM (página corta, página que no aporta nada nuevo, o ventana que no puede avanzar), nunca por una cuenta arbitraria. La única guarda que queda es `CONFIG.maxPaginasHistorico` (1.000 páginas = 500.000 registros para UNA línea en UN rango): existe para que un CM que devolviera páginas sin fin no cuelgue el navegador, y si llega a saltar se avisa como error, porque con datos normales no ocurre.

Como un rango grande son varias páginas seguidas, el conteo se va mostrando **en vivo** ("Consultando… 1.500 registro(s) de consumo y 40 movimiento(s) hasta ahora") en lugar de dejar el modal aparentemente pegado.

Si falla una página **posterior** a la primera, no se pierde lo ya traído: se devuelve marcado como incompleto y se avisa en el registro. Si falla la primera, el error sube tal cual (ahí no hay nada que salvar y el analista tiene que verlo).

Cuando hace más de una vuelta, deja constancia en el registro de la herramienta: cuántos registros, en cuántas páginas, de qué tamaño y por cuál de los dos mecanismos.

**Unidades de `duration`**: en este endpoint viene en **milisegundos**, no en segundos (se confirmó comparándolo contra `bundleInfo[0].chargedAmount` de la misma llamada, que sí está en segundos). `fmtDuracionHMS()` lo convierte a `hh:mm:ss` para la tabla y el detalle; `fmtVoz()` sigue esperando segundos y solo se usa para los paquetes (`bundleBalance`) y el total del KPI (que ya se divide por 1000 antes de sumar). No confundir los dos.

**Unidades de `balance`/`charge`**: vienen multiplicados por 10.000, igual que `value.amount` en "Ajustes y paquetes". `fmtMonto()` hace la conversión.

### Titular de la línea (identificación + nombre)

**Porte directo de `assets/logica-rechazo.js`** (misma función `titularDeCuenta`, copiada porque cada herramienta carga su propia lógica y no pueden compartir constantes globales): el BAN de la línea suele ser una **cuenta hija sin documento**, y la identificación está en la cuenta de arriba. Se sube por `billingAccount.parentId` y, cuando ese campo no viene, por `accountRelationship[].account.id`, con un tope de **5 saltos**, hasta encontrar una cuenta cuyo `relatedParty` (Individual/Customer) traiga `individualIdentification`.

Se resuelve **en paralelo** con `bundleBalance` (no la retrasa), tanto en la consulta masiva como al cambiar de cuenta (BAN) dentro del modal — cada BAN puede tener un titular distinto, así que no se arrastra el de la cuenta anterior.

**Nada se inventa**: si la cadena de cuentas no tiene identificación, o el CM devuelve el nombre de prueba `"FirstName LastName"` (cuentas de prueba sin datos reales cargados), el campo queda vacío y se avisa en el registro — igual que en `logica-rechazo.js`. Si cambia algo en esta lógica, revisa también esa herramienta.

### Clasificación del histórico (Datos / Voz / SMS) y dirección (MO / MT)

El API no trae un campo único y documentado para el tipo de evento, así que se clasifica con un criterio en cascada (tuneable en `CALLTYPE_CATEGORIA` / `UNIT_CATEGORIA_CDR` de `logica-consumos.js`):

1. `callType` conocido: `1` y `2` → Voz, `3` → SMS, `11` → Datos (los cuatro confirmados con datos reales).
2. Si no, `bundleInfo[0].unitType` (mismo código que `bundleBalance`: `0` Voz, `1` Datos, `2` SMS, `3` Saldo).
3. Si no, `dataUsage > 0` → Datos; `duration > 0` → Voz.
4. Si nada de lo anterior aplica, queda como "Otro".

Si aparece un `callType` nuevo con datos reales, agrégalo al mapa en vez de depender solo del respaldo.

La **dirección** (`direccionCdr()`) sale del parámetro `ChargedParty` dentro de `parameters`: `"O"` (Originating) → **MO**, `"T"` (Terminating) → **MT**; si no viene, se busca `MO`/`MT` en el texto de `RatingRule` como respaldo. Se muestra junto a la categoría ("Voz · MO", "SMS · MT") y por separado quedan las columnas **Origen** (`originatingNumber`) y **Destino** (`destinationNumber`), sin combinar: en una llamada MO la línea consultada es el origen; en una MT, el destino. Los eventos de Datos no traen ninguno de los dos.

### Clasificación de los movimientos (1.ª compra / paquete / compra / recurrencia / otro)

Mismas reglas que `categoriaTx` en Prepagadas — expresiones regulares (tuneables en `logica-consumos.js`, sección 6) sobre el parámetro `RNAdjustmentTypeID`:

| Categoría | Se marca cuando… |
|---|---|
| **1.ª compra** | `RNAdjustmentTypeID` contiene "1er Mes". |
| **Compra de paquete** | No es 1.ª compra ni recurrencia, y el tipo contiene "paquete", "plan", "suscrip…", "pague N" o "lleve N". |
| **Recurrencia** | El tipo contiene "recur" y no es 1.ª compra. |
| **Compra / ingreso** | No cae en ninguna de las anteriores, y el tipo contiene "compra", "recarga", "abono", "activaci…", "adquisic…", "ingreso de saldo" o "1er Mes" — o el monto es mayor que cero. |
| **Otro ajuste** | Nada de lo anterior (créditos/débitos administrativos, reversos, etc.). |

**"Vigente"** (badge en la columna Vigencia y borde izquierdo en la fila): dentro del rango de fechas consultado, es el movimiento **más reciente** de su categoría entre 1.ª compra / Compra de paquete / Compra-ingreso (`marcarVigentes()`). Recurrencias y otros ajustes nunca se marcan vigentes. **Esto NO es un cálculo de cobertura de ciclo** (esta herramienta no cuenta periodos ni "pague N lleve M" como Prepagadas): es solo "la compra más nueva que viste en este rango". Si el rango es muy corto puede no incluir la compra real vigente — para eso está también el badge **"Mes actual"**, independiente, que solo mira la fecha (`esMesActual()`).

---

## 5. Funcionalidad

### Tarjetas resumen

**Líneas consultadas**, **activas**, **sin datos en el CM** y **con error** (también filtran la tabla al hacer clic).

### Paso 1 · Conexión con el CM

Usuario y contraseña. Si otra herramienta ya inició sesión, las credenciales llegan solas.

### Paso 2 · Líneas a consultar

Igual que las demás herramientas: arrastra un Excel/CSV (se detecta la columna de línea) o escribe las líneas a mano, separadas por espacio, coma, `;` o salto de línea. La consulta masiva solo trae **línea + paquetes** (rápido); el histórico se trae por línea, al abrir su detalle.

### Tabla principal

Línea, estado, **identificación** (con el tipo entre paréntesis, ej. `123456789 (CC)`), **titular**, SubscriptionID, cuenta (BAN), Price Plan, paquetes activos y, por cada categoría (**Datos**, **Voz**, **SMS**), el **consumido / total** con el **disponible** debajo — sumando todos los bundles de esa categoría, de `bundleBalance` y sin consultar el histórico. Los bundles sin tope no suman al total y se anotan aparte (`+N sin límite`). Sin identificación en la cadena de cuentas, la celda queda en `—`. Botón **👁** para abrir el detalle.

### Modal de detalle

- **Datos de la línea**: titular, identificación, SubscriptionID, cuenta (BAN), estado, plan, fecha de creación. Todo el título es copiable con un clic (línea, SubscriptionID, BAN).
- **Otras cuentas (BAN)** de la línea, si tiene más de una: se puede cambiar cuál se usa para paquetes e histórico.
- **Paquetes · Uso y Balance**: tarjetas por bundle con **consumido / total** (y el porcentaje consumido), la barra de consumo y el **disponible** destacado debajo — mismo componente que Prepagadas, cambiado a la vez en las dos herramientas.
- **Movimientos y consumo del período** — un solo rango de fechas (**Desde / Hasta**, mes en curso por defecto) y botón **Consultar movimientos y consumo** que trae los dos juntos, con dos bloques debajo:
  - **Movimientos**: tarjetas (total, compras/paquetes, monto, vigentes) + tabla DataTables **paginada y filtrable por categoría** (dropdown "Categoría" arriba de la tabla). Las filas se colorean por categoría (mismos colores que "Movimientos BSS" de Prepagadas: amarillo 1.ª compra, ámbar compra de paquete, durazno compra/ingreso, verde recurrencia, gris otro ajuste) y llevan borde izquierdo negro cuando son la **vigente** de su categoría; la columna **Vigencia** además marca con un chip azul las que caen en el **mes en curso**. Exportación CSV/Excel/JSON propia, con el filtro de categoría aplicado.
  - **Consumo** (lo que ya traía la herramienta): tarjetas, gráficas de barras/torta, filtro Todos/Datos/Voz/SMS, tabla de detalle y su propia exportación — ver más abajo.
  - Se traen **todos** los registros del rango, sin tope, paginando de 500 en 500 cuantas veces haga falta (ver "Paginación del histórico" en la sección 4). Mientras tanto se muestra el conteo en vivo. Solo si el CM corta la paginación por su cuenta se avisa junto al conteo de que la lista puede estar incompleta.
- **Consumo**:
  - Tarjetas: Datos consumidos, Voz consumida, SMS enviados, total de registros — del período y tipo filtrados. Llevan una etiqueta ("filtro actual: …") que siempre coincide con el filtro de abajo.
  - Gráfica de **barras** (registros por día, apiladas por categoría cuando el filtro es "Todos") y de **torta** (proporción por categoría).
  - **Un único filtro Todos / Datos / Voz / SMS**, ubicado justo encima de la tabla de detalle y los botones de exportación: recalcula tarjetas, gráficas, tabla **y** exportación **a la vez** y **sin volver a consultar el CM** (es un filtro sobre lo ya traído). Se puso ahí a propósito — lo que exportas es exactamente lo que ves en la tabla.
  - Tabla de detalle: fecha, tipo (con dirección MO/MT cuando aplica), **origen y destino en columnas separadas**, uso (duración `hh:mm:ss` o datos, según el tipo), bundle, monto e ID. Botón **👁 Detalle** por fila: despliega una ficha con los campos crudos relevantes del registro (cuenta, línea, fechas de evento/registro, regla de tarifa, cargo, balance tras el evento, plan y bundle), sin los códigos internos de facturación que no tienen catálogo.

### Cargar paquete (v1.8.0) — lo único que escribe en el CM

Vive dentro del detalle, **debajo de «Paquetes · Uso y Balance»**, porque ese es el sitio donde el analista acaba de ver lo que la línea tiene: agregar es el paso natural siguiente. Está plegada por defecto (la herramienta sigue abriéndose como consulta) y se despliega con el botón **Cargar paquete**.

Son tres pasos, con el mismo lenguaje visual que los pasos de la columna izquierda:

**1 · Elegir.** Al desplegar, se resuelve la línea (perfil, titular y oferta del plan) y se trae el catálogo de esa oferta. El buscador filtra por **nombre, `bundleId` o `productId`** sobre los ~469 paquetes; cada resultado muestra sus dos identificadores, el precio si lo tiene y una marca **«ya activo»** si la línea ya lo trae. Se eligen con un clic y quedan como chips quitables. El catálogo se cachea **por oferta**, así que abrir otra línea del mismo plan no lo vuelve a pedir.

**2 · Revisar.** Tabla de exactamente lo que se va a enviar: los componentes obligatorios en `NO_CHANGE` y lo elegido en `ADD`, con precio y total. Un `<details>` muestra el **cuerpo JSON exacto** del carrito, igual que la simulación de "Cierre masivo de casos". Si algún paquete elegido ya está activo, se avisa; si el total es distinto de 0, **el botón de enviar queda bloqueado** (ver Riesgos).

**3 · Resultado.** Línea de tiempo de las cuatro operaciones (carrito → orden → limpieza → verificación) con su estado y su detalle, el número de orden `SOI…` copiable, y el **antes / después** de los paquetes de la línea. Si el CM todavía no refleja el cambio —tarda unos segundos— hay un botón **Verificar de nuevo** en vez de darlo por fallido. Cuando la verificación sale limpia, «Uso y Balance» se refresca solo.

Todo queda escrito en el registro del paso 3 de la izquierda: la selección enviada, el `cartId`, el `Transaction-Id`, el número de orden y el resultado de la verificación.

### Exportación

Barra superior: la **tabla de líneas** (lo que quede tras los filtros), en CSV / Excel / JSON. Dentro del detalle, movimientos y consumo **exportan por separado**, cada uno con su propio filtro aplicado (categoría en movimientos; Todos/Datos/Voz/SMS en consumo) — lo que exportas es exactamente lo que ves en esa tabla.

---

## 6. Estructura y lógica general

```txt
Paso 1 (sesión CM)  ->  Paso 2 (líneas)
                              |
                  por línea, en paralelo (ejecutarPool):
                    /api/v1/subscribers  ->  /api/v1/subscription/bundleBalance
                              |
                     tabla de líneas  ->  CSV / Excel / JSON
                              |
                  clic en una fila  ->  abrirDetalle()
                              |
          Promise.all: detailedSubscriptionTransaction + listDetailedCallDetailsWithBundles
                  (mismo rango de fechas, mes en curso por defecto, hasta 1.000 c/u)
                        |                              |
          marcarVigentes() (por categoría)    clasificación por tipo/dirección
                        |                              |
          filtro de categoría (cliente)        filtro de tipo (cliente)
                        |                              |
          tabla movimientos -> export          KPIs + gráficas + tabla -> export
```

---

## 7. Riesgos

- **Transporte HTTP plano** hacia el CM y Keycloak; el token queda en memoria del navegador.
- **«Cargar paquete» escribe de verdad y no se deshace desde aquí.** Una orden creada no tiene botón de reversa en esta herramienta; para revertir hay que ir al CM.
- **Solo paquetes de precio 0.** Es una guarda deliberada: la captura que sirvió de base agrega paquetes sin costo, y cómo se arma el cobro (`AMOUNT`, `AMOUNT_PAID`, `PAYMENT_METHOD`) cuando el paquete sí vale no está verificado. Adivinarlo sería cobrarle mal a un cliente, así que la selección con costo queda bloqueada hasta tener esa captura.
- **La orden no se reintenta sola.** El CM **no deduplica**: un reintento automático sobre una respuesta incierta cargaría el paquete dos veces. Si falla, la herramienta lo dice y para; verificar en el CM antes de volver a enviar es parte del procedimiento.
- **Quitar paquetes no está implementado.** El `action` del carrito admite `ADD` y `NO_CHANGE`; el valor para retirar no está confirmado en la captura, así que la herramienta solo agrega.
- **El carrito se borra siempre, pero puede fallar.** Si el `DELETE` no pasa, el carrito queda pegado al cliente y hay que borrarlo desde el CM. Se avisa en el registro con el `cartId`.
- **Re-agregar un paquete ya activo** está permitido (el CM los marca `Repurchaseable`) y se advierte en la revisión, pero su efecto exacto —renovar la vigencia o sumar otra instancia— no está verificado.
- **Clasificación por tipo**: cuatro códigos de `callType` están confirmados con datos reales (ver sección 4); un tipo de tráfico nuevo puede caer en "Otro" hasta que se agregue al catálogo.
- **Dirección (MO/MT)**: depende de que el registro traiga `ChargedParty` o un `RatingRule` con "MO"/"MT" reconocible; si no trae ninguno de los dos, la columna queda en blanco (no se supone MO ni MT).
- **Deduplicación por `identifier`**: si el CM alguna vez reutiliza un `identifier` para dos eventos distintos (no debería, pero no está garantizado), uno de los dos se perdería. No se ha visto este caso.
- **Rango muy amplio = muchas llamadas**: no hay tope de registros, así que un rango de varios meses con mucho tráfico son decenas de peticiones seguidas contra el CM (una por cada 500 registros). Es lento, no incorrecto; el conteo en vivo deja ver que sigue avanzando.
- **Paginación por ventana de fechas**: si el CM no devuelve `nextPageKey`, se pagina moviendo el `end` (ver sección 4). Hay un caso límite en el que esa ventana no puede avanzar: cuando hay más registros con **exactamente la misma fecha** que los que caben en una página. Ahí la lista se corta —sin duplicar ni inventar— y se marca como posiblemente incompleta en el aviso junto al conteo.
- **Multi-BAN**: al cambiar de cuenta en el detalle se limpian el histórico y los movimientos cargados (hay que volver a consultarlos); la tabla principal sigue mostrando la cuenta activa por defecto.
- **Dependencia de CDNs externos** (incluida Chart.js): si el CDN de las gráficas no carga, el resto de la herramienta sigue funcionando, pero sin gráficas.
- **"Vigente" es una noción simple, no un cálculo de ciclo**: es "la más reciente de su categoría **dentro del rango consultado**" (ver sección 4). Si el rango elegido no cubre la compra real vigente (por ejemplo, se compró un paquete "pague 3 lleve 4" hace dos meses y el rango solo mira el mes en curso), esta herramienta no lo va a marcar como vigente — para ese análisis de cobertura por ciclo existe "Prepagadas · SIME ⇄ CM".
- **Movimientos acotados al rango, no al historial completo**: a diferencia de "Movimientos BSS" en Prepagadas (que trae todo desde 2020 para encontrar la 1.ª compra real), aquí se pide solo el rango de fechas elegido — más rápido, pero un movimiento fuera de ese rango simplemente no aparece.

---

## 8. Historial de cambios

| Versión | Cambios |
|---|---|
| **1.8.0** | Nueva sección **«Cargar paquete»** dentro del detalle de la línea: agrega paquetes en el CM mediante carrito + orden de cambio de oferta, en tres pasos (elegir del catálogo de la oferta · revisar el cuerpo exacto · confirmar), con verificación contra `subscriberProfile`, borrado del carrito pase lo que pase, sin reintento automático de la orden y bloqueo de cualquier selección con costo. La lógica vive aparte en `assets/logica-paquetes-carga.js`; la consulta no cambió. |
| **1.7.0** | La identificación aparece en la cabecera del detalle con botón de copia rápida. La resolución del titular incorpora dos respaldos confirmados con el flujo de Postman: `individual.fullName` y el `id` de la cuenta como posible `individualID` cuando falta la relación `Individual`, conservando la búsqueda multinivel existente. |
| 1.6 | **Corrige un recorte introducido en la 1.5** y agrega reintentos. (1) El paginador usaba el tamaño de la página para decidir si quedaban más registros; como el CM no devuelve páginas de tamaño constante, cualquier página más corta que la anterior se tomaba por la última y la consulta terminaba antes de tiempo —trayendo **menos** registros que antes de la 1.5—. Ahora la única condición de fin es que una página no aporte **nada nuevo**. (2) Cuando el CM responde 500 en una página, ya no se corta la paginación con un aviso: se **reintenta** la misma petición (2 veces, con espera creciente) y, si sigue fallando, se vuelve a pedir la misma ventana con **la mitad de registros** hasta un piso de 50 — el tamaño reducido se mantiene para las páginas siguientes. Solo si se agota todo eso se da por perdida, devolviendo igual lo ya traído. (3) Una falla total de los movimientos ya no se muestra como "0 movimientos": queda marcada como incompleta. |
| 1.5 | **Se quita el tope de registros del resultado.** El `limit=500` es de la API (el CM rechaza más), no del resultado: ahora el rango de fechas elegido se trae completo, sin límite de registros — el paginador solo para cuando el CM da la lista por terminada. Queda una única guarda anti-bucle (1.000 páginas = 500.000 registros por línea y rango), que con datos normales no se alcanza y que si salta se reporta como error. Como un rango grande son varias páginas seguidas, el modal muestra el **conteo en vivo** mientras las trae. |
| 1.4 | **El histórico y los movimientos ya no se recortan**: el CM no siempre devuelve `nextPageKey`, así que la consulta se quedaba en la primera página (100 registros) sin avisar — un mes con más tráfico salía incompleto. Ahora un solo paginador (`paginarHistorico`) sigue por llave cuando la hay y, si no, por **ventana de fechas** (`end` = el registro más antiguo ya traído, inclusivo + deduplicado, sin huecos ni duplicados), midiendo "página llena" contra lo que el CM realmente devuelve y no contra el `limit` pedido. Se piden 500 registros por página -el máximo que acepta el CM, que con 1.000 responde error 500- y el tope de seguridad sube de 1.000 a 20.000 por listado, y cuando el corte puede dejar algo afuera se avisa junto al conteo. **Uso y balance más específico**: las tarjetas de paquetes (aquí y en Prepagadas) muestran ahora **consumido / total** con el porcentaje y el **disponible** destacado debajo; en la tabla principal las columnas de disponible pasan a **consumido / total + disponible** por categoría, y se agrega la de **SMS**. La exportación trae los tres números crudos (consumido, total y disponible) por categoría, para poder sumarlos en Excel. |
| 1.3 | La tabla principal, el modal y la exportación traen ahora la **identificación (cédula/NIT) y el nombre del titular** de la línea — porte directo de la lógica de `logica-rechazo.js` (sube por la cadena de cuentas del BAN hasta encontrar el documento). Se resuelve en paralelo con los paquetes, y de nuevo al cambiar de cuenta (BAN) en el modal. Sin identificación en la cadena de cuentas, o con el nombre de prueba "FirstName LastName", el campo queda vacío — nada se inventa. |
| 1.2 | Se agregan los **movimientos** (compras, paquetes, recurrencias y otros ajustes — `detailedSubscriptionTransaction`, mismo endpoint y clasificación que "Movimientos BSS" de Prepagadas, acotado al rango de fechas del histórico): tabla DataTables con paginación y filtro por categoría, filas coloreadas igual que Prepagadas, marcado de "vigente" (la más reciente de su categoría en el rango) y de "mes actual", KPIs propios y exportación CSV/Excel/JSON independiente. Se piden en paralelo con el histórico de consumo, con la misma fecha y el mismo botón «Consultar». |
| 1.1 | Se deduplican los registros repetidos del histórico (por `identifier`). Se corrige `duration`: venía en milisegundos y se interpretaba como segundos (mostraba minutos ~60x inflados); la tabla ahora muestra `hh:mm:ss`. Origen y Destino pasan a columnas separadas (antes iban combinados); se agrega dirección MO/MT (de `ChargedParty`/`RatingRule`) junto al tipo. Se agregan las columnas Monto (con la escala x10.000 correcta) e ID, y un botón «Detalle» por fila con la ficha completa de campos relevantes del registro crudo. El filtro Todos/Datos/Voz/SMS se reubica justo encima de la tabla y los botones de exportación (antes estaba junto a las fechas), para que quede visualmente claro que gráficas, tabla y exportación comparten el mismo filtro. Se confirman los `callType` 1 y 2 como Voz. |
| 1.0 | Versión inicial: datos de la línea, paquetes (uso y balance) e histórico de consumo con filtros de fecha/tipo, gráficas de barras y torta, y exportación. |
