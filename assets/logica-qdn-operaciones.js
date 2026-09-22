/* =====================================================================
   logica-qdn-operaciones.js · Operaciones de provisión sobre la línea
   ---------------------------------------------------------------------
   El validador QDN era de SOLO LECTURA. Aquí se agregan las operaciones
   que ESCRIBEN en la red de Claro: bloqueos, desbloqueos y conciliación.

   Todo sale de `interfaz.py` (consola de líneas), que es la referencia
   viva de estos servicios:

     · endpoint  PATCH {base_apigw}/APIMParOrdeProvision/.../ModifingService
     · payloads  process / action / level / relatedParty / tier / msisdn /
                 imsi / iccid / ki / features
     · reglas    `features` NUNCA viaja como "" (vacío -> " ");
                 el éxito real NO es el HTTP 200, se evalúa el cuerpo.

   Se carga DESPUÉS de logica-qdn.js y reusa lo que ya vive allí:
   `gestorQdn` (mismo OAuth2), `cfgQdn`, `evaluarNegocio()`, `filas`,
   `filaPasaFiltros()`, `consultarConReintentos()`, `ejecutarPool()` y
   `render()`. No duplica ni el token ni el parseo.

   POR QUÉ LA DOBLE CONFIRMACIÓN
   Estas llamadas afectan líneas REALES en PRODUCCIÓN y no se deshacen
   solas. Bloquear y conciliar piden dos pasos (revisar -> "seguro?");
   desbloquear pide uno. En masivo se listan TODAS las líneas antes de
   ejecutar. Cada ejecución queda con el usuario que la hizo en la
   bitácora, el registro y la exportación.
===================================================================== */

/* ---------------------------------------------------------------------
   1 · ENDPOINT Y CONSTANTES (mismos valores que interfaz.py)
--------------------------------------------------------------------- */
const RUTA_BASE_PROVISION = "/APIMParOrdeProvision/MSParOrdeProvision/SVC/Service/RSParOrdeProvision/V1";
const RUTA_MODIFYING = RUTA_BASE_PROVISION + "/ModifingService";
// DELETE / POST del mismo servicio (reset-linea-me-claro/main.py): en PDN
// van por el mismo gateway y la misma ruta base que el ModifingService.
const RUTA_DELETING = RUTA_BASE_PROVISION + "/DeletingService";
const RUTA_PROVISIONING = RUTA_BASE_PROVISION + "/provisionServiceRED";
const RELATED_PARTY = [{ id: "EXITO", role: "ServiceProvider", name: "MOVIL EXITO" }];
const TIER_OPERACION = "prepaid";
const TECNOLOGIA_PROVISION = "4G";
const NIVEL_LOCKALL = "2";
const CONCURRENCIA_OPERACION = 3;   // más bajo que en consulta: son escrituras
// Reintentos SOLO para error de conexión (la petición nunca llegó a tener
// respuesta -conexión cerrada/reset por el gateway, típico en lotes grandes
// con muchas peticiones seguidas-): ahí es seguro reintentar, no hay forma
// de que el servicio la haya procesado. Un TIMEOUT (sí hubo conexión, se
// agotó esperando la respuesta) sigue sin reintentarse solo: la operación
// pudo haberse aplicado y repetirla la duplicaría (se avisa que se verifique
// con una consulta). Backoff creciente, mismo criterio que cerrar-casos.
const REINTENTOS_CONEXION_OPERACION = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Quiénes ven "Aprovisionamiento" (DELETE/POST de la línea en el HLR/HSS).
   Se compara contra el usuario de la sesión del CM (el login de Keycloak):
   hace falta haber iniciado sesión en el CM y que esté vigente. Es una
   guarda de interfaz para que nadie lo ejecute por accidente, no un
   control de acceso del servicio (el token de Claro es el mismo para
   todos). Para habilitar a alguien más, se agrega aquí. */
const USUARIOS_PROVISION = ["jpelaezg"];

/**
 * `features` no admite cadena vacía: el servicio la rechaza. Vacío -> " ".
 * Varios valores se separan con pipe. Misma regla que normalizar_features().
 */
function normalizarFeatures(texto) {
    const partes = String(texto === null || texto === undefined ? "" : texto)
        .split("|").map(p => p.trim()).filter(Boolean);
    return partes.length ? partes.join("|") : " ";
}

/* ---------------------------------------------------------------------
   2 · CATÁLOGO DE OPERACIONES
   ---------------------------------------------------------------------
   `tipo` decide cuánta fricción pide la interfaz:
     bloqueo / conciliacion / riesgo_alto / provision -> doble confirmación
     desbloqueo                                       -> confirmación simple
   Desactivar roaming es una restricción, así que cuenta como bloqueo.

   El menú se arma por `grupo`, en este orden (lo más usado primero):
     1. Procesos      conciliación y -solo usuarios autorizados- aprovisionar
                      / desaprovisionar
     2. SIM y número  cambio de SIM (IMSI/ICCID/KI) y cambio de MSISDN
     3. Bloqueos      plegados: se usan poco. Van por `familia` (una fila por
                      familia con su par bloquear/desbloquear, con icono),
                      nunca mezclados en una sola lista.
   `etiqueta` es el nombre completo (título del modal, bitácora, registro);
   `corto` es lo que dice el botón dentro de su familia.
--------------------------------------------------------------------- */
const OPERACIONES = [
    // 1 · Procesos
    { id: "conciliation", grupo: "Procesos", etiqueta: "Conciliación de línea", tipo: "conciliacion", proceso: "conciliation", icono: "bi-arrow-repeat" },
    // "provision": NO son PATCH al ModifingService sino DELETE/POST a otros
    // dos recursos del mismo servicio (main.py de reset-linea-me-claro):
    // crean la línea en el HLR/HSS o la sacan. Solo los ve quien esté en
    // USUARIOS_PROVISION con sesión del CM vigente (`autorizado`).
    { id: "provision", grupo: "Procesos", etiqueta: "Aprovisionar (crear en el HLR/HSS)", tipo: "provision", proceso: "provision", metodo: "POST", ruta: RUTA_PROVISIONING, icono: "bi-plus-circle-fill", autorizado: true },
    { id: "deprovision", grupo: "Procesos", etiqueta: "Desaprovisionar (eliminar del HLR/HSS)", tipo: "provision", proceso: "delete", metodo: "DELETE", ruta: RUTA_DELETING, icono: "bi-dash-circle-fill", autorizado: true },

    // 2 · SIM y número. "riesgo_alto": cambia identificadores propios de la
    // línea. El valor NUEVO no puede salir del QDN ni de un archivo -nadie
    // más que el analista sabe cuál es-, así que siempre se escribe a mano,
    // línea por línea, y por eso quedan FUERA del menú masivo: aplicar el
    // mismo IMSI o MSISDN nuevo a varias líneas sería un error.
    { id: "change_imsi", grupo: "SIM y número", etiqueta: "Cambios en la SIM (IMSI, ICCID, KI)", tipo: "riesgo_alto", proceso: "change_imsi", icono: "bi-sim-fill" },
    { id: "change_msisdn", grupo: "SIM y número", etiqueta: "Cambio de número (MSISDN)", tipo: "riesgo_alto", proceso: "change_msisdn", icono: "bi-123" },

    // 3 · Bloqueos (una familia = una fila: bloquear | desbloquear)
    { id: "lockall", grupo: "Bloqueos", familia: "Bloqueo total", corto: "Bloquear", etiqueta: "Bloqueo TOTAL de la línea", tipo: "bloqueo", proceso: "lockall", icono: "bi-lock-fill" },
    { id: "unlockall", grupo: "Bloqueos", familia: "Bloqueo total", corto: "Desbloquear", etiqueta: "Desbloqueo TOTAL de la línea", tipo: "desbloqueo", proceso: "unlockall", icono: "bi-unlock-fill" },

    { id: "blqoutcl_on", grupo: "Bloqueos", familia: "Llamada saliente", corto: "Bloquear", etiqueta: "Bloquear llamada SALIENTE", tipo: "bloqueo", proceso: "blqoutcl", accion: "activate", icono: "bi-telephone-x-fill" },
    { id: "blqoutcl_off", grupo: "Bloqueos", familia: "Llamada saliente", corto: "Desbloquear", etiqueta: "Desbloquear llamada SALIENTE", tipo: "desbloqueo", proceso: "blqoutcl", accion: "deactivate", icono: "bi-telephone-fill" },
    { id: "blqinccl_on", grupo: "Bloqueos", familia: "Llamada entrante", corto: "Bloquear", etiqueta: "Bloquear llamada ENTRANTE", tipo: "bloqueo", proceso: "blqinccl", accion: "activate", icono: "bi-telephone-x-fill" },
    { id: "blqinccl_off", grupo: "Bloqueos", familia: "Llamada entrante", corto: "Desbloquear", etiqueta: "Desbloquear llamada ENTRANTE", tipo: "desbloqueo", proceso: "blqinccl", accion: "deactivate", icono: "bi-telephone-fill" },
    { id: "blqoutsms_on", grupo: "Bloqueos", familia: "SMS saliente", corto: "Bloquear", etiqueta: "Bloquear SMS SALIENTE", tipo: "bloqueo", proceso: "blqoutsms", accion: "activate", icono: "bi-send-x-fill" },
    { id: "blqoutsms_off", grupo: "Bloqueos", familia: "SMS saliente", corto: "Desbloquear", etiqueta: "Desbloquear SMS SALIENTE", tipo: "desbloqueo", proceso: "blqoutsms", accion: "deactivate", icono: "bi-send-fill" },
    { id: "blqincsms_on", grupo: "Bloqueos", familia: "SMS entrante", corto: "Bloquear", etiqueta: "Bloquear SMS ENTRANTE", tipo: "bloqueo", proceso: "blqincsms", accion: "activate", icono: "bi-envelope-x-fill" },
    { id: "blqincsms_off", grupo: "Bloqueos", familia: "SMS entrante", corto: "Desbloquear", etiqueta: "Desbloquear SMS ENTRANTE", tipo: "desbloqueo", proceso: "blqincsms", accion: "deactivate", icono: "bi-envelope-fill" },
    { id: "blqldi_on", grupo: "Bloqueos", familia: "Larga distancia (LDI)", corto: "Bloquear", etiqueta: "Bloquear larga distancia (LDI)", tipo: "bloqueo", proceso: "blqldi", accion: "activate", icono: "bi-ban" },
    { id: "blqldi_off", grupo: "Bloqueos", familia: "Larga distancia (LDI)", corto: "Desbloquear", etiqueta: "Desbloquear larga distancia (LDI)", tipo: "desbloqueo", proceso: "blqldi", accion: "deactivate", icono: "bi-globe2" },
    // La colección manda features="roaming" en estas dos (no el valor general).
    { id: "roaming_off", grupo: "Bloqueos", familia: "Roaming", corto: "Desactivar", etiqueta: "Desactivar ROAMING", tipo: "bloqueo", proceso: "roaming", accion: "deactivate", features: "roaming", icono: "bi-airplane" },
    { id: "roaming_on", grupo: "Bloqueos", familia: "Roaming", corto: "Activar", etiqueta: "Activar ROAMING", tipo: "desbloqueo", proceso: "roaming", accion: "activate", features: "roaming", icono: "bi-airplane-fill" }
];

