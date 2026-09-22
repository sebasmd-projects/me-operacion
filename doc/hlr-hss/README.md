# HLR/HSS · Claro y Tigo — Documentación técnica

> **Versión: v2.4** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Junta en **una sola página con pestañas** lo que antes eran **tres herramientas separadas**:

| Pestaña | Reemplaza a | Qué hace |
| --- | --- | --- |
| **Tigo** | Consulta QDN · Tigo | Consulta el HLR/HSS de Tigo por autogestión. Solo lectura. |
| **Claro** | Validador QDN · Claro | Consulta el QDN de Claro y **opera la línea** (bloqueo/desbloqueo/conciliación), con doble confirmación. Escribe en producción. |
| **Ambos** | ¿En qué HLR está? | Consulta Claro y Tigo **en paralelo** y concluye en cuál de las dos redes está la línea. Solo lectura. |

Cada pestaña es **la misma herramienta de antes, sin cambios de lógica** — ver «Por qué» más abajo. El detalle forense completo de cada operador (catálogo de RETCODE, interpretación de bloqueos, heurísticas del perfil HLR, reglas de las operaciones de escritura) sigue viviendo en la documentación original de cada uno, enlazada al final de este documento.

---

## Por qué se fusionaron

Las tres herramientas consultaban cosas relacionadas (HLR/HSS por operador) pero vivían en pestañas del menú distintas, obligando a abrir una, anotar, cerrar, abrir la siguiente. Juntarlas bajo un solo punto de entrada con pestañas internas reduce ese salto sin tocar ninguna regla de negocio ya probada en producción.

**Cómo se hizo, con el mínimo riesgo posible:**

1. Cada motor (`logica-qdn.js`, `logica-qdn-tigo.js`, `logica-hlr-cruzado.js`, y `logica-qdn-operaciones.js` para las operaciones de escritura de Claro) se copió **tal cual, sin tocar una sola línea de sus reglas de negocio**, envuelto en su propio `(function(){ ... })()`.
2. El envoltorio es necesario porque los tres motores declaran los mismos nombres de nivel superior (`filas`, `render`, `consultar`, `dataTable`, `ejecutarPool`...) — al vivir antes en páginas separadas nunca chocaban; en una sola página sí lo harían.
3. `logica-qdn.js` y `logica-qdn-operaciones.js` (Claro) van en un **mismo IIFE compartido**, no en dos separados: `logica-qdn-operaciones.js` referencia variables de `logica-qdn.js` por nombre suelto (`gestorQdn`, `cfgQdn`, `filas`, `render`, etc.), exactamente como cuando eran dos `<script>` de una misma página. Un cierre compartido preserva ese acople intacto.
4. El marcado (KPIs, pasos, tabla, modal) de cada herramienta original se copió, también tal cual, dentro de un `<template>` propio. Un `<template>` no forma parte del DOM activo, así que los tres pueden convivir en el archivo sin que sus ids choquen.
5. Al cambiar de pestaña, `me-hlr-hss-puente.js` **desmonta por completo** la pestaña anterior antes de montar la siguiente — nunca hay más de un `<template>` clonado en el documento a la vez. Es necesario porque los tres motores comparten ids (`#tablaResultados`, `#inputLineas`, `#modalDetalle`...); tenerlos montados a la vez duplicaría esos ids y solo el primero respondería.

**Verificación de fidelidad**: el contenido de cada motor envuelto se comparó línea por línea (`diff`) contra el archivo original antes de esta fusión — la única diferencia son los comentarios nuevos explicando el envoltorio.

---

## Arquitectura y archivos

