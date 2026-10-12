# Graph Report - me-operacion  (2026-10-12)

## Corpus Check
- 56 files · ~252,042 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 49 file(s) not represented in the graph (top: .zip 28, .css 16, .bat 3)

## Summary
- 1487 nodes · 3101 edges · 101 communities (81 shown, 20 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 320 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fc8ee5d1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- rechazo.js
- casos.js
- portabilidad-tigo.js
- ambos.js
- tigo.js
- Portability rejection PDF (jsPDF, FC/LS/LD)
- cm-lineas.js
- ajustarTablas
- consumos.js
- plu.js
- Guardas: solo precio 0, una linea, sin reintento de orden
- paquetes.js
- titularidad.js
- inicio.js
- Cambio IMSI y línea Claro|Tigo — Documentación técnica
- me-ui.js
- export_tipificacion.html (Exportar casos · Tipificación)
- Flujo carrito -> productOrder -> limpiar -> verificar
- index.html (Herramientas de Operación)
- tipificacion.js
- convertir_audio_mp3.html (Convertir audio a MP3 | ME Operación)
- HLR/HSS · Claro y Tigo (page, v2.4)
- Base compartida y lanzador - Doc tecnica
- audio-mp3.js
- claro.js
- calculo.js
- detalleCdrHTML
- prepagadas.js
- CM ChangeOffer order (cart + productOrder) to delete bundles
- genesis-api.js
- CODEX.md - Contexto de continuidad
- Consumos y Paquetes (CM) - Doc tecnica
- generar_rechazo.html (Generar archivo de rechazo)
- ajustes.js
- inicializarConsumos
- Cierre masivo de casos (CM) - Doc tecnica
- Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica
- me-operacion README (catalogo)
- categoriaMov
- abrirConfirmacion
- prefactura.js
- consultar
- filaPasaFiltros
- Puente pattern (bridge between tool logic and MEUI shell)
- hlr-consulta.js
- eliminarPaquetes
- render
- lanzador.ps1
- render
- cuadroCambioHTML
- me-api.js
- headersSime
- estado_lineas.html (Estado de líneas)
- cargarHistorico
- configurarArchivo
- eliminarDeLinea
- export_ajustes.html (Ajustes y paquetes)
- reporte_casos_masivos.html (Cierre masivo de casos)
- 4. Reglas
- descargarEvidenciaXlsx
- Captura HAR recargar_bundles.har
- selectableProducts (PROD_COMP_TPS, PROD_COMP_BDLE)
- subscriberProfile enabledOptionalBundles
- pintarCrearSime
- 5 · Cómo entra el analista, en la práctica
- 5. Funcionalidad
- menuSesion
- cambio-imsi-linea.js
- tulio-plu.js
- fuenteDatos
- estado-lineas.js
- Convertir audio a MP3 - Doc tecnica
- cargarGenesis
- log
- filaConfirmacion
- render
- aplicarSeleccion
- tomarTokenGenesis
- imsi.js
- datosOperacion
- pintarSesiones
- inicializarTitularidad
- init
- htmlPayload
- abrirDetalle
- fmtCantidad
- estadoTabla
- enriquecer
- consultarCm
- configurarArchivo
- hlr-hss.js
- catalogo.js
- dependencias.js
- autoSpinner
- escribirLog
- cmBuscarLinea
- esc
- CM ChangeSubscriptionState order
- Exact externalID billingAccount match

## God Nodes (most connected - your core abstractions)
1. `CODEX.md - Contexto de continuidad` - 39 edges
2. `me-operacion README (catalogo)` - 32 edges
3. `Base compartida y lanzador - Doc tecnica` - 27 edges
4. `render()` - 19 edges
5. `render()` - 19 edges
6. `init()` - 17 edges
7. `inicializarConsumos()` - 17 edges
8. `abrirConfirmacion()` - 17 edges
9. `iniciar()` - 17 edges
10. `Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Genesis — `FechaExpedicion`` --references--> `usuario()`  [INFERRED]
  doc/titularidad/README.md → assets/compartido/cm-lineas.js
- `Repintados: qué se hace y qué no` --references--> `filtroMulti()`  [INFERRED]
  doc/titularidad/README.md → assets/base/me-ui.js
- `2. Arquitectura y archivos` --references--> `ordenesPendientes()`  [INFERRED]
  doc/cambio-imsi-linea/README.md → assets/compartido/cm-lineas.js
- `2. Arquitectura y archivos` --references--> `textoDesdeHoja()`  [INFERRED]
  doc/cambio-imsi-linea/README.md → assets/herramientas/cambio-imsi-linea/msisdn.js
- `4 · El inicio de sesión de Genesis es OPCIONAL` --references--> `haySesionValida()`  [INFERRED]
  doc/genesis-login.md → assets/base/me-ui.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Escrituras al CM con patron carrito-orden-seguimiento** — codex_cm_order_pattern, codex_changeoffer_order, codex_changesubscriptionstate_order, codex_changesim_order, codex_mepaq, codex_cmlineas, doc_reporte_consumos_readme_cargar_paquete [EXTRACTED 1.00]
- **HLR/HSS tabbed tool** — herramientas_hlr_hss_pestana_tigo, herramientas_hlr_hss_pestana_claro, herramientas_hlr_hss_pestana_ambos [EXTRACTED 1.00]
- **Copias alineadas de resolucion de titular** — codex_titular_resolution_flow, codex_tool_consumos, codex_tool_rechazo, codex_tool_ajustes, doc_reporte_consumos_readme_titulardecuenta, codex_billingaccount_exact_match [EXTRACTED 1.00]
- **Pipeline de releases por carpeta de red** — doc_lanzador_readme_empaquetar_release, codex_version_json, codex_release_network_folder, doc_lanzador_readme_dame_click_launcher, doc_lanzador_readme_actualizar, doc_lanzador_readme_sha256_verification, doc_lanzador_plan_3_0_0_publish_order_zip_then_json [INFERRED 0.85]

## Communities (101 total, 20 thin omitted)

### Community 0 - "rechazo.js"
Cohesion: 0.08
Nodes (65): aInputFechaHora(), alCambiarCampo(), aplicarPersonaJuridica(), aplicarReglaNit(), arrancarReloj(), arrancarSesion(), barra(), bloqueImagen() (+57 more)

### Community 1 - "casos.js"
Cohesion: 0.08
Nodes (59): abrirDetalle(), accionDe(), actualizarBotones(), actualizarContadores(), asegurarCaracteristicas(), baseTitulo(), buscarUno(), calcularTituloNuevo() (+51 more)

### Community 2 - "portabilidad-tigo.js"
Cohesion: 0.09
Nodes (46): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), buscarSeccion(), calcularBloqueos(), celdaEstadoCM() (+38 more)

