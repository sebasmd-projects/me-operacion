<#
    lanzador.ps1
    -----------------------------------------------------------------------
    Logica real de "dame click.bat" (raiz del proyecto). Vive en scripts\,
    aparte del .bat -no embebida dentro con un truco de Invoke-Expression
    sobre si mismo- porque ese patron ("el script se lee a si mismo y
    ejecuta el resultado") es una firma que vigilan varios antivirus,
    aunque el contenido sea inofensivo. Ademas, un .ps1 suelto SI se puede
    firmar con Authenticode (ver scripts\empaquetar-release.ps1
    -CertThumbprint / -CertPfx); un .bat no se puede firmar de ninguna
    forma.

    No se llama directo: "dame click.bat" (en la raiz) lo invoca con
    "powershell -ExecutionPolicy Bypass -File scripts\lanzador.ps1 %*".

    Uso (identico al de antes, via "dame click.bat" en la raiz):
      dame click.bat                -> abre UNA pestana: el reporte de lineas
                                    prepagadas, en una ventana maximizada
      dame click.bat /solo-reporte  -> igual que sin parametros (explicito)
      dame click.bat /solo-casos    -> solo el cierre masivo de casos
      dame click.bat /sinsesion     -> pide usuario/clave de Windows para SIME
                                    en vez de usar la sesion activa
      dame click.bat /reset         -> borra TODAS las credenciales guardadas
      dame click.bat /resetsime     -> borra solo las credenciales de SIME
      dame click.bat /resetcm       -> borra solo las credenciales del CM
      dame click.bat /debug         -> muestra el detalle tecnico de los errores
      dame click.bat /sinupdate     -> no avisa de actualizaciones esta vez

    Aviso de version nueva: SOLO consulta version.json y avisa si hay una
    version mas nueva -nunca la descarga ni la aplica sola-. Instalarla es
    un paso APARTE y a mano: actualizar.bat (en la raiz). Antes este mismo
    paso descargaba, sobreescribia la carpeta y se relanzaba sin preguntar;
    varios antivirus bloquean justo ese patron (codigo que se reemplaza a
    si mismo sin intervencion humana), asi que se separo en dos.

    Si SIME rechaza el login, el lanzador NO se cae: ofrece reintentar
    con otras credenciales, con la sesion de Windows, o saltar el reporte
    y abrir solo el cierre masivo (que solo necesita el CM).

    Las credenciales quedan en un ARCHIVO LOCAL cifrado con DPAPI
    (%APPDATA%\reporte_prepagadas\). No usa el Credential Manager.
    Todo se pide por CONSOLA: no abre ventanas de Windows.

    IMPORTANTE: la ventana de Edge que abre no tiene CORS.
    Usarla solo para estas herramientas, no para navegar.
#>
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ---------- Parametros del entorno ----------
#  ENTORNO: QA. Esta copia apunta al laboratorio, NO a produccion.
#
#  El CM de QA usa un usuario por defecto del laboratorio, igual para
#  todos: no se pide por consola, no se lee del archivo cifrado y no se
#  guarda nada. Asi no puede colarse una credencial de produccion a QA,
#  ni alguien probar en QA creyendo que va con su usuario real.
#
#  SIME es distinto a proposito: ahi el usuario sigue siendo el de
#  siempre (dominio\usuario de @grupo-exito.com), solo que contra el
#  SIME de QA, asi que se sigue pidiendo y guardando como antes.
$ENTORNO   = 'QA'
$SIME_WEB  = 'http://296vnextqa02/SIMEPRB/Web'
$KC_BASE   = 'http://keycloak.exito-lab-1.movil-exito.internal'
$KC_REALM  = 'optiva'
$KC_CLIENT = 'optiva'
$CM_USER   = 'optiva'
$CM_PASS   = 'optiva'

# $args (automatica de PowerShell) trae cada token que no coincidio con un
# parametro con nombre; como este script no declara ninguno, ahi caen los
# flags de siempre ("/reset", "/debug", ...) tal cual se escriben.
$argumentos = $args -join ' '
$resetSime  = $argumentos -match '/resetsime'
$resetCm    = $argumentos -match '/resetcm'
$reset      = ($argumentos -match '/reset') -and -not ($resetSime -or $resetCm)
$sinSesion  = $argumentos -match '/sinsesion'
$debug      = $argumentos -match '/debug'
$soloRep    = $argumentos -match '/solo-reporte'
$soloCasos  = $argumentos -match '/solo-casos'
$sinUpdate  = $argumentos -match '/sinupdate'

# Que se abre en esta ejecucion.
# Por defecto UNA sola pestana: el reporte de lineas prepagadas. El cierre
# masivo de casos ya no se abre solo; hay que pedirlo con /solo-casos.
# Si llegan los dos parametros a la vez, gana el reporte.
$abrirReporte = $soloRep -or -not $soloCasos
$abrirCasos   = $soloCasos -and -not $soloRep

# $PSScriptRoot es la carpeta de ESTE script (scripts\); la raiz del
# proyecto (donde viven index.html y herramientas\) es su carpeta padre.
$scriptsDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptsDir)) { $scriptsDir = (Get-Location).Path }
$carpeta = Split-Path -Parent $scriptsDir
$htmlReporte = Join-Path $carpeta 'herramientas\reporte_prepagadas.html'
$htmlCasos   = Join-Path $carpeta 'herramientas\reporte_casos_masivos.html'
# Carpetas propias de QA: si se usan las mismas que produccion, el token
# de SIME y el perfil de Edge de un entorno pisan los del otro cuando se
# abren los dos el mismo dia. $cfgCm ya no se usa (el CM es fijo) pero se
# deja definido porque /reset y /resetcm lo siguen limpiando.
$cfgDir = Join-Path $env:APPDATA 'reporte_prepagadas_qa'
$cfgCm  = Join-Path $cfgDir 'credenciales_cm.xml'
$cfgSm  = Join-Path $cfgDir 'credenciales_sime.xml'
$perfil = Join-Path $env:TEMP 'edge_reporte_prepagadas_qa'

