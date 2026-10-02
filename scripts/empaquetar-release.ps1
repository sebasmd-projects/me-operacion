<#
    empaquetar-release.ps1
    -----------------------------------------------------------------------
    Arma el paquete de una release y lo PUBLICA en la carpeta de red de la
    compania (desde la 3.0.0), de donde "dame click.bat" lee la version y
    "actualizar.bat" copia el .zip:
        \\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release
    No usa git, GitHub ni Python: solo PowerShell nativo (Compress-Archive).

    Vive en scripts\ junto a lanzador.ps1 y actualizar.ps1 -las tres cosas
    que SI viajan en el paquete-, pero este script NUNCA se incluye a si
    mismo: es una herramienta de quien mantiene el proyecto, no algo que
    necesite un analista.

    La version usa Major.Minor.Patch: por ejemplo 2.2.0. Major identifica
    cambios incompatibles o grandes, Minor funcionalidades compatibles y
    Patch correcciones o documentacion. dame click.bat compara con [version],
    que ordena correctamente 2.2.9 < 2.2.10 < 2.3.0.

    Uso normal: recomienda Patch +1 y permite elegir Minor, Major o escribir
    una version puntual, corrido desde dentro de scripts\:
        .\empaquetar-release.ps1

    O desde la raiz del proyecto, con el .bat que hace de wrapper:
        scripts\empaquetar-release.bat

    Fijar una version puntual:
        scripts\empaquetar-release.bat -Version 3.0.0

    Incremento no interactivo por tipo:
        scripts\empaquetar-release.bat -Incremento Fix
        scripts\empaquetar-release.bat -Incremento Minor
        scripts\empaquetar-release.bat -Incremento Major

    Con notas de que trae la version (opcional, solo informativo):
        scripts\empaquetar-release.bat -Notas "Corrige duracion en ms del historico de consumos"

    Firmando lanzador.ps1 y actualizar.ps1 con Authenticode (opcional; ver
    "Firma" mas abajo). Con un certificado ya instalado en el almacen del
    usuario:
        scripts\empaquetar-release.bat -CertThumbprint 0123456789ABCDEF0123456789ABCDEF01234567
    O con un archivo .pfx suelto:
        scripts\empaquetar-release.bat -CertPfx C:\ruta\certificado.pfx

    SIN ACCESO A LA CARPETA DE RED (sin VPN, NAS caido) el script NO se
    detiene: avisa, genera la version igual en .\release\ y al final dice
    que dos archivos copiar y en que orden cuando vuelva el acceso.

    Que genera, dentro de .\release\ (en la raiz del proyecto) y copia a
    la carpeta de red (-Destino):
        me-operacion-<version>.zip
        version.json                 (reemplaza el que ya este ahi;
                                      incluye el sha256 del .zip)
    Orden de la publicacion: primero el .zip (y se verifica el hash de la
    copia), version.json AL FINAL. Asi nadie ve una version cuyo .zip
    todavia no esta completo.

    Otras opciones:
        -SinPublicar   solo genera en release\ (no toca la carpeta de red)
        -TimeoutRed N  segundos de espera para la carpeta de red (8 por
                       defecto). Sin VPN la comprobacion no revienta ni se
                       cuelga: avisa, genera en release\ y dice que copiar.
        -Forzar        reemplaza un .zip de la misma version ya publicado
        -Puente        recuerda subir tambien a https://sebasmd.com/me/operacion/
                       (solo para la 3.0.0: las copias 2.x solo miran ahi)
        -Destino "<carpeta>"  publica en otra carpeta (pruebas)

    Estructura del .zip generado (coincide con la del proyecto):
        index.html, assets\, herramientas\, doc\, dame click.bat, actualizar.bat
        scripts\lanzador.ps1, scripts\actualizar.ps1, scripts\VERSION

    Firma (Authenticode): los .bat (dame click.bat, actualizar.bat) NO se
    pueden firmar de ninguna forma -Windows no reconoce firma en archivos
    batch-, por eso la logica pesada vive en lanzador.ps1 y actualizar.ps1:
    son los que de verdad hacen llamadas de red y tocan archivos, y son
    los que SI se pueden firmar. Sin -CertThumbprint ni -CertPfx, este
    paso simplemente se omite -igual que la auto-actualizacion, nunca
    bloquea el empaquetado por no tener algo configurado.

    Integridad: el .zip generado se hashea con SHA-256 y ese hash queda
    en version.json. actualizar.ps1 lo compara antes de aplicar una
    descarga: si no coincide, no instala nada.

    El VERSION de scripts\ (de esta misma carpeta de trabajo) tambien
    queda en el numero nuevo: asi el equipo del analista que use
    directamente esta carpeta (sin pasar por una descarga) tambien queda
    al dia.

    Nota para pruebas: si solo quieres ver que dame click.bat SI detecta y
    aplica una actualizacion sin preparar contenido nuevo de verdad, sube
    a cPanel un version.json con un numero mayor apuntando al MISMO .zip
    que ya esta ahi. Aunque ese .zip traiga un scripts\VERSION viejo, el
    actualizador registra al final la version publicada en version.json.
