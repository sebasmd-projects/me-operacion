# Cierre masivo de casos (CM) — Documentación técnica

> **Versión: v3.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Herramienta para **trabajar por lotes** los casos del CM a partir de un Excel de la operación. Por cada número de caso busca su ticket en el CM, trae el título y el estado actuales y, según lo que traiga la columna **Favorable**, lo cierra con el resultado o se limita a agregarle la nota. Trae **modo simulación encendido por defecto**: hace todo menos el `PATCH`.

> Todo corre en el navegador del analista. No hay backend propio: la página habla directamente con Keycloak y con el API gateway del CM.

---

## 1. La regla del archivo

La columna **Favorable** decide **qué se hace** con el ticket, no solo si se hace:

| Columna «Favorable» | Nota | Acción | Título | Estado |
|---|---|---|---|---|
| `Sí` (si, s, 1, x, favorable, positivo, procede…) | obligatoria | **cierre** | título actual + separador + texto favorable | estado final configurado |
| `No` (no, n, 0, desfavorable, negativo, no procede…) | obligatoria | **cierre** | título actual + separador + texto desfavorable | estado final configurado |
| vacía o no reconocida | **con** nota | **solo nota** | *no se toca* | *no se toca* (se reenvía el mismo) |
| vacía o no reconocida | sin nota | **ninguna** | — | — (la fila queda *omitida*) |

Quien decide es `accionDe(fila)` en `assets/logica-casos.js`, y de ahí cuelga todo lo demás: el título calculado, el cuerpo del `PATCH`, la habilitación de los botones, el informe y la exportación.

Dos consecuencias que conviene tener presentes:

- En modo **solo nota** el título es de **solo lectura** en la tabla y `calcularTituloNuevo()` devuelve el título del CM tal cual: ni siquiera se le quita un `/ Favorable` de un cierre anterior, porque eso ya sería modificarlo.
- Un valor **no reconocido** en la columna Favorable (ni Sí ni No) se trata como vacío, o sea *solo nota*. El valor crudo queda en la columna «Favorable (archivo)» y en la exportación para poder auditarlo.

---

## 2. Objetivos

- Cerrar decenas o cientos de casos sin entrar uno por uno al CM, y dejar anotados los que todavía no se cierran.
- **Obligar a la revisión antes de enviar**: primero se busca, se revisa en la tabla y solo entonces se envía. No hay un botón que haga ambas cosas.
- No tocar lo que no corresponde: solo el ticket cuyo número **coincide exacto**, y nada sin nota.
- No re-cerrar ni anotar lo ya cerrado: si en el CM el ticket figura como `resolved` / `closed` / `cancelled`, se desmarca solo y queda registrado.
- Dejar un **informe exportable** de lo que pasó con cada caso, incluido el cuerpo enviado y la respuesta del API.

---

## 3. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `reporte_casos_masivos.html` | Solo marcado: KPIs, pasos, pestañas, tablas y modal de detalle. |
| `assets/logica-casos.js` | Reglas de negocio: lectura del Excel, mapeo de columnas, `accionDe()`, armado del título, búsqueda del ticket y `PATCH`. |
| `assets/me-casos-puente.js` | Enganche con el shell: sesión, pestañas, habilitación de botones y spinners. |
| `assets/me-api.js` · `me-ui.js` · `me-ui.css` | Base común a las cuatro herramientas. |

---

## 4. Herramientas de terceros

| Librería | Versión | Para qué se usa |
|---|---|---|
| **Bootstrap** | 5.3.3 | Rejilla, formularios, pestañas, dropdowns, modal. |
| **Bootstrap Icons** | 1.11.3 | Iconos de la interfaz. |
| **DataTables** | 2.3.2 (+ `bootstrap5`) | Tabla de trabajo (editable) y tabla del informe. |
| **jQuery** | 3.7.1 | Dependencia de DataTables. |
| **SheetJS (xlsx)** | 0.18.5 | Leer el Excel de casos y exportar a `.xlsx`. |
| **Tom Select** | 2.4.3 | Disponible para selects con búsqueda. |