function Paso($n, $t) { Write-Host ("  [{0}/6] {1}" -f $n, $t) -ForegroundColor Gray }
function Ok($t)       { Write-Host ("        OK  {0}" -f $t) -ForegroundColor Green }
function Nota($t)     { Write-Host ("        {0}" -f $t) -ForegroundColor DarkGray }
function Aviso($t)    { Write-Host ("        {0}" -f $t) -ForegroundColor Yellow }

Write-Host ''
Write-Host '  Herramientas SIME / CM  ***  QA  ***' -ForegroundColor Yellow
Write-Host '  --------------------------------------'
Nota ("PowerShell {0} | carpeta: {1}" -f $PSVersionTable.PSVersion, $carpeta)

# ---------------------------------------------------------------------
#  Migracion: limpiar restos de la version anterior (raiz plana).
#  Antes de este reordenamiento, lanzador.ps1/actualizar.ps1/VERSION
#  vivian sueltos en la raiz del proyecto. actualizar.ps1 aplica con
#  "robocopy /E" SIN "/MIR" a proposito (para no arriesgarse a borrar
#  algo fuera de lugar), asi que al actualizar desde una version anterior
#  a esta, esos archivos NO se borran solos: quedan huerfanos en la raiz
#  -no rompen nada, porque el "dame click.bat" nuevo ya apunta a
#  scripts\lanzador.ps1-, pero ensucian la carpeta. Se limpian solos la
#  primera vez que se detectan, aqui, en cada apertura normal.
$legado = @('lanzador.ps1', 'actualizar.ps1', 'VERSION', 'empaquetar-release.ps1', 'empaquetar-release.bat') |
    ForEach-Object { Join-Path $carpeta $_ } | Where-Object { Test-Path $_ }
if ($legado) {
    Remove-Item $legado -Force -ErrorAction SilentlyContinue
    Nota ("Se limpiaron restos de una version anterior en la raiz: {0}" -f (($legado | Split-Path -Leaf) -join ', '))
}
Write-Host ''

