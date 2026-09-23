# Ajustes y paquetes (CM) — Documentación técnica

> **Versión: v2.1.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Herramienta para consultar y exportar los **ajustes** que se hacen en el CM (Optiva): tanto los de **dinero** (créditos y débitos de saldo) como los de **paquetes** (bundles). Traduce los códigos del API a descripciones legibles mediante catálogos editables, resuelve el número de la línea a partir de la cuenta y exporta a **CSV / Excel / JSON**.

> Todo corre en el navegador del analista. No hay backend propio: la página habla directamente con Keycloak y con el API gateway del CM.

> **Relacionado (análisis, no implementado):**
> [`recarga-de-paquetes-cm.md`](recarga-de-paquetes-cm.md) documenta el flujo
> del CM para **agregar** paquetes a una línea (carrito + orden de cambio de
> oferta). Es material para un paso posterior y **requiere aprobación** antes
> de implementarse.

---

## 1. Objetivos

- Dar a la **operación** una vista de los ajustes por rango de fechas y estado, sin entrar al CM caso por caso.
- Traducir los códigos crudos del API (`reasonCode`, `type`, `category`) a texto entendible, con **catálogos que el analista puede editar** sin tocar código.
- Resolver el **número de la línea** de cada ajuste, que el API no devuelve directamente.
- Entregar montos ya convertidos (el API los da multiplicados por 10.000) y listos para sumar en Excel.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `export_ajustes.html` | Solo marcado: KPIs, pasos, pestañas y tablas. |
| `assets/logica-ajustes.js` | Reglas de negocio: consulta de ajustes, catálogos, columnas, resolución del número y exportación. |
| `assets/me-ajustes-puente.js` | Enganche con el shell: sesión, pestañas y fechas por defecto. |
| `assets/me-api.js` · `me-ui.js` · `me-ui.css` | Base común a las cuatro herramientas. |

---

## 3. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, pestañas, dropdowns. |
| **Bootstrap Icons** | 1.11.3 | Iconos de la interfaz. |
| **DataTables** | 2.3.2 (+ `bootstrap5`) | Tablas de ajustes de dinero y de paquetes. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Exportar a `.xlsx` con formato numérico. |
| **Tom Select** | 2.4.3 | Disponible para selects con búsqueda. |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** | Autenticación OpenID Connect del CM (direct grant / refresh token). |
| **API Gateway OBP** | Consulta de ajustes y de suscripciones (para el número de la línea). |

---

## 4. Endpoints

| Método | Endpoint | Para qué |
|---|---|---|
| `POST` | `{kcBase}/auth/realms/optiva/protocol/openid-connect/token` | Login y renovación (lo maneja `me-api.js`). |
| `GET` | `/api/v1/subscription/adjustment?from&to&statusId&bundleAdjustment&offset&limit` | **El endpoint principal.** `bundleAdjustment=false` trae ajustes de dinero; `true`, de paquetes. |
| `GET` | `/api/v1/subscription?accountID={id}&recurse=true` | Resuelve el **número (MSISDN)** de la cuenta del ajuste. |
| `GET` | `/api/v1/billingAccount` · `/api/v1/billingAccount/{id}` | Recorre la cuenta y sus padres para encontrar al titular. |
| `GET` | `/api/v1/individual/{id}` | Obtiene la identificación que se muestra y exporta como CC. |

Formato de los parámetros de fecha (con el separador de milisegundos que espera este API):

```txt
from = 2026-06-01T00:00:00:000
to   = 2026-06-30T23:59:59:999
```

Configuración propia de la herramienta:

```js
MEAPI.configurar({ locale: "en" });

// El API entrega los montos multiplicados por 10.000
money(row) = row.value.amount / 10000;

// El signo de la operación viene en `action`
activity(row) = Number(row.action) === 1 ? "Decremento" : "Incremento";
```

### Catálogos de códigos (editables)

Traducen lo que devuelve el API. Se editan desde la página y quedan guardados en el navegador (`localStorage`, clave `cmMaps`); el botón **Restaurar** vuelve a los valores de fábrica.

