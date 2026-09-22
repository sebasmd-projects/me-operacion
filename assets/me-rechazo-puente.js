/* =====================================================================
   me-rechazo-puente.js · Enganche entre logica-rechazo.js y el shell
   ---------------------------------------------------------------------
   Aquí vive solo la interfaz: pintar el formulario según la causal, leer
   lo que el analista escribió, pedirle a la lógica el PDF y mostrarlo.
   Ninguna regla de negocio: eso está en logica-rechazo.js.
===================================================================== */
(function () {
    "use strict";

    const $ = MEUI.$, $$ = MEUI.$$;
    const R = RECHAZO;

    /* Estado de la pantalla. `pdf` guarda el último documento generado
       para que «Descargar» entregue exactamente lo que se ve en pantalla. */
    const estado = {
        causal: "FC",
        // Lo normal es UNA imagen; adjuntar varias es excepcional, pero
        // cuando pasa se apilan en el PDF en el mismo orden de esta lista.
        imagenes: [],
        pdf: null,
        nombreEditado: false,  // si el analista tocó el nombre, no se pisa
        // Campos con dato propio: los que el analista escribió o los que trajo
        // el CM. Al cambiar de causal se respetan; los demás vuelven al valor
        // por defecto de la causal nueva.
        tocados: new Set()
    };

    const MAX_IMAGENES = 6;   // tope razonable para un documento de una página

    /* =====================================================================
       1 · Pintado del formulario
       ---------------------------------------------------------------------
       Los campos salen del catálogo de la causal, no están escritos a mano:
       si mañana cambia un formato, se toca CAUSALES y esto se adapta solo.
    ===================================================================== */

    /** Un control de formulario según el tipo declarado en el catálogo. */
    function control(campo, valor) {
        const id = `f_${campo.id}`;
        const marca = campo.delCM ? ' data-cm="1"' : "";

        if (campo.tipo === "fechaHora") {
            // step="1" es lo que hace que el control muestre y conserve los
            // segundos; sin él el navegador los recorta al guardar el valor.
            return `<input type="datetime-local" step="1" class="form-control form-control-sm me-mono"
                        id="${id}" data-campo="${campo.id}"${marca} value="${MEUI.esc(valor || "")}"
                        data-dia="${MEUI.esc(R.diaDeInput(valor))}">`;
        }
        if (campo.tipo === "estadoLinea") {
            // Desplegable abierto: sugiere los estados conocidos pero admite
            // escribir uno que no esté en la lista.
            return `<input type="text" class="form-control form-control-sm" list="dl_estados"
                        id="${id}" data-campo="${campo.id}"${marca}
                        value="${MEUI.esc(valor || "")}" placeholder="N/A" autocomplete="off">
                <datalist id="dl_estados">
                    ${R.ESTADOS_LINEA.map(e => `<option value="${MEUI.esc(e)}"></option>`).join("")}
                </datalist>`;
        }
        if (campo.tipo === "textoLargo") {
            return `<textarea class="form-control form-control-sm" rows="3" placeholder="N/A"
                        id="${id}" data-campo="${campo.id}"${marca}>${MEUI.esc(valor || "")}</textarea>`;
        }
        if (campo.tipo === "tipoId") {
            return `<select class="form-select form-select-sm me-mono" id="${id}" data-campo="${campo.id}"${marca}>
                ${R.TIPOS_ID.map(t => `<option${t === valor ? " selected" : ""}>${t}</option>`).join("")}
            </select>`;
        }
        if (campo.tipo === "tipoPersona") {
            return `<select class="form-select form-select-sm me-mono" id="${id}" data-campo="${campo.id}"${marca}>
                ${R.TIPOS_PERSONA.map(t => `<option${t === valor ? " selected" : ""}>${t}</option>`).join("")}
            </select>`;
        }
        if (campo.tipo === "tipoServicio") {
            return `<select class="form-select form-select-sm me-mono" id="${id}" data-campo="${campo.id}"${marca}>
                ${R.TIPOS_SERVICIO.map(t => `<option${t === valor ? " selected" : ""}>${t}</option>`).join("")}
            </select>`;
        }
        // El marcador «N/A» avisa de lo que se imprimirá si el campo se deja
        // en blanco, sin escribirlo como si fuera un dato diligenciado.
        return `<input type="text" class="form-control form-control-sm" id="${id}" placeholder="N/A"
                    data-campo="${campo.id}"${marca} value="${MEUI.esc(valor || "")}">`;
    }

    /** Una fila etiqueta + control. */
    function filaCampo(campo, valor) {
        const pista = campo.delCM ? '<span class="pista-cm" title="Se trae del CM">CM</span>' : "";
        const req = campo.requerido ? '<span class="req" title="Obligatorio">•</span>' : "";
        return `<div class="campo" data-campo-caja="${campo.id}">
            <label class="me-lbl" for="f_${campo.id}">${MEUI.esc(campo.etiqueta)}${req}${pista}</label>
            ${control(campo, valor)}
        </div>`;
    }

    /**
     * Todos los campos que se pintan, en el orden del formato. Los que son
     * copia de otro (`de`) no se pintan: se resuelven al recolectar.
     */
    function camposDe(causal) {
        return [].concat(causal.fechas, R.CAMPOS_CLIENTE, causal.extra, R.CAMPOS_CIERRE, causal.cola)
            .filter(f => !f.de);
    }

    /** Campo del catálogo de la causal activa, por su id. */
    function campoPorId(id) {
        return camposDe(R.CAUSALES[estado.causal]).find(f => f.id === id) || null;
    }

    /** Fecha que debe seguir el reloj mientras el analista no la fije a mano. */
    const siguePorReloj = campo => !!campo && campo.tipo === "fechaHora" && campo.auto === "ahora";

    /**
     * Rehace el formulario para la causal activa, agrupado por lo que el
     * analista tiene que hacer con cada campo y no por dónde caen en el PDF:
     *
     *   revisar    → traen un valor que conviene confirmar
     *   llenar     → vacíos, hay que escribirlos
     *   automático → se calculan solos; van al final y casi nunca se tocan
     *
     * El orden del PDF no cambia: lo fija el catálogo, no esta pantalla.
     */
    function pintarFormulario() {
        const c = R.CAUSALES[estado.causal];
        const ahora = R.aInputFechaHora(new Date());
        const previos = leerCampos();   // conserva lo ya escrito al cambiar de causal

        const val = campo => {
            // Un campo que depende de la causal (motivo, estado de la línea)
            // sigue a la causal nueva mientras nadie lo haya tocado: si no,
            // al pasar de FC a LS el motivo se quedaría en «FC titularidad».
            if (campo.porCausal && !estado.tocados.has(campo.id)) {
                if (campo.id === "motivo") return c.motivoPorDefecto;
                if (campo.id === "estadoLinea") return c.estadoPorDefecto;
            }
            // Una fecha automática que nadie ha fijado arranca siempre en la
            // hora actual, no en la que tuviera antes de repintar.
            if (siguePorReloj(campo) && !estado.tocados.has(campo.id)) return ahora;
            if (previos[campo.id] != null && previos[campo.id] !== "") return previos[campo.id];
            if (campo.tipo === "fechaHora") return campo.auto === "ahora" ? ahora : "";
            if (campo.id === "motivo") return c.motivoPorDefecto;
            if (campo.id === "estadoLinea") return c.estadoPorDefecto;
            return campo.valor != null ? campo.valor : "";
        };

        const campos = camposDe(c);
        const grupo = p => campos.filter(f => (f.prioridad || "llenar") === p)
            .map(f => filaCampo(f, val(f))).join("");

        $("#grupoLlenar").innerHTML = grupo("llenar");
        $("#grupoRevisar").innerHTML = grupo("revisar");
        $("#grupoAutomatico").innerHTML = grupo("automatico");

        $("#tituloCausal").textContent = c.nombre;
        $("#descCausal").textContent = c.descripcion;

        aplicarReglaNit();
        aplicarPersonaJuridica();
        engancharCampos();
        refrescarNombre();
    }

    /* =====================================================================
       2 · Reglas que la interfaz debe reflejar
    ===================================================================== */

    /**
     * NIT ⇒ persona jurídica. Se fuerza y se bloquea el campo: es regla de
     * negocio, no una preferencia del analista.
     */
    function aplicarReglaNit() {
        const selTipo = $("#f_tipoId");
        const selPersona = $("#f_tipoPersona");
        if (!selTipo || !selPersona) return;

        const esNit = selTipo.value === "NIT";
        if (esNit) {
            selPersona.value = "JURIDICA";
            selPersona.disabled = true;
            selPersona.title = "Con NIT la persona es jurídica por definición.";
        } else {
            selPersona.disabled = false;
            selPersona.title = "";
        }
    }

    /**
     * Los campos del representante legal solo se muestran en persona
     * jurídica. Al ocultarlos se limpian, para que no quede colgado el dato
     * de un titular jurídico anterior en un formato de persona natural.
     */
    function aplicarPersonaJuridica() {
        const selPersona = $("#f_tipoPersona");
        if (!selPersona) return;
        const esJuridica = selPersona.value === "JURIDICA";

        R.CAMPOS_REP_LEGAL.forEach(id => {
            const caja = $(`[data-campo-caja="${id}"]`);
            if (!caja) return;
            caja.hidden = !esJuridica;
            if (!esJuridica) {
                const campo = $(`#f_${id}`);
                if (campo) campo.value = "";
                estado.tocados.delete(id);
            }
        });
        $("#avisoJuridica").hidden = !esJuridica;
    }

    /** Marca en rojo una identificación con formato imposible. */
    function validarEnPantalla() {
        const tipo = $("#f_tipoId") ? $("#f_tipoId").value : "CC";
        const campo = $("#f_identificacion");
        if (!campo) return;
        const error = R.validarIdentificacion(tipo, campo.value);
        campo.classList.toggle("is-invalid", !!error);
        campo.title = error || "";
    }

    /* =====================================================================
       3 · Lectura del formulario
    ===================================================================== */

    /** Todo lo que el analista escribió, por id de campo. */
    function leerCampos() {
        const datos = {};
        $$("[data-campo]").forEach(el => { datos[el.dataset.campo] = el.value; });
        return datos;
    }

    /**
     * Arma el objeto que consume generarPDF: convierte las fechas a texto
     * y resuelve los campos que son copia de otro (`de`).
     */
    function recolectar() {
        const c = R.CAUSALES[estado.causal];
        const crudo = leerCampos();
        const datos = { causal: estado.causal, imagenes: estado.imagenes };

        // Fechas a texto en el formato de la macro; el resto tal cual.
        const todos = [].concat(c.fechas, R.CAMPOS_CLIENTE, c.extra, R.CAMPOS_CIERRE, c.cola);
        todos.forEach(campo => {
            if (campo.de) return;                        // se resuelve abajo
            const v = crudo[campo.id];
            datos[campo.id] = campo.tipo === "fechaHora"
                ? (v ? R.fechaHoraTexto(new Date(v)) : "N/A")
                : v;
        });
        // Campos que son copia de otro (p. ej. la suspensión repetida en LS).
        todos.forEach(campo => { if (campo.de) datos[campo.id] = datos[campo.de]; });

        datos.msisdn = $("#inMsisdn").value.trim();
        datos.nombreArchivo = $("#inNombre").value.trim();
        return datos;
    }

    /* =====================================================================
       4 · Nombre del archivo
       ---------------------------------------------------------------------
       La plantilla (prefijo + dígitos del consecutivo) NO está limitada a
       las dos formas originales: el analista crea, usa y borra las que
       necesite, y quedan guardadas en el navegador de forma permanente.
    ===================================================================== */

    /** Vuelve a llenar el desplegable con las plantillas guardadas. */
    function pintarPlantillas() {
        const activa = R.plantillaActivaId();
        $("#selPlantilla").innerHTML = R.plantillas()
            .map(p => `<option value="${p.id}"${p.id === activa ? " selected" : ""}>${MEUI.esc(R.etiquetaPlantilla(p))}</option>`)
            .join("") + `<option value="__nueva__">+ Nueva plantilla…</option>`;
        // Con una sola plantilla no queda ninguna a la que caer si se borra.
        $("#btnEliminarPlantilla").disabled = R.plantillas().length <= 1;
    }

    /** Recalcula el nombre sugerido, salvo que el analista lo haya editado. */
    function refrescarNombre() {
        if (estado.nombreEditado) return;
        const plantilla = R.plantillaPorId($("#selPlantilla").value);
        const consecutivo = $("#inConsecutivo").value;
        $("#inNombre").value = R.nombreArchivo(estado.causal, consecutivo, new Date(), plantilla);
        pintarDespiece(plantilla);
    }

    /** Explica bajo el campo de qué se compone el nombre sugerido. */
    function pintarDespiece(plantilla) {
        const n = String(Math.max(1, Number($("#inConsecutivo").value) || 1)).padStart(plantilla.digitos, "0");
        $("#despieceNombre").innerHTML =
            `<span>${MEUI.esc(plantilla.prefijo)}</span><span>${R.selloFecha(new Date())}</span>`
            + `<span>${n}</span><span>-${estado.causal}</span>`;
    }

    /** Muestra u oculta el mini-formulario para crear una plantilla nueva. */
    function mostrarEditorPlantilla(mostrar) {
        $("#editorPlantilla").hidden = !mostrar;
        if (mostrar) {
            const activa = R.plantillaPorId(R.plantillaActivaId());
            $("#inPrefijoNuevo").value = activa.prefijo;
            $("#inDigitosNuevo").value = activa.digitos;
            $("#inPrefijoNuevo").focus();
        }
    }

    function guardarPlantillaNueva() {
        const prefijo = $("#inPrefijoNuevo").value.trim();
        const digitos = Number($("#inDigitosNuevo").value);
        if (!prefijo) {
            MEUI.toast("Escribe el prefijo de la plantilla.", "err");
            return;
        }
        R.guardarPlantilla(prefijo, digitos);
        pintarPlantillas();
        mostrarEditorPlantilla(false);
        estado.nombreEditado = false;
        refrescarNombre();
        MEUI.toast("Plantilla guardada.", "ok");
    }

    function eliminarPlantillaActiva() {
        const id = $("#selPlantilla").value;
        if (id === "__nueva__") { mostrarEditorPlantilla(false); return; }
        if (!R.eliminarPlantilla(id)) {
            MEUI.toast("Debe quedar al menos una plantilla.", "warn");
            return;
        }
        pintarPlantillas();
        estado.nombreEditado = false;
        refrescarNombre();
        MEUI.toast("Plantilla eliminada.", "ok");
    }

    /* =====================================================================
       5 · Sesión del CM
       ---------------------------------------------------------------------
       El token vive en memoria de CADA página, así que no se hereda al
       cambiar de herramienta; lo que sí se comparte por localStorage son las
       credenciales. Por eso aquí se leen y se inicia sesión solo: si no,
       MEAPI responde «No hay token ni usuario/clave del CM» aunque haya
       sesión abierta en otra pestaña.
    ===================================================================== */

    async function conectar(silencioso) {
        MEAPI.auth.leerCampos();
        if (!(MEAPI.auth.username && MEAPI.auth.password)) {
            MEUI.abrirPaso(1, true);
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
            return false;
        }
        try {
            MEAPI.auth.token = null;
            MEAPI.auth.refreshToken = null;
            MEAPI.auth.expiresAt = null;
            await MEAPI.auth.ensure();
            MEUI.cred.set("cm", { usuario: $("#user").value.trim(), clave: $("#pass").value });
            MEUI.aplicarAperturaPasos();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    /** Reutiliza las credenciales que dejó otra herramienta, si las hay. */
    function arrancarSesion() {
        const c = MEUI.cred.get("cm");
        if (c) {
            if (!$("#user").value) $("#user").value = c.usuario || "";
            if (!$("#pass").value) $("#pass").value = c.clave || "";
        }
        if ($("#user").value && $("#pass").value && !MEAPI.auth.token) {
            MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
            conectar(true).then(ok => { if (ok) MEUI.log("Sesión del CM lista.", "ok"); });
        } else {
            MEUI.log("Escribe usuario y contraseña del CM para traer los datos de la línea.");
        }
    }

    /* =====================================================================
       6 · Consulta al CM
    ===================================================================== */

    async function traerDelCM() {
        const msisdn = R.normalizarMsisdn($("#inMsisdn").value);
        if (!msisdn) {
            MEUI.toast("Escribe un número de línea válido (10 dígitos que empiezan por 3).", "err");
            return;
        }
        $("#inMsisdn").value = msisdn;

        // Sin token no se consulta: el mensaje útil es «inicia sesión», no el
        // error crudo de Keycloak que sale desde dentro de la petición.
        if (!MEAPI.auth.token && !(await conectar(true))) {
            MEUI.abrirPaso(1, true);
            MEUI.toast("Inicia sesión en el CM para traer los datos.", "warn");
            return;
        }

        await MEUI.conSpinner($("#btnCM"), "Consultando…", async () => {
            const r = await R.consultarCM(msisdn);

            // Solo se escribe lo que el CM realmente devolvió. Lo que llega
            // del CM cuenta como dato propio: al cambiar de causal se respeta.
            const poner = (id, v) => {
                const el = $(`#f_${id}`);
                if (el && v != null && v !== "") { el.value = v; estado.tocados.add(id); }
            };
            poner("identificacion", r.identificacion);
            poner("tipoId", r.tipoId);
            poner("nombre", r.nombre);
            poner("estadoLinea", r.estadoLinea);
            if (r.fechaDesactivacion) poner("fechaDesactivacion", R.aInputFechaHora(r.fechaDesactivacion));
            if (r.cun) poner("cun", r.cun);

            aplicarReglaNit();
            aplicarPersonaJuridica();
            validarEnPantalla();

            const traidos = ["identificacion", "tipoId", "nombre", "estadoLinea"].filter(k => r[k]).length
                + (r.fechaDesactivacion ? 1 : 0);
            MEUI.log(`CM ${msisdn}: ${traidos} campo(s) traídos.`, traidos ? "ok" : "warn");
            r.avisos.forEach(a => MEUI.log("⚠ " + a, "warn"));

            $("#avisosCM").innerHTML = r.avisos
                .map(a => `<div class="aviso">${MEUI.esc(a)}</div>`).join("");

            MEUI.toast(traidos ? `${traidos} campo(s) traídos del CM.` : "El CM no devolvió datos para esa línea.",
                traidos ? "ok" : "warn");
            await generar();
        });
    }

    /* =====================================================================
       7 · Imagen de manifestación
       ---------------------------------------------------------------------
       Lo normal es UNA sola imagen. Adjuntar varias es el caso excepcional
       (algunos rechazos necesitan más de una evidencia): cuando pasa, se
       muestran en una lista y se apilan en el PDF en el mismo orden en que
       se agregaron — «Añadir otra imagen» solo aparece una vez hay alguna.
    ===================================================================== */

    /** Agrega una o varias imágenes a la cola, respetando el tope. */
    async function cargarImagenes(archivos) {
        const candidatas = Array.from(archivos || []).filter(a => a && /^image\//.test(a.type));
        if (!candidatas.length) return;

        const cupo = MAX_IMAGENES - estado.imagenes.length;
        if (cupo <= 0) {
            MEUI.toast(`Ya hay ${MAX_IMAGENES} imágenes adjuntas, el máximo por documento.`, "warn");
            return;
        }
        const aProcesar = candidatas.slice(0, cupo);
        if (candidatas.length > cupo)
            MEUI.toast(`Se adjuntaron ${cupo} de ${candidatas.length}: el máximo es ${MAX_IMAGENES} por documento.`, "warn");

        for (const archivo of aProcesar) {
            try {
                const img = await R.comprimirImagen(archivo);
                img.nombreArchivo = archivo.name;
                estado.imagenes.push(img);
                const antes = (img.bytesOriginal / 1024).toFixed(0);
                const despues = (img.bytes / 1024).toFixed(0);
                MEUI.log(`Imagen adjunta: ${archivo.name}, ${antes} KB → ${despues} KB.`, "ok");
            } catch (e) {
                MEUI.log(`No se pudo procesar ${archivo.name}: ${e.message}`, "err");
                MEUI.toast(`No se pudo procesar ${archivo.name}.`, "err");
            }
        }
        $("#inputImagen").value = "";
        pintarGaleriaImagenes();
        await generar();
    }

    function quitarImagen(indice) {
        estado.imagenes.splice(indice, 1);
        pintarGaleriaImagenes();
        generar();
    }

    /** Lista de miniaturas + el botón «Añadir otra», que solo aparece con ≥1. */
    function pintarGaleriaImagenes() {
        const hay = estado.imagenes.length > 0;
        $("#zonaImagen").hidden = hay;
        $("#galeriaImagenes").hidden = !hay;
        if (!hay) { $("#listaImagenes").innerHTML = ""; return; }

        $("#listaImagenes").innerHTML = estado.imagenes.map((img, i) => `
            <div class="imagen-item">
                <img src="${img.dataUrl}" alt="">
                <div class="imagen-info">
                    <span class="nombre">${MEUI.esc(img.nombreArchivo || `imagen ${i + 1}`)}</span>
                    <span class="peso-item">${img.ancho}×${img.alto} px · ${(img.bytes / 1024).toFixed(0)} KB</span>
                </div>
                <button type="button" class="btn-quitar" data-i="${i}" title="Quitar esta imagen">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>`).join("");

        $$("[data-i]", $("#listaImagenes")).forEach(b =>
            b.addEventListener("click", () => quitarImagen(Number(b.dataset.i))));

        const restante = MAX_IMAGENES - estado.imagenes.length;
        $("#btnAgregarImagen").disabled = restante <= 0;
        $("#contadorImagenes").textContent = restante > 0
            ? `${estado.imagenes.length} de ${MAX_IMAGENES}`
            : `máximo (${MAX_IMAGENES}) alcanzado`;
    }

    /* =====================================================================
       8 · Generación y vista previa
       ---------------------------------------------------------------------
       La vista previa es el PDF de verdad, no una maqueta en HTML: lo que
       se ve en el visor es byte por byte lo que se descarga.
    ===================================================================== */

    async function generar() {
        const datos = recolectar();

        if (!R.normalizarMsisdn(datos.msisdn)) {
            $("#visorVacio").hidden = false;
            $("#visor").hidden = true;
            $("#visorVacio").textContent = "Escribe el número de línea para ver el documento.";
            $("#btnDescargar").disabled = true;
            return;
        }

        try {
            if (estado.pdf && estado.pdf.dataUrl) URL.revokeObjectURL(estado.pdf.dataUrl);
            estado.pdf = R.generarPDF(datos);

            $("#visor").src = estado.pdf.dataUrl;
            $("#visor").hidden = false;
            $("#visorVacio").hidden = true;
            $("#btnDescargar").disabled = false;

            pintarPeso(estado.pdf.bytes);
            MEUI.resumenPaso(5, `${(estado.pdf.bytes / 1024).toFixed(0)} KB · ${estado.pdf.paginas} pág.`);
        } catch (e) {
            MEUI.log("No se pudo generar el PDF: " + e.message, "err");
            MEUI.toast("No se pudo generar el PDF. Revisa el registro.", "err");
        }
    }

    /**
     * El peso es la razón de ser de esta herramienta, así que se muestra
     * siempre y se compara con lo que pesaba la macro de Excel.
     */
    function pintarPeso(bytes) {
        const kb = bytes / 1024;
        const nivel = kb > 120 ? "err" : kb > 60 ? "warn" : "ok";
        const veces = (217 / Math.max(kb, 1)).toFixed(0);
        $("#peso").className = "peso " + nivel;
        $("#peso").innerHTML = `<strong>${kb.toFixed(0)} KB</strong>`
            + (nivel === "ok"
                ? ` · archivo liviano`
                : ` · pesa más de lo esperado; revisa la imagen adjunta`);
    }

    /**
     * Guarda el blob eligiendo dónde en cada descarga, con el selector nativo
     * del sistema operativo (File System Access API) — así no depende de que
     * en el navegador esté activada la opción «Preguntar dónde guardar cada
     * archivo antes de descargar». Donde el navegador no lo soporte (o el
     * contexto no sea seguro, como puede pasar en file://), cae a la
     * descarga normal a la carpeta de Descargas.
     *
     * Devuelve `true` si el archivo quedó guardado y `false` si el analista
     * canceló el diálogo — en ese caso no hay que consumir el consecutivo
     * ni registrar nada, porque no se guardó nada.
     */
    async function guardarArchivo(blob, nombre) {
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: nombre,
                    types: [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]
                });
                const writable = await handle.createWritable();
                // Se escribe un ArrayBuffer y no el Blob directo: en Chromium/Edge
                // (sobre todo en ventanas --inPrivate, como abre el lanzador) hay
                // casos conocidos donde writable.write(blob) resuelve sin error
                // pero el archivo queda en disco con 0 bytes. El ArrayBuffer no
                // tiene ese problema.
                await writable.write(await blob.arrayBuffer());
                await writable.close();

                // Verificación: se relee el archivo recién guardado y se compara
                // su peso con el del PDF generado. Si no coincide -típicamente
                // 0 bytes- el guardado falló en silencio; se avisa y se repite
                // por la descarga normal en vez de dejar pasar un archivo vacío
                // sin que nadie se entere.
                const enDisco = await handle.getFile();
                if (enDisco.size !== blob.size) {
                    MEUI.log(`«${nombre}» quedó en ${enDisco.size} bytes en vez de ${blob.size}: el selector de guardado falló. Se repite con la descarga normal.`, "err");
                    MEUI.descargar(blob, nombre);
                    MEUI.toast("El selector de guardado dejó el archivo en 0 KB; se usó la descarga normal en su lugar.", "warn");
                }
                return true;
            } catch (e) {
                if (e && e.name === "AbortError") return false;   // canceló el diálogo
                MEUI.log(`No se pudo usar el selector de guardado (${e.message}); se usa la descarga normal.`, "warn");
            }
        }
        MEUI.descargar(blob, nombre);
        return true;
    }

    async function descargar() {
        if (!estado.pdf) return;

        // El PDF de la vista previa se armó con la hora de ese momento. Se
        // rehace antes de guardar para que las fechas automáticas del archivo
        // sean las de la generación real y no las de la última tecla.
        await generar();
        if (!estado.pdf) return;

        const nombre = R.sanearNombre($("#inNombre").value);
        if (!nombre) {
            MEUI.toast("El nombre del archivo no puede quedar vacío.", "err");
            return;
        }
        $("#inNombre").value = nombre;

        const guardado = await guardarArchivo(estado.pdf.blob, nombre);
        if (!guardado) return;   // cancelado: no se toca el consecutivo

        // Solo se consume el consecutivo cuando el archivo realmente se guardó.
        if (!estado.nombreEditado) {
            R.registrarConsecutivo($("#inConsecutivo").value, new Date());
            $("#inConsecutivo").value = R.consecutivoSugerido(new Date());
            refrescarNombre();
        }
        R.recordarPlantillaActiva($("#selPlantilla").value);
        MEUI.log(`Guardado ${nombre} · ${(estado.pdf.bytes / 1024).toFixed(0)} KB.`, "ok");
        MEUI.toast("Archivo guardado. Verifica el tamaño antes de subirlo.", "ok");
    }

    /* =====================================================================
       9 · Enganches
    ===================================================================== */

    /** Los campos se repintan al cambiar de causal, así que se reenganchan. */
    function engancharCampos() {
        $$("[data-campo]").forEach(el => {
            el.addEventListener("input", alCambiarCampo);
            el.addEventListener("change", alCambiarCampo);
        });
        arrancarReloj();
    }

    /* ---------------------------------------------------------------------
       Reloj de los campos automáticos
       ---------------------------------------------------------------------
       Antes el «ahora» se calculaba una sola vez al pintar el formulario, así
       que FECHA DE CONSULTA y compañía se quedaban en la hora en que se abrió
       la herramienta: un documento generado a las 5 de la tarde salía con la
       hora de la mañana. Ahora siguen el reloj hasta que el analista escribe
       en ellos.
    --------------------------------------------------------------------- */

    let reloj = null;

    function arrancarReloj() {
        if (!reloj) reloj = setInterval(refrescarFechasAutomaticas, 1000);
    }

    function refrescarFechasAutomaticas() {
        const ahora = R.aInputFechaHora(new Date());
        camposDe(R.CAUSALES[estado.causal]).forEach(campo => {
            if (!siguePorReloj(campo) || estado.tocados.has(campo.id)) return;
            const el = $(`#f_${campo.id}`);
            // No se pisa el campo que el analista tiene abierto en ese momento.
            if (!el || el === document.activeElement) return;
            if (el.value === ahora) return;
            el.value = ahora;
            el.dataset.dia = R.diaDeInput(ahora);
        });
    }

    let temporizador = null;
    function alCambiarCampo(ev) {
        const el = ev.target;
        const id = el.dataset.campo;
        const campo = campoPorId(id);

        if (siguePorReloj(campo)) {
            // Solo se mira el cambio de DÍA: así se puede escribir una hora
            // distinta dentro del día de hoy sin que el reloj la pise.
            const diaAnterior = el.dataset.dia || "";
            const diaNuevo = R.diaDeInput(el.value);
            el.dataset.dia = diaNuevo;

            if (diaNuevo !== diaAnterior && R.esDeHoy(el.value)) {
                // Volver a la fecha de hoy devuelve el campo al reloj y lo
                // pone en hora al instante, sin esperar al siguiente tic.
                estado.tocados.delete(id);
                el.value = R.aInputFechaHora(new Date());
                el.dataset.dia = R.diaDeInput(el.value);
            } else {
                estado.tocados.add(id);
            }
        } else {
            // Queda constancia de que este campo ya tiene dato propio: al
            // cambiar de causal no se pisa con el valor por defecto de la
            // causal nueva.
            estado.tocados.add(id);
        }

        if (id === "tipoId") { aplicarReglaNit(); aplicarPersonaJuridica(); }
        if (id === "tipoPersona") aplicarPersonaJuridica();
        if (id === "tipoId" || id === "identificacion") validarEnPantalla();

        // Se regenera con una pausa para no rearmar el PDF en cada tecla.
        clearTimeout(temporizador);
        temporizador = setTimeout(generar, 350);
    }

    function iniciar() {
        // Sesión del CM
        $("#btnLogin").addEventListener("click", () =>
            MEUI.conSpinner($("#btnLogin"), "Conectando…", () => conectar(false)));
        MEUI.enterEjecuta($("#pass"), $("#btnLogin"));

        document.addEventListener("me:sesion-iniciar", () => $("#btnLogin").click());
        document.addEventListener("me:sesion-renovar", () => {
            if (!MEAPI.auth.token) return;
            MEUI.log("Renovando el token del CM antes de que venza…");
            MEAPI.auth.reauth(MEAPI.auth.version)
                .catch(e => MEUI.log("No se pudo renovar: " + e.message, "err"));
        });
        document.addEventListener("me:sesion-cerrar", () => {
            MEAPI.auth.token = null;
            MEAPI.auth.refreshToken = null;
            MEAPI.auth.expiresAt = null;
            $("#pass").value = "";
        });

        // Causal
        $$("[data-causal]").forEach(btn => {
            btn.addEventListener("click", () => {
                $$("[data-causal]").forEach(b => b.classList.remove("activa"));
                btn.classList.add("activa");
                estado.causal = btn.dataset.causal;
                pintarFormulario();
                generar();
            });
        });

        // Línea y CM
        $("#btnCM").addEventListener("click", traerDelCM);
        $("#inMsisdn").addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(generar, 350); });
        MEUI.enterEjecuta($("#inMsisdn"), $("#btnCM"));

        // Nombre del archivo
        $("#selPlantilla").addEventListener("change", () => {
            if ($("#selPlantilla").value === "__nueva__") { mostrarEditorPlantilla(true); return; }
            mostrarEditorPlantilla(false);
            estado.nombreEditado = false;
            refrescarNombre();
        });
        $("#btnGuardarPlantilla").addEventListener("click", guardarPlantillaNueva);
        MEUI.enterEjecuta($("#inDigitosNuevo"), $("#btnGuardarPlantilla"));
        $("#btnEliminarPlantilla").addEventListener("click", eliminarPlantillaActiva);
        $("#inConsecutivo").addEventListener("input", () => { estado.nombreEditado = false; refrescarNombre(); });
        $("#inNombre").addEventListener("input", () => {
            estado.nombreEditado = true;
            $("#avisoNombre").hidden = false;
        });
        $("#btnResetNombre").addEventListener("click", () => {
            estado.nombreEditado = false;
            $("#avisoNombre").hidden = true;
            refrescarNombre();
        });

        // Imagen — el caso normal es una sola; «Añadir otra» es la vía
        // explícita para el caso excepcional de más de una evidencia.
        const zona = $("#zonaImagen");
        zona.addEventListener("click", () => $("#inputImagen").click());
        zona.addEventListener("dragover", e => { e.preventDefault(); zona.classList.add("drag"); });
        zona.addEventListener("dragleave", () => zona.classList.remove("drag"));
        zona.addEventListener("drop", e => {
            e.preventDefault(); zona.classList.remove("drag");
            cargarImagenes(e.dataTransfer.files);
        });
        $("#inputImagen").addEventListener("change", e => cargarImagenes(e.target.files));
        $("#btnAgregarImagen").addEventListener("click", () => $("#inputImagen").click());
        // Pegar una o varias capturas con Ctrl+V, que es como llegan hoy.
        document.addEventListener("paste", e => {
            const items = [...(e.clipboardData?.items || [])].filter(i => /^image\//.test(i.type));
            if (items.length) cargarImagenes(items.map(i => i.getAsFile()));
        });

        // Salida
        $("#btnDescargar").addEventListener("click", () =>
            MEUI.conSpinner($("#btnDescargar"), "Guardando…", descargar));
        $("#btnRegenerar").addEventListener("click", generar);

        // Arranque
        pintarPlantillas();
        mostrarEditorPlantilla(false);
        $("#inConsecutivo").value = R.consecutivoSugerido(new Date());
        pintarGaleriaImagenes();
        pintarFormulario();
        generar();
        arrancarSesion();
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
