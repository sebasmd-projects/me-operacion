# Reporte de Suscripciones Prepagadas (SIME ⇄ CM) — Documentación técnica

> **Versión: v9.3** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Herramienta para **verificar de forma cruzada** las suscripciones prepagadas de **Móvil Éxito** entre dos plataformas: **SIME** (front de tipificación / negocio) y **CM / OBP** (Optiva). Por cada línea (MSISDN) consulta las dos fuentes, compara identificadores y fechas de compra, calcula los periodos del plan, detecta ciclos apilados y muestra todo en una tabla con detalle por línea, exportable a **CSV / Excel / JSON**.

> Todo corre en el navegador del analista. No hay backend propio: la página habla directamente con SIME (token `prf`), con Keycloak y con el API gateway de OBP.

---

## 1. Objetivos

- Dar a la **operación** una forma visual y sin código de **contrastar** lo que dice SIME contra lo que dice CM para cada línea prepagada, y detectar descuadres (ID distinto, fecha de 1.ª compra distinta, línea sin crear en SIME).
- Resolver por línea el **estado real** (activa / inactiva / suspendida / finalizada / cancelada) leyendo la *pestaña* de SIME, y el **estado en CM**.
- Traer el **titular de la línea** (cédula, nombre, correo) subiendo por la cadena de cuentas de facturación cuando el BAN de la línea es una cuenta hija.
- Calcular **periodos del plan** («lleve N») y, cuando hay recompras, la **cobertura combinada de ciclos apilados**.
- Mostrar **todos los adjustment type** del histórico de CM, resaltando compras, recurrencias y el ciclo vigente, además del **uso/balance** por bundle.
- **Registrar en SIME** la suscripción de un ciclo que existe en CM pero no está creada en SIME, y **editar recurrencias** planificadas.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `reporte_prepagadas.html` | Solo marcado: KPIs, pasos, filtros, tabla y modal de detalle. |
| `assets/logica-prepagadas.js` | Reglas de negocio: endpoints de SIME, clasificación de movimientos, catálogo de planes/PLU, ciclos, verificación, tabla y modal. |
| `assets/me-prepagadas-puente.js` | Enganche con el shell: chips de sesión, alto de la tabla, entrada de líneas, exportaciones y spinners. |
| `assets/me-api.js` | Keycloak, `auth` y consultas al CM. **Común a las cuatro herramientas.** |
| `assets/me-ui.js` / `me-ui.css` | Shell, registro, tablas y exportación. **Común.** |

Cambiar una consulta del CM se hace en `me-api.js`; cambiar una regla de prepagadas, en `logica-prepagadas.js`. El HTML no contiene JavaScript propio.

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, dropdowns, modal de detalle, badges. |
| **Bootstrap Icons** | 1.11.3 | Iconos de la interfaz. |
| **DataTables** | 2.3.2 (+ `bootstrap5`) | Tabla de resultados con paginado, búsqueda y orden. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Leer el archivo de líneas (`.xlsx`/`.csv`) y exportar a `.xlsx`. |
| **Tom Select** | 2.4.3 | Disponible para selects con búsqueda. |

| Servicio | Para qué se usa |
|---|---|
| **SIME** | Estado/pestaña de la línea, detalle de la suscripción, alta y recurrencias. Autenticación por header **`prf`**. |
| **SIME/Web** | Emite el token `prf` a partir de la **sesión de Windows (NTLM)**. |
| **Keycloak** | Autenticación OpenID Connect del CM (direct grant / refresh token). |
| **API Gateway OBP** | Suscriptores, transacciones, uso/balance y cuentas de facturación. |

---

## 4. Endpoints

### SIME (header `prf`)

| Método | Endpoint | Para qué |
|---|---|---|
| `GET` | `{simeBase}/Tiposuscription/1/{linea}` | Devuelve la **pestaña** (0–4) de la línea → estado. |
| `POST` | `{simeBase}/GetSuscripcionPresentePaginador/{pestana}` | Detalle de la suscripción. La paginación viaja en base64 en el header `pagination`. |
| `GET` | `{simeBase}/suscripcion/{b64(id)}` | Relee la suscripción al día tras editar una recurrencia. |
| `GET` | `{simeRecurrencias}/suscripcion/{b64(id)}` | Recurrencias planificadas de la suscripción. |
| `POST` | `{simeRegistrar}` | Alta de una suscripción. |
| `PUT` | `{simeEditarRecurrencia}` | Edita fecha de próxima ejecución y nº de recurrencia. |
| `GET` | `http://296vnext02.grupo-exito.com/SIME/Web` | Redirect del que se extrae el token `prf` (NTLM). |