### Community 3 - "ambos.js"
Cohesion: 0.10
Nodes (42): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), alternarKpi(), celdaCarrier(), celdaUbicacion(), concluirUbicacion(), configurarArchivo() (+34 more)

### Community 4 - "tigo.js"
Cohesion: 0.10
Nodes (41): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), alternarKpi(), buscarSeccion(), calcularBloqueos(), configurarArchivo(), extraerColumna() (+33 more)

### Community 6 - "cm-lineas.js"
Cohesion: 0.09
Nodes (29): cambiarEstado(), cambiarImsi(), cambiarMsisdn(), cuentaBase(), cuentaCrm(), direccionDe(), engancharLote(), engancharSesionCm() (+21 more)

### Community 7 - "ajustarTablas"
Cohesion: 0.19
Nodes (13): abrirPaso(), ajustarTabla(), ajustarTablas(), enfocarDatos(), mostrarSiHayDatos(), opcionesTabla(), pintarFlechaLateral(), programarAjusteTablas() (+5 more)

### Community 8 - "consumos.js"
Cohesion: 0.07
Nodes (35): buscarBillingAccount(), CALLTYPE_CATEGORIA, candidatosExternalID(), CAT_ORDEN, celdaUsoCategoria(), CLASE_CATEGORIA_CDR, CLASE_FILA_MOV, cmBuscarLinea() (+27 more)

