<#
    actualizar.ps1
    -----------------------------------------------------------------------
    Instala la version nueva que "dame click.bat" (raiz del proyecto)
    avisa cuando la encuentra. Es un paso APARTE y siempre A MANO: antes
    esto lo hacia dame click.bat el solo, en silencio, cada vez que se
    abria - descargaba el .zip, sobreescribia la carpeta encima y se
    relanzaba sin preguntar nada. Varios antivirus bloquean justo ese
    patron (codigo que se reemplaza a si mismo y se re-ejecuta sin
    intervencion humana, el mismo comportamiento que un dropper de
    malware), asi que se separo:

      - dame click.bat (via scripts\lanzador.ps1) SOLO avisa: "hay
        version nueva, corre actualizar.bat" -nunca descarga ni aplica
        nada-.
      - este script es el que de verdad descarga y aplica, y solo corre
        porque el analista lo lanzo el mismo, a proposito (desde
        "actualizar.bat" en la raiz del proyecto).

    Ademas verifica el SHA-256 del .zip contra el que trae version.json
    ANTES de aplicarlo: si no coincide, no se toca nada. (Los releases
    generados con scripts\empaquetar-release.ps1 desde esta version en
    adelante ya incluyen ese hash; uno mas viejo simplemente avisa que no
    se pudo verificar, en vez de bloquear la actualizacion.)

    Uso:
        actualizar.bat
        actualizar.bat /debug         -> muestra el detalle tecnico si algo falla
        actualizar.bat /sinconfirmar  -> no pregunta "instalar? [S/n]" (para
                                          correrlo desde otro script propio)
#>
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$argumentos   = $args -join ' '
$debug        = $argumentos -match '/debug'
$sinConfirmar = $argumentos -match '/sinconfirmar'

# $PSScriptRoot es la carpeta de ESTE script (scripts\); la raiz del
# proyecto (donde se aplica la actualizacion con robocopy) es su carpeta
# padre.
$scriptsDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptsDir)) { $scriptsDir = (Get-Location).Path }
$carpeta = Split-Path -Parent $scriptsDir

function Ok($t)    { Write-Host ("  OK        {0}" -f $t) -ForegroundColor Green }
function Nota($t)  { Write-Host ("            {0}" -f $t) -ForegroundColor DarkGray }
function Aviso($t) { Write-Host ("  ATENCION  {0}" -f $t) -ForegroundColor Yellow }

Write-Host ''
Write-Host '  Actualizar me-operacion' -ForegroundColor Yellow
Write-Host '  ------------------------'
Write-Host ''

# Version X.Y.Z. Las versiones historicas de uno o dos componentes se rellenan
# con ceros para que 2.2 y 2.2.0 sean equivalentes.
function VerDe($valor) {
  $s = [string]$valor
  if ([string]::IsNullOrWhiteSpace($s)) { return [version]'0.0.0' }
  $partes = @($s.Trim().Split('.'))
  if ($partes.Count -gt 3) { return [version]'0.0.0' }
  while ($partes.Count -lt 3) { $partes += '0' }
  try { return [version]("{0}.{1}.{2}" -f $partes[0], $partes[1], $partes[2]) } catch { return [version]'0.0.0' }
}

# Lee el JSON desde sus bytes y fuerza UTF-8. Windows PowerShell 5.1 puede
# decodificar Invoke-RestMethod con la pagina de codigos del equipo cuando el
# servidor no informa (o un proxy altera) el charset; ahi los caracteres con
# tilde y la ene terminan con mojibake aunque el archivo publicado sea UTF-8.
function Obtener-JsonUtf8($uri, $timeoutSec) {
  $request = [Net.HttpWebRequest]::Create($uri)
  $request.Method = 'GET'
  $request.Timeout = $timeoutSec * 1000
  $request.ReadWriteTimeout = $timeoutSec * 1000
  $request.UserAgent = 'me-operacion-actualizador'

  $response = $null
  $stream = $null
  $memoria = New-Object IO.MemoryStream
  try {
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $stream.CopyTo($memoria)

    # throwOnInvalidBytes=$true: no se reemplazan bytes invalidos en silencio.
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $texto = $utf8.GetString($memoria.ToArray())
    $texto = $texto.TrimStart([char]0xFEFF)
    $texto = $texto.Normalize([Text.NormalizationForm]::FormC)
    return $texto | ConvertFrom-Json -ErrorAction Stop
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($response) { $response.Dispose() }
    $memoria.Dispose()
  }
}

