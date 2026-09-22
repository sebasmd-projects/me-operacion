# Validador Portabilidad · Tigo — Documentación técnica

> **Versión: v1.3** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Valida por **MSISDN** en qué punto del proceso de portabilidad quedó una línea en el **HLR de Tigo**. Consume el mismo servicio de autogestión que *Consulta QDN · Tigo*, pero traduce el `RETCODE` al lenguaje del proceso.

**El diferencial frente a una consulta simple al HLR de Tigo**: con sesión del CM (opcional), cada línea trae también su **estado en Optiva** — es justo el dato que hace falta para leer correctamente el `RETCODE 3001` (ver §2.1): por sí solo no prueba que el número sea de Móvil Éxito, hay que cruzarlo con el estado en el CM.

**Reemplaza a `CheckPortabilidad.html`**, que procesaba de forma secuencial, sin reintentos, sin detalle y leyendo la respuesta como texto plano.

---

## 1. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `herramientas/validador_portabilidad_tigo.html` | Solo marcado: KPIs, pasos, filtros, tabla y modal. |
| `assets/logica-portabilidad-tigo.js` | Autenticación por `X-Api-Key` (Tigo), catálogo de RETCODE, parseo del perfil HLR, concurrencia, reintentos, **y la consulta opcional al CM** (`estadoCM()`). |
| `assets/me-api.js` | Acceso al CM (Keycloak + `/api/v1/subscribers`). **Común.** Opcional para esta herramienta: sin sesión, simplemente no se usa. |
| `assets/me-portabilidad-tigo-puente.js` | Enganche con el shell: sesión del CM, exportaciones, spinners, registro. |
| `assets/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

Comparte motor de Tigo con `logica-qdn-tigo.js`; lo único que cambia ahí es el catálogo de estados. La consulta al CM (`estadoCM()`) sigue el mismo servicio y el mismo criterio de "cuenta activa más reciente" que `assets/logica-consumos.js` — ver esa herramienta si cambia algo en `/api/v1/subscribers`.

---

## 2. Regla de negocio (lo que significa cada RETCODE)

| RETCODE | Estado | Lectura de negocio | Qué hacer |
|---|---|---|---|
| `0` | **Creada** | La línea ya tiene perfil en el HLR: portación completada. | Nada. |
| `3001` | **Sin perfil (pendiente)** | `Subscriber not defined`. La línea **no tiene perfil** en el HLR. | Depende del estado en ME — ver §2.1. |
| `1033` | **Residuo en Tigo** | `Number threshold exceeded`. La línea era de Tigo y **se portó a Móvil Éxito**, pero Tigo **no la eliminó de su HLR/HSS**. Ese residuo bloquea la creación. | **Escalar a Tigo.** Tras la depuración pasa a `3001` y ya se puede crear. |
| otro | Error (RETCODE) | Código no catalogado. | Revisar el detalle crudo. |

El proceso avanza en cadena:

```
1033 ──(Tigo depura su HLR/HSS)──▶ 3001 ──(se crea el perfil)──▶ 0
```

### 2.1 El `3001` no prueba que el número sea de ME

Solo dice que **no hay perfil**. Hay que cruzarlo con el estado de la línea en ME (Optiva) — **desde v1.3 esto ya no hay que buscarlo aparte**: con sesión del CM (paso 2, opcional), la columna **Estado ME** trae ese dato en la misma fila:

| Estado en ME | Lectura | Qué hacer |
|---|---|---|
| **Activa** | Inconsistencia: activa en ME pero sin perfil en el HLR. | **Escalar a Optiva.** |
| Desactivada / Disponible / Bloqueada | Esperado: si no está activa, es razonable que no tenga perfil. | Nada. |
| **No está en el CM** | El número no es de Móvil Éxito (puede ser un Port Out). | Descartar del lote. |

Cuando el cruce da la inconsistencia (`RETCODE 3001` + `Estado ME: Activa`), el modal de detalle la marca sola con un aviso — no hace falta leer las dos columnas a mano para notarla.

> Ojo con la lectura anterior de esta herramienta: `3001` **no** significa "es nuestro pero falta crearlo", y `1033` **no** significa "no es nuestro". `1033` es precisamente lo contrario — la línea **sí** pasó a Móvil Éxito y lo que falta es que Tigo la borre.

### 2.2 Estado ME (CM/Optiva) — opcional

Con sesión del CM abierta (paso 2), cada línea se consulta también contra `/api/v1/subscribers` **en paralelo** con la consulta a Tigo (no se espera a una para pedir la otra). El resultado va en la columna **Estado ME**:

| Valor mostrado | Qué significa |
|---|---|
| `Activa` / `Desactivada` / `Disponible` / `Bloqueada` | Estado de la cuenta más reciente en el CM (si hay varias, se prefiere la activa — mismo criterio que Prepagadas/Consumos). |
| `No está en el CM` | El CM no tiene ninguna cuenta para ese MSISDN. |
| `Error CM` | La consulta falló (timeout, 401 no resuelto, etc.); se avisa en el registro y no detiene el resto del lote. |
| *(vacío)* | No hay sesión del CM abierta — la herramienta sigue funcionando igual, este dato simplemente no se pidió. |

**Es opcional a propósito**: no se fuerza el login del CM para poder seguir usando esta herramienta exactamente como antes de v1.3 (solo Tigo, sin credenciales del CM a mano).

---

## 3. Servicio

```
POST {base}/apimew/api/v1/autogestion/HLR/consulta
Headers: Content-Type: application/json · X-Api-Key: <llave fija>
Body:    { "TransactionID": "...", "FechaConsulta": "<ISO 8601>", "Linea": "57XXXXXXXXXX" }
```

Endpoint: `tulioqa.grupo-exito.com`. **El nombre engaña**: el gateway se llama «qa», pero detrás hay **un solo HLR/HSS**, el de **producción** — los datos son reales. El `57` lo antepone la herramienta. La respuesta es JSON (`perfilHLR`, `transaccionID`, `fechaHora`, `error[]`), no texto plano.

---

## 4. Coherencia de la respuesta (anti-ruido)

El defecto más caro de este flujo es reportar **"Creada"** cuando la evidencia no lo sostiene. Antes de aceptar un resultado se verifica que la respuesta **hable de la línea consultada**; si no, el estado pasa a **`Revisar respuesta`**:

- El `ISDN` del perfil **no coincide** con el MSISDN consultado.
- `RETCODE 0` **sin perfil HLR**.
- `RETCODE 0` con perfil pero **sin ISDN**.
- Respuesta con perfil **y además** errores.

Si el servicio (o un stub de QA) devolviera siempre el mismo perfil, esta validación lo delata de inmediato en vez de marcar todo el lote como Creada.

---

## 5. Ejecución

| Regla | Comportamiento |
|---|---|
| Entrada | Pegar, CSV o Excel, con los mismos separadores del resto de la suite. |
| Validación | Solo dígitos, longitud 7–15; se informan inválidos y duplicados. |
| Concurrencia | Configurable, **8 por defecto** (antes: 1 a la vez). |
| Timeout | 30 s por intento. |
| Reintentos | **Solo por timeout**: hasta 2 adicionales (3 intentos totales). |
| Fallo individual | No detiene el lote. |

---

## 6. Tabla, filtros y exportación

Columnas: **MSISDN, Estado, Estado ME, RETCODE, IMSI, IMEI, Tipo SIM, Bloqueos, Roaming, Desvíos, Detalle (👁)**. «Estado ME» es ocultable como cualquier otra desde el menú de columnas — útil si nadie inició sesión del CM en esa ejecución.

- **Tarjetas**: Creadas · Sin perfil (pendiente) · Residuo en Tigo · **Revisar respuesta** · Errores/timeout.
- **Filtros**: Estado y Restricciones; mostrar/ocultar columnas.
- **Exportación** CSV / Excel / JSON con columna **Observaciones** (avisos de inconsistencia).
- El modal trae el perfil HLR por secciones, la información técnica y el **JSON original**.

Sobre la interpretación de bloqueos y desvíos del perfil (heurística declarada, campos ODB con mapeo estándar, `PROV` = provisionado): ver `doc/consulta-qdn-tigo/README.md` §6 y §7 — el motor es el mismo.

---

## 7. Riesgos y límites

- **Datos de producción**: el gateway se llama `tulioqa`, pero consulta el único HLR/HSS existente. Lo que se ve corresponde a portabilidades reales.
- **Distribución**: los archivos se descargan y ejecutan **localmente en los PC administrados de backoffice**, no se publican en un servidor. Bajo ese modelo las credenciales viajan en el archivo por diseño, igual que `interfaz.py` y el lanzador. Solo habría que moverlas a un proxy si algún día la herramienta se publicara en un servidor accesible fuera del equipo.
- **Solo lee**: la herramienta no crea ni modifica nada en el HLR; la creación sigue siendo un proceso aparte.
- **CORS**: abrir desde `dame click.bat`, no con doble clic.

---

## 8. Historial de cambios

| Versión | Cambios |
|---|---|
| **1.3** | Sesión del CM **opcional** (paso 2 nuevo): cada línea trae también su **Estado ME** (Activa/Desactivada/Disponible/Bloqueada/No está en el CM), consultado en paralelo con el HLR de Tigo — mismo servicio y criterio que `logica-consumos.js`. Es el dato que hacía falta para leer el `RETCODE 3001` sin salir de la herramienta (§2.1); cuando el cruce da la inconsistencia (`3001` + `Activa`), el modal de detalle la marca sola. Sin sesión del CM, la herramienta funciona exactamente igual que antes. |
| 1.2 | Reglas de negocio de Tigo actualizadas: `3001` = **Sin perfil** (no prueba pertenencia a ME; se cruza con Optiva) y `1033` = **Residuo en Tigo** (la línea sí se portó a ME, Tigo no la eliminó de su HLR/HSS; se escala a Tigo y luego pasa a `3001`). Reemplaza la lectura de la v1.1. |
| 1.1 | Etiquetas de negocio corregidas (`3001` = pendiente y **es** de ME; `1033` = Port Out), validación de coherencia ISDN ⇄ línea, estado `Revisar respuesta`, KPIs y columna Observaciones. |
| 1.0 | Reemplazo de `CheckPortabilidad.html`: JSON en vez de texto plano, concurrencia real, reintentos por timeout y detalle completo del perfil. |