### Community 9 - "plu.js"
Cohesion: 0.08
Nodes (30): agregarFila(), CABECERA_BITACORA, CABECERA_EXPORT, CABECERA_SECUENCIA, CATEGORIA_UNIDAD, conectar(), CONFIG, errorDeFila() (+22 more)

### Community 11 - "paquetes.js"
Cohesion: 0.16
Nodes (32): abrirPanel(), alternar(), cablear(), catalogoDeOferta(), cerrarPanel(), cuerpoCarrito(), cuerpoOrden(), ejecutar() (+24 more)

### Community 12 - "titularidad.js"
Cohesion: 0.07
Nodes (29): CABECERA, cambiarVistaPayload(), CLASE_ESTADO_CM, CLASE_UBICACION, COL_FECHA, COLUMNAS, CONFIG, _controles (+21 more)

### Community 13 - "inicio.js"
Cohesion: 0.12
Nodes (30): abrirDoc(), archivoDelBacklog(), archivosDe(), armarZip(), BACKLOG, BASE, cargarCodigoVisible(), crc32() (+22 more)

### Community 14 - "Cambio IMSI y línea Claro|Tigo — Documentación técnica"
Cohesion: 0.07
Nodes (29): 1. Objetivos, 3. Herramientas de terceros, 4.1 Cambio IMSI, 4.2 Cambio de línea (MSISDN), 4. Endpoints, 5.1 Cambio IMSI, 5.2 Cambio de línea (MSISDN), 5. Validaciones (antes de poder marcar) (+21 more)

### Community 15 - "me-ui.js"
Cohesion: 0.11
Nodes (13): abrirAyuda(), abrirDoc(), accesibilidadContenido(), cargarMarked(), cerrarAyuda(), cerrarLateralMovil(), chipHTML(), gruposDelMenu() (+5 more)

### Community 19 - "tipificacion.js"
Cohesion: 0.13
Nodes (20): actualizarProgreso(), buildQuery(), contarCasos(), descargarPaginas(), descargarPaginasEspecificas(), descargarRangoFechas(), dividir(), procesar() (+12 more)

### Community 21 - "HLR/HSS · Claro y Tigo (page, v2.4)"
Cohesion: 0.15
Nodes (19): me-ui.css, MEUI.init(), Common ME tool layout (KPI cards as filters, steps column, log, DataTable, detail modal, CSV/XLSX/JSON export), CM session, SIME token session, aplicar_plu.html (Aplicar PLU de paquete), HLR/HSS · Claro y Tigo (page, v2.4), Claro HLR/HSS provisioning (create/delete line, authorized CM users) (+11 more)

### Community 22 - "Base compartida y lanzador - Doc tecnica"
Cohesion: 0.18
Nodes (24): Puente 2.x -> 3.0.0 via sebasmd.com, Riesgo: carpeta de releases sin control de escritura, Carpeta de red de releases (296nas01 me-operacion-release), Convencion Major.Minor.Patch (version en tres lugares), version.json (autoridad final de release), Estado de lineas docs, GETTINGSTARTED - Primeros pasos, Plan 3.0.0 - Releases desde carpeta de red (+16 more)

### Community 23 - "audio-mp3.js"
Cohesion: 0.18
Nodes (25): actualizarFila(), agregar(), canalEntero16(), codificarMp3(), convertir(), convertirPendientes(), descargar(), descargarBlob() (+17 more)