#>
[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('Fix', 'Minor', 'Major')]
    [string]$Incremento,
    [string]$Notas = "",
    [string]$Salida = "release",
    # Firma Authenticode de lanzador.ps1 y actualizar.ps1 (opcional).
    # -CertThumbprint busca en Cert:\CurrentUser\My y Cert:\LocalMachine\My;
    # -CertPfx firma con un archivo .pfx suelto (pide la contrasena si no
    # se pasa -CertPfxPassword). Sin ninguno de los dos, no se firma nada.
    [string]$CertThumbprint,
    [string]$CertPfx,
    [SecureString]$CertPfxPassword,
    [string]$TimestampServer = "http://timestamp.digicert.com",
    # Publicacion en la carpeta de red (desde la 3.0.0).
    [string]$Destino = '\\296nas01\TodosNal1\Especiales\Documentacion\Movil Exito\me-operacion-release',
    [switch]$SinPublicar,
    [switch]$Forzar,
    [switch]$Puente,
    # Tope de espera para hablar con la carpeta de red. Fuera de la VPN,
    # SMB puede bloquear 20-60 s CADA acceso a la ruta; no hay que quedarse
    # esperando eso para algo que al final se genera local igual.
    [ValidateRange(1, 3600)]
    [int]$TimeoutRed = 8
)

$ErrorActionPreference = 'Stop'

# Los errores detienen el empaquetado, pero permiten leer/copiar el detalle.
# La seleccion y copia con el raton las administra la consola de Windows.
trap {
    Write-Host ""
    Write-Host ("ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($_.InvocationInfo.PositionMessage) {
        Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "Para copiar: selecciona el error y usa Ctrl+C."
    Write-Host "El clic derecho depende de la configuracion de tu consola."

    $modoAnterior = $null
    try {
        $modoAnterior = [Console]::TreatControlCAsInput
        [Console]::TreatControlCAsInput = $true
        Write-Host "Presiona cualquier tecla para cerrar" -NoNewline
        do {
            $tecla = [Console]::ReadKey($true)
            $esCopia = (
                ($tecla.Modifiers -band [ConsoleModifiers]::Control) -ne 0 -and
                $tecla.Key -eq [ConsoleKey]::C
            )
        } while ($esCopia)
        Write-Host ""
    } catch {
        # Hosts sin ReadKey (por ejemplo ISE): alternativa con Enter.
        Write-Host ""
        [void](Read-Host 'Presiona Enter para cerrar')
    } finally {
        if ($null -ne $modoAnterior) {
            [Console]::TreatControlCAsInput = $modoAnterior
        }
    }
    # Propaga el error tras la pausa; no continua con la publicacion.
    break
}


# $PSScriptRoot es scripts\ (donde vive este archivo, junto a lanzador.ps1
# y actualizar.ps1); la raiz del proyecto (index.html, assets\, etc.) es
# su carpeta padre.
$scriptsDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptsDir)) { $scriptsDir = (Get-Location).Path }
$raiz = Split-Path -Parent $scriptsDir

