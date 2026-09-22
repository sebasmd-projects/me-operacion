# Consulta QDN · Tigo (HLR) — Documentación técnica

> **Versión: v1.2** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Consulta **neutral** por MSISDN del estado de una línea en el **HLR de Tigo**, a través del servicio de autogestión de Móvil Éxito. Es el equivalente al *Validador QDN · Claro*, pero contra la otra red.

> Si lo que necesitas es el **flujo de negocio de portabilidad** (Creada / Sin perfil / Residuo en Tigo), usa *Validador Portabilidad · Tigo*: consume el mismo servicio pero con las etiquetas de ese proceso.

---

## 1. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `herramientas/validador_qdn_tigo.html` | Solo marcado: KPIs, pasos, filtros, tabla y modal. |
| `assets/logica-qdn-tigo.js` | Autenticación por `X-Api-Key`, parseo del perfil HLR, concurrencia, reintentos, filtros y tabla. |
| `assets/me-qdn-tigo-puente.js` | Enganche con el shell: exportaciones, spinners, registro. |
| `assets/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

Reemplaza a `CheckPortabilidad.html` (secuencial, sin reintentos y sin detalle) para el caso de uso de consulta general.

---

## 2. Servicio

```
POST {base}/apimew/api/v1/autogestion/HLR/consulta
Headers: Content-Type: application/json · X-Api-Key: <llave fija>
Body:    { "TransactionID": "...", "FechaConsulta": "<ISO 8601>", "Linea": "57XXXXXXXXXX" }
```

- Endpoint: `tulioqa.grupo-exito.com`. No hay OAuth.
- **El nombre engaña**: el gateway se llama «qa», pero detrás hay **un solo HLR/HSS** y es el de **producción**. No existe un HLR de pruebas: lo que devuelve son datos reales.
- El campo `Linea` viaja **con indicativo 57**: la herramienta lo antepone sola, no hay que escribirlo.
- La respuesta es **JSON**, no texto plano:

```json
{ "perfilHLR": "<volcado de texto del comando HLR>", "transaccionID": "...",
  "fechaHora": "...", "error": [] }
```

Con éxito, `perfilHLR` trae el volcado del comando (tipo USCDB) y `error` va vacío. Con fallo, `perfilHLR` va vacío y el detalle crudo llega dentro de `error[0]`.

---

## 3. Estados (RETCODE)

| RETCODE | Estado | Significado | Qué hacer |
|---|---|---|---|
| `0` | **Activa** | El suscriptor tiene perfil creado en el HLR/HSS. | Nada. |
| `3001` | **Sin perfil** | `Subscriber not defined`: la línea **no tiene perfil** en el HLR. | Depende del estado en ME — ver tabla siguiente. |
| `1033` | **Residuo en Tigo** | `Number threshold exceeded`: la línea se portó a Móvil Éxito pero **Tigo no la eliminó de su HLR/HSS**. | **Escalar a Tigo** para que depuren. Tras la depuración la consulta pasa a responder `3001`. |
| otro | Error (RETCODE) | Código no catalogado: se muestra crudo. | Revisar el detalle crudo. |

### 3.1 El `3001` por sí solo no concluye nada

`3001` dice que **no hay perfil**, no de quién es el número. Hay que cruzarlo con el estado de la línea en ME (Optiva):

| Estado en ME | Lectura | Qué hacer |
|---|---|---|
| **Activa** | Inconsistencia: está activa en ME pero sin perfil en el HLR. | **Escalar a Optiva.** |
| **Inactiva** | Esperado: si está inactiva, obvio que no tiene perfil. | Nada. |
| **No pertenece a ME** | El número no es de Móvil Éxito (puede ser un Port Out). | Descartar del lote. |

### 3.2 La cadena del proceso

```
1033 ──(Tigo depura su HLR/HSS)──▶ 3001 ──(se crea el perfil)──▶ 0
```

---

## 4. Coherencia de la respuesta (anti-ruido)

Antes de dar por buena una consulta se verifica que la respuesta **hable de la línea consultada**. Si no, el estado pasa a **`Revisar respuesta`** (`INCONSISTENTE`):

- El `ISDN` del perfil **no coincide** con el MSISDN consultado.
- `RETCODE 0` pero **sin perfil HLR**.
- `RETCODE 0` con perfil pero **sin ISDN**, imposible de atribuir a una línea.
- La respuesta trae perfil **y además** errores.

Esta validación es la que evita que un servicio que devuelva siempre el mismo perfil (o un stub de QA) haga que **todas** las líneas salgan como Activa.

---

## 5. Ejecución

| Regla | Comportamiento |
|---|---|
| Entrada | Pegar, CSV o Excel, con los mismos separadores del resto de la suite. |
| Validación | Solo dígitos, longitud 7–15; se informan inválidos y duplicados. |
| Concurrencia | Configurable, **8 por defecto**. Nunca secuencial. |
| Timeout | 30 s por intento. |
| Reintentos | **Solo por timeout**: hasta 2 adicionales (3 intentos totales). |
| Fallo individual | No detiene el lote. |

---

## 6. Parseo del perfil HLR

El volcado no es JSON: es la salida de un comando propietario con **secciones entre comillas** y pares `CAMPO = VALOR`.

```
                          IMSI = 732111256404516
                          ISDN = 573057888636
