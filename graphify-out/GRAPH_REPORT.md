# Graph Report - me-operacion  (2026-09-30)

## Corpus Check
- 25 files · ~225,456 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1494 nodes · 3218 edges · 65 communities (56 shown, 9 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 281 edges (avg confidence: 0.86)
- Token cost: 186,698 input · 0 output

## Community Hubs (Navigation)
- HLR/HSS Claro
- Cierre masivo de casos
- Aplicar PLU (lógica)
- Validador QDN Claro
- Operaciones QDN Claro
- Archivo de rechazo
- Portabilidad Tigo
- Shell me-ui
- Validador QDN Tigo
- Prepagadas núcleo
- HLR cruzado
- HLR/HSS ambos operadores
- HLR/HSS Tigo
- Consumos núcleo
- Ajustes y paquetes
- Puente de rechazo
- Tipificación
- Carga de paquetes CM
- Inicio y descargas
- Aplicar PLU (puente)
- Audio a MP3
- Páginas y shell común
- Releases 3.0.0 carpeta de red
- Histórico CDR
- Tabla de prepagadas
- Alta en SIME (plan)
- Movimientos de consumo
- Consulta BSS y catálogo SIME
- Líneas CM compartido
- Docs HLR cruzado y Tigo
- Contexto CODEX
- Reglas y herramientas
- Cliente API CM
- Carga de histórico
- Cambio de IMSI (lógica)
- Arquitectura y casos
- SIME y prepagadas docs
- Docs consumos y tipificación
- Tabla de consumos
- Transacciones BSS
- Estado de líneas (lógica)
- Recurrencias SIME
- Cabeceras y edición SIME
- Puentes con sesión CM
- Docs Aplicar PLU
- KPIs de consumos
- Ciclos y comentarios
- Lanzador PowerShell
- Docs portabilidad Tigo
- Órdenes del CM
- Formatos de uso
- Tabla seleccionable
- Puente estado de líneas
- Columna de archivo
- Modal de uso
- Puente cambio de IMSI
- Puente de ajustes
- Puente de casos
- Puente de tipificación
- Sesión CM de líneas
- Captura HAR de recarga
- Catálogo selectableProducts
- Perfil del suscriptor

## God Nodes (most connected - your core abstractions)
1. `CODEX.md - Contexto de continuidad` - 39 edges
2. `Base compartida y lanzador - Doc tecnica` - 31 edges
3. `me-operacion README (catalogo)` - 24 edges
4. `HLR/HSS · Claro y Tigo (page, v2.4)` - 18 edges
5. `log()` - 18 edges
6. `abrirConfirmacion()` - 17 edges
7. `pintarCrearSime()` - 17 edges
8. `abrirDetalle()` - 17 edges
9. `abrirConfirmacion()` - 16 edges
10. `inicializarConsumos()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `me-operacion README (catalogo)` --references--> `Herramienta Cambio de IMSI`  [INFERRED]
  doc/README.md → CODEX.md
- `me-operacion README (catalogo)` --references--> `Herramienta Casos masivos`  [INFERRED]
  doc/README.md → CODEX.md
- `me-operacion README (catalogo)` --references--> `Herramienta Consumos`  [INFERRED]
  doc/README.md → CODEX.md
- `me-operacion README (catalogo)` --references--> `Herramienta Estado de lineas`  [INFERRED]
  doc/README.md → CODEX.md
- `me-operacion README (catalogo)` --references--> `Herramienta HLR/HSS`  [INFERRED]
  doc/README.md → CODEX.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Pages built on shared CM line lookup (cm-lineas.js + me-api.js)** — herramientas_cambio_imsi, herramientas_estado_lineas, assets_cm_lineas, assets_me_api [EXTRACTED 1.00]
- **Exact billingAccount resolution shared across tools** — assets_logica_plu, assets_logica_consumos, assets_logica_rechazo, doc_aplicar_plu_readme_exact_billing_account [EXTRACTED 1.00]
- **Flujo de carga de paquete en el CM** — assets_logica_paquetes_carga, assets_logica_consumos, doc_reporte_ajustes_recarga_de_paquetes_cm_subscriberprofile, doc_reporte_ajustes_recarga_de_paquetes_cm_selectableproducts, doc_reporte_ajustes_recarga_de_paquetes_cm_flujo_carrito_orden [EXTRACTED 1.00]
- **Motores fusionados en HLR/HSS** — assets_me_hlr_hss_puente, assets_logica_hlr_hss_tigo, assets_logica_hlr_hss_claro, assets_logica_hlr_hss_ambos, assets_logica_qdn, assets_logica_qdn_operaciones, assets_logica_hlr_cruzado, assets_logica_qdn_tigo [EXTRACTED 1.00]
- **CM cart + productOrder write flows** — doc_aplicar_plu_readme_changeoffer_order, doc_cambio_imsi_readme_changesim_order, doc_estado_lineas_readme_changesubscriptionstate [INFERRED 0.85]
- **Escrituras al CM con patron carrito-orden-seguimiento** — codex_cm_order_pattern, codex_changeoffer_order, codex_changesubscriptionstate_order, codex_changesim_order, codex_mepaq, codex_cmlineas, doc_reporte_consumos_readme_cargar_paquete [EXTRACTED 1.00]
- **Pipeline de releases por carpeta de red** — doc_lanzador_readme_empaquetar_release, codex_version_json, codex_release_network_folder, doc_lanzador_readme_dame_click_launcher, doc_lanzador_readme_actualizar, doc_lanzador_readme_sha256_verification, doc_lanzador_plan_3_0_0_publish_order_zip_then_json [INFERRED 0.85]
- **Copias alineadas de resolucion de titular** — codex_titular_resolution_flow, codex_tool_consumos, codex_tool_rechazo, codex_tool_ajustes, doc_reporte_consumos_readme_titulardecuenta, codex_billingaccount_exact_match [EXTRACTED 1.00]
- **Tool bridge (puente) modules connecting logic to MEUI shell** — assets_me_hlr_hss_puente, assets_me_consumos_puente, assets_me_prepagadas_puente, assets_me_qdn_puente, assets_me_ui [INFERRED 0.85]
- **Guarded production-write operations** — herramientas_reporte_consumos_cargar_paquete, herramientas_validador_qdn_operaciones, herramientas_hlr_hss_aprovisionamiento [INFERRED 0.75]
- **HLR/HSS tabbed tool** — herramientas_hlr_hss_pestana_tigo, herramientas_hlr_hss_pestana_claro, herramientas_hlr_hss_pestana_ambos [EXTRACTED 1.00]

## Communities (65 total, 9 thin omitted)

### Community 0 - "HLR/HSS Claro"
Cohesion: 0.05
Nodes (101): abrirConfirmacion(), abrirDetalle(), actualizarConteoMasivo(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), anotarBitacora() (+93 more)

### Community 1 - "Cierre masivo de casos"
Cohesion: 0.05
Nodes (75): abrirDetalle(), accionDe(), actualizarBotones(), actualizarContadores(), apiFetch(), asegurarCaracteristicas(), autoMapear(), baseTitulo() (+67 more)

### Community 2 - "Aplicar PLU (lógica)"
Cohesion: 0.05
Nodes (73): apiCm(), aplicarPlu(), barraEtapasHTML(), barraSecuenciaHTML(), bolsillosPlegablesHTML(), CABECERA_BITACORA, CABECERA_EXPORT, CABECERA_SECUENCIA (+65 more)

### Community 3 - "Validador QDN Claro"
Cohesion: 0.06
Nodes (64): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_QDN, BSVOZ_TELEFONIA, buscarCaracteristica() (+56 more)

### Community 4 - "Operaciones QDN Claro"
Cohesion: 0.08
Nodes (62): abrirConfirmacion(), actualizarConteoMasivo(), anotarBitacora(), bitacoraExport(), bitacoraOperaciones, BLOQUEO_A_PROCESO, botonOperacionHTML(), CABECERA_BITACORA (+54 more)

### Community 5 - "Archivo de rechazo"
Cohesion: 0.06
Nodes (54): aInputFechaHora(), altoUtil(), AMARILLO, API(), barra(), bloqueImagen(), buscarBillingAccount(), CAMPOS_CIERRE (+46 more)

### Community 6 - "Portabilidad Tigo"
Cohesion: 0.07
Nodes (55): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+47 more)

### Community 7 - "Shell me-ui"
Cohesion: 0.08
Nodes (47): abrirDoc(), abrirPaso(), ajustarTabla(), ajustarTablas(), aplicarAperturaPasos(), autoSpinner(), caida(), cajasLog() (+39 more)

### Community 8 - "Validador QDN Tigo"
Cohesion: 0.07
Nodes (53): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+45 more)

### Community 9 - "Prepagadas núcleo"
Cohesion: 0.06
Nodes (46): actualizarEtiquetasFiltro(), ALIAS_COLUMNA, BADGE_LINEA, bssCliente(), buscarBillingAccount(), cacheRecurrencias, cacheServicios, CANALES_FIJOS (+38 more)

### Community 10 - "HLR cruzado"
Cohesion: 0.08
Nodes (46): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_CLARO, AMBIENTE_TIGO, CABECERA_EXPORT (+38 more)

### Community 11 - "HLR/HSS ambos operadores"
Cohesion: 0.11
Nodes (39): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), celdaCarrier(), celdaUbicacion(), concluirUbicacion() (+31 more)

### Community 12 - "HLR/HSS Tigo"
Cohesion: 0.11
Nodes (38): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), buscarSeccion(), calcularBloqueos(), celdaEstado() (+30 more)

### Community 13 - "Consumos núcleo"
Cohesion: 0.08
Nodes (37): actualizarProgreso(), buscarBillingAccount(), CABECERA_EXPORT, CALLTYPE_CATEGORIA, cambiarCuenta(), candidatosExternalID(), CAT_ORDEN, CLASE_CATEGORIA_CDR (+29 more)

### Community 14 - "Ajustes y paquetes"
Cohesion: 0.10
Nodes (32): accountFromSub(), activity(), actualizarResumen(), apiGet(), approvalDate(), approvedFlag(), BUNDLE_COLS, buscarCuenta() (+24 more)

### Community 15 - "Puente de rechazo"
Cohesion: 0.17
Nodes (31): alCambiarCampo(), aplicarPersonaJuridica(), aplicarReglaNit(), arrancarReloj(), arrancarSesion(), campoPorId(), camposDe(), cargarImagenes() (+23 more)

### Community 16 - "Tipificación"
Cohesion: 0.13
Nodes (24): actualizarProgreso(), buildQuery(), COLS_FRONT, contarCasos(), descargarPaginas(), descargarPaginasEspecificas(), descargarRangoFechas(), dividir() (+16 more)

### Community 17 - "Carga de paquetes CM"
Cohesion: 0.18
Nodes (27): abrirPanel(), alternar(), cablear(), catalogoDeOferta(), cerrarPanel(), cuerpoCarrito(), cuerpoOrden(), ejecutar() (+19 more)

### Community 18 - "Inicio y descargas"
Cohesion: 0.14
Nodes (26): abrirDoc(), archivosDe(), armarZip(), BASE, cargarCodigoVisible(), crc32(), descargarPaquete(), descargarUno() (+18 more)

### Community 19 - "Aplicar PLU (puente)"
Cohesion: 0.12
Nodes (22): esEliminable(), abrirDetalle(), agregarFila(), celdaEstado(), conectar(), construirTabla(), eliminarDeLinea(), errorDeFila() (+14 more)

### Community 20 - "Audio a MP3"
Cohesion: 0.17
Nodes (24): agregar(), canalEntero16(), codificarMp3(), convertir(), convertirPendientes(), descargar(), descargarBlob(), descargarTodo() (+16 more)

### Community 21 - "Páginas y shell común"
Cohesion: 0.12
Nodes (24): me-ui.css, MEUI.init(), Common ME tool layout (KPI cards as filters, steps column, log, DataTable, detail modal, CSV/XLSX/JSON export), CM session, QDN OAuth2 session, SIME token session, aplicar_plu.html (Aplicar PLU de paquete), HLR/HSS · Claro y Tigo (page, v2.4) (+16 more)

### Community 22 - "Releases 3.0.0 carpeta de red"
Cohesion: 0.19
Nodes (23): Puente 2.x -> 3.0.0 via sebasmd.com, Riesgo: carpeta de releases sin control de escritura, Carpeta de red de releases (296nas01 me-operacion-release), Convencion Major.Minor.Patch (version en tres lugares), version.json (autoridad final de release), GETTINGSTARTED - Primeros pasos, Plan 3.0.0 - Releases desde carpeta de red, Permisos de carpeta (solo lectura analistas) (+15 more)

### Community 23 - "Histórico CDR"
Cohesion: 0.19
Nodes (20): categoriaCdr(), celdaCategoriaCdr(), celdaUso(), colorCategoria(), construirTablaHistorico(), detalleCdrHTML(), direccionCdr(), filasHistoricoExport() (+12 more)

### Community 24 - "Tabla de prepagadas"
Cohesion: 0.15
Nodes (19): abrirDetalle(), actualizarKPIs(), actualizarOcultas(), alternarOculta(), aplanarObjeto(), badgeEstado(), botonOcultarHTML(), celdaPeriodos() (+11 more)

### Community 25 - "Alta en SIME (plan)"
Cohesion: 0.22
Nodes (19): actualizarPayload(), alElegirTipo(), avisoMsisdn(), canalDeNombre(), canalesVigentes(), catalogoAprendido(), catalogoPlu(), crearEnSime() (+11 more)

### Community 26 - "Movimientos de consumo"
Cohesion: 0.24
Nodes (18): categoriaMov(), celdaCategoriaMov(), celdaVigenciaMov(), construirTablaMovimientos(), esCompraMov(), esCompraPlanMov(), esMesActual(), esPrimeraMov() (+10 more)

### Community 27 - "Consulta BSS y catálogo SIME"
Cohesion: 0.19
Nodes (18): bssBundleBalance(), bssBuscarLinea(), bssServiciosDeCuenta(), cambiarCuenta(), cargarCatalogoSime(), consultar(), worker(), consultarLinea() (+10 more)

### Community 28 - "Líneas CM compartido"
Cohesion: 0.21
Nodes (11): cambiarEstado(), cambiarImsi(), cuentaBase(), cuentaCrm(), direccionDe(), esperarOrden(), resolverLinea(), textoError() (+3 more)

### Community 29 - "Docs HLR cruzado y Tigo"
Cohesion: 0.14
Nodes (16): HLR Cruzado Claro-Tigo Doc, Consulta paralela Promise.all por linea, HLR Tigo autogestion (X-Api-Key), RETCODE Tigo (0 Activa, 3001 Sin perfil, 1033 Residuo), HLR/HSS Claro y Tigo Doc, Fusion de tres herramientas en pestanas, Envoltorio IIFE por motor, Guardas: solo precio 0, una linea, sin reintento de orden (+8 more)

### Community 30 - "Contexto CODEX"
Cohesion: 0.23
Nodes (17): CODEX.md - Contexto de continuidad, billingAccount externalID con coincidencia exacta, window.CMLineas (cm-lineas.js), Copias deliberadas que pueden divergir (HLR Ambos/cruce, Claro/QDN), HLR Tigo (consulta), Patron IIFE con un solo objeto global, window.MEPAQ (logica-paquetes-carga.js), Riesgo: repositorio publico con secretos embebidos (+9 more)

### Community 31 - "Reglas y herramientas"
Cohesion: 0.15
Nodes (17): Regla: no inventar datos, Flujo de resolucion de titular (MSISDN -> billingAccount -> individual), Herramienta Ajustes/Paquetes, Herramienta Audio a MP3, Herramienta Rechazos, Convertir audio a MP3 - Doc tecnica, lamejs (codificador MP3), Procesamiento local sin servidores (+9 more)

### Community 32 - "Cliente API CM"
Cohesion: 0.26
Nodes (13): api(), cabeceras(), ensure(), getJson(), _guardar(), leerCampos(), _login(), reauth() (+5 more)

### Community 33 - "Carga de histórico"
Cohesion: 0.22
Nodes (13): abrirDetalle(), cargarHistorico(), cmHistoricoConsumo(), cmMovimientos(), isoLocalSinZ(), marcarVigentes(), normalizarLocalISO(), paginarHistorico() (+5 more)

### Community 34 - "Cambio de IMSI (lógica)"
Cohesion: 0.20
Nodes (6): CABECERA, CONFIG, consultarFila(), marcarRepetidos(), noAplica(), PROCESO

### Community 35 - "Arquitectura y casos"
Cohesion: 0.21
Nodes (12): CM/Optiva OBP API Gateway, Keycloak Optiva (realm/client optiva), Arquitectura de tres capas (HTML marcado / logica-*.js / me-*-puente.js), Herramienta Casos masivos, Cierre masivo de casos (CM) - Doc tecnica, accionDe(fila) - regla columna Favorable, Renovacion de token segura ante concurrencia, ESTADOS_CERRADOS (+4 more)

### Community 36 - "SIME y prepagadas docs"
Cohesion: 0.24
Nodes (12): SIME API (token prf), SIME Web (NTLM -> prf), Herramienta Prepagadas, Clasificacion de movimientos (1.a compra/paquete/recurrencia), Reporte Suscripciones Prepagadas (SIME-CM) - Doc tecnica, GetCanalTipo (catalogo en vivo de planes SIME), Movimientos BSS / categoriaTx, Plan como campo maestro del alta (+4 more)

### Community 37 - "Docs consumos y tipificación"
Cohesion: 0.21
Nodes (12): Herramienta Tipificacion, Consumos y Paquetes (CM) - Doc tecnica, Clasificacion CDR Datos/Voz/SMS y MO/MT, Reintentos y reduccion de tamano de pagina ante 500, paginarHistorico (paginador por llave y ventana de fechas), Deduplicacion de registros repetidos del API, Componente Uso y Balance (usoHTML duplicado), Exportar casos Tipificacion - Doc tecnica (+4 more)

### Community 38 - "Tabla de consumos"
Cohesion: 0.24
Nodes (11): celdaEstado(), celdaIdentificacion(), celdaUsoCategoria(), construirDataTable(), estadoTabla(), filaPasaFiltros(), filasExport(), filasParaExportar() (+3 more)

### Community 39 - "Transacciones BSS"
Cohesion: 0.40
Nodes (11): bssTransacciones(), categoriaTx(), esCicloTx(), esCompraPlanTx(), esCompraTx(), esPrimeraTx(), esRecurTx(), montoTx() (+3 more)

### Community 40 - "Estado de líneas (lógica)"
Cohesion: 0.22
Nodes (6): CABECERA, cambiarFila(), CONFIG, consultarFila(), PROCESO, Estado de lineas docs

### Community 41 - "Recurrencias SIME"
Cohesion: 0.24
Nodes (10): abrirEditarRec(), actualizarPayloadRec(), cargarRecurrencias(), dtLocal(), estadoRecTexto(), payloadRec(), pintarRecFijos(), pintarRecurrencias() (+2 more)

### Community 42 - "Cabeceras y edición SIME"
Cohesion: 0.24
Nodes (10): adicional(), b64(), guardarRec(), headersSime(), refrescarSuscripcion(), simeCatalogo(), simeEditarRecurrencia(), simeGetSuscripcion() (+2 more)

### Community 43 - "Puentes con sesión CM"
Cohesion: 0.27
Nodes (5): conectarCm(), engancharComun(), engancharSesionCm(), montar(), Puente pattern (bridge between tool logic and MEUI shell)

### Community 44 - "Docs Aplicar PLU"
Cohesion: 0.20
Nodes (10): CM ChangeOffer order (cart + productOrder) to delete bundles, CM stable fingerprint wait (bundleId:asignado), ERCRT1002 missing dependent product handling, NO_ELIMINABLES bundle list, PLU sequence (consultar, aplicar, evidencia, eliminar, verificar), Tulio RecargaPaquete, Cambio de IMSI docs, CM ChangeSim order (+2 more)

### Community 45 - "KPIs de consumos"
Cohesion: 0.31
Nodes (9): actualizarFiltros(), actualizarKPIs(), alternarKpi(), cabeceraHistorico(), cabeceraMovimientos(), inicializarConsumos(), limpiarFiltros(), pintarFiltro() (+1 more)

### Community 46 - "Ciclos y comentarios"
Cohesion: 0.31
Nodes (9): calcularCiclos(), calcularPeriodos(), enriquecer(), etiquetaMes(), generarComentarios(), mesIdxDeFecha(), soloFecha(), totalPeriodosDePlan() (+1 more)

### Community 47 - "Lanzador PowerShell"
Cohesion: 0.28
Nodes (3): Leer-Credencial(), Nota(), Ok()

### Community 48 - "Docs portabilidad Tigo"
Cohesion: 0.29
Nodes (6): Regla de conclusion Claro vs Tigo, Validador Portabilidad Tigo Doc, El 3001 no prueba que el numero sea de ME, CheckPortabilidad.html (reemplazado), estadoCM() estado ME en Optiva, validador_portabilidad_tigo.html (Validador Portabilidad · HLR Tigo)

### Community 49 - "Órdenes del CM"
Cohesion: 0.32
Nodes (8): Orden ChangeOffer, Orden ChangeSim (cambio de IMSI), Orden ChangeSubscriptionState (bloquear/inactivar), Patron de ordenes CM: carrito -> orden -> seguimiento -> borrar carrito, IMSI en estado HELD tras inactivar, Cabecera Transaction-Id DCRM-TRX, recarga-de-paquetes-cm.md (analisis flujo agregar paquetes), Cargar paquete (unica escritura de Consumos)

### Community 50 - "Formatos de uso"
Cohesion: 0.38
Nodes (7): fmtBytes(), fmtCantidad(), fmtFechaHora(), fmtVoz(), nfmt(), nivelUso(), usoHTML()

### Community 51 - "Tabla seleccionable"
Cohesion: 0.47
Nodes (5): engancharLote(), tablaSeleccionable(), redibujar(), sincronizarTodas(), visibles()

### Community 52 - "Puente estado de líneas"
Cohesion: 0.47
Nodes (3): actualizar(), desarmar(), pintarAccion()

### Community 54 - "Columna de archivo"
Cohesion: 0.70
Nodes (5): configurarArchivo(), extraerColumna(), limpiar(), pintarColumnas(), procesar()

### Community 55 - "Modal de uso"
Cohesion: 0.50
Nodes (5): escHtml(), fmtFechaHora(), nivelUso(), pintarCabeceraModal(), usoHTML()

### Community 56 - "Puente cambio de IMSI"
Cohesion: 0.50
Nodes (4): actualizar(), pintarAccion(), cambio_imsi.html (Cambio de IMSI), estado_lineas.html (Estado de líneas)

## Ambiguous Edges - Review These
- `Regla: no inventar datos` → `Procesamiento local sin servidores`  [AMBIGUOUS]
  doc/audio-mp3/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **207 isolated node(s):** `CAMPOS`, `CARACS_MINIMAS`, `COLS_RESULTADO`, `COLUMNAS`, `COLUMNAS_REP` (+202 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 289 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Regla: no inventar datos` and `Procesamiento local sin servidores`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Prepagadas · SIME ⇄ CM (page, v9.4.0)` connect `Páginas y shell común` to `Cliente API CM`, `SIME y prepagadas docs`, `Shell me-ui`, `Prepagadas núcleo`, `Puentes con sesión CM`?**
  _High betweenness centrality (0.215) - this node is a cross-community bridge._
- **Why does `HLR/HSS · Claro y Tigo (page, v2.4)` connect `Páginas y shell común` to `HLR/HSS Claro`, `Cliente API CM`, `Shell me-ui`, `HLR/HSS ambos operadores`, `HLR/HSS Tigo`, `Puentes con sesión CM`, `Docs portabilidad Tigo`, `Docs HLR cruzado y Tigo`?**
  _High betweenness centrality (0.180) - this node is a cross-community bridge._
- **Why does `Base compartida y lanzador - Doc tecnica` connect `Releases 3.0.0 carpeta de red` to `Cliente API CM`, `Arquitectura y casos`, `SIME y prepagadas docs`, `Docs consumos y tipificación`, `Validador QDN Tigo`, `Estado de líneas (lógica)`, `Docs Aplicar PLU`, `Docs portabilidad Tigo`, `Aplicar PLU (puente)`, `Docs HLR cruzado y Tigo`, `Contexto CODEX`, `Reglas y herramientas`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `me-operacion README (catalogo)` (e.g. with `Herramienta Ajustes/Paquetes` and `Herramienta Audio a MP3`) actually correct?**
  _`me-operacion README (catalogo)` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `HLR/HSS · Claro y Tigo (page, v2.4)` (e.g. with `Common ME tool layout (KPI cards as filters, steps column, log, DataTable, detail modal, CSV/XLSX/JSON export)` and `validador_hlr_cruzado.html (¿En qué HLR está?)`) actually correct?**
  _`HLR/HSS · Claro y Tigo (page, v2.4)` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CAMPOS`, `CARACS_MINIMAS`, `COLS_RESULTADO` to the rest of the system?**
  _207 weakly-connected nodes found - possible documentation gaps or missing edges._