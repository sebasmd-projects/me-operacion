# Graph Report - me-operacion  (2026-10-12)

## Corpus Check
- 77 files · ~279,654 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 34 file(s) not represented in the graph (top: .zip 28, .bat 3, (none) 2)

## Summary
- 1806 nodes · 3767 edges · 75 communities (67 shown, 8 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 364 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fc8ee5d1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- logica-hlr-hss-claro.js
- logica-casos.js
- logica-plu.js
- logica-qdn.js
- logica-qdn-operaciones.js
- logica-rechazo.js
- logica-portabilidad-tigo.js
- me-ui.js
- logica-qdn-tigo.js
- logica-prepagadas.js
- logica-hlr-cruzado.js
- logica-hlr-hss-ambos.js
- logica-hlr-hss-tigo.js
- logica-consumos.js
- logica-ajustes.js
- me-rechazo-puente.js
- logica-tipificacion.js
- logica-paquetes-carga.js
- logica-inicio.js
- me-plu-puente.js
- logica-audio-mp3.js
- HLR/HSS · Claro y Tigo (page, v2.4)
- Base compartida y lanzador - Doc tecnica
- detalleCdrHTML
- abrirDetalle
- pintarCrearSime
- categoriaMov
- log
- cm-lineas.js
- genesis-api.js
- CODEX.md - Contexto de continuidad
- Consumos y Paquetes (CM) - Doc tecnica
- me-api.js
- cargarHistorico
- logica-cambio-imsi.js
- Cierre masivo de casos (CM) - Doc tecnica
- Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica
- me-operacion README (catalogo)
- construirDataTable
- resumirTx
- logica-estado-lineas.js
- actualizarPayloadRec
- headersSime
- me-hlr-hss-puente.js
- logica-titularidad.js
- inicializarConsumos
- enriquecer
- lanzador.ps1
- Validador Portabilidad Tigo Doc
- logica-prefactura.js
- usoHTML
- me-prefactura-puente.js
- me-estado-lineas-puente.js
- configurarArchivo
- fmtFechaHora
- render
- export_ajustes.html (Ajustes y paquetes)
- reporte_casos_masivos.html (Cierre masivo de casos)
- 4. Reglas
- cargarGenesis
- Captura HAR recargar_bundles.har
- selectableProducts (PROD_COMP_TPS, PROD_COMP_BDLE)
- subscriberProfile enabledOptionalBundles
- hlr-consulta.js
- 5 · Cómo entra el analista, en la práctica
- logica-cambio-msisdn.js
- consultarCm
- tulio-plu.js
- tomarTokenGenesis
- ordenadas
- visibles
- Convertir audio a MP3 - Doc tecnica
- me-cambio-msisdn-puente.js

## God Nodes (most connected - your core abstractions)
1. `CODEX.md - Contexto de continuidad` - 39 edges
2. `me-operacion README (catalogo)` - 36 edges
3. `Base compartida y lanzador - Doc tecnica` - 31 edges
4. `render()` - 19 edges
5. `log()` - 18 edges
6. `HLR/HSS · Claro y Tigo (page, v2.4)` - 18 edges
7. `pintarCrearSime()` - 17 edges
8. `abrirDetalle()` - 17 edges
9. `abrirConfirmacion()` - 17 edges
10. `inicializarConsumos()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Genesis — `FechaExpedicion`` --references--> `usuario()`  [INFERRED]
  doc/titularidad/README.md → assets/cm-lineas.js
- `2. Arquitectura y archivos` --references--> `ordenesPendientes()`  [INFERRED]
  doc/cambio-msisdn/README.md → assets/cm-lineas.js
- `2. Arquitectura y archivos` --references--> `cambiarMsisdn()`  [INFERRED]
  doc/cambio-msisdn/README.md → assets/cm-lineas.js
- `2. Arquitectura y archivos` --references--> `tramosDeRango()`  [INFERRED]
  doc/titularidad/README.md → assets/genesis-api.js
- `Tabla · por qué la tabla no tiene los datos` --references--> `ordenadas()`  [INFERRED]
  doc/titularidad/README.md → assets/logica-titularidad.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Pages built on shared CM line lookup (cm-lineas.js + me-api.js)** — herramientas_cambio_imsi, herramientas_estado_lineas, assets_cm_lineas, assets_me_api [EXTRACTED 1.00]
- **Escrituras al CM con patron carrito-orden-seguimiento** — codex_cm_order_pattern, codex_changeoffer_order, codex_changesubscriptionstate_order, codex_changesim_order, codex_mepaq, codex_cmlineas, doc_reporte_consumos_readme_cargar_paquete [EXTRACTED 1.00]
- **Exact billingAccount resolution shared across tools** — assets_logica_plu, assets_logica_consumos, assets_logica_rechazo, doc_aplicar_plu_readme_exact_billing_account [EXTRACTED 1.00]
- **Flujo de carga de paquete en el CM** — assets_logica_paquetes_carga, assets_logica_consumos, doc_reporte_ajustes_recarga_de_paquetes_cm_subscriberprofile, doc_reporte_ajustes_recarga_de_paquetes_cm_selectableproducts, doc_reporte_ajustes_recarga_de_paquetes_cm_flujo_carrito_orden [EXTRACTED 1.00]
- **Motores fusionados en HLR/HSS** — assets_me_hlr_hss_puente, assets_logica_hlr_hss_tigo, assets_logica_hlr_hss_claro, assets_logica_hlr_hss_ambos, assets_logica_qdn, assets_logica_qdn_operaciones, assets_logica_hlr_cruzado, assets_logica_qdn_tigo [EXTRACTED 1.00]
- **HLR/HSS tabbed tool** — herramientas_hlr_hss_pestana_tigo, herramientas_hlr_hss_pestana_claro, herramientas_hlr_hss_pestana_ambos [EXTRACTED 1.00]
- **Copias alineadas de resolucion de titular** — codex_titular_resolution_flow, codex_tool_consumos, codex_tool_rechazo, codex_tool_ajustes, doc_reporte_consumos_readme_titulardecuenta, codex_billingaccount_exact_match [EXTRACTED 1.00]
- **Guarded production-write operations** — herramientas_reporte_consumos_cargar_paquete, herramientas_validador_qdn_operaciones, herramientas_hlr_hss_aprovisionamiento [INFERRED 0.75]
- **CM cart + productOrder write flows** — doc_aplicar_plu_readme_changeoffer_order, doc_cambio_imsi_readme_changesim_order, doc_estado_lineas_readme_changesubscriptionstate [INFERRED 0.85]
- **Tool bridge (puente) modules connecting logic to MEUI shell** — assets_me_hlr_hss_puente, assets_me_consumos_puente, assets_me_prepagadas_puente, assets_me_qdn_puente, assets_me_ui [INFERRED 0.85]
- **Pipeline de releases por carpeta de red** — doc_lanzador_readme_empaquetar_release, codex_version_json, codex_release_network_folder, doc_lanzador_readme_dame_click_launcher, doc_lanzador_readme_actualizar, doc_lanzador_readme_sha256_verification, doc_lanzador_plan_3_0_0_publish_order_zip_then_json [INFERRED 0.85]

## Communities (75 total, 8 thin omitted)

### Community 0 - "logica-hlr-hss-claro.js"
Cohesion: 0.05
Nodes (101): abrirConfirmacion(), abrirDetalle(), actualizarConteoMasivo(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), anotarBitacora() (+93 more)

### Community 1 - "logica-casos.js"
Cohesion: 0.05
Nodes (74): abrirDetalle(), accionDe(), actualizarBotones(), actualizarContadores(), apiFetch(), asegurarCaracteristicas(), baseTitulo(), buscarUno() (+66 more)

### Community 2 - "logica-plu.js"
Cohesion: 0.06
Nodes (69): apiCm(), aplicarPlu(), barraEtapasHTML(), barraSecuenciaHTML(), bolsillosPlegablesHTML(), CABECERA_BITACORA, CABECERA_EXPORT, CABECERA_SECUENCIA (+61 more)

### Community 3 - "logica-qdn.js"
Cohesion: 0.06
Nodes (64): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_QDN, BSVOZ_TELEFONIA, buscarCaracteristica() (+56 more)

### Community 4 - "logica-qdn-operaciones.js"
Cohesion: 0.08
Nodes (62): abrirConfirmacion(), actualizarConteoMasivo(), anotarBitacora(), bitacoraExport(), bitacoraOperaciones, BLOQUEO_A_PROCESO, botonOperacionHTML(), CABECERA_BITACORA (+54 more)

### Community 5 - "logica-rechazo.js"
Cohesion: 0.06
Nodes (54): aInputFechaHora(), altoUtil(), AMARILLO, API(), barra(), bloqueImagen(), buscarBillingAccount(), CAMPOS_CIERRE (+46 more)

### Community 6 - "logica-portabilidad-tigo.js"
Cohesion: 0.07
Nodes (55): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+47 more)

