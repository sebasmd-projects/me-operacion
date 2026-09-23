<#
    empaquetar-release.ps1
    -----------------------------------------------------------------------
    Arma el paquete que hay que subir a https://sebasmd.com/me/operacion-qa/
    para que "dame click.bat" detecte la version nueva y se actualice solo
    en cada equipo. No usa git, GitHub ni Python: solo PowerShell nativo
    (Compress-Archive).

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

    ENTORNO: QA. Esta rama empaqueta la copia del laboratorio, y por eso
    el .zip lleva otro nombre y va a OTRA carpeta del servidor. Nunca se
    sube a la de produccion: un equipo de produccion que descargue este
    paquete queda apuntando al laboratorio sin que nadie lo note.

    Que genera, dentro de .\release\ (en la raiz del proyecto):
        me-operacion-qa-<version>.zip <- subir a sebasmd.com/me/operacion-qa/
        version.json                  <- subir a sebasmd.com/me/operacion-qa/
                                          (reemplaza el que ya este ahi;
                                          incluye el sha256 del .zip)

    OJO: .\release\ puede traer todavia los .zip y el version.json de
    produccion que vienen heredados de master. Sube SOLO los dos archivos
    que este script nombra al terminar.

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
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = 'Stop'

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

$nombreZip = "me-operacion-qa-{0}.zip" -f $versionNueva
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
$staging = Join-Path $env:TEMP ("me-operacion-qa-staging-{0}" -f $versionNueva)
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

# ---------- 7. Instrucciones ----------
Write-Host ""
Write-Host "  Listo. Sube estos dos archivos a https://sebasmd.com/me/operacion-qa/ :" -ForegroundColor Yellow
Write-Host "  (QA, NO la carpeta de produccion)" -ForegroundColor Red
Write-Host ("    - {0}" -f $rutaJson)
Write-Host ("    - {0}" -f $rutaZip)
Write-Host ""
Write-Host "  version.json SIEMPRE se reemplaza (mismo nombre); el .zip queda" -ForegroundColor DarkGray
Write-Host "  con nombre nuevo cada vez, no hace falta borrar los anteriores." -ForegroundColor DarkGray
Write-Host ""
