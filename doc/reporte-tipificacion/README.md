# Exportar casos · Tipificación — Documentación técnica

> **Versión: v2.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Herramienta para exportar casos/tickets del CRM de tipificación de **Móvil Éxito** (plataforma Optiva / OBP). Se autentica contra Keycloak, consulta el API gateway interno, descarga los casos paginados, los enriquece con datos relacionados (usuarios, grupos, organizaciones, estados, prioridades) y permite exportarlos a **CSV / Excel / JSON**.

> Todo corre en el navegador del operador. No hay backend propio: la página habla directamente con Keycloak y con el API gateway.

---

## 1. Objetivos

- Dar a la **operación** una forma visual y sin código de exportar casos filtrados por **estado** y **rango de fechas**.
- Sortear el **límite de ventana de Elasticsearch (10.000 resultados por consulta)** dividiendo automáticamente el rango de fechas.
- No depender del conteo del API (`tickets_count`), que en esta plataforma **no es confiable**: la descarga se guía por las páginas reales, no por el número reportado.
- Entregar el resultado en los formatos que la operación ya usa, con las columnas más útiles al frente.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `export_tipificacion.html` | Solo marcado: KPIs, pasos, pestañas y tablas. |
| `assets/logica-tipificacion.js` | Reglas de negocio: armado de la query, motor de descarga, división de rangos, enriquecimiento y validaciones. |
| `assets/me-tipificacion-puente.js` | Enganche con el shell: sesión, pestañas y registro. |
| `assets/me-api.js` · `me-ui.js` · `me-ui.css` | Base común a las cuatro herramientas. |

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, pestañas, pills de autenticación. |
| **Bootstrap Icons** | 1.11.3 | Iconos de la interfaz. |
| **DataTables** | 2.3.2 (+ `bootstrap5`) | Tablas de resultados y de vista previa. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **Tom Select** | 2.4.3 | Selects con búsqueda: **Estados** (multi, editable) y **Ordenar por** (simple). |
| **SheetJS (xlsx)** | 0.18.5 | Exportar a `.xlsx`. |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** | Autenticación OpenID Connect (direct grant / refresh token). |
| **API Gateway OBP** | Búsqueda de casos. |

---

## 4. Endpoints

| Método | Endpoint | Para qué |
|---|---|---|
| `POST` | `{kcBase}/auth/realms/optiva/protocol/openid-connect/token` | Login y renovación (lo maneja `me-api.js`). |
| `GET` | `/api/v1/case/search?query&page&per_page&sort_by&order_by` | **El único endpoint de datos.** Devuelve `tickets` (ids), `assets` (User, Group, Organization, TicketState, TicketPriority, Ticket) y `tickets_count`. |

La consulta se arma en formato Lucene:

```txt
state_id:("13" OR "10" OR "12") AND created_at:["2026-06-01" TO "2026-06-30"]
```

Configuración propia de la herramienta:

```js
MEAPI.configurar({ locale: "en" });   // el CRM responde estados y prioridades en inglés

LIMITE_ES  = 10000;  // ventana máxima de Elasticsearch (page * per_page)
MAX_DIAS   = 31;     // rango de fechas máximo por consulta
COLS_FRONT = [...];  // orden preferido de columnas en la exportación
```

`COLS_FRONT` define qué columnas van primero en los archivos (number, title, state, priority, owner, customer, fechas, category1..5, msisdn, imsi, etc.). El resto se agrega detrás, en orden de aparición.

---

## 5. Funcionalidad

### Tarjetas resumen

**Casos descargados**, **columnas en la salida** y **duración de la descarga**. Son informativas.

### Paso 1 · Autenticación

Dos pestañas, una **u** otra:

- **Usuario y clave** del CRM: *direct grant* de Keycloak. El token se pide solo y se renueva al expirar o ante un 401.
- **Token**: pegar un access token ya emitido, con refresh token opcional. Útil si Keycloak no permite direct grant. Un token pegado no trae vencimiento, así que el chip lo muestra activo sin cuenta regresiva y no se renueva solo.

### Paso 2 · Filtros

- **Solo lo de hoy**: fija el rango a la fecha actual y deshabilita las fechas.
- **Desde** / **Hasta**: obligatorio, máximo **31 días**.
- **Estados** (`state_id`): solo números, por defecto `13, 10, 12`; se agregan con Enter.
- **Por página** (1–100), **Ordenar por**, **Orden** (`asc`/`desc`) y **En paralelo** (1–10).

### Paso 3 · Páginas a descargar

- **Todas las páginas**: recorre el rango completo y **divide por fechas** si topa el límite de 10.000.
- **Una página específica** o **rango de páginas**: aplican sobre la consulta completa y **no** dividen fechas.

### Paso 4 · Descarga y progreso

**Vista previa (1 página)** trae una sola página y muestra el primer ticket campo por campo, para confirmar los filtros antes de bajar todo. **Descargar casos** ejecuta la descarga completa. **Cancelar** marca la bandera.

### Paso 5 · Registro

Log de la ejecución: query enviada, páginas pedidas, acumulado, divisiones de rango y avisos.

### Pestañas de resultados

**Resultados** (todos los casos descargados, con exportación **CSV / Excel / JSON**) y **Vista previa** (el primer ticket enriquecido, campo por campo). Ambas tablas ocupan el alto útil y se ocultan mientras no haya datos.

### Validaciones

Se ejecutan antes de cualquier descarga o vista previa: marcan el campo en rojo, **abren el paso donde está el error**, hacen scroll y foco, y lo escriben en el registro.