const GRUPOS_OPERACION = ["Procesos", "SIM y número", "Bloqueos"];
// Familias de bloqueo, en el orden en que se pintan, con el icono de la fila.
const FAMILIAS_BLOQUEO = [
    { nombre: "Bloqueo total", icono: "bi-shield-lock-fill" },
    { nombre: "Llamada saliente", icono: "bi-telephone-outbound-fill" },
    { nombre: "Llamada entrante", icono: "bi-telephone-inbound-fill" },
    { nombre: "SMS saliente", icono: "bi-send" },
    { nombre: "SMS entrante", icono: "bi-envelope" },
    { nombre: "Larga distancia (LDI)", icono: "bi-globe2" },
    { nombre: "Roaming", icono: "bi-airplane" }
];
const operacionPorId = id => OPERACIONES.find(o => o.id === id) || null;
const pideDobleConfirmacion = op => op.tipo === "bloqueo" || op.tipo === "conciliacion" || op.tipo === "riesgo_alto" || op.tipo === "provision";

/** Sesión del CM vigente Y usuario en la lista: solo entonces se ofrecen
 *  las operaciones marcadas `autorizado` (aprovisionar/desaprovisionar).
 *  El usuario sale del login de Keycloak que el CM registra en la sesión
 *  compartida de la cabecera. */
function puedeAprovisionar() {
    const st = MEUI.sesion.estado("cm");
    if (!st || (st.estado !== "ok" && st.estado !== "warn")) return false;
    const usuario = String(st.usuario || "").trim().toLowerCase();
    return USUARIOS_PROVISION.some(u => u.toLowerCase() === usuario);
}

/** Qué operaciones ve ESTE usuario en ESTE contexto ("linea" | "masivo"). */
function operacionVisible(op, contexto) {
    if (op.autorizado && !puedeAprovisionar()) return false;
    // Riesgo alto: nunca en masivo (ver el catálogo) -aplicar el mismo IMSI o
    // MSISDN nuevo a varias líneas sería un error. Desaprovisionar (DELETE):
    // tampoco, es la más destructiva del catálogo y se valida línea por línea.
    // Aprovisionar (POST) y conciliación SÍ se ofrecen en masivo, pero solo
    // sobre lo marcado con checkbox (ver OPS_MASIVO_POR_SELECCION más abajo).
    if (contexto === "masivo" && (op.tipo === "riesgo_alto" || op.id === "deprovision")) return false;
    return true;
}

/** Operaciones que en el menú MASIVO se aplican solo a lo MARCADO con la
 *  casilla de la tabla (logica-qdn.js: chk-fila/chk-todas/#fSel), no a todo
 *  lo que pase el filtro como el resto (bloqueos/desbloqueos). Crear o
 *  conciliar líneas en producción a partir de un archivo merece una
 *  selección explícita, fila por fila, no solo un filtro puesto. */
const OPS_MASIVO_POR_SELECCION = new Set(["conciliation", "provision"]);

/* ---------------------------------------------------------------------
   3 · DATOS DE LA LÍNEA (IMSI / ICCID / KI) Y DE DÓNDE SALEN
   ---------------------------------------------------------------------
   El PATCH necesita el IMSI; la conciliación además el ICCID. Hay cuatro
   orígenes posibles, y el que se use SIEMPRE se muestra en pantalla para
   que nadie envíe un dato creyendo que lo dijo el HLR:

     1. manual    lo escribió el analista en el modal de la operación
     2. archivo   columna opcional imsi / iccid / ki del Excel o CSV
     3. QDN       lo devolvió la consulta (UDC_PRSSIMCD-imsi, COTA_…-iccid)
     4. derivado  ICCID = 8957 + IMSI (regla del operador; solo si falta)

   Manual gana sobre archivo, y archivo sobre QDN: si alguien se tomó el
   trabajo de escribirlo o cargarlo, no se le sobreescribe en silencio.
   La KI no la devuelve el QDN nunca: o viene del archivo, o se escribe.
   Es obligatoria en conciliación y en aprovisionar (las dos hacen un
   delete/post de la línea por dentro); en los bloqueos no se usa.
--------------------------------------------------------------------- */
const SIN_DATO = new Set(["—", "", "No Registra", null, undefined]);
const PREFIJO_ICCID = "8957";
const LARGO_IMSI = 15;

function valorQdn(f, campo) {
    const v = f && f.resumen ? f.resumen[campo] : null;
    return SIN_DATO.has(v) ? "" : String(v).trim();
}

/** ICCID = 8957 + IMSI (p. ej. 732157001050037 -> 8957732157001050037). */
function iccidDesdeImsi(imsi) {
    const d = String(imsi || "").replace(/\D/g, "");
    return d.length === LARGO_IMSI ? PREFIJO_ICCID + d : "";
}

/** Correcciones escritas a mano en el modal: msisdn -> {imsi, iccid, ki}. */
const datosManuales = new Map();

/**
 * Resuelve los tres campos con su procedencia.
 * Devuelve { imsi:{valor,origen}, iccid:{…}, ki:{…} }.
 */
function datosOperacion(f) {
    const manual = datosManuales.get(f.msisdn) || {};
    const archivo = (typeof datosArchivo !== "undefined" && datosArchivo.get(f.msisdn)) || {};
    const elegir = (campo, origenQdn) => {
        if (manual[campo]) return { valor: manual[campo], origen: "manual" };
        const qdn = origenQdn ? valorQdn(f, campo) : "";
        if (archivo[campo]) {
            // El QDN es el dato real: si la entrada trae otro valor no se
            // pisa en silencio, se muestra la diferencia para que decida.
            const distinto = qdn && soloDigitos(qdn) !== soloDigitos(archivo[campo]);
            return { valor: archivo[campo], origen: distinto ? `entrada ≠ QDN (${qdn})` : "entrada", discrepancia: distinto ? qdn : "" };
        }
        if (qdn) return { valor: qdn, origen: "QDN" };
        return { valor: "", origen: "" };
    };

    const imsi = elegir("imsi", true);
    const iccid = elegir("iccid", true);
    if (!iccid.valor && imsi.valor) {
        const derivado = iccidDesdeImsi(imsi.valor);
        if (derivado) { iccid.valor = derivado; iccid.origen = "derivado 8957+IMSI"; }
    }
    // La KI no existe en el QDN: solo manual o archivo.
    const ki = elegir("ki", false);

    return { imsi, iccid, ki };
}

/** Compatibilidad con el resto del archivo: solo el valor resuelto. */
function datoLinea(f, campo) {
    const d = datosOperacion(f)[campo];
    return d ? d.valor : "";
}

/** Campos que la operación exige. La KI es obligatoria donde el servicio
 *  hace un delete/post de la línea: el POST de aprovisionamiento (probado
 *  en PDN: sin ki responde 400) y la conciliación, que por dentro hace lo
 *  mismo. En los bloqueos no se usa. */
function camposRequeridos(op) {
    if (!op) return ["imsi"];
    if (op.proceso === "conciliation") return ["imsi", "iccid", "ki"];
    // DELETE: imsi + iccid (sin ki). POST: además la ki, obligatoria.
    if (op.tipo === "provision") return op.metodo === "POST" ? ["imsi", "iccid", "ki"] : ["imsi", "iccid"];
    // change_imsi / change_msisdn: como es un PATCH, no hace falta traer
    // todos los datos -solo el valor NUEVO del campo que de verdad cambia-.
    if (op.proceso === "change_imsi") return ["imsi_new"];
    if (op.proceso === "change_msisdn") return ["msisdn_new"];
    return ["imsi"];
}