### Community 7 - "me-ui.js"
Cohesion: 0.06
Nodes (60): abrirDoc(), abrirPaso(), ajustarTabla(), ajustarTablas(), aplicarAperturaPasos(), autoSpinner(), caida(), cajasLog() (+52 more)

### Community 8 - "logica-qdn-tigo.js"
Cohesion: 0.07
Nodes (51): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+43 more)

### Community 9 - "logica-prepagadas.js"
Cohesion: 0.06
Nodes (46): actualizarEtiquetasFiltro(), ALIAS_COLUMNA, BADGE_LINEA, bssCliente(), buscarBillingAccount(), cacheRecurrencias, cacheServicios, CANALES_FIJOS (+38 more)

### Community 10 - "logica-hlr-cruzado.js"
Cohesion: 0.05
Nodes (61): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_CLARO, AMBIENTE_TIGO, CABECERA_EXPORT (+53 more)

### Community 11 - "logica-hlr-hss-ambos.js"
Cohesion: 0.11
Nodes (39): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), celdaCarrier(), celdaUbicacion(), concluirUbicacion() (+31 more)

### Community 12 - "logica-hlr-hss-tigo.js"
Cohesion: 0.11
Nodes (38): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), buscarSeccion(), calcularBloqueos(), celdaEstado() (+30 more)