- **Autenticación**: token **o** usuario + contraseña.
- **Fechas**: obligatorias (salvo *solo hoy*), `Hasta ≥ Desde` y rango ≤ 31 días.
- **Estados**: al menos uno y todos numéricos; si hay no numéricos, se listan cuáles.
- **Por página** 1–100 · **Paralelo** 1–10.
- **Modo de páginas**: `one` → página ≥ 1; `range` → `desde ≥ 1` y `hasta ≥ desde`.
- La marca de error se quita apenas se corrige el campo.

---

## 6. Estructura y lógica general

```txt
Pasos 1–3 (credenciales + filtros)  ->  validarYLeer()
                                             |
                        (all)        descargarRangoFechas()  ──┐
                        (one/range)  descargarPaginasEspecificas()
                                             |                 │  divide el rango
                                     descargarPaginas()  <─────┘  si topa 10.000
                                             |
                                lotes de N páginas en paralelo
                                             |
                          ids + assets  ->  dedupe  ->  enrich()  ->  flatten()
                                             v
                              tabla de resultados  ->  CSV / Excel / JSON
```

**Idea central:** la descarga confía en las **páginas reales** —sigue pidiendo hasta que una página venga corta o vacía—, no en `tickets_count`. Eso la hace resistente a un conteo mentiroso del API.

---

## 7. Flujo de la descarga en detalle

1. Se arma la query con los estados y el rango de fechas.
2. `contarCasos` (con `per_page=1`) estima el total. **Solo** alimenta la barra de progreso y decide si conviene **pre-dividir** el rango.
3. `descargarPaginas` pide **lotes** de hasta `concurrencia` páginas consecutivas con `Promise.all`, guarda los resultados en un `Map`, los **reensambla en orden de página**, acumula ids y mezcla los `assets`.
4. Continúa hasta que aparece una **página corta** (`length < perPage` → fin de datos) o se alcanza `maxPagES` (la ventana de 10.000). Si topa la ventana con páginas aún llenas, marca `truncado`.
5. En modo *todas las páginas*, si `truncado` —o si el conteo previo ya daba ≥ 10.000— el rango se **divide por la mitad** y cada mitad se procesa recursivamente. Así se superan los 10.000 **por consulta** sumando sub-rangos.
6. Al terminar se recorren los ids, se **de-duplican**, se enriquecen con el store (`owner`, `customer`, `group`, `organization`, `state`, `priority` y sus correos) y se cuentan faltantes y duplicados.
7. Los registros se aplanan (`flatten`) y se ordenan las columnas (`COLS_FRONT` primero) para la tabla y los archivos.

### Concurrencia

`concurrencia` (1–10) es cuántas **páginas** se piden a la vez por lote. La detección de fin se evalúa **por lote**: puede pedir un lote completo aunque los datos terminen a mitad (las páginas de más vuelven vacías, sin efecto negativo salvo unas peticiones extra). La renovación del token es segura ante concurrencia: si varias peticiones reciben 401 a la vez, solo una renueva.

---

## 8. Memoria y volúmenes grandes

Todo vive en memoria: el `store` de assets, los ids, los registros enriquecidos y la copia lista para exportar (que **duplica** datos: registros + filas aplanadas). No hay persistencia: al recargar se pierde la descarga.

Dos límites distintos:

- **Por consulta (10.000).** Elasticsearch solo devuelve `page × per_page ≤ 10.000`. Ninguna consulta individual trae más.
- **Total acumulado.** En modo *todas las páginas*, como el rango se divide por fechas, sí se pueden superar los 100.000 casos, siempre que **cada sub-rango** quede por debajo de 10.000.

Puntos críticos:

- **Un solo día con más de 10.000 casos** no se puede dividir más (la unidad mínima es el día): solo se traen los primeros 10.000 y el resto queda inaccesible, avisado con un `warn` en el registro.
- **Modos una página / rango**: no dividen fechas, así que topan en 10.000.
- Con 100.000+ filas, `XLSX.writeFile` arma el workbook completo en memoria y puede congelar la pestaña: conviene **CSV o JSON**.

---

## 9. Riesgos

- **Transporte HTTP plano** hacia el CRM y Keycloak; el token pegado a mano queda además en el DOM.
- **Pérdida de datos silenciosa**: un día con más de 10.000 casos pierde el excedente, y solo queda constancia en el registro. Los ids sin detalle en `assets` se exportan como `_sin_detalle_en_assets`.
- **Sin reintentos de red salvo 401**: cualquier otro error en una página aborta el lote y la descarga, sin guardado parcial.
- **Estabilidad de la paginación**: se de-duplican ids porque el API puede repetir resultados entre páginas. Ordenar por un campo único (p. ej. `id`) lo reduce.
- **Cancelación no inmediata**: solo se revisa entre lotes; las peticiones en vuelo terminan igual.
- **`tickets_count` no confiable**: asumido por diseño, pero implica que el porcentaje de progreso puede ser impreciso.
- **Token pegado a mano**: no se renueva solo; al vencer aparece el 401 en el registro y hay que pegar otro o pasar a usuario y clave.
- **Memoria** en exportaciones grandes y **dependencia de CDNs externos**.

---

## 10. Historial de cambios

| Versión | Cambios |
|---|---|
| **2.0** | Migración a la base compartida: HTML solo con marcado, lógica en `assets/logica-tipificacion.js` y acceso al CRM en `me-api.js`. Se retira el sidenav propio; los tres pasos pasan al shell y los botones de acción a un paso de descarga; resultados y vista previa en pestañas al alto útil; validaciones que abren el paso del error; exportación con el separador compartido (`;` por defecto). |
| 1.0 | Versión inicial: descarga por rango y estados, división recursiva de fechas ante el límite de 10.000, enriquecimiento con assets y exportación CSV / Excel / JSON. |