/* ---------------------------------------------------------------------
   3b · VALORES "NUEVOS" (change_imsi / change_msisdn) Y FEATURES DINÁMICOS
   ---------------------------------------------------------------------
   Los valores NUEVOS (imsi_new, iccid_new, ki_new, msisdn_new,
   portation_status) nunca salen del QDN ni de un archivo: nadie más que
   el analista sabe cuál es el dato nuevo, así que SIEMPRE se escriben a
   mano. Se guardan en el mismo `datosManuales` que ya usan imsi/iccid/ki
   (una entrada más por MSISDN, mismo mapa).

   `features` también se vuelve editable aquí para TODAS las operaciones,
   no solo las de riesgo alto: si la línea ya tiene bloqueos activos y se
   ejecuta OTRA operación sin decirle al servicio cuáles son, el riesgo es
   que esos bloqueos se pierdan sin que nadie lo pidiera. Se detectan los
   que se pueden traducir con confianza al nombre de "process" que espera
   el PATCH, se listan aparte los que no, y el campo queda editable para
   que el analista corrija o complete.
--------------------------------------------------------------------- */

/** Valor "nuevo" (o de features/nota) escrito a mano para esta línea. */
function valorNuevo(msisdn, campo) {
    const m = datosManuales.get(msisdn) || {};
    return m[campo] || "";
}
function escribirValorNuevo(msisdn, campo, valor) {
    const previo = datosManuales.get(msisdn) || {};
    if (valor) previo[campo] = valor; else delete previo[campo];
    datosManuales.set(msisdn, previo);
}

/** Un ICCID que no empieza por 8957: se avisa, NUNCA se corrige solo. */
function iccidSospechoso(iccid) {
    const d = String(iccid || "").replace(/\D/g, "");
    return d.length > 0 && d.slice(0, PREFIJO_ICCID.length) !== PREFIJO_ICCID;
}

// Nombre de característica QDN (ver CATALOGO_BLOQUEOS en logica-qdn.js) ->
// "process" del catálogo de OPERACIONES. Solo las que se pueden traducir
// con confianza: por ejemplo "SMS" a secas (UDC_BRRSMS-status /
// UDC_SRVSMSFL-status) no dice si es entrante o saliente -blqincsms y
// blqoutsms son procesos DISTINTOS-, así que esa no se traduce sola: se
// avisa en `sinTraducir` para que el analista decida.
const BLOQUEO_A_PROCESO = {
    "UDC_BLQINCLL-status": "blqinccl",
    "UDC_BLQOUTCL-status": "blqoutcl",
    "UDC_SRVROAM-odbBaroam": "roaming",
    "UDC_SRVROAM-odbr": "roaming",
    // Solo se traduce el LDI "total" (osb4, en sus dos variantes de nombre):
    // es el que representa la restricción general de larga distancia. Los
    // más granulares del catálogo (LDI otros indicativos/osb1, LDI 444/
    // Infracel/osb2, LDI sin implementación de red/osb3) NO se traducen
    // solos a "blqldi" -no hay certeza de que equivalgan al mismo proceso-;
    // si están activos quedan en `sinTraducir` para que el analista decida.
    "UDC_BRRLDIFL-osb4": "blqldi",
    "UDC_SRVLDIFL-osb4": "blqldi"
};

/**
 * Bloqueos activos de la línea, traducidos a la lista de "features" que
 * espera el PATCH (separados por "|"). Lo que no se puede traducir con
 * confianza queda en `sinTraducir` -se avisa, no se adivina-.
 */
function featuresDeBloqueos(f) {
    const activos = f.bloqueosActivos || [];
    const procesos = new Set(), sinTraducir = [];
    activos.forEach(b => {
        const p = BLOQUEO_A_PROCESO[b.name];
        if (p) procesos.add(p); else sinTraducir.push(b.etiqueta || b.name);
    });
    return { texto: [...procesos].join("|"), sinTraducir };
}

/**
 * `features` resuelto para el PATCH de esta línea: lo que haya escrito el
 * analista a mano, o -si no ha tocado nada- lo detectado de los bloqueos
 * activos. Vacío de verdad (sin bloqueos, nadie escribió nada) se manda
 * como " " más abajo, vía normalizarFeatures().
 */
function featuresResueltos(f) {
    const manual = valorNuevo(f.msisdn, "features");
    if (manual) return { valor: manual, origen: "manual", sinTraducir: [] };
    const det = featuresDeBloqueos(f);
    return {
        valor: det.texto,
        origen: det.texto ? "detectado de los bloqueos activos" : (f.estadoProceso ? "sin bloqueos detectados" : ""),
        sinTraducir: det.sinTraducir
    };
}

/**
 * Datos de "antes" y "después" para change_imsi / change_msisdn: el valor
 * actual (de datosOperacion) + el nuevo (manual) + el ICCID nuevo derivado
 * de 8957+IMSI-nuevo si no se escribió uno -mismo criterio que el ICCID
 * actual-, y los avisos de ICCID que no empieza por 8957 (se muestran,
 * nunca se corrigen solos).
 */
function datosCambio(f, op) {
    const actual = datosOperacion(f);
    const avisos = [];
    if (actual.iccid.valor && iccidSospechoso(actual.iccid.valor)) {
        avisos.push(`El ICCID actual (${actual.iccid.valor}) no empieza por ${PREFIJO_ICCID}: revísalo antes de continuar. No se modifica solo.`);
    }

    const salida = { avisos, actual };

    if (op.proceso === "change_imsi") {
        const imsiNew = valorNuevo(f.msisdn, "imsi_new");
        let iccidNew = valorNuevo(f.msisdn, "iccid_new");
        let iccidNewOrigen = iccidNew ? "manual" : "";
        if (!iccidNew && imsiNew) {
            const derivado = iccidDesdeImsi(imsiNew);
            if (derivado) { iccidNew = derivado; iccidNewOrigen = "derivado 8957+IMSI nuevo"; }
        }
        if (iccidNew && iccidNewOrigen === "manual" && iccidSospechoso(iccidNew)) {
            avisos.push(`El ICCID nuevo (${iccidNew}) no empieza por ${PREFIJO_ICCID}: revísalo antes de continuar. No se modifica solo.`);
        }
        salida.imsi_new = imsiNew;
        salida.iccid_new = { valor: iccidNew, origen: iccidNewOrigen };
        salida.ki_new = valorNuevo(f.msisdn, "ki_new");
    }

    if (op.proceso === "change_msisdn") {
        salida.msisdn_new = valorNuevo(f.msisdn, "msisdn_new");
        // Valor visto en el único ejemplo real disponible ("0"); sin
        // documentación propia del campo, se deja editable y con ese
        // valor de partida en vez de imponerlo sin poder cambiarlo.
        salida.portation_status = valorNuevo(f.msisdn, "portation_status") || "0";
    }

    return salida;
}

/**
 * Motivo por el que una línea NO se puede operar ni pidiendo datos, o ""
 * si es operable (aunque haya que completar campos a mano).
 */
function motivoNoOperable(f, op) {
    // Aprovisionar (POST) es justamente para una línea que NO está en el
    // HLR/HSS: ahí el QDN responde 404, y eso no es un impedimento sino
    // el caso esperado. IMSI/ICCID/KI tendrán que venir del archivo o
    // escribirse a mano, porque el QDN no los tiene.
    if (op && op.metodo === "POST" && f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404) return "";
    if (f.estadoProceso !== "SUCCESS" && f.estadoProceso !== "INCONSISTENTE") {
        return "la consulta QDN no devolvió un resultado utilizable";
    }
    if (f.estadoProceso === "INCONSISTENTE") {
        return "la respuesta QDN quedó marcada como inconsistente";
    }
    return "";
}

/** Campos obligatorios que todavía están vacíos para esta línea. */
function faltantesDe(f, op) {
    if (op.proceso === "change_imsi") return valorNuevo(f.msisdn, "imsi_new") ? [] : ["imsi_new"];
    if (op.proceso === "change_msisdn") return valorNuevo(f.msisdn, "msisdn_new") ? [] : ["msisdn_new"];
    const datos = datosOperacion(f);
    return camposRequeridos(op).filter(c => !datos[c].valor);
}

// Nota libre de ESTA confirmación (una sola caja de texto para todo el
// lote, no una por línea: es el motivo de la operación, no un dato propio
// de cada MSISDN). Se reinicia cada vez que se abre una confirmación nueva.
let notaLibreActual = "";

/**
 * Nota que viaja en el PATCH: SIEMPRE lleva el usuario que ejecuta (mismo
 * criterio que la bitácora), y opcionalmente lo que el analista haya
 * escrito, separado por ". " -mismo formato del ejemplo real
 * ("usuario. Se realiza cambio de línea por x o y motivo")-.
 */
function notaOperacion() {
    const usuario = usuarioOperador();
    return notaLibreActual ? `${usuario}. ${notaLibreActual}` : usuario;
}