# Version canonica X.Y.Z. Por compatibilidad, "2" y "2.2" se normalizan a
# "2.0.0" y "2.2.0". No se aceptan etiquetas ni un cuarto componente.
function VerDe($valor) {
    $s = ([string]$valor).Trim()
    if ([string]::IsNullOrWhiteSpace($s) -or $s -notmatch '^\d+(\.\d+){0,2}$') {
        throw "La version '$valor' no es valida. Usa X.Y.Z, por ejemplo 2.2.1 o 3.0.0."
    }
    $partes = @($s.Split('.'))
    while ($partes.Count -lt 3) { $partes += '0' }
    return [version]("{0}.{1}.{2}" -f $partes[0], $partes[1], $partes[2])
}

# ---------- 1. Version ----------
# VERSION vive junto a los scripts (scripts\VERSION), no en la raiz.
$versionLocalPath = Join-Path $scriptsDir 'VERSION'
$versionActual = [version]'0.0.0'
if (Test-Path $versionLocalPath) {
    $txt = (Get-Content $versionLocalPath -Raw -ErrorAction SilentlyContinue).Trim()
    if ($txt) { $versionActual = VerDe $txt }
}

$versionFix   = [version]::new($versionActual.Major, $versionActual.Minor, $versionActual.Build + 1)
$versionMinor = [version]::new($versionActual.Major, $versionActual.Minor + 1, 0)
$versionMajor = [version]::new($versionActual.Major + 1, 0, 0)

if ($Version -and $Incremento) {
    throw "Usa -Version o -Incremento, no los dos al mismo tiempo."
}

if ($Version) {
    # Uso automatizado o version indicada desde el .bat.
    $versionNueva = VerDe $Version
} elseif ($Incremento) {
    $versionNueva = switch ($Incremento) {
        'Fix'   { $versionFix }
        'Minor' { $versionMinor }
        'Major' { $versionMajor }
    }
} else {
    # Uso interactivo: Fix/documentacion es la recomendacion por defecto.
    Write-Host ""
    Write-Host "  Seleccionar version" -ForegroundColor Yellow
    Write-Host "  -------------------"
    Write-Host ("  Version actual             : {0}" -f $versionActual)
    Write-Host ("  F  Fix / documentacion     : {0} (recomendado)" -f $versionFix) -ForegroundColor Green
    Write-Host ("  I  Minor / funcionalidad   : {0}" -f $versionMinor)
    Write-Host ("  M  Major / cambio mayor    : {0}" -f $versionMajor)
    $eleccion = (Read-Host '  Tipo [F/I/M] o version X.Y.Z [F]').Trim()
    switch ($eleccion.ToUpperInvariant()) {
        ''      { $versionNueva = $versionFix }
        'F'     { $versionNueva = $versionFix }
        'FIX'   { $versionNueva = $versionFix }
        'I'     { $versionNueva = $versionMinor }
        'MINOR' { $versionNueva = $versionMinor }
        'M'     { $versionNueva = $versionMajor }
        'MAJOR' { $versionNueva = $versionMajor }
        default { $versionNueva = VerDe $eleccion }
    }
}
if ($versionNueva -le $versionActual) {
    throw "La version nueva ($versionNueva) debe ser mayor que la actual ($versionActual)."
}

