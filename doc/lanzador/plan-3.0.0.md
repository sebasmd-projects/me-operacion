# Plan 3.0.0 — Releases desde la carpeta de red

> Estado: **implementado** (pendiente de publicar) · 2026-09-30 · Afecta a `scripts\lanzador.ps1`,
> `scripts\actualizar.ps1`, `scripts\empaquetar-release.ps1` y su documentación.

## 1. Qué cambia

Hoy la suite se publica en un dominio personal (`https://sebasmd.com/me/operacion/`):
el empaquetador deja el `.zip` y `version.json` en `release\`, alguien los sube a mano,
el lanzador lee `version.json` por HTTPS y el actualizador descarga el `.zip` por HTTPS.

En la 3.0.0 el origen pasa a ser una **carpeta de red de la compañía**:

```text
\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release
```

| Pieza | Hoy (2.x) | 3.0.0 |
|---|---|---|
| `empaquetar-release` | Genera en `release\` y pide subir a sebasmd.com | Genera en `release\` **y publica en la carpeta de red** (zip primero, `version.json` al final) |
| `dame click.bat` (lanzador) | GET `https://sebasmd.com/.../version.json` | Lee `version.json` de la carpeta de red |
| `actualizar.bat` | Descarga el zip por HTTPS | Copia el zip desde la carpeta de red, verifica SHA-256 y aplica |
| Dominio personal | Origen único | **Se deja de usar** (solo para el puente, §4) |

Por qué es **Major**: cambia el canal de distribución. Una copia 2.x nunca encontraría
una 3.x por sí sola si no se hace el puente del §4.

## 2. Diseño

### 2.1 Una sola constante de origen

En `lanzador.ps1` y `actualizar.ps1`:

```powershell
$RELEASE_DIR = '\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release'
```

- Se puede cambiar sin editar el código para probar: parámetro `/origen:<ruta>` en ambos
  `.bat` y `-Destino <ruta>` en el empaquetador.
- La ruta tiene espacios (`Movil Exito`): usar siempre `-LiteralPath` y comillas.

### 2.2 Leer `version.json` sin colgar el lanzador

Un recurso de red inaccesible (fuera de la VPN, NAS caído) puede bloquear
`Test-Path`/`Get-Content` 20-60 s por el tiempo de espera de SMB. El lanzador **no debe
esperar eso**:

- la lectura corre en un *runspace* aparte (`[powershell]::Create()` + `BeginInvoke`)
  con un tope de **6 s** (lanzador) / **20 s** (actualizador);
- si se agota o falla: la misma nota de hoy («No se pudo consultar si hay versión
  nueva…») y se sigue con la copia local;
- se reemplaza `Obtener-JsonUtf8` (HTTP) por `Leer-JsonUtf8` (bytes del archivo): se
  conserva la decodificación UTF-8 estricta, el `TrimStart` del BOM y la normalización NFC.

### 2.3 Actualizar