/** Cuerpo del PATCH, con la misma forma exacta que arma interfaz.py. */
function payloadOperacion(op, f) {
    const datos = datosOperacion(f);

    // DELETE / POST del HLR/HSS: misma forma exacta que payload_delete() y
    // payload_post() de reset-linea-me-claro/main.py. No llevan `process`
    // ni `features`: no son un PATCH.
    if (op.tipo === "provision") {
        const cuerpo = {
            relatedParty: RELATED_PARTY,
            iccid: datos.iccid.valor, imsi: datos.imsi.valor, msisdn: f.msisdn,
            tier: TIER_OPERACION
        };
        if (op.metodo === "POST") {
            cuerpo.ki = datos.ki.valor;      // obligatoria: sin ella el servicio responde 400
            cuerpo.technology = TECNOLOGIA_PROVISION;
            cuerpo.note = notaOperacion();
        }
        return cuerpo;
    }

    const cuerpo = { process: op.proceso };
    if (op.proceso === "lockall") cuerpo.level = NIVEL_LOCKALL;
    if (op.accion) cuerpo.action = op.accion;
    cuerpo.relatedParty = RELATED_PARTY;
    cuerpo.tier = TIER_OPERACION;
    cuerpo.msisdn = f.msisdn;

    if (op.proceso === "change_imsi") {
        // PATCH parcial: el ICCID/KI nuevos solo se mandan si el analista
        // los diligenció (o se derivó el ICCID del IMSI nuevo) — "no es
        // necesario ingresar todos los datos".
        const cambio = datosCambio(f, op);
        cuerpo.imsi = datos.imsi.valor;
        cuerpo.imsi_new = cambio.imsi_new;
        if (cambio.iccid_new.valor) { cuerpo.iccid = datos.iccid.valor; cuerpo.iccid_new = cambio.iccid_new.valor; }
        if (cambio.ki_new) { cuerpo.ki = datos.ki.valor; cuerpo.ki_new = cambio.ki_new; }
    } else if (op.proceso === "change_msisdn") {
        const cambio = datosCambio(f, op);
        cuerpo.msisdn_new = cambio.msisdn_new;
        cuerpo.imsi = datos.imsi.valor;
        cuerpo.portation_status = cambio.portation_status;
    } else {
        cuerpo.imsi = datos.imsi.valor;
        if (op.proceso === "conciliation") {
            cuerpo.iccid = datos.iccid.valor;
            cuerpo.ki = datos.ki.valor;   // obligatoria: la conciliación hace delete/post
        }
    }

    // `op.features` es un override fijo del CATÁLOGO (solo lo usan hoy
    // roaming_on/roaming_off, que siempre mandan features="roaming"); para
    // todo lo demás se usa el valor dinámico de esta línea -detectado de
    // sus bloqueos activos, o editado a mano-, para no perderlos al
    // ejecutar una operación que no es sobre ellos.
    cuerpo.features = normalizarFeatures(op.features || featuresResueltos(f).valor);
    cuerpo.note = notaOperacion();
    return cuerpo;
}

/* ---------------------------------------------------------------------
   4 · QUIÉN EJECUTA (para la bitácora)
   ---------------------------------------------------------------------
   El token de QDN es de servicio (client_credentials MOVILEXITO): no
   identifica a nadie. La persona sale de la sesión que dejó el lanzador,
   CM (Keycloak) o SIME.
--------------------------------------------------------------------- */
function usuarioOperador() {
    const st = MEUI.sesion.estado("cm");
    return st?.usuario || "sin sesión identificada";
}

/* ---------------------------------------------------------------------
   5 · BITÁCORA
   ---------------------------------------------------------------------
   Queda EN LA HERRAMIENTA, no en el payload: el servicio de provisión no
   define un campo de nota en ModifingService y no se inventa uno. Se ve
   en el registro y sale en la exportación de operaciones.
--------------------------------------------------------------------- */
const bitacoraOperaciones = [];

function anotarBitacora(entrada) {
    bitacoraOperaciones.push(entrada);
    MEUI.log(
        `${entrada.ok ? "✔" : "✖"} ${entrada.operacion} · ${entrada.msisdn} · ` +
        `HTTP ${entrada.httpStatus} · código ${entrada.codigo === null ? "—" : entrada.codigo}` +
        `${entrada.detalle ? " · " + entrada.detalle : ""} · por ${entrada.usuario}`,
        entrada.ok ? "ok" : "err");
}

const CABECERA_BITACORA = ["Fecha/hora", "Usuario", "MSISDN", "Operación", "process", "action",
    "IMSI", "ICCID", "IMSI nuevo", "ICCID nuevo", "KI nuevo", "MSISDN nuevo", "Portation status",
    "HTTP", "Resultado", "Código", "Message Code", "Detalle", "Nota", "Transaction ID"];

function bitacoraExport() {
    return {
        head: CABECERA_BITACORA,
        rows: bitacoraOperaciones.map(b => [
            b.hora, b.usuario, b.msisdn, b.operacion, b.proceso, b.accion || "",
            b.imsi || "", b.iccid || "",
            b.imsiNuevo || "", b.iccidNuevo || "", b.kiNuevo || "", b.msisdnNuevo || "", b.portationStatus || "",
            b.httpStatus, b.ok ? "OK" : "FALLA",
            b.codigo === null || b.codigo === undefined ? "" : b.codigo,
            b.codigoMsg || "", b.detalle || "", b.nota || "", b.transactionId || ""
        ])
    };
}

/* ---------------------------------------------------------------------
   6 · EJECUCIÓN DEL PATCH
--------------------------------------------------------------------- */
function idTransaccion() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.floor(Math.random() * 1e6);
}

async function enviarUnaVez(metodo, url, payload, cfg, token) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), cfg.timeoutMs);
    const transactionId = idTransaccion();
    const t0 = performance.now();
    try {
        const r = await fetch(url, {
            method: metodo, signal: controlador.signal,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
                "transactionId": transactionId
            },
            body: JSON.stringify(payload)
        });
        const texto = await r.text();
        let cuerpo = null;
        try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
        return {
            ok: r.ok, status: r.status, cuerpo, texto, transactionId,
            ms: Math.round(performance.now() - t0)
        };
    } finally {
        clearTimeout(temporizador);
    }
}

/**
 * Ejecuta una operación sobre UNA línea y devuelve el registro de bitácora.
 * El éxito real se lee del cuerpo con `evaluarNegocio()` (logica-qdn.js):
 * un HTTP 200 con `success:false` o `responseCode>=400` es una FALLA.
 */
async function ejecutarOperacion(op, f, cfg) {
    const hora = new Date().toISOString().replace("T", " ").slice(0, 19);
    const usuario = usuarioOperador();
    const datos = datosOperacion(f);
    const base = {
        hora, usuario, msisdn: f.msisdn, operacion: op.etiqueta,
        proceso: op.proceso, accion: op.accion || "",
        imsi: datos.imsi.valor, iccid: datos.iccid.valor,
        origenImsi: datos.imsi.origen, origenIccid: datos.iccid.origen,
        nota: notaOperacion()
    };
    // "Riesgo alto": la bitácora también deja el valor NUEVO -sin esto, el
    // registro de una operación que cambia un identificador no diría a qué
    // quedó, solo desde qué estaba.
    if (op.tipo === "riesgo_alto") {
        const cambio = datosCambio(f, op);
        if (op.proceso === "change_imsi") {
            Object.assign(base, { imsiNuevo: cambio.imsi_new, iccidNuevo: cambio.iccid_new.valor, kiNuevo: cambio.ki_new });
        } else if (op.proceso === "change_msisdn") {
            Object.assign(base, { msisdnNuevo: cambio.msisdn_new, portationStatus: cambio.portation_status });
        }
    }

    const impedimento = motivoNoOperable(f, op)
        || (faltantesDe(f, op).length ? "falta " + faltantesDe(f, op).join(" y ") : "");
    if (impedimento) {
        return Object.assign(base, {
            ok: false, httpStatus: "—", codigo: "no-operable", codigoMsg: "",
            detalle: "No se envió nada: " + impedimento, payload: null, cuerpo: null
        });
    }

    const payload = payloadOperacion(op, f);
    // Casi todo es PATCH al ModifingService; DELETE/POST (aprovisionamiento)
    // traen su propio método y ruta en el catálogo.
    const metodo = op.metodo || "PATCH";
    const url = cfg.base_apigw.replace(/\/$/, "") + (op.ruta || RUTA_MODIFYING);

    let tokenRenovado = false;
    let intentosConexion = 0;
    while (true) {
        let token;
        try {
            token = await gestorQdn.obtener(cfg, tokenRenovado);
        } catch (e) {
            return Object.assign(base, {
                ok: false, httpStatus: "—", codigo: "auth", codigoMsg: "",
                detalle: "No se pudo autenticar: " + (e.message || e), payload, cuerpo: null
            });
        }

        let resp;
        try {
            resp = await enviarUnaVez(metodo, url, payload, cfg, token);
        } catch (e) {
            const esTimeout = e && e.name === "AbortError";
            // Error de conexión (nunca hubo respuesta): reintenta solo, hasta
            // REINTENTOS_CONEXION_OPERACION veces, con espera creciente.
            if (!esTimeout && intentosConexion < REINTENTOS_CONEXION_OPERACION) {
                intentosConexion++;
                MEUI.log(`⚠ ${f.msisdn}: error de conexión (${e.message || e}) — ` +
                    `reintentando (${intentosConexion}/${REINTENTOS_CONEXION_OPERACION})…`, "warn");
                await sleep(600 * intentosConexion);
                continue;
            }
            return Object.assign(base, {
                ok: false, httpStatus: esTimeout ? "timeout" : "—",
                codigo: esTimeout ? "timeout" : "conn-err", codigoMsg: "",
                // Un timeout NO se reintenta: SÍ hubo conexión y la operación
                // pudo haberse aplicado; repetirla la duplicaría. El error de
                // conexión de arriba ya agotó sus reintentos si llegó aquí.
                detalle: esTimeout
                    ? "Tiempo de espera agotado. NO se reintenta: verifica con una consulta antes de repetir."
                    : `Error de comunicación tras ${intentosConexion + 1} intento(s): ` + (e.message || e),
                payload, cuerpo: null
            });
        }

        // 401/403: el token venció -> se renueva UNA vez y se repite.
        if ((resp.status === 401 || resp.status === 403) && !tokenRenovado) {
            tokenRenovado = true;
            gestorQdn.reset();
            continue;
        }

        const negocio = resp.cuerpo
            ? evaluarNegocio(resp.cuerpo)
            : { ok: resp.ok, codigo: resp.status, codigoMsg: null, detalle: (resp.texto || "").slice(0, 300) };
        if (!resp.ok) negocio.ok = false;

        return Object.assign(base, {
            ok: negocio.ok, httpStatus: resp.status, ms: resp.ms,
            codigo: negocio.codigo, codigoMsg: negocio.codigoMsg,
            detalle: negocio.detalle || "", transactionId: resp.transactionId,
            payload, cuerpo: resp.cuerpo, texto: resp.texto
        });
    }
}