# ---------- Acceso a la carpeta de red, sin bloquear ni reventar ----------
# `Test-Path` sobre una UNC inalcanzable no siempre devuelve $false: puede
# tardar un minuto en contestar y puede lanzar un error que, con
# $ErrorActionPreference='Stop', mata el script entero. Y matarlo aqui es
# justo lo que no queremos: el paquete se puede generar local perfectamente
# sin ver la carpeta de red.
#
# Mismo patron que `Leer-JsonUtf8` en lanzador.ps1 y actualizar.ps1: la
# comprobacion corre en un runspace aparte con tope de tiempo, y si no
# contesta se abandona (Stop/Dispose tambien se quedarian bloqueados).
#
# Devuelve 'si', 'no' o 'sinacceso' -los tres casos son distintos y el que
# llama decide: "no existe" no es lo mismo que "no pude preguntar"-.
function Probar-Ruta($ruta, $tipo, $timeoutSec) {
    $ps = $null
    $h = $null
    $agotado = $false
    try {
        $ps = [PowerShell]::Create()
        [void]$ps.AddScript('param($r, $t) Test-Path -LiteralPath $r -PathType $t -ErrorAction Stop').AddArgument($ruta).AddArgument($tipo)
        $h = $ps.BeginInvoke()
        if (-not $h.AsyncWaitHandle.WaitOne($timeoutSec * 1000)) {
            $agotado = $true
            Write-Host ("  Tiempo agotado ({0} s) consultando: {1}" -f $timeoutSec, $ruta) -ForegroundColor Yellow
            try { [void]$ps.BeginStop($null, $null) } catch { }
            return 'sinacceso'
        }

        # Un resultado false ES una respuesta valida: la ruta no existe.
        # Se comprueba la cantidad, nunca la veracidad de toda la coleccion.
        $res = @($ps.EndInvoke($h))
        if ($ps.Streams.Error.Count -gt 0) {
            Write-Host ("  Error al consultar '{0}': {1}" -f $ruta, $ps.Streams.Error[0]) -ForegroundColor Yellow
            return 'sinacceso'
        }
        if ($res.Count -ne 1 -or $null -eq $res[0]) {
            Write-Host ("  Respuesta inesperada al consultar: {0}" -f $ruta) -ForegroundColor Yellow
            return 'sinacceso'
        }
        $existe = [System.Management.Automation.LanguagePrimitives]::ConvertTo($res[0], [bool])
        if ($existe) { return 'si' }
        return 'no'
    } catch {
        Write-Host ("  Error al consultar '{0}': {1}" -f $ruta, $_.Exception.Message) -ForegroundColor Yellow
        return 'sinacceso'
    } finally {
        # Dispose puede bloquear si SMB sigue esperando tras el timeout.
        if ($null -ne $ps -and -not $agotado) { $ps.Dispose() }
    }
}