### Community 13 - "logica-consumos.js"
Cohesion: 0.08
Nodes (37): actualizarProgreso(), buscarBillingAccount(), CABECERA_EXPORT, CALLTYPE_CATEGORIA, cambiarCuenta(), candidatosExternalID(), CAT_ORDEN, CLASE_CATEGORIA_CDR (+29 more)

### Community 14 - "logica-ajustes.js"
Cohesion: 0.10
Nodes (32): accountFromSub(), activity(), actualizarResumen(), apiGet(), approvalDate(), approvedFlag(), BUNDLE_COLS, buscarCuenta() (+24 more)

### Community 15 - "me-rechazo-puente.js"
Cohesion: 0.17
Nodes (31): alCambiarCampo(), aplicarPersonaJuridica(), aplicarReglaNit(), arrancarReloj(), arrancarSesion(), campoPorId(), camposDe(), cargarImagenes() (+23 more)

### Community 16 - "logica-tipificacion.js"
Cohesion: 0.12
Nodes (25): actualizarProgreso(), buildQuery(), COLS_FRONT, contarCasos(), descargarPaginas(), descargarPaginasEspecificas(), descargarRangoFechas(), dividir() (+17 more)

### Community 17 - "logica-paquetes-carga.js"
Cohesion: 0.14
Nodes (34): abrirPanel(), alternar(), cablear(), catalogoDeOferta(), cerrarPanel(), cuerpoCarrito(), cuerpoOrden(), ejecutar() (+26 more)

### Community 18 - "logica-inicio.js"
Cohesion: 0.14
Nodes (26): abrirDoc(), archivosDe(), armarZip(), BASE, cargarCodigoVisible(), crc32(), descargarPaquete(), descargarUno() (+18 more)

### Community 19 - "me-plu-puente.js"
Cohesion: 0.14
Nodes (20): esEliminable(), abrirDetalle(), agregarFila(), celdaEstado(), conectar(), construirTabla(), eliminarDeLinea(), errorDeFila() (+12 more)