| Servicio | Para qué se usa |
|---|---|
| **Keycloak** | Autenticación OpenID Connect del CM (direct grant / refresh token). |
| **API Gateway OBP** | Búsqueda de casos, lectura y actualización de tickets, historial y usuarios. |

---

## 5. Endpoints

Todos vía `MEAPI.api("/api/v1" + ruta)`, con `Authorization: Bearer` y las cabeceras comunes (`locale: "en"`, `spid`, `tenant`).

| Método | Endpoint | Para qué |
|---|---|---|
| `GET` | `/api/v1/case/search?query="{numeroCaso}"&page&per_page&sort_by&order_by` | Busca el o los tickets del caso. Acepta el arreglo plano y el envoltorio antiguo. |
| `GET` | `/api/v1/troubleTicket/{id}/` | Título y estado actuales del ticket. |
| `GET` | `/api/v1/caseManagement/ticket_history/{id}` | Historial, para saber quién creó el ticket (opcional). |
| `GET` | `/api/v1/caseManagement/users/{id}` | Nombre y correo del creador (opcional). |
| `PATCH` | `/api/v1/troubleTicket/{id}` | **El envío**: cierre (título nuevo + `status` final + nota) o solo nota (mismo título, mismo `status`). `Content-Type: text/plain;charset=UTF-8`. |

```js
MEAPI.configurar({ locale: "en" });   // el CM responde los estados TMF en inglés

ESTADOS_CERRADOS = ["resolved","closed","cancelled","canceled",
                    "resuelto","cerrado","cancelado","solucionado","anulado"];
```

---

## 6. Funcionalidad

### Tarjetas resumen (KPIs)

**Casos cargados**, **Pendientes**, **Preparadas**, **Cerradas**, **Solo con nota**, **Con error** y **Ya estaban cerrados**. Al hacer clic **filtran** la tabla por ese estado del proceso y saltan a la pestaña de casos; un segundo clic quita el filtro.

### Paso 1 · Conexión con el CM

Usuario y contraseña, botón de iniciar sesión y de renovar token. Si el lanzador dejó las credenciales, la sesión se inicia sola y el paso viene cerrado.

### Paso 2 · Archivo, hoja y columnas

- **Zona de arrastrar y soltar** para `.xlsx`, `.xlsm`, `.xls` o `.csv`, con selección de **hoja** y **fila de títulos**.
- **Mapeo de columnas**: se detecta solo por el nombre del encabezado y se puede corregir campo por campo. El único obligatorio es el **número de caso**; **favorable** y **nota** deciden la acción de cada fila.
- **Vista previa** de las primeras filas de la hoja.
- **Cargar hoja a la tabla** arma las filas de trabajo, deja en el registro cuántas van a cerrarse, cuántas son solo nota y cuántas quedan sin acción, y pasa el foco a la ejecución.

### Paso 3 · Reglas del cierre

Arranca con la tabla de la regla Sí / No / vacío. Debajo: **estado final** (`resolved` / `closed` / `cancelled`), **separador del título**, **textos** de favorable y desfavorable, **peticiones en paralelo**, **reintentos por caso** y **resultados por búsqueda**. Opcionales: traer todos los tickets del caso, agregar el resultado al título nuevo y consultar quién creó el ticket. Las preferencias quedan guardadas en el navegador.

Tres reglas **no** son configurables, porque son la salvaguarda del proceso:

- solo se toca el ticket cuyo número **coincide exacto**;
- sin resultado **no se cierra** ni se cambia el título;
- no se cierra ningún caso **sin nota**.

### Paso 4 · Ejecución y progreso

**Buscar tickets** y **Cerrar casos**, separados a propósito, más **Pausar**, **Cancelar** y **Reintentar los que fallaron**. Barra de progreso con estimación de tiempo restante y contador de marcadas.

| Botón | Se habilita cuando |
|---|---|
| Buscar tickets | hay filas marcadas y visibles **sin ticket** |
| Cerrar casos | hay filas marcadas **con ticket ya buscado** y con acción (cierre o nota) |
| Reintentar | hay filas en error / sin ticket / omitidas |