# ---------- 1b. Carpeta de red ----------
# Se revisa antes de generar: si no se puede consultar o el ZIP ya existe
# sin -Forzar, se deshabilita la publicacion y se genera la copia local.
$publicar = -not $SinPublicar
$motivoNoPublicado = ''
if ($publicar) {
    Write-Host ""
    Write-Host "  Comprobando la carpeta de releases..." -ForegroundColor Gray
    $acceso = Probar-Ruta $Destino 'Container' $TimeoutRed
    if ($acceso -ne 'si') {
        Write-Host ("  ATENCION  No se pudo acceder a {0}" -f $Destino) -ForegroundColor Yellow
        if ($acceso -eq 'sinacceso') {
            Write-Host ("            Consulta fallida o tiempo agotado (limite {0} s); revisa el detalle anterior." -f $TimeoutRed) -ForegroundColor Yellow
        } else {
            Write-Host "            La ruta no existe (ruta mal escrita?)." -ForegroundColor Yellow
        }
        Write-Host "            El paquete se genera igual en release\ y al final se dice que copiar." -ForegroundColor Yellow
        Write-Host "            Para saltarse esta comprobacion desde el principio: -SinPublicar" -ForegroundColor DarkGray
        $publicar = $false
        $motivoNoPublicado = "No se pudo acceder a la carpeta de red: $Destino"
    } else {
        # Si la consulta falla, solo se genera localmente; no se publica
        # sin saber si el ZIP ya existe.
        # version.json puede existir de una release anterior. Aqui se
        # comprueba el ZIP de la NUEVA version para evitar reemplazarlo.
        $zipAComprobar = Join-Path $Destino ("me-operacion-{0}.zip" -f $versionNueva)
        Write-Host ("  Comprobando ZIP de la nueva version: {0}" -f $zipAComprobar) -ForegroundColor Gray
        $yaEsta = Probar-Ruta $zipAComprobar 'Leaf' $TimeoutRed
        if ($yaEsta -eq 'sinacceso') {
            $publicar = $false
            $motivoNoPublicado = "No se pudo comprobar si el ZIP de la version $versionNueva ya esta publicado."
        } elseif ($yaEsta -eq 'si' -and -not $Forzar) {
            $publicar = $false
            $motivoNoPublicado = "El ZIP de la version $versionNueva ya existe en red. No se reemplaza sin -Forzar."
        }
        if (-not $publicar) {
            Write-Host ("  ATENCION  {0}" -f $motivoNoPublicado) -ForegroundColor Yellow
            Write-Host "  Se generara la release local; no se publicara en red." -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "  Empaquetando release" -ForegroundColor Yellow
Write-Host "  ---------------------"
Write-Host ("  Version actual : {0}" -f $versionActual)
Write-Host ("  Version nueva  : {0}" -f $versionNueva)
Write-Host ""

# ---------- 2. Que se incluye ----------
# Listas explicitas (no "todo lo que haya en la carpeta"): asi una carpeta
# suelta de pruebas, un release\ viejo, o este mismo script/empaquetar-release.bat
# nunca terminan adentro del paquete por accidente.
#
# $incluirRaiz  -> relativo a la RAIZ del proyecto
# $incluirScripts -> relativo a scripts\ (junto a este mismo archivo)
$incluirRaiz    = @('index.html', 'assets', 'herramientas', 'doc', 'dame click.bat', 'actualizar.bat')
$incluirScripts = @('lanzador.ps1', 'actualizar.ps1')

$faltantes = @()
$faltantes += $incluirRaiz | Where-Object { -not (Test-Path (Join-Path $raiz $_)) }
$faltantes += $incluirScripts |
    Where-Object { -not (Test-Path (Join-Path $scriptsDir $_)) } |
    ForEach-Object { "scripts\$_" }
if ($faltantes) {
    throw ("Falta(n) en la carpeta: {0}" -f ($faltantes -join ', '))
}

# ---------- 3. VERSION nuevo (se incluye en el .zip) ----------
Set-Content -Path $versionLocalPath -Value $versionNueva.ToString() -NoNewline
Write-Host ("  OK  scripts\VERSION actualizado a {0}" -f $versionNueva) -ForegroundColor Green

# ---------- 3b. Firma Authenticode (opcional) ----------
# Se firma ANTES de armar el paquete, para que el .ps1 firmado sea el que
# entra al .zip. Los .bat quedan sin firmar porque Windows no tiene un
# formato de firma para archivos batch; por eso lanzador.ps1/actualizar.ps1
# concentran la logica real (ver dame click.bat / actualizar.bat).
if ($CertThumbprint -or $CertPfx) {
    $cert = $null
    if ($CertThumbprint) {
        $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
            Where-Object { $_.Thumbprint -eq $CertThumbprint } | Select-Object -First 1
        if (-not $cert) { throw "No se encontro en el almacen de certificados un certificado con thumbprint $CertThumbprint." }
    } else {
        if (-not (Test-Path $CertPfx)) { throw "No se encontro el .pfx: $CertPfx" }
        $pass = $CertPfxPassword
        if (-not $pass) { $pass = Read-Host "Contrasena del .pfx ($CertPfx)" -AsSecureString }
        $cert = Get-PfxCertificate -FilePath $CertPfx -Password $pass -ErrorAction Stop
    }

    Write-Host ""
    Write-Host "  Firmando scripts (Authenticode)..." -ForegroundColor Gray
    foreach ($nombre in $incluirScripts) {
        $archivo = Join-Path $scriptsDir $nombre
        $r = Set-AuthenticodeSignature -FilePath $archivo -Certificate $cert -TimestampServer $TimestampServer -HashAlgorithm SHA256
        if ($r.Status -ne 'Valid') { throw ("No se pudo firmar {0}: {1}" -f $nombre, $r.StatusMessage) }
        Write-Host ("  OK  scripts\{0} firmado ({1})" -f $nombre, $cert.Subject) -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "  Nota: sin -CertThumbprint ni -CertPfx no se firma nada (los .bat de todas formas no se pueden firmar)." -ForegroundColor DarkGray
}

# ---------- 4. Carpeta de salida ----------
$salidaDir = Join-Path $raiz $Salida
if (-not (Test-Path $salidaDir)) { New-Item -ItemType Directory -Path $salidaDir | Out-Null }

$nombreZip = "me-operacion-{0}.zip" -f $versionNueva
$rutaZip = Join-Path $salidaDir $nombreZip
if (Test-Path $rutaZip) { Remove-Item $rutaZip -Force }

# ---------- 5. Armar el paquete en una carpeta temporal y comprimir ----------
# Compress-Archive, cuando recibe la ruta de un ARCHIVO suelto (no una
# carpeta), lo deja en la RAIZ del .zip: no hay forma de pedirle que
# "actualizar.ps1" quede dentro de una subcarpeta "scripts\" sin antes
# tenerlo de verdad en una carpeta que se llame asi. Por eso se arma una
# copia temporal con la estructura EXACTA que debe tener el paquete, y se
# comprime esa carpeta completa (mismo resultado que antes para los items
# que ya eran carpetas: assets\, herramientas\, doc\).
$staging = Join-Path $env:TEMP ("me-operacion-staging-{0}" -f $versionNueva)
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

foreach ($item in $incluirRaiz) {
    Copy-Item -Path (Join-Path $raiz $item) -Destination (Join-Path $staging $item) -Recurse
}
$stagingScripts = Join-Path $staging 'scripts'
New-Item -ItemType Directory -Path $stagingScripts | Out-Null
foreach ($item in $incluirScripts) {
    Copy-Item -Path (Join-Path $scriptsDir $item) -Destination (Join-Path $stagingScripts $item)
}
Copy-Item -Path $versionLocalPath -Destination (Join-Path $stagingScripts 'VERSION')

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $rutaZip -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force
Write-Host ("  OK  {0} generado ({1:N1} KB)" -f $nombreZip, ((Get-Item $rutaZip).Length / 1KB)) -ForegroundColor Green

# ---------- 6. version.json ----------
# El sha256 es lo que actualizar.ps1 compara antes de aplicar una
# descarga: si el .zip que llega a un equipo no coincide exacto con este
# hash, no se instala nada.
$hashZip = (Get-FileHash -Path $rutaZip -Algorithm SHA256).Hash
$Notas = $Notas.Normalize([Text.NormalizationForm]::FormC)
$versionJson = [ordered]@{
    version  = $versionNueva.ToString()
    zip      = $nombreZip
    sha256   = $hashZip
    generado = (Get-Date).ToString('s')
    notas    = $Notas
}
$rutaJson = Join-Path $salidaDir 'version.json'
# NO se usa "Set-Content -Encoding UTF8": en Windows PowerShell (5.1) esa
# opcion escribe SIEMPRE con BOM al inicio del archivo. Ese BOM viajaba
# hasta el version.json publicado, y hacia que Invoke-RestMethod (en el
# lanzador y en actualizar.ps1) no pudiera interpretar el JSON -devolvia
# un objeto vacio sin avisar de ningun error, y la version publicada se
# leia como "0.0"-. Escribiendo el archivo a mano con UTF8 SIN BOM se
# evita el problema desde el origen. Ademas, lanzador.ps1/actualizar.ps1
# decodifican los bytes explicitamente como UTF-8 y normalizan Unicode, para
# no depender de como el servidor o un proxy anuncie el charset.
$textoJson = $versionJson | ConvertTo-Json
# Mantiene el JSON en ASCII portable: cualquier caracter no ASCII queda como
# \uXXXX. Antes se normaliza a NFC para que una letra con tilde no se publique
# como dos puntos de codigo distintos. ConvertFrom-Json reconstruye el texto.
$textoJson = [regex]::Replace($textoJson, '[^\x00-\x7F]', {
    param($m)
    return '\u{0:x4}' -f [int][char]$m.Value
})
[IO.File]::WriteAllText($rutaJson, $textoJson, (New-Object Text.UTF8Encoding($false)))
Write-Host ("  OK  version.json generado (sha256 {0}...)" -f $hashZip.Substring(0, 12)) -ForegroundColor Green

# ---------- 7. Publicar en la carpeta de red ----------
# Primero el .zip, se verifica el hash de la COPIA y solo entonces
# version.json: un analista que abra dame click.bat en medio de la
# publicacion nunca ve una version cuyo .zip no esta completo.
if ($publicar) {
    try {
        $zipDestino  = Join-Path $Destino $nombreZip
        $jsonDestino = Join-Path $Destino 'version.json'
        Write-Host "  Publicando en la carpeta de red..." -ForegroundColor Gray
        Copy-Item -LiteralPath $rutaZip -Destination $zipDestino -Force
        $hashCopia = (Get-FileHash -LiteralPath $zipDestino -Algorithm SHA256).Hash
        if ($hashCopia -ne $hashZip) {
            Remove-Item -LiteralPath $zipDestino -Force -ErrorAction SilentlyContinue
            throw "El .zip copiado a la carpeta de red no coincide con el generado (copia incompleta). No se publico version.json: vuelve a intentarlo."
        }
        [IO.File]::Copy($rutaJson, $jsonDestino, $true)
        Write-Host ("  OK  Publicado en {0}" -f $Destino) -ForegroundColor Green
    } catch {
        $publicar = $false
        $motivoNoPublicado = "Fallo la publicacion en red: {0}" -f $_.Exception.Message
        Write-Host ""
        Write-Host ("  ATENCION  {0}" -f $motivoNoPublicado) -ForegroundColor Yellow
        Write-Host "  La release local ya fue generada y se conserva completa." -ForegroundColor Yellow
    }
}

# ---------- 8. Instrucciones ----------
Write-Host ""
if ($publicar) {
    Write-Host ("  Listo. Quien abra dame click.bat vera la version {0} y la instala con actualizar.bat." -f $versionNueva) -ForegroundColor Yellow
} elseif ($SinPublicar) {
    Write-Host "  Listo. Generado solo en release\ (-SinPublicar)." -ForegroundColor Yellow
} else {
    Write-Host ("  Motivo: {0}" -f $motivoNoPublicado) -ForegroundColor Yellow
    Write-Host ("  Listo. La version {0} quedo generada en release\, SIN publicacion confirmada:" -f $versionNueva) -ForegroundColor Yellow
    Write-Host ("    - {0}" -f $rutaZip)
    Write-Host ("    - {0}" -f $rutaJson)
    Write-Host ""
    Write-Host ("  Cuando tengas acceso, copia esos dos archivos a {0}" -f $Destino) -ForegroundColor Yellow
    Write-Host "  en este orden: primero el .zip, version.json SIEMPRE al final." -ForegroundColor Yellow
    Write-Host "  (Asi nadie ve una version cuyo .zip todavia no esta completo.)" -ForegroundColor DarkGray
}
if ($Puente) {
    Write-Host ""
    Write-Host "  PUENTE 2.x -> 3.x: sube tambien estos dos archivos a https://sebasmd.com/me/operacion/" -ForegroundColor Yellow
    Write-Host "  (las copias 2.x solo consultan ese dominio; al instalar esta version ya leen la carpeta de red):" -ForegroundColor Yellow
    Write-Host ("    - {0}" -f $rutaZip)
    Write-Host ("    - {0}" -f $rutaJson)
}
Write-Host ""
Write-Host "  version.json SIEMPRE se reemplaza (mismo nombre); el .zip queda" -ForegroundColor DarkGray
Write-Host "  con nombre nuevo cada vez, no hace falta borrar los anteriores." -ForegroundColor DarkGray
Write-Host ""

# Una falla de red es recuperable: los archivos locales ya estan listos.
# Se mantiene el aviso visible usando la misma pausa del trap general.
if (-not $SinPublicar -and -not $publicar) {
    throw ("La release {0} se genero localmente, pero no se confirmo la publicacion en red. Motivo: {1}{2}ZIP: {3}{2}JSON: {4}" -f $versionNueva, $motivoNoPublicado, [Environment]::NewLine, $rutaZip, $rutaJson)
}