```js
simeBase             = "https://tulio.grupo-exito.com/apimew/api/v1/simeCliente/SuscripcionRecurrente/SuscripcionRecurrente"
simeRecurrencias     = ".../simeCliente/SuscripcionRecurrente/recurrencia"   // OJO: raíz del módulo
simeRegistrar        = "https://titanio.grupo-exito.com/apiow/api/v1/DFXRWFBFZM/Suscription/registrar"
simeEditarRecurrencia= ".../apiow/api/v1/DFXRWFBFZM/Recurrencia/editar"
```

> El segmento `DFXRWFBFZM` parece un identificador de aplicación/versión del gateway y lo comparten el alta y la edición. Si alguno empieza a responder `404`, es lo primero que hay que actualizar.

### CM / OBP (vía `MEAPI.getJson`, con `Authorization: Bearer`)

| Método | Endpoint | Para qué |
|---|---|---|
| `GET` | `/api/v1/subscribers?msisdnList={linea}` | Todas las cuentas (BAN) de la línea y su estado. |
| `GET` | `/api/v1/subscription/{id}/detailedSubscriptionTransaction` | Histórico completo de movimientos (paginado). |
| `GET` | `/api/v1/subscription/bundleBalance?subscriptionID={id}` | Uso y balance por bundle. |
| `GET` | `/api/v1/billingAccount?externalID={ban}` | Cuenta de facturación de la línea. |
| `GET` | `/api/v1/billingAccount/{id}` | Cuenta por id, al subir por la cadena de cuentas. |
| `GET` | `/api/v1/individual/{id}` | Titular: `individualIdentification.identificationId` = **la cédula**. |
| `GET` | `/api/v1/customer/{id}` | Nombre y estado del cliente. |

Mapas de referencia:

- `PESTANAS` / `ESTADO_POR_PESTANA`: `0 → CANCELADA`, `1 → ACTIVA`, `2 → FINALIZADA`, `3 → SUSPENDIDA`, `4 → INACTIVA`.
- `ESTADOS_BSS`: `1 → Activo`, `2 → Desactivado`, `3 → Disponible`, `4 → Bloqueada`.
- `TIPO_DOC_BSS`: `6 → Cédula de ciudadanía` (único confirmado).
- `ESTADOS_RECURRENCIA`: `0 → Planificada` (único confirmado).
- `UNIT_TIPO`: `0` Voz, `1` Datos, `2` SMS, `3` Saldo.
- `RE_PRIMERA`, `RE_RECURRENCIA`, `RE_COMPRA_PLAN`, `RE_COMPRA`: expresiones **tuneables** que clasifican cada adjustment type.
- `CANALES`, `TIPOS_SUSCRIPCION`, `PLU_PRIMERA_COMPRA`: catálogos del formulario de alta.

---

## 5. Funcionalidad

### Tarjetas resumen (KPIs)

**Activas**, **Inactivas**, **Suspendidas**, **Sin crear en SIME** y **Verificación no coincide**. Además de contar, **filtran**: al hacer clic acotan la tabla y sincronizan el filtro correspondiente; un segundo clic lo quita. Cuentan solo las líneas **no ocultas**.

### Paso 1 · Conexión

Token SIME (`prf`) con botón **Obtener** (usa la sesión de Windows), usuario y contraseña del CM, y pruebas de conexión de ambos. Viene abierto solo si falta alguna sesión.

### Paso 2 · Líneas a consultar

- **Zona de arrastrar y soltar** para Excel (`.xlsx`) o CSV, con selección de **hoja** y **columna** (se detecta `linea`/`msisdn` sola).
- **Líneas manuales**: acepta espacio, tabulación, salto de línea, `,`, `;` y `|`; limpia `+57`, guiones y paréntesis. `Enter` lanza la consulta.
- **Consultas en paralelo** (el campo admite 1–100; el código acota a **1–10**).
- Barra de progreso con «Consultadas X de Y · última: …».

### Paso 3 · Registro

Log de la ejecución, con las instrucciones de uso impresas al abrir.

### Filtros y tabla

