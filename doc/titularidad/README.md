# Titularidad · Bloqueos de SIM — Documentación técnica

> **Versión: v1.1.0** · Convención: `Major.Minor.Patch`.
> Base compartida: ver `doc/lanzador/README.md`.

Junta en una sola tabla las tres cosas que hacen falta para resolver, en la
llamada, un «me bloquearon la SIM»: **qué pasó** (Genesis), **de quién es la
línea y cómo está** (CM) y **en qué red está** (HLR/HSS de Claro y Tigo).

> Solo lee. No escribe en Genesis, ni en el CM, ni en los HLR.

---

## 1. Para qué existe

La mayoría de las llamadas al call por bloqueo de SIM salen del proceso de
**comprobación de titularidad**. Genesis guarda el log de ese proceso, pero no
dice en qué red está la línea — y sin eso el asesor no cierra la llamada y la
escala. El objetivo es que no tenga que escalarla.

---

## 2. Arquitectura y archivos

| Archivo | Qué contiene |
|---|---|
| `herramientas/titularidad.html` | Solo marcado: tarjetas, pasos, filtros, tabla y modal. |
| `assets/logica-titularidad.js` | Reglas: modelo de fila, carga, enriquecimiento, filtros, tabla y exportación. |
| `assets/me-titularidad-puente.js` | Enganche con el shell. Es el único puente con **dos sesiones**. |
| `assets/genesis-api.js` | Sesión de Genesis, paginación de `FechaExpedicion`, rango de fechas (`tramosDeRango`) y tope de registros. |
| `assets/hlr-consulta.js` | Tigo, Claro y la conclusión de ubicación; en **cascada** por defecto, con `ambos` para consultar las dos (compartido). |
| `assets/cm-lineas.js` | Resolver la línea y su cuenta en el CM (ya existía). |

---

## 3. Endpoints

### Genesis — `FechaExpedicion`

| Método | Endpoint |
|---|---|
| `GET` | `https://tulio.grupo-exito.com/apimew/api/v1/RXDUURMWEECCKC/FechaExpedicion` |

Cosas que no se adivinan:

- **La paginación NO va en la URL.** Va en una cabecera `pagination` con un
  JSON en base64:

  ```json
  {"pageNumber":1,"pageSize":500,"sort":"id","sortOrder":"DESC"}
  ```

  La respuesta devuelve ese mismo objeto ya resuelto, con `count`. De ahí sale
  cuántas páginas faltan.

- **Se ordena `DESC`** (la página 1 son los registros más nuevos) porque es el
  único valor que se ha visto responder contra el servidor real. Lo que eso
  cuesta —que un registro nuevo durante la descarga corra las páginas— lo cubre
  el deduplicado por `id`. Y de ahí sale la carga por defecto: «los últimos N»
  son las primeras páginas, sin recorrer 200.000 filas.

- **El filtro de fecha es un «contiene».** La misma cabecera admite
  `"filter":"FechaHoraTransaccion","filterValue":"…"`, y el valor es un
  «contiene» sobre la fecha ya formateada como `dd/MM/yyyy` (probado contra QA,
  con `pageSize: 1` leyendo solo el `count`): `"12/03/2026"` = un día,
  `"03/2026"` = todo marzo, `"/2026"` = todo 2026. Un mes es **una** consulta,
  no 31; `GENESIS.tramosDeRango` descompone un rango en los tramos más grandes
  que lo cubren exacto (años, meses, días sueltos de las puntas). No está
  probado si el «contiene» vale en cualquier posición o solo al final; por eso
  solo se usan sufijos. Detalle en la cabecera de `genesis-api.js`.

- **El servidor puede conceder menos de lo que se pide.** En la captura
  concede 100 aunque se pidan 500. La herramienta lee el `pageSize` que el
  servidor devuelve y recorre con *ese* valor: avanzar de 500 en 500 cuando
  entrega de a 100 se saltaría cuatro de cada cinco registros sin que nada lo
  avisara.

