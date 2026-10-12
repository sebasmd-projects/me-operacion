# Pre-factura (Plan Corporativo) — Documentación técnica

> **Versión: v1.1.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

**Genera la pre-factura mensual de las líneas del Plan Corporativo**: aplica el corte a la hoja *Activos* del archivo «Plan Corporativo», calcula valor bruto, IVA, ICO, retefuente y neto de cada línea, resume por empresa y tipo (Voz / Datos), compara cada filial con el mes anterior y entrega un archivo por filial listo para enviar.

> **Todo es local.** La herramienta lee el Excel en el navegador y genera Excel. No consulta el CM ni ningún otro servicio.

Reemplaza el proceso en Excel que se explicó en la reunión **«Prefactura»** (grabación del 2025-03-17, 32 min). Ese proceso está descrito en la §5, paso a paso, para quien tenga que hacerlo o revisarlo a mano. Las reglas se ajustaron y **validaron contra los archivos reales** del proceso (§4.7): Plan Corporativo, Liquidación Corporativo 1 y 2, los nueve archivos de la carpeta Compañía y el formato de factura manual.

---

## 1. Objetivos

- Hacer en un minuto lo que en Excel toma la mañana: borrar la factura pasada, filtrar por corte, refrescar cuatro tablas dinámicas, copiar y pegar como valores y separar filial por filial.
- **No depender de que nadie «esté muy pendiente»** de los vacíos, los «no aplica» y los ceros: la herramienta los muestra en vez de dejarlos pasar.
- Aplicar **siempre las mismas reglas de corte** a las observaciones.

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/prefactura.html` | Marcado. Sin lógica. |
| `assets/herramientas/prefactura/calculo.js` | Lectura de la hoja, reglas de corte, tarifas e impuestos, resumen, comparación con el mes anterior y libros de Excel. Se publica como `window.Prefactura`. |
| `assets/herramientas/prefactura/prefactura.js` | Interfaz: archivo, editor de tarifas, agrupación de filiales, tablas y descargas (secciones: configuración, reglas en `calculo.js`, interfaz). |
| `assets/herramientas/prefactura/prefactura.css` | Estilos propios: pestañas, etiquetas de estado y editor de tarifas. |

No usa `me-api.js`: no hay sesión ni servicio.

---

## 3. Herramientas de terceros

Bootstrap 5.3.3, Bootstrap Icons 1.11.3, DataTables 2.3.2, jQuery 3.7.1 y SheetJS 0.18.5 (como el resto de la suite), más **JSZip 3.10.1** para el ZIP de filiales (el mismo que usa «Convertir audio a MP3»). Todas por CDN.

---

## 4. Reglas

### Entrada

El archivo **«Plan Corporativo»** (en la reunión: `\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\Auxiliar Movil Exito\Plan Corporativo\2020\Plan Corporativo 1..xlsx`). Se usa la hoja **Activos** (en el archivo real se llama «Activos », con un espacio al final; también se acepta «Activas»). Sus columnas:

| Columna | Uso |
| --- | --- |
| Numero *(o sin título)* | La línea. Se acepta con o sin `57`. |
| Empresa | A qué empresa (y filial) se factura. |
| Mes creación | Se copia tal cual. |
| Voz / Datos / Botmaker | El plan de cada tipo. `#N/A`, vacío, «no aplica» o `0` = no tiene. |
| ID, Estado, Validación, NIT | Se copian tal cual. |
| Observación | Decide si la línea entra en el corte. |

Las demás hojas del archivo (Roaming Activo/Inactivo, Modificaciones, Adicional, Cancelaciones, Datos) no se usan, igual que en el proceso a mano.

La hoja real declara un rango de un millón de filas (`A1:K1044522`: hay una lista de precios suelta en la fila 1.044.509). La herramienta arma las filas solo con las celdas que existen (14 ms en vez de 12 s) e ignora el texto suelto que no es una línea.

### Corte

