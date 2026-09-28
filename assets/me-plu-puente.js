/* =====================================================================
   me-plu-puente.js · Enganche entre logica-plu.js y el shell
   ---------------------------------------------------------------------
   Va SIEMPRE al final del <body>, después de logica-plu.js:

       <script src="assets/me-ui.js"></script>
       <script src="assets/me-api.js"></script>
       <script src="assets/logica-plu.js"></script>
       <script src="assets/me-plu-puente.js"></script>

   Aquí vive: la sesión del CM, la tabla, el modal de detalle, la doble
   confirmación de la recarga y las exportaciones. Las reglas de negocio
   (cuenta de la línea, paquetes, token y recarga en Tulio, comparación
   antes/después) están en logica-plu.js.
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);

    if (typeof consultarLinea !== "function") {
        MEUI.log("No cargó assets/logica-plu.js: la herramienta queda inutilizable. "
            + "El detalle del error aparece más arriba en este registro.", "err");
        MEUI.toast("La lógica de la herramienta no cargó. Mira el registro.", "err");
        return;
    }

    let filas = [];                 // una por línea consultada
    let dataTable = null;
    let msisdnAbierto = null;
    const bitacora = [];            // una entrada por recarga ejecutada
    let corriendo = false;

    /* --- 1 · Sesión del CM ------------------------------------------- */
    async function conectar(silencioso) {
        auth.leerCampos();
        if (!(auth.username && auth.password)) {
            if (!silencioso) MEUI.toast("Escribe usuario y contraseña del CM.", "warn");
            return false;
        }
        try {
            auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
            await auth.ensure();
            MEUI.cred.set("cm", { usuario: el("user").value.trim(), clave: el("pass").value });
            MEUI.aplicarAperturaPasos();
            pintarPermiso();
            return true;
        } catch (e) {
            MEUI.log("✖ " + e.message, "err");
            if (!silencioso) MEUI.toast("No se pudo iniciar sesión en el CM.", "err");
            return false;
        }
    }

    el("btnLogin").addEventListener("click", () =>
        MEUI.conSpinner(el("btnLogin"), "Conectando…", () => conectar(false)));
    MEUI.enterEjecuta(el("pass"), el("btnLogin"));

    document.addEventListener("me:sesion-iniciar", e => {
        if (e.detail.clave === "cm") el("btnLogin").click();
    });
    document.addEventListener("me:sesion-renovar", e => {
        if (e.detail.clave === "cm" && auth.token) {
            auth.reauth(auth.version).catch(err => MEUI.log("No se pudo renovar: " + err.message, "err"));
        }
    });
    document.addEventListener("me:sesion-cerrar", e => {
        if (e.detail.clave !== "cm") return;
        auth.token = null; auth.refreshToken = null; auth.expiresAt = null;
        if (el("pass")) el("pass").value = "";
        pintarPermiso();
    });
    // Entrar, vencer o salir cambia si se puede recargar o no.
    document.addEventListener("me:sesion-cambio", e => {
        if (!e.detail || e.detail.clave === "cm") { pintarPermiso(); render(); }
    });

    const credCm = MEUI.cred.get("cm");
    if (credCm) {
        if (!el("user").value) el("user").value = credCm.usuario || "";
        if (!el("pass").value) el("pass").value = credCm.clave || "";
    }
    if (el("user").value && el("pass").value && !auth.token) {
        MEUI.log("Credenciales del CM disponibles. Iniciando sesión…");
        conectar(true);
    } else {
        MEUI.log("Sin sesión del CM: inicia sesión en el paso 1 para consultar.");
    }

    /* --- 2 · Permiso para aplicar PLU -------------------------------- */
    function pintarPermiso() {
        const listo = listoParaPlu();
        const aviso = el("pluBloqueado");
        el("pluCampos").hidden = !listo;
        aviso.hidden = listo;
        if (!listo) {
            aviso.innerHTML = `<b>Solo consulta.</b> No se puede aplicar PLU: ${MEUI.esc(motivoSinPlu())}. `
                + "Los paquetes de cada línea sí se pueden ver.";
        }
    }
    pintarPermiso();


    /* --- 3 · Entrada de líneas -------------------------------------- */
    // MEUI.parseLineas devuelve { lineas, descartadas } y ya deduplica y
    // quita el indicativo 57: se le pide el largo de un móvil (10).
    function lineasEscritas() {
        return MEUI.parseLineas(el("inputLineas").value, { min: 10, max: 10 });
    }
    function pintarInfoLineas() {
        const e = lineasEscritas();
        el("infoLineas").textContent =
            `${e.lineas.length} línea(s) válida(s) · ${e.descartadas.length} descartada(s)`
            + ` · máximo ${CONFIG.maxLineas}`;
    }
    el("inputLineas").addEventListener("input", pintarInfoLineas);
    pintarInfoLineas();
    MEUI.enterEjecuta(el("inputLineas"), el("btnConsultar"));

    /* --- 4 · Consulta -----------------------------------------------
       MEUI.autoSpinner deja el botón ocupado y espera a que la
       herramienta le ponga `disabled = false` para liberarlo: si no se
       hace, el spinner se queda girando (hasta su red de seguridad de 15
       min). Por eso el `finally` de abajo NO es opcional.
    --------------------------------------------------------------------- */
    function liberarConsultar() {
        const b = el("btnConsultar");
        // autoSpinner observa el cambio de `disabled`; con dos frames se
        // asegura que el observer ya corrió antes de seguir.
        b.disabled = false;
    }

    el("btnConsultar").addEventListener("click", async () => {
        if (corriendo) { liberarConsultar(); return; }
        const entrada = lineasEscritas();
        if (!entrada.lineas.length) { MEUI.toast("No hay líneas válidas.", "warn"); liberarConsultar(); return; }
        if (entrada.lineas.length > CONFIG.maxLineas) {
            MEUI.toast(`Máximo ${CONFIG.maxLineas} líneas por consulta.`, "warn"); liberarConsultar(); return;
        }
        if (!auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); liberarConsultar(); return; }

        corriendo = true;
        try {
            MEUI.log(`Consultando ${entrada.lineas.length} línea(s)…`);
            if (entrada.descartadas.length) {
                MEUI.log("No se consultan (no son móviles de 10 dígitos): "
                    + entrada.descartadas.slice(0, 15).join(", ")
                    + (entrada.descartadas.length > 15 ? "…" : ""), "warn");
            }

            filas = entrada.lineas.map(m => ({ msisdn: m, estado: "PENDING", paquetes: [], cuentas: [], avisos: [] }));
            render();

            for (let i = 0; i < filas.length; i++) {
                el("estadoTabla").textContent = `Consultando ${i + 1} de ${filas.length}…`;
                filas[i] = await consultarLinea(filas[i].msisdn);
                render();
            }
            resumen();
        } catch (e) {
            MEUI.log("✖ " + (e.message || e), "err");
            MEUI.toast("Falló la consulta. Mira el registro.", "err");
        } finally {
            corriendo = false;
            liberarConsultar();
        }
    });

    function resumen() {
        const ok = filas.filter(f => f.estado === "OK").length;
        const conAviso = filas.filter(f => (f.avisos || []).length).length;
        el("estadoTabla").textContent =
            `${filas.length} línea(s) · ${ok} activa(s) · `
            + `${filas.reduce((n, f) => n + (f.paquetes || []).length, 0)} paquetes activos`
            + (conAviso ? ` · ${conAviso} con avisos` : "");
        MEUI.log(`Consulta terminada: ${ok} de ${filas.length} línea(s) activas.`, "ok");
    }

    /* --- 5 · Tabla --------------------------------------------------- */
    const CLASE_ESTADO = {
        OK: "ok", INACTIVA: "off", NO_EXISTE: "err", ERROR: "err", PENDING: "neutro"
    };
    const TEXTO_ESTADO = {
        OK: "Activa", INACTIVA: "Inactiva", NO_EXISTE: "No existe", ERROR: "Error", PENDING: "…"
    };

    function celdaEstado(f) {
        const cls = CLASE_ESTADO[f.estado] || "neutro";
        const txt = TEXTO_ESTADO[f.estado] || f.estado;
        const avisos = (f.avisos || []).slice();
        if (f.detalle) avisos.push(f.detalle);
        const icono = avisos.length
            ? ` <span class="aviso-fila" title="${MEUI.esc(avisos.join(" · "))}">⚠</span>` : "";
        return `<span class="badge-estado ${cls}">${MEUI.esc(txt)}</span>${icono}`;
    }

    function construirTabla() {
        dataTable = new DataTable("#tablaResultados", MEUI.opcionesTabla({
            data: [],
            columns: [
                { data: "msisdn", title: "Línea (MSISDN)", render: v => `<span class="me-mono">${MEUI.esc(v)}</span>` },
                { data: null, title: "Estado", render: celdaEstado },
                { data: null, title: "SubscriptionID", render: f => `<span class="me-mono">${MEUI.esc(f.subscriberId || "—")}</span>` },
                {
                    data: null, title: "Cuenta (BAN)",
                    render: f => `<span class="me-mono">${MEUI.esc(f.ban || "—")}</span>`
                        + (f.multi ? ` <span class="aviso-fila" title="Esta línea tiene ${f.cuentas.length} cuentas en el CM">⚠</span>` : "")
                },
                { data: null, title: "Titular", render: f => MEUI.esc(f.titular || "—") },
                { data: null, title: "Paquetes activos", render: f => (f.paquetes || []).length },
                {
                    data: null, title: "Acción", orderable: false, className: "col-accion",
                    render: f => {
                        const hayQueBorrar = (f.paquetes || []).some(esEliminable);
                        return `<button class="btn btn-sm btn-me-line btn-detalle" data-msisdn="${MEUI.esc(f.msisdn)}"
                            title="Ver paquetes de la línea">👁</button>`
                            + (listoParaPlu()
                                ? ` <button class="btn btn-sm btn-recargar btn-borrar" data-msisdn="${MEUI.esc(f.msisdn)}"
                                    ${hayQueBorrar ? "" : "disabled"}
                                    title="${hayQueBorrar ? "Eliminar los paquetes activos de esta línea" : "No hay paquetes eliminables"}">🗑</button>`
                                : "");
                    }
                }
            ]
        }));
        dataTable.on("click", "button.btn-detalle", function (e) { e.stopPropagation(); abrirDetalle(this.dataset.msisdn); });
        dataTable.on("click", "button.btn-borrar", function (e) {
            e.stopPropagation();
            eliminarDeLinea(this.dataset.msisdn, this);
        });
        dataTable.on("click", "tbody tr", function () {
            const f = dataTable.row(this).data();
            if (f && f.msisdn) abrirDetalle(f.msisdn);
        });
        MEUI.registrarTabla(dataTable);
    }

    function render() {
        if (!dataTable) { MEUI.prepararTabla("#tablaResultados"); construirTabla(); }
        dataTable.clear().rows.add(filas).draw();
        MEUI.mostrarSiHayDatos("#tablaResultados", { vacio: "#msgVacio", tabla: dataTable });
        el("kpiLineas").textContent = filas.filter(f => f.estado !== "PENDING").length;
        el("kpiAplicados").textContent = bitacora.filter(b => b.ok).length;
        el("kpiFallos").textContent = bitacora.filter(b => !b.ok).length;
        el("kpiCambios").textContent = bitacora.reduce((n, b) => n + (b.cambios || []).length, 0);
    }

    const filaDe = m => filas.find(f => f.msisdn === m);

    /* --- 6 · Modal de detalle --------------------------------------- */
    function pintarPaquetes(f) {
        const cuerpo = el("cuerpoPaquetes");
        const lista = f.paquetes || [];
        cuerpo.innerHTML = lista.length
            ? lista.map(b => `<tr>
                <td>${MEUI.esc(categoriaPaquete(b.unitType))}</td>
                <td>${MEUI.esc(b.nombre || "—")}${b.promocional ? ' <span class="plu-promo">promo</span>' : ""}</td>
                <td class="me-mono">${MEUI.esc(b.bundleId)}</td>
                <td class="me-mono">${MEUI.esc(fmtCantidad(totalAsignado(b), b.unitType))}</td>
                <td class="me-mono">${MEUI.esc(fmtCantidad(totalDisponible(b), b.unitType))}</td>
                <td class="me-mono">${MEUI.esc(fmtFechaHora(b.fin))}</td>
            </tr>`).join("")
            : `<tr><td colspan="6" class="text-muted">Sin paquetes activos.</td></tr>`;
    }

    function pintarDetalle(f) {
        el("mdMsisdn").textContent = f.msisdn;
        el("mdDatos").innerHTML = [
            ["Estado en el CM", f.estadoCmTexto || TEXTO_ESTADO[f.estado] || "—"],
            ["SubscriptionID", f.subscriberId || "—"],
            ["Cuenta (BAN)", f.ban || "—"],
            ["Cuenta en el CRM", f.cuentaCrm || "— no encontrada —"],
            ["Titular", f.titular || "—"],
            ["ICCID", f.iccid || "—"],
            ["Price Plan", f.planPrecioId ?? "—"]
        ].map(([k, v]) => `<dt>${MEUI.esc(k)}</dt><dd>${MEUI.esc(v)}</dd>`).join("");

        const wrap = el("mdCuentasWrap");
        wrap.hidden = !(f.cuentas && f.cuentas.length > 1);
        if (!wrap.hidden) {
            el("mdCuentas").innerHTML = f.cuentas.map(c =>
                `<span class="cuenta-chip ${c.ban === f.ban ? "usada" : ""}"
                    title="${c.ban === f.ban ? "Es la que se usa" : "No se usa"}">${MEUI.esc(c.ban || "—")}
                    · ${MEUI.esc(c.estadoCmTexto)}</span>`).join("");
        }

        el("mdAvisos").innerHTML = (f.avisos || []).length
            ? `<div class="alert alert-warning py-2 mb-0">${f.avisos.map(a => MEUI.esc(a)).join("<br>")}</div>`
            : "";

        pintarPaquetes(f);
        el("mdResultado").innerHTML = f.ultimoResultado ? resultadoPluHTML(f.ultimoResultado) : "";
        el("mdPaso").textContent = "";

        const usable = f.estado === "OK" || f.estado === "INACTIVA";
        const btn = el("btnUsarEnSecuencia");
        btn.hidden = !listoParaPlu();
        btn.disabled = !usable;

        const borrar = el("btnEliminar");
        borrar.hidden = !listoParaPlu();
        borrar.disabled = !usable || !(f.paquetes || []).some(esEliminable);
        borrar.title = borrar.disabled && usable ? "No hay paquetes eliminables en esta línea" : "";
    }

    function abrirDetalle(msisdn) {
        const f = filaDe(msisdn);
        if (!f) return;
        msisdnAbierto = msisdn;
        pintarDetalle(f);
        bootstrap.Modal.getOrCreateInstance("#modalDetalle").show();
    }

    el("btnRefrescar").addEventListener("click", () => MEUI.conSpinner(el("btnRefrescar"), "Consultando…", async () => {
        const f = filaDe(msisdnAbierto);
        if (!f) return;
        const fresca = await consultarLinea(f.msisdn);
        const i = filas.findIndex(x => x.msisdn === f.msisdn);
        // Se conserva el último resultado del PLU: es la evidencia de la
        // recarga y no la borra una consulta posterior.
        fresca.ultimoResultado = f.ultimoResultado;
        filas[i] = fresca;
        render();
        pintarDetalle(fresca);
    }));

    /* --- 6b · Eliminar los paquetes de una línea (suelto) -------------
       La misma orden ChangeOffer que usa la secuencia, pero a demanda:
       después de consultar se puede limpiar la línea sin aplicar ningún
       PLU. Con doble confirmación, porque escribe en producción.
    --------------------------------------------------------------------- */
    let borrando = false;

    async function eliminarDeLinea(msisdn, boton) {
        if (borrando) return;
        const f = filaDe(msisdn);
        if (!f || !listoParaPlu()) return;
        const activos = (f.paquetes || []).filter(esEliminable);
        if (!activos.length) { MEUI.toast("Esta línea no tiene paquetes eliminables.", "warn"); return; }

        if (!confirm(`Eliminar en PRODUCCIÓN los paquetes de ${msisdn}.\n\n`
            + activos.map(b => `· ${b.bundleId} ${b.nombre}`).join("\n")
            + `\n\nLa orden del CM se arma con el plan completo: elimina TODOS los paquetes `
            + `opcionales habilitados, no solo los de un PLU.\n\n¿Continuar?`)) return;

        borrando = true;
        if (boton) boton.disabled = true;
        const paso = el("mdPaso");
        MEUI.log(`▶ Eliminación de paquetes · ${msisdn} · ejecuta ${usuarioOperador()}`, "warn");
        try {
            const r = await eliminarPaquetes(f, [...new Set((f.paquetes || []).map(b => b.bundleId))],
                t => { if (paso) paso.textContent = t; });

            MEUI.log(`${r.ok ? "✔" : "✖"} Eliminación · ${msisdn} · ${r.detalle || "sin detalle"}`
                + (r.omitidos.length ? ` · omitidos (no eliminables): ${r.omitidos.join(", ")}` : "")
                + (r.dependencias && r.dependencias.length
                    ? ` · dependencias que pidió el CM: ${r.dependencias.join(", ")}` : ""),
                r.ok ? "ok" : "err");
            // Si el carrito no se pudo crear, el inventario de productos del
            // plan es lo que hace falta para entender por qué.
            if (!r.ok && r.inventario) {
                const inv = r.inventario;
                MEUI.log("· Productos que el CM listó para este plan — base: " + inv.base.join(", ")
                    + " · opcionales: " + Object.entries(inv.porProducto)
                        .map(([id, p]) => `${id}=paquete ${p.bundleId}${p.opcional ? "" : " (no opcional)"}`).join(", "),
                    "info");
            }
            MEUI.toast(r.ok ? `Orden ${r.ordenId}: ${r.estado}.` : "La eliminación no se confirmó. Mira el registro.",
                r.ok ? "ok" : "err");

            bitacora.push({
                hora: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", hour12: false }),
                usuario: usuarioOperador(), msisdn, plu: "—", costo: "—", canal: "—",
                ok: r.ok, httpStatus: "", codigo: r.estado || "",
                detalle: "Eliminación de paquetes: " + (r.detalle || ""), cambios: []
            });

            // Se relee para que la tabla muestre lo que quedó.
            if (paso) paso.textContent = "Verificando…";
            await new Promise(res => setTimeout(res, CONFIG.esperaCmMs));
            const fresca = await consultarLinea(msisdn);
            const i = filas.findIndex(x => x.msisdn === msisdn);
            if (i >= 0) filas[i] = fresca;
            render();
            if (msisdnAbierto === msisdn) pintarDetalle(fresca);
        } catch (e) {
            MEUI.log("✖ " + (e.message || e), "err");
            MEUI.toast("Falló la eliminación. Mira el registro.", "err");
        } finally {
            borrando = false;
            if (paso) paso.textContent = "";
            if (boton) boton.disabled = false;
        }
    }

    el("btnEliminar").addEventListener("click", () => {
        if (msisdnAbierto) eliminarDeLinea(msisdnAbierto, el("btnEliminar"));
    });

    /* --- 7 · Secuencia de PLU ---------------------------------------
       Una línea y N PLU, uno detrás de otro. Por cada PLU: consultar,
       agregar los bolsillos, verificarlos y eliminarlos.

       Los dos atajos que pide la operación al teclear muchos PLU:
         Enter → agrega otra fila debajo y salta a ella
         Tab   → pasa al campo siguiente SELECCIONANDO su contenido, para
                 sobrescribirlo de una (costo y canal vienen con un valor
                 por defecto que casi siempre se reemplaza)
    --------------------------------------------------------------------- */
    const secuencia = { corriendo: false, detener: false, items: [], armado: false };

    const CAMPOS_FILA = ["plu", "costo", "canal"];

    function filaSeqHTML() {
        return `<input class="form-control form-control-sm me-mono" data-campo="plu" inputmode="numeric"
                    placeholder="10021" aria-label="PLU">
            <input class="form-control form-control-sm me-mono" data-campo="costo" inputmode="numeric"
                    value="${CONFIG.costoPorDefecto}" aria-label="Costo">
            <input class="form-control form-control-sm me-mono" data-campo="canal"
                    value="${MEUI.esc(CONFIG.canalPorDefecto)}" autocomplete="off" aria-label="Canal de venta">
            <button type="button" class="seq-quitar" tabindex="-1" aria-label="Quitar fila">×</button>`;
    }

    function agregarFila(despuesDe, enfocar) {
        const fila = document.createElement("div");
        fila.className = "seq-fila";
        fila.innerHTML = filaSeqHTML();
        if (despuesDe) despuesDe.after(fila); else el("seqFilas").appendChild(fila);
        if (enfocar !== false) {
            const primero = fila.querySelector('[data-campo="plu"]');
            primero.focus();
            fila.scrollIntoView({ block: "nearest" });
        }
        return fila;
    }

    function errorDeFila(x) {
        if (!/^\d{1,20}$/.test(x.plu)) return "PLU inválido";
        if (!/^\d{1,10}$/.test(x.costo)) return "costo inválido";
        if (!/^[A-Za-z0-9_.-]{1,50}$/.test(x.canal)) return "canal inválido";
        return "";
    }

    /**
     * El cuadro de texto acepta la lista tal cual venga: `PLU costo canal`
     * separados por espacio, tabulación, coma, `;` o `|`, uno por renglón.
     * Con solo el PLU se usan el costo y el canal por defecto, y si el
     * primer renglón es un encabezado (`plu,costo,canal`) se salta.
     */
    function leerPlusTexto() {
        const renglones = String(el("seqPlusTexto").value || "")
            .split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        // Encabezado solo si la primera columna se llama «plu» de verdad: no
        // basta con que el renglón empiece por letra, porque entonces un PLU
        // mal escrito («abc 0 canal») se tragaría como encabezado en vez de
        // avisar que está mal.
        if (renglones.length) {
            const primera = renglones[0].split(/\s*[\t;,|]\s*|\s+/)[0] || "";
            if (/^(plu|plupaquete|plu_paquete|codigo|código)$/i.test(primera)) renglones.shift();
        }
        return renglones.map(texto => {
            const partes = texto.split(/\s*[\t;,|]\s*|\s+/).filter(Boolean);
            return {
                origen: "texto", texto,
                plu: partes[0] || "",
                costo: partes[1] !== undefined ? partes[1] : CONFIG.costoPorDefecto,
                canal: partes[2] !== undefined ? partes[2] : CONFIG.canalPorDefecto,
                sobran: partes.length > 3
            };
        });
    }

    function leerFilas() {
        return Array.from(el("seqFilas").children).map(fila => {
            const v = {};
            CAMPOS_FILA.forEach(c => { v[c] = fila.querySelector(`[data-campo="${c}"]`).value.trim(); });
            return { origen: "form", fila, plu: v.plu, costo: v.costo, canal: v.canal };
        }).filter(x => x.plu);
    }

    /** Primero lo pegado, después lo escrito fila a fila. */
    function leerItems() {
        return leerPlusTexto().concat(leerFilas());
    }

    function validarSecuencia() {
        const linea = soloDigitos(el("seqLinea").value);
        const lineaOk = /^3\d{9}$/.test(linea);
        el("seqLineaInfo").textContent = linea
            ? (lineaOk ? `Línea ${linea}: válida.` : "Debe ser un móvil de 10 dígitos que empiece por 3.")
            : "Una sola línea: la secuencia es secuencial por línea.";

        const items = leerItems();
        items.forEach(x => {
            x.error = x.sobran ? "sobran columnas" : errorDeFila(x);
            if (x.fila) x.fila.querySelectorAll("input").forEach(i => i.classList.toggle("is-invalid", !!x.error));
        });
        const malos = items.filter(x => x.error);
        el("seqPlusTexto").classList.toggle("is-invalid",
            malos.some(x => x.origen === "texto"));

        el("seqResumen").textContent = `${items.length - malos.length} PLU válido(s)`
            + (malos.length ? ` · ${malos.length} con error (${malos[0].error})` : "")
            + (items.length ? " · se aplican en este orden, de arriba abajo." : ".");

        // Vista previa: deja ver cómo se interpretó cada renglón antes de correr.
        const previa = el("seqPrevia");
        previa.hidden = !items.length;
        el("seqPreviaCuerpo").innerHTML = items.map((x, i) => x.error
            ? `<tr class="mala"><td>${i + 1}</td><td colspan="3">${MEUI.esc(x.texto || x.plu)} — ${MEUI.esc(x.error)}</td></tr>`
            : `<tr><td>${i + 1}</td><td>${MEUI.esc(x.plu)}</td><td>${MEUI.esc(x.costo)}</td><td>${MEUI.esc(x.canal)}</td></tr>`
        ).join("");

        el("seqEjecutar").disabled = secuencia.corriendo || !lineaOk || !items.length || malos.length > 0;
        return { linea, items };
    }

    function desarmarSecuencia() {
        secuencia.armado = false;
        el("seqEjecutar").textContent = "Ejecutar secuencia";
    }
    const alCambiarSecuencia = () => { desarmarSecuencia(); validarSecuencia(); };

    el("seqLinea").addEventListener("input", alCambiarSecuencia);
    el("seqFilas").addEventListener("input", alCambiarSecuencia);
    el("seqPlusTexto").addEventListener("input", alCambiarSecuencia);
    el("seqAgregar").addEventListener("click", () => { agregarFila(); alCambiarSecuencia(); });
    el("seqLimpiar").addEventListener("click", () => {
        el("seqPlusTexto").value = "";
        el("seqFilas").innerHTML = "";
        agregarFila(null, false);
        alCambiarSecuencia();
    });

    // Enter: otra fila debajo. Tab: siguiente campo con el contenido
    // seleccionado (y en el último campo, salta a la fila siguiente o crea una).
    el("seqFilas").addEventListener("keydown", ev => {
        const campo = ev.target.closest("input[data-campo]");
        if (!campo) return;
        const fila = campo.closest(".seq-fila");

        if (ev.key === "Enter") {
            ev.preventDefault();
            const plu = fila.querySelector('[data-campo="plu"]');
            if (!plu.value.trim()) { plu.focus(); plu.select(); return; }
            const siguiente = fila.nextElementSibling;
            if (siguiente) {
                const p = siguiente.querySelector('[data-campo="plu"]');
                p.focus(); p.select();
            } else {
                agregarFila(fila);
            }
            alCambiarSecuencia();
            return;
        }

        if (ev.key === "Tab" && !ev.shiftKey) {
            const i = CAMPOS_FILA.indexOf(campo.dataset.campo);
            let destino = null;
            if (i < CAMPOS_FILA.length - 1) {
                destino = fila.querySelector(`[data-campo="${CAMPOS_FILA[i + 1]}"]`);
            } else {
                const siguiente = fila.nextElementSibling
                    || (fila.querySelector('[data-campo="plu"]').value.trim() ? agregarFila(fila, false) : null);
                if (siguiente) destino = siguiente.querySelector('[data-campo="plu"]');
            }
            if (destino) {
                ev.preventDefault();
                destino.focus();
                destino.select();   // se sobrescribe de una, sin borrar a mano
                alCambiarSecuencia();
            }
        }
    });

    el("seqFilas").addEventListener("click", ev => {
        const btn = ev.target.closest(".seq-quitar");
        if (!btn) return;
        const fila = btn.closest(".seq-fila");
        const vecina = fila.nextElementSibling || fila.previousElementSibling;
        fila.remove();
        const quedan = el("seqFilas").children.length;
        const foco = quedan ? (vecina || el("seqFilas").firstElementChild) : agregarFila(null, false);
        foco.querySelector('[data-campo="plu"]').focus();
        alCambiarSecuencia();
    });

    // Pegar desde Excel en el campo de PLU: reparte columnas y filas.
    el("seqFilas").addEventListener("paste", ev => {
        const campo = ev.target.closest('input[data-campo="plu"]');
        if (!campo) return;
        const texto = (ev.clipboardData || window.clipboardData).getData("text") || "";
        const renglones = texto.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        if (renglones.length < 2 && !/[\t;,]/.test(texto)) return;   // un solo valor: pegado normal
        ev.preventDefault();
        let fila = campo.closest(".seq-fila");
        renglones.forEach((renglon, idx) => {
            const partes = renglon.split(/\s*[\t;,|]\s*|\s+/).filter(Boolean);
            const destino = idx === 0 ? fila : agregarFila(fila, false);
            fila = destino;
            CAMPOS_FILA.forEach((c, k) => {
                if (partes[k] !== undefined) destino.querySelector(`[data-campo="${c}"]`).value = partes[k];
            });
        });
        alCambiarSecuencia();
    });

    el("btnUsarEnSecuencia").addEventListener("click", () => {
        if (!msisdnAbierto) return;
        el("seqLinea").value = msisdnAbierto;
        alCambiarSecuencia();
        bootstrap.Modal.getOrCreateInstance("#modalDetalle").hide();
        MEUI.abrirPaso(3, true);
        const primero = el("seqFilas").querySelector('[data-campo="plu"]');
        if (primero) { primero.focus(); primero.select(); }
    });

    agregarFila(null, false);
    validarSecuencia();

    /* --- 7b · Pintado y ejecución de la secuencia -------------------- */
    const ETIQUETA_ESTADO = {
        espera: "En cola", corriendo: "En curso", ok: "Correcto",
        aviso: "Con novedad", error: "Error", cancelado: "Cancelado"
    };

    function pintarSecuencia() {
        const panel = el("seqPanel");
        panel.hidden = !secuencia.items.length;
        if (panel.hidden) return;
        el("seqPanelLinea").textContent = secuencia.linea || "—";
        el("seqLista").innerHTML = secuencia.items.map((r, i) => {
            const est = r.estado || "espera";
            const seg = r.inicio ? Math.round(((r.fin || Date.now()) - r.inicio) / 1000) : null;
            return `<div class="seq-item">
                <div class="seq-item-cab">
                    <span class="seq-estado ${est}">${MEUI.esc(ETIQUETA_ESTADO[est] || est)}</span>
                    <span class="seq-item-plu">${i + 1}. PLU ${MEUI.esc(r.plu)}</span>
                    <span class="me-hint">costo ${MEUI.esc(r.costo)} · canal ${MEUI.esc(r.canal)}</span>
                    ${seg !== null ? `<span class="me-hint">${seg}s</span>` : ""}
                    <span class="seq-item-paso ms-auto">${MEUI.esc(r.paso || "")}</span>
                </div>
                ${r.detalle ? `<div class="me-hint mt-1">${MEUI.esc(r.detalle)}</div>` : ""}
                ${(r.cambios || []).length ? `<div class="plu-cambios mt-2">${r.cambios.map(cuadroCambioHTML).join("")}</div>` : ""}
            </div>`;
        }).join("");
    }

    el("seqDetener").addEventListener("click", () => {
        secuencia.detener = true;
        el("seqDetener").disabled = true;
        el("seqDetener").textContent = "Se detendrá al terminar el PLU actual…";
        MEUI.log("Se pidió detener la secuencia: termina el PLU en curso y para.", "warn");
    });

    el("seqEjecutar").addEventListener("click", async () => {
        const { linea, items } = validarSecuencia();
        if (el("seqEjecutar").disabled) return;
        if (!auth.token) { MEUI.toast("Inicia sesión en el CM primero.", "warn"); return; }

        // Doble confirmación: el primer clic arma, el segundo ejecuta.
        if (!secuencia.armado) {
            secuencia.armado = true;
            el("seqEjecutar").textContent = `Sí, aplicar ${items.length} PLU a ${linea} en PRODUCCIÓN`;
            return;
        }
        desarmarSecuencia();

        secuencia.corriendo = true; secuencia.detener = false;
        secuencia.linea = linea;
        secuencia.items = items.map(x => ({ plu: x.plu, costo: x.costo, canal: x.canal, estado: "espera" }));
        el("seqEjecutar").disabled = true;
        el("seqDetener").hidden = false; el("seqDetener").disabled = false;
        el("seqDetener").textContent = "Detener al terminar el PLU actual";
        pintarSecuencia();

        MEUI.log(`▶ Secuencia: ${secuencia.items.length} PLU sobre ${linea} · ejecuta ${usuarioOperador()}`, "warn");

        // La línea se resuelve UNA vez: subscriberId y cuenta no cambian
        // entre PLU, y así la secuencia no repite la misma consulta.
        let fila = filaDe(linea) || await consultarLinea(linea);
        if (fila.estado === "ERROR" || fila.estado === "NO_EXISTE") {
            secuencia.items.forEach(r => { r.estado = "error"; r.detalle = fila.detalle || "la línea no se pudo consultar"; });
            MEUI.log(`✖ Secuencia detenida: ${fila.detalle || "la línea no se pudo consultar"}`, "err");
            pintarSecuencia();
            secuencia.corriendo = false;
            el("seqDetener").hidden = true;
            validarSecuencia();
            return;
        }
        if (!filaDe(linea)) { filas.push(fila); render(); }

        for (const r of secuencia.items) {
            if (secuencia.detener) { r.estado = "cancelado"; r.detalle = "Secuencia detenida antes de este PLU."; continue; }
            const hecho = await correrPluSecuencia(fila, r, parcial => {
                Object.assign(r, parcial); pintarSecuencia();
            }, () => secuencia.detener);
            Object.assign(r, hecho);

            bitacora.push({
                hora: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", hour12: false }),
                usuario: usuarioOperador(), msisdn: linea, plu: r.plu, costo: r.costo, canal: r.canal,
                ok: r.estado === "ok", httpStatus: r.httpStatus, codigo: r.codigo,
                detalle: r.detalle, cambios: r.cambios, orden: r.orden ? r.orden.ordenId : "",
                estadoOrden: r.orden ? r.orden.estado : ""
            });
            MEUI.log(`${r.estado === "ok" ? "✔" : r.estado === "aviso" ? "⚠" : "✖"} PLU ${r.plu} · ${linea} · ${r.detalle}`,
                r.estado === "ok" ? "ok" : r.estado === "aviso" ? "warn" : "err");

            // La tabla y el detalle reflejan el último estado conocido.
            const i = filas.findIndex(x => x.msisdn === linea);
            if (i >= 0 && (r.final || r.despues)) {
                filas[i] = Object.assign({}, r.final || r.despues, { ultimoResultado: null });
                fila = filas[i];
            }
            render(); pintarSecuencia();

            // Un fallo NO detiene la secuencia: se registra y sigue con el
            // PLU siguiente, como en la consola. Detenerla es decisión del
            // analista con el botón «Detener».
        }

        secuencia.corriendo = false;
        el("seqDetener").hidden = true;
        validarSecuencia();
        pintarSecuencia();

        const ok = secuencia.items.filter(r => r.estado === "ok").length;
        const tipo = ok === secuencia.items.length ? "ok" : ok ? "warn" : "err";
        MEUI.log(`Secuencia terminada: ${ok} de ${secuencia.items.length} PLU correctos.`, tipo);
        MEUI.toast(`Secuencia terminada: ${ok}/${secuencia.items.length} correctos.`, tipo);
    });

    /* --- 8 · Exportaciones ------------------------------------------ */
    el("btnCSV").addEventListener("click", () => {
        const d = filasExport(filas); MEUI.exportarCSV(d.head, d.rows, "aplicar_plu");
    });
    el("btnXLSX").addEventListener("click", () => {
        const d = filasExport(filas); MEUI.exportarXLSX(d.head, d.rows, "aplicar_plu", "Líneas");
    });
    el("btnJSON").addEventListener("click", () => MEUI.exportarJSON(filas, "aplicar_plu"));

    el("btnBitacora").addEventListener("click", () => {
        if (!bitacora.length) { MEUI.toast("Todavía no se ha aplicado ningún PLU.", "warn"); return; }
        const d = filasBitacora(bitacora);
        MEUI.exportarCSV(d.head, d.rows, "bitacora_plu");
    });

    el("btnEvidencia").addEventListener("click", () => {
        if (!secuencia.items.length) { MEUI.toast("No hay secuencia que exportar.", "warn"); return; }
        const d = filasSecuencia(secuencia.linea, secuencia.items);
        MEUI.exportarCSV(d.head, d.rows, "evidencia_plu");
    });

    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        navigator.clipboard.writeText(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    MEUI.autoSpinner("#btnConsultar", "Consultando…");
})();