### Community 24 - "claro.js"
Cohesion: 0.14
Nodes (25): abrirDetalle(), bitacoraExport(), buscarCaracteristica(), categoriaDe(), construirDataTable(), consultarConReintentos(), consultarUnaVez(), enviarUnaVez() (+17 more)

### Community 25 - "calculo.js"
Cohesion: 0.14
Nodes (21): archivosFiliales(), calcular(), calcularDesdeBruto(), escribirEnCarpeta(), evaluarObservacion(), fechaEvento(), hoja(), indiceTarifas() (+13 more)

### Community 26 - "detalleCdrHTML"
Cohesion: 0.15
Nodes (25): categoriaCdr(), celdaCategoriaCdr(), celdaUso(), colorCategoria(), construirTablaHistorico(), detalleCdrHTML(), direccionCdr(), escHtml() (+17 more)

### Community 27 - "prepagadas.js"
Cohesion: 0.14
Nodes (19): bssBundleBalance(), bssBuscarLinea(), bssCliente(), bssServiciosDeCuenta(), bssTransacciones(), buscarBillingAccount(), cambiarCuenta(), candidatosExternalID() (+11 more)

### Community 28 - "CM ChangeOffer order (cart + productOrder) to delete bundles"
Cohesion: 0.33
Nodes (6): CM ChangeOffer order (cart + productOrder) to delete bundles, CM stable fingerprint wait (bundleId:asignado), ERCRT1002 missing dependent product handling, NO_ELIMINABLES bundle list, PLU sequence (consultar, aplicar, evidencia, eliminar, verificar), Tulio RecargaPaquete

### Community 29 - "genesis-api.js"
Cohesion: 0.09
Nodes (32): adivinarPagina(), aligerar(), buscarEnElDia(), cabeceraPaginacion(), cargarTodo(), descripcionErrorKc(), detalleDe(), diaDe() (+24 more)

### Community 30 - "CODEX.md - Contexto de continuidad"
Cohesion: 0.15
Nodes (25): CODEX.md - Contexto de continuidad, billingAccount externalID con coincidencia exacta, Orden ChangeOffer, Orden ChangeSim (cambio de IMSI), Orden ChangeSubscriptionState (bloquear/inactivar), Patron de ordenes CM: carrito -> orden -> seguimiento -> borrar carrito, window.CMLineas (cm-lineas.js), Copias deliberadas que pueden divergir (HLR Ambos/cruce, Claro/QDN) (+17 more)

### Community 31 - "Consumos y Paquetes (CM) - Doc tecnica"
Cohesion: 0.16
Nodes (16): Flujo de resolucion de titular (MSISDN -> billingAccount -> individual), Herramienta Ajustes/Paquetes, Herramienta Rechazos, Ajustes y paquetes (CM) - Doc tecnica, Montos multiplicados por 10.000, Catalogos de codigos editables (cmMaps), resolveAll - numero por cuenta, GET /subscription/adjustment (bundleAdjustment) (+8 more)

### Community 33 - "ajustes.js"
Cohesion: 0.16
Nodes (16): accountFromSub(), actualizarResumen(), approvalDate(), buscarCuenta(), candidatosCuenta(), descargar(), digMsisdn(), fetchAdjustments() (+8 more)

### Community 34 - "inicializarConsumos"
Cohesion: 0.17
Nodes (18): actualizarKPIs(), alternarKpi(), asegurarSesion(), cabeceraHistorico(), cabeceraMovimientos(), cambiarCuenta(), cmBundleBalance(), consultar() (+10 more)

### Community 35 - "Cierre masivo de casos (CM) - Doc tecnica"
Cohesion: 0.21
Nodes (12): CM/Optiva OBP API Gateway, Keycloak Optiva (realm/client optiva), Arquitectura de tres capas (HTML marcado / logica-*.js / me-*-puente.js), Herramienta Casos masivos, Cierre masivo de casos (CM) - Doc tecnica, accionDe(fila) - regla columna Favorable, Renovacion de token segura ante concurrencia, ESTADOS_CERRADOS (+4 more)