El corte es el **día 15** del mes que se factura (editable). Lo que pasa hasta ese día, inclusive, entra.

**Solo una cancelación saca una línea del corte.** Una activación sin año no se tiene en cuenta: puede ser de cualquier año y la línea ya está en *Activos*.

| Observación | Qué se hace |
| --- | --- |
| «Se cancela el 13 de octubre», «Cancelada el 2 de octubre», «Se inactiva…», «se desactiva…» (hasta el corte) | **Fuera del corte.** |
| «Se cancela el 13… y se reactiva el 17» (reactivación después del corte) | **Fuera del corte.** |
| «Se cancela el 21 de abril, se reactiva el 5 de mayo» (reactivada antes del corte) | **Se factura.** |
| «Se cancela el 20 de octubre» (después del corte) | Se factura, con aviso en **Revisar**: la línea estuvo activa todo el corte. |
| «Se activa el 17 de octubre», «Se activa el 29 de noviembre»… **sin año** | **No se tiene en cuenta**: se factura. |
| «Se activa el 17 de octubre **de 2025**» (con año, después del corte) | **Fuera del corte**: entra en el siguiente. |
| «Se bloquea» | **Se factura**: el plan no se canceló («todavía se sigue facturando»). |
| «Se cambia a combo 4 el …» después del corte | Se factura el plan de la hoja, con aviso en **Revisar**. |
| Cualquier otra observación | Se factura, con aviso en **Revisar**. La herramienta no adivina. |

Las observaciones **se acumulan mes a mes** en el Plan Corporativo y casi nunca traen año: «Se activa el 15 de diciembre» puede ser de hace diez meses. Por eso:

- una fecha sin año se ubica en el año que la deja **entre 11 meses antes y 1 mes después del corte**: lo anotado para el próximo corte es futuro y lo demás es historia;
- con año («el 14 de enero 2026») se usa ese año;
- se aceptan «Se activa 01 de octubre», «el 08 octubre», «15  de septiembre», «abrilo» (abril), «se desactiva», «se inactiva», «se cancelo»;
- se sigue la historia de cancelaciones: «Se cancela el 21 de abril, se reactiva el 5 de mayo» queda activa; «Se activa el 18 de noviembre, se desactiva el 12 de marzo» queda cancelada (*antes de este corte y no se reactivó*). Una reactivación solo cuenta después de una cancelación de la misma observación;
- **cambios de plan** («Se cambia a combo 4 el 8 de julio», «Se modifica coon 300 CE el 25 de Mayo», «Se agrega 300 CE»): la hoja ya trae el plan nuevo y se factura ese. Solo si el cambio es **después del corte** queda aviso en *Revisar* para confirmar qué plan se cobra.

### Una fila por línea y tipo

Como en la hoja *Base*: cada línea genera una fila de **Voz** si tiene plan de voz, una de **Datos** si tiene plan de datos y otra de **Datos** con plan «Botmaker» si tiene Botmaker. Una línea sin ningún plan **no se factura** y queda en *Revisar* («revisar en el CM qué tiene la línea»: en la reunión se buscaba a mano en la base).

### Tarifas e impuestos

Las tarifas son la **Hoja2** de «Liquidación Corporativo 2» (el BUSCARV del valor por nombre de plan). Valor **con IVA**:

| Tipo | Plan | Valor |
| --- | --- | ---: |
| Datos | 40GB | 24.900 |
| Datos | 20GB | 15.000 |
| Datos | 100GB | 39.900 |
| Datos | Combo 2 | 50.000 |
| Datos | Combo 3 | 34.900 |
| Datos | Combo 4 | 24.900 |
| Datos | Whatsapp ALL · Whatsapp old | 600 |
| Datos | Botmaker | 2.750 |
| Datos | Datos Roaming · SMS Roaming | 0 (ver *Roaming*) |
| Voz | 100 CE | 1.800 |
| Voz | 200 CE | 3.600 |
| Voz | 300 CE | 6.000 |
| Voz | Ilimitado · Ilimitado AB | 12.500 |
| Voz | Voz Roaming | 0 (ver *Roaming*) |

