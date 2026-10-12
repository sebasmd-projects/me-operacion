/* =====================================================================
   prefactura.js · Interfaz de «Pre-factura»
   ---------------------------------------------------------------------
   Va al final del <body>, después de calculo.js. Aquí vive la interfaz:
   lectura del archivo, editor de tarifas, tablas y descargas.
   Las reglas de negocio y los parámetros del cálculo (corte, impuestos,
   tarifas base) están en calculo.js (window.Prefactura).

   Contenido:
     1 · Configuración y constantes
     2 · Reglas de negocio: en calculo.js
     3 · Interfaz
===================================================================== */
(function () {
    "use strict";
    const el = id => document.getElementById(id);
    const P = window.Prefactura;
    if (!P) {
        MEUI.log("No cargó calculo.js: la herramienta queda inutilizable.", "err");
        return;
    }

    /* =================================================================
       1 · Configuración y constantes
    ================================================================= */
    /* --- Preferencias de este equipo (tolera almacenamiento bloqueado) -- */
    const CLAVE_TARIFAS = "me.prefactura.tarifas";
    const CLAVE_AGRUPA = "me.prefactura.agrupaciones";
    const leerPref = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } };
    const guardarPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: solo esta sesión */ } };

    /* =================================================================
       3 · Interfaz (las reglas de negocio están en calculo.js)
    ================================================================= */
    let tarifas = leerPref(CLAVE_TARIFAS, null) || P.TARIFAS_BASE.map(t => Object.assign({}, t));
    let libro = null;          // { wb, hojas, nombre }
    let lineasPlan = null;     // filas leídas de la hoja
    let anterior = null;       // Map filial → subtotal del mes anterior
    let resultado = null;      // salida de P.procesar
    let corteActual = null;
    const tablas = {};

    const pesos = n => n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("es-CO");
    const esc = s => MEUI.esc(String(s ?? ""));

    /* --- Mes y corte -------------------------------------------------- */
    (function mesPorDefecto() {
        const h = new Date();
        el("inputMes").value = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
        el("inputDiaCorte").value = P.DIA_CORTE;
    })();

    function corte() {
        const [a, m] = (el("inputMes").value || "").split("-").map(Number);
        const dia = Number(el("inputDiaCorte").value) || P.DIA_CORTE;
        if (!a || !m) return null;
        const ultimo = new Date(a, m, 0).getDate();
        return new Date(a, m - 1, Math.min(dia, ultimo), 23, 59, 59);
    }
    function pintarCorte() {
        const c = corte();
        el("infoCorte").textContent = c
            ? `Corte: ${c.getDate()} de ${P.MESES[c.getMonth()]} de ${c.getFullYear()}. Entra lo que ocurre hasta ese día, inclusive.`
            : "Elige el mes que se factura.";
    }
    ["inputMes", "inputDiaCorte"].forEach(id => el(id).addEventListener("change", () => { pintarCorte(); if (resultado) procesar(); }));
    pintarCorte();

    /* --- Archivo del Plan Corporativo --------------------------------- */
    el("inputArchivo").addEventListener("change", async () => {
        const f = el("inputArchivo").files[0];
        if (!f) return;
        try {
            MEUI.progreso.iniciar(2, "Leer Excel");
            libro = await MEUI.leerLibro(f);
            MEUI.progreso.paso(1, 2, "Leer hoja");
            const sel = el("selHoja");
            // value explícito: la hoja real se llama «Activos » (con espacio al
            // final) y el texto de un <option> pierde ese espacio.
            sel.innerHTML = libro.hojas.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join("");
            sel.value = P.elegirHoja(libro.hojas);
            sel.disabled = false;
            MEUI.log(`Archivo «${libro.nombre}»: ${libro.hojas.length} hoja(s). Se usa «${sel.value}».`, "ok");
            leerHoja();
            MEUI.progreso.fin({ fallidas: lineasPlan ? 0 : 1, mensaje: lineasPlan ? "Excel leído" : "No se pudo leer la hoja" });
        } catch (e) {
            MEUI.progreso.fin({ fallidas: 1 });
            libro = null; lineasPlan = null;
            el("btnProcesar").disabled = true;
            MEUI.log("✖ No se pudo leer el archivo: " + (e.message || e), "err");
            MEUI.toast("No se pudo leer el archivo.", "err");
        }
    });
    el("selHoja").addEventListener("change", leerHoja);

    function leerHoja() {
        if (!libro) return;
        const hoja = libro.wb.Sheets[el("selHoja").value];
        try {
            if (!hoja) throw new Error(`No se encontró la hoja «${el("selHoja").value}».`);
            // Solo las celdas que existen: la hoja real declara un millón de filas.
            const filas = P.filasDeHoja(XLSX, hoja);
            const r = P.leerActivas(filas);
            lineasPlan = r.lineas;
            el("btnProcesar").disabled = !lineasPlan.length;
            MEUI.log(`Hoja «${el("selHoja").value}»: ${r.lineas.length} línea(s) leídas (encabezado en la fila ${r.filaEncabezado}).`, "ok");
            if (r.descartadas.length) {
                MEUI.log(`${r.descartadas.length} fila(s) sin línea válida de 10 dígitos: `
                    + r.descartadas.slice(0, 10).map(d => `fila ${d.fila} «${d.valor}»`).join(", "), "warn");
            }
            if (r.columnas.observacion < 0) MEUI.log("La hoja no tiene columna «Observación»: no se aplica ninguna regla de corte.", "warn");
        } catch (e) {
            lineasPlan = null;
            el("btnProcesar").disabled = true;
            MEUI.log("✖ " + e.message, "err");
            MEUI.toast(e.message, "err");
        }
    }

    /* --- Tarifas -------------------------------------------------------- */
    function pintarTarifas() {
        const faltan = new Set((resultado?.sinTarifa || []));
        el("tbTarifas").innerHTML = tarifas.map((t, i) => `
<tr class="${t.valor === null || t.valor === undefined || t.valor === "" ? "falta" : ""}">
  <td style="width:5.2rem"><label class="visually-hidden" for="tarifaTipo${i}">Tipo</label><select id="tarifaTipo${i}" class="form-select form-select-sm" data-i="${i}" data-k="tipo">
    <option${t.tipo === "Voz" ? " selected" : ""}>Voz</option><option${t.tipo === "Datos" ? " selected" : ""}>Datos</option></select></td>
  <td><label class="visually-hidden" for="tarifaPlan${i}">Plan</label><input id="tarifaPlan${i}" class="form-control form-control-sm" data-i="${i}" data-k="plan" value="${esc(t.plan)}" placeholder="Plan"></td>
  <td style="width:6.5rem"><label class="visually-hidden" for="tarifaValor${i}">Valor con IVA</label><input id="tarifaValor${i}" class="form-control form-control-sm me-mono text-end" data-i="${i}" data-k="valor" inputmode="numeric" value="${t.valor === null || t.valor === undefined ? "" : esc(t.valor)}" placeholder="$"></td>
  <td style="width:1.6rem"><button class="btn btn-sm p-0 text-danger" data-quitar="${i}" aria-label="Quitar tarifa" title="Quitar"><i class="bi bi-x-lg"></i></button></td>
</tr>`).join("");
        const aviso = el("avisoTarifas");
        aviso.hidden = !faltan.size;
        aviso.innerHTML = faltan.size
            ? `<b>${faltan.size} plan(es) sin tarifa</b> — sus líneas no se suman: ${[...faltan].map(esc).join(", ")}. Escribe su valor con impuestos.`
            : "";
    }
    let tRe = null;
    function tarifasCambiaron() {
        guardarPref(CLAVE_TARIFAS, tarifas);
        clearTimeout(tRe);
        if (resultado) tRe = setTimeout(procesar, 400);
    }
    el("tbTarifas").addEventListener("input", e => {
        const d = e.target.dataset;
        if (d.i === undefined) return;
        const t = tarifas[Number(d.i)];
        if (d.k === "valor") {
            const dig = String(e.target.value).replace(/\D/g, "");
            t.valor = dig === "" ? null : Number(dig);     // vacío = sin tarifa; 0 = sin costo
            e.target.closest("tr").classList.toggle("falta", t.valor === null);
        } else t[d.k] = e.target.value;
        tarifasCambiaron();
    });
    el("tbTarifas").addEventListener("click", e => {
        const b = e.target.closest("[data-quitar]");
        if (!b) return;
        tarifas.splice(Number(b.dataset.quitar), 1);
        pintarTarifas(); tarifasCambiaron();
    });
    el("btnTarifaNueva").addEventListener("click", () => {
        tarifas.push({ tipo: "Datos", plan: "", valor: null });
        pintarTarifas();
        el("tbTarifas").querySelector("tr:last-child input[data-k=plan]").focus();
    });
    el("btnTarifasBase").addEventListener("click", () => {
        tarifas = P.TARIFAS_BASE.map(t => Object.assign({}, t));
        pintarTarifas(); tarifasCambiaron();
        MEUI.log("Tarifas restauradas a las de la herramienta.", "info");
    });

    /** Los planes sin tarifa se agregan solos a la tabla (sin valor) para
        que basta escribir el número. */
    function sembrarFaltantes() {
        if (!resultado) return;
        let nuevos = 0;
        for (const k of resultado.sinTarifa) {
            const [tipo, plan] = k.split(" · ");
            if (!tarifas.some(t => t.tipo === tipo && P.compacto(t.plan) === P.compacto(plan))) {
                tarifas.push({ tipo, plan, valor: null }); nuevos++;
            }
        }
        if (nuevos) guardarPref(CLAVE_TARIFAS, tarifas);
    }

    /* --- Agrupación de filiales ---------------------------------------- */
    el("inputAgrupaciones").value = leerPref(CLAVE_AGRUPA, P.AGRUPACIONES_BASE);
    el("inputAgrupaciones").addEventListener("input", () => {
        const { errores } = P.leerAgrupaciones(el("inputAgrupaciones").value);
        el("infoAgrupaciones").innerHTML = errores.length
            ? `<span class="text-danger">${errores.map(esc).join(" · ")}</span>`
            : "Un renglón por regla: <span class=\"me-mono\">patrón =&gt; filial</span>. El patrón se busca en el nombre de la empresa.";
        if (!errores.length) { guardarPref(CLAVE_AGRUPA, el("inputAgrupaciones").value); clearTimeout(tRe); if (resultado) tRe = setTimeout(procesar, 400); }
    });

    /* --- ICO y cargos de roaming ------------------------------------------ */
    const CLAVE_ICO = "me.prefactura.icoIncluido";
    el("chkIcoIncluido").checked = !!leerPref(CLAVE_ICO, false);
    el("chkIcoIncluido").addEventListener("change", () => {
        guardarPref(CLAVE_ICO, el("chkIcoIncluido").checked);
        MEUI.log(el("chkIcoIncluido").checked
            ? "ICO de voz incluido en el valor (valor / 1,23)."
            : "ICO de voz encima del valor (valor / 1,19 + 4 %), como Liquidación Corporativo 2.", "info");
        if (resultado) procesar();
    });

    function cargosEscritos() {
        const r = P.leerCargos(el("inputCargos").value);
        const total = r.cargos.reduce((s, c) => s + c.bruto, 0);
        el("infoCargos").innerHTML = r.errores.length
            ? `<span class="text-danger">${r.errores.slice(0, 4).map(esc).join(" · ")}</span>`
            : r.cargos.length
                ? `${r.cargos.length} cargo(s) · bruto ${pesos(total)}`
                : "Un renglón por cargo: <span class=\"me-mono\">línea;plan;valor bruto;mes</span>. Como en la liquidación, se escribe el <b>valor bruto</b> y de ahí salen IVA, ICO y retefuente.";
        return r;
    }
    el("inputCargos").addEventListener("input", () => {
        cargosEscritos();
        clearTimeout(tRe);
        if (resultado) tRe = setTimeout(procesar, 500);
    });

    /* --- Mes anterior ---------------------------------------------------- */
    el("inputAnterior").addEventListener("change", async () => {
        const f = el("inputAnterior").files[0];
        if (!f) { anterior = null; return; }
        try {
            MEUI.progreso.iniciar(1, "Leer mes anterior");
            const l = await MEUI.leerLibro(f);
            const hoja = l.hojas.find(h => /^filiales$/i.test(h)) || l.hojas[0];
            anterior = P.leerAnterior(MEUI.filasDeHoja(l.wb, hoja));
            el("infoAnterior").textContent = `«${l.nombre}» · hoja «${hoja}»: ${anterior.size} filial(es) con subtotal.`;
            MEUI.log(`Mes anterior: ${anterior.size} filial(es) leídas de «${l.nombre}».`, anterior.size ? "ok" : "warn");
            if (resultado) pintar();
            MEUI.progreso.fin({ fallidas: 0, mensaje: "Mes anterior leído" });
        } catch (e) {
            MEUI.progreso.fin({ fallidas: 1 });
            anterior = null;
            MEUI.log("✖ No se pudo leer el mes anterior: " + (e.message || e), "err");
        }
    });

    /* --- Procesar -------------------------------------------------------- */
    el("btnProcesar").addEventListener("click", procesar);

    function procesar() {
        const c = corte();
        if (!lineasPlan || !c) { MEUI.toast("Carga el Plan Corporativo y elige el mes.", "warn"); return; }
        MEUI.progreso.iniciar(2, "Generar pre-factura");
        try {
            corteActual = c;
            const cargos = cargosEscritos();
            if (cargos.errores.length) MEUI.log(`Cargos de roaming con errores (no se incluyen): ${cargos.errores.join(" · ")}`, "warn");
            resultado = P.procesar(lineasPlan, {
                corte: c, tarifas, agrupaciones: el("inputAgrupaciones").value,
                cargos: cargos.cargos, icoIncluido: el("chkIcoIncluido").checked
            });
            MEUI.progreso.paso(2, 2, "Preparar tablas");
            sembrarFaltantes();
            pintarTarifas();
            pintar();
            const t = P.sumar(resultado.liquidacion);
            MEUI.log(`Pre-factura ${P.MESES[c.getMonth()]} ${c.getFullYear()} (corte ${c.getDate()}): `
                + `${t.lineas} línea(s), ${resultado.filiales.length} filial(es), subtotal ${pesos(t.subtotal)}; `
                + `${resultado.excluidas.length} fuera del corte, ${resultado.revisar.length} para revisar.`, "ok");
            if (resultado.sinTarifa.length) {
                MEUI.log(`Planes sin tarifa (no se suman): ${resultado.sinTarifa.join(", ")}. Complétalos en el paso 2.`, "err");
                MEUI.abrirPaso(2, true);
            }
            MEUI.progreso.fin({ fallidas: 0, mensaje: "Pre-factura generada" });
        } catch (e) {
            MEUI.progreso.fin({ fallidas: 1 });
            Object.keys(DEF).forEach(n => MEUI.estadoTabla("#tbl" + n, "error", { reintentar: procesar }));
            MEUI.log("No se pudo generar la pre-factura: " + e.message, "err");
        }
    }

    function filialesComparadas() { return P.compararAnterior(resultado.filiales, anterior); }

    /* --- Tablas ------------------------------------------------------------ */
    const TAG_CAMBIO = { "Sin cambio": "ok", "Con cambio": "warn", "Sin dato anterior": "neutro" };
    const col = (title, f, opc) => Object.assign({ title, data: null, render: (d, type, row) => { const v = f(row); return type === "display" ? esc(v ?? "") : (v ?? ""); } }, opc || {});
    const colPesos = (title, f) => ({
        title, data: null, className: "num me-mono",
        // null = plan sin tarifa (se marca); undefined = no hay dato (mes anterior).
        render: (d, type, row) => {
            const v = f(row);
            if (type !== "display") return v ?? -1;
            return v === null ? '<span class="badge-estado err">Sin tarifa</span>' : v === undefined ? "—" : pesos(v);
        }
    });
    const colTag = (title, f, clase) => ({
        title, data: null,
        render: (d, type, row) => { const v = f(row); return type === "display" ? (v ? `<span class="badge-estado ${clase(v, row)}">${esc(v)}</span>` : "") : (v ?? ""); }
    });

    const DEF = {
        Filiales: () => ({
            datos: filialesComparadas(),
            columnas: [
                col("Filial", r => r.filial),
                col("Líneas", r => r.lineas, { className: "num" }),
                colPesos("Subtotal", r => r.sinTarifa ? null : r.subtotal),
                colPesos("Mes anterior", r => r.anterior ?? undefined),
                colPesos("Diferencia", r => r.diferencia ?? undefined),
                colTag("Cambio", r => r.cambio, v => TAG_CAMBIO[v] || "neutro"),
                colPesos("Valor neto", r => r.sinTarifa ? null : r.valorNeto)
            ],
            orden: [[2, "desc"]]
        }),
        Factura: () => ({
            datos: resultado.resumen,
            columnas: [
                col("Filial", r => r.filial), col("Empresa", r => r.empresa), col("Tipo", r => r.tipo),
                col("Líneas", r => r.registros, { className: "num" }),
                colPesos("Valor bruto", r => r.valorBruto), colPesos("IVA", r => r.iva), colPesos("ICO", r => r.ico),
                colPesos("Subtotal", r => r.subtotal), colPesos("Retefuente", r => r.retefuente), colPesos("Valor neto", r => r.valorNeto)
            ],
            orden: [[0, "asc"], [1, "asc"]]
        }),
        Liquidacion: () => ({
            datos: resultado.liquidacion,
            columnas: [
                col("Línea", r => r.linea, { className: "me-mono" }), col("Empresa", r => r.empresa), col("Filial", r => r.filial),
                col("Mes creación", r => r.mes), col("Plan", r => r.plan), col("Tipo", r => r.tipo), col("ID", r => r.id, { className: "me-mono" }),
                col("Estado", r => r.estado), col("Validación", r => r.validacion),
                colPesos("Valor total", r => r.valorTotal), colPesos("Valor bruto", r => r.valorBruto), colPesos("IVA", r => r.iva),
                colPesos("ICO", r => r.ico), colPesos("Subtotal", r => r.subtotal), colPesos("Retefuente", r => r.retefuente),
                colPesos("Valor neto", r => r.valorNeto), col("Nota", r => r.regla)
            ],
            orden: [[1, "asc"]]
        }),
        Excluidas: () => ({
            datos: resultado.excluidas,
            columnas: [
                col("Fila", r => r.fila, { className: "num" }), col("Línea", r => r.linea, { className: "me-mono" }), col("Empresa", r => r.empresa),
                col("Voz", r => r.voz), col("Datos", r => r.datos), col("Observación", r => r.observacion),
                colTag("Motivo", r => r.motivo, () => "warn")
            ],
            orden: [[0, "asc"]]
        }),
        Revisar: () => ({
            datos: resultado.revisar,
            columnas: [
                col("Línea", r => r.linea, { className: "me-mono" }), col("Empresa", r => r.empresa),
                colTag("Motivo", r => r.motivo, () => "err"), col("Observación", r => r.observacion || "")
            ],
            orden: [[1, "asc"]]
        })
    };

    function pintarTabla(nombre) {
        const sel = "#tbl" + nombre;
        const d = DEF[nombre]();
        if (tablas[nombre]) { tablas[nombre].destroy(); tablas[nombre] = null; }
        el("tbl" + nombre).innerHTML = "";
        MEUI.estadoTabla(sel, d.datos.length ? "listo" : "vacio");
        if (!d.datos.length) {
            el("tbl" + nombre).style.display = "none";
            el("msgVacio" + nombre).hidden = true;
            el("msgVacio" + nombre).textContent = nombre === "Revisar" ? "Nada para revisar." : nombre === "Excluidas" ? "Todas las líneas entran en este corte." : "Sin datos.";
            return;
        }
        el("msgVacio" + nombre).hidden = true;
        MEUI.prepararTabla(sel);
        tablas[nombre] = MEUI.tabla(sel, { data: d.datos, columns: d.columnas, order: d.orden, pageLength: 25, lengthMenu: [10, 25, 50, 100, 250] });
    }

    function pintar() {
        const t = P.sumar(resultado.liquidacion);
        const hayFaltantes = resultado.sinTarifa.length > 0;
        el("kLineas").textContent = t.lineas.toLocaleString("es-CO");
        el("kFiliales").textContent = resultado.filiales.length;
        el("kExcluidas").textContent = resultado.excluidas.length;
        el("kRevisar").textContent = resultado.revisar.length + (hayFaltantes ? resultado.liquidacion.filter(f => f.sinTarifa).length : 0);
        el("kSubtotal").textContent = hayFaltantes ? "Incompleto" : pesos(t.subtotal);
        el("cFiliales").textContent = resultado.filiales.length;
        el("cLiquidacion").textContent = resultado.liquidacion.length;
        el("cExcluidas").textContent = resultado.excluidas.length;
        el("cRevisar").textContent = resultado.revisar.length;
        Object.keys(DEF).forEach(pintarTabla);
        el("btnConsolidado").disabled = false;
        el("btnZip").disabled = false;
        el("btnGuardarRed").disabled = false;
        pintarDestino();
    }

    // Una tabla en una pestaña oculta no mide bien: se reajusta al mostrarla.
    document.querySelectorAll('.me-tabs [data-bs-toggle="tab"]').forEach(b =>
        b.addEventListener("shown.bs.tab", () => MEUI.ajustarTablas()));

    /* --- Descargas ---------------------------------------------------------- */
    const sufijo = () => `${corteActual.getFullYear()}-${String(corteActual.getMonth() + 1).padStart(2, "0")}`;

    function confirmarIncompleto() {
        if (!resultado.sinTarifa.length) return true;
        MEUI.toast(`Hay ${resultado.sinTarifa.length} plan(es) sin tarifa: complétalos antes de descargar.`, "err");
        MEUI.abrirPaso(2, true);
        return false;
    }

    el("btnConsolidado").addEventListener("click", () => {
        if (!resultado || !confirmarIncompleto()) return;
        const wb = P.libroConsolidado(XLSX, resultado, filialesComparadas(), corteActual);
        XLSX.writeFile(wb, `prefactura_corporativo_${sufijo()}.xlsx`);
        MEUI.log(`Consolidado descargado: prefactura_corporativo_${sufijo()}.xlsx. Guárdalo: el mes siguiente sirve de «mes anterior».`, "ok");
    });

    /* --- ZIP: donde el usuario escoja --------------------------------------- */
    const nombreZip = () => `${P.nombreMes(corteActual)}.zip`;

    async function armarZip() {
        if (typeof JSZip === "undefined") throw new Error("No cargó la librería JSZip (CDN).");
        MEUI.progreso.iniciar(1, "Generar ZIP");
        try {
            const blob = await P.zipFiliales(XLSX, JSZip, resultado, corteActual);
            MEUI.progreso.fin({ fallidas: 0, mensaje: "ZIP generado" });
            return blob;
        } catch (e) { MEUI.progreso.fin({ fallidas: 1 }); throw e; }
    }

    /** «Guardar como» (el usuario elige dónde). Sin el selector va a
        Descargas. Si el navegador ya no reconoce el clic (pasó tiempo), con
        soloSelector no descarga nada: queda el botón del aviso. */
    async function guardarZip(blob, soloSelector) {
        if (window.showSaveFilePicker) {
            try {
                const h = await window.showSaveFilePicker({
                    suggestedName: nombreZip(),
                    types: [{ description: "Archivo ZIP", accept: { "application/zip": [".zip"] } }]
                });
                if ((await h.getFile()).size && !await MEUI.confirmarEscritura({
                    titulo: "Reemplazar ZIP", accion: "Reemplazar", resumen: [["Archivo", h.name], ["Destino", "Carpeta elegida"]]
                })) return { cancelado: true };
                const w = await h.createWritable();
                await w.write(blob);
                await w.close();
                return { donde: h.name };
            } catch (e) {
                if (e.name === "AbortError") return { cancelado: true };
                if (e.name !== "SecurityError") throw e;
                if (soloSelector) return { sinGesto: true };
            }
        }
        MEUI.descargar(blob, nombreZip());
        return { donde: "Descargas" };
    }

    el("btnZip").addEventListener("click", () => MEUI.conSpinner(el("btnZip"), "Armando…", async () => {
        if (!resultado || !confirmarIncompleto()) return;
        try {
            const r = await guardarZip(await armarZip());
            if (r.cancelado) { MEUI.toast("No se guardó el .zip.", "warn"); return; }
            MEUI.log(`ZIP «${nombreZip()}» guardado (${r.donde}): carpeta «${P.nombreMes(corteActual)}» con ${resultado.filiales.length} archivo(s).`, "ok");
        } catch (e) {
            MEUI.log("✖ No se pudo guardar el .zip: " + (e.message || e), "err");
        }
    }));

    /* --- Guardar en la carpeta de la red -------------------------------------- */
    let carpetaBase = null;      // carpeta elegida (vive mientras la página esté abierta)

    function pintarDestino() {
        if (!corteActual) return;
        const btn = el("btnGuardarRed");
        const html = '<i class="bi bi-hdd-network"></i> ' + esc(`Guardar en «${P.carpetaAnio(corteActual)}\\${P.nombreMes(corteActual)}»`);
        // Con el spinner puesto, MEUI restaura el contenido guardado al soltar.
        if (btn.dataset.meOcupado) btn.dataset.meTexto = html; else btn.innerHTML = html;
        btn.title = P.rutaDestino(corteActual);
    }

    function avisoDestino(html, clase) {
        const a = el("avisoDestino");
        a.className = "alert py-2 mt-2 mb-0 small alert-" + (clase || "info");
        a.innerHTML = html;
        a.hidden = !html;
    }

    async function carpetaConPermiso() {
        if (carpetaBase) {
            const q = await carpetaBase.queryPermission({ mode: "readwrite" });
            if (q === "granted" || (await carpetaBase.requestPermission({ mode: "readwrite" })) === "granted") return carpetaBase;
        }
        // El selector no puede abrir una ruta de red por sí solo: se copia
        // para pegarla en su barra de direcciones.
        MEUI.copiarTexto(P.RUTA_RED).catch(() => { });
        MEUI.toast("Elige la carpeta «Plan Corporativo». La ruta quedó copiada: pégala en la barra del selector.", "info");
        carpetaBase = await window.showDirectoryPicker({ id: "prefactura-plan-corporativo", mode: "readwrite" });
        return carpetaBase;
    }

    el("btnGuardarRed").addEventListener("click", () => MEUI.conSpinner(el("btnGuardarRed"), "Guardando…", async () => {
        if (!resultado || !confirmarIncompleto()) return;
        const destino = P.rutaDestino(corteActual);
        avisoDestino("");
        try {
            if (!window.showDirectoryPicker) throw new Error("este navegador no permite escribir en carpetas (usa Edge desde «dame click.bat»)");
            const base = await carpetaConPermiso();
            const archivos = P.archivosFiliales(XLSX, resultado);
            MEUI.progreso.iniciar(1, "Guardar archivos en red");
            const corteGuardado = corteActual;
            let r = await P.escribirEnCarpeta(base, corteGuardado, archivos, { reemplazar: false });
            if (!r.escritos.length && r.existentes.length) {
                if (!await MEUI.confirmarEscritura({
                    titulo: "Reemplazar archivos de pre-factura", accion: "Reemplazar archivos",
                    resumen: [["Operación", "Sobrescribir archivos"], ["Carpeta", r.ruta],
                        ["Cantidad", r.existentes.length], ["Destino", "Carpeta de red · archivos Excel"]],
                    items: r.existentes, aviso: "Los archivos existentes se reemplazarán con la pre-factura actual."
                })) { MEUI.progreso.fin({ ok: false, fallidas: 0, mensaje: "Guardado cancelado" }); return; }
                r = await P.escribirEnCarpeta(base, corteGuardado, archivos, { reemplazar: true });
            }
            MEUI.progreso.fin({ fallidas: 0, mensaje: `${r.escritos.length} archivos guardados` });
            pintarDestino();
            avisoDestino(`✔ ${r.escritos.length} archivo(s) guardados en <span class="me-mono">${esc(r.ruta)}</span>`
                + (r.existentes.length ? ` (${r.existentes.length} reemplazado(s))` : "") + ".", "success");
            MEUI.log(`✔ Guardados ${r.escritos.length} archivo(s) de filial en «${r.ruta}» (${destino}).`, "ok");
            MEUI.toast(`Guardado en ${P.nombreMes(corteActual)}.`, "ok");
        } catch (e) {
            pintarDestino();
            MEUI.progreso.fin({ fallidas: 1 });
            const cancelado = e && e.name === "AbortError";
            const motivo = cancelado ? "no se eligió la carpeta" : (e.message || String(e));
            MEUI.log(`✖ No se pudo guardar en ${destino}: ${motivo}. Se ofrece el .zip.`, "err");
            avisoDestino(`<b>No se pudo guardar en la red</b> (${esc(motivo)}). Guarda el .zip donde quieras y cópialo a
                <span class="me-mono">${esc(destino)}</span>.
                <button type="button" class="btn btn-sm btn-me ms-2" id="btnZipAviso"><i class="bi bi-file-earmark-zip"></i> Guardar ${esc(nombreZip())}</button>`, "danger");
            el("btnZipAviso").addEventListener("click", () => el("btnZip").click());
            MEUI.toast("No se pudo guardar en la red. Elige dónde guardar el .zip.", "err");
            // Se intenta de una vez; si el navegador ya no acepta abrir el
            // selector, queda el botón del aviso (un clic nuevo).
            if (!cancelado) {
                try {
                    const z = await guardarZip(await armarZip(), true);
                    if (z.donde) MEUI.log(`ZIP «${nombreZip()}» guardado (${z.donde}).`, "ok");
                } catch (e2) { /* queda el botón del aviso */ }
            }
        }
    }));

    /* --- Registro ----------------------------------------------------------- */
    el("btnLimpiarLog").addEventListener("click", () => MEUI.limpiarLog());
    el("btnCopiarLog").addEventListener("click", () => {
        MEUI.copiarTexto(el("logConexion").innerText)
            .then(() => MEUI.toast("Registro copiado.", "ok"))
            .catch(() => MEUI.toast("No se pudo copiar.", "err"));
    });

    pintarTarifas();
    MEUI.log("Herramienta lista. Todo se procesa en este equipo; no se consulta ningún servicio.", "ok");
})();