/**
 * Vuelve a consultar el QDN de las líneas tocadas y refresca sus filas.
 * Es el mismo `qdn -> operación -> qdn` de los escenarios de interfaz.py:
 * sin esto la tabla seguiría mostrando el estado ANTERIOR a la operación.
 */
async function reconsultar(msisdns, cfg) {
    await ejecutarPool(msisdns, CONCURRENCIA_OPERACION, async (msisdn) => {
        const i = filas.findIndex(x => x.msisdn === msisdn);
        if (i < 0) return;
        const fresca = await consultarConReintentos(msisdn, cfg);
        filas[i] = Object.assign({}, filas[i], fresca);
        marcarDiscrepancias(filas[i]);
    });
    render();
}

/* ---------------------------------------------------------------------
   7 · INTERFAZ · lista de operaciones (misma forma en modal y masivo)
--------------------------------------------------------------------- */
function claseTipo(tipo) {
    if (tipo === "bloqueo" || tipo === "riesgo_alto" || tipo === "provision") return "err";
    return tipo === "conciliacion" ? "warn" : "ok";
}

/** Un botón de operación (mismo aspecto en el modal de la línea y en el
 *  menú masivo). `texto` = corto dentro de una familia, etiqueta completa
 *  fuera. */
function botonOperacionHTML(op, contexto, texto, impedimento, clase) {
    return `<button type="button"
        class="${clase || "btn btn-sm btn-me-line"} btn-operacion op-${MEUI.esc(op.tipo)}"
        data-op="${MEUI.esc(op.id)}" data-contexto="${contexto}"
        title="${MEUI.esc(impedimento ? "No disponible: " + impedimento : op.etiqueta)}"
        ${impedimento ? "disabled" : ""}>
        <i class="bi ${MEUI.esc(op.icono || "bi-circle")}"></i> ${MEUI.esc(texto)}
    </button>`;
}

/**
 * `contexto` = "linea" (modal de detalle) o "masivo" (barra de acciones).
 * En "linea" se deshabilita lo que esa línea no puede ejecutar y se explica
 * por qué; en masivo el filtro por línea se hace al confirmar.
 *
 * Orden: Procesos, SIM y número, y al final Bloqueos PLEGADOS (se usan
 * poco), una fila por familia con su par bloquear | desbloquear.
 */
function listaOperacionesHTML(contexto, f) {
    const impedimentoDe = op => (contexto === "linea" ? motivoNoOperable(f, op) : "");
    const visibles = grupo => OPERACIONES.filter(o => o.grupo === grupo && operacionVisible(o, contexto));

    const bloqueSimple = grupo => {
        const ops = visibles(grupo);
        if (!ops.length) return "";
        return `<div class="op-grupo">
            <div class="op-grupo-tit">${MEUI.esc(grupo)}</div>
            <div class="d-flex flex-wrap gap-2">
                ${ops.map(op => botonOperacionHTML(op, contexto, op.etiqueta, impedimentoDe(op))).join("")}
            </div>
        </div>`;
    };

    const bloqueos = visibles("Bloqueos");
    const bloqueBloqueos = !bloqueos.length ? "" : `<details class="op-grupo op-bloqueos">
        <summary class="op-grupo-tit"><i class="bi bi-lock"></i> Bloqueos <span class="text-muted fw-normal">(${bloqueos.length / 2} tipos)</span></summary>
        <div class="op-familias">
            ${FAMILIAS_BLOQUEO.map(fam => {
        const par = bloqueos.filter(o => o.familia === fam.nombre);
        if (!par.length) return "";
        return `<div class="op-familia">
                    <div class="op-familia-nom"><i class="bi ${MEUI.esc(fam.icono)}"></i> ${MEUI.esc(fam.nombre)}</div>
                    <div class="op-familia-par">
                        ${par.map(op => botonOperacionHTML(op, contexto, op.corto || op.etiqueta, impedimentoDe(op))).join("")}
                    </div>
                </div>`;
    }).join("")}
        </div>
    </details>`;

    return bloqueSimple("Procesos") + bloqueSimple("SIM y número") + bloqueBloqueos;
}

/** Bloque de operaciones dentro del modal de detalle de una línea. */
function pintarOperacionesLinea(f) {
    const cont = MEUI.$("#mdOperaciones");
    if (!cont) return;
    const impedimentoGeneral = motivoNoOperable(f, null);
    // Una línea que no existe en el HLR (404) no se puede operar... salvo
    // aprovisionarla, que es exactamente para eso: se avisa distinto.
    const esInexistente = f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404;
    const datos = datosOperacion(f);
    const dato = (etq, d) => `${etq} <span class="me-mono">${MEUI.esc(d.valor || "—")}</span>` +
        `${d.origen ? ` <small class="text-muted">(${MEUI.esc(d.origen)})</small>` : ""}`;
    cont.innerHTML = `
        <div class="me-hint mb-2">
            <span class="me-mono">${MEUI.esc(f.msisdn)}</span> ·
            ${dato("IMSI", datos.imsi)} · ${dato("ICCID", datos.iccid)}.
            Lo que falte se pide al confirmar y todo se puede corregir ahí.
            Quedan registradas a nombre de <b>${MEUI.esc(usuarioOperador())}</b>.
        </div>
        ${impedimentoGeneral ? `<div class="alert alert-warning py-2 mb-2">
            ${esInexistente
                ? `La línea <b>no existe en el HLR/HSS</b> (el QDN responde 404): no se puede bloquear ni conciliar.${puedeAprovisionar() ? " Sí se puede <b>aprovisionar</b> (abajo)." : ""}`
                : `No se puede operar esta línea: ${MEUI.esc(impedimentoGeneral)}.`}</div>` : ""}
        ${(f.discrepancias || []).length ? `<div class="alert alert-warning py-2 mb-2">
            <b>La entrada no coincide con el QDN</b> (el QDN es el dato real de la línea):
            ${f.discrepancias.map(d => `${MEUI.esc(d.etiqueta)} entrada <span class="me-mono">${MEUI.esc(d.entrada)}</span> ≠ QDN <span class="me-mono">${MEUI.esc(d.qdn)}</span>`).join(" · ")}.
            En el formulario se envía el de la entrada; corrígelo ahí si corresponde.</div>` : ""}
        ${puedeAprovisionar() && !datos.imsi.valor ? `<div class="me-hint mb-2">
            ${esInexistente ? "Como no existe" : `Como está <b>${MEUI.esc((f.operationalState || "sin estado").toUpperCase())}</b>`},
            el QDN no trae IMSI ni ICCID: para <b>aprovisionar</b> hay que escribir el IMSI (el ICCID se deriva solo)
            y la KI en el formulario, o cargarlos por archivo (columnas <span class="me-mono">imsi</span>,
            <span class="me-mono">iccid</span>, <span class="me-mono">ki</span>).</div>` : ""}
        ${listaOperacionesHTML("linea", f)}`;
    cont.querySelectorAll("button.btn-operacion").forEach(b => {
        b.addEventListener("click", () => abrirConfirmacion(b.dataset.op, [f.msisdn]));
    });
}

/** Menú de operaciones masivas en la barra de acciones. Riesgo alto y
 *  desaprovisionar NO se ofrecen aquí (operacionVisible), solo por línea.
 *  Conciliación y Aprovisionar sí se ofrecen, pero actúan sobre lo MARCADO
 *  con checkbox (OPS_MASIVO_POR_SELECCION), no sobre todo lo filtrado. */