El `title` de «Cerrar casos» dice cuántas van a cerrarse y cuántas solo recibirán la nota. Los tres se bloquean mientras corre una tanda.

### Simulación

Arranca **encendida**: hace todo menos el `PATCH`, y deja el cuerpo que se habría enviado disponible en el botón **Ver** de cada fila (estados *simulado* y *nota simulada*). Al apagarla aparece un aviso permanente y el envío pide confirmación explícita, con el desglose de cierres y notas.

### Pestaña · Casos y edición

Filtros por estado del proceso, **acción**, estado del archivo, resultado, selección y texto libre; mostrar/ocultar columnas; marcar y ocultar filas en lote. En la tabla se editan **resultado**, **título nuevo** y **nota de cierre**:

- cambiar el resultado a «— solo nota —» bloquea el título y descarta la edición manual;
- la nota vacía en una fila que sí se cierra se marca en rojo;
- escribir una nota en una fila sin resultado la pasa de *sin acción* a *solo nota* al instante.

### Pestaña · Informe y exportación

Los mismos datos en solo lectura, con **filtros propios** (incluida la acción) independientes de los de la tabla de trabajo, y exportación **CSV / Excel / JSON** con alcance configurable (lo que muestra el informe, lo visible en la tabla de trabajo, todas, marcadas, cerradas, **solo con nota**, ya cerradas o con error) y la opción de incluir las columnas originales del archivo.

---

## 7. Estructura y lógica general

```txt
Paso 1 (sesión)  ->  Paso 2 (Excel + mapeo)  ->  filas de trabajo
                                                      |
                        marcar en la tabla lo que se va a trabajar
                                                      |
                        [1] tandaBuscar()  ->  case/search  ->  troubleTicket/{id}
                                                      |         (+ historial y usuario, opcional)
                                             estado: preparado / sin ticket / ya cerrado
                                                      |
                        revisión manual: resultado, título nuevo y nota
                                                      |
                        [2] tandaCerrar()  ->  accionDe()
                                                 |          |
                                            "cierre"      "nota"
                                                 |          |
                                        título + status   mismo título
                                          + nota            mismo status + nota
                                                 |          |
                                         PATCH troubleTicket/{id}
                                                      |
                          estado: cerrado / nota agregada / simulado /
                                  nota simulada / omitido / error
                                                      v
                                    informe  ->  CSV / Excel / JSON
```

**Idea central:** buscar y enviar son **dos pasos separados**, con una revisión humana en medio. Todo lo que pueda saltarse esa revisión (un botón «buscar y cerrar», un reintento que encadene el cierre) se quitó a propósito.

---

## 8. Flujo en detalle

1. **Buscar.** Por cada caso marcado se llama `case/search` con el número entre comillas. De los ids devueltos se conservan solo los que tengan `number` **exactamente igual**; si el caso tiene varios tickets, el primero se queda en la fila y los demás **se agregan como filas nuevas**.
2. **Leer el ticket.** `troubleTicket/{id}` da el título y el estado actuales. Si falla, se usa lo que trajo la búsqueda y queda el motivo en la fila.
3. **Descartar lo ya cerrado.** Si el estado está en `ESTADOS_CERRADOS`, la fila pasa a *ya cerrado*, **se desmarca sola** y no recibe ni cierre ni nota, pero sigue en el informe.
4. **Armar el título nuevo.** Solo si hay resultado: se toma el título actual del CM, se le quita un resultado anterior (`… / Favorable`) y un separador suelto al final, y se le agrega el resultado de esta ejecución. Editarlo a mano lo congela. Sin resultado, el título queda como está.
5. **Enviar.** `construirPatch()` parte del ticket leído (o de lo que devolvió la búsqueda) y luego:
   - **cierre** → `name` = título nuevo, `status` = estado final, `note` nueva;
   - **solo nota** → `name` = el del CM, `status` = el que ya tenía, `note` nueva. Si el estado no se pudo leer, la fila se **omite** en vez de arriesgarse a moverlo.
