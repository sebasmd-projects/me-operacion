/* =====================================================================
   logica-rechazo.js · Generar archivo de rechazo — reglas de negocio
   ---------------------------------------------------------------------
   Reemplaza las tres macros de Excel (MACRO DE PORTABILIDAD .xlsx / LS /
   LD) por un PDF generado aquí mismo.

   Por qué se cambió el Excel:
     El PDF que exportaba Excel pesaba 217 KB, de los cuales 190 KB (el
     87,5 %) eran las fuentes Calibri y Aptos incrustadas COMPLETAS. El
     contenido real son 18 KB. Ese peso es lo que hacía que la plataforma
     truncara el archivo al cargarlo (se cortaba en 122.880 bytes = 15
     bloques exactos de 8 KiB, sin marca de fin de archivo, ilegible).

     Aquí se usan las fuentes estándar del PDF (Helvetica), que NO se
     incrustan: pesan cero. Medido: 12 KB sin imagen, 24 KB con una
     manifestación típica y 35 KB con una captura grande. De 217 KB a 24 KB,
     unas 18 veces menos.

     El documento se ajusta solo a UNA página, como las macros: se mide
     antes de dibujar y se busca la mayor escala que quepa (ver ESCALAS).

   Qué hace, en orden:
     1 · CAUSALES        el catálogo de las tres causales y sus campos
     2 · UTILIDADES      fechas, validaciones, formato
     3 · NOMBRE          las dos convenciones observadas, y el nombre a mano
     4 · CM              consulta al BSS para prellenar el formulario
     5 · IMAGEN          compresión de la imagen de manifestación
     6 · PDF             armado del documento con jsPDF
     7 · API             lo que consume me-rechazo-puente.js

   Depende de: me-ui.js (MEUI), me-api.js (MEAPI), jsPDF (global jspdf).
===================================================================== */
"use strict";

const getJson = MEAPI.getJson;

/* =====================================================================
   1 · CAUSALES
   ---------------------------------------------------------------------
   Cada causal define: el sufijo del nombre del archivo, el texto que va
   en «CAUSAL DE RECHAZO», los campos propios y qué se repite en el
   bloque inferior «INFORMACIÓN CLIENTE».

   Los tres formatos comparten el bloque del cliente; se diferencian en
   el bloque de fecha de arriba y en los campos del final.
===================================================================== */

/* Campos que existen en las tres causales, en el orden de la macro.
   Los que van vacíos se dejan vacíos a propósito: el formulario no
   pre-escribe «N/A» para no hacer pasar por dato lo que nadie diligenció.
   El PDF sí imprime N/A cuando el campo quedó en blanco (ver textoValor). */
const CAMPOS_CLIENTE = [
    { id: "nombre", etiqueta: "NOMBRE:", valor: "", prioridad: "llenar" },
    { id: "identificacion", etiqueta: "IDENTIFICACIÓN:", valor: "", prioridad: "llenar" },
    { id: "idRepLegal", etiqueta: "NUMERO IDENTIFICACION REPRESENTANTE LEGAL:", valor: "", soloJuridica: true, prioridad: "llenar" },
    { id: "tipoId", etiqueta: "TIPO IDENTIFICACIÓN:", valor: "CC", tipo: "tipoId", prioridad: "revisar" },
    { id: "fechaExpedicion", etiqueta: "FECHA EXPEDICIÓN DOCUMENTO IDENTIFICACIÓN:", valor: "", prioridad: "llenar" },
    { id: "tipoPersona", etiqueta: "TIPO PERSONA:", valor: "NATURAL", tipo: "tipoPersona", prioridad: "revisar" },
    { id: "tipoServicio", etiqueta: "TIPO SERVICIO:", valor: "PREPAGO", tipo: "tipoServicio", prioridad: "revisar" },
    { id: "estadoLinea", etiqueta: "ESTADO LINEA:", valor: "Activa", tipo: "estadoLinea", porCausal: true, prioridad: "revisar" },
    { id: "tipoIdRepLegal", etiqueta: "TIPO IDENTIFICACIÓN REPRESENTANTE LEGAL", valor: "CC", tipo: "tipoId", soloJuridica: true, prioridad: "revisar" },
    { id: "fechaExpRepLegal", etiqueta: "FECHA EXPEDICIÓN DOCUMENTO IDENTIFICACIÓN: IDENTIFICACIÓN REPRESENTANTE LEGAL", valor: "", soloJuridica: true, prioridad: "llenar" }
];

/* Los campos del representante legal solo tienen sentido en persona
   jurídica: en natural se ocultan del formulario y se limpian. */
const CAMPOS_REP_LEGAL = CAMPOS_CLIENTE.filter(c => c.soloJuridica).map(c => c.id);

/* Cierre común: motivo, sistema y anexo. */
const CAMPOS_CIERRE = [
    { id: "motivo", etiqueta: "MOTIVO ", valor: "", tipo: "motivo", porCausal: true, prioridad: "revisar" },
    { id: "sistema", etiqueta: "IDENTIFICACION SISTEMA", valor: "BSS - CLIFRE- TRANSUNION", prioridad: "automatico" },
    { id: "anexo", etiqueta: "ANEXO ", valor: "PDF", prioridad: "automatico" }
];