En la grabación de marzo 2025, 20GB valía 24.900; en la Hoja2 actual, 15.000 (40GB tomó los 24.900). Un plan que no está en la tabla **no se inventa**: se agrega sin valor, sale en rojo, sus líneas no se suman y no se puede descargar hasta completarlo. Un plan con valor **0** se factura en cero a propósito. La tabla se edita en la herramienta y se guarda en el equipo; el nombre del plan se unifica con el de la tarifa («WhatsApp All» → «Whatsapp ALL»).

Fórmulas de la hoja *Activos* de «Liquidación Corporativo 2»:

| Columna | Fórmula | Voz 12.500 | Datos 24.900 |
| --- | --- | ---: | ---: |
| Valor bruto | `= Valor / 1,19` | 10.504,20 | 20.924,37 |
| IVA | `= bruto × 19 %` | 1.995,80 | 3.975,63 |
| ICO | `= SI(Tipo="Voz"; bruto × 4 %; 0)` | 420,17 | 0 |
| Subtotal | `= bruto + IVA + ICO` | 12.920,17 | 24.900 |
| Retefuente | `= bruto × 2,5 %` | 262,61 | 523,11 |
| Valor neto | `= subtotal − retefuente` | 12.657,56 | 24.376,89 |

Es decir: el ICO de voz se cobra **encima** del valor del plan. En la grabación de marzo 2025 iba **incluido** (bruto = valor / 1,23 y subtotal = valor); esa variante queda como casilla en el paso 2.

### Roaming

Los cargos de roaming no tienen tarifa: en la liquidación se escribe **a mano el valor bruto** de cada cargo (los de datos son múltiplos de 11.552) y las fórmulas sacan IVA, ICO, subtotal y retefuente. En la herramienta se pegan en el paso 3, un renglón por cargo: `línea;plan;valor bruto;mes` (por ejemplo `3113489676;Voz Roaming;48588,6;Octubre`). El valor acepta `11552`, `11.552`, `48.588,6` o `107199,3166`. La empresa y los datos de la línea salen del Plan Corporativo; un cargo de una línea que no está ahí va a *Revisar* y no se factura.

### Filiales

Cada empresa es su propia filial, salvo las que se agrupan en un mismo archivo. Por defecto, como la carpeta *Compañía* real:

- todas las «Viva …» (Envigado, Laureles, Barranquilla, La Ceja, Wajira, Malls Soporte Galería…) y **P.A Centro Comercial** van en **Viva Malls**;
- «Almacenes Exito S.A» va en el archivo **Almacenes Éxito S.A.S**.

Las reglas son editables (`patrón => filial`, una por renglón) y se guardan en el equipo. El mismo nombre escrito distinto («Viva la Ceja» / «Viva La Ceja», «Logistica Transporte  Y Servicios» con doble espacio) es **una sola empresa**, como en una tabla dinámica de Excel: se usa la forma más frecuente.

### Validaciones

| Situación | Dónde sale |
| --- | --- |
| Línea sin 10 dígitos | Registro (no se lee) |
| Línea repetida en el archivo | *Revisar* (se factura una vez) |
| Sin plan de voz, datos ni Botmaker | *Revisar* (no se factura) |
| Plan sin tarifa | Tarifas en rojo, KPI «Incompleto», descargas bloqueadas |
| Estado distinto de «Activo» | *Revisar* (se factura) |
| Observación sin regla o cancelación después del corte | *Revisar* (se factura) |

### Validación contra los archivos reales

Con el Plan Corporativo real, corte 15 de septiembre y los cargos de roaming de la liquidación:

| Comprobación | Resultado |
| --- | --- |
| Valor por línea de cada plan (Voz, Datos, Botmaker) | **Idéntico** a «Liquidación Corporativo 2» |
| Subtotal de los 37 cargos de roaming | **Idéntico** (2.679.289,14) |
| Subtotal por empresa | **15 de 19 idénticas** (CyR 6.774.571, Didetexco 963.894, toda Viva Malls…) |
| Filiales y nombres de archivo | Los **9** de la carpeta Compañía |