Campos de cada registro: `id`, `fechaHoraTransaccion`, `tipoOperacion`
(booleano: `true` = bloqueo, `false` = desbloqueo), `linea`, `canal`,
`documento`, `resultado`, `usuario`, `descripcionResultado`, más `request` y
`response` con el SOAP/JSON crudo.

`resultado` se interpretó leyendo las descripciones que acompañan cada valor
en la captura. **No hay catálogo publicado**, así que un valor nuevo se
muestra como «Resultado N» en vez de inventarle un significado:

| Valor | Se muestra como | Qué dicen sus descripciones en la captura |
|---|---|---|
| `0` | Sin cambio necesario | «ya estaba en el estado correcto» (96) · sin descripción (18) |
| `1` | Falló | «estado inválido» (12) · «Respuesta fallida … SOAP 500» (3) |
| `2` | Terminó en estado inesperado | «finalizó, pero la línea quedó en un estado inesperado» (120) |

El `1` se llama «Falló» y no «Estado inválido» por esas 3 filas de fallo SOAP:
la etiqueta tiene que ser cierta para **todas** las filas del grupo, no para
la mayoría. El código crudo viaja igual en la tabla y en la exportación.

Para el call, `1` y `2` significan lo mismo en la práctica —la línea no quedó
como se pedía—, pero se separan porque en `1` la orden no llegó a ejecutarse y
en `2` sí, y eso cambia a quién se escala.

### CM y HLR/HSS

| Fuente | Para qué |
|---|---|
| `GET /api/v1/subscribers?msisdnList=` | Estado de la línea, cuenta (BAN) y SIM. |
| `GET /api/v1/billingAccount?externalID=` | Titular de la cuenta. |
| `GET …/ValideQDN/{msisdn}` (Claro) | Si la línea está activa en Claro. |
| `POST …/autogestion/HLR/consulta` (Tigo) | `RETCODE` del HLR de Tigo. |

---

## 4. Sesión de Genesis

Genesis usa **otro Keycloak** que el CM: otro host, otro realm, otro cliente.

```txt
https://genesisv2.grupo-exito.com/realms/GrupoExito
cliente: genesismovilexito
```

En el navegador, Genesis entra por el **flujo de código de autorización**, que
redirige a `https://genesisme.grupo-exito.com/apimew/genesis/shell/`. Estas
herramientas se abren desde `file://` y ahí ese flujo **no puede completarse**:
el redirect no vuelve a una página local y el fragmento con el código no se
puede leer entre orígenes. Por eso hay dos caminos:

1. **Usuario y contraseña** contra el token endpoint (`grant_type=password`),
   igual que hace `me-api.js` con el realm del CM. Funciona **solo si** el
   cliente `genesismovilexito` tiene habilitado ese flujo; si no, Keycloak
   responde `unauthorized_client` y la herramienta lo dice con esas palabras.
2. **Pegar el token** de una sesión de Genesis ya abierta (DevTools → Red →
   cabecera `Authorization`). Es el camino que siempre funciona, y es lo que de
   verdad significa «tomar la sesión activa»: desde `file://` no hay forma de
   leerla sola.

El token pegado se lee para sacarle `exp` y el usuario, y así el chip de la
cabecera muestra la cuenta atrás real. No se valida la firma: eso lo hace el
gateway.

---

## 5. Funcionalidad

### Paso 1 · Conexión

**Genesis** es obligatoria. **CM** es opcional: solo hace falta para el titular
y el estado de la línea. Las credenciales del CM se comparten con las demás
herramientas, como siempre.

### Paso 2 · Datos de Genesis

Hay **tres formas** de cargar, de la más barata a la más cara, y los botones
siguen ese orden:

| Botón | Qué trae | Cuánto cuesta |
|---|---|---|
| **Cargar los últimos 2.000** (por defecto) | Los N registros **más nuevos**, sin fechas. N sale de `GENESIS.CONFIG.topeRegistros`. | 4 peticiones: en segundos hay qué mirar. |
| **Cargar rango** | Un rango «Desde / Hasta», **sin tope**. | Un mes completo es **1** consulta; el aviso bajo las fechas dice cuántos tramos y peticiones son **antes** de lanzar. |
| **Traer todo el log, sin rango ni tope…** | Todo (más de 200.000 registros). | Miles de peticiones y de 5 a 10 minutos. |