### Community 20 - "logica-audio-mp3.js"
Cohesion: 0.17
Nodes (24): agregar(), canalEntero16(), codificarMp3(), convertir(), convertirPendientes(), descargar(), descargarBlob(), descargarTodo() (+16 more)

### Community 21 - "HLR/HSS · Claro y Tigo (page, v2.4)"
Cohesion: 0.12
Nodes (24): me-ui.css, MEUI.init(), Common ME tool layout (KPI cards as filters, steps column, log, DataTable, detail modal, CSV/XLSX/JSON export), CM session, QDN OAuth2 session, SIME token session, aplicar_plu.html (Aplicar PLU de paquete), HLR/HSS · Claro y Tigo (page, v2.4) (+16 more)

### Community 22 - "Base compartida y lanzador - Doc tecnica"
Cohesion: 0.19
Nodes (23): Puente 2.x -> 3.0.0 via sebasmd.com, Riesgo: carpeta de releases sin control de escritura, Carpeta de red de releases (296nas01 me-operacion-release), Convencion Major.Minor.Patch (version en tres lugares), version.json (autoridad final de release), GETTINGSTARTED - Primeros pasos, Plan 3.0.0 - Releases desde carpeta de red, Permisos de carpeta (solo lectura analistas) (+15 more)

### Community 23 - "detalleCdrHTML"
Cohesion: 0.19
Nodes (20): categoriaCdr(), celdaCategoriaCdr(), celdaUso(), colorCategoria(), construirTablaHistorico(), detalleCdrHTML(), direccionCdr(), filasHistoricoExport() (+12 more)

### Community 24 - "abrirDetalle"
Cohesion: 0.15
Nodes (19): abrirDetalle(), actualizarKPIs(), actualizarOcultas(), alternarOculta(), aplanarObjeto(), badgeEstado(), botonOcultarHTML(), celdaPeriodos() (+11 more)

### Community 25 - "pintarCrearSime"
Cohesion: 0.22
Nodes (19): actualizarPayload(), alElegirTipo(), avisoMsisdn(), canalDeNombre(), canalesVigentes(), catalogoAprendido(), catalogoPlu(), crearEnSime() (+11 more)

### Community 26 - "categoriaMov"
Cohesion: 0.24
Nodes (18): categoriaMov(), celdaCategoriaMov(), celdaVigenciaMov(), construirTablaMovimientos(), esCompraMov(), esCompraPlanMov(), esMesActual(), esPrimeraMov() (+10 more)

### Community 27 - "log"
Cohesion: 0.19
Nodes (18): bssBundleBalance(), bssBuscarLinea(), bssServiciosDeCuenta(), cambiarCuenta(), cargarCatalogoSime(), consultar(), worker(), consultarLinea() (+10 more)

### Community 28 - "cm-lineas.js"
Cohesion: 0.06
Nodes (44): cambiarEstado(), cambiarImsi(), cambiarMsisdn(), cuentaBase(), cuentaCrm(), direccionDe(), engancharLote(), engancharSesionCm() (+36 more)

### Community 29 - "genesis-api.js"
Cohesion: 0.07
Nodes (39): adivinarPagina(), aligerar(), buscarEnElDia(), cabeceraPaginacion(), cargarTodo(), descripcionErrorKc(), detalleDe(), diaDe() (+31 more)

### Community 30 - "CODEX.md - Contexto de continuidad"
Cohesion: 0.15
Nodes (25): CODEX.md - Contexto de continuidad, billingAccount externalID con coincidencia exacta, Orden ChangeOffer, Orden ChangeSim (cambio de IMSI), Orden ChangeSubscriptionState (bloquear/inactivar), Patron de ordenes CM: carrito -> orden -> seguimiento -> borrar carrito, window.CMLineas (cm-lineas.js), Copias deliberadas que pueden divergir (HLR Ambos/cruce, Claro/QDN) (+17 more)