6. **Resultado.** Cada fila queda como *cerrado*, *nota agregada*, *simulado*, *nota simulada*, *omitido* (sin ticket, sin nota, sin nada que enviar o sin estado confiable) o *error*, con el HTTP y el mensaje del API, y con el cuerpo enviado y la respuesta guardados para el botón **Ver**.

### Concurrencia

`hilos` (1–16) es cuántos casos se procesan a la vez mediante un pool de trabajadores. **Pausar** detiene el reparto sin cancelar lo que está en vuelo; **Cancelar** marca la bandera y los trabajadores salen al terminar la petición actual. La renovación del token es segura ante concurrencia: si varios trabajadores reciben 401 a la vez, solo uno renueva y los demás reutilizan ese resultado. Los reintentos por caso usan espera creciente (`600 ms × intento`).

---

## 9. Memoria

Todo vive en memoria del navegador: las filas de trabajo (incluidos el ticket crudo, el historial, el cuerpo del `PATCH` y su respuesta) y los blobs de exportación. **No hay persistencia de resultados**: al recargar se pierde la ejecución y hay que volver a cargar el Excel. Lo único que se guarda son las preferencias de las reglas de cierre.

---

## 10. Riesgos

- **Nada de esto se deshace desde la herramienta.** El `PATCH` es definitivo, tanto el cierre como la nota; revertirlo hay que hacerlo en el CM. De ahí la simulación encendida por defecto y la confirmación al apagarla.
- **La nota también se envía sin resultado.** Una fila con nota y sin favorable **sí** toca el ticket: agrega una nota visible para el cliente interno. No es una fila inerte.
- **Valores no reconocidos en Favorable** caen en «solo nota», no en error. Si la operación usa otras palabras para sí/no, hay que agregarlas a `normalizarFavorable()` o revisar la columna «Favorable (archivo)» antes de enviar.
- **Transporte HTTP plano** hacia el CM y Keycloak; el token queda en memoria del navegador.
- **Casos con varios tickets**: con «traer todos» activo se agregan filas nuevas y **todas** heredan el resultado y la nota del original. Conviene revisarlas antes de la segunda tanda.
- **Coincidencia exacta**: si el CM devuelve el número con un formato distinto al del Excel (espacios, ceros a la izquierda), el caso queda como *sin ticket* aunque exista.
- **Sin reintentos de red salvo 401 y los configurados**: un error en la búsqueda deja la fila en *error*, sin abortar la ejecución.
- **Cancelación no inmediata**: las peticiones en vuelo terminan igual.
- **Dependencia de CDNs externos**: si un CDN está bloqueado o caído, la herramienta no carga.

---

## 11. Historial de cambios

| Versión | Cambios |
|---|---|
| **3.0** | La columna «Favorable» decide la acción: `Sí` cierra como favorable, `No` como desfavorable y la casilla vacía con nota **solo agrega la nota**, sin tocar el título ni el estado; sin nota ni resultado la fila queda omitida. Nueva función `accionDe()`, columna y filtros de **Acción**, KPI **Solo con nota**, estados *anotando* / *nota agregada* / *nota simulada*, título de solo lectura en modo nota, nota obligatoria marcada en rojo, confirmación con desglose y columnas nuevas en informe y exportación. |
| 2.1 | `/case/search` acepta el arreglo plano y el envoltorio antiguo (`normalizarBusqueda`); la respuesta cruda queda en el detalle. |
| 2.0 | Migración a la base compartida: HTML solo con marcado, lógica en `assets/logica-casos.js` y acceso al CM en `me-api.js`. Se elimina el botón «Buscar y cerrar» y el encadenamiento del reintento; los botones se habilitan solo cuando corresponde; las reglas de salvaguarda dejan de ser configurables; zona de arrastrar y soltar; KPIs que filtran; tabla de trabajo e informe en pestañas; exportación con separador `;` por defecto. |
| 1.1 | Informe con filtros propios, alcance de exportación y detección de casos ya cerrados. |
| 1.0 | Versión inicial: carga del Excel, mapeo de columnas, búsqueda de tickets y cierre por lotes con simulación. |