| Catálogo | Campo del API | Valores de fábrica |
|---|---|---|
| **Motivo** | `reasonCode` | 3 error en recarga · 4 consumo por demanda · 7 error al comprar paquete · 9 error en recarga de saldo · 10 recarga no aplicada · 12 saldo vencido · 17 consumos inconsistentes · 21 reposición de línea · 22 reposición · 24 doble activación de paquete |
| **Tipo** | `type` | 21000 crédito ajuste contact center *999 · 25000 débito ajuste contact center *999 · 50030 ajuste (crédito) · 50031 ajuste (débito) |
| **Categoría** | `category` | 20000 Exito Adjustments |

Un código que no esté en el catálogo se muestra como **«Sin catalogar»** o **«Código sin catalogar»**, nunca como número suelto.

---

## 5. Funcionalidad

### Tarjetas resumen

**Ajustes de dinero**, **ajustes de paquetes** y **suma de los ajustes de dinero** (en pesos, calculada sobre lo descargado).

### Paso 1 · Conexión con el CM

Usuario y contraseña. Si otra herramienta ya inició sesión, las credenciales llegan solas y el paso viene cerrado.

### Paso 2 · Qué se descarga

- **Desde** / **Hasta** (arrancan en el mes en curso). Si se indica solo *desde*, *hasta* toma la fecha de hoy.
- **Estado**: todos, `APPROVED`, `REJECTED`, `CREATED`, `COMPLETED`, `FAILED` o `PENDING_APPROVAL`.
- **Offset inicial** (1 = primero, sirve para reanudar una descarga interrumpida) y **límite** por página (1–100).
- **Páginas**: todas o solo una, con tope de **máx. páginas**.
- **Consultar el número de cada paquete**: hace una consulta por cuenta; con muchos registros la descarga de paquetes tarda bastante más.
- Botones **Descargar ajustes de dinero** y **Descargar paquetes**.

### Paso 3 · Catálogos de códigos

Editor de las tres tablas de traducción: agregar, editar y borrar filas. Al guardar, **los registros ya descargados se reinterpretan** con el catálogo nuevo, sin volver a consultar el API.

### Paso 4 · Registro

Log de la ejecución: cada `GET` con sus parámetros, el acumulado por página y el avance de la resolución de números.

### Pestañas de resultados

**Ajustes de dinero** y **Paquetes**, cada una con su tabla. Se exporta **la pestaña que se esté viendo**, en CSV / Excel / JSON, con el separador compartido (`;` por defecto). En Excel los montos van como número con formato (`#,##0.0000` en dinero, `#,##0` en paquetes) para poder sumarlos.

### Columnas

**Ajustes de dinero**: número, accountID, nombre del ajuste, tipo (descripción y mapeo), **monto en COP**, fecha de creación, estado, creado por, aprobado por, ¿aprobado?, tipo y categoría (código y mapeo), `subscriptionId`, fecha de aprobación, **motivo del ajuste**, actividad, `adjustmentId` y `transactionId`.

**Paquetes**: número, accountID, monto, unidad, actividad, fecha de creación, estado, creado por, aprobado por, ¿aprobado?, nombre del paquete, `subscriptionId`, subtipo, fecha de activación, fecha de aprobación y `adjustmentId`.

Estado, actividad y aprobación se muestran como etiquetas de color; las fechas se formatean en hora Colombia.

---

## 6. Estructura y lógica general

```txt
Paso 1 (sesión)  ->  Paso 2 (rango + estado + paginación)
                                   |
                     fetchAdjustments(bundleAdjustment)
                                   |
                        páginas de `limit` registros
                        hasta una página corta o el tope
                                   |
                     parseAdjustment()  ->  aplica catálogos, calcula
                                            monto, actividad, cuenta y
                                            fecha de aprobación
                                   |
              (solo paquetes)  resolveAll()  ->  número por cuenta, en paralelo
                                   v
                     tabla (dinero | paquetes)  ->  CSV / Excel / JSON
```