const CAUSALES = {
    FC: {
        codigo: "FC",
        nombre: "FC titularidad",
        etiqueta: "FC titularidad · falla de concordancia",
        descripcion: "El titular en el sistema no concuerda con quien solicita la portación.",
        // Bloque de fecha propio de esta causal, antes de los datos del cliente.
        fechas: [
            { id: "fechaCausal", etiqueta: "FECHA: SEGÚN CAUSAL", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" }
        ],
        // Campos que van después del bloque del cliente.
        extra: [
            { id: "fechaExtraccion", etiqueta: "FECHA DE EXTRACCION DE LA INFORMACION", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" },
            { id: "fechaConsulta", etiqueta: "FECHA DE CONSULTA", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" }
        ],
        // Campos del bloque inferior «INFORMACIÓN CLIENTE», después del espejo.
        cola: [],
        // Qué se repite abajo. `de` es el id del campo de arriba.
        espejo: [
            { etiqueta: "FECHA DE EXTRACCION DE LA INFORMACION", de: "fechaExtraccion" },
            { etiqueta: "NÚMERO DE LÍNEA", de: "msisdn" },
            { etiqueta: "NOMBRE:", de: "nombre" },
            { etiqueta: "IDENTIFICACIÓN:", de: "identificacion" },
            { etiqueta: "TIPO IDENTIFICACIÓN:", de: "tipoId" },
            { etiqueta: "TIPO DE PERSONA", de: "tipoPersona" },
            { etiqueta: "FECHA EXPEDICIÓN DOCUMENTO IDENTIFICACIÓN:", de: "fechaExpedicion" },
            { etiqueta: "MOTIVO DE RECHAZO", de: "motivo" },
            { etiqueta: "TIPO SERVICIO:", de: "tipoServicio" },
            { etiqueta: "ESTADO LINEA:", de: "estadoLinea" }
        ],
        motivoPorDefecto: "FC titularidad",
        estadoPorDefecto: "Activa"
    },

    LS: {
        codigo: "LS",
        nombre: "Línea Suspendida",
        etiqueta: "LS · Línea Suspendida",
        descripcion: "La línea está suspendida y no puede portarse en ese estado.",
        fechas: [
            { id: "fechaSuspension", etiqueta: "FECHA Y HORA DE LA SUSPENCIÓN", tipo: "fechaHora", auto: null, requerido: true, prioridad: "llenar" },
            { id: "fechaCausal", etiqueta: "FECHA: SEGÚN CAUSAL", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" }
        ],
        extra: [
            { id: "fechaSuspension2", etiqueta: "FECHA Y HORA DE LA SUSPENCIÓN", tipo: "fechaHora", de: "fechaSuspension" },
            { id: "fechaConsulta", etiqueta: "FECHA DE CONSULTA", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" }
        ],
        cola: [
            { id: "cun", etiqueta: "No. solicitud rollback (CUN)", valor: "", tipo: "cun", prioridad: "llenar" },
            { id: "motivoBloqueo", etiqueta: "Motivo de Bloqueo/suspención", valor: "", tipo: "textoLargo", prioridad: "llenar" }
        ],
        espejo: [
            { etiqueta: "FECHA Y HORA DE LA SUSPENCIÓN", de: "fechaSuspension" },
            { etiqueta: "NÚMERO DE LÍNEA", de: "msisdn" },
            { etiqueta: "NOMBRE:", de: "nombre" },
            { etiqueta: "IDENTIFICACIÓN:", de: "identificacion" },
            { etiqueta: "TIPO IDENTIFICACIÓN:", de: "tipoId" },
            { etiqueta: "FECHA EXPEDICIÓN DOCUMENTO IDENTIFICACIÓN:", de: "fechaExpedicion" },
            { etiqueta: "TIPO SERVICIO:", de: "tipoServicio" },
            { etiqueta: "ESTADO LINEA:", de: "estadoLinea" }
        ],
        motivoPorDefecto: "Línea Suspendida",
        estadoPorDefecto: "Línea Suspendida"
    },

    LD: {
        codigo: "LD",
        nombre: "Línea Desactivada",
        etiqueta: "LD · Línea Desactivada",
        descripcion: "La línea está desactivada; se documenta la fecha de desactivación y el CUN.",
        fechas: [
            // Este dato y el CUN se traen del CM: son los que sustentan la causal.
            { id: "fechaDesactivacion", etiqueta: "FECHA Y HORA DESACTIVACIÓN:", tipo: "fechaHora", auto: null, requerido: true, delCM: true, prioridad: "llenar" },
            { id: "fechaExtraccion", etiqueta: "FECHA DE EXTRACCION DE LA INFORMACION:", tipo: "fechaHora", auto: "ahora", prioridad: "automatico" }
        ],
        extra: [],
        cola: [
            // PENDIENTE: el CUN se digita a mano. No se marca como campo del CM
            // porque todavía no se sabe qué servicio lo expone; en cuanto se
            // conozca, basta con llenar `salida.cun` en consultarCM().
            { id: "cun", etiqueta: "No. solicitud rollback (CUN)", valor: "", tipo: "cun", prioridad: "llenar" },
            { id: "motivoCola", etiqueta: "Motivo ", valor: "", de: "motivo" }
        ],
        espejo: [
            { etiqueta: "FECHA Y HORA DESACTIVACIÓN:", de: "fechaDesactivacion" },
            { etiqueta: "NÚMERO DE LÍNEA", de: "msisdn" },
            { etiqueta: "NOMBRE:", de: "nombre" },
            { etiqueta: "IDENTIFICACIÓN:", de: "identificacion" },
            { etiqueta: "TIPO IDENTIFICACIÓN:", de: "tipoId" },
            { etiqueta: "FECHA EXPEDICIÓN DOCUMENTO IDENTIFICACIÓN:", de: "fechaExpedicion" },
            { etiqueta: "TIPO SERVICIO:", de: "tipoServicio" },
            { etiqueta: "ESTADO LINEA:", de: "estadoLinea" }
        ],
        motivoPorDefecto: "Inactividad igual o superior a 2 meses (Línea desactivada por no uso)",
        estadoPorDefecto: "DESACTIVADA"
    }
};

/* Catálogos de los desplegables. */
const TIPOS_ID = ["CC", "CE", "NIT", "N/A"];
const TIPOS_PERSONA = ["NATURAL", "JURIDICA"];
const TIPOS_SERVICIO = ["PREPAGO", "POSPAGO", "N/A"];

/* El estado de la línea es un desplegable ABIERTO: se sugieren los estados
   conocidos, pero el analista puede escribir uno que no esté en la lista sin
   que la herramienta se lo impida. */
const ESTADOS_LINEA = [
    "Activa", "Disponible", "Inactiva", "Bloqueada", "Portada",
    "Línea Suspendida", "DESACTIVADA", "N/A"
];

/* Regla de negocio: NIT ⇒ persona jurídica. No es opcional, y por eso el
   campo TIPO PERSONA se bloquea cuando el tipo de identificación es NIT. */
const personaSegunTipoId = tipoId => (tipoId === "NIT" ? "JURIDICA" : "NATURAL");

/* =====================================================================
   2 · UTILIDADES
===================================================================== */

const dosDig = n => String(n).padStart(2, "0");

/** «01/09/2026 08:33:47», que es el formato que traen las macros. */
function fechaHoraTexto(d) {
    if (!d) return "N/A";
    const f = d instanceof Date ? d : new Date(d);
    if (isNaN(f)) return "N/A";
    return `${dosDig(f.getDate())}/${dosDig(f.getMonth() + 1)}/${f.getFullYear()} `
        + `${dosDig(f.getHours())}:${dosDig(f.getMinutes())}:${dosDig(f.getSeconds())}`;
}

/**
 * Valor de un <input type="datetime-local"> a partir de una fecha.
 * Lleva segundos: el formato de la macro los imprime, así que recortar aquí
 * era perder precisión que el PDF sí muestra. El input necesita `step="1"`
 * para conservarlos.
 */
function aInputFechaHora(d) {
    if (!d) return "";
    const f = d instanceof Date ? d : new Date(d);
    if (isNaN(f)) return "";
    return `${f.getFullYear()}-${dosDig(f.getMonth() + 1)}-${dosDig(f.getDate())}`
        + `T${dosDig(f.getHours())}:${dosDig(f.getMinutes())}:${dosDig(f.getSeconds())}`;
}

/** Parte de fecha («2026-09-11») de un valor de datetime-local. */
const diaDeInput = v => String(v || "").slice(0, 10);

/** El valor del input cae en el día de hoy. */
function esDeHoy(valorInput) {
    const dia = diaDeInput(valorInput);
    return !!dia && dia === diaDeInput(aInputFechaHora(new Date()));
}

/** Epoch del CM (segundos o milisegundos) a Date. */
function epochFecha(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return null;
    const f = new Date(n > 1e12 ? n : n * 1000);
    return isNaN(f) ? null : f;
}

/** Un MSISDN colombiano: 10 dígitos que empiezan por 3. Tolera el 57. */
function normalizarMsisdn(v) {
    const d = String(v || "").replace(/\D/g, "").replace(/^57(?=3\d{9}$)/, "");
    return /^3\d{9}$/.test(d) ? d : null;
}

/** Valida la identificación según su tipo. Devuelve null si está bien. */
function validarIdentificacion(tipo, valor) {
    const v = String(valor || "").trim();
    if (!v || v.toUpperCase() === "N/A") return null;   // N/A es válido en el formato
    const d = v.replace(/\D/g, "");
    if (tipo === "NIT" && !/^\d{9,10}$/.test(d)) return "El NIT debe tener 9 o 10 dígitos.";
    if (tipo === "CC" && !/^\d{6,10}$/.test(d)) return "La cédula debe tener entre 6 y 10 dígitos.";
    if (tipo === "CE" && !/^\d{5,7}$/.test(d)) return "La cédula de extranjería debe tener entre 5 y 7 dígitos.";
    return null;
}

/* =====================================================================
   3 · NOMBRE DEL ARCHIVO
   ---------------------------------------------------------------------
   El nombre sigue una PLANTILLA con tres partes variables, tomadas de las
   combinaciones que ya se ven en los archivos que la plataforma acepta:

       0008 20260909 0000007 -FC.pdf
       └┬─┘ └───┬──┘ └──┬──┘  └┬┘
        │       │       │      └── causal: FC / LS / LD (la elige la causal)
        │       │       └───────── consecutivo del día, ancho configurable
        │       └───────────────── fecha AAAAMMDD (fija: es la única
        │                          forma observada en los archivos reales)
        └───────────────────────── prefijo (configurable)

   El prefijo y el ancho del consecutivo NO están fijos a las dos formas
   vistas al principio (0008/7 y 00008/5): son una PLANTILLA que el
   analista crea, edita y borra desde la propia herramienta, y que queda
   guardada en el navegador de forma permanente — no en memoria de la
   pestaña. Las dos formas originales quedan como semillas la primera vez
   que se abre la herramienta, para no perder lo que ya se usaba.

   El consecutivo sigue siendo DIARIO: arranca en 1 cada día y se guarda
   para no repetirlo entre archivos del mismo día.
===================================================================== */

const CLAVE_CONSECUTIVO = "me.rechazo.consecutivo";
const CLAVE_PLANTILLAS = "me.rechazo.plantillas";
const CLAVE_PLANTILLA_ACTIVA = "me.rechazo.plantillaActiva";

/* Las dos convenciones ya observadas, como semilla la primera vez que se
   abre la herramienta en un navegador. A partir de ahí, la lista real vive
   en localStorage y el analista la administra libremente. */
const PLANTILLAS_SEMILLA = [
    { id: "p19", prefijo: "0008", digitos: 7 },
    { id: "p18", prefijo: "00008", digitos: 5 }
];

/** «20260908», la parte de fecha del nombre. Única forma observada. */
const selloFecha = d => `${d.getFullYear()}${dosDig(d.getMonth() + 1)}${dosDig(d.getDate())}`;

/** Texto que describe la plantilla en el desplegable. */
const etiquetaPlantilla = p => `${p.prefijo} + AAAAMMDD + ${p.digitos} dígito${p.digitos === 1 ? "" : "s"}`;

/** Lista de plantillas guardadas; siembra las dos conocidas la primera vez. */
function plantillas() {
    try {
        const crudo = localStorage.getItem(CLAVE_PLANTILLAS);
        if (crudo) {
            const lista = JSON.parse(crudo);
            if (Array.isArray(lista) && lista.length) return lista;
        }
    } catch (e) { /* almacenamiento bloqueado: se trabaja solo con la semilla */ }
    return PLANTILLAS_SEMILLA;
}

function guardarListaPlantillas(lista) {
    try { localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista)); } catch (e) { }
}

/**
 * Agrega una plantilla nueva y la deja activa. Si ya existe una igual
 * (mismo prefijo y mismos dígitos) se reutiliza en vez de duplicarla.
 * Devuelve el id de la plantilla resultante.
 */
function guardarPlantilla(prefijo, digitos) {
    const pref = String(prefijo || "").trim().slice(0, 12) || "0000";
    const dig = Math.min(9, Math.max(1, Number(digitos) || 5));
    const lista = plantillas().slice();

    const existente = lista.find(p => p.prefijo === pref && p.digitos === dig);
    if (existente) { recordarPlantillaActiva(existente.id); return existente.id; }

    const id = "p" + Date.now().toString(36);
    lista.push({ id, prefijo: pref, digitos: dig });
    guardarListaPlantillas(lista);
    recordarPlantillaActiva(id);
    return id;
}

/** Borra una plantilla. Se conserva siempre al menos una. */
function eliminarPlantilla(id) {
    const lista = plantillas();
    if (lista.length <= 1) return false;
    const restante = lista.filter(p => p.id !== id);
    guardarListaPlantillas(restante);
    if (plantillaActivaId() === id) recordarPlantillaActiva(restante[0].id);
    return true;
}

function plantillaPorId(id) {
    return plantillas().find(p => p.id === id) || plantillas()[0];
}

/** Última plantilla usada; si no hay ninguna válida, la primera de la lista. */
function plantillaActivaId() {
    try {
        const id = localStorage.getItem(CLAVE_PLANTILLA_ACTIVA);
        if (id && plantillas().some(p => p.id === id)) return id;
    } catch (e) { /* sin almacenamiento, se cae a la primera de la lista */ }
    return plantillas()[0].id;
}
function recordarPlantillaActiva(id) {
    try { localStorage.setItem(CLAVE_PLANTILLA_ACTIVA, id); } catch (e) { }
}

/**
 * Siguiente consecutivo del día. Se reinicia solo cuando cambia la fecha.
 * Si el navegador bloquea el almacenamiento, arranca en 1 y el analista
 * lo ajusta: es preferible a fallar.
 */
function consecutivoSugerido(fecha) {
    const hoy = selloFecha(fecha || new Date());
    try {
        const crudo = localStorage.getItem(CLAVE_CONSECUTIVO);
        const dato = crudo ? JSON.parse(crudo) : null;
        if (dato && dato.dia === hoy) return Number(dato.n) + 1;
    } catch (e) { /* almacenamiento bloqueado: se arranca en 1 */ }
    return 1;
}

/** Deja constancia del consecutivo usado, para no repetirlo hoy. */
function registrarConsecutivo(n, fecha) {
    const hoy = selloFecha(fecha || new Date());
    try {
        localStorage.setItem(CLAVE_CONSECUTIVO, JSON.stringify({ dia: hoy, n: Number(n) }));
    } catch (e) { /* sin almacenamiento no se puede recordar; no es crítico */ }
}

/** Arma el nombre sugerido a partir de una plantilla {prefijo, digitos}. */
function nombreArchivo(causal, consecutivo, fecha, plantilla) {
    const p = plantilla || plantillaPorId(plantillaActivaId());
    const f = fecha || new Date();
    const n = String(Math.max(1, Number(consecutivo) || 1)).padStart(p.digitos, "0");
    return `${p.prefijo}${selloFecha(f)}${n}-${causal}.pdf`;
}

/**
 * Deja un nombre escrito a mano en condiciones de guardarse: quita la ruta,
 * los caracteres que Windows no admite y garantiza la extensión .pdf.
 * No impone la convención — si el analista lo editó, sabrá por qué.
 */
function sanearNombre(nombre) {
    let n = String(nombre || "").trim().split(/[\\/]/).pop();
    n = n.replace(/[<>:"|?*\x00-\x1F]/g, "").replace(/\.+$/, "").trim();
    if (!n) return null;
    if (!/\.pdf$/i.test(n)) n += ".pdf";
    return n.slice(0, 150);
}

/* =====================================================================
   4 · CONSULTA AL CM
   ---------------------------------------------------------------------
   Este bloque es un PORTE de la lógica ya probada de «Prepagadas»
   (assets/logica-prepagadas.js): mismos servicios, mismos fallbacks y
   misma forma de subir por la cadena de cuentas hasta la cédula. Se copia
   en vez de compartirse porque cada herramienta carga su propia lógica y
   dos archivos no pueden declarar las mismas constantes globales.

   Si cambia algo aquí, conviene mirar también logica-prepagadas.js.

   Nada se inventa: lo que el CM no responda se queda vacío y el analista
   lo completa a mano.
===================================================================== */

const API = () => MEAPI.CONFIG.apiBase;

/* Estados del BSS, con las etiquetas que usa el formato de rechazo.
   1 = Activo, 2 = Desactivado, 3 = Disponible, 4 = Bloqueada. */
const ESTADOS_BSS = { 1: "Activa", 2: "DESACTIVADA", 3: "Disponible", 4: "Bloqueada" };

/* Códigos de tipo de documento del BSS. Solo el 6 está confirmado con datos
   reales; el resto se deja sin traducir para no afirmar de más. */
const TIPO_DOC_BSS = { "6": "CC" };
const tipoDocDeBSS = t => (t == null || t === "") ? null : (TIPO_DOC_BSS[String(t)] || null);

/* Cuentas del BSS sin datos reales cargados devuelven a veces el nombre de
   plantilla «FirstName LastName», con distinto espaciado o mayúsculas.
   No es el nombre de nadie: se compara sin espacios y en minúsculas para
   detectarlo venga como venga. */
const esNombrePlaceholder = nombre =>
    String(nombre || "").replace(/\s+/g, "").toLowerCase() === "firstnamelastname";

/* Un accountID puede venir como «41041348619-1»; el externalID de la cuenta
   de facturación es la parte ANTES del guion, así que esa se prueba primero
   y el valor completo queda como respaldo. */
function candidatosExternalID(ban) {
    const s = String(ban || "").trim();
    const out = [];
    [s.split("-")[0], s].forEach(v => { if (v && !out.includes(v)) out.push(v); });
    return out;
}

/**
 * Busca la cuenta de facturación por externalID, con los tres caminos que
 * usa el CMS: la consulta simple, el filtro «todo en uno» y la búsqueda por
 * ID de cuenta (las relaciones traen el ID, que no siempre es el externalID).
 */
async function buscarBillingAccount(externalID) {
    const norm = r => Array.isArray(r) ? r : (r?.billingAccounts || r?.results || []);

    let lista = norm(await getJson(`${API()}/api/v1/billingAccount`,
        { externalID, offset: 0, limit: 1 }).catch(() => null));
    if (lista.length) return lista[0];

    const filtro = [
        String(externalID),
        `id=${externalID}`,
        `contact.contactMedium.characteristic.emailAddress=${externalID}`,
        `contact.contactMedium.characteristic.phoneNumber=${externalID}`,
        "includeEmail=true"
    ].join("%3B");
    lista = norm(await getJson(
        `${API()}/api/v1/billingAccount?externalID=${filtro}&offset=0&limit=10`).catch(() => null));
    if (lista.length) return lista[0];

    const porId = await getJson(
        `${API()}/api/v1/billingAccount/${encodeURIComponent(externalID)}`).catch(() => null);
    if (porId && (porId.id || porId["@type"] === "BillingAccount")) return porId;
    if (Array.isArray(porId) && porId.length) return porId[0];
    return null;
}

/** Primer documento con número dentro de individualIdentification. */
const identDeIndividual = ind =>
    (ind?.individualIdentification || []).find(x => x.identificationId && String(x.identificationId).trim()) || null;

const MAX_SALTOS_PADRE = 5;

/**
 * Titular de una cuenta. La cuenta del BAN de la línea suele ser HIJA y la
 * cédula está en la cuenta de arriba, así que se sube por `parentId` y, cuando
 * ese campo no viene, por `accountRelationship[].account.id`.
 */
async function titularDeCuenta(ban, avisos) {
    const clave = String(ban || "").trim();
    if (!clave) return null;

    const pendientes = candidatosExternalID(clave);
    const variantesBan = new Set(pendientes);
    const vistos = new Set();
    let saltos = 0, subio = false;

    while (pendientes.length && saltos <= MAX_SALTOS_PADRE) {
        const ext = pendientes.shift();
        if (vistos.has(ext)) continue;
        vistos.add(ext);

        const acc = await buscarBillingAccount(ext);
        if (!acc) continue;

        // Ya hay cuenta: las otras variantes del BAN (con/sin sufijo) sobran.
        if (variantesBan.size) {
            for (let k = pendientes.length - 1; k >= 0; k--)
                if (variantesBan.has(pendientes[k])) pendientes.splice(k, 1);
            variantesBan.clear();
        }

        const rel = acc.relatedParty || [];
        const refInd = rel.find(p => p["@referredType"] === "Individual" || /individual\//.test(p.href || ""));
        const refCus = rel.find(p => p["@referredType"] === "Customer" || /customer\//.test(p.href || ""));

        // Respaldo confirmado con el flujo de Postman: cuando relatedParty no
        // trae Individual, el id de la cuenta puede ser el individualID.
        const individualId = refInd?.id || acc.id;
        const [individuo, cliente] = await Promise.all([
            individualId ? getJson(`${API()}/api/v1/individual/${encodeURIComponent(individualId)}`).catch(() => null) : null,
            refCus?.id ? getJson(`${API()}/api/v1/customer/${encodeURIComponent(refCus.id)}`).catch(() => null) : null
        ]);

        const ident = identDeIndividual(individuo);
        if (ident) {
            if (subio && avisos)
                avisos.push(`La cuenta del BAN era hija: la identificación se tomó de la cuenta ${acc.externalID || ext}.`);

            const nombreCrudo = cliente?.name
                || individuo?.fullName
                || [individuo?.givenName, individuo?.familyName].filter(Boolean).join(" ").trim()
                || acc.name || null;
            // Cuentas sin datos reales cargados devuelven a veces el nombre de
            // prueba «FirstName LastName». No es un dato del cliente: se trata
            // igual que si el BSS no hubiera devuelto nombre.
            const esPlaceholder = esNombrePlaceholder(nombreCrudo);
            if (esPlaceholder && avisos)
                avisos.push("El BSS devolvió el nombre de prueba «FirstName LastName»; se descarta y el campo queda vacío.");

            return {
                identificacion: String(ident.identificationId).trim(),
                tipoId: tipoDocDeBSS(ident.identificationType),
                tipoIdCrudo: ident.identificationType ?? null,
                nombre: esPlaceholder ? null : nombreCrudo
            };
        }

        // Sin documento aquí: hay que subir a la cuenta de arriba.
        if (acc.parentId) { pendientes.push(String(acc.parentId)); subio = true; saltos++; }
        (acc.accountRelationship || []).forEach(r => {
            const otro = r?.account?.id ?? r?.account?.name ?? r?.id;
            if (otro && !vistos.has(String(otro))) { pendientes.push(String(otro)); subio = true; saltos++; }
        });
    }
    return null;
}

/**
 * Trae del CM lo que se pueda para prellenar el formato. Devuelve siempre un
 * objeto; los campos que no se consigan van en null para que el formulario
 * los deje vacíos y el PDF los imprima como N/A.
 */
async function consultarCM(msisdn) {
    const salida = {
        msisdn, identificacion: null, tipoId: null, nombre: null,
        estadoLinea: null, tipoServicio: null, ban: null,
        fechaDesactivacion: null, subscriberId: null, cun: null,
        cuentas: 0, avisos: []
    };

    /* --- 1 · Suscripción: estado de la línea y fechas --- */
    let lista = [];
    try {
        const data = await getJson(`${API()}/api/v1/subscribers`, { msisdnList: msisdn, offset: 0, limit: 10 });
        // El BSS responde dentro de subscriberResponseList, no en la raíz.
        lista = data?.subscriberResponseList || [];
    } catch (e) {
        salida.avisos.push(`No se pudo consultar el BSS (${e.message}).`);
        return salida;
    }

    if (!lista.length) {
        salida.avisos.push("El BSS no tiene suscriptor para esa línea.");
        return salida;
    }

    // Una línea puede tener varios BAN. Se toma el activo más reciente y, si
    // ninguno está activo, el último creado: el mismo criterio que Prepagadas.
    salida.cuentas = lista.length;
    const porFecha = (a, b) => Number(b?.profile?.created || 0) - Number(a?.profile?.created || 0);
    const activos = lista.filter(s => s?.status?.state === 1).sort(porFecha);
    const sub = activos[0] || lista.slice().sort(porFecha)[0];

    const p = sub.profile || {}, st = sub.status || {};
    salida.subscriberId = p.identifier || null;
    salida.ban = p.accountID || null;
    salida.estadoLinea = ESTADOS_BSS[st.state] || null;
    if (lista.length > 1)
        salida.avisos.push(`La línea tiene ${lista.length} cuentas (BAN); se tomó ${salida.ban || salida.subscriberId} (${salida.estadoLinea || "estado desconocido"}).`);

    // Estado 2 = Desactivado: el inicio de ese estado es la fecha y hora de
    // desactivación que pide el formato LD.
    if (st.state === 2) {
        const f = epochFecha(st.startDate);
        if (f) salida.fechaDesactivacion = f;
        else salida.avisos.push("La línea figura desactivada pero el BSS no devolvió la fecha del estado.");
    }

    /* --- 2 · Titular: identificación y nombre --- */
    if (salida.ban || salida.subscriberId) {
        try {
            const titular = await titularDeCuenta(salida.ban || salida.subscriberId, salida.avisos);
            if (titular) {
                salida.identificacion = titular.identificacion;
                salida.tipoId = titular.tipoId;
                salida.nombre = titular.nombre;
                if (!titular.tipoId && titular.tipoIdCrudo != null)
                    salida.avisos.push(`El BSS devolvió el tipo de documento como «${titular.tipoIdCrudo}»; revisa el tipo de identificación.`);
            } else {
                salida.avisos.push("No hay identificación del titular en la cadena de cuentas del BSS.");
            }
        } catch (e) {
            salida.avisos.push(`No se pudo leer el titular (${e.message}).`);
        }
    }

    return salida;
}

/* =====================================================================
   5 · IMAGEN DE MANIFESTACIÓN
   ---------------------------------------------------------------------
   La captura que el analista pegaba en Excel. Se comprime ANTES de
   incrustarla: una captura de pantalla sin tocar pesa 1-3 MB y devolvería
   exactamente el problema de peso que esta herramienta viene a resolver.

   Se reescala a 1000 px de ancho y se guarda como JPEG de calidad 0,72,
   que para una captura de texto es indistinguible a simple vista y pesa
   entre 15 y 40 veces menos.
===================================================================== */

const IMG_ANCHO_MAX = 1000;
const IMG_CALIDAD = 0.72;

/**
 * Comprime un File/Blob de imagen. Devuelve { dataUrl, ancho, alto, bytes }
 * o lanza si el archivo no es una imagen legible.
 */
function comprimirImagen(archivo) {
    return new Promise((resolve, reject) => {
        if (!archivo || !/^image\//.test(archivo.type)) {
            reject(new Error("El archivo no es una imagen."));
            return;
        }
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const escala = Math.min(1, IMG_ANCHO_MAX / img.naturalWidth);
            const w = Math.max(1, Math.round(img.naturalWidth * escala));
            const h = Math.max(1, Math.round(img.naturalHeight * escala));

            const lienzo = document.createElement("canvas");
            lienzo.width = w; lienzo.height = h;
            const ctx = lienzo.getContext("2d");
            // Fondo blanco: los PNG con transparencia salen negros en JPEG.
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            const dataUrl = lienzo.toDataURL("image/jpeg", IMG_CALIDAD);
            resolve({
                dataUrl, ancho: w, alto: h,
                bytes: Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4),
                bytesOriginal: archivo.size
            });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
        img.src = url;
    });
}

/* =====================================================================
   6 · ARMADO DEL PDF
   ---------------------------------------------------------------------
   Se reproduce la macro: barra de título, causal, bloque de la línea,
   bloque del cliente, imagen de manifestación y bloque inferior
   «INFORMACIÓN CLIENTE» con los campos repetidos.

   Todo en Helvetica, que es una de las 14 fuentes estándar del PDF: no se
   incrusta y no pesa. Ahí está la diferencia de 190 KB con el Excel.
===================================================================== */

/* Medidas en milímetros sobre A4 vertical. */
const PAG = { ancho: 210, alto: 297, margen: 12 };
const COL_ETIQUETA = 86;              // ancho de la columna de etiquetas
const FILA_MIN = 5.6;                 // alto mínimo de fila, antes de escalar
const PIE = 9;                        // franja reservada para el pie
const ALTO_IMAGEN_MAX = 62;           // tope de la manifestación, antes de escalar
const NEGRO = [20, 20, 20];
const AMARILLO = [255, 213, 0];
const GRIS_LINEA = [200, 197, 189];
const GRIS_SUAVE = [244, 243, 239];

/* El documento debe caber en UNA página, como las macros. Se prueba de
   mayor a menor y se usa la primera escala que quepa: es el mismo
   «ajustar a una página» que hacía Excel, que imprimía al 36-57 %. */
const ESCALAS = [1, .95, .9, .85, .8, .75, .7, .65, .6, .55, .5, .45, .4];

/** Alto aprovechable de la página. */
const altoUtil = () => PAG.alto - PAG.margen - PIE;

/**
 * Construye el PDF y devuelve { blob, bytes, dataUrl, paginas, escala }.
 * `datos` es el objeto plano que arma la interfaz (ver recolectar()).
 */
function generarPDF(datos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

    // Primero se mide sin dibujar nada; después se dibuja una sola vez.
    let escala = ESCALAS[ESCALAS.length - 1];
    for (const e of ESCALAS) {
        if (recorrer({ doc, escala: e, medir: true }, datos) <= altoUtil()) { escala = e; break; }
    }
    recorrer({ doc, escala, medir: false }, datos);
    pieDePagina(doc, datos);

    // Un solo blob: el que se previsualiza es exactamente el que se descarga.
    const blob = doc.output("blob");
    return {
        blob,
        bytes: blob.size,
        dataUrl: URL.createObjectURL(blob),
        paginas: doc.getNumberOfPages(),
        escala
    };
}

/**
 * Recorre el documento entero. Con `ctx.medir` en true calcula las alturas
 * sin pintar: así la medición y el dibujo no pueden desincronizarse, porque
 * son exactamente el mismo código.
 */
function recorrer(ctx, datos) {
    const causal = CAUSALES[datos.causal];
    const k = ctx.escala;
    let y = PAG.margen;

    /* ---------- Encabezado: logos ---------- */
    if (!ctx.medir) {
        try {
            ctx.doc.addImage(LOGO_MOVIL, "PNG", PAG.margen, y, 22 * k, 7.0 * k);
            ctx.doc.addImage(LOGO_EXITO, "PNG", PAG.margen + 23.5 * k, y + 0.4 * k, 16 * k, 6.2 * k);
        } catch (e) { /* si un logo falla, el documento sigue siendo válido */ }
    }
    y += 9.5 * k;

    /* ---------- Barras de título ---------- */
    y = barra(ctx, y, "RECHAZO PORTABILIDAD", { fondo: NEGRO, texto: [255, 255, 255], tam: 11 });
    y = barra(ctx, y, "CAUSAL DE RECHAZO", { fondo: AMARILLO, texto: NEGRO, tam: 9 });
    y = barra(ctx, y, causal.nombre, { fondo: GRIS_SUAVE, texto: NEGRO, tam: 10 });
    y += 1.6 * k;

    /* ---------- Bloque 1: la línea ---------- */
    y = seccion(ctx, y, "INFORMACION DE LA LINEA");
    y = fila(ctx, y, "NÚMERO DE LÍNEA", datos.msisdn);
    y += 1.6 * k;

    /* ---------- Bloque 2: el cliente ---------- */
    y = seccion(ctx, y, "INFORMACION DEL CLIENTE");
    // Fechas propias de la causal, antes de los datos del cliente.
    causal.fechas.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.id]); });
    CAMPOS_CLIENTE.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.id]); });
    causal.extra.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.id]); });
    CAMPOS_CIERRE.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.id]); });
    y += 1.6 * k;

    /* ---------- Bloque 3: imagen de manifestación ---------- */
    y = seccion(ctx, y, "IMAGEN MANIFESTACIÓN");
    y = bloqueImagen(ctx, y, datos.imagenes);
    y += 1.6 * k;

    /* ---------- Bloque 4: resumen «INFORMACIÓN CLIENTE» ---------- */
    // La macro repite estos campos al final; se replica para que la
    // plataforma reciba el mismo documento que ya conoce.
    y = seccion(ctx, y, "INFORMACIÓN CLIENTE");
    causal.espejo.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.de]); });
    causal.cola.forEach(c => { y = fila(ctx, y, c.etiqueta, datos[c.de || c.id]); });

    return y;
}