Las cuatro empresas que difieren (Almacenes, Viva Envigado, Logística, Fundación Éxito) lo hacen por líneas del Plan Corporativo que son **posteriores** a esa liquidación (planes 40GB y 100GB nuevos, líneas que cambiaron de empresa): el archivo maestro que se compartió es más reciente que la liquidación.

Línea por línea, con la regla «solo las cancelaciones sacan del corte»: de las 1.704 líneas de la liquidación real, la herramienta factura todas menos **una**: 3332765250, «Se cancelo el 21 de agosto». La liquidación real la cobró por error (confirmado por operación: debía estar excluida); la herramienta la deja fuera. Las 18 que solo factura la herramienta son posteriores a la liquidación (12 con planes 40GB/100GB).

---

## 5. El proceso en Excel que reemplaza (reunión «Prefactura»)

Archivos: **Plan Corporativo 1** (el maestro de líneas), **Liquidación Corporativo 1** (hojas *Voz*, *Datos*, *Copia*, *Base*, *Activos*), **Liquidación Corporativo 2** (hojas *Activos* y *Factura*) y la carpeta `AAAA Facturación\NN. Mes\Compañía`, con un archivo por filial.

1. **Liquidación Corporativo 1 · Activos**: borrar los datos de la factura pasada y pegar la hoja *Activos* del Plan Corporativo.
2. **Filtrar por la columna Observación** y aplicar el corte (hasta el 15). Se eliminan las filas que se activan después del corte, las que se cancelan y las que se cancelan y se reactivan después. A las que «se activan» dentro del corte y a las que «se bloquean» solo se les borra la observación. Al final se filtra por «Observación» para confirmar que no quedó nada.
3. **Copia**: borrar todo menos la primera fila (lleva las fórmulas).
4. **Voz** (tabla dinámica Línea → plan de voz): *Cambiar origen de datos*, comprobar que todo quede seleccionado, *Aceptar*, *Actualizar*. Verificar que en el filtro no quede seleccionado «no aplica» ni nada raro, y copiar el resultado a *Copia*.
5. **Datos**: lo mismo que Voz. Si una línea sale vacía, buscar en la base del CM qué plan tiene (en la reunión: una línea recién activada con Combo 3) y completarla.
6. En *Copia*, las fórmulas (BUSCARV) traen empresa, ID, estado, validación y NIT. **«Hay que estar muy pendiente de la información vacía que trae, porque así le daña todo.»**
7. Copiar *Copia* desde la segunda fila y pegarla en **Base como valores** (pegado especial 1-2-3, sin fórmulas ni negrilla).
8. Desde *Activos*, filtrar **Botmaker** y agregar esas líneas al final de *Base* con plan «Botmaker».
9. Guardar y pasar a **Liquidación Corporativo 2 · Activos**: filtrar por tipo y borrar la factura pasada dejando una fila de cada tipo (Datos y Voz), que lleva las fórmulas.
10. Pegar la *Base* de la Liquidación 1 y **arrastrar las fórmulas**: Valor (por tarifa), Valor bruto, IVA, ICO, Subtotal (`=L+M+N`), Retefuente y Valor neto. Filtrar por Datos y por Voz y comprobar que **no haya «no aplica» ni ceros**. Borrar las dos filas de la factura anterior.
11. **Factura** (tabla dinámica Empresa × Tipo): cambiar el origen de datos y actualizar. Cerrar la Liquidación 1 sin cambios y guardar la 2.
12. **Carpeta del mes**: copiar la carpeta del mes anterior en `2025 Facturación` y renombrarla (por ejemplo `03. Marzo\Compañía`).
13. **Por cada filial** (Almacenes Éxito, CyR, Didetexco, Éxito Viajes, Fundación Éxito, Greenyellow, Logística Transporte y Servicios, Transacciones Energéticas, Viva Malls…):
    - en su archivo, borrar la hoja *Liquidación* y pegar como valores las filas de esa empresa filtradas en la Liquidación 2, quitando las columnas **Validación** y **Valor Voz** (así están los archivos reales);
    - en la hoja *Facturas*, pegar las filas de esa empresa de la tabla *Factura*;
    - **cuadrar**: el subtotal de *Liquidación* debe ser igual al de *Facturas* (en la reunión: Almacenes 28.319.100 = 28.319.100);
    - comparar con el mes pasado. Si no cambió (Éxito Viajes 50.000, Fundación Éxito, Greenyellow 30.000, Transacciones Energéticas 59.800), solo se guarda. Si cambió (Didetexco, Logística 1.749.000 → 1.774.000), se reemplaza.
    - Viva Malls agrupa varias empresas «Viva …»; ojo con no seleccionar una filial de más (en la reunión eso dio una diferencia de 1 millón que no existía).