function pintarMenuOperaciones() {
    const ul = MEUI.$("#menuOperaciones");
    if (!ul) return;
    const item = (op, texto) => {
        const porSel = OPS_MASIVO_POR_SELECCION.has(op.id);
        const etiquetaExtra = porSel ? `${texto} <small class="text-muted">(marcadas)</small>` : texto;
        return `<li><button type="button" class="dropdown-item btn-operacion small op-${MEUI.esc(op.tipo)}"
            data-op="${MEUI.esc(op.id)}" data-contexto="masivo"
            title="${MEUI.esc(op.etiqueta)}${porSel ? " — se aplica a lo marcado con la casilla, no a todo lo filtrado" : ""}">
            <i class="bi ${MEUI.esc(op.icono || "bi-circle")}"></i> ${etiquetaExtra}</button></li>`;
    };
    const titulo = t => `<li class="px-2 pt-2 fw-bold small text-muted">${MEUI.esc(t)}</li>`;

    let html = `<li class="px-2 pb-2 me-hint" style="max-width:320px">
            Bloqueos y desbloqueos se aplican a las <b id="opMasivoConteo">0</b> líneas
            que quedaron visibles tras los filtros. Conciliación y Aprovisionar se aplican
            solo a las <b id="opMasivoConteoSel">0</b> línea(s) <b>marcadas</b> con la
            casilla de la tabla (de las visibles). Antes de ejecutar se listan todas.
        </li>`;
    ["Procesos", "SIM y número"].forEach(grupo => {
        const ops = OPERACIONES.filter(o => o.grupo === grupo && operacionVisible(o, "masivo"));
        if (ops.length) html += titulo(grupo) + ops.map(op => item(op, op.etiqueta)).join("");
    });
    const bloqueos = OPERACIONES.filter(o => o.grupo === "Bloqueos" && operacionVisible(o, "masivo"));
    if (bloqueos.length) {
        html += titulo("Bloqueos");
        FAMILIAS_BLOQUEO.forEach(fam => {
            const par = bloqueos.filter(o => o.familia === fam.nombre);
            if (par.length) html += `<li class="op-menu-familia"><i class="bi ${MEUI.esc(fam.icono)}"></i> ${MEUI.esc(fam.nombre)}</li>`
                + par.map(op => item(op, op.corto || op.etiqueta)).join("");
        });
    }
    ul.innerHTML = html;

    ul.querySelectorAll("button.btn-operacion").forEach(b => {
        b.addEventListener("click", () => {
            const objetivo = OPS_MASIVO_POR_SELECCION.has(b.dataset.op)
                ? filas.filter(f => f.sel && filaPasaFiltros(f)).map(f => f.msisdn)
                : filas.filter(filaPasaFiltros).map(f => f.msisdn);
            abrirConfirmacion(b.dataset.op, objetivo);
        });
    });
    actualizarConteoMasivo();
}

/** Vuelve a pintar los menús de operaciones (masivo y, si el detalle de
 *  una línea está abierto, el de esa línea). Se llama cuando cambia la
 *  sesión del CM: "Aprovisionamiento" depende de quién esté conectado. */
function repintarOperaciones() {
    pintarMenuOperaciones();
    const abierto = MEUI.$("#modalDetalle.show");
    const msisdn = MEUI.$("#mdMsisdn") ? MEUI.$("#mdMsisdn").textContent.trim() : "";
    if (abierto && msisdn) {
        const f = filaDe(msisdn);
        if (f) pintarOperacionesLinea(f);
    }
}

function actualizarConteoMasivo() {
    const visibles = filas.filter(filaPasaFiltros);
    const el = MEUI.$("#opMasivoConteo");
    if (el) el.textContent = visibles.length;
    const elSel = MEUI.$("#opMasivoConteoSel");
    if (elSel) elSel.textContent = visibles.filter(f => f.sel).length;
}

/* ---------------------------------------------------------------------
   8 · CONFIRMACIÓN (revisar -> "seguro?") Y EJECUCIÓN
--------------------------------------------------------------------- */
let operacionEnCurso = null;   // { op, objetivo: [filas], bloqueadas: [...] }

function abrirConfirmacion(opId, msisdns) {
    const op = operacionPorId(opId);
    if (!op) return;

    const candidatas = msisdns.map(m => filaDe(m)).filter(Boolean);
    const objetivo = [], bloqueadas = [];
    candidatas.forEach(f => {
        const motivo = motivoNoOperable(f, op);
        if (motivo) bloqueadas.push({ msisdn: f.msisdn, motivo });
        else objetivo.push(f);
    });

    operacionEnCurso = { op, objetivo, bloqueadas };
    const requeridos = camposRequeridos(op);
    notaLibreActual = "";   // cada confirmación nueva empieza con la nota en blanco

    MEUI.$("#opTitulo").textContent = op.etiqueta;
    MEUI.$("#opResultado").innerHTML = "";
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#opPaso1").hidden = false;

    const esRiesgoAlto = op.tipo === "riesgo_alto" || op.tipo === "provision";
    const muestra = objetivo[0] ? payloadOperacion(op, objetivo[0]) : null;
    MEUI.$("#opCuerpo").innerHTML = `
        <div class="d-flex flex-wrap gap-3 align-items-center mb-2">
            <span class="badge-estado ${claseTipo(op.tipo)}">${esRiesgoAlto ? "RIESGO ALTO" : MEUI.esc(op.tipo.toUpperCase())}</span>
            <span class="me-mono text-muted">${op.tipo === "provision"
            ? `${MEUI.esc(op.metodo)} …${MEUI.esc(op.ruta.split("/").pop())}`
            : `process=${MEUI.esc(op.proceso)}${op.accion ? " · action=" + MEUI.esc(op.accion) : ""}${op.proceso === "lockall" ? " · level=" + NIVEL_LOCKALL : ""}`}</span>
            <span class="text-muted small">Ejecuta: <b>${MEUI.esc(usuarioOperador())}</b></span>
        </div>

        <div class="alert ${objetivo.length > 1 || esRiesgoAlto ? "alert-danger" : "alert-warning"} py-2">
            línea${objetivo.length === 1 ? "" : "s"}.
            ${op.tipo === "provision"
            ? (op.metodo === "DELETE"
                ? "<b>Saca la línea del HLR/HSS</b>: queda sin servicio hasta que se vuelva a aprovisionar. "
                : "<b>Crea la línea en el HLR/HSS</b> con el IMSI/ICCID/KI indicados: si alguno está mal, la SIM no va a registrar. ")
            : esRiesgoAlto ? "<b>Cambia un identificador propio de la línea</b> -esto puede dejarla sin servicio si el dato nuevo es incorrecto. " : ""}
            Esta acción no se deshace sola.
        </div>

        <div class="op-seccion-tit">Líneas afectadas <span class="op-conteo">${objetivo.length}</span></div>
        ${objetivo.length ? `<div class="tabla-operacion-scroll">
            <table class="table table-sm mb-0 tabla-operacion">
                ${tablaConfirmacionEncabezado(op, requeridos)}
                <tbody>${objetivo.map(f => filaConfirmacion(op, f, requeridos)).join("")}</tbody>
            </table></div>
            <div class="me-hint mt-1">
                ${op.tipo === "provision"
                ? `Los valores vienen del archivo, de la consulta QDN o derivados (<span class="me-mono">ICCID = ${PREFIJO_ICCID} + IMSI</span>) y se pueden corregir aquí.${op.metodo === "POST" ? " La <b>KI</b> es <b>obligatoria</b> y el QDN nunca la da: viene de la columna <span class=\"me-mono\">ki</span> del archivo o se escribe aquí." : ""}`
                : esRiesgoAlto
                    ? `Es un PATCH parcial: solo hace falta llenar lo que de verdad cambia.`
                    : `Los valores vienen del archivo, de la consulta QDN o derivados (<span class="me-mono">ICCID = ${PREFIJO_ICCID} + IMSI</span>) y se pueden corregir aquí.${op.proceso === "conciliation" ? " La <b>KI</b> es <b>obligatoria</b> (la conciliación hace un delete/post de la línea) y el QDN nunca la da: viene de la columna <span class=\"me-mono\">ki</span> del archivo o se escribe aquí." : ""}`}
                ${op.tipo === "provision" ? "" : "<b>Features</b> lleva los bloqueos que ya tiene la línea, para no perderlos al ejecutar."}
            </div>`
            : `<div class="alert alert-danger py-2 mb-0">Ninguna línea de la selección se puede operar.</div>`}

        ${bloqueadas.length ? `
            <details class="op-plegable mt-3">
                <summary>Se omiten <span class="op-conteo">${bloqueadas.length}</span></summary>
                <ul class="me-hint mb-0 mt-1" style="max-height:140px;overflow:auto">
                    ${bloqueadas.map(b => `<li><span class="me-mono">${MEUI.esc(b.msisdn)}</span> — ${MEUI.esc(b.motivo)}</li>`).join("")}
                </ul>
            </details>` : ""}

        <div id="opAvisoFaltantes"></div>

        <div class="mt-3">
            <label class="me-lbl" for="opNota">Nota (opcional)</label>
            <textarea id="opNota" class="form-control form-control-sm" rows="2"
                placeholder="Motivo de la operación -se agrega a la nota junto a tu usuario-">${MEUI.esc(notaLibreActual)}</textarea>
            <div class="me-hint">Se envía como <span class="me-mono" id="opNotaVista">"${MEUI.esc(notaOperacion())}"</span></div>
        </div>

        ${muestra ? `<details class="op-plegable mt-3">
            <summary>Cuerpo que se envía${objetivo.length > 1 ? " (ejemplo de la primera línea)" : ""}</summary>
            <pre class="json me-mono mb-0 mt-1" id="opPayload">${MEUI.esc(JSON.stringify(muestra, null, 2))}</pre>
        </details>` : ""}`;

    // Cada input escribe en `datosManuales` y revalida en caliente. Los
    // campos de texto libre (KI, features, nota) NO se limpian a solo
    // dígitos -KI es hexadecimal, features usa letras y "|"-.
    const CAMPOS_TEXTO_LIBRE = new Set(["ki", "ki_new", "features"]);
    MEUI.$("#opCuerpo").querySelectorAll("input[data-campo]").forEach(inp => {
        inp.addEventListener("input", () => {
            const msisdn = inp.dataset.msisdn, campo = inp.dataset.campo;
            const limpio = CAMPOS_TEXTO_LIBRE.has(campo) ? inp.value.trim() : inp.value.replace(/\D/g, "");
            escribirValorNuevo(msisdn, campo, limpio);
            // Escribir el IMSI (actual o nuevo) vuelve a derivar su ICCID
            // correspondiente si no lo pusieron a mano.
            if (campo === "imsi") refrescarIccidDerivado(msisdn);
            if (campo === "imsi_new") refrescarIccidNuevoDerivado(msisdn);
            revalidarConfirmacion();
        });
    });
    const notaEl = MEUI.$("#opNota");
    if (notaEl) notaEl.addEventListener("input", () => {
        notaLibreActual = notaEl.value.trim();
        const vista = MEUI.$("#opNotaVista");
        if (vista) vista.textContent = `"${notaOperacion()}"`;
        revalidarConfirmacion();
    });

    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpSeguro").hidden = true;
    const btn = MEUI.$("#btnOpGuardar");
    btn.hidden = false;
    btn.textContent = pideDobleConfirmacion(op) ? "Guardar" : "Ejecutar";
    btn.className = "btn btn-sm " + (pideDobleConfirmacion(op) ? "btn-warning" : "btn-me");
    revalidarConfirmacion();

    bootstrap.Modal.getOrCreateInstance("#modalOperacion").show();
}