Filtros multi-selección por **Estado SIME**, **Pestaña**, **Estado CM** y **Verificación**, más mostrar/ocultar columnas, **Ver ocultas** y exportación CSV / Excel / JSON con el separador compartido. Los filtros están **fuera** de la tabla y siempre visibles.

Columnas: Línea, **Cédula**, Estado SIME, Pestaña, ID suscriptor CM, Estado CM, Plan, F. compra SIME, F. compra CM, Verificación, Periodos (barra + cobertura combinada), Próxima ejecución, **Comentario** (la más ancha, es la que más se lee) y Acción. **Clic en la fila abre el detalle**; el botón de acción no.

La tabla se esconde mientras no haya datos y aparece con el primer resultado. Su alto se calcula al píxel para que filtros, controles, filas y paginación quepan en pantalla, con scroll horizontal y vertical siempre a la vista.

### Modal · Detalle de la línea

- **Cabecera**: línea, BAN y cédula, con botón de **copiar** en cada uno.
- **Resumen** (estado, verificación, comentarios) y **Titular de la cuenta**.
- **Cuentas (BAN) de la línea**: todas, con su estado; **Ver servicios** recalcula todo el detalle con otra cuenta.
- **Tabla campo/valor** con el cruce SIME ⇄ CM.
- **Uso y Balance**: bundles por categoría (Voz, Datos, SMS, Saldo, Otros), cada uno con **consumido / total** y el porcentaje consumido arriba, la barra de consumo, y el **disponible** destacado debajo; más el vencimiento en hora Colombia. Es el mismo componente que usa "Consumos y Paquetes (CM)": si se cambia aquí, hay que cambiarlo allá (`usoHTML()` está duplicado en las dos lógicas).
- **Movimientos CM**: todos los adjustment type, con leyenda de colores y el ciclo vigente marcado.
- **Crear en SIME** (§8) y **Recurrencias de la suscripción** (§8).
- **Ciclos del plan** (plegado) y **Respuesta SIME / CM** en tabla legible, con el JSON crudo de respaldo.

---

## 6. Estructura y lógica general

```txt
Paso 1 (sesión) + Paso 2 (líneas)  ->  consultar()  ->  pool de workers (paralelo)
                                                            |
                                   por línea:  simeConsultarPestana -> simeGetSuscripcion
                                                            |
                                               (si hay CM)  bssBuscarLinea
                                                             ├─ bundleBalance
                                                             ├─ detailedSubscriptionTransaction (deduplicadas)
                                                             └─ billingAccount -> individual / customer
                                                            v
                                     procesar():  estado + periodos + ciclos + verificación + comentarios
                                                            v
                                     render()  ->  KPIs + tabla + filtros  ->  modal detalle
                                                            |                        |
                                                            |                  Crear en SIME
                                                            |                  Editar recurrencia
                                                            v
                                            exportar CSV / Excel / JSON
```

**Idea central:** para cada línea se cruzan **dos fuentes independientes** y se marca explícitamente cuándo coinciden y cuándo no, en lugar de confiar en una sola.

---

## 7. Flujo de la consulta

1. Se resuelve el **token SIME**, obteniéndolo por NTLM si el campo está vacío, y se asegura el **token del CM**. Si no hay CM, se sigue **solo con SIME**.
2. Se obtienen las líneas (archivo o manual) y se lanza un **pool de workers**.
3. Por línea:
   1. `Tiposuscription` → **pestaña** → estado SIME.
   2. `GetSuscripcionPresentePaginador/{pestana}` → detalle (`items[0]`).
   3. Si hay CM: `subscribers` → cuentas (BAN), y en paralelo `bundleBalance`, `detailedSubscriptionTransaction` (todo el histórico, deduplicado) y el titular.
4. `procesar` enriquece cada fila: **estado** desde la pestaña (`SIN_SIME` si SIME no devolvió ítems), **periodos** = `1 + recurrencias`, **ciclos apilados**, **verificación** cruzada y **comentarios**.
5. `render` pinta KPIs y tabla; el analista filtra, abre el detalle, registra en SIME lo que falte y exporta.

### Resolución de cuentas y BAN