1. Leer `version.json` de la carpeta (como §2.2).
2. `zip` es un **nombre de archivo**, relativo a la carpeta. Se rechaza cualquier valor con
   `\`, `/`, `..` o `:` (que no pueda apuntar fuera de la carpeta).
3. Copiar el zip a `%TEMP%` (no se extrae directo desde la red: el antivirus y los cortes
   de red hacen eso frágil).
4. Verificar SHA-256 contra `version.json` → **obligatorio** en 3.x (si falta, no se aplica).
5. Extraer, `robocopy` y reescribir `scripts\VERSION` como hoy (sin cambios).

### 2.4 Empaquetar y publicar

1. Genera el zip y `version.json` en `release\` como hoy (queda copia local).
2. Si la carpeta de red es accesible:
   1. copia `me-operacion-X.Y.Z.zip`;
   2. vuelve a calcular el SHA-256 **del zip ya copiado** y lo compara;
   3. escribe `version.json.tmp` y lo renombra a `version.json` (**siempre al final**): un
      analista nunca ve un `version.json` que apunte a un zip que aún no está.
3. Si no es accesible: deja todo en `release\` y lo dice (no falla la generación).
4. Nunca sobrescribe un zip de la misma versión ya publicado (regla «no reutilizar un
   número»); con `-Forzar` sí.
5. Opcional: `-Conservar N` borra los zip más viejos de la carpeta y deja los últimos N.

### 2.5 Permisos de la carpeta (a gestionar con TI)

| Quién | Permiso |
|---|---|
| Analistas | **Solo lectura** |
| Quien publica | Lectura y escritura |

Esto es la mejora de seguridad principal frente al dominio personal: publicar queda
limitado por el ACL de la compañía. El hash sigue viviendo junto al zip, así que protege
contra corrupción, no contra alguien con permiso de escritura.

## 3. Documentación a actualizar

- `doc/lanzador/README.md`: endpoints (§4), flujo (§7), riesgos (§9: sale «dominio
  personal», entra «acceso a la carpeta de red / VPN»), historial 3.0.0.
- `doc/GETTINGSTARTED.md`: requisito de acceso a la carpeta y «Empaquetar una release».
- `doc/README.md` (Versionado) y `CODEX.md` (§4 conexiones y §5 releases).

## 4. Migración (puente desde 2.x)

Las copias instaladas (≤ 2.9.0) solo miran sebasmd.com. Para llevarlas a la carpeta:

1. Empaquetar **3.0.0** → queda en la carpeta de red.
2. Publicar **ese mismo** zip + `version.json` **una última vez** en sebasmd.com.
3. Cada analista corre `actualizar.bat` (versión 2.x): baja la 3.0.0 de sebasmd.com.
   Desde ahí su lanzador y actualizador ya leen la carpeta de red.
4. Cuando todos estén en 3.0.0, dejar en sebasmd.com un `version.json` fijo en 3.0.0
   (no se vuelve a publicar ahí).

Alternativa sin puente: copiar la carpeta 3.0.0 a mano en cada equipo.

## 5. Pruebas

| Caso | Esperado |
|---|---|
| Carpeta accesible, misma versión | «Ya estás al día (local X, publicada X)» |
| Carpeta accesible, versión nueva | Aviso en el lanzador; `actualizar.bat` instala |
| Fuera de VPN / carpeta inaccesible | Lanzador sigue en ≤ 6 s con la nota; actualizador falla claro |
| `version.json` con BOM o tildes en `notas` | Se lee bien |
| Zip alterado en la carpeta | Hash no coincide, no se aplica nada |
| `zip` con `..\` en `version.json` | Rechazado |
| Publicar sin permiso de escritura | Queda en `release\` y lo explica |
| Puente 2.9.0 → 3.0.0 por sebasmd.com | Instala y la siguiente consulta ya va a la carpeta |

## 6. Decisiones (2026-09-30)

1. **Puente por sebasmd.com**: la 3.0.0 se publica en la carpeta y en el dominio
   (`-Puente` lo recuerda), porque los analistas siguen consumiendo el dominio.
2. **Fuente única**: la carpeta de red. Sin respaldo en sebasmd.com.
3. **Sin control de permisos**: la carpeta es pública en la red; basta la VPN para
   leer y escribir. Queda como riesgo documentado (§2.5 no aplica hoy).
4. `-Conservar` **no se implementó**: los zip viejos se quedan hasta que alguien los borre.

## 6b. Pruebas hechas (copia del proyecto en `%TEMP%`, carpeta local como origen)

| Caso | Resultado |
|---|---|
| Empaquetar 3.0.0 con `-Destino` y `-Puente` | zip + hash de la copia + `version.json` al final; notas con tildes escapadas `\uXXXX` |
| Actualizar un cliente 2.9.0 con `/origen:` | Copia, hash verificado, robocopy, `scripts\VERSION` = 3.0.0 |
| Volver a publicar una versión existente | Se detiene antes de tocar `scripts\VERSION` |
| Zip alterado | «NO coincide»; muestra esperado y obtenido; no aplica |
| `zip` = `..\otra\x.zip` | Rechazado; no aplica |
| Ruta de red inaccesible | Falla a los ~7 s con «no respondio en 6 s» |
| Archivo inexistente | Error claro de lectura |

Falta probar contra la carpeta real desde un equipo con VPN (§7).

## 7. Verificación previa

Desde la sesión donde se armó este plan la ruta **no fue accesible** (`Test-Path` =
`False`, incluso `\\296nas01\TodosNal1`). Antes de implementar, confirmar desde un equipo
de analista con VPN:

```powershell
Test-Path -LiteralPath '\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release'
```

y que la carpeta exista (el empaquetador no debería crearla: si no está, es más probable
una ruta mal escrita que una carpeta nueva).