| Archivo | Qué contiene |
| --- | --- |
| `herramientas/hlr_hss.html` | Solo marcado: pestañas, y un `<template>` por operador con el marcado original de esa herramienta. |
| `assets/logica-hlr-hss-tigo.js` | Motor Tigo = copia envuelta de `logica-qdn-tigo.js`. |
| `assets/logica-hlr-hss-claro.js` | Motor Claro = copia envuelta de `logica-qdn.js` + `logica-qdn-operaciones.js` (mismo IIFE). |
| `assets/logica-hlr-hss-ambos.js` | Motor Ambos = copia envuelta de `logica-hlr-cruzado.js`. |
| `assets/me-hlr-hss-puente.js` | Interruptor de pestañas: monta/desmonta el `<template>` activo y llama a `MotorX.iniciar()` (y `MotorX.reiniciar()` si ya se había visitado esa pestaña, para no reusar un `DataTable` apuntando a una tabla ya desmontada). |
| `assets/me-ui.js` / `me-ui.css` | Shell, tablas y exportación. **Común.** |

Cada motor expone un objeto global mínimo:

```js
window.MotorTigo  = { iniciar, reiniciar };
window.MotorClaro = { iniciar, reiniciar };   // iniciar() llama a inicializarQdn() + inicializarOperaciones()
window.MotorAmbos = { iniciar, reiniciar };
```

`iniciar()` es exactamente la función que antes se auto-ejecutaba sola al cargar el script (`inicializarQdn();` / `inicializarTigo();` / `inicializarCruce();`); aquí se difiere hasta que esa pestaña se monta de verdad en el DOM, porque antes de eso `MEUI.$("#tablaResultados")` y compañía no encontrarían nada.

---

## Cambiar de pestaña reinicia esa consulta

Al volver a Tigo después de haber estado en Claro, la pestaña Tigo **empieza vacía otra vez** — no se guardan los resultados de una pestaña mientras se está en otra. Es consecuencia directa de desmontar/remontar el `<template>`: cada motor mantiene su tabla y sus filas en variables privadas de su propio cierre, y esas variables no sobreviven a que su `<table>` se haya ido del documento.

Si esto resulta molesto en el uso diario, la mejora natural sería que cada motor exponga también un `guardarEstado()`/`restaurarEstado()` — no se hizo en esta primera versión para no tocar más de lo necesario la lógica ya probada.

---

## Riesgos y límites

- **Claro escribe en producción.** El motor Claro incluye bloqueo, desbloqueo y conciliación de línea, más (desde v2.1 de ese motor, ya con la fusión hecha) **cambio de IMSI/ICCID/KI y cambio de MSISDN** — las dos últimas marcadas como **riesgo alto**, solo disponibles por línea individual (nunca en el menú masivo), con doble confirmación y vista antes/después de cada campo. Detalle completo en `doc/validador-qdn/README.md` §11.
- **Un solo `<template>` montado a la vez.** Es la pieza que hace posible la fusión sin renombrar ids; si algún día se quisiera ver dos pestañas simultáneamente (por ejemplo, para comparar), habría que namespacing real de ids, que sí toca la lógica de cada motor.
- **Los archivos originales siguen en el repositorio** (`validador_qdn.html`, `logica-qdn.js`, `logica-qdn-operaciones.js`, `me-qdn-puente.js`, `validador_qdn_tigo.html`, `logica-qdn-tigo.js`, `me-qdn-tigo-puente.js`, `validador_hlr_cruzado.html`, `logica-hlr-cruzado.js`, `me-hlr-cruzado-puente.js`), pero **ya no están en el menú ni en la portada**: quedaron ahí a propósito, como respaldo, hasta confirmar que `hlr_hss.html` funciona igual en un equipo real. Una vez confirmado, se pueden borrar (avísalo para hacerlo).
- **Distribución**: igual que las demás herramientas de esta suite — se descargan y ejecutan localmente en los PC administrados, no se publican en un servidor.

---

## Documentación de cada motor (detalle forense completo)

Estos tres documentos **no se duplicaron aquí**: siguen siendo la referencia técnica completa de cada motor (catálogo de RETCODE, interpretación de bloqueos, heurísticas del perfil HLR, reglas de las operaciones de escritura de Claro). Este README solo documenta la fusión; para las reglas de negocio de cada pestaña, ir a:

- **[doc/consulta-qdn-tigo/README.md](../consulta-qdn-tigo/README.md)** — pestaña Tigo.
- **[doc/validador-qdn/README.md](../validador-qdn/README.md)** — pestaña Claro, incluidas las operaciones de escritura.
- **[doc/hlr-cruzado/README.md](../hlr-cruzado/README.md)** — pestaña Ambos.