/** Campo editable (sin <td>): input + pie de origen/aviso.
 *  El <div.me-hint> se emite SIEMPRE, aunque vaya vacío: los campos
 *  derivados (el ICCID que sale de 8957+IMSI) lo rellenan después, al
 *  escribir el IMSI, y necesitan encontrarlo ya en el DOM. */
function campoInput({ msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio }) {
    const hint = pie || (obligatorio && !valor ? "sin dato: escríbelo" : "");
    return `<input type="text" ${textoLibre ? "" : 'inputmode="numeric"'}
            class="form-control form-control-sm me-mono ${invalidaSiVacio && !valor ? "is-invalid" : ""}"
            data-msisdn="${MEUI.esc(msisdn)}" data-campo="${campo}"
            value="${MEUI.esc(valor || "")}"
            placeholder="${obligatorio ? "obligatorio" : "opcional"}">
        <div class="me-hint">${MEUI.esc(hint)}</div>`;
}

/** Celda editable genérica. */
function celdaInput(opciones) {
    return `<td>${campoInput(opciones)}</td>`;
}

/** Celda de solo lectura (el dato actual, cuando la operación no lo toca). */
function celdaLectura(valor) {
    return `<td class="align-top me-mono">${MEUI.esc(valor || "—")}</td>`;
}

/** Celda "de X a Y": el valor actual y el nuevo en dos filas alineadas y
 *  etiquetadas, en vez de un texto suelto con una flecha encima del input.
 *  Antes se solapaban -el valor actual iba en `nowrap` y el input tenía un
 *  ancho mínimo, así que entre los dos desbordaban la columna- y no se
 *  entendía cuál era el valor viejo y cuál el nuevo. */
function celdaCambio({ actual, msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio }) {
    const sinCambio = !valor;
    return `<td>
        <div class="cambio">
            <div class="cambio-fila">
                <span class="cambio-lbl">antes</span>
                <span class="cambio-actual me-mono" title="${MEUI.esc(actual || "sin dato")}">${MEUI.esc(actual || "—")}</span>
            </div>
            <div class="cambio-fila">
                <span class="cambio-lbl ${sinCambio ? "" : "nuevo"}">después</span>
                <div class="cambio-campo">${campoInput({ msisdn, campo, valor, obligatorio, textoLibre, pie, invalidaSiVacio })}</div>
            </div>
        </div>
    </td>`;
}

/** Encabezado de la tabla de confirmación: cambia según la operación. */
function tablaConfirmacionEncabezado(op, requeridos) {
    if (op.proceso === "change_imsi") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>IMSI</th>
            <th>ICCID</th>
            <th>KI <small>(opcional)</small></th>
            <th class="col-features">Features</th>
        </tr></thead>`;
    }
    if (op.proceso === "change_msisdn") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>MSISDN</th>
            <th>IMSI <small>(no cambia)</small></th>
            <th>Portation status</th>
            <th class="col-features">Features</th>
        </tr></thead>`;
    }
    if (op.tipo === "provision") {
        return `<thead><tr>
            <th class="col-linea">Línea</th>
            <th>IMSI</th>
            <th>ICCID</th>
            ${op.metodo === "POST" ? "<th>KI <small>(obligatoria)</small></th>" : ""}
        </tr></thead>`;
    }
    return `<thead><tr>
        <th class="col-linea">Línea</th>
        <th>IMSI</th>
        ${requeridos.indexOf("iccid") >= 0 ? `<th>ICCID</th><th>KI <small>(${requeridos.indexOf("ki") >= 0 ? "obligatoria" : "opcional"})</small></th>` : ""}
        <th class="col-features">Features</th>
    </tr></thead>`;
}

/** Primera columna: la línea y su estado juntos, que es como se leen.
 *  Antes iban en dos columnas y el estado le robaba ancho al resto. */
function celdaLinea(f) {
    const inexistente = f.estadoProceso === "ERROR" && Number(f.httpStatus) === 404;
    return `<td class="col-linea">
        <div class="me-mono linea-msisdn">${MEUI.esc(f.msisdn)}</div>
        <div class="me-hint">${inexistente ? "NO EXISTE EN HLR (404)" : MEUI.esc((f.operationalState || "—").toUpperCase())}</div>
    </td>`;
}

/** Celda de Features: el valor editable y, debajo, solo el resumen de
 *  cuántos bloqueos se detectaron. El detalle (cuáles, y los que no se
 *  pudieron traducir) va en el `title`, no ocupando tres renglones en la
 *  tabla -era el "exceso de información" de esta columna-. */
function celdaFeatures(f) {
    const r = featuresResueltos(f);
    const trozos = r.valor ? r.valor.split("|").filter(Boolean) : [];
    let resumen, detalle;
    if (r.origen === "manual") {
        resumen = "editado a mano";
        detalle = "Valor escrito por ti; no se vuelve a calcular solo.";
    } else if (trozos.length) {
        resumen = `${trozos.length} bloqueo${trozos.length === 1 ? "" : "s"} detectado${trozos.length === 1 ? "" : "s"}`;
        detalle = "Detectados de los bloqueos activos: " + trozos.join(", ");
    } else {
        resumen = "sin bloqueos";
        detalle = "La línea no tiene bloqueos activos que reenviar.";
    }
    if (r.sinTraducir.length) {
        resumen += ` · ${r.sinTraducir.length} sin traducir`;
        detalle += ` — sin traducción automática: ${r.sinTraducir.join(", ")} (agrégalo aquí si aplica).`;
    }
    return `<td class="col-features">
        ${campoInput({
        msisdn: f.msisdn, campo: "features",
        valor: valorNuevo(f.msisdn, "features") || r.valor,
        obligatorio: false, textoLibre: true
    })}
        <div class="me-hint ${r.sinTraducir.length ? "hint-aviso" : ""}" title="${MEUI.esc(detalle)}">${MEUI.esc(resumen)}</div>
    </td>`;
}

/** Una fila de la tabla de confirmación. Tres formas según la operación. */
function filaConfirmacion(op, f, requeridos) {
    const cambio = op.tipo === "riesgo_alto" ? datosCambio(f, op) : null;

    if (op.proceso === "change_imsi") {
        return `<tr>
            ${celdaLinea(f)}
            ${celdaCambio({
            actual: cambio.actual.imsi.valor, msisdn: f.msisdn, campo: "imsi_new",
            valor: cambio.imsi_new, obligatorio: true, invalidaSiVacio: true
        })}
            ${celdaCambio({
            actual: cambio.actual.iccid.valor, msisdn: f.msisdn, campo: "iccid_new",
            valor: cambio.iccid_new.valor, obligatorio: false, pie: cambio.iccid_new.origen
        })}
            ${celdaCambio({
            actual: cambio.actual.ki.valor, msisdn: f.msisdn, campo: "ki_new",
            valor: cambio.ki_new, obligatorio: false, textoLibre: true
        })}
            ${celdaFeatures(f)}
        </tr>`;
    }

    if (op.proceso === "change_msisdn") {
        return `<tr>
            ${celdaLinea(f)}
            ${celdaCambio({
            actual: f.msisdn, msisdn: f.msisdn, campo: "msisdn_new",
            valor: cambio.msisdn_new, obligatorio: true, invalidaSiVacio: true
        })}
            ${celdaLectura(cambio.actual.imsi.valor)}
            ${celdaInput({
            msisdn: f.msisdn, campo: "portation_status", valor: cambio.portation_status,
            obligatorio: false, pie: 'ejemplo: "0"'
        })}
            ${celdaFeatures(f)}
        </tr>`;
    }

    // Operaciones existentes (bloqueo/desbloqueo/conciliación/roaming): aquí
    // no hay "antes y después" -los campos solo identifican la línea ante el
    // QDN, no cambian de valor-, así que van como campos sueltos.
    const datos = datosOperacion(f);
    const celda = campo => celdaInput({
        msisdn: f.msisdn, campo, valor: datos[campo].valor,
        obligatorio: requeridos.indexOf(campo) >= 0, invalidaSiVacio: requeridos.indexOf(campo) >= 0,
        textoLibre: campo === "ki", pie: datos[campo].origen
    });
    if (op.tipo === "provision") {
        return `<tr>
            ${celdaLinea(f)}
            ${celda("imsi")}
            ${celda("iccid")}
            ${op.metodo === "POST" ? celda("ki") : ""}
        </tr>`;
    }
    return `<tr>
        ${celdaLinea(f)}
        ${celda("imsi")}
        ${requeridos.indexOf("iccid") >= 0 ? celda("iccid") + celda("ki") : ""}
        ${celdaFeatures(f)}
    </tr>`;
}