### Community 36 - "Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica"
Cohesion: 0.24
Nodes (12): SIME API (token prf), SIME Web (NTLM -> prf), Herramienta Prepagadas, Clasificacion de movimientos (1.a compra/paquete/recurrencia), Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica, GetCanalTipo (catalogo en vivo de planes SIME), Movimientos BSS / categoriaTx, Plan como campo maestro del alta (+4 more)

### Community 37 - "me-operacion README (catalogo)"
Cohesion: 0.12
Nodes (19): Herramienta Tipificacion, Aplicar PLU de paquete docs, consola_bundles_movil_exito (Python console), Interface guard user allowlist (not access control), Generar archivo de rechazo docs, CUN manual entry, HLR/HSS Claro y Tigo Doc, Fusion de tres herramientas en pestanas (+11 more)

### Community 38 - "categoriaMov"
Cohesion: 0.24
Nodes (18): categoriaMov(), celdaCategoriaMov(), celdaVigenciaMov(), construirTablaMovimientos(), esCompraMov(), esCompraPlanMov(), esMesActual(), esPrimeraMov() (+10 more)

### Community 39 - "abrirConfirmacion"
Cohesion: 0.20
Nodes (18): abrirConfirmacion(), anotarBitacora(), camposRequeridos(), claseTipo(), confirmarPaso1(), correrOperacion(), ejecutarOperacion(), ejecutarPool() (+10 more)

### Community 40 - "prefactura.js"
Cohesion: 0.17
Nodes (10): cargosEscritos(), corte(), pintar(), pintarCorte(), pintarDestino(), pintarTabla(), pintarTarifas(), procesar() (+2 more)

### Community 41 - "consultar"
Cohesion: 0.15
Nodes (18): adicional(), cargarCatalogoSime(), consultar(), consultarLinea(), consultarLote(), worker(), finConsulta(), obtenerLineas() (+10 more)

### Community 42 - "filaPasaFiltros"
Cohesion: 0.18
Nodes (17): actualizarConteoMasivo(), actualizarKPIs(), botonOperacionHTML(), celdaEstado(), estadoTabla(), filaPasaFiltros(), filasExport(), filasParaExportar() (+9 more)

### Community 44 - "hlr-consulta.js"
Cohesion: 0.24
Nodes (15): claroNoConsultado(), concluirUbicacion(), consultarClaro(), consultarClaroUnaVez(), consultarLinea(), consultarTigo(), consultarTigoUnaVez(), consultarVarias() (+7 more)

### Community 45 - "eliminarPaquetes"
Cohesion: 0.23
Nodes (16): apiCm(), cmCuentaCrm(), cmEsperarOrden(), cmPaquetes(), cmPerfil(), consultarLinea(), correrPluSecuencia(), crearCarrito() (+8 more)

### Community 46 - "render"
Cohesion: 0.17
Nodes (15): autoMapear(), actualizarKpis(), alternarOculta(), fijarFiltro(), filaPasaFiltros(), limpiarFiltros(), mostrarTodas(), normaliza() (+7 more)

### Community 47 - "lanzador.ps1"
Cohesion: 0.28
Nodes (3): Leer-Credencial(), Nota(), Ok()

### Community 48 - "render"
Cohesion: 0.20
Nodes (15): actualizarFiltros(), alternarKpi(), consultar(), ejecutarConsultas(), filasVisiblesPagina(), inicializarQdn(), limpiarFiltros(), marcarFilas() (+7 more)

### Community 49 - "cuadroCambioHTML"
Cohesion: 0.21
Nodes (15): bolsillosPlegablesHTML(), cantidadCorta(), categoriaPaquete(), compararPaquetes(), cuadroCambioHTML(), escHtml(), fmtCantidad(), fmtCantidadLegible() (+7 more)