---

## Historial de cambios

| Versión | Cambios |
|---|---|
| **2.4** | Pestaña Claro: las operaciones (bloqueos, conciliación, aprovisionar…) reintentan solas los **errores de conexión** (conexión cerrada/reseteada sin respuesta, frecuente en lotes grandes), hasta 2 veces con espera creciente. El **timeout** sigue sin reintentarse solo. Ver `doc/validador-qdn/README.md` §11.4. |
| 2.3 | Pestaña Claro: **Aprovisionar y Conciliación** ya se ofrecen también en el menú masivo, pero solo sobre las líneas **marcadas con checkbox** (columna nueva al frente de la tabla, más un filtro `#fSel`) — no sobre todo lo filtrado, como bloqueos/desbloqueos. Desaprovisionar se queda fuera del masivo. Ver `doc/validador-qdn/README.md` §11.8. |
| 2.2 | Pestaña Ambos: la tarjeta **Ambos / no concluyente** ahora filtra los dos resultados que requieren revisión; el desplegable de Ubicación ofrece el mismo filtro agrupado y conserva las opciones individuales. |
| 2.1 | Pestaña Claro: menú de operaciones reorganizado (Procesos → SIM y número → Bloqueos plegados por familia, con iconos), modal de operación más ancho, entrada de texto con encabezado (la línea por nombre de columna normalizado, más `imsi`/`iccid`/`ki` si vienen) y aviso de discrepancias entre la entrada y el QDN. Ver `doc/validador-qdn/README.md` §4.1, §4.2 y §11.1. |
| 2.0 | **Sesión del CM en la pestaña Claro** (bloque dentro del paso 1, chip en la cabecera, credenciales compartidas con las demás herramientas): no consulta nada, solo identifica quién opera. Con ella, los usuarios autorizados ven el grupo **Aprovisionamiento** (crear/eliminar la línea en el HLR/HSS) — ver `doc/validador-qdn/README.md` §11.8. **Esc con modales anidados** cierra primero el formulario de la operación y después el detalle (antes cerraba el detalle y dejaba el formulario). El paso «Líneas a consultar» de Claro pasa a abrirse siempre (antes dependía de la sesión). |
| 1.1 | Arreglos de interfaz reportados en uso: **(1)** la columna de pasos no se podía contraer en ninguna pestaña — `montarTogglePasos()` corre dentro de `MEUI.init()`, cuando `.me-trabajo` todavía vive dentro del `<template>` y no existe en el documento, así que el botón «Contraer» no se montaba nunca (y cada cambio de pestaña destruye el que hubiera); ahora el puente lo vuelve a montar en cada montaje, igual que ya hacía con los pasos. **(2)** La **Conexión QDN** de Claro ahora viene **contraída** y **sin botón «Probar conexión»**, igual que la de Tigo: el token se pide solo al consultar, y conectar a mano se hace desde el chip de sesión de la cabecera (que ahora llama a `MotorClaro.conectar()` en vez de simular un clic en un botón que ya no existe). **(3)** En el modal de operación, «Se omiten» y **«Cuerpo que se envía» vienen plegados** (`<details>`), para que el formulario se lea de corrido. **(4)** La **tabla de confirmación** se rediseñó: ancho de columnas fijo (`table-layout: fixed`) en vez de automático —era la causa de que el valor actual y el input se encimaran—, línea y estado en una sola columna, el cambio se lee como **«antes / después»** en dos renglones etiquetados y alineados (antes era el valor viejo con una flecha suelta encima del input, sin decir cuál era cuál), encabezado fijo al hacer scroll, y la columna **Features** pasa de listar todo el detalle a un resumen corto («2 bloqueos detectados»), con el detalle completo en el tooltip. |
| 1.0 | Primera versión: fusiona Validador QDN · Claro, Consulta QDN · Tigo y ¿En qué HLR está? en una sola herramienta con pestañas, reusando los tres motores sin cambios de lógica. |