**Idea central:** el API devuelve códigos y montos crudos; toda la interpretación vive en **catálogos editables** y en funciones derivadas, de modo que un código nuevo se resuelve sin tocar el código fuente.

---

## 7. Flujo de la descarga en detalle

1. Se arman los parámetros: rango de fechas con el formato del API, estado (si se eligió), `bundleAdjustment` según el botón, `offset` y `limit`.
2. Se piden páginas de forma **secuencial**, avanzando el `offset` en `limit` cada vez, hasta que llegue una **página corta** (menos registros que el límite → fin de datos) o se alcance el tope de páginas.
3. Cada registro pasa por `parseAdjustment`, que añade los campos derivados: descripciones desde los catálogos, texto completo del motivo (código + descripción + notas), actividad, cuenta (`accountID` = parte del `subscriptionId` antes del guion), monto convertido y fecha de aprobación (primer evento `approved` o `completed` del historial).
4. Solo en paquetes, y si la casilla está marcada, `resolveAll` recorre las cuentas **únicas** con hasta 5 peticiones en paralelo y busca el número recursivamente en la respuesta (`mobileNumber`, `msisdn`, `phoneNumber`, etc.), cacheando por cuenta.
5. Se pinta la tabla correspondiente, se actualizan las tarjetas y se salta a esa pestaña.

---

## 8. Memoria

Todo vive en memoria: los registros crudos de cada pestaña, la caché de números por cuenta y los blobs de exportación. **No hay persistencia de resultados**: al recargar se pierde la descarga. Lo único que persiste son los **catálogos** editados.

---

## 9. Riesgos

- **Transporte HTTP plano** hacia el CM y Keycloak; el token queda en memoria del navegador.
- **Descarga secuencial**: las páginas se piden una tras otra, así que un rango amplio con `limit` bajo tarda. Conviene dejar el límite en 100.
- **Resolución de números**: es una consulta por cuenta. Con miles de paquetes puede tardar mucho y cargar el API; se puede desmarcar si solo se necesitan los montos.
- **Códigos sin catalogar**: un `reasonCode` o `type` nuevo aparece como «Sin catalogar» hasta que se agregue al catálogo. Es visible, pero fácil de pasar por alto en una exportación.
- **Catálogos por navegador**: se guardan en `localStorage`, así que **no se comparten entre equipos ni entre usuarios**. Si dos analistas los editan distinto, sus exportaciones no coinciden.
- **Factor 10.000**: si el API cambiara la escala de `value.amount`, todos los montos saldrían mal sin aviso.
- **Tope de páginas**: es una guarda de seguridad; si se alcanza, la descarga queda incompleta sin más señal que el conteo.
- **Sin reintentos de red salvo 401**: cualquier otro error corta la descarga en curso.
- **Dependencia de CDNs externos**: si un CDN está bloqueado o caído, la herramienta no carga.

---

## 10. Historial de cambios

| Versión | Cambios |
|---|---|
| **2.1.0** | Ajustes y Paquetes resuelven la identificación del titular subiendo por la cadena de cuentas. La columna **CC** queda al comienzo de ambas tablas, se incluye en CSV/Excel/JSON y trae botón de copia rápida. La opción de enriquecimiento ahora controla conjuntamente número y CC. |
| 2.0 | Migración a la base compartida: HTML solo con marcado, lógica en `assets/logica-ajustes.js` y acceso al CM en `me-api.js`. Se retira la barra propia con el medidor de token (ahora es el chip de la cabecera); las dos tablas pasan a pestañas al alto útil; se agrega exportación JSON y el selector de separador compartido; nuevo KPI con la suma de los ajustes de dinero; las fechas arrancan en el mes en curso; al guardar los catálogos se reinterpretan los registros ya descargados; botón para restaurar los catálogos de fábrica. Se corrigió una columna «Categoría (mapeo)» duplicada. |
| 1.1 | Editor de catálogos, resolución del número por cuenta y exportación CSV / XLSX con formato numérico. |
| 1.0 | Versión inicial: consulta de ajustes de dinero y de paquetes por rango y estado. |