14. **Enviar a las filiales** cuando la persona que aprueba confirme, y montar la **prefactura interactiva**.

### Lo que hace la herramienta en cada paso

| Pasos | En la herramienta |
| --- | --- |
| 1, 2 | Carga el Plan Corporativo; las reglas de corte se aplican solas y lo excluido queda en *Fuera del corte* con su motivo. |
| 3–8 | Automático: una fila por línea y tipo, Botmaker incluido. Lo vacío queda en *Revisar*. |
| 9–10 | Automático: valores e impuestos por tarifa; un plan sin tarifa bloquea la descarga. |
| 11 | Pestaña *Factura* (Empresa × Tipo). |
| 12–13 | **Guardar en la red**: un archivo por filial (hojas *Facturas* y *Liquidación* sin la columna Validación) directo en `Plan Corporativo\AAAA Facturación\NN. Mes` (§6). Cuadran por construcción. La comparación con el mes anterior sale en la pestaña *Filiales* si se carga el consolidado del mes pasado. |
| 14 | Sigue siendo a mano: aprobación, envío y la **factura manual de SAP** (`Formato_Generacion_Factura_ManualSD`: una fila por empresa y tipo con el **valor bruto** como importe, más código de deudor, material, CEBE y texto por empresa). Esos importes son la columna «Valor bruto» de la pestaña *Factura*. Generar ese formato desde la herramienta es el siguiente paso natural; necesita la tabla de códigos SAP por empresa, que no se dejó en el código porque trae datos de contacto. |

---

## 6. Funcionalidad

- **Paso 1**: archivo, hoja (se elige *Activos* sola), mes y día de corte. «Generar pre-factura».
- **Paso 2 · Tarifas**: tabla editable (tipo, plan, valor con impuestos). Los planes nuevos se agregan solos sin valor. «Restaurar» vuelve a las de la tabla de la §4.
- **Paso 3**: agrupación de filiales y, opcional, el **consolidado del mes anterior** (el que descargó esta herramienta). La pestaña *Filiales* dice cuál cambió y en cuánto.
- **Pestañas**: *Filiales*, *Factura*, *Liquidación*, *Fuera del corte* y *Revisar*.
- **Descargas**:
  - **Consolidado** `prefactura_corporativo_AAAA-MM.xlsx`: hojas *Filiales*, *Factura*, *Liquidación*, *Excluidas*, *Revisar* y *Parámetros*. **Guárdalo**: el mes siguiente es el «mes anterior».
  - **Guardar en la red** (botón principal): escribe un archivo por filial **directo en la carpeta del mes**, sin subcarpetas:

    ```text
    \\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\Auxiliar Movil Exito\Plan Corporativo
      └─ 2026 Facturación
           └─ 10. Octubre
                ├─ Almacenes Éxito S.A.S.xlsx
                ├─ CyR.xlsx
                └─ …
    ```

    Una página no puede escribir en una ruta por su cuenta: usa el selector de carpetas de Edge (*File System Access*). La primera vez en la sesión pide elegir la carpeta **Plan Corporativo** y deja la ruta copiada para pegarla en la barra del selector; también se puede elegir directamente «2026 Facturación» o «10. Octubre». Crea «AAAA Facturación» y la carpeta del mes si no existen. Si la carpeta del mes **ya tiene** archivos con esos nombres, no escribe nada y abre el modal de confirmación con la carpeta y los nombres antes de reemplazarlos.
  - **Si falla** (sin VPN, sin permiso de escritura, selector no disponible): avisa con el motivo y abre «Guardar como» para el **`10. Octubre.zip`** (adentro, la carpeta «10. Octubre» con los archivos), para guardarlo donde se quiera y copiarlo a la red. Si el navegador ya no acepta abrir «Guardar como» sin un clic nuevo, queda un botón en el aviso.
  - **ZIP**: el mismo `.zip`, sin intentar la red.