/** Al cambiar el IMSI actual se recalcula el ICCID actual derivado. */
function refrescarIccidDerivado(msisdn) {
    const inp = MEUI.$(`#opCuerpo input[data-campo="iccid"][data-msisdn="${msisdn}"]`);
    if (!inp) return;
    const manual = datosManuales.get(msisdn) || {};
    if (manual.iccid) return;                       // lo escribieron: no se toca
    const f = filaDe(msisdn);
    if (!f) return;
    const datos = datosOperacion(f);
    inp.value = datos.iccid.valor;
    const pie = inp.parentElement.querySelector(".me-hint");
    if (pie) pie.textContent = datos.iccid.origen || "sin dato: escríbelo";
    inp.classList.toggle("is-invalid", !datos.iccid.valor);
}

/** Al cambiar el IMSI NUEVO (change_imsi) se recalcula el ICCID nuevo
 *  derivado -mismo criterio que refrescarIccidDerivado, para el par nuevo-. */
function refrescarIccidNuevoDerivado(msisdn) {
    const inp = MEUI.$(`#opCuerpo input[data-campo="iccid_new"][data-msisdn="${msisdn}"]`);
    if (!inp) return;
    const manual = datosManuales.get(msisdn) || {};
    if (manual.iccid_new) return;                    // lo escribieron: no se toca
    const f = filaDe(msisdn);
    if (!f) return;
    const cambio = datosCambio(f, { proceso: "change_imsi" });
    inp.value = cambio.iccid_new.valor;
    const pie = inp.parentElement.querySelector(".me-hint");
    if (pie) pie.textContent = cambio.iccid_new.origen || "sin dato";
}

/** Habilita o bloquea el botón según falten campos obligatorios. */
function revalidarConfirmacion() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    const incompletas = objetivo.filter(f => faltantesDe(f, op).length);

    const aviso = MEUI.$("#opAvisoFaltantes");
    if (aviso) {
        aviso.innerHTML = incompletas.length
            ? `<div class="alert alert-warning py-2 mt-2 mb-0">
                 Faltan datos obligatorios en <b>${incompletas.length}</b> línea(s):
                 ${MEUI.esc(incompletas.slice(0, 8).map(f => f.msisdn).join(", "))}${incompletas.length > 8 ? "…" : ""}.
                 Complétalos arriba para poder continuar.
               </div>`
            : "";
    }

    const payload = MEUI.$("#opPayload");
    if (payload && objetivo.length && !faltantesDe(objetivo[0], op).length) {
        payload.textContent = JSON.stringify(payloadOperacion(op, objetivo[0]), null, 2);
    }

    const btn = MEUI.$("#btnOpGuardar");
    if (btn) btn.disabled = !objetivo.length || incompletas.length > 0;
}

/** Paso 1 -> paso 2 en bloqueo y conciliación; ejecución directa si no. */
function confirmarPaso1() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    if (!objetivo.length) return;

    if (objetivo.some(f => faltantesDe(f, op).length)) { revalidarConfirmacion(); return; }
    if (!pideDobleConfirmacion(op)) { correrOperacion(); return; }

    MEUI.$("#opPaso1").hidden = true;
    MEUI.$("#opPaso2").hidden = false;
    MEUI.$("#btnOpGuardar").hidden = true;
    MEUI.$("#btnOpVolver").hidden = false;
    MEUI.$("#btnOpSeguro").hidden = false;
    MEUI.$("#opSeguroTexto").innerHTML =
        `¿Seguro? Vas a <b>${MEUI.esc(op.etiqueta.toLowerCase())}</b> en producción sobre ` +
        `<b>${objetivo.length}</b> línea${objetivo.length === 1 ? "" : "s"}` +
        `${objetivo.length === 1 ? ` (<span class="me-mono">${MEUI.esc(objetivo[0].msisdn)}</span>)` : ""}. ` +
        `Queda registrado a nombre de <b>${MEUI.esc(usuarioOperador())}</b>.`;
}

function volverPaso1() {
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#opPaso1").hidden = false;
    MEUI.$("#btnOpSeguro").hidden = true;
    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpGuardar").hidden = false;
}

async function correrOperacion() {
    if (!operacionEnCurso) return;
    const { op, objetivo } = operacionEnCurso;
    const cfg = cfgQdn;

    MEUI.$("#opPaso1").hidden = true;
    MEUI.$("#opPaso2").hidden = true;
    MEUI.$("#btnOpGuardar").hidden = true;
    MEUI.$("#btnOpVolver").hidden = true;
    MEUI.$("#btnOpSeguro").hidden = true;
    const salida = MEUI.$("#opResultado");
    salida.innerHTML = `<div class="me-hint">Ejecutando <b>${MEUI.esc(op.etiqueta)}</b> sobre ${objetivo.length} línea(s)…</div>`;

    MEUI.log(`▶ ${op.etiqueta} sobre ${objetivo.length} línea(s) · ejecuta ${usuarioOperador()}`, "warn");

    const resultados = [];
    await ejecutarPool(objetivo, CONCURRENCIA_OPERACION, async (f) => {
        const r = await ejecutarOperacion(op, f, cfg);
        anotarBitacora(r);
        resultados.push(r);
        salida.innerHTML = `<div class="me-hint">Ejecutando… ${resultados.length} / ${objetivo.length}</div>`;
    });
    resultados.sort((a, b) => objetivo.findIndex(f => f.msisdn === a.msisdn) - objetivo.findIndex(f => f.msisdn === b.msisdn));

    const ok = resultados.filter(r => r.ok).length;
    salida.innerHTML = `
        <div class="alert ${ok === resultados.length ? "alert-success" : "alert-warning"} py-2">
            <b>${ok} de ${resultados.length}</b> operación(es) con resultado exitoso.
            ${ok === resultados.length ? "" : "Revisa el detalle: un HTTP 200 con error en el cuerpo cuenta como falla."}
        </div>
        <div style="max-height:260px;overflow:auto">
        <table class="table table-sm table-striped mb-0">
            <thead><tr><th>MSISDN</th><th>Resultado</th><th>HTTP</th><th>Código</th><th>Detalle</th></tr></thead>
            <tbody>${resultados.map(r => `<tr>
                <td class="me-mono">${MEUI.esc(r.msisdn)}</td>
                <td><span class="badge-estado ${r.ok ? "ok" : "err"}">${r.ok ? "OK" : "FALLA"}</span></td>
                <td class="me-mono">${MEUI.esc(String(r.httpStatus))}</td>
                <td class="me-mono">${MEUI.esc(String(r.codigo === null || r.codigo === undefined ? "—" : r.codigo))}</td>
                <td>${MEUI.esc([r.codigoMsg, r.detalle].filter(Boolean).join(" · ") || "—")}</td>
            </tr>`).join("")}</tbody>
        </table></div>
        <div class="me-hint mt-2">Verificando el estado real con una consulta QDN…</div>`;

    MEUI.toast(`${op.etiqueta}: ${ok}/${resultados.length} con éxito.`, ok === resultados.length ? "ok" : "warn");

    // Verificación: la tabla debe reflejar el estado DESPUÉS de la operación.
    await reconsultar(objetivo.map(f => f.msisdn), cfg);
    salida.insertAdjacentHTML("beforeend",
        `<div class="me-hint">Consulta de verificación terminada: la tabla ya muestra el estado actual.</div>`);
    operacionEnCurso = null;
}

/* ---------------------------------------------------------------------
   9 · INICIALIZACIÓN
--------------------------------------------------------------------- */
function inicializarOperaciones() {
    const guardar = MEUI.$("#btnOpGuardar");
    const seguro = MEUI.$("#btnOpSeguro");
    const volver = MEUI.$("#btnOpVolver");
    if (guardar) guardar.addEventListener("click", confirmarPaso1);
    if (seguro) seguro.addEventListener("click", correrOperacion);
    if (volver) volver.addEventListener("click", volverPaso1);

    const bitacora = MEUI.$("#btnBitacora");
    if (bitacora) bitacora.addEventListener("click", () => {
        if (!bitacoraOperaciones.length) { MEUI.toast("Todavía no se ha ejecutado ninguna operación.", "warn"); return; }
        const { head, rows } = bitacoraExport();
        MEUI.exportarCSV(head, rows, "bitacora_operaciones");
    });

    pintarMenuOperaciones();
}
inicializarOperaciones();