/** Barra de ancho completo con fondo. Devuelve la nueva y. */
function barra(ctx, y, texto, o) {
    const k = ctx.escala;
    const alto = (o.tam >= 11 ? 8.2 : 6.8) * k;
    y = saltarSiNoCabe(ctx, y, alto);
    if (!ctx.medir) {
        ctx.doc.setFillColor(...o.fondo);
        ctx.doc.rect(PAG.margen, y, PAG.ancho - PAG.margen * 2, alto, "F");
        ctx.doc.setFont("helvetica", "bold").setFontSize(o.tam * k);
        ctx.doc.setTextColor(...o.texto);
        ctx.doc.text(String(texto || ""), PAG.ancho / 2, y + alto / 2 + o.tam * k * 0.12, { align: "center" });
    }
    return y + alto;
}

/** Encabezado de sección (banda amarilla estrecha). */
function seccion(ctx, y, texto) {
    const k = ctx.escala;
    const alto = 6 * k;
    y = saltarSiNoCabe(ctx, y, alto);
    if (!ctx.medir) {
        ctx.doc.setFillColor(...AMARILLO);
        ctx.doc.rect(PAG.margen, y, PAG.ancho - PAG.margen * 2, alto, "F");
        ctx.doc.setFont("helvetica", "bold").setFontSize(8.5 * k).setTextColor(...NEGRO);
        ctx.doc.text(String(texto || ""), PAG.margen + 2.5 * k, y + alto * 0.68);
    }
    return y + alto;
}