$UPDATE_BASE   = 'https://sebasmd.com/me/operacion'
$VERSION_URL   = "$UPDATE_BASE/version.json"
# VERSION vive junto a los scripts (scripts\VERSION), no en la raiz del
# proyecto.
$VERSION_LOCAL = Join-Path $scriptsDir 'VERSION'

try {
  $verLocal = [version]'0.0.0'
  if (Test-Path $VERSION_LOCAL) {
    $txt = (Get-Content $VERSION_LOCAL -Raw -ErrorAction Stop).Trim()
    if ($txt) { $verLocal = VerDe $txt }
  }

  Write-Host '  Consultando version disponible...' -ForegroundColor Gray
  $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $info = Obtener-JsonUtf8 "$VERSION_URL`?t=$cacheBust" 15
  $verRemota = VerDe $info.version

  if ($verRemota -le $verLocal) {
    # Se muestran las DOS versiones (no solo la local): sin esto, si algo
    # sale mal en la comparacion no hay forma de saber, desde la pantalla,
    # que fue lo que en verdad se leyo de version.json.
    Ok ("Ya estas al dia (local {0}, publicada {1})." -f $verLocal, $verRemota)
    Write-Host ''
    Read-Host '  Enter para cerrar'
    exit 0
  }

  Write-Host ''
  Write-Host ("  Version local : {0}" -f $verLocal)
  Write-Host ("  Version nueva : {0}" -f $verRemota)
  if ($info.notas) { Write-Host ("  Novedades     : {0}" -f $info.notas) }
  Write-Host ''

  if (-not $sinConfirmar) {
    $resp = Read-Host '  Instalar esta version ahora? [S/n]'
    if ($resp -and ($resp.Trim().ToLower() -notin @('s', 'si', 'sí', 'y', 'yes'))) {
      Nota 'Cancelado. No se cambio nada.'
      Write-Host ''
      Read-Host '  Enter para cerrar'
      exit 0
    }
  }

  $zipUrl = [string]$info.zip
  if ($zipUrl -notmatch '^https?://') { $zipUrl = "$UPDATE_BASE/$zipUrl" }

  $zipTmp = Join-Path $env:TEMP ("me-operacion-{0}.zip" -f $verRemota)
  $exTmp  = Join-Path $env:TEMP ("me-operacion-{0}-extract" -f $verRemota)
  if (Test-Path $exTmp) { Remove-Item $exTmp -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $zipTmp) { Remove-Item $zipTmp -Force -ErrorAction SilentlyContinue }

  Write-Host '  Descargando...' -ForegroundColor Gray
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipTmp -TimeoutSec 120 -UseBasicParsing

  # Verificacion de integridad: si version.json trae sha256, el .zip
  # descargado tiene que coincidir EXACTO o no se aplica nada. HTTPS ya
  # protege el transporte, pero esto ademas cubre que el archivo publicado
  # en sebasmd.com sea justo el que se genero con empaquetar-release.ps1
  # (y no uno corrupto o distinto). La herramienta no adivina: si no
  # coincide, se detiene y avisa, no intenta "arreglarlo solo".
  if ($info.sha256) {
    Write-Host '  Verificando integridad (SHA-256)...' -ForegroundColor Gray
    $hashReal = (Get-FileHash -Path $zipTmp -Algorithm SHA256).Hash
    if ($hashReal.ToLower() -ne ([string]$info.sha256).ToLower()) {
      Remove-Item $zipTmp -Force -ErrorAction SilentlyContinue
      throw ("El .zip descargado NO coincide con el hash publicado en version.json.`n" +
             "         Esperado: {0}`n         Obtenido: {1}`n" +
             "         No se aplico nada. Vuelve a intentarlo mas tarde." -f $info.sha256, $hashReal)
    }
    Ok 'Hash verificado: el archivo descargado es el que se publico.'
  } else {
    Aviso 'version.json no trae sha256 (release anterior a esta funcion): no se pudo verificar integridad.'
  }

  Write-Host '  Descomprimiendo...' -ForegroundColor Gray
  Expand-Archive -Path $zipTmp -DestinationPath $exTmp -Force

  # Si el .zip trae todo adentro de una sola subcarpeta (tipico de
  # "Comprimir carpeta" en vez de "Comprimir el contenido"), se usa esa
  # subcarpeta como raiz real de los archivos.
  $raizExtraida = $exTmp
  $itemsExtraidos = Get-ChildItem $exTmp
  if ($itemsExtraidos.Count -eq 1 -and $itemsExtraidos[0].PSIsContainer) {
    $raizExtraida = $itemsExtraidos[0].FullName
  }
  if (-not (Test-Path (Join-Path $raizExtraida 'index.html'))) {
    throw "El .zip descargado no tiene index.html en la raiz esperada: revisa como se empaqueto."
  }

  # /E copia todo (incluidas subcarpetas vacias) y SOBRESCRIBE; no borra
  # archivos que existan en destino y ya no vengan en el .zip (a proposito:
  # mas seguro que /MIR para no arriesgar borrar algo fuera de lugar por un
  # error de rutas). $carpeta es la RAIZ del proyecto (no scripts\), asi
  # que index.html, herramientas\, assets\, doc\ y scripts\ (con el
  # lanzador, este mismo script y VERSION) quedan cada uno en su sitio.
  Write-Host '  Aplicando (robocopy)...' -ForegroundColor Gray
  # Antes se descartaba toda la salida de robocopy ("| Out-Null"): si algo
  # fallaba, el unico dato que quedaba era el codigo de salida, sin el
  # detalle que robocopy SI imprime (que carpeta/archivo exacto no pudo
  # tocar y por que). Se captura para poder mostrarla si hay error, en vez
  # de adivinar.
  $salidaRobocopy = robocopy $raizExtraida $carpeta /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
  if ($LASTEXITCODE -ge 8) {
    Write-Host ''
    Write-Host '  --- salida de robocopy ---' -ForegroundColor DarkGray
    $salidaRobocopy | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host ''
    # Codigos de bits: 8 = fallaron copias, 16 = error grave (no copio
    # nada). El detalle exacto sale en la salida de arriba; esto solo
    # apunta a las causas mas comunes para no tener que buscarlo aparte.
    $pista = if ($LASTEXITCODE -ge 16) {
      "Codigo $LASTEXITCODE = error grave: robocopy no copio nada. Las causas mas comunes son falta de permisos de escritura en `"$carpeta`", o el antivirus/EDR del equipo bloqueando o eliminando los archivos recien extraidos en la carpeta temporal antes de que robocopy los pudiera leer."
    } else {
      "Codigo $LASTEXITCODE = algunos archivos no se pudieron copiar (revisa la salida de arriba: casi siempre es un archivo abierto en otro programa, o permisos)."
    }
    throw "robocopy fallo copiando la actualizacion. $pista"
  }

  # version.json es la fuente de verdad de la actualizacion que se acaba de
  # validar. El ZIP puede traer un VERSION anterior (por ejemplo, al probar
  # 2.1 reutilizando el paquete 1.11); robocopy lo copia y antes dejaba al
  # equipo nuevamente en 1.11. Se fija la version publicada despues de copiar.
  $versionInstaladaPath = Join-Path $carpeta 'scripts\VERSION'
  [IO.File]::WriteAllText(
    $versionInstaladaPath,
    $verRemota.ToString(),
    (New-Object Text.UTF8Encoding($false))
  )

  # Migracion: si se venia de una version con lanzador.ps1/actualizar.ps1/
  # VERSION sueltos en la raiz (antes de moverlos a scripts\), robocopy sin
  # /MIR los deja huerfanos ahi -no rompen nada, pero ensucian la raiz-.
  # Se limpian de una vez, aqui mismo, en vez de esperar a la siguiente
  # apertura de dame click.bat.
  $legado = @('lanzador.ps1', 'actualizar.ps1', 'VERSION', 'empaquetar-release.ps1', 'empaquetar-release.bat') |
      ForEach-Object { Join-Path $carpeta $_ } | Where-Object { Test-Path $_ }
  if ($legado) {
      Remove-Item $legado -Force -ErrorAction SilentlyContinue
      Nota ("Se limpiaron restos de una version anterior en la raiz: {0}" -f (($legado | Split-Path -Leaf) -join ', '))
  }

  Remove-Item $zipTmp -Force -ErrorAction SilentlyContinue
  Remove-Item $exTmp -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host ''
  Ok ("Actualizado a la version {0}." -f $verRemota)
  Nota "Corre 'dame click.bat' cuando quieras abrir las herramientas."
  Write-Host ''
  Read-Host '  Enter para cerrar'
}
catch {
  Write-Host ''
  Write-Host ('  ERROR  ' + $_.Exception.Message) -ForegroundColor Red
  if ($debug) {
    Write-Host ''
    Write-Host '  --- detalle tecnico (/debug) ---' -ForegroundColor DarkGray
    Write-Host ($_ | Out-String) -ForegroundColor DarkGray
    Write-Host ($_.ScriptStackTrace) -ForegroundColor DarkGray
  } else {
    Write-Host '  (vuelve a ejecutarlo con  actualizar.bat /debug  para ver el detalle)' -ForegroundColor DarkGray
  }
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}