### Community 31 - "Consumos y Paquetes (CM) - Doc tecnica"
Cohesion: 0.17
Nodes (15): Flujo de resolucion de titular (MSISDN -> billingAccount -> individual), Herramienta Ajustes/Paquetes, Herramienta Rechazos, Ajustes y paquetes (CM) - Doc tecnica, Montos multiplicados por 10.000, Catalogos de codigos editables (cmMaps), resolveAll - numero por cuenta, GET /subscription/adjustment (bundleAdjustment) (+7 more)

### Community 32 - "me-api.js"
Cohesion: 0.30
Nodes (12): api(), cabeceras(), ensure(), getJson(), _guardar(), imsi(), leerCampos(), _login() (+4 more)

### Community 33 - "cargarHistorico"
Cohesion: 0.22
Nodes (13): abrirDetalle(), cargarHistorico(), cmHistoricoConsumo(), cmMovimientos(), isoLocalSinZ(), marcarVigentes(), normalizarLocalISO(), paginarHistorico() (+5 more)

### Community 34 - "logica-cambio-imsi.js"
Cohesion: 0.20
Nodes (6): CABECERA, CONFIG, consultarFila(), marcarRepetidos(), noAplica(), PROCESO

### Community 35 - "Cierre masivo de casos (CM) - Doc tecnica"
Cohesion: 0.21
Nodes (12): CM/Optiva OBP API Gateway, Keycloak Optiva (realm/client optiva), Arquitectura de tres capas (HTML marcado / logica-*.js / me-*-puente.js), Herramienta Casos masivos, Cierre masivo de casos (CM) - Doc tecnica, accionDe(fila) - regla columna Favorable, Renovacion de token segura ante concurrencia, ESTADOS_CERRADOS (+4 more)

### Community 36 - "Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica"
Cohesion: 0.24
Nodes (12): SIME API (token prf), SIME Web (NTLM -> prf), Herramienta Prepagadas, Clasificacion de movimientos (1.a compra/paquete/recurrencia), Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica, GetCanalTipo (catalogo en vivo de planes SIME), Movimientos BSS / categoriaTx, Plan como campo maestro del alta (+4 more)

### Community 37 - "me-operacion README (catalogo)"
Cohesion: 0.13
Nodes (18): Herramienta Tipificacion, Aplicar PLU de paquete docs, consola_bundles_movil_exito (Python console), Interface guard user allowlist (not access control), Cambio de IMSI docs, Consulta QDN Tigo docs, RETCODE states (3001 inconclusive alone), Estado de lineas docs (+10 more)

### Community 38 - "construirDataTable"
Cohesion: 0.24
Nodes (11): celdaEstado(), celdaIdentificacion(), celdaUsoCategoria(), construirDataTable(), estadoTabla(), filaPasaFiltros(), filasExport(), filasParaExportar() (+3 more)

### Community 39 - "resumirTx"
Cohesion: 0.40
Nodes (11): bssTransacciones(), categoriaTx(), esCicloTx(), esCompraPlanTx(), esCompraTx(), esPrimeraTx(), esRecurTx(), montoTx() (+3 more)

### Community 40 - "logica-estado-lineas.js"
Cohesion: 0.25
Nodes (5): CABECERA, cambiarFila(), CONFIG, consultarFila(), PROCESO

### Community 41 - "actualizarPayloadRec"
Cohesion: 0.24
Nodes (10): abrirEditarRec(), actualizarPayloadRec(), cargarRecurrencias(), dtLocal(), estadoRecTexto(), payloadRec(), pintarRecFijos(), pintarRecurrencias() (+2 more)

### Community 42 - "headersSime"
Cohesion: 0.24
Nodes (10): adicional(), b64(), guardarRec(), headersSime(), refrescarSuscripcion(), simeCatalogo(), simeEditarRecurrencia(), simeGetSuscripcion() (+2 more)

### Community 43 - "me-hlr-hss-puente.js"
Cohesion: 0.27
Nodes (5): conectarCm(), engancharComun(), engancharSesionCm(), montar(), Puente pattern (bridge between tool logic and MEUI shell)

### Community 44 - "logica-titularidad.js"
Cohesion: 0.07
Nodes (29): CABECERA, cambiarVistaPayload(), CLASE_ESTADO_CM, CLASE_UBICACION, COL_FECHA, COLUMNAS, CONFIG, filaDesdeGenesis() (+21 more)