Los dos campos de fecha arrancan con **el mes en curso** (del día 1 al último
día, en hora de Bogotá), pero solo como **sugerencia visible**: «Cargar los
últimos 2.000» no las usa. Si lo hiciera, quien solo quiere ver lo último
esperaría un mes de datos, y quien dejó las fechas sin mirar cargaría algo que
no pidió. Por eso son dos botones y no uno que adivine.

«Traer todo» no es el camino fácil: está dentro de un `<details>` cerrado, con
un aviso de cuánto cuesta y una casilla de confirmación que se vuelve a
desmarcar tras cada uso. Que el que lo elija sepa lo que elige.

**Una carga con tope no es la carga completa y se dice así**, no solo en el
registro: al llegar al tope el registro dice «2.000 registros (los más nuevos)
de 208.249. No es la carga completa: elige un rango de fechas para ver más», y
queda una nota fija, resaltada, bajo los botones. Llegar al tope tampoco es
«cancelar»: `completo` sigue en `true` y lo que lo delata es `topeAlcanzado`.

Mientras carga:

- el botón muestra **spinner** y queda deshabilitado;
- la **barra de progreso** avanza con `fraccion` (0 a 1) de `GENESIS.cargarTodo`.
  Con rango, `total` **crece** mientras se avanza (no se sabe lo que tiene un
  tramo sin preguntarle), así que `leidos/total` no es monótono y la barra
  retrocedería: medido con tramos de varias páginas, retrocede. Con tope, la
  barra se mide contra `min(tope, total)`: con la fórmula de `fraccion`
  (`leidos/tope`) una tabla de 249 registros terminaría en el 12 %;
- el texto dice **lo que es verdad en cada modo**: con rango, «Genesis · día
  12/03/2026 (tramo 3 de 8) · 1.230 registros · página 2 de 9» (nunca «X de Y»
  sobre un total que va creciendo); con tope, «X de N registros (los más
  nuevos)»; sin rango ni tope, «X de Y registros (página a de b)»;
- **la tabla se va llenando**, no espera al final.

Los mensajes de fin de carga también cambian según el modo, porque `total`
solo suma los tramos consultados y el deduplicado entre tramos deja `leidos`
por debajo: comparar uno con otro («Genesis reportó X pero entregó Y»), como
se hace sin rango, daría un aviso falso en el caso normal. Con rango se dice el
lapso, los días, los tramos y las peticiones; si Genesis contó más de lo que
se guardó, se explica la diferencia (repetidos entre tramos contiguos, que se
descartan a propósito, o una página vacía). Un rango sin registros se dice con
esas palabras en vez de dejar el mensaje de «inicia sesión».

El repintado sigue una pauta por **tiempo de carga**, no por número de filas:

| Momento | Repinta cada | Por qué |
|---|---|---|
| Primeros **2 s** | **0,5 s** | Es cuando hay que ver que arrancó y que entran datos de verdad. |
| De ahí en adelante | **5 s** | Eso ya se sabe; lo que falta es que termine, y repintar seguido solo le quita tiempo. |

DataTables rehace el conjunto **entero** en cada repintado, así que el coste
sube con cada página que llega. En una carga de 14 s medida, la pauta da 6
repintados (`0,4 · 0,9 · 1,5 · 2,0 · 7,1 · 12,1 s`) en lugar de casi treinta.

Se puede cancelar: lo que ya llegó se conserva y se dice que quedó a medias.

Los registros **no se guardan dos veces**: el cliente de Genesis entrega cada
página y se queda solo con los ids ya vistos (para deduplicar), no con los
registros, que ya los tiene la tabla.

Dos decisiones que importan con 200.000+ registros:

- **Orden descendente por `id`** (ver §3). Un registro nuevo durante la descarga
  puede correr las páginas; el deduplicado por `id` es la garantía real, y es
  uno solo para toda la carga, no se reinicia por tramo.
- **`request` y `response` se descartan.** Son unos 2 KB por registro: a
  200.000 registros, cientos de megas guardados para no mirarlos. Al abrir el
  detalle de una fila se vuelve a pedir **esa** página a Genesis.

Si Genesis dice una cuenta y entrega menos, se avisa en el registro en vez de
dar la carga por buena.

### Tabla · por qué la tabla no tiene los datos

DataTables va en modo **`serverSide`**, pero el «servidor» es el arreglo en
memoria de esta misma página. No es una elección de estilo; está medido en
Chromium con DataTables 2.3.2 y los 208.249 registros reales:

| | Con las 208.249 filas dentro de DataTables | Con las filas en un arreglo y la tabla en `serverSide` |
|---|---|---|
| Carga completa | **no terminó en 11 min** | **19,9 s** |
| Filas que sostiene la tabla | 208.249 | **50** (la página visible) |
| Heap | ~242 MB | ~179 MB |
| Un repintado | **2.979 ms** | — (constante, solo pinta 50) |
| Paginar | — | 34 ms |
| Ordenar | — | 87 ms |
| Aplicar un filtro | — | 237 ms |

El dato que lo explica: un arreglo plano de 208.249 filas ocupa **48 MB** y
filtrarlo cuesta **7 ms**, ordenarlo **26 ms** y sacar una página de 50,
**0 ms**. Los datos no pesan; pesaba metérselos a la tabla.

Por eso el filtrado, el orden y la paginación los hace esta herramienta
(`fuenteDatos`, `ordenadas`, `filaPasaFiltros`) y a DataTables solo le llega
la página que se está viendo. El buscador propio de la tabla se **suma** al de
la barra de filtros, no compite con él.

Las vistas intermedias (lo filtrado, y lo filtrado ya ordenado) se memorizan y
se invalidan en `render()`, que es por donde pasa todo cambio: así paginar u
ordenar no vuelve a filtrar 208.000 filas para nada.

> **Un archivo temporal no habría servido.** Es la primera idea razonable
> —«que el fetch escriba y la tabla lea»— pero resuelve el problema
> equivocado: la memoria de los datos son 48 MB, no es lo que ahogaba. Y
> DataTables necesita las filas **en memoria** para pintar, ordenar y
> filtrar, así que leerlas de un archivo significa pagar la escritura, pagar
> la lectura y después el mismo coste. El lanzador abre Edge con
> `--allow-file-access-from-files`, así que técnicamente se podría (IndexedDB);
> simplemente no hace falta.

Columnas, de izquierda a derecha: casilla · **Línea** · **Operación** ·
**Resultado** · **Fecha** · HLR/HSS · Estado línea (CM) · Claro · Tigo ·
Titular (CM) · Documento · Cuenta (BAN) · Canal · Usuario · Descripción · ID ·
y al final el botón **Ocultar/Mostrar** de cada fila (como en «Estado de
líneas»). Lo primero es lo que se mira al empezar una llamada de «me
bloquearon la SIM».

**Orden por defecto: de más nuevo a más viejo, por Fecha** (no por `id`). Está
declarado en DataTables y además es el respaldo de `ordenadas()`: si la tabla
pidiera datos sin orden, no debe caer en el orden de Genesis. El clic en una
cabecera sigue ordenando; «Fecha» alterna solo entre descendente y ascendente
(con DataTables 2 el tercer clic quita el orden, y como lo más nuevo primero ya
es el respaldo, el primer clic sobre «Fecha» parecería no hacer nada). Las
fechas se comparan como texto (son ISO, ya ordenan como el tiempo) con el `id`
como desempate.

Al hacer clic en una fila (fuera de la casilla y los botones) se abre el
detalle con el SOAP crudo, que se vuelve a pedir a Genesis. Se busca **dentro
del día de la fila** (filtro `dd/MM/yyyy`): `GENESIS.detalleDe` calcula la
página como `ceil(id / tamaño)`, que solo vale con orden ascendente y un
servidor que conceda el tamaño pedido; con `DESC` y páginas de 100, medido con
un servidor simulado que respeta el orden, no encuentra el registro casi nunca.

### Selección y consultas (de 1 a n)

La **casilla de la cabecera** marca solo **la página que se ve** (queda «a
medias» si lo están algunas). Marcar más son dos acciones en texto, con su
cuenta a la vista:

- **Seleccionar todos (N)**: todo lo que pasa los filtros (N = cuántas filas
  son; no cuenta las ocultas). Suma a lo que ya estaba marcado.
- **Seleccionar primeros 2.000**: las primeras filas **en el orden en que se
  ven**, hasta el tope de consultas (`CONFIG.maxSeleccion`). **Reemplaza** la
  selección anterior: el sentido es «justo estas», y sumarlas a otras marcas
  podía volver a pasarse del tope.

«Desmarcar todo» desmarca de verdad todo (antes solo lo filtrado, aunque el
botón dijera «todo»).

El tope (2.000) es de **consultas**, en líneas únicas, no de marcado: se puede
marcar todo, pero «Consultar» se niega y manda a «Seleccionar primeros 2.000».
No es una limitación técnica: marcar cinco mil filas y mandarlas a consultar es
casi siempre un clic por accidente.

### Mostrar | Ocultar

Mismo lenguaje que en «Estado de líneas» y «Cierre masivo de casos»
(`CMLineas.tablaSeleccionable`): botón **Ocultar/Mostrar** en cada fila, **Ocultar
marcadas**, **Ocultar no marcadas**, **Mostrar todas** y la casilla **Ver
ocultas (N)**, con la clase `fila-oculta` (atenuada y tachada).

Una fila oculta **no se exporta ni entra en las consultas**, ni siquiera cuando
«Ver ocultas» la está mostrando: ocultar es «esto no me interesa», no «escóndelo
un rato». Tampoco cuenta en las tarjetas ni en «Seleccionar todos». «Limpiar»
(filtros) no las devuelve: eso es «Mostrar todas».

**Una misma línea puede aparecer en varios registros.** Se consulta **una vez**
y el resultado se copia a todas sus filas: en la captura, 249 registros son
solo 151 líneas únicas.

Hay un tope de **2.000 líneas** por tanda. No es una limitación técnica: marcar
cinco mil filas y mandarlas a consultar es casi siempre un clic por accidente.

### «En batch»: qué significa aquí

**Claro no tiene servicio de lote.** Su QDN es una petición por línea
(`.../ValideQDN/{msisdn}`). Así que «en batch» son **tandas controladas**: un
pool de concurrencia configurable (5 por defecto, máximo 15), igual que el
cruce HLR y los validadores.

**El HLR/HSS va en cascada por defecto**: se pregunta a Tigo y **solo si Tigo no
la encuentra con perfil** se pregunta a Claro. Es más rápido y manda menos
peticiones (cada línea tiene ~1 en vuelo, no 2), pero tiene un costo que hay que
conocer: **no puede detectar una línea dada de alta en las dos redes**, porque
si Tigo la encuentra a Claro no se le pregunta (la columna Claro dice «No
consultado»). Para eso está la casilla **«Consultar en ambos HLR/HSS»**, junto
al botón de consulta: pasa `ambos: true` a `HLRConsulta.consultarVarias`, sirve
igual para una línea que para varias, cuesta 2 peticiones por línea (10 en vuelo
con 5 en paralelo) y es la **única** forma de que «Ambos — revisar» aparezca.

Mil líneas salen en tandas, con progreso en vivo, sin tumbar el gateway. Un
error en una línea no tumba la tanda: esa queda marcada y las demás siguen.

### Filtros, tarjetas y exportación

Filtros por texto (línea, documento, titular, descripción, IMSI), operación,
resultado, **operador**, canal, marcadas/sin marcar y «Ver ocultas».

**Operador** (Claro / Tigo / Ambos / Ninguno / No concluyente, más los dos
residuos en Tigo que ya existían) filtra por la **ubicación ya resuelta**, no por
las columnas Claro y Tigo: en cascada la columna Claro puede decir «No
consultado», y eso no es un operador. Sus opciones son fijas, salen de
`HLRConsulta.ETIQUETA_UBICACION` y se muestran **todas aunque aún no haya filas**
de ese tipo, así «Ambos» está a la vista como posibilidad.

**Tarjeta «HLR no concluyente»** (antes «HLR a revisar»). Contaba «Ambos —
revisar» + «No concluyente»; con la cascada, «Ambos» ya no puede aparecer salvo
con «Consultar en ambos», así que la tarjeta prometía algo que casi nunca iba a
mostrar. Ahora cuenta **solo** «No concluyente» (las dos redes fallaron: hay que
volver a consultar), que es lo único cierto en los dos modos. «Ambos — revisar»
se encuentra con el filtro de operador. Los residuos en Tigo tampoco se suman:
no estaban antes y nadie lo pidió.

**Lo que se exporta es lo que se ve**: mismos filtros y **mismo orden** (de más
nuevo a más viejo; antes salía en el orden de Genesis, así que la frase era
falsa en el orden). CSV, Excel y JSON, con el separador compartido de la suite.
Las columnas de la exportación **no** siguen el orden nuevo de la tabla (quien
procesa estos archivos cuenta con las posiciones de siempre). Las filas ocultas
no salen nunca.

### Repintados: qué se hace y qué no

Cada tanda que llega y cada consulta que termina llaman a `render()`. Antes,
cada llamada hacía **tres recálculos de layout**: `mostrarSiHayDatos` (que
programa dos temporizadores con `columns.adjust()` + `ajustarTablas()`),
`ajustarTablas()` otra vez al final, y reescribir el `innerHTML` de cuatro
`<select>`. Ahora, en régimen normal, no hace ninguno:

- `mostrarSiHayDatos` solo cuando la tabla pasa de vacía a con datos (o al
  revés). «Hay datos» es que haya filas **cargadas**, no que la página tenga
  filas: un filtro sin coincidencias ya no oculta la tabla y su buscador.
- Las opciones de los filtros salen de los datos y se acumulan **al cargar**
  (repintar no recorre 208.000 filas para recalcularlas); si no hay un valor
  nuevo no se toca el DOM; si lo hay, se **insertan** solo las `<option>` que
  faltan (la elegida no se mueve); si el `<select>` tiene el foco, se espera a
  que lo suelte. El de operador es fijo y se escribe una sola vez.
- `ajustarTablas` no se llama: el alto del panel y los anchos no dependen de
  cuántas filas llegaron, y la tabla ya se re-mide cuando aparece, al cambiar
  el tamaño de la ventana y al abrir o cerrar un paso (eso lo hace `me-ui`).
- Las tarjetas, el resumen de selección y el progreso escriben solo si el texto
  cambió, y las tarjetas se calculan en una pasada (eran cuatro filtros y un
  `Set` sobre 208.000 filas).
- El scroll del cuerpo se lee antes de dibujar y se devuelve después, **solo si
  la vista es la misma** (misma página, orden y filtros).

Medido con Chromium y DataTables 2.3.2 **reales** (CDP, 5.000 filas, 10
repintados de datos, página de 50), comparando contra el `HEAD` anterior:

| Por repintado | Antes | Ahora |
|---|---:|---:|
| Layouts del navegador | 49 | 9 |
| Tiempo en layout | 44 ms | 17 ms |
| `columns.adjust()` | 5 | 0 |
| `ajustarTablas` (directo + temporizadores) | 3 | 0 |
| `<select>` reescritos | 4 | 0 |

Los 9 que quedan son el `draw()` de DataTables, que es lo mínimo. Cada
transición vacío ⇄ con datos sigue costando los tres de siempre, pero ocurre una
vez por carga, no una por tanda.

**Lo que no se pudo reproducir:** que el scroll del cuerpo de la tabla «salte al
principio». En Chromium con DataTables 2.3.2 el `scrollTop` sobrevivía al
`draw(false)` **también antes** del cambio, y durante una carga lenta tampoco
caía a 0. La conservación del scroll queda como seguro (con un navegador
simulado que sí lo reinicia, antes se perdía y ahora no), pero **no está
demostrado que sea la causa** de lo que ve el analista: puede ser la página, el
panel lateral o un comportamiento distinto de Edge con la hoja de Bootstrap real
(esta prueba usó un sustituto de esa hoja). Si el síntoma sigue, hay que medirlo
en el Edge del analista.

---

## 6. Riesgos

- **Transporte HTTP plano hacia el CM**; Genesis y los HLR sí van por HTTPS.
  Los tokens quedan en memoria del navegador.
- **El inicio de sesión por usuario y contraseña puede no estar habilitado**
  en el cliente `genesismovilexito`. No se pudo comprobar contra el realm real:
  si no funciona, queda el token pegado, que siempre funciona.
- **El token pegado no se renueva solo**: no trae `refresh_token`. Cuando
  vence hay que pegar uno nuevo, y la herramienta lo dice en vez de fallar con
  un 401 sin explicación.
- **El catálogo de `resultado` es una interpretación**, no un catálogo
  publicado. Un valor nuevo aparece como «Resultado N».
- **`hlr-consulta.js` es una TERCERA copia** de las reglas de Claro/Tigo
  (las otras dos son `logica-hlr-cruzado.js` y `logica-hlr-hss-ambos.js`, que
  ya eran copias entre sí). El texto se copió sin cambiar una línea, pero si
  se cambia una regla hay que cambiarla en las tres. Lo sano sería que las tres
  usaran este archivo.
- **La descarga completa son miles de peticiones seguidas.** Es lenta, no
  incorrecta. Con el tamaño de página que concede el gateway (100 en la
  captura) son más de 2.000 páginas. Por eso no es el camino por defecto.
- **Una carga con tope no es completa.** Lo que se ve son los N más nuevos;
  la nota bajo los botones y el registro lo dicen, pero quien exporte esa tabla
  exporta solo eso.
- **`GENESIS.detalleDe` asume orden ascendente y el tamaño pedido.** La
  herramienta no lo usa primero (busca dentro del día de la fila), pero queda
  como respaldo y, tal como está, no sirve con `DESC`.
- **Dependencia de CDNs externos**: sin ellos la página no carga.
- **El titular viene de la cuenta de facturación**, que da nombre pero **no
  documento**. Comparar el documento de Genesis contra el del titular en el CM
  sería el paso natural siguiente; esa resolución (subir por la cadena de
  cuentas) ya existe en `logica-consumos.js` y no se portó aquí para no dejar
  una cuarta copia de la misma lógica sin poder probarla.

---

## 7. Historial de cambios

| Versión | Cambios |
|---|---|
| **1.1.0** | Carga por defecto de «los últimos N» (tope de `GENESIS.CONFIG`), rango de fechas sin tope con aviso de tramos antes de lanzar y «Traer todo» aparte y con confirmación; barra de progreso por `fraccion`; mensajes de fin de carga ciertos en los tres modos. Columnas Línea · Operación · Resultado · Fecha primero y orden por defecto de más nuevo a más viejo. La casilla de la cabecera marca solo la página; «Seleccionar todos (N)» y «Seleccionar primeros 2.000». Mostrar/Ocultar filas (no se exportan ni se consultan). Filtro por operador. Casilla «Consultar en ambos HLR/HSS» (el HLR/HSS va en cascada por defecto) y tarjeta «HLR no concluyente». Menos recálculos de layout por repintado. Detalle de fila buscado dentro de su día. |
| **1.0.0** | Versión inicial. Carga completa del log de Genesis, enriquecimiento bajo demanda con CM y HLR/HSS sobre las líneas marcadas, filtros, detalle con el SOAP crudo y exportación. |
