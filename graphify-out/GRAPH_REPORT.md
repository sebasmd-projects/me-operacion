# Graph Report - me-operacion  (2026-09-30)

## Corpus Check
- 78 files · ~219,511 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 28 file(s) not represented in the graph (top: .zip 20, .bat 3, .har 3)

## Summary
- 1421 nodes · 3039 edges · 53 communities (50 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 238 edges (avg confidence: 0.85)
- Token cost: 193,441 input · 0 output

## Community Hubs (Navigation)
- HLR/HSS Claro
- Cierre masivo de casos
- Aplicar PLU (lógica)
- Operaciones QDN Claro
- Validador QDN Claro
- Archivo de rechazo
- HLR cruzado
- Portabilidad Tigo
- Shell me-ui
- Validador QDN Tigo
- HLR/HSS ambos operadores
- Carga de paquetes CM
- Prepagadas núcleo
- HLR/HSS Tigo
- Consumos núcleo
- Ajustes y paquetes
- Tipificación
- Puente de rechazo
- Audio a MP3
- Inicio y descargas
- Aplicar PLU (puente)
- Recargas SIME (edición)
- Contexto y servicios externos
- Histórico CDR
- Movimientos de consumo
- Cliente API CM
- Líneas CM compartido
- Tabla de prepagadas
- Consulta BSS prepagadas
- Docs consumos y prepagadas
- Carga de histórico
- Cambio de IMSI (lógica)
- Tabla de consumos
- Alta en SIME
- Transacciones BSS
- Estado de líneas (lógica)
- Ciclos y comentarios
- Lanzador PowerShell
- KPIs de consumos
- Docs de arquitectura
- Carga de archivo prepagadas
- Formatos de uso
- Docs de ajustes
- Tabla seleccionable
- Puente estado de líneas
- Docs portabilidad Tigo
- Sesión CM y cambio IMSI
- Columna de archivo
- Modal de uso
- Puente cambio de IMSI
- Puente de casos

## God Nodes (most connected - your core abstractions)
1. `Lanzador docs` - 27 edges
2. `log()` - 17 edges
3. `abrirDetalle()` - 17 edges
4. `abrirConfirmacion()` - 17 edges
5. `inicializarConsumos()` - 16 edges
6. `abrirConfirmacion()` - 16 edges
7. `render()` - 16 edges
8. `escHtml()` - 15 edges
9. `render()` - 14 edges
10. `iniciar()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `validador_qdn.html` --semantically_similar_to--> `validador_qdn_tigo.html (Consulta QDN · Tigo)`  [INFERRED] [semantically similar]
  doc/validador-qdn/README.md → herramientas/validador_qdn_tigo.html
- `Carga de paquetes (Consumos 1.8.0)` --semantically_similar_to--> `CM ChangeOffer order (cart + productOrder) to delete bundles`  [INFERRED] [semantically similar]
  CODEX.md → doc/aplicar-plu/README.md
- `Tulio RecargaPaquete` --semantically_similar_to--> `Carga de paquetes (Consumos 1.8.0)`  [INFERRED] [semantically similar]
  doc/aplicar-plu/README.md → CODEX.md
- `aplicar_plu.html (Aplicar PLU de paquete)` --semantically_similar_to--> `reporte_consumos.html`  [INFERRED] [semantically similar]
  herramientas/aplicar_plu.html → doc/reporte-consumos/README.md
- `Lanzador docs` --references--> `dame click.bat`  [EXTRACTED]
  CODEX.md → doc/lanzador/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CM cart + productOrder write flows** — doc_aplicar_plu_readme_changeoffer_order, doc_cambio_imsi_readme_changesim_order, doc_estado_lineas_readme_changesubscriptionstate, codex_paquetes_carga [INFERRED 0.85]
- **Exact billingAccount resolution shared across tools** — assets_logica_plu, assets_logica_consumos, assets_logica_rechazo, doc_aplicar_plu_readme_exact_billing_account [EXTRACTED 1.00]
- **Release publication and update pipeline** — codex_release_zip_sha256, codex_version_json_authority, doc_gettingstarted_actualizar, doc_gettingstarted_dame_click_launcher, codex_semver_convention [EXTRACTED 1.00]
- **Motores fusionados en HLR/HSS** — assets_me_hlr_hss_puente, assets_logica_hlr_hss_tigo, assets_logica_hlr_hss_claro, assets_logica_hlr_hss_ambos, assets_logica_qdn, assets_logica_qdn_operaciones, assets_logica_hlr_cruzado, assets_logica_qdn_tigo [EXTRACTED 1.00]
- **Flujo de carga de paquete en el CM** — assets_logica_paquetes_carga, assets_logica_consumos, doc_reporte_ajustes_recarga_de_paquetes_cm_subscriberprofile, doc_reporte_ajustes_recarga_de_paquetes_cm_selectableproducts, doc_reporte_ajustes_recarga_de_paquetes_cm_flujo_carrito_orden, doc_reporte_consumos_readme_bundlebalance [EXTRACTED 1.00]
- **Base compartida de la suite (shell, API, lanzador)** — assets_me_ui, assets_me_ui_css, assets_me_api, scripts_lanzador, doc_lanzador_readme_dame_click_bat [EXTRACTED 1.00]
- **Pages built on shared CM line lookup (cm-lineas.js + me-api.js)** — herramientas_cambio_imsi, herramientas_estado_lineas, assets_cm_lineas, assets_me_api [EXTRACTED 1.00]
- **Client-only tools that do not load me-api.js (local file processing)** — herramientas_validador_hlr_cruzado, herramientas_validador_qdn, herramientas_validador_qdn_tigo, herramientas_convertir_audio_mp3 [INFERRED 0.85]
- **HLR/HSS page combining Claro, Tigo and both-operator logic** — herramientas_hlr_hss, assets_logica_hlr_hss_claro, assets_logica_hlr_hss_tigo, assets_logica_hlr_hss_ambos, assets_me_hlr_hss_puente [EXTRACTED 1.00]

## Communities (53 total, 3 thin omitted)

### Community 0 - "HLR/HSS Claro"
Cohesion: 0.05
Nodes (101): abrirConfirmacion(), abrirDetalle(), actualizarConteoMasivo(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), anotarBitacora() (+93 more)

### Community 1 - "Cierre masivo de casos"
Cohesion: 0.05
Nodes (77): abrirDetalle(), accionDe(), actualizarBotones(), actualizarContadores(), apiFetch(), asegurarCaracteristicas(), autoMapear(), baseTitulo() (+69 more)

### Community 2 - "Aplicar PLU (lógica)"
Cohesion: 0.05
Nodes (73): apiCm(), aplicarPlu(), barraEtapasHTML(), barraSecuenciaHTML(), bolsillosPlegablesHTML(), CABECERA_BITACORA, CABECERA_EXPORT, CABECERA_SECUENCIA (+65 more)

### Community 3 - "Operaciones QDN Claro"
Cohesion: 0.07
Nodes (67): abrirConfirmacion(), actualizarConteoMasivo(), anotarBitacora(), bitacoraExport(), bitacoraOperaciones, BLOQUEO_A_PROCESO, botonOperacionHTML(), CABECERA_BITACORA (+59 more)

### Community 4 - "Validador QDN Claro"
Cohesion: 0.06
Nodes (64): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_QDN, BSVOZ_TELEFONIA, buscarCaracteristica() (+56 more)

### Community 5 - "Archivo de rechazo"
Cohesion: 0.06
Nodes (53): aInputFechaHora(), altoUtil(), AMARILLO, API(), barra(), bloqueImagen(), buscarBillingAccount(), CAMPOS_CIERRE (+45 more)

### Community 6 - "HLR cruzado"
Cohesion: 0.06
Nodes (55): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_CLARO, AMBIENTE_TIGO, CABECERA_EXPORT (+47 more)

### Community 7 - "Portabilidad Tigo"
Cohesion: 0.07
Nodes (55): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+47 more)

### Community 8 - "Shell me-ui"
Cohesion: 0.08
Nodes (47): abrirDoc(), abrirPaso(), ajustarTabla(), ajustarTablas(), aplicarAperturaPasos(), autoSpinner(), caida(), cajasLog() (+39 more)

### Community 9 - "Validador QDN Tigo"
Cohesion: 0.07
Nodes (52): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), AMBIENTE_TIGO, buscarSeccion(), CABECERA_EXPORT (+44 more)

### Community 10 - "HLR/HSS ambos operadores"
Cohesion: 0.08
Nodes (47): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), celdaCarrier(), celdaUbicacion(), concluirUbicacion() (+39 more)

### Community 11 - "Carga de paquetes CM"
Cohesion: 0.10
Nodes (40): abrirPanel(), alternar(), cablear(), catalogoDeOferta(), cerrarPanel(), cuerpoCarrito(), cuerpoOrden(), ejecutar() (+32 more)

### Community 12 - "Prepagadas núcleo"
Cohesion: 0.06
Nodes (39): actualizarEtiquetasFiltro(), ALIAS_COLUMNA, BADGE_LINEA, bssCliente(), cacheRecurrencias, cacheServicios, CANALES, candidatosExternalID() (+31 more)

### Community 13 - "HLR/HSS Tigo"
Cohesion: 0.11
Nodes (38): abrirDetalle(), actualizarFiltros(), actualizarKPIs(), actualizarProgreso(), alternarKpi(), buscarSeccion(), calcularBloqueos(), celdaEstado() (+30 more)

### Community 14 - "Consumos núcleo"
Cohesion: 0.08
Nodes (37): actualizarProgreso(), buscarBillingAccount(), CABECERA_EXPORT, CALLTYPE_CATEGORIA, cambiarCuenta(), candidatosExternalID(), CAT_ORDEN, CLASE_CATEGORIA_CDR (+29 more)

### Community 15 - "Ajustes y paquetes"
Cohesion: 0.10
Nodes (32): accountFromSub(), activity(), actualizarResumen(), apiGet(), approvalDate(), approvedFlag(), BUNDLE_COLS, buscarCuenta() (+24 more)

### Community 16 - "Tipificación"
Cohesion: 0.11
Nodes (28): actualizarProgreso(), buildQuery(), COLS_FRONT, contarCasos(), descargarPaginas(), descargarPaginasEspecificas(), descargarRangoFechas(), dividir() (+20 more)

### Community 17 - "Puente de rechazo"
Cohesion: 0.17
Nodes (31): alCambiarCampo(), aplicarPersonaJuridica(), aplicarReglaNit(), arrancarReloj(), arrancarSesion(), campoPorId(), camposDe(), cargarImagenes() (+23 more)

### Community 18 - "Audio a MP3"
Cohesion: 0.14
Nodes (27): agregar(), canalEntero16(), codificarMp3(), convertir(), convertirPendientes(), descargar(), descargarBlob(), descargarTodo() (+19 more)

### Community 19 - "Inicio y descargas"
Cohesion: 0.14
Nodes (26): abrirDoc(), archivosDe(), armarZip(), BASE, cargarCodigoVisible(), crc32(), descargarPaquete(), descargarUno() (+18 more)

### Community 20 - "Aplicar PLU (puente)"
Cohesion: 0.12
Nodes (22): esEliminable(), abrirDetalle(), agregarFila(), celdaEstado(), conectar(), construirTabla(), eliminarDeLinea(), errorDeFila() (+14 more)

### Community 21 - "Recargas SIME (edición)"
Cohesion: 0.16
Nodes (23): abrirEditarRec(), actualizarPayload(), actualizarPayloadRec(), alElegirTipo(), avisoMsisdn(), canalDeNombre(), cargarRecurrencias(), catalogoAprendido() (+15 more)

### Community 22 - "Contexto y servicios externos"
Cohesion: 0.12
Nodes (22): CODEX.md continuity context, HLR Tigo consulta service, Keycloak Optiva (realm/client optiva), No inventar datos principle, QDN Claro ValideQDN service, Release ZIP + SHA-256 publication, Major.Minor.Patch versioning convention, SIME Web (+14 more)

### Community 23 - "Histórico CDR"
Cohesion: 0.19
Nodes (20): categoriaCdr(), celdaCategoriaCdr(), celdaUso(), colorCategoria(), construirTablaHistorico(), detalleCdrHTML(), direccionCdr(), filasHistoricoExport() (+12 more)

### Community 24 - "Movimientos de consumo"
Cohesion: 0.24
Nodes (18): categoriaMov(), celdaCategoriaMov(), celdaVigenciaMov(), construirTablaMovimientos(), esCompraMov(), esCompraPlanMov(), esMesActual(), esPrimeraMov() (+10 more)

### Community 25 - "Cliente API CM"
Cohesion: 0.22
Nodes (15): api(), cabeceras(), ensure(), getJson(), _guardar(), leerCampos(), _login(), reauth() (+7 more)

### Community 26 - "Líneas CM compartido"
Cohesion: 0.21
Nodes (11): cambiarEstado(), cambiarImsi(), cuentaBase(), cuentaCrm(), direccionDe(), esperarOrden(), resolverLinea(), textoError() (+3 more)

### Community 27 - "Tabla de prepagadas"
Cohesion: 0.15
Nodes (17): abrirDetalle(), actualizarKPIs(), actualizarOcultas(), alternarOculta(), aplanarObjeto(), badgeEstado(), botonOcultarHTML(), celdaPeriodos() (+9 more)

### Community 28 - "Consulta BSS prepagadas"
Cohesion: 0.19
Nodes (17): bssBundleBalance(), bssBuscarLinea(), bssServiciosDeCuenta(), cambiarCuenta(), consultar(), worker(), consultarLinea(), leerArranqueUrl() (+9 more)

### Community 29 - "Docs consumos y prepagadas"
Cohesion: 0.16
Nodes (13): Consumos y Paquetes (CM) Doc, bundleBalance (Uso y Balance), Historico de consumo CDR (listDetailedCallDetailsWithBundles), detailedSubscriptionTransaction (Movimientos), paginarHistorico, Reporte Prepagadas SIME-CM Doc, catalogoPlu / PLU 1a compra, Ciclos apilados (pague N lleve M) (+5 more)

### Community 30 - "Carga de histórico"
Cohesion: 0.22
Nodes (13): abrirDetalle(), cargarHistorico(), cmHistoricoConsumo(), cmMovimientos(), isoLocalSinZ(), marcarVigentes(), normalizarLocalISO(), paginarHistorico() (+5 more)

### Community 31 - "Cambio de IMSI (lógica)"
Cohesion: 0.20
Nodes (6): CABECERA, CONFIG, consultarFila(), marcarRepetidos(), noAplica(), PROCESO

### Community 32 - "Tabla de consumos"
Cohesion: 0.24
Nodes (11): celdaEstado(), celdaIdentificacion(), celdaUsoCategoria(), construirDataTable(), estadoTabla(), filaPasaFiltros(), filasExport(), filasParaExportar() (+3 more)

### Community 33 - "Alta en SIME"
Cohesion: 0.22
Nodes (11): b64(), crearEnSime(), guardarRec(), headersSime(), payloadCrear(), refrescarSuscripcion(), simeEditarRecurrencia(), simeGetSuscripcion() (+3 more)

### Community 34 - "Transacciones BSS"
Cohesion: 0.40
Nodes (11): bssTransacciones(), categoriaTx(), esCicloTx(), esCompraPlanTx(), esCompraTx(), esPrimeraTx(), esRecurTx(), montoTx() (+3 more)

### Community 35 - "Estado de líneas (lógica)"
Cohesion: 0.22
Nodes (6): CABECERA, cambiarFila(), CONFIG, consultarFila(), PROCESO, Estado de lineas docs

### Community 36 - "Ciclos y comentarios"
Cohesion: 0.27
Nodes (10): calcularCiclos(), calcularPeriodos(), enriquecer(), etiquetaMes(), fmt(), generarComentarios(), mesIdxDeFecha(), soloFecha() (+2 more)

### Community 37 - "Lanzador PowerShell"
Cohesion: 0.24
Nodes (4): dame click.bat, Leer-Credencial(), Nota(), Ok()

### Community 38 - "KPIs de consumos"
Cohesion: 0.31
Nodes (9): actualizarFiltros(), actualizarKPIs(), alternarKpi(), cabeceraHistorico(), cabeceraMovimientos(), inicializarConsumos(), limpiarFiltros(), pintarFiltro() (+1 more)

### Community 39 - "Docs de arquitectura"
Cohesion: 0.22
Nodes (9): me-ui.css (sistema de diseno), Cierre masivo de casos docs, Consulta QDN Tigo docs, RETCODE states (3001 inconclusive alone), Lanzador docs, Arquitectura marcado / logica / puente, DataTables 2.3.2, Orden de carga me-ui -> MEUI.init -> me-api -> logica -> puente (+1 more)

### Community 40 - "Carga de archivo prepagadas"
Cohesion: 0.38
Nodes (7): buscarBillingAccount(), cargarHoja(), compactoPlan(), extraerLineas(), leerArchivo(), norm(), pintarOpcionesPlan()

### Community 41 - "Formatos de uso"
Cohesion: 0.38
Nodes (7): fmtBytes(), fmtCantidad(), fmtFechaHora(), fmtVoz(), nfmt(), nivelUso(), usoHTML()

### Community 42 - "Docs de ajustes"
Cohesion: 0.33
Nodes (5): Ajustes y Paquetes (CM) Doc, Catalogos de codigos editables, /api/v1/subscription/adjustment, Resolucion de titular via billingAccount/individual, export_ajustes.html

### Community 43 - "Tabla seleccionable"
Cohesion: 0.47
Nodes (5): engancharLote(), tablaSeleccionable(), redibujar(), sincronizarTodas(), visibles()

### Community 44 - "Puente estado de líneas"
Cohesion: 0.47
Nodes (3): actualizar(), desarmar(), pintarAccion()

### Community 45 - "Docs portabilidad Tigo"
Cohesion: 0.40
Nodes (4): Validador Portabilidad Tigo Doc, CheckPortabilidad.html (reemplazado), estadoCM() estado ME en Optiva, validador_portabilidad_tigo.html

### Community 47 - "Sesión CM y cambio IMSI"
Cohesion: 0.30
Nodes (4): engancharSesionCm(), Cambio de IMSI docs, CM ChangeSubscriptionState order, Inactivation leaves IMSI in HELD

### Community 48 - "Columna de archivo"
Cohesion: 0.70
Nodes (5): configurarArchivo(), extraerColumna(), limpiar(), pintarColumnas(), procesar()

### Community 49 - "Modal de uso"
Cohesion: 0.50
Nodes (5): escHtml(), fmtFechaHora(), nivelUso(), pintarCabeceraModal(), usoHTML()

### Community 50 - "Puente cambio de IMSI"
Cohesion: 0.50
Nodes (4): actualizar(), pintarAccion(), cambio_imsi.html (Cambio de IMSI), estado_lineas.html (Estado de líneas)

## Knowledge Gaps
- **201 isolated node(s):** `DEFAULT_MAPS`, `MAPS`, `fmtCOP`, `fmtUnit`, `msisdnCache` (+196 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 283 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lanzador docs` connect `Docs de arquitectura` to `Estado de líneas (lógica)`, `Operaciones QDN Claro`, `Lanzador PowerShell`, `HLR cruzado`, `Shell me-ui`, `HLR/HSS ambos operadores`, `Docs de ajustes`, `Docs portabilidad Tigo`, `Actualizador PowerShell`, `Sesión CM y cambio IMSI`, `Tipificación`, `Aplicar PLU (puente)`, `Contexto y servicios externos`, `Cliente API CM`, `Docs consumos y prepagadas`?**
  _High betweenness centrality (0.212) - this node is a cross-community bridge._
- **Why does `hlr_hss.html` connect `HLR/HSS ambos operadores` to `HLR/HSS Claro`, `HLR cruzado`, `Shell me-ui`, `HLR/HSS Tigo`, `Docs portabilidad Tigo`, `Cliente API CM`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `Reporte Prepagadas SIME-CM Doc` connect `Docs consumos y prepagadas` to `Cliente API CM`, `Docs de ajustes`, `Prepagadas núcleo`, `Docs de arquitectura`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `inicializarConsumos()` (e.g. with `consultar()` and `limpiarFiltros()`) actually correct?**
  _`inicializarConsumos()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEFAULT_MAPS`, `MAPS`, `fmtCOP` to the rest of the system?**
  _201 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `HLR/HSS Claro` be split into smaller, more focused modules?**
  _Cohesion score 0.051589567865981345 - nodes in this community are weakly interconnected._
- **Should `Cierre masivo de casos` be split into smaller, more focused modules?**
  _Cohesion score 0.051791629027401385 - nodes in this community are weakly interconnected._