Una línea puede devolver varias cuentas. Se conservan todas para el detalle, pero se elige la que está en **Activo (`state = 1`)** más reciente para consultar servicios y hacer la verificación. El estado de la línea sale directo de `status.state` de `/api/v1/subscribers`: **no** se consulta `/api/v1/subscription` para eso. Uso, movimientos y titular del BAN elegido se piden **en paralelo** y se cachean por `subscriberId`.

### Resolución del titular (cédula)

El BAN de la línea suele ser una **cuenta hija** cuyo `relatedParty` no trae documento. Se sube por `parentId` y, cuando no viene, por `accountRelationship[].account.id`, hasta **5 saltos**, buscando un `individual` con documento. Si no aparece, queda registrado en el log y la fila sin cédula.

### Clasificación de movimientos

Cada movimiento se etiqueta como **1.ª compra**, **compra de paquete**, **compra/ingreso de saldo**, **recurrencia** u **otro ajuste**. Solo la **1.ª compra («1er Mes»)** abre un ciclo del plan: las recurrencias renuevan el mismo ciclo y los paquetes que acompañan cada cobro son aprovisionamiento. Si en tu CM una recompra no se llama «1er Mes», basta añadir su patrón a `RE_PRIMERA`.

Si no hay ninguna transacción que case con `RE_PRIMERA`, se usa como respaldo la última con monto positivo y la fila queda marcada con `primeraPorMonto`.

### Ciclos apilados («pague N lleve M»)

Cada compra cubre `total` meses consecutivos desde el mes de compra; varias pueden **solaparse** y seguir vigentes. Por ciclo: `completados = clamp(hoyIdx − iniIdx, 0, total)`, `restantes = total − completados`, `vigente = hoyIdx ≤ iniIdx + total − 1`. La **cobertura combinada** es el rango `min(mes vigente) → max(mes fin)`, **no** la suma de meses.

---

## 8. Alta y mantenimiento de suscripciones en SIME

### Regla de negocio: el plan es el campo maestro

> **El «Tipo de suscripción (plan)» es el campo maestro. Cada vez que cambia, los campos derivados se recalculan y se reemplazan, sin importar lo que tuvieran antes.**

| Campo derivado | De dónde sale (en orden de prioridad) |
|---|---|
| **ID tipo suscripción** | `catalogoAprendido()` (dato real de SIME) → posición en `TIPOS_SUSCRIPCION` + 1 (supuesto) |
| **Canal de venta** | `catalogoAprendido()` (`canalId` real) → `canalDeNombre()` (sufijo del nombre del plan) |
| **PLU 1.ª compra** | `catalogoPlu()`: PLU aprendido de SIME → `PLU_PRIMERA_COMPRA` → vacío si el plan exige PLU manual |

Sin plan seleccionado, los tres quedan **en blanco**: nunca se heredan del plan anterior. Antes de la v7.2 el canal solo se rellenaba si estaba vacío, y al cambiar de plan sobre una suscripción finalizada SIME respondía `400 One or more validation errors occurred`.

### Campos de solo lectura

Valores fijos del proceso (`tipoDocumento: "CC"`, `documento: "0"`, `adicionalesSuscripcion: "{}"`, `transaccionId: ""`, `id: 0`), más **ID tipo suscripción** (derivado del plan) y **Usuario creación** (del token `prf`). Viajan en el payload, pero no se escriben a mano.

### Campos editables

- **Tipo de suscripción (plan)**, con **buscador** sobre los ~70 planes: ignora acentos y signos (`19900` encuentra `$19.900`) y admite varias palabras (`lleve 12 pos`). `Enter` selecciona el primer resultado.
- **Línea (MSISDN) a registrar**: editable a propósito, por portabilidad o cambio de número. El botón `↺` vuelve a la consultada y avisa cuando difieren.
- **Canal de venta** y **PLU**: se autocompletan pero se pueden corregir (p. ej. `Generico Primera compra Presente`, cuyo PLU depende de la venta).
- **ID suscripción Optiva**, **Fecha y hora de compra** (hora Colombia) y **Recurrente**.

### Salvaguardas

Si la línea **ya tiene** suscripción en SIME se muestra advertencia de duplicidad y hay que marcar una casilla de confirmación. La validación bloquea el envío listando exactamente qué falta. Tras un alta exitosa sobre la misma línea se vuelve a consultar y se actualiza la fila; si se registró **otra** línea, se avisa que hay que consultarla aparte.

### Editar una recurrencia planificada

