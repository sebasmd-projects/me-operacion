# ¿En qué HLR está? · Cruce Claro ⇄ Tigo — Documentación técnica

> **Versión: v1.2** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Por cada **MSISDN** consulta **al mismo tiempo** el QDN de Claro y el HLR de Tigo, y concluye en cuál de las dos redes está la línea — o en ninguna.

---

## 1. Para qué sirve

Responde una sola pregunta operativa: *"esta línea, ¿dónde está?"*. Es el paso previo a decidir si un caso se trabaja por el lado de Claro, por el de Tigo, o si no pertenece a Móvil Éxito.

Para el **detalle forense** de cada operador (bloqueos, servicios, perfil completo) están las herramientas dedicadas: *Validador QDN · Claro* y *Consulta QDN · Tigo*.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `herramientas/validador_hlr_cruzado.html` | Solo marcado: KPIs, pasos, filtro, tabla y modal comparativo. |
| `assets/logica-hlr-cruzado.js` | Autenticación de ambos operadores, consulta en paralelo y regla de conclusión. |
| `assets/me-hlr-cruzado-puente.js` | Enganche con el shell: exportaciones, spinners, registro. |
| `assets/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

Duplica **lo mínimo** de cada motor (autenticación + una consulta) para poder correr las dos redes a la vez; no reemplaza a las herramientas dedicadas.

---

## 3. Las dos consultas

| | Claro | Tigo |
|---|---|---|
| Autenticación | OAuth2 (token propio de QDN) | `X-Api-Key` fija |
| Llamada | `GET .../ValideQDN/{msisdn}` | `POST .../autogestion/HLR/consulta` |
| Señal que se lee | `result.operationalState` | `RETCODE` |
| Timeout / reintentos | 30 s · hasta 2 reintentos **solo por timeout** | igual |

Ambas corren en `Promise.all` por línea. La concurrencia configurable (**5 por defecto**) cuenta **líneas**, no peticiones: cada línea dispara 2 llamadas simultáneas.

---

## 4. Regla de conclusión

Punto de partida, confirmado por el equipo:

- **Claro no distingue** "no existe" de "inactiva": ambos casos responden `operationalState = inactive` con HTTP 200. Solo aporta Activa / Inactiva.
- **Tigo** aporta tres señales por `RETCODE`:

| RETCODE Tigo | Estado | Qué significa |
|---|---|---|
| `0` | **Activa** | La línea tiene perfil en el HLR/HSS de Tigo. |
| `3001` | **Sin perfil** | `Subscriber not defined`. **No es presencia en Tigo** ni prueba de quién es el número: puede estar inactiva en ME, ser una inconsistencia a escalar a Optiva si en ME figura activa, o no ser de Móvil Éxito. |
| `1033` | **Residuo en Tigo** | `Number threshold exceeded`. La línea se portó a Móvil Éxito pero Tigo **no la eliminó** de su HLR/HSS. **Sí queda registro en Tigo**, pero no es un perfil utilizable: se escala a Tigo y, una vez depurado, pasa a responder `3001`. |

Matriz de conclusión:

| Claro | Tigo | Conclusión |
|---|---|---|
| Activa | `0` | **Ambos — revisar** (no debería pasar) |
| Activa | `1033` | **Claro + residuo en Tigo** (escalar a Tigo) |
| Activa | `3001` / error | **Claro** |
| Inactiva | `0` | **Tigo** |
| Inactiva | `1033` | **Residuo en Tigo (escalar)** |
| Inactiva | `3001` | **Ninguno** |
| error/timeout en ambos | — | **No concluyente** |

*Ambos* y *No concluyente* existen a propósito: es preferible marcar un caso para revisión manual que forzar una conclusión que el dato no sostiene.

La tarjeta **Residuo en Tigo** agrupa los dos casos que terminan en el mismo escalamiento (`Residuo en Tigo` y `Claro + residuo en Tigo`).

---

## 5. Tabla, filtros y exportación

Columnas: **MSISDN, Ubicación, Claro, Tigo, RETCODE Tigo, Detalle (👁)**.

- **Tarjetas-filtro**: En Claro · En Tigo · Residuo en Tigo · Ninguno · Ambos/no concluyente. La última agrupa los dos resultados que necesitan revisión manual.
- **Filtro** por Ubicación, con «Ambos / no concluyente» agrupado y las opciones «Ambos — revisar» y «No concluyente» por separado.
- **Exportación** CSV / Excel / JSON.
- El modal muestra el resumen de cada operador **lado a lado** y el JSON crudo de ambos.

---

## 6. Riesgos y límites

- **Ambas consultas son de producción**: Claro va a PDN y, aunque el gateway de Tigo se llame `tulioqa`, detrás hay un solo HLR/HSS y es el productivo. La conclusión **no** mezcla ambientes.
- **Doble carga**: cada línea son 2 peticiones. Con concurrencia 5 son 10 llamadas simultáneas repartidas entre dos proveedores.
- **Distribución**: los archivos se descargan y ejecutan **localmente en los PC administrados de backoffice**, no se publican en un servidor. Bajo ese modelo las credenciales viajan en el archivo por diseño, igual que `interfaz.py` y el lanzador. Solo habría que moverlas a un proxy si algún día la herramienta se publicara en un servidor accesible fuera del equipo.
- **CORS**: abrir desde `dame click.bat`.
- Si un operador falla y el otro responde, la conclusión se marca **No concluyente** en vez de asumir el resultado del que sí contestó.

---

## 7. Historial de cambios

| Versión | Cambios |
|---|---|
| **1.2** | La tarjeta **Ambos / no concluyente** pasa a ser un filtro rápido y el desplegable de Ubicación incorpora esa misma opción agrupada, conservando también ambos resultados por separado. |
| 1.1 | Matriz de conclusión rehecha con las reglas nuevas de Tigo: `3001` deja de contar como presencia en Tigo (desaparece *Tigo pendiente*) y `1033` pasa a ser **Residuo en Tigo** — registro sin depurar que se escala a Tigo. Nueva conclusión *Claro + residuo en Tigo*. |
| 1.0 | Versión inicial: consulta en paralelo Claro + Tigo, matriz de conclusión, tabla comparativa y modal con ambos JSON. |