/**
 * Fila etiqueta | valor. El texto largo se parte en varias líneas y la fila
 * crece: así el «Motivo de Bloqueo/suspención» de LS nunca se corta.
 */
function fila(ctx, y, etiqueta, valor) {
    const k = ctx.escala, doc = ctx.doc;
    const anchoUtil = PAG.ancho - PAG.margen * 2;
    const colEtiqueta = COL_ETIQUETA * k;
    const anchoValor = anchoUtil - colEtiqueta - 4 * k;
    const tamEtiqueta = 7.4 * k, tamValor = 7.8 * k, salto = 3.5 * k;

    // splitTextToSize mide con la fuente activa, así que se fija antes.
    doc.setFont("helvetica", "bold").setFontSize(tamEtiqueta);
    const lineasEtiqueta = doc.splitTextToSize(String(etiqueta || ""), colEtiqueta - 4 * k);
    doc.setFont("helvetica", "normal").setFontSize(tamValor);
    const lineasValor = doc.splitTextToSize(textoValor(valor), anchoValor);

    const alto = Math.max(FILA_MIN * k,
        Math.max(lineasEtiqueta.length, lineasValor.length) * salto + 2.2 * k);
    y = saltarSiNoCabe(ctx, y, alto);

    if (!ctx.medir) {
        doc.setDrawColor(...GRIS_LINEA).setLineWidth(0.15);
        doc.rect(PAG.margen, y, anchoUtil, alto);
        doc.line(PAG.margen + colEtiqueta, y, PAG.margen + colEtiqueta, y + alto);

        doc.setFont("helvetica", "bold").setFontSize(tamEtiqueta).setTextColor(...NEGRO);
        doc.text(lineasEtiqueta, PAG.margen + 2 * k, y + 3.6 * k);
        doc.setFont("helvetica", "normal").setFontSize(tamValor).setTextColor(40, 40, 40);
        doc.text(lineasValor, PAG.margen + colEtiqueta + 2 * k, y + 3.6 * k);
    }
    return y + alto;
}