### Community 50 - "me-api.js"
Cohesion: 0.33
Nodes (11): api(), cabeceras(), ensure(), getJson(), _guardar(), imsi(), leerCampos(), _login() (+3 more)

### Community 51 - "headersSime"
Cohesion: 0.16
Nodes (14): abrirEditarRec(), actualizarPayloadRec(), crearEnSime(), guardarRec(), headersSime(), payloadCrear(), payloadRec(), pintarRecFijos() (+6 more)

### Community 54 - "cargarHistorico"
Cohesion: 0.22
Nodes (13): abrirDetalle(), cargarHistorico(), cmHistoricoConsumo(), cmMovimientos(), isoLocalSinZ(), marcarVigentes(), normalizarLocalISO(), paginarHistorico() (+5 more)

### Community 55 - "configurarArchivo"
Cohesion: 0.22
Nodes (13): cargarDatosExtra(), columnaPorNombre(), configurarArchivo(), extraerColumna(), limpiar(), pintarColumnas(), procesar(), discrepanciasDe() (+5 more)

### Community 56 - "eliminarDeLinea"
Cohesion: 0.23
Nodes (13): abrirDetalle(), aplicarPlu(), celdaEstado(), construirTabla(), consultarFilas(), eliminarDeLinea(), esEliminable(), listoParaPlu() (+5 more)

### Community 59 - "4. Reglas"
Cohesion: 0.11
Nodes (18): 1. Objetivos, 2. Arquitectura y archivos, 3. Herramientas de terceros, 4. Reglas, 5. El proceso en Excel que reemplaza (reunión «Prefactura»), 6. Funcionalidad, 7. Riesgos y límites, 8. Historial de cambios (+10 more)

### Community 60 - "descargarEvidenciaXlsx"
Cohesion: 0.19
Nodes (13): datosEvidencia(), descargarEvidenciaXlsx(), duracionS(), enUnidad(), factorUnidad(), fechaXls(), filasBitacora(), filasSecuencia() (+5 more)

### Community 65 - "pintarCrearSime"
Cohesion: 0.29
Nodes (13): actualizarPayload(), alElegirTipo(), avisoMsisdn(), canalDeNombre(), catalogoAprendido(), catalogoPlu(), limpiarDerivados(), marcarRecalculo() (+5 more)

### Community 66 - "5 · Cómo entra el analista, en la práctica"
Cohesion: 0.12
Nodes (15): 1 · El flujo real, paso a paso, 2.1 · No hay «usuario y contraseña de Genesis», 2.2 · El 2FA hace imposible el camino «usuario + contraseña + 2FA» dentro de la herramienta, 2.3 · El `refresh_token` no sirve para durar más de una hora, 2.4 · El intercambio del código no necesita secreto, 2 · Las cuatro consecuencias que importan, 3 · Datos de la captura, para no volver a buscarlos, 5 · Cómo entra el analista, en la práctica (+7 more)

### Community 67 - "5. Funcionalidad"
Cohesion: 0.17
Nodes (12): avanzar(), fin(), iniciar(), paso(), pintarProgreso(), 5. Funcionalidad, «En batch»: qué significa aquí, Filtros, tarjetas y exportación (+4 more)

### Community 68 - "menuSesion"
Cohesion: 0.18
Nodes (9): estadoTabla(), get(), leerArranque(), menuSesion(), montarBuscador(), actualizar(), cerrar(), montarZonasArchivo() (+1 more)

### Community 69 - "cambio-imsi-linea.js"
Cohesion: 0.36
Nodes (11): activar(), actualizar(), columnasDe(), consultarTodas(), crearTabla(), ejecutar(), pintarAccion(), pintarPestanas() (+3 more)

### Community 70 - "tulio-plu.js"
Cohesion: 0.29
Nodes (8): aplicarPlu(), motivoSinPlu(), obtener(), payloadRecarga(), puedeAgregarPlu(), recargaUnaVez(), reset(), solicitar()