# ---------------------------------------------------------------------
#  Credenciales: prompt por CONSOLA y guardado cifrado con DPAPI.
#  Export-Clixml de un PSCredential cifra la clave con la cuenta de
#  Windows actual: el archivo no sirve en otro equipo ni con otro usuario.
# ---------------------------------------------------------------------
function Leer-Credencial($ruta, $titulo, $usuarioSugerido) {
  if (Test-Path $ruta) {
    try {
      $c = Import-Clixml $ruta
      Ok ("Credenciales de {0} leidas del archivo local ({1})" -f $titulo, $c.UserName)
      return $c
    } catch {
      Nota "El archivo de credenciales estaba corrupto: se vuelve a pedir."
      Remove-Item $ruta -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Host ''
  Write-Host ("  Credenciales de {0}" -f $titulo) -ForegroundColor Yellow
  $u = Read-Host ("  Usuario" + $(if ($usuarioSugerido) { " [$usuarioSugerido]" } else { "" }))
  if ([string]::IsNullOrWhiteSpace($u)) { $u = $usuarioSugerido }
  if ([string]::IsNullOrWhiteSpace($u)) { throw "No se ingreso usuario para $titulo." }
  $s = Read-Host '  Contrasena' -AsSecureString
  if (-not $s -or $s.Length -eq 0) { throw "No se ingreso contrasena para $titulo." }
  $c = New-Object System.Management.Automation.PSCredential($u, $s)
  if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
  $c | Export-Clixml $ruta
  Write-Host ''
  Ok ("Guardadas en {0}" -f $ruta)
  return $c
}

# Pide el token prf a SIME/Web. Con $cred usa ese usuario; sin $cred, la
# sesion de Windows actual. Lanza excepcion si SIME no responde o no manda prf.
function Obtener-Prf($cred) {
  $p = @{ Uri = $SIME_WEB; UseBasicParsing = $true; MaximumRedirection = 10; TimeoutSec = 45 }
  if ($cred) { $p['Credential'] = $cred } else { $p['UseDefaultCredentials'] = $true }
  $r = Invoke-WebRequest @p

  $urlFinal = ''
  if ($r.BaseResponse.ResponseUri) { $urlFinal = $r.BaseResponse.ResponseUri.AbsoluteUri }
  elseif ($r.BaseResponse.RequestMessage) { $urlFinal = $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
  $m = [regex]::Match($urlFinal, '[?&]prf=([^&#]+)')
  if (-not $m.Success) { $m = [regex]::Match([string]$r.Content, '[?&]prf=([A-Za-z0-9+/%=_\-]+)') }
  if (-not $m.Success) {
    throw ("SIME respondio (HTTP {0}) pero no venia el prf en el redirect. URL final: {1}" -f $r.StatusCode, $urlFinal)
  }
  return [uri]::UnescapeDataString($m.Groups[1].Value)
}

$credCm = $null; $credSime = $null; $prf = $null; $urls = @()

# =======================================================================
#  0. AVISO DE VERSION NUEVA (nunca se aplica sola)
#  Dominio propio (sebasmd.com), aprobado por la compañia y sin bloqueos
#  de proxy/VPN. Si algo falla aqui (sin internet en este momento, el
#  host no responde) NUNCA se bloquea el uso de la herramienta: se avisa
#  y se sigue con la copia local tal cual.
#
#  Este paso SOLO CONSULTA version.json: es una peticion GET de lectura,
#  nada mas. Si hay una version mas nueva, se avisa en pantalla y se dice
#  que corras "actualizar.bat" cuando quieras instalarla -nunca se
#  descarga ni se aplica desde aqui-. Aplicar una actualizacion es un
#  paso APARTE y siempre a mano (ver scripts\actualizar.ps1): un script
#  que se reemplaza a si mismo y se relanza sin preguntar es el mismo
#  patron de comportamiento que usan los droppers de malware, y varios
#  antivirus lo bloquean por eso -aunque el contenido sea inofensivo-.
#
#  Flags:
#    /sinupdate   -> no consulta si hay version nueva esta vez
# =======================================================================
# ENTORNO: QA. El aviso de version mira la carpeta de QA, no la de
# produccion: si no, avisaria de versiones que no son de esta copia.
$UPDATE_BASE   = 'https://sebasmd.com/me/operacion-qa'
$VERSION_URL   = "$UPDATE_BASE/version.json"
# VERSION vive junto a los scripts (scripts\VERSION), no en la raiz del
# proyecto: es un dato de version del propio mecanismo de actualizacion.
$VERSION_LOCAL = Join-Path $scriptsDir 'VERSION'

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

# Fuerza la decodificacion de los bytes como UTF-8 y normaliza los caracteres
# a NFC. Asi las tildes y la ene no dependen del charset que Windows
# PowerShell 5.1 (o un proxy) deduzca del encabezado HTTP.
function Obtener-JsonUtf8($uri, $timeoutSec) {
  $request = [Net.HttpWebRequest]::Create($uri)
  $request.Method = 'GET'
  $request.Timeout = $timeoutSec * 1000
  $request.ReadWriteTimeout = $timeoutSec * 1000
  $request.UserAgent = 'me-operacion-lanzador'

  $response = $null
  $stream = $null
  $memoria = New-Object IO.MemoryStream
  try {
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $stream.CopyTo($memoria)

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

Write-Host '  Buscando actualizaciones...' -ForegroundColor Gray
if ($sinUpdate) {
  Nota 'Omitido (/sinupdate).'
} else {
  try {
    $verLocal = [version]'0.0.0'
    if (Test-Path $VERSION_LOCAL) {
      $txtVerLocal = (Get-Content $VERSION_LOCAL -Raw -ErrorAction Stop).Trim()
      if ($txtVerLocal) { $verLocal = VerDe $txtVerLocal }
    }

    $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $info = Obtener-JsonUtf8 "$VERSION_URL`?t=$cacheBust" 6
    $verRemota = VerDe $info.version

    if ($verRemota -le $verLocal) {
      # Se muestran las DOS versiones (no solo la local): sin esto, si algo
      # sale mal en la comparacion no hay forma de saber, desde la
      # pantalla, que fue lo que en verdad se leyo de version.json.
      Ok ("Ya estas al dia (local {0}, publicada {1})." -f $verLocal, $verRemota)
    } else {
      Aviso ("Hay una version nueva: {0} -> {1}." -f $verLocal, $verRemota)
      if ($info.notas) { Nota ("Novedades: {0}" -f $info.notas) }
      Nota "Corre 'actualizar.bat' cuando quieras instalarla (no se aplica sola)."
    }
  } catch {
    Nota ("No se pudo consultar si hay version nueva: {0}" -f $_.Exception.Message)
  }
}
Write-Host ''

try {
  # ---------- 1. Archivos ----------
  Paso 1 'Verificando archivos...'
  if ($abrirReporte) {
    if (Test-Path $htmlReporte) { Ok 'reporte_prepagadas.html encontrado' }
    else {
      if (-not $abrirCasos) { throw ("No se encontro reporte_prepagadas.html en:`n         {0}`n         Deja scripts\lanzador.ps1 en la carpeta scripts\ dentro del proyecto (junto a 'herramientas')." -f $carpeta) }
      Nota 'No se encontro reporte_prepagadas.html: se abre solo el cierre masivo.'
      $abrirReporte = $false
    }
  }
  if ($abrirCasos) {
    if (Test-Path $htmlCasos) { Ok 'reporte_casos_masivos.html encontrado' }
    else {
      if (-not $abrirReporte) { throw ("No se encontro reporte_casos_masivos.html en:`n         {0}`n         Deja scripts\lanzador.ps1 en la carpeta scripts\ dentro del proyecto (junto a 'herramientas')." -f $carpeta) }
      Nota 'No se encontro reporte_casos_masivos.html: se abre solo el reporte.'
      $abrirCasos = $false
    }
  }
  if (-not $abrirReporte -and -not $abrirCasos) {
    throw ("No hay ningun HTML para abrir en:`n         {0}" -f $carpeta)
  }
  if ($reset -or $resetCm) {
    Remove-Item $cfgCm -Force -ErrorAction SilentlyContinue
    Ok 'Credenciales del CM borradas'
  }
  if ($reset -or $resetSime) {
    Remove-Item $cfgSm -Force -ErrorAction SilentlyContinue
    Ok 'Credenciales de SIME borradas'
  }

  # ---------- 2. Credenciales ----------
  Paso 2 'Credenciales (SIME: archivo local cifrado · CM: usuario fijo de QA)...'
  # El CM de QA no pasa por Leer-Credencial: ni se pide, ni se lee del
  # disco, ni se guarda. Si quedaba un archivo de una version anterior de
  # esta copia, se borra para que no siga ahi sin que nadie lo use.
  Remove-Item $cfgCm -Force -ErrorAction SilentlyContinue
  $credCm = New-Object System.Management.Automation.PSCredential(
    $CM_USER, (ConvertTo-SecureString $CM_PASS -AsPlainText -Force))
  Ok ("CM: usuario por defecto de {0} ({1}) - no se guarda en el equipo" -f $ENTORNO, $CM_USER)
  if ($abrirReporte) {
    if ($sinSesion -or (Test-Path $cfgSm)) {
      $credSime = Leer-Credencial $cfgSm 'SIME (Windows: dominio\usuario)' $env:USERNAME
    } else {
      Ok 'SIME usara la sesion de Windows actual (usa /sinsesion para escribir usuario y clave)'
    }
  }

  # ---------- 3. SIME: token prf ----------
  #  Un fallo aqui NO tumba el lanzador: el cierre masivo no usa SIME, asi que
  #  se ofrece reintentar, cambiar de credenciales o saltarse el reporte.
  if ($abrirReporte) {
    Paso 3 'SIME: pidiendo el token prf a SIME/Web...'
    $intentos = 0
    while ($abrirReporte -and -not $prf) {
      $intentos++
      try {
        $prf = Obtener-Prf $credSime
      } catch {
        $motivo = $_.Exception.Message
        Aviso ("SIME no acepto la peticion: {0}" -f $motivo)
        if ($credSime -and ($motivo -match '401|No autorizado|Unauthorized')) {
          Remove-Item $cfgSm -Force -ErrorAction SilentlyContinue
          Nota ("Se borraron las credenciales guardadas de SIME ({0}): no sirven." -f $credSime.UserName)
        }
        if ($intentos -ge 4) {
          if ($abrirCasos) {
            Aviso 'Demasiados intentos con SIME: se abre solo el cierre masivo.'
            $abrirReporte = $false
            break
          }
          throw ("SIME no respondio despues de varios intentos: {0}`n         Revisa la VPN / red interna." -f $motivo)
        }
        Write-Host ''
        Write-Host '  Que hacemos con el reporte de lineas?' -ForegroundColor Yellow
        Write-Host '    [1] Escribir usuario y clave de SIME (formato dominio\usuario)'
        Write-Host '    [2] Reintentar con la sesion de Windows actual'
        if ($abrirCasos) { Write-Host '    [3] Saltarlo y abrir solo el cierre masivo de casos' }
        $op = Read-Host '  Opcion'
        Write-Host ''
        if ($op -eq '3' -and $abrirCasos) {
          $abrirReporte = $false
        } elseif ($op -eq '2') {
          $credSime = $null
          Nota 'Reintentando con la sesion de Windows actual...'
        } else {
          $credSime = Leer-Credencial $cfgSm 'SIME (Windows: dominio\usuario)' $env:USERNAME
        }
      }
    }

    if ($prf) {
      $quien = ''
      try {
        $perfilSime = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($prf)) | ConvertFrom-Json
        $quien = [string]$perfilSime.Nombre
        if ($perfilSime.Departamento) { $quien = $quien + ' - ' + $perfilSime.Departamento }
      } catch { }
      if ($quien) { Ok ("Token prf obtenido para {0}" -f $quien) } else { Ok 'Token prf obtenido' }
    }
  } else {
    Paso 3 'SIME: no hace falta (el cierre masivo solo usa el CM)'
    Ok 'Paso omitido'
  }

  # ---------- 4. CM: login Keycloak ----------
  Paso 4 'CM: validando usuario y clave contra Keycloak...'
  $body = @{
    grant_type = 'password'; client_id = $KC_CLIENT; scope = 'openid'
    username   = $credCm.UserName
    password   = $credCm.GetNetworkCredential().Password
  }
  try {
    $tok = Invoke-RestMethod -Method Post -TimeoutSec 45 `
      -Uri ("{0}/auth/realms/{1}/protocol/openid-connect/token" -f $KC_BASE, $KC_REALM) `
      -ContentType 'application/x-www-form-urlencoded' -Body $body
    if (-not $tok.access_token) { throw 'Keycloak no devolvio access_token.' }
    Ok ("Sesion CM valida para {0} (token de {1}s)" -f $credCm.UserName, $tok.expires_in)
  } catch {
    # En QA no hay nada que borrar: el usuario es fijo. Si Keycloak lo
    # rechaza, o el laboratorio esta caido o cambio el usuario por
    # defecto, y eso no se arregla reingresando nada.
    $msg = "Keycloak ({0}) rechazo el login del CM con el usuario por defecto '{1}': {2}" -f $KC_BASE, $CM_USER, $_.Exception.Message
    $msg += "`n         Revisa que el laboratorio este arriba y que ese usuario siga siendo el de QA."
    throw $msg
  }

  # ---------- 5. Edge ----------
  Paso 5 'Preparando Microsoft Edge...'
  $edge = ''
  foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if ([string]::IsNullOrWhiteSpace($base)) { continue }
    $cand = Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
    if (Test-Path $cand) { $edge = $cand; break }
  }
  if (-not $edge) { throw 'No se encontro msedge.exe en las rutas estandar de Microsoft Edge.' }
  if (Test-Path $perfil) { Remove-Item $perfil -Recurse -Force -ErrorAction SilentlyContinue }
  Ok 'Perfil temporal limpio'

  # El prf va en la query (como en el redirect de SIME) y las credenciales del
  # CM en el FRAGMENTO (#...), que no viaja en ninguna peticion. Cada pagina
  # las lee al cargar, llena los campos y limpia la URL.
  $usrEnc  = [uri]::EscapeDataString($credCm.UserName)
  $passEnc = [uri]::EscapeDataString($credCm.GetNetworkCredential().Password)

  if ($abrirReporte -and $prf) {
    $rutaRep = [uri]::EscapeUriString('file:///' + ($htmlReporte -replace '\\', '/'))
    $urls += ('{0}?prf={1}#cm_user={2}&cm_pass={3}' -f $rutaRep, [uri]::EscapeDataString($prf), $usrEnc, $passEnc)
  }
  if ($abrirCasos) {
    $rutaCas = [uri]::EscapeUriString('file:///' + ($htmlCasos -replace '\\', '/'))
    $urls += ('{0}#cm_user={1}&cm_pass={2}' -f $rutaCas, $usrEnc, $passEnc)
  }
  if ($urls.Count -eq 0) { throw 'No quedo ninguna herramienta por abrir.' }

  # ---------- 6. Abrir ----------
  Paso 6 ('Abriendo {0} herramienta(s)...' -f $urls.Count)
  $argsEdge = @(
    ('--user-data-dir="{0}"' -f $perfil),
    '--disable-web-security',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    '--start-maximized',
    '--inPrivate'
  )
  foreach ($u in $urls) { $argsEdge += ('"{0}"' -f $u) }
  Start-Process $edge -ArgumentList $argsEdge

  Write-Host ''
  if ($abrirReporte -and $prf) { Nota 'Pestana: reporte de lineas prepagadas' }
  if ($abrirCasos)             { Nota 'Pestana: cierre masivo de casos (empieza en modo Simulacion)' }
  Write-Host '  Listo. Usa esa ventana solo para estas herramientas.' -ForegroundColor Green
  Write-Host ''
  Start-Sleep -Seconds 4
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
    Write-Host '  (vuelve a ejecutarlo con  dame click.bat /debug  para ver el detalle)' -ForegroundColor DarkGray
  }
  Write-Host ''
  Read-Host '  Enter para cerrar'
}
finally {
  # Limpieza: nada de esto debe quedar vivo en memoria mas de lo necesario
  $prf = $null; $urls = $null; $body = $null; $tok = $null
  $usrEnc = $null; $passEnc = $null
  $credCm = $null; $credSime = $null
  [GC]::Collect()
}