"LOCK"
                            IC = FALSE
"ODB Data"
                         ODBOC = BOCROAM
```

El parser conserva **orden y repeticiones**, descarta las líneas de eco del comando (`+++`, `PGW`, `%%`, `---`) y agrupa todo en las secciones tal como vinieron: Identidad, LOCK, SABLOCK, Basic Service, ODB Data, SS Data, O-CSI, T-CSI, MO-SMS-CSI, TIF-CSI, VLR/SGSN Roaming Restrict y GPRS Data.

---

## 7. Bloqueos: heurística declarada

> El formato del HLR **no tiene documentación pública** y solo se dispone de una respuesta real exitosa de referencia. La detección de bloqueos es **best-effort** y así está marcada en la interfaz.

Se marcan como restricción:

- Secciones `LOCK` y `SABLOCK`: `IC`, `OC`, `GPRSLOCK`, `EPSLOCK`, `NON3GPPLOCK`, `CSUPLLCK`, `PSUPLLCK` con valor `TRUE`.
- Sección `ODB Data`, **solo** los campos con mapeo estándar de barring (3GPP TS 23.015): `ODBSS`, `ODBOC`, `ODBIC`, `ODBPB1-4`, `ODBROAM`, `ODBRCF`, `ODBECT`, `ODBPOS`. Se consideran sin restricción cuando valen `FALSE` o empiezan por `NOB` (`NOBAR`, `NOBRCF`, …).

Quedan **fuera del resumen a propósito** `ODBENTE`, `ODBINFO`, `ODBPOSTYPE`, `ODBENTEROAM`, `ODBINFOROAM`, `ODBDECT` y `ODBMECT`: no tienen mapeo confiable y marcarlos generaría falsos positivos. Siguen visibles en el detalle crudo.

**Desvíos**: se listan los tipos con `= PROV` (`CFU`, `CFB`, `CFNRY`, `CFNRC`, `CFD`) y se rotulan como *"Provisionados"* — `PROV` significa configurado, no necesariamente desviando ahora; el estado real (`PROV | REG | ACT`) está en la sección `SS Data` del detalle.

---

## 8. Tabla, filtros y exportación

Columnas: **MSISDN, Estado, RETCODE, IMSI, IMEI, Tipo SIM, Bloqueos, Roaming, Desvíos, Detalle (👁)**.

- **Tarjetas**: Activas · Sin perfil · Residuo en Tigo · **Revisar respuesta** · Errores/timeout.
- **Filtros**: Estado y Restricciones; mostrar/ocultar columnas.
- **Exportación** CSV / Excel / JSON con columna **Observaciones**.
- El modal muestra el perfil por secciones, la información técnica y el **JSON original**.

---

## 9. Riesgos y límites

- **Datos de producción**: aunque el gateway se llame `tulioqa`, la consulta llega al único HLR/HSS existente, el de producción. Los resultados son reales y así deben tratarse.
- **Distribución**: los archivos se descargan y ejecutan **localmente en los PC administrados de backoffice**, no se publican en un servidor. Bajo ese modelo las credenciales viajan en el archivo por diseño, igual que `interfaz.py` y el lanzador. Solo habría que moverlas a un proxy si algún día la herramienta se publicara en un servidor accesible fuera del equipo.
- **Heurística de bloqueos** (§7): confirmar con el fabricante antes de usarla como criterio de decisión.
- **CORS**: abrir desde `dame click.bat`, no con doble clic.

---

## 10. Historial de cambios

| Versión | Cambios |
|---|---|
| **1.2** | Reglas de negocio de Tigo actualizadas: `3001` pasa de «Inactiva» a **Sin perfil** (no concluye por sí solo: se cruza con Optiva) y `1033` pasa de «No es de Móvil Éxito» a **Residuo en Tigo** (se escala a Tigo y luego responde `3001`). |
| 1.1 | Validación de coherencia ISDN ⇄ línea consultada, estado `Revisar respuesta`, agrupación de fallidas en KPIs y columna Observaciones en la exportación. |
| 1.0 | Versión inicial: consulta neutral Activa/Inactiva/No es de ME, concurrencia real, reintentos por timeout, perfil por secciones y JSON original. |