### Community 71 - "fuenteDatos"
Cohesion: 0.22
Nodes (10): exportables(), filaExport(), filasExport(), filasParaExportar(), firmaFiltros(), fuenteDatos(), invalidarVistas(), ordenadas() (+2 more)

### Community 72 - "estado-lineas.js"
Cohesion: 0.31
Nodes (7): actualizar(), cambiarFila(), consultarFila(), consultarTodas(), ejecutar(), pintarAccion(), puedeReintentar()

### Community 73 - "Convertir audio a MP3 - Doc tecnica"
Cohesion: 0.29
Nodes (7): Regla: no inventar datos, Herramienta Audio a MP3, Convertir audio a MP3 - Doc tecnica, lamejs (codificador MP3), Procesamiento local sin servidores, Convencion de nombres mp3-*.mp3, Web Audio API (decodificacion)

### Community 74 - "cargarGenesis"
Cohesion: 0.18
Nodes (11): cargarGenesis(), filaDesdeGenesis(), infoResultado(), intervaloPintado(), notaDeCarga(), objetivoTope(), progresoCarga(), registrarValoresFiltro() (+3 more)

### Community 75 - "log"
Cohesion: 0.29
Nodes (10): descargar(), exportarCSV(), exportarJSON(), exportarXLSX(), log(), montarSelectoresSeparador(), mostrarAvisoVersion(), sello() (+2 more)

### Community 76 - "filaConfirmacion"
Cohesion: 0.27
Nodes (10): campoInput(), celdaCambio(), celdaFeatures(), celdaInput(), celdaLectura(), celdaLinea(), featuresDeBloqueos(), featuresResueltos() (+2 more)

### Community 77 - "render"
Cohesion: 0.24
Nodes (10): actualizarKPIs(), actualizarOcultas(), alternarOculta(), badgeEstado(), botonOcultarHTML(), celdaPeriodos(), construirFiltros(), construirMenuColumnas() (+2 more)

### Community 78 - "aplicarSeleccion"
Cohesion: 0.24
Nodes (10): actualizarResumenSeleccion(), aplicarSeleccion(), construirTabla(), desmarcarTodo(), filtradasActivas(), marcarPagina(), pintarMenuColumnas(), seleccionarTodos() (+2 more)

### Community 79 - "tomarTokenGenesis"
Cohesion: 0.33
Nodes (7): tomarTokenGenesis(), b64url(), buscarEn(), claimsSiSirve(), enAlmacen(), mostrar(), uriFavorito()

### Community 80 - "imsi.js"
Cohesion: 0.28
Nodes (3): consultarFila(), marcarRepetidos(), noAplica()

### Community 81 - "datosOperacion"
Cohesion: 0.28
Nodes (9): datosCambio(), datosOperacion(), filaDe(), iccidDesdeImsi(), iccidSospechoso(), refrescarIccidDerivado(), refrescarIccidNuevoDerivado(), repintarOperaciones() (+1 more)

### Community 82 - "pintarSesiones"
Cohesion: 0.36
Nodes (8): caida(), cerrar(), difundir(), estado(), haySesionValida(), pintarSesiones(), set(), 4 · El inicio de sesión de Genesis es OPCIONAL

### Community 83 - "inicializarTitularidad"
Cohesion: 0.29
Nodes (8): actualizarAvisoRango(), crearFiltro(), crearFiltrosFijos(), infoRango(), inicializarTitularidad(), rangoMesEnCurso(), refrescarOpcionesFiltros(), topeUltimos()

### Community 84 - "init"
Cohesion: 0.33
Nodes (7): aplicarAperturaPasos(), filtroMulti(), pintar(), iniciarPie(), init(), montarPasos(), montarTogglePasos()

