/* =====================================================================
   catalogo.js · Catálogo ÚNICO de herramientas (fuente de verdad)
   ---------------------------------------------------------------------
   Cada herramienta se describe AQUÍ y en ningún otro sitio. De este
   archivo leen:

     · el menú lateral (assets/base/me-ui.js): grupo, orden, menu/nombre, icono, html
     · las tarjetas y el Backlog de Inicio (assets/herramientas/inicio/inicio.js):
       nombre, descripcion, estado, html, doc y archivos
     · MEUI.init({ app: "id" }) en cada página: título (nombre), descripción
       corta (resumen), versión y doc

   Rutas: todas son relativas a la RAÍZ del proyecto (donde está index.html),
   con «/» y sin «./». me-ui.js las traduce según desde dónde se abra la
   página (raíz o carpeta herramientas/).

   Campos de una herramienta
     id              clave única; es el `app` de MEUI.init
     nombre          título de la página, de la tarjeta y del Backlog
     menu            (opcional) etiqueta más corta del menú lateral
     grupo, orden    grupo del menú (uno de `grupos`) y posición dentro de él;
                     sin grupo no sale en el menú
     icono           clase de Bootstrap Icons
     resumen         una línea, bajo el título de la página
     descripcion     texto largo de la tarjeta y del Backlog de Inicio
     contexto        palabras de sistemas, datos y acciones para el buscador global
     estado          "Operación" | "Consulta"
     version         versión de la herramienta (sale en el pie). Solo vive aquí;
                     el historial de su README la menciona en cada cambio
     html, doc       página y README, para abrir y descargar
     tipoHtml        (opcional) cómo se describe el HTML en el Backlog
     codigo          { descripcion, archivos: [{ ruta, tipo }] }: el resto del
                     código (el html se agrega solo)
     docDescripcion  descripción de la documentación en el Backlog
     enInicio:false  la página existe pero no sale en tarjetas ni Backlog

   El ORDEN de `herramientas` es el de Inicio (tarjetas y Backlog).

   Cómo agregar una herramienta: un objeto nuevo en `herramientas`. No hay
   que tocar me-ui.js ni assets/herramientas/inicio/inicio.js. Ver doc/lanzador/README.md.
   La prueba comprueba que cada ruta listada exista.
===================================================================== */
(function (global) {
    "use strict";

    /* Versión de la base compartida (shell, lanzador, catálogo). Debe ser
       igual a scripts/VERSION: scripts/empaquetar-release.ps1 reescribe la
       línea «const VERSION_BASE» de aquí al empaquetar. */
    const VERSION_BASE = "4.0.0";

    const herramientas = [
        {
            id: "inicio",
            contexto: ["catálogo", "herramientas", "backlog", "descargar"],
            nombre: "Herramientas de Operación",
            menu: "Inicio",
            grupo: "Inicio",
            orden: 1,
            icono: "bi-house",
            resumen: "Backlog de proyectos y entregables · Móvil Éxito",
            enInicio: false,
            version: VERSION_BASE,
            html: "index.html",
            doc: "doc/lanzador/README.md",
            codigo: {
                descripcion: "Estilos e interfaz de la portada.",
                archivos: [
                    { ruta: "assets/herramientas/inicio/inicio.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/inicio/inicio.js", tipo: "JS · tarjetas, Backlog y descargas" },
                ],
            },
        },
        {
            id: "prepagadas",
            contexto: ["SIME", "CM", "Optiva", "BSS", "MSISDN", "línea", "titular", "suscripción", "recurrencia", "ciclo", "paquete", "consultar", "registrar", "editar", "exportar"],
            nombre: "Prepagadas · SIME ⇄ CM",
            menu: "Prepagadas SIME ⇄ CM",
            grupo: "Consultas",
            orden: 1,
            icono: "bi-arrow-left-right",
            resumen: "Verificación cruzada y alta de suscripciones",
            descripcion: "Verificación cruzada de líneas prepagadas y alta de suscripciones en SIME.",
            estado: "Operación",
            version: "9.6.0",
            html: "herramientas/reporte_prepagadas.html",
            doc: "doc/reporte-prepagadas/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. El marcado va aparte de la lógica.",
                archivos: [
                    { ruta: "assets/herramientas/prepagadas/prepagadas.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/prepagadas/prepagadas.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Cómo se usa, qué consulta y qué reglas aplica.",
        },
        {
            id: "casos",
            contexto: ["CM", "Optiva", "caso", "ticket", "nota", "cierre", "cerrar", "masivo", "consultar", "Excel"],
            nombre: "Cierre masivo de casos",
            grupo: "Operaciones",
            orden: 1,
            icono: "bi-check2-square",
            resumen: "Búsqueda, cierre y notas de tickets en el CM",
            descripcion: "Búsqueda del ticket de cada caso y cierre por lotes en el CM.",
            estado: "Operación",
            version: "3.4",
            html: "herramientas/reporte_casos_masivos.html",
            doc: "doc/cerrar-casos/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { ruta: "assets/herramientas/casos/casos.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/casos/casos.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Reglas del cierre y qué se envía al CM.",
        },
        {
            id: "hlr-hss",
            contexto: ["HLR", "HSS", "QDN", "Claro", "Tigo", "MSISDN", "IMSI", "perfil", "red", "consultar", "bloquear", "desbloquear", "conciliar"],
            nombre: "HLR/HSS · Claro y Tigo",
            grupo: "HLR/HSS",
            orden: 1,
            icono: "bi-speedometer2",
            resumen: "Consulta QDN/HLR por operador, o en cuál de los dos está la línea",
            descripcion: "Antes tres herramientas separadas (Validador QDN · Claro, Consulta QDN · Tigo y ¿En qué HLR está?), ahora una sola con pestañas. Tigo y Ambos son de solo lectura; Claro además opera la línea (bloqueo, desbloqueo, conciliación) con resumen y confirmación antes de escribir.",
            estado: "Operación",
            version: "2.7",
            html: "herramientas/hlr_hss.html",
            doc: "doc/hlr-hss/README.md",
            tipoHtml: "HTML · marcado + pestañas",
            codigo: {
                descripcion: "Cada pestaña reusa, sin cambios de lógica, el motor de la herramienta que reemplaza (envuelto en su propio IIFE para poder convivir en una sola página).",
                archivos: [
                    { ruta: "assets/herramientas/hlr-hss/hlr-hss.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/hlr-hss/tigo.js", tipo: "JS · motor Tigo" },
                    { ruta: "assets/herramientas/hlr-hss/claro.js", tipo: "JS · motor Claro (consulta + operaciones)" },
                    { ruta: "assets/herramientas/hlr-hss/ambos.js", tipo: "JS · motor Ambos (cruce)" },
                    { ruta: "assets/herramientas/hlr-hss/hlr-hss.js", tipo: "JS · interruptor de pestañas" },
                ],
            },
            docDescripcion: "Por qué se fusionaron las tres, cómo funciona el interruptor de pestañas, y las reglas de negocio de cada motor (con enlace a la documentación técnica integrada de cada pestaña).",
        },
        {
            id: "portabilidad-tigo",
            contexto: ["HLR", "HSS", "QDN", "Tigo", "CM", "MSISDN", "portabilidad", "perfil", "residuo", "consultar", "validar"],
            nombre: "Validador Portabilidad · Tigo",
            grupo: "HLR/HSS",
            orden: 2,
            icono: "bi-arrow-repeat",
            resumen: "Estado de creación en HLR tras portabilidad, vía autogestión Tigo",
            descripcion: "Consulta individual y masiva por MSISDN contra el HLR de Tigo (autogestión), con el marco de negocio de portabilidad: Creada / Sin perfil (pendiente) / Residuo en Tigo.",
            estado: "Operación",
            version: "1.6",
            html: "herramientas/validador_portabilidad_tigo.html",
            doc: "doc/portabilidad-tigo/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. Comparte motor con «Consulta QDN · Tigo»; cambia el catálogo de RETCODE a etiquetas de negocio.",
                archivos: [
                    { ruta: "assets/compartido/hlr-consulta.js", tipo: "JS · consulta compartida de Claro" },
                    { ruta: "assets/herramientas/portabilidad-tigo/portabilidad-tigo.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/portabilidad-tigo/portabilidad-tigo.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Qué significa cada RETCODE en el proceso de portabilidad y validaciones de coherencia.",
        },
        {
            id: "rechazo",
            contexto: ["CM", "portabilidad", "titularidad", "PDF", "rechazo", "soporte", "línea suspendida", "línea desactivada", "generar"],
            nombre: "Generar archivo de rechazo",
            grupo: "Operaciones",
            orden: 2,
            icono: "bi-file-earmark-pdf",
            resumen: "Soportes PDF de rechazo de portabilidad · Móvil Éxito",
            descripcion: "Arma el soporte PDF de un rechazo de portabilidad (FC titularidad, Línea Suspendida o Línea Desactivada) con los datos del CM, vista previa del documento real y el nombre según la convención de la plataforma.",
            estado: "Operación",
            version: "2.3.0",
            html: "herramientas/generar_rechazo.html",
            doc: "doc/generar-rechazo/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. Reemplaza las tres macros de Excel: el PDF pesa 12-35 KB en vez de 217 KB porque no incrusta fuentes, que era lo que hacía que la plataforma truncara el archivo.",
                archivos: [
                    { ruta: "assets/herramientas/rechazo/rechazo.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/rechazo/rechazo.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Campos de cada causal, convención del nombre, qué se trae del CM y por qué se dejó el Excel.",
        },
        {
            id: "consumos",
            contexto: ["CM", "Optiva", "Tulio", "MSISDN", "ICCID", "línea", "titular", "paquete", "PLU", "bolsillo", "balance", "saldo", "CDR", "voz", "datos", "SMS", "movimiento", "consultar", "cargar", "exportar"],
            nombre: "Consumos y Paquetes · CM",
            menu: "Bolsillos, Paquetes, Consumos",
            grupo: "Consultas",
            orden: 2,
            icono: "bi-bar-chart",
            resumen: "Datos de la línea, paquetes activos e histórico de consumo (CDR) por rango de fechas",
            descripcion: "Datos de la línea, paquetes activos (uso y balance), movimientos (compras, paquetes, recurrencias) e histórico de consumo (llamadas, datos y SMS) por rango de fechas, con tabla paginada, gráficas y exportación. No consulta SIME ni recurrencias/ciclos.",
            estado: "Operación",
            version: "1.11.0",
            html: "herramientas/reporte_consumos.html",
            doc: "doc/reporte-consumos/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. El histórico se trae por línea, al abrir su detalle, no en la consulta masiva.",
                archivos: [
                    { ruta: "assets/herramientas/consumos/consumos.css", tipo: "CSS · estilos" },
                    { ruta: "assets/compartido/tulio-plu.js", tipo: "JS · Tulio RecargaPaquete (compartido)" },
                    { ruta: "assets/herramientas/consumos/paquetes.js", tipo: "JS · cargar paquete y PLU" },
                    { ruta: "assets/herramientas/consumos/consumos.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Endpoints, criterio de clasificación del histórico (Datos/Voz/SMS) y riesgos.",
        },
        {
            id: "audio-mp3",
            contexto: ["audio", "MP3", "OGG", "M4A", "grabación", "convertir", "ZIP", "local"],
            nombre: "Convertir audio a MP3",
            grupo: "Utilidades",
            orden: 1,
            icono: "bi-file-earmark-music",
            resumen: "Convierte uno o varios audios localmente y conserva su nombre como mp3-*.mp3.",
            descripcion: "Convierte uno o varios audios —inicialmente OGG y M4A— a MP3 real en el navegador, sin subirlos a un servidor. Conserva el nombre con el prefijo mp3- y agrupa los lotes en un ZIP.",
            estado: "Operación",
            version: "1.2.0",
            html: "herramientas/convertir_audio_mp3.html",
            doc: "doc/audio-mp3/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. La decodificación y codificación ocurren localmente en el navegador.",
                archivos: [
                    { ruta: "assets/herramientas/audio-mp3/audio-mp3.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/audio-mp3/audio-mp3.js", tipo: "JS · conversión, nombres e interfaz" },
                ],
            },
            docDescripcion: "Formatos, operación por lotes, privacidad y convención mp3-*.mp3.",
        },
        {
            id: "plu",
            contexto: ["Tulio", "CM", "Optiva", "PLU", "RecargaPaquete", "MSISDN", "línea", "paquete", "bolsillo", "saldo", "recarga", "aplicar", "verificar", "borrar"],
            nombre: "Aplicar PLU de paquete",
            grupo: "Operaciones",
            orden: 3,
            icono: "bi-basket",
            resumen: "Recarga de paquete en Tulio y verificación contra el CM",
            descripcion: "Aplica un PLU de paquete en Tulio (RecargaPaquete) sobre una línea y verifica contra el CM qué quedó: por cada paquete nuevo o con saldo sumado muestra el total, el valor anterior y cuánto se sumó. Porte de la consola local consola_bundles_movil_exito, sin su servidor Python.",
            estado: "Operación",
            version: "1.8.0",
            html: "herramientas/aplicar_plu.html",
            doc: "doc/aplicar-plu/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. La recarga escribe en producción y pide una sesión del CM vigente.",
                archivos: [
                    { ruta: "assets/herramientas/plu/plu.css", tipo: "CSS · estilos" },
                    { ruta: "assets/compartido/tulio-plu.js", tipo: "JS · Tulio RecargaPaquete (compartido)" },
                    { ruta: "assets/herramientas/plu/plu.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Endpoints de Tulio, eleccion de cuenta de la linea, el cuadro de «cuanto se sumo» y riesgos.",
        },
        {
            id: "titularidad",
            contexto: ["Genesis", "CM", "HLR", "HSS", "Claro", "Tigo", "SIM", "línea", "titular", "titularidad", "bloqueo", "log", "red", "consultar"],
            nombre: "Bloqueos SIM x Titularidad",
            grupo: "Consultas",
            orden: 5,
            icono: "bi-shield-check",
            resumen: "Log de comprobación de titularidad (Genesis) cruzado con el CM y con el HLR/HSS",
            descripcion: "El log de comprobación de titularidad de Genesis, cruzado con el CM y con el HLR/HSS. Carga los más de doscientos mil registros, y sobre las líneas que se marquen (de 1 a n) trae titular y estado del CM y en qué red está la línea: Claro, Tigo, ambas o ninguna. Existe para que el call resuelva el bloqueo de SIM en la llamada, sin escalarlo.",
            estado: "Consulta",
            version: "1.3.0",
            html: "herramientas/titularidad.html",
            doc: "doc/titularidad/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. Solo lee: Genesis, el CM y los HLR de Claro y Tigo. hlr-consulta.js es el motor de ubicación compartido.",
                archivos: [
                    { ruta: "assets/herramientas/titularidad/titularidad.css", tipo: "CSS · estilos" },
                    { ruta: "assets/compartido/genesis-api.js", tipo: "JS · sesión y paginación de Genesis (compartido)" },
                    { ruta: "assets/compartido/genesis-bookmarklet.js", tipo: "JS · marcador para iniciar sesión en Genesis (compartido)" },
                    { ruta: "assets/compartido/hlr-consulta.js", tipo: "JS · Claro + Tigo (compartido)" },
                    { ruta: "assets/compartido/cm-lineas.js", tipo: "JS · operaciones de línea (compartido)" },
                    { ruta: "assets/herramientas/titularidad/titularidad.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "El endpoint de Genesis y su paginación por cabecera, cómo se inicia sesión y por qué las consultas de HLR van en tandas.",
        },
        {
            id: "estado-lineas",
            contexto: ["CM", "BSS", "Optiva", "MSISDN", "IMSI", "SIM", "línea", "HELD", "estado", "bloquear", "inactivar", "masivo", "consultar"],
            nombre: "Bloquear/Inactivar líneas",
            grupo: "Operaciones",
            orden: 4,
            icono: "bi-toggle-off",
            resumen: "Bloquear o inactivar líneas en el CM, en masivo",
            descripcion: "Bloquea o inactiva líneas en el CM, en masivo: tabla con casillas, filtros y ocultar/mostrar como el cierre de casos, y estado real de cada línea tras la orden. Al inactivar, la IMSI pasa a HELD y hay que liberarla en el BSS.",
            estado: "Operación",
            version: "1.2.0",
            html: "herramientas/estado_lineas.html",
            doc: "doc/estado-lineas/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. Escribe en producción y pide una sesión del CM vigente; cm-lineas.js se comparte entre Bloquear/Inactivar líneas y Cambio IMSI y línea Claro|Tigo.",
                archivos: [
                    { ruta: "assets/herramientas/estado-lineas/estado-lineas.css", tipo: "CSS · estilos" },
                    { ruta: "assets/compartido/cm-lineas.js", tipo: "JS · operaciones de línea (compartido)" },
                    { ruta: "assets/herramientas/estado-lineas/estado-lineas.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Orden ChangeSubscriptionState, estados de la línea y de la IMSI, y el paso manual de HELD a disponible.",
        },
        {
            id: "cambio-imsi-linea",
            contexto: ["CM", "BSS", "Optiva", "Claro", "Tigo", "IMSI", "ICCID", "MSISDN", "SIM", "línea", "ChangeSim", "PortInExistingSubscription", "portabilidad", "cambiar", "masivo"],
            nombre: "Cambio IMSI y línea Claro|Tigo",
            menu: "Cambio IMSI y línea",
            grupo: "Operaciones",
            orden: 5,
            icono: "bi-sim",
            resumen: "Cambiar la SIM (IMSI) o el número (MSISDN) de líneas en el CM, en masivo",
            descripcion: "Cambia en el CM, en masivo, la SIM (IMSI) o el número (MSISDN) de líneas, en dos pestañas con una sola sesión del CM. Cambio IMSI: renglones línea;imsi_nueva, valida línea activa e IMSI nueva disponible y confirma que la línea quedó con la SIM nueva. Cambio de línea: renglones línea;línea_nueva (texto o Excel), envía la orden de portabilidad del CM (PortInExistingSubscription), que queda pendiente hasta completarse. Ambas exigen nota.",
            estado: "Operación",
            version: "2.0.0",
            html: "herramientas/cambio_imsi_linea.html",
            doc: "doc/cambio-imsi-linea/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. Escribe en producción y pide una sesión del CM vigente; cm-lineas.js se comparte con Bloquear/Inactivar líneas.",
                archivos: [
                    { ruta: "assets/herramientas/cambio-imsi-linea/cambio-imsi-linea.css", tipo: "CSS · estilos" },
                    { ruta: "assets/compartido/cm-lineas.js", tipo: "JS · operaciones de línea (compartido)" },
                    { ruta: "assets/herramientas/cambio-imsi-linea/imsi.js", tipo: "JS · reglas de negocio (Cambio IMSI)" },
                    { ruta: "assets/herramientas/cambio-imsi-linea/msisdn.js", tipo: "JS · reglas de negocio (Cambio de línea)" },
                    { ruta: "assets/herramientas/cambio-imsi-linea/cambio-imsi-linea.js", tipo: "JS · enganche con el shell y pestañas" },
                ],
            },
            docDescripcion: "Órdenes ChangeSim y PortInExistingSubscription (carrito + orden), validaciones de cada pestaña y verificación posterior.",
        },
        {
            id: "prefactura",
            contexto: ["factura", "prefactura", "Plan Corporativo", "Excel", "corte", "liquidación", "IVA", "ICO", "retefuente", "impuesto", "filial", "calcular", "generar"],
            nombre: "Pre-factura",
            grupo: "Operaciones",
            orden: 6,
            icono: "bi-receipt",
            resumen: "Pre-factura del Plan Corporativo: corte, liquidación e impuestos, y un archivo por filial",
            descripcion: "Pre-factura mensual del Plan Corporativo: aplica el corte (día 15) a las observaciones de la hoja Activas, calcula valor bruto, IVA, ICO, retefuente y neto de cada línea, resume por empresa y tipo, compara con el mes anterior y genera un archivo por filial (hojas Facturas y Liquidación). Todo local.",
            estado: "Operación",
            version: "1.1.0",
            html: "herramientas/prefactura.html",
            doc: "doc/prefactura/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta. No consulta ningún servicio: lee el Excel del Plan Corporativo en el navegador.",
                archivos: [
                    { ruta: "assets/herramientas/prefactura/prefactura.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/prefactura/calculo.js", tipo: "JS · cálculo (corte, liquidación e impuestos)" },
                    { ruta: "assets/herramientas/prefactura/prefactura.js", tipo: "JS · interfaz y archivos" },
                ],
            },
            docDescripcion: "Paso a paso del proceso en Excel que reemplaza, reglas de corte, tarifas e impuestos, y archivos que genera.",
        },
        {
            id: "tipificacion",
            contexto: ["CM", "Optiva", "CRM", "caso", "ticket", "tipificación", "estado", "fecha", "CSV", "Excel", "JSON", "consultar", "exportar"],
            nombre: "Exportar casos · Tipificación",
            menu: "Exportar casos tipificación",
            grupo: "Consultas",
            orden: 3,
            icono: "bi-download",
            resumen: "Descarga masiva de casos del CRM",
            descripcion: "Descarga masiva de casos del CRM por rango de fechas y estados.",
            estado: "Operación",
            version: "2.1.0",
            html: "herramientas/export_tipificacion.html",
            doc: "doc/reporte-tipificacion/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { ruta: "assets/herramientas/tipificacion/tipificacion.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/tipificacion/tipificacion.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Filtros, límite de 10.000 casos y división por fechas.",
        },
        {
            id: "ajustes",
            contexto: ["CM", "Optiva", "ajuste", "dinero", "paquete", "bundle", "saldo", "crédito", "débito", "CSV", "Excel", "JSON", "consultar", "exportar"],
            nombre: "Ajustes y paquetes",
            grupo: "Consultas",
            orden: 4,
            icono: "bi-cash-coin",
            resumen: "Reporte de ajustes del CM · Optiva",
            descripcion: "Consulta y exportación de ajustes de dinero y de paquetes, con catálogos editables.",
            estado: "Operación",
            version: "2.2.0",
            html: "herramientas/export_ajustes.html",
            doc: "doc/reporte-ajustes/README.md",
            codigo: {
                descripcion: "Archivos de la herramienta.",
                archivos: [
                    { ruta: "assets/herramientas/ajustes/ajustes.css", tipo: "CSS · estilos" },
                    { ruta: "assets/herramientas/ajustes/ajustes.js", tipo: "JS · reglas de negocio e interfaz" },
                ],
            },
            docDescripcion: "Catálogos de códigos y significado de cada columna.",
        },
    ];

    /* La base no es una herramienta: no tiene pagina ni entrada en el menu,
       pero sus archivos van en el Backlog y en las descargas. */
    const base = {
        id: "base",
        nombre: "Base compartida",
        descripcion: "Lo que usan todas las herramientas: diseño, shell y acceso al CM. Un cambio aquí las afecta a todas.",
        estado: "Común",
        version: VERSION_BASE,
        entregables: [
            {
                nombre: "Inicio", tipo: "codigo",
                descripcion: "Esta misma página: el catálogo y las descargas.",
                archivos: [
                    { ruta: "index.html", tipo: "HTML · marcado" },
                    ...herramientas.find(h => h.id === "inicio").codigo.archivos
                ]
            },
            {
                nombre: "Sistema y acceso", tipo: "codigo",
                descripcion: "Marco visual, sesión, tablas, exportación, llamadas al CM, el catálogo de herramientas y el registro de librerías.",
                archivos: [
                    { ruta: "assets/base/me-ui.css", tipo: "CSS · sistema de diseño" },
                    { ruta: "assets/base/me-ui.js", tipo: "JS · shell, tablas y exportación" },
                    { ruta: "assets/base/me-api.js", tipo: "JS · Keycloak y llamadas al CM" },
                    { ruta: "assets/base/catalogo.js", tipo: "JS · catálogo único de herramientas" },
                    { ruta: "assets/base/dependencias.js", tipo: "JS · registro de librerías de CDN" }
                ]
            },
            {
                nombre: "Lanzador", tipo: "codigo",
                descripcion: "Abre las herramientas con la sesión de SIME y las credenciales del CM.",
                archivos: [
                    { ruta: "dame click.bat", tipo: "BAT · lanzador" }
                ]
            },
            {
                nombre: "Documentación", tipo: "doc",
                descripcion: "Cómo funciona la base común, el lanzador y la API de los módulos.",
                archivos: [
                    { ruta: "doc/lanzador/README.md", tipo: "Markdown" }
                ]
            }
        ]
    };

    /* 1 · BÚSQUEDA POR CONTEXTO
       Se calcula desde los datos vigentes: no hay otro catálogo ni índice
       que deba actualizarse al editar una herramienta. */
    function normalizarBusqueda(texto) {
        return String(texto == null ? "" : texto).toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function buscar(texto) {
        const terminos = normalizarBusqueda(texto).split(/[\s/|,]+/).filter(Boolean);
        return herramientas.filter(h => h.enInicio !== false)
            .map((herramienta, orden) => {
                const campos = [herramienta.nombre, (herramienta.contexto || []).join(" "),
                    [herramienta.descripcion, herramienta.resumen].join(" ")]
                    .map(normalizarBusqueda);
                const relevancia = terminos.length
                    ? campos.findIndex(campo => terminos.some(termino => campo.includes(termino)))
                    : 0;
                return { herramienta, orden, relevancia };
            })
            .filter(resultado => resultado.relevancia >= 0)
            .sort((a, b) => a.relevancia - b.relevancia || a.orden - b.orden)
            .map(resultado => resultado.herramienta);
    }

    global.ME_CATALOGO = {
        version: VERSION_BASE,
        grupos: ["Inicio", "Consultas", "Operaciones", "HLR/HSS", "Utilidades"],
        herramientas,
        base,
        buscar,

        /** La herramienta con ese id, o undefined. */
        obtener(id) {
            return herramientas.find(h => h.id === id);
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