/**
 * Las imágenes adjuntas, en secuencia una debajo de otra, o el recuadro
 * rotulado que deja constancia de que no hay ninguna. El caso normal es UNA
 * sola imagen; adjuntar varias es excepcional, pero cuando ocurre se apilan
 * en el mismo orden en que se agregaron — no se recortan ni se descartan.
 *
 * Cada imagen se ajusta dentro de una caja con alto máximo. Sin ese tope,
 * una captura vertical (o varias) obligaría a encoger TODO el documento
 * para que quepa en una página, y el texto quedaría ilegible: es preferible
 * reducir las imágenes, que siguen viéndose, a reducir los datos del
 * formato. Si aun así no caben, el ajuste automático de generarPDF() reduce
 * la escala de la página entera, imágenes incluidas.
 */
function bloqueImagen(ctx, y, imagenes) {
    const k = ctx.escala, doc = ctx.doc;
    const anchoUtil = PAG.ancho - PAG.margen * 2;
    const lista = (imagenes || []).filter(im => im && im.dataUrl);

    if (lista.length) {
        const cajaAncho = Math.min(anchoUtil, 165 * k);
        const cajaAlto = ALTO_IMAGEN_MAX * k;
        lista.forEach(imagen => {
            const ajuste = Math.min(cajaAncho / imagen.ancho, cajaAlto / imagen.alto);
            const w = imagen.ancho * ajuste, h = imagen.alto * ajuste;
            const x = PAG.margen + (anchoUtil - w) / 2;   // centrada
            y = saltarSiNoCabe(ctx, y, h + 2 * k);
            if (!ctx.medir) doc.addImage(imagen.dataUrl, "JPEG", x, y + 1 * k, w, h);
            y += h + 2 * k;
        });
        return y;
    }

    const alto = 15 * k;
    y = saltarSiNoCabe(ctx, y, alto);
    if (!ctx.medir) {
        doc.setDrawColor(...GRIS_LINEA).setLineWidth(0.15);
        doc.setLineDashPattern([1, 1], 0);
        doc.rect(PAG.margen, y + 1 * k, anchoUtil, alto - 2 * k);
        doc.setLineDashPattern([], 0);
        doc.setFont("helvetica", "italic").setFontSize(7.5 * k).setTextColor(140, 140, 134);
        doc.text("Sin imagen de manifestación adjunta", PAG.ancho / 2, y + alto * 0.58, { align: "center" });
    }
    return y + alto;
}

