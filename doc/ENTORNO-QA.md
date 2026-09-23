# Copia de QA — qué cambia respecto a producción

> Esta rama (`me-operacion-qa`) es la **misma suite apuntando al laboratorio**.
> No es una versión distinta ni lleva funcionalidad propia: lo único que la
> separa de `master` son los endpoints y cómo se manejan las credenciales.
>
> **No se fusiona con `master`.** Si estos cambios llegaran a producción, las
> herramientas seguirían escribiendo en QA aunque dijeran «producción».

---

## 1. Endpoints

| Servicio | Producción (`master`) | QA (esta rama) |
|---|---|---|
| API Gateway (CM) | `obp-apigw.exito-prod.movil-exito.internal` | **`obp-apigw.exito-lab-1.movil-exito.internal`** |
| Keycloak | `keycloak.exito-prod.movil-exito.internal` | **`keycloak.exito-lab-1.movil-exito.internal`** |
| SIME | `296vnext02.grupo-exito.com/SIME/Web` | **`296vnextqa02/SIMEPRB/Web`** |

Dónde vive cada uno:

| Archivo | Qué define |
|---|---|
| `assets/me-api.js` | `apiBase` y `kcBase` del navegador, más `entorno: "QA"`. |
| `assets/logica-prepagadas.js` | La URL de SIME que consulta el navegador. |
| `scripts/lanzador.ps1` | `$SIME_WEB` y `$KC_BASE` para la sesión inicial. |

---

## 2. Credenciales

**El CM no toma nada guardado en el equipo.** En QA el usuario es fijo y el
mismo para todos (`optiva` / `optiva`), así que:

- no se pide por consola ni se guarda en el archivo cifrado con DPAPI;
- `MEUI.cred.get("cm")` devuelve siempre ese usuario, sin mirar el
  almacenamiento del navegador;
- `MEUI.cred.set("cm", …)` no persiste nada;
- si el enlace del lanzador trae `cm_user` / `cm_pass`, **se descartan** y se
  avisa en el registro;
- al arrancar se **borran** los restos de credenciales del CM que hubiera
  dejado una copia de producción abierta antes en el mismo navegador.

El riesgo que esto evita va en los dos sentidos: que una credencial de
producción entre a QA, y que alguien pruebe en QA creyendo que va con su
usuario real.

**SIME es la excepción, a propósito.** Ahí el usuario es el mismo de siempre
(el de `@grupo-exito.com`), solo que contra el SIME de QA: se sigue pidiendo,
guardando cifrado y compartiendo su token `prf` igual que en producción.

---

## 3. Carpetas separadas

Si QA y producción usaran las mismas rutas, el token de SIME y el perfil de
Edge de un entorno pisarían los del otro al abrir los dos el mismo día:

| | Producción | QA |
|---|---|---|
| Credenciales | `%APPDATA%\reporte_prepagadas` | `%APPDATA%\reporte_prepagadas_qa` |
| Perfil de Edge | `%TEMP%\edge_reporte_prepagadas` | `%TEMP%\edge_reporte_prepagadas_qa` |

---

## 4. Cómo se nota que es QA

Un analista no debería poder confundirse:

- **Título de la pestaña**: `[QA] Consumos y Paquetes · CM · v1.8.0`.
- **Cabecera**: etiqueta roja **QA** al lado del nombre de la herramienta.
- **Franja roja** de 3 px en el borde superior de la ventana.
- **Consola del lanzador**: `Herramientas SIME / CM  ***  QA  ***`.
- **Registro**: al abrir dice que el CM usa el usuario por defecto y que no
  guarda credenciales en el equipo.

---

## 5. Publicación y actualización

QA se publica en **su propia carpeta del servidor**, nunca en la de producción:

| | Producción (`master`) | QA (esta rama) |
|---|---|---|
| Carpeta publicada | `https://sebasmd.com/me/operacion/` | **`https://sebasmd.com/me/operacion-qa/`** |
| Nombre del ZIP | `me-operacion-<version>.zip` | **`me-operacion-qa-<version>.zip`** |
| `version.json` | el de producción | el de QA, en su carpeta |

- `scripts/empaquetar-release.ps1` genera el ZIP ya con el nombre de QA y al
  terminar dice a qué carpeta subirlo.
- `scripts/actualizar.ps1` y el aviso de versión de `lanzador.ps1` consultan
  `operacion-qa`. Si apuntaran a producción, «actualizar» convertiría la
  copia de QA en la de producción sin avisar.

> **Cuidado con `release/`.** Esa carpeta viene de `master` y puede tener
> todavía los ZIP y el `version.json` de producción. Sube **solo** los dos
> archivos que nombra el script al terminar, nunca lo que haya suelto ahí.

---

## 6. Mantenimiento

Para traer cambios nuevos de producción:

```bash
git checkout me-operacion-qa
git merge master
```

Los conflictos esperables son solo los de esta tabla (endpoints y el bloque
de credenciales de `me-ui.js`). **Al resolver, gana siempre QA en esos
puntos**: si un merge deja `exito-prod` en esta rama, la copia de QA queda
escribiendo en producción.

Comprobación rápida de que la rama sigue aislada:

```bash
grep -rn "exito-prod\|296vnext02" assets/ scripts/ herramientas/
```

No debe devolver nada.

Y la copia de QA **no se fusiona a `master`**: el flujo es en un solo sentido,
de `master` hacia aquí.