---

## 7. Riesgos y límites

- **Tarifas incompletas**: solo se confirmaron las de la §4. Una tarifa mal escrita en el equipo cambia todos los valores de ese plan: revisarla contra la factura del operador.
- **El Plan Corporativo manda**: la herramienta no consulta el CM. Si el archivo está desactualizado, la pre-factura también.
- **Reglas de observación por texto**: dependen de que se escriba «se activa / se cancela / se reactiva / se bloquea el *N* de *mes*». Lo que no encaja va a *Revisar*; no se descarta ni se adivina.
- **Cancelación después del corte**: se factura (la línea estuvo todo el corte). No se vio en la reunión; confirmarlo con quien aprueba.
- **Sin prorrateo**: como en el proceso a mano, una línea del corte se factura completa.
- **Columna «Validación»**: se copia tal cual (6 o 10). En las hojas de roaming del Plan Corporativo es `LARGO(línea)`; en *Activos* no se explicó.
- **Guardar en la red depende de Edge**: el selector de carpetas (*File System Access*) necesita que Edge permita escribir en esa ruta de red. Si la carpeta elegida no es la correcta, los archivos quedan donde se eligió: el aviso de éxito muestra la ruta relativa («Plan Corporativo\2026 Facturación\10. Octubre») para comprobarlo. La carpeta elegida se recuerda solo mientras la página está abierta.
- **Roaming a mano**: los valores brutos de roaming no salen de ningún archivo del proceso; se pegan en el paso 3.
- **Años en las observaciones**: una observación sin año se ubica en la ventana de 11 meses antes a 1 mes después del corte. Una observación de hace más de un año sin año puede leerse mal; escribir el año evita la duda.

---

## 8. Historial de cambios

| Versión | Cambios |
| --- | --- |
| 1.1.0 (refactor) | Reorganización interna sin subir versión: `logica-prefactura.js` pasa a `assets/herramientas/prefactura/calculo.js` (reglas de cálculo, sin cambios en los resultados; se quitan de `window.Prefactura` las exportaciones sin uso), el puente a `prefactura.js` y el `<style>` de la página a `prefactura.css`. |
| **1.1.0** | Confirmación de sobrescrituras en red y ZIP; progreso de lectura y generación; estados de tablas. Ayudas «?» y accesibilidad. |
| **1.0.0** | Primera versión, a partir de la reunión «Prefactura» (2025-03-17) y validada contra los archivos reales del proceso. Lee la hoja *Activos* del Plan Corporativo, aplica el corte del 15 a observaciones acumuladas (con ubicación del año), arma una fila por línea y tipo (Botmaker incluido), calcula bruto, IVA, ICO, retefuente y neto con las fórmulas y tarifas de «Liquidación Corporativo 2» (ICO incluido como opción), suma cargos de roaming por valor bruto, resume por empresa y tipo, agrupa filiales como la carpeta Compañía, compara con el mes anterior y genera el consolidado y un archivo por filial. Todo local. |