### Community 85 - "htmlPayload"
Cohesion: 0.33
Nodes (7): formatearPayload(), htmlPayload(), pintarCon(), pintarEtiqueta(), sangrarJSON(), sangrarXML(), tokensXML()

### Community 86 - "abrirDetalle"
Cohesion: 0.29
Nodes (7): abrirDetalle(), aplanarObjeto(), cargarRecurrencias(), chipVerif(), pintarRecurrencias(), simeRecurrencias(), tablaDatosHTML()

### Community 87 - "fmtCantidad"
Cohesion: 0.38
Nodes (7): fmtBytes(), fmtCantidad(), fmtFechaHora(), fmtVoz(), nfmt(), nivelUso(), usoHTML()

### Community 88 - "estadoTabla"
Cohesion: 0.40
Nodes (6): actualizarFiltros(), celdaEstado(), estadoTabla(), filaPasaFiltros(), filasExport(), filasParaExportar()

### Community 89 - "enriquecer"
Cohesion: 0.47
Nodes (6): calcularCiclos(), calcularPeriodos(), enriquecer(), generarComentarios(), totalPeriodosDePlan(), verificar()

### Community 90 - "consultarCm"
Cohesion: 0.40
Nodes (6): aplicarACadaFila(), consultarCm(), consultarHlr(), ejecutarPool(), lineasSeleccionadas(), seleccionadas()

### Community 91 - "configurarArchivo"
Cohesion: 0.70
Nodes (5): configurarArchivo(), extraerColumna(), limpiar(), pintarColumnas(), procesar()

### Community 92 - "hlr-hss.js"
Cohesion: 0.70
Nodes (4): conectarCm(), engancharComun(), engancharSesionCm(), montar()

### Community 95 - "autoSpinner"
Cohesion: 0.67
Nodes (4): autoSpinner(), conSpinner(), libre(), ocupado()

### Community 96 - "escribirLog"
Cohesion: 0.67
Nodes (4): cajasLog(), escribirLog(), instrucciones(), limpiarLog()

### Community 97 - "cmBuscarLinea"
Cohesion: 0.67
Nodes (4): cmBuscarLinea(), cuentaActiva(), cuentaBase(), cuentaPorDefecto()

### Community 98 - "esc"
Cohesion: 1.00
Nodes (3): badge(), celdaPaso(), esc()

## Ambiguous Edges - Review These
- `Regla: no inventar datos` → `Procesamiento local sin servidores`  [AMBIGUOUS]
  doc/audio-mp3/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **153 isolated node(s):** `CONFIG`, `ESTADOS_CM`, `TIPO_DOC_BSS`, `UNIT_TIPO`, `CAT_ORDEN` (+148 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 263 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Regla: no inventar datos` and `Procesamiento local sin servidores`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Bloqueos SIM x Titularidad — Documentación técnica` connect `genesis-api.js` to `5. Funcionalidad`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `me-operacion README (catalogo)` connect `me-operacion README (catalogo)` to `Cierre masivo de casos (CM) - Doc tecnica`, `Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica`, `Convertir audio a MP3 - Doc tecnica`, `Cambio IMSI y línea Claro|Tigo — Documentación técnica`, `Base compartida y lanzador - Doc tecnica`, `4. Reglas`, `genesis-api.js`, `CODEX.md - Contexto de continuidad`, `Consumos y Paquetes (CM) - Doc tecnica`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `5. Funcionalidad` connect `5. Funcionalidad` to `genesis-api.js`, `fuenteDatos`, `ajustarTablas`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `me-operacion README (catalogo)` (e.g. with `Herramienta Ajustes/Paquetes` and `Herramienta Audio a MP3`) actually correct?**
  _`me-operacion README (catalogo)` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CONFIG`, `ESTADOS_CM`, `TIPO_DOC_BSS` to the rest of the system?**
  _153 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `rechazo.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08438228438228439 - nodes in this community are weakly interconnected._