### Community 45 - "inicializarConsumos"
Cohesion: 0.31
Nodes (9): actualizarFiltros(), actualizarKPIs(), alternarKpi(), cabeceraHistorico(), cabeceraMovimientos(), inicializarConsumos(), limpiarFiltros(), pintarFiltro() (+1 more)

### Community 46 - "enriquecer"
Cohesion: 0.31
Nodes (9): calcularCiclos(), calcularPeriodos(), enriquecer(), etiquetaMes(), generarComentarios(), mesIdxDeFecha(), soloFecha(), totalPeriodosDePlan() (+1 more)

### Community 47 - "lanzador.ps1"
Cohesion: 0.28
Nodes (3): Leer-Credencial(), Nota(), Ok()

### Community 48 - "Validador Portabilidad Tigo Doc"
Cohesion: 0.40
Nodes (4): Validador Portabilidad Tigo Doc, CheckPortabilidad.html (reemplazado), estadoCM() estado ME en Optiva, validador_portabilidad_tigo.html (Validador Portabilidad · HLR Tigo)

### Community 49 - "logica-prefactura.js"
Cohesion: 0.14
Nodes (21): archivosFiliales(), calcular(), calcularDesdeBruto(), escribirEnCarpeta(), evaluarObservacion(), fechaEvento(), hoja(), indiceTarifas() (+13 more)

### Community 50 - "usoHTML"
Cohesion: 0.38
Nodes (7): fmtBytes(), fmtCantidad(), fmtFechaHora(), fmtVoz(), nfmt(), nivelUso(), usoHTML()

### Community 51 - "me-prefactura-puente.js"
Cohesion: 0.15
Nodes (13): badge(), celdaPaso(), esc(), cargosEscritos(), corte(), pintar(), pintarCorte(), pintarDestino() (+5 more)

### Community 52 - "me-estado-lineas-puente.js"
Cohesion: 0.24
Nodes (7): actualizar(), pintarAccion(), actualizar(), desarmar(), pintarAccion(), cambio_imsi.html (Cambio de IMSI), estado_lineas.html (Estado de líneas)

### Community 54 - "configurarArchivo"
Cohesion: 0.70
Nodes (5): configurarArchivo(), extraerColumna(), limpiar(), pintarColumnas(), procesar()

### Community 55 - "fmtFechaHora"
Cohesion: 0.50
Nodes (5): escHtml(), fmtFechaHora(), nivelUso(), pintarCabeceraModal(), usoHTML()

### Community 56 - "render"
Cohesion: 0.13
Nodes (20): actualizarResumenSeleccion(), alternarOculta(), aplicarSeleccion(), construirTabla(), cuerpoScroll(), desmarcarTodo(), dibujar(), fijarFiltro() (+12 more)

### Community 59 - "4. Reglas"
Cohesion: 0.11
Nodes (18): 1. Objetivos, 2. Arquitectura y archivos, 3. Herramientas de terceros, 4. Reglas, 5. El proceso en Excel que reemplaza (reunión «Prefactura»), 6. Funcionalidad, 7. Riesgos y límites, 8. Historial de cambios (+10 more)

### Community 60 - "cargarGenesis"
Cohesion: 0.13
Nodes (18): actualizarAvisoRango(), actualizarKpis(), cargarGenesis(), infoRango(), inicializarTitularidad(), intervaloPintado(), llenarOperadores(), notaDeCarga() (+10 more)

### Community 65 - "hlr-consulta.js"
Cohesion: 0.24
Nodes (15): claroNoConsultado(), concluirUbicacion(), consultarClaro(), consultarClaroUnaVez(), consultarLinea(), consultarTigo(), consultarTigoUnaVez(), consultarVarias() (+7 more)

### Community 66 - "5 · Cómo entra el analista, en la práctica"
Cohesion: 0.12
Nodes (15): 1 · El flujo real, paso a paso, 2.1 · No hay «usuario y contraseña de Genesis», 2.2 · El 2FA hace imposible el camino «usuario + contraseña + 2FA» dentro de la herramienta, 2.3 · El `refresh_token` no sirve para durar más de una hora, 2.4 · El intercambio del código no necesita secreto, 2 · Las cuatro consecuencias que importan, 3 · Datos de la captura, para no volver a buscarlos, 5 · Cómo entra el analista, en la práctica (+7 more)

### Community 67 - "logica-cambio-msisdn.js"
Cohesion: 0.17
Nodes (9): CABECERA, CONFIG, consultarFila(), esMovil(), leerEntrada(), marcarRepetidos(), noAplica(), normalizarLinea() (+1 more)

### Community 68 - "consultarCm"
Cohesion: 0.24
Nodes (8): aplicarACadaFila(), consultarCm(), consultarHlr(), ejecutarPool(), lineasSeleccionadas(), progreso(), seleccionadas(), usarToken()

### Community 69 - "tulio-plu.js"
Cohesion: 0.29
Nodes (8): aplicarPlu(), motivoSinPlu(), obtener(), payloadRecarga(), puedeAgregarPlu(), recargaUnaVez(), reset(), solicitar()

### Community 70 - "tomarTokenGenesis"
Cohesion: 0.33
Nodes (7): tomarTokenGenesis(), b64url(), buscarEn(), claimsSiSirve(), enAlmacen(), mostrar(), uriFavorito()

### Community 71 - "ordenadas"
Cohesion: 0.29
Nodes (8): exportables(), filaExport(), filasExport(), filasParaExportar(), fuenteDatos(), invalidarVistas(), ordenadas(), Tabla · por qué la tabla no tiene los datos

### Community 72 - "visibles"
Cohesion: 0.33
Nodes (7): autoMapear(), filaPasaFiltros(), normaliza(), ocultarMarcadas(), ocultarNoMarcadas(), recontarOcultas(), visibles()

### Community 73 - "Convertir audio a MP3 - Doc tecnica"
Cohesion: 0.29
Nodes (7): Regla: no inventar datos, Herramienta Audio a MP3, Convertir audio a MP3 - Doc tecnica, lamejs (codificador MP3), Procesamiento local sin servidores, Convencion de nombres mp3-*.mp3, Web Audio API (decodificacion)

## Ambiguous Edges - Review These
- `Regla: no inventar datos` → `Procesamiento local sin servidores`  [AMBIGUOUS]
  doc/audio-mp3/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **277 isolated node(s):** `DEFAULT_MAPS`, `MAPS`, `fmtCOP`, `fmtUnit`, `msisdnCache` (+272 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 386 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Regla: no inventar datos` and `Procesamiento local sin servidores`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `HLR/HSS · Claro y Tigo (page, v2.4)` connect `HLR/HSS · Claro y Tigo (page, v2.4)` to `logica-hlr-hss-claro.js`, `me-api.js`, `me-operacion README (catalogo)`, `me-ui.js`, `logica-hlr-cruzado.js`, `logica-hlr-hss-ambos.js`, `logica-hlr-hss-tigo.js`, `me-hlr-hss-puente.js`, `Validador Portabilidad Tigo Doc`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `Prepagadas · SIME ⇄ CM (page, v9.4.0)` connect `HLR/HSS · Claro y Tigo (page, v2.4)` to `me-api.js`, `Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica`, `me-ui.js`, `logica-prepagadas.js`, `me-hlr-hss-puente.js`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `Consumos y Paquetes · CM (page, v1.8.1)` connect `HLR/HSS · Claro y Tigo (page, v2.4)` to `me-api.js`, `me-ui.js`, `me-hlr-hss-puente.js`, `logica-consumos.js`, `logica-paquetes-carga.js`, `Consumos y Paquetes (CM) - Doc tecnica`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `me-operacion README (catalogo)` (e.g. with `Herramienta Ajustes/Paquetes` and `Herramienta Audio a MP3`) actually correct?**
  _`me-operacion README (catalogo)` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_MAPS`, `MAPS`, `fmtCOP` to the rest of the system?**
  _277 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `logica-hlr-hss-claro.js` be split into smaller, more focused modules?**
  _Cohesion score 0.051589567865981345 - nodes in this community are weakly interconnected._