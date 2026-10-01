# Titularidad · Bloqueos de SIM — Documentación técnica

> **Versión: v1.0.0** · Convención: `Major.Minor.Patch`.
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
| `assets/genesis-api.js` | Sesión de Genesis y paginación de `FechaExpedicion`. |
| `assets/hlr-consulta.js` | Claro + Tigo y la conclusión de ubicación (compartido). |
| `assets/cm-lineas.js` | Resolver la línea y su cuenta en el CM (ya existía). |

---

## 3. Endpoints

### Genesis — `FechaExpedicion`

| Método | Endpoint |
|---|---|
| `GET` | `https://tulio.grupo-exito.com/apimew/api/v1/RXDUURMWEECCKC/FechaExpedicion` |

Dos cosas que no se adivinan:

- **La paginación NO va en la URL.** Va en una cabecera `pagination` con un
  JSON en base64:

  ```json
  {"pageNumber":1,"pageSize":500,"sort":"id","sortOrder":"ASC"}
  ```

  La respuesta devuelve ese mismo objeto ya resuelto, con `count`. De ahí sale
  cuántas páginas faltan.

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

Trae el log **completo**. Avisa del avance («120.300 de 208.249, página 241 de
417») y se puede cancelar: lo que ya llegó se conserva y se dice que la carga
quedó a medias.

Dos decisiones que importan con 200.000+ registros:

- **Orden ascendente por `id`.** Con descendente, cada registro nuevo que entra
  mientras se descarga corre todas las páginas una posición y se empiezan a
  repetir y a perder filas. Ascendente, lo nuevo se agrega al final. Aun así se
  deduplica por `id`, que es la única garantía real.
- **`request` y `response` se descartan.** Son unos 2 KB por registro: a
  200.000 registros, cientos de megas guardados para no mirarlos. Al abrir el
  detalle de una fila se vuelve a pedir **esa** página a Genesis.

Si Genesis dice una cuenta y entrega menos, se avisa en el registro en vez de
dar la carga por buena.

### Tabla

DataTables con `deferRender` y `orderClasses: false` — con esta cantidad de
filas, pintarlas todas o recalcular clases al ordenar bloquea el navegador.

Columnas: casilla · **Línea** · **HLR/HSS** · **Estado línea (CM)** · Claro ·
Tigo · Titular (CM) · Documento (Genesis) · Cuenta (BAN) · Operación ·
Resultado · Fecha · Canal · Usuario · Descripción · ID.

Al hacer clic en una fila (fuera de la casilla) se abre el detalle con el SOAP
crudo, que se vuelve a pedir a Genesis.

### Selección y consultas (de 1 a n)

Se marcan filas a mano o con **Marcar lo filtrado** — que marca **todo lo que
pasa los filtros**, no solo la página visible, que es lo que uno espera al
filtrar y marcar «todas».

**Una misma línea puede aparecer en varios registros.** Se consulta **una vez**
y el resultado se copia a todas sus filas: en la captura, 249 registros son
solo 151 líneas únicas.

Hay un tope de **2.000 líneas** por tanda. No es una limitación técnica: marcar
cinco mil filas y mandarlas a consultar es casi siempre un clic por accidente.

### «En batch»: qué significa aquí

**Claro no tiene servicio de lote.** Su QDN es una petición por línea
(`.../ValideQDN/{msisdn}`). Así que «en batch» son **tandas controladas**: un
pool de concurrencia configurable (5 por defecto, máximo 15), igual que el
cruce HLR y los validadores. Cada línea dispara 2 peticiones (Claro y Tigo a la
vez), así que 5 líneas en paralelo son 10 peticiones en vuelo.

Mil líneas salen en tandas, con progreso en vivo, sin tumbar el gateway. Un
error en una línea no tumba la tanda: esa queda marcada y las demás siguen.

### Filtros y exportación

Filtros por texto (línea, documento, titular, descripción, IMSI), operación,
resultado, ubicación HLR, canal y marcadas/sin marcar.

**Lo que se exporta es lo que se ve**: mismos filtros, mismo orden. CSV, Excel
y JSON, con el separador compartido de la suite.

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
- **La descarga completa son cientos de peticiones seguidas.** Es lenta, no
  incorrecta. Con el tamaño de página que concede el gateway (100 en la
  captura) son más de 2.000 páginas.
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
| **1.0.0** | Versión inicial. Carga completa del log de Genesis, enriquecimiento bajo demanda con CM y HLR/HSS sobre las líneas marcadas, filtros, detalle con el SOAP crudo y exportación. |