Toda suscripción con `suscripcionRecurrenteId` lista sus recurrencias (nº, id, próxima ejecución, estado, PLU, fechas de ejecución, usuario que planifica y modificaciones). Con **✎ Editar** se cambian dos campos: **próxima ejecución** (hora Colombia, viaja con sufijo `.000Z`) y **nº de recurrencia** (SIME lo espera como **texto**; cambiarlo altera el ciclo que SIME considera en curso). Antes de guardar se muestra el diff «antes → después» y el JSON exacto del `PUT`. Al guardar, SIME registra la modificación en `detalles` (`AnteriorFechaProxEjec`) y la herramienta relee la suscripción y repinta la fila.

---

## 9. Validaciones, memoria y concurrencia

- **Por línea, tolerante a fallos**: la consulta de una línea **nunca lanza**; si SIME falla, la fila queda con `error` y se intenta CM igual, de modo que un error puntual no tumba la ejecución.
- **401 en CM**: se reintenta **una vez** tras re-autenticar, con renovación compartida entre workers.
- **Memoria**: todo vive en memoria (`filas`, caché de servicios por `subscriberId`, blobs de exportación). No hay persistencia de resultados: al recargar se pierde la ejecución.
- **Concurrencia**: el resultado se guarda por índice, así que **se conserva el orden del archivo** aunque las líneas terminen desordenadas. Más paralelo es más rápido, pero más carga sobre SIME y CM.
- **Volumen**: el cuello de botella es el número de peticiones (2 a ~7 por línea): `tiempo ≈ líneas × llamadas ÷ paralelo`. Con volúmenes muy grandes conviene exportar a CSV en vez de Excel.

---

## 10. Riesgos

- **Transporte**: CM y Keycloak son **HTTP plano**; SIME es HTTPS.
- **Dependencia de la sesión de Windows (NTLM)** para obtener el `prf` automáticamente.
- **Catálogo de planes desactualizado**: `TIPOS_SUSCRIPCION` y `PLU_PRIMERA_COMPRA` son listas fijas. Si SIME agrega planes, el ID por «posición + 1» y el PLU dejan de ser confiables hasta actualizarlas (el formulario marca `✓id` / `✓PLU` cuando el dato es real).
- **Endpoints de escritura**: el segmento `DFXRWFBFZM` lo comparten el alta y la edición de recurrencias; si cambia, ambos fallan con `404`.
- **Edición de recurrencias sin deshacer**: el `PUT` no tiene reverso desde la herramienta.
- **Clasificación de adjustment type**: depende de las regex; un tipo nuevo puede quedar mal categorizado (mitigado por ser configurable).
- **Sin reintentos de red salvo 401**: cualquier otro error deja esa línea incompleta.
- **Duplicados del API de transacciones**: mitigados con dedupe por firma (receipt + fecha + tipo + monto); si cambia el formato del receipt hay que revisar la clave.
- **Dependencia de CDNs externos** y **memoria** en exportaciones muy grandes.

---

## 11. Historial de cambios

| Versión | Cambios |
|---|---|
| **9.3** | **Uso y Balance más específico**: cada bundle muestra ahora **consumido / total** (con el porcentaje) arriba y el **disponible** destacado debajo, en vez de "disponible / total" con el consumo en letra pequeña. Mismo cambio, a la vez, en "Consumos y Paquetes (CM)". |
| 9.2 | Cambio en la tabla de líneas, para que las acciones aparezcan de primeras. |
| 9.1 | Migración a la base compartida: el HTML queda solo con marcado, la lógica pasa a `assets/logica-prepagadas.js` y el acceso al CM a `assets/me-api.js`. Nuevo shell (menú lateral, chips de sesión, pie con tiempo abierto), pasos plegables, tabla al alto útil que se oculta sin datos, entrada de líneas con más separadores, exportación con separador `;` por defecto y JSON, y spinner en las acciones lentas. |
| 9.0 | Rediseño de la interfaz sobre el sistema común `me-ui`. |
| 8.1 | Lanzador `dame click.bat` y tabla con `scrollX`+`scrollY`. |
| 8.0 | Buscador en el catálogo de planes y edición de recurrencias. |
| 7.2 | El plan pasa a ser campo maestro (elimina el `400` al cambiar de plan). |
| 7.1 | Base documentada: verificación cruzada, multi-BAN, titular, uso/balance, ciclos apilados y alta en SIME. |