/** Un valor vacío se escribe N/A, como en la macro. Nunca queda en blanco. */
function textoValor(v) {
    if (v == null) return "N/A";
    if (v instanceof Date) return fechaHoraTexto(v);
    const s = String(v).trim();
    return s === "" ? "N/A" : s;
}

/**
 * Abre página nueva si el bloque no cabe. Al medir NO se pagina: se deja
 * crecer la altura para que generarPDF sepa cuánto hay que encoger.
 */
function saltarSiNoCabe(ctx, y, alto) {
    if (ctx.medir || y + alto <= altoUtil()) return y;
    ctx.doc.addPage();
    return PAG.margen;
}

/** Pie con el nombre del archivo y la fecha de generación, en cada página. */
function pieDePagina(doc, datos) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(150, 150, 144);
        doc.text(datos.nombreArchivo || "", PAG.margen, PAG.alto - 8);
        doc.text(`${fechaHoraTexto(new Date())}  ·  ${i} de ${total}`,
            PAG.ancho - PAG.margen, PAG.alto - 8, { align: "right" });
    }
}

/* =====================================================================
   7 · API que consume el puente
===================================================================== */

const RECHAZO = {
    CAUSALES, CAMPOS_CLIENTE, CAMPOS_CIERRE, CAMPOS_REP_LEGAL,
    TIPOS_ID, TIPOS_PERSONA, TIPOS_SERVICIO, ESTADOS_LINEA,
    personaSegunTipoId,
    fechaHoraTexto, aInputFechaHora, diaDeInput, esDeHoy,
    normalizarMsisdn, validarIdentificacion,
    consecutivoSugerido, registrarConsecutivo, nombreArchivo, sanearNombre, selloFecha,
    plantillas, guardarPlantilla, eliminarPlantilla, plantillaPorId,
    plantillaActivaId, recordarPlantillaActiva, etiquetaPlantilla,
    consultarCM, comprimirImagen, generarPDF
};

/* =====================================================================
   MARCA · logos en base64
   ---------------------------------------------------------------------
   Van incrustados y no como archivo aparte para que la herramienta
   funcione aunque el navegador bloquee la lectura de archivos vecinos
   (que es lo que pasa al abrir con doble clic en vez del lanzador).
   Salieron de xl/media de la macro original.
===================================================================== */
const LOGO_EXITO = "data:image/png;base64,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";
const LOGO_MOVIL = "data:image/png;base64,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";
