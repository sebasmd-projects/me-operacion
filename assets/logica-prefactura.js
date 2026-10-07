/* =====================================================================
   logica-prefactura.js · Pre-factura del Plan Corporativo
   ---------------------------------------------------------------------
   Reemplaza el proceso a mano en Excel que se mostró en la reunión
   «Prefactura» (2025-03-17): «Plan Corporativo 1» → «Liquidación
   Corporativo 1» (tablas dinámicas de Voz y Datos, Copia, Base) →
   «Liquidación Corporativo 2» (valores, impuestos y tabla «Factura») →
   un archivo por filial en «AAAA Facturación\NN. Mes\Compañía».

   Todo es local: lee el Excel del Plan Corporativo en el navegador y
   genera los Excel. No llama a ningún servicio.

   Se publica como window.Prefactura (IIFE): no declara globales sueltas.
===================================================================== */
(function (global) {
    "use strict";

    const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
        "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const MESES_TITULO = MESES.map(m => m[0].toUpperCase() + m.slice(1));

    /* ---------------------------------------------------------------
       Parámetros del proceso (de la reunión)
       - Corte: hasta el día 15 del mes («Recuerda que el corte es hasta el 15»).
       - Impuestos: fórmulas de «Liquidación Corporativo 2» (hoja Activos):
           Valor bruto = Valor / 1,19     (L = K/1.19)
           IVA         = 19 % del bruto    (M = L*19%)
           ICO         = 4 % del bruto, solo Voz   (N = SI(Tipo="Voz"; L*4%; 0))
           Subtotal    = bruto + IVA + ICO (O = L+M+N)
           Retefuente  = 2,5 % del bruto   (P = L*2.5%)
           Valor neto  = subtotal − retefuente
         Así en Voz el ICO se cobra ENCIMA del valor (12.500 → 12.920,17).
         En la grabación de marzo 2025 el ICO iba INCLUIDO (Voz = valor/1,23,
         subtotal = valor): queda como opción («icoIncluido»).
    --------------------------------------------------------------- */
    const DIA_CORTE = 15;
    const IMPUESTOS = { iva: 0.19, ico: 0.04, retefuente: 0.025 };

    // Tarifas = «Hoja2» de Liquidación Corporativo 2 (BUSCARV del valor por
    // nombre de plan). Valor con IVA. Los planes de roaming no tienen valor
    // en esa hoja (el BUSCARV da 0): se facturan aparte y aquí van en 0.
    const TARIFAS_BASE = [
        { tipo: "Datos", plan: "40GB", valor: 24900 },
        { tipo: "Datos", plan: "20GB", valor: 15000 },
        { tipo: "Datos", plan: "100GB", valor: 39900 },
        { tipo: "Datos", plan: "Whatsapp old", valor: 600 },
        { tipo: "Datos", plan: "Combo 2", valor: 50000 },
        { tipo: "Datos", plan: "Combo 3", valor: 34900 },
        { tipo: "Datos", plan: "Combo 4", valor: 24900 },
        { tipo: "Datos", plan: "Whatsapp ALL", valor: 600 },
        { tipo: "Datos", plan: "Botmaker", valor: 2750 },
        { tipo: "Datos", plan: "Datos Roaming", valor: 0 },
        { tipo: "Datos", plan: "SMS Roaming", valor: 0 },
        { tipo: "Voz", plan: "100 CE", valor: 1800 },
        { tipo: "Voz", plan: "200 CE", valor: 3600 },
        { tipo: "Voz", plan: "300 CE", valor: 6000 },
        { tipo: "Voz", plan: "Ilimitado AB", valor: 12500 },
        { tipo: "Voz", plan: "Ilimitado", valor: 12500 },
        { tipo: "Voz", plan: "Voz Roaming", valor: 0 }
    ];

    // Empresas que se facturan juntas en un mismo archivo de filial, y el
    // nombre del archivo, como en la carpeta «Compañía».
    // «patrón => filial»; el patrón es una expresión regular sobre el nombre.
    const AGRUPACIONES_BASE = [
        "^viva\\b => Viva Malls",
        "^p\\.?\\s*a\\.?\\s+centro comercial => Viva Malls",
        "^almacenes [eé]xito => Almacenes Éxito S.A.S"
    ].join("\n");

    /* ---------------------------------------------------------------
       Utilidades
    --------------------------------------------------------------- */
    const norm = s => String(s ?? "").toLowerCase().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const compacto = s => norm(s).replace(/ /g, "");
    const VACIOS = new Set(["", "#n/a", "n/a", "na", "no aplica", "#value!", "#ref!", "0", "-", "ninguno"]);
    const vacio = v => VACIOS.has(String(v ?? "").trim().toLowerCase());
    const texto = v => vacio(v) ? "" : String(v).trim();
    const redondear = n => Math.round(n);

    function lineaDe(v) {
        let d = String(v ?? "").replace(/\D/g, "");
        if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
        return d;
    }

    /* ---------------------------------------------------------------
       1 · Leer la hoja «Activas» del Plan Corporativo
       La primera columna (la línea) no tiene título en el archivo real,
       así que las columnas se ubican por el encabezado y la línea por
       descarte (columna sin título o con alias de línea).
    --------------------------------------------------------------- */
    const COLUMNAS = {
        empresa: ["empresa"],
        mes: ["mes creacion", "mes creacion linea", "mes"],
        voz: ["voz", "plan voz"],
        datos: ["datos", "plan datos"],
        botmaker: ["botmaker"],
        id: ["id", "id suscripcion", "suscripcion"],
        estado: ["estado"],
        validacion: ["validacion"],
        nit: ["nit"],
        observacion: ["observacion", "observaciones"]
    };
    const ALIAS_LINEA = ["linea", "lineas", "msisdn", "numero", "celular", "movil", "telefono", "min"];

    function elegirHoja(nombres) {
        return nombres.find(n => /^activ(a|o)s$/.test(norm(n))) || nombres.find(n => norm(n).startsWith("activ")) || nombres[0];
    }

    /** Filas de una hoja (arreglo de arreglos, texto como se ve en Excel)
        armadas SOLO con las celdas que existen. El Plan Corporativo declara
        A1:K1044522 (hay una lista de precios en la fila 1.044.509) y
        sheet_to_json recorre ese millón de filas vacías: ~12 s. Así son
        unas 19 mil celdas: milisegundos. */
    function filasDeHoja(XLSX, ws) {
        const porFila = new Map();
        for (const k of Object.keys(ws)) {
            if (k[0] === "!") continue;
            const cel = ws[k];
            if (!cel || cel.v === undefined || cel.v === null) continue;
            const { r, c } = XLSX.utils.decode_cell(k);
            const texto = cel.t === "e" ? (cel.w || "#N/A") : (cel.w !== undefined ? cel.w : String(cel.v));
            (porFila.get(r) || porFila.set(r, []).get(r))[c] = texto;
        }
        // Cada fila lleva su número real de Excel en .fila (para «Fuera del corte»).
        return [...porFila.keys()].sort((a, b) => a - b).map(r => Object.assign(Array.from(porFila.get(r), v => v ?? ""), { fila: r + 1 }));
    }

    /** filas: arreglo de arreglos (sheet_to_json con header:1). */
    function leerActivas(filas) {
        const iCab = filas.findIndex(f => (f || []).some(c => norm(c) === "empresa"));
        if (iCab < 0) throw new Error("No se encontró el encabezado: falta la columna «Empresa».");
        const cab = filas[iCab].map(norm);
        const col = {};
        for (const [k, alias] of Object.entries(COLUMNAS)) {
            const i = cab.findIndex(h => alias.includes(h));
            col[k] = i;
        }
        let iLinea = cab.findIndex(h => ALIAS_LINEA.includes(h));
        if (iLinea < 0) iLinea = cab.findIndex((h, i) => h === "" && !Object.values(col).includes(i));
        if (iLinea < 0) iLinea = 0;
        const faltan = ["empresa", "voz", "datos"].filter(k => col[k] < 0);
        if (faltan.length) throw new Error("Faltan columnas en la hoja: " + faltan.join(", ") + ".");

        const lineas = [];
        const descartadas = [];
        for (let r = iCab + 1; r < filas.length; r++) {
            const f = filas[r] || [];
            const v = k => col[k] >= 0 ? f[col[k]] : "";
            const linea = lineaDe(f[iLinea]);
            const empresa = texto(v("empresa"));
            if (!linea && !empresa) continue;                       // fila vacía
            if (linea.length !== 10) {
                if (linea.length < 7) continue;                     // texto suelto (p. ej. la lista de precios al final)
                descartadas.push({ fila: f.fila || r + 1, valor: String(f[iLinea] ?? ""), motivo: "La línea no tiene 10 dígitos" });
                continue;
            }
            lineas.push({
                fila: f.fila || r + 1, linea, empresa,
                mes: texto(v("mes")), voz: texto(v("voz")), datos: texto(v("datos")), botmaker: texto(v("botmaker")),
                id: texto(v("id")), estado: texto(v("estado")), validacion: texto(v("validacion")),
                nit: texto(v("nit")), observacion: String(v("observacion") ?? "").trim()
            });
        }
        return { lineas, descartadas, columnas: col, filaEncabezado: (filas[iCab] && filas[iCab].fila) || iCab + 1 };
    }

    /* ---------------------------------------------------------------
       2 · Observaciones y corte
       Reglas dichas en la reunión:
         - «Se activa el 17 de marzo» (después del corte) → se elimina:
           entra en el siguiente corte.
         - «Se cancela el 13» (dentro del corte) → se elimina.
         - «Se cancela … y se reactiva el 17» → se elimina.
         - «Se bloquea» → NO se elimina: el plan no se canceló y se sigue
           facturando; solo se le quita la observación.
         - «Se activa» dentro del corte → se queda; se le quita la observación.
       Una observación que no encaja en ninguna regla NO se resuelve sola:
       la línea se factura y queda en «Revisar».
    --------------------------------------------------------------- */
    // «Se activa el 17 de marzo», «se cancela el 21 de abril y se reactiva el
    // 5 de mayo», «Se activa 01 de octubre», «Se activa el 08 octubre»,
    // «Se cambia a combo 4 el 14 de enero 2026».
    const EVENTO = /(re\s*activ|activ|cancel|inactiv|desactiv|retir|bloque|suspend|cambi|modific|actualiz)\w*(?:\s+(?:a|con|coon)\s+[a-z0-9 ]+?(?=\s+el\s+\d))?\s+(?:el\s+|desde\s+el\s+|a\s+partir\s+del?\s+)?(\d{1,2})(?:\s+(?:de\s+)?([a-z]+))?(?:\s+(?:de\s+)?(20\d\d))?/g;
    const TIPO_EVENTO = t => /^re\s*activ/.test(t) || /^activ/.test(t) ? "alta"
        : /^(cancel|inactiv|desactiv|retir)/.test(t) ? "baja"
            : /^(bloque|suspend)/.test(t) ? "bloqueo" : "cambio";

    const mesDe = palabra => {
        const w = palabra === "setiembre" ? "septiembre" : palabra;
        return w ? MESES.findIndex(m => w.startsWith(m)) : -1;    // «abrilo» → abril
    };
    const sumarMeses = (f, n) => new Date(f.getFullYear(), f.getMonth() + n, f.getDate(), 23, 59, 59);

    /* Las observaciones se acumulan mes a mes en el Plan Corporativo y casi
       nunca traen año («Se activa el 15 de diciembre» puede ser de hace diez
       meses). Sin año se toma la fecha más reciente que no pase de un mes
       después del corte: lo anotado para el próximo corte es futuro y lo
       demás es historia. */
    function fechaEvento(dia, mesTxt, anioTxt, corte) {
        let mes = mesDe(mesTxt);
        if (mes < 0) mes = corte.getMonth();
        let anio = anioTxt ? Number(anioTxt) : corte.getFullYear();
        let f = new Date(anio, mes, dia);
        if (f.getMonth() !== mes) return null;            // 31 de febrero → inválida
        if (!anioTxt) {
            const limite = sumarMeses(corte, 1);
            while (f > limite) f = new Date(f.getFullYear() - 1, mes, dia);
            if (f <= sumarMeses(corte, -11)) f = new Date(f.getFullYear() + 1, mes, dia);
        }
        return f;
    }

    const fmtFecha = f => `${f.getDate()} de ${MESES[f.getMonth()]}`;

    function evaluarObservacion(obs, corte) {
        const t = norm(obs);
        if (!t) return { incluir: true, regla: "", aviso: "" };
        const eventos = [];
        let m;
        EVENTO.lastIndex = 0;
        while ((m = EVENTO.exec(t))) {
            const fecha = fechaEvento(Number(m[2]), m[3], m[4], corte);
            if (fecha) eventos.push({ tipo: TIPO_EVENTO(m[1]), fecha, conAnio: !!m[4] });
        }
        const esCambio = /cambi|modific|actualiz|agreg|anad|adicion/.test(t);
        if (!eventos.length) {
            if (/bloque|suspend/.test(t)) return { incluir: true, regla: "Bloqueada: se sigue facturando (el plan no se canceló)", aviso: "" };
            // «Se agrega 300 CE», «Cambia a voz ilimitada»: el plan de la hoja
            // ya es el nuevo. Sin fecha no se puede ubicar en el corte.
            if (esCambio) return { incluir: true, regla: "Cambio de plan sin fecha: se factura el plan de la hoja", aviso: "" };
            return { incluir: true, regla: "", aviso: "Observación sin regla: revisarla a mano" };
        }
        eventos.sort((a, b) => a.fecha - b.fecha);
        const anterior = sumarMeses(corte, -1);           // corte del mes pasado
        const enPeriodo = e => e.fecha > anterior && e.fecha <= corte;
        const cambioDespues = eventos.find(e => e.tipo === "cambio" && e.fecha > corte);
        const cambios = eventos.filter(e => e.tipo === "alta" || e.tipo === "baja");
        if (!cambios.length) {
            if (cambioDespues) return { incluir: true, regla: "", aviso: `Cambio de plan el ${fmtFecha(cambioDespues.fecha)}, después del corte: la hoja ya trae el plan nuevo; confirmar cuál se factura` };
            if (eventos.some(e => e.tipo === "bloqueo")) return { incluir: true, regla: "Bloqueada: se sigue facturando (el plan no se canceló)", aviso: "" };
            const enEste = eventos.find(e => e.tipo === "cambio" && enPeriodo(e));
            return { incluir: true, regla: enEste ? `Cambio de plan el ${fmtFecha(enEste.fecha)} (en este corte)` : "", aviso: "" };
        }

        // Solo una CANCELACIÓN saca la línea del corte. Una activación sin
        // año («Se activa el 17 de octubre») no se tiene en cuenta: puede ser
        // de cualquier año y la línea ya está en Activos. Una reactivación
        // solo cuenta después de una cancelación de la misma observación
        // («se cancela el 21 de abril, se reactiva el 5 de mayo»).
        const bajas = cambios.filter(e => e.tipo === "baja");
        if (!bajas.length) {
            const altaFutura = cambios.find(e => e.tipo === "alta" && e.conAnio && e.fecha > corte);
            if (altaFutura) {
                return { incluir: false, regla: `Se activa el ${fmtFecha(altaFutura.fecha)} de ${altaFutura.fecha.getFullYear()}: entra en el siguiente corte`, aviso: "" };
            }
            if (cambioDespues) return { incluir: true, regla: "", aviso: `Cambio de plan el ${fmtFecha(cambioDespues.fecha)}, después del corte: la hoja ya trae el plan nuevo; confirmar cuál se factura` };
            return { incluir: true, regla: "", aviso: "" };
        }

        let activa = true;
        for (const e of cambios) {
            if (e.fecha > corte) continue;
            if (e.tipo === "baja") activa = false;
            else if (!activa) activa = true;                 // reactivación tras una cancelación
        }
        const dentro = cambios.filter(e => e.fecha <= corte);
        const ultimaBaja = [...dentro].reverse().find(e => e.tipo === "baja");
        if (!activa) {
            const sigue = cambios.find(e => e.tipo === "alta" && e.fecha > ultimaBaja.fecha);
            return {
                incluir: false,
                regla: (enPeriodo(ultimaBaja)
                    ? `Se cancela el ${fmtFecha(ultimaBaja.fecha)} (en este corte)`
                    : `Cancelada el ${fmtFecha(ultimaBaja.fecha)} (antes de este corte) y no se reactivó`)
                    + (sigue ? `; se reactiva el ${fmtFecha(sigue.fecha)}, después del corte` : ""),
                aviso: ""
            };
        }
        const bajaDespues = cambios.find(e => e.tipo === "baja" && e.fecha > corte);
        if (bajaDespues) {
            return { incluir: true, regla: "", aviso: `Se cancela el ${fmtFecha(bajaDespues.fecha)}, después del corte: se factura este mes` };
        }
        if (cambioDespues) {
            return { incluir: true, regla: "", aviso: `Cambio de plan el ${fmtFecha(cambioDespues.fecha)}, después del corte: la hoja ya trae el plan nuevo; confirmar cuál se factura` };
        }
        const reactiva = ultimaBaja && cambios.find(e => e.tipo === "alta" && e.fecha > ultimaBaja.fecha && e.fecha <= corte);
        return { incluir: true, regla: reactiva ? `Cancelada el ${fmtFecha(ultimaBaja.fecha)} y reactivada el ${fmtFecha(reactiva.fecha)}` : "", aviso: "" };
    }

    /* ---------------------------------------------------------------
       3 · Tarifas e impuestos
    --------------------------------------------------------------- */
    function indiceTarifas(tarifas) {
        const m = new Map();
        for (const t of tarifas) {
            // null/"" = sin tarifa (bloquea); 0 = sin costo a propósito (roaming).
            if (!t || !t.plan || t.valor === null || t.valor === "" || t.valor === undefined || !(Number(t.valor) >= 0)) continue;
            m.set(t.tipo + "|" + compacto(t.plan), { valor: Number(t.valor), plan: String(t.plan).trim() });
        }
        return m;
    }

    function calcular(valor, tipo, icoIncluido) {
        const conIco = tipo === "Voz";
        const bruto = valor / (1 + IMPUESTOS.iva + (conIco && icoIncluido ? IMPUESTOS.ico : 0));
        const iva = bruto * IMPUESTOS.iva;
        const ico = conIco ? bruto * IMPUESTOS.ico : 0;
        // Con ICO incluido, bruto + IVA + ICO es exactamente el valor: se usa
        // tal cual para que el subtotal no arrastre decimales.
        const subtotal = conIco && !icoIncluido ? bruto + iva + ico : valor;
        const retefuente = bruto * IMPUESTOS.retefuente;
        return { valorTotal: valor, valorBruto: bruto, iva, ico, subtotal, retefuente, valorNeto: subtotal - retefuente };
    }

    /** Roaming: en la liquidación se escribe el VALOR BRUTO del cargo (no hay
        tarifa) y las fórmulas sacan IVA, ICO, subtotal y retefuente de ahí. */
    function calcularDesdeBruto(bruto, tipo) {
        const iva = bruto * IMPUESTOS.iva;
        const ico = tipo === "Voz" ? bruto * IMPUESTOS.ico : 0;
        const subtotal = bruto + iva + ico;
        const retefuente = bruto * IMPUESTOS.retefuente;
        return { valorTotal: null, valorBruto: bruto, iva, ico, subtotal, retefuente, valorNeto: subtotal - retefuente };
    }

    /** «11552», «11.552», «11,552», «48.588,6», «48588.6», «107199,3166667». */
    function numero(txt) {
        let v = String(txt ?? "").replace(/[$\s]/g, "");
        const p = v.lastIndexOf("."), c = v.lastIndexOf(",");
        if (p >= 0 && c >= 0) {                       // los dos: el último es el decimal
            v = p > c ? v.replace(/,/g, "") : v.replace(/\./g, "").replace(",", ".");
        } else if (c >= 0) {                          // solo coma: miles si son grupos de 3
            v = /^\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, "") : v.replace(",", ".");
        } else if (p >= 0 && /^\d{1,3}(\.\d{3})+$/.test(v)) {
            v = v.replace(/\./g, "");                 // 11.552 = once mil
        }
        return Number(v);
    }

    /** Cargos de roaming pegados: «línea;plan;valor bruto;mes» por renglón
        (también coma, tabulación o |). El plan dice el tipo: «Voz Roaming» es
        Voz; lo demás, Datos. El valor acepta 11552, 11.552 o 48588,6. */
    function leerCargos(texto) {
        const cargos = [], errores = [];
        String(texto || "").split(/\r?\n/).forEach((l, i) => {
            if (!l.trim()) return;
            const c = l.split(/[;\t|]/).map(x => x.trim());
            if (c.length < 3 && l.includes(",")) c.splice(0, c.length, ...l.split(",").map(x => x.trim()));
            const linea = lineaDe(c[0]);
            if (linea.length !== 10) { if (i > 0 || /\d{7}/.test(l)) errores.push(`Renglón ${i + 1}: línea inválida`); return; }
            const plan = c[1] || "";
            const bruto = numero(c[2]);
            if (!plan || !isFinite(bruto) || bruto <= 0) { errores.push(`Renglón ${i + 1}: falta el plan o el valor bruto`); return; }
            cargos.push({ linea, plan, tipo: /voz/i.test(plan) ? "Voz" : "Datos", bruto, mes: c[3] || "" });
        });
        return { cargos, errores };
    }

    /* ---------------------------------------------------------------
       4 · Filiales (un archivo por filial)
    --------------------------------------------------------------- */
    function leerAgrupaciones(txt) {
        const reglas = [];
        const errores = [];
        String(txt || "").split(/\r?\n/).forEach((l, i) => {
            if (!l.trim() || l.trim().startsWith("#")) return;
            const p = l.split("=>");
            if (p.length !== 2 || !p[0].trim() || !p[1].trim()) { errores.push(`Renglón ${i + 1}: usa «patrón => filial»`); return; }
            try { reglas.push({ re: new RegExp(p[0].trim(), "i"), filial: p[1].trim() }); }
            catch (e) { errores.push(`Renglón ${i + 1}: patrón inválido`); }
        });
        return { reglas, errores };
    }
    const filialDe = (empresa, reglas) => (reglas.find(r => r.re.test(empresa)) || {}).filial || empresa;

    /* ---------------------------------------------------------------
       5 · Proceso completo
       opciones: { corte: Date, tarifas: [...], agrupaciones: "texto" }
    --------------------------------------------------------------- */
    function procesar(lineasPlan, opciones) {
        const corte = opciones.corte;
        const precios = indiceTarifas(opciones.tarifas || TARIFAS_BASE);
        const { reglas } = leerAgrupaciones(opciones.agrupaciones ?? AGRUPACIONES_BASE);

        // «Viva la Ceja» y «Viva La Ceja» son la misma empresa (una tabla
        // dinámica de Excel tampoco distingue mayúsculas): se unifican al
        // nombre más usado.
        const conteo = new Map();
        for (const l of lineasPlan) {
            const k = norm(l.empresa);
            const c = conteo.get(k) || conteo.set(k, new Map()).get(k);
            const nombre = l.empresa.replace(/\s+/g, " ").trim();
            c.set(nombre, (c.get(nombre) || 0) + 1);
        }
        const canonica = new Map([...conteo].map(([k, c]) => [k, [...c].sort((a, b) => b[1] - a[1])[0][0]]));
        const nombreEmpresa = e => canonica.get(norm(e)) || e;

        const liquidacion = [];   // una fila por línea y tipo (Voz / Datos)
        const excluidas = [];     // fuera del corte
        const revisar = [];       // avisos que necesitan ojo humano
        const vistas = new Map();

        for (const l of lineasPlan) {
            if (vistas.has(l.linea)) {
                revisar.push({ linea: l.linea, empresa: l.empresa, motivo: `Línea repetida en el Plan Corporativo (filas ${vistas.get(l.linea)} y ${l.fila}): se factura una sola vez` });
                continue;
            }
            vistas.set(l.linea, l.fila);

            const ev = evaluarObservacion(l.observacion, corte);
            if (!ev.incluir) { excluidas.push(Object.assign({}, l, { motivo: ev.regla })); continue; }
            if (ev.aviso) revisar.push({ linea: l.linea, empresa: l.empresa, motivo: ev.aviso, observacion: l.observacion });
            if (l.estado && norm(l.estado) !== "activo") revisar.push({ linea: l.linea, empresa: l.empresa, motivo: `Estado «${l.estado}» en el Plan Corporativo: se factura; confirmar` });
            if (!l.empresa) revisar.push({ linea: l.linea, empresa: "", motivo: "Sin empresa: no queda en ninguna filial" });

            const planes = [];
            if (l.voz) planes.push({ tipo: "Voz", plan: l.voz });
            if (l.datos) planes.push({ tipo: "Datos", plan: l.datos });
            if (l.botmaker) planes.push({ tipo: "Datos", plan: "Botmaker" });
            if (!planes.length) {
                revisar.push({ linea: l.linea, empresa: l.empresa, motivo: "Sin plan de voz, datos ni Botmaker: revisar en el CM qué tiene la línea" });
                continue;
            }
            for (const p of planes) {
                const tarifa = precios.get(p.tipo + "|" + compacto(p.plan));
                const valor = tarifa ? tarifa.valor : undefined;
                const empresa = nombreEmpresa(l.empresa);
                const fila = {
                    linea: l.linea, empresa, filial: filialDe(empresa, reglas), mes: l.mes,
                    plan: tarifa ? tarifa.plan : p.plan, tipo: p.tipo, id: l.id, estado: l.estado, validacion: l.validacion, nit: l.nit,
                    regla: ev.regla, sinTarifa: valor === undefined
                };
                Object.assign(fila, valor === undefined
                    ? { valorTotal: null, valorBruto: null, iva: null, ico: null, subtotal: null, retefuente: null, valorNeto: null }
                    : calcular(valor, p.tipo, !!opciones.icoIncluido));
                liquidacion.push(fila);
            }
        }
        // Cargos de roaming: la empresa y los datos de la línea salen del
        // Plan Corporativo (aunque la línea esté fuera del corte).
        const porLinea = new Map(lineasPlan.map(l => [l.linea, l]));
        for (const c of (opciones.cargos || [])) {
            const l = porLinea.get(c.linea);
            if (!l) { revisar.push({ linea: c.linea, empresa: "", motivo: `Cargo de ${c.plan} para una línea que no está en el Plan Corporativo: no se factura` }); continue; }
            const empresa = nombreEmpresa(l.empresa);
            liquidacion.push(Object.assign({
                linea: c.linea, empresa, filial: filialDe(empresa, reglas), mes: c.mes || l.mes, plan: c.plan, tipo: c.tipo,
                id: l.id, estado: l.estado, validacion: l.validacion, nit: l.nit, regla: "Cargo de roaming (valor bruto)", sinTarifa: false, cargo: true
            }, calcularDesdeBruto(c.bruto, c.tipo)));
        }

        const sinTarifa = [...new Set(liquidacion.filter(f => f.sinTarifa).map(f => f.tipo + " · " + f.plan))];
        return { liquidacion, excluidas, revisar, sinTarifa, resumen: resumir(liquidacion), filiales: porFilial(liquidacion), opciones: { icoIncluido: !!opciones.icoIncluido } };
    }

    const CAMPOS_VALOR = ["valorBruto", "iva", "ico", "subtotal", "retefuente", "valorNeto"];

    function sumar(filas) {
        const t = { lineas: new Set(filas.map(f => f.linea)).size, registros: filas.length };
        CAMPOS_VALOR.forEach(k => { t[k] = filas.reduce((s, f) => s + (f[k] || 0), 0); });
        return t;
    }

    /** Equivale a la tabla dinámica «Factura»: Empresa × Tipo. */
    function resumir(liquidacion) {
        const grupos = new Map();
        for (const f of liquidacion) {
            const k = f.filial + "\u0000" + f.empresa + "\u0000" + f.tipo;
            (grupos.get(k) || grupos.set(k, []).get(k)).push(f);
        }
        return [...grupos.entries()].map(([k, filas]) => {
            const [filial, empresa, tipo] = k.split("\u0000");
            return Object.assign({ filial, empresa, tipo }, sumar(filas));
        }).sort((a, b) => a.filial.localeCompare(b.filial) || a.empresa.localeCompare(b.empresa) || a.tipo.localeCompare(b.tipo));
    }

    function porFilial(liquidacion) {
        const g = new Map();
        liquidacion.forEach(f => (g.get(f.filial) || g.set(f.filial, []).get(f.filial)).push(f));
        return [...g.entries()].map(([filial, filas]) => Object.assign({ filial, sinTarifa: filas.some(f => f.sinTarifa) }, sumar(filas)))
            .sort((a, b) => b.subtotal - a.subtotal);
    }

    /* ---------------------------------------------------------------
       6 · Mes anterior (para ver qué filial cambió)
       Acepta el consolidado que exporta esta herramienta (hoja «Filiales»)
       o cualquier hoja con columnas Filial/Empresa y Subtotal.
    --------------------------------------------------------------- */
    function leerAnterior(filasObjetos) {
        const m = new Map();
        for (const f of filasObjetos) {
            const claves = Object.keys(f);
            const kNombre = claves.find(c => norm(c) === "filial") || claves.find(c => norm(c) === "empresa");
            const kSub = claves.find(c => norm(c).startsWith("subtotal") || norm(c) === "suma de subtotal");
            if (!kNombre || !kSub) continue;
            const nombre = String(f[kNombre] || "").trim();
            const valor = Number(String(f[kSub]).replace(/[$\s.]/g, "").replace(",", "."));
            if (!nombre || !isFinite(valor) || norm(nombre).startsWith("total")) continue;
            m.set(nombre, (m.get(nombre) || 0) + valor);
        }
        return m;
    }

    function compararAnterior(filiales, anterior) {
        return filiales.map(f => {
            const ant = anterior ? anterior.get(f.filial) : undefined;
            const dif = ant === undefined ? null : redondear(f.subtotal) - redondear(ant);
            return Object.assign({}, f, {
                anterior: ant === undefined ? null : ant,
                diferencia: dif,
                cambio: ant === undefined ? "Sin dato anterior" : dif === 0 ? "Sin cambio" : "Con cambio"
            });
        });
    }

    /* ---------------------------------------------------------------
       7 · Libros de Excel
    --------------------------------------------------------------- */
    const FMT_PESOS = "#,##0";
    const CAB_LIQ = ["Línea", "Empresa", "Mes creación", "Plan", "Tipo", "ID", "Estado", "Validación", "NIT",
        "Valor total", "Valor bruto", "IVA", "ICO", "Subtotal", "Retefuente", "Valor neto"];
    const filaLiq = f => [f.linea, f.empresa, f.mes, f.plan, f.tipo, f.id, f.estado, f.validacion, f.nit,
        f.valorTotal, f.valorBruto, f.iva, f.ico, f.subtotal, f.retefuente, f.valorNeto];
    const CAB_RES = ["Empresa", "Tipo", "Líneas", "Valor bruto", "IVA", "ICO", "Subtotal", "Retefuente", "Valor neto"];
    const filaRes = r => [r.empresa, r.tipo, r.registros, r.valorBruto, r.iva, r.ico, r.subtotal, r.retefuente, r.valorNeto];
    const filaTotal = (etiqueta, t) => [etiqueta, "", t.registros, t.valorBruto, t.iva, t.ico, t.subtotal, t.retefuente, t.valorNeto];

    function hoja(XLSX, cab, filas, columnasPesos) {
        const ws = XLSX.utils.aoa_to_sheet([cab, ...filas]);
        ws["!autofilter"] = { ref: ws["!ref"] };
        ws["!cols"] = cab.map(h => ({ wch: Math.min(40, Math.max(11, String(h).length + 3)) }));
        (columnasPesos || []).forEach(c => {
            for (let r = 1; r <= filas.length; r++) {
                const cel = ws[XLSX.utils.encode_cell({ r, c })];
                if (cel && typeof cel.v === "number") cel.z = FMT_PESOS;
            }
        });
        return ws;
    }
    const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

    function nombreMes(corte) { return `${String(corte.getMonth() + 1).padStart(2, "0")}. ${MESES_TITULO[corte.getMonth()]}`; }

    /** Consolidado: todo el proceso en un libro. */
    function libroConsolidado(XLSX, r, filialesComparadas, corte) {
        const opcionesUsadas = r.opciones || {};
        const wb = XLSX.utils.book_new();
        const total = sumar(r.liquidacion);
        XLSX.utils.book_append_sheet(wb, hoja(XLSX,
            ["Filial", "Líneas", "Subtotal", "Subtotal mes anterior", "Diferencia", "Cambio", "Valor neto", "Sin tarifa"],
            filialesComparadas.map(f => [f.filial, f.lineas, f.subtotal, f.anterior, f.diferencia, f.cambio, f.valorNeto, f.sinTarifa ? "Sí" : ""]),
            [2, 3, 4, 6]), "Filiales");
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, ["Filial", ...CAB_RES],
            [...r.resumen.map(x => [x.filial, ...filaRes(x)]), ["Total general", ...filaTotal("", total)]], rango(4, 9)), "Factura");
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, ["Filial", ...CAB_LIQ], r.liquidacion.map(f => [f.filial, ...filaLiq(f)]), rango(10, 16)), "Liquidación");
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, ["Fila", "Línea", "Empresa", "Voz", "Datos", "Botmaker", "Observación", "Motivo"],
            r.excluidas.map(e => [e.fila, e.linea, e.empresa, e.voz, e.datos, e.botmaker, e.observacion, e.motivo])), "Excluidas");
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, ["Línea", "Empresa", "Motivo", "Observación"],
            r.revisar.map(x => [x.linea, x.empresa, x.motivo, x.observacion || ""])), "Revisar");
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, ["Parámetro", "Valor"], [
            ["Corte", `${corte.getDate()} de ${MESES[corte.getMonth()]} de ${corte.getFullYear()}`],
            ["IVA", IMPUESTOS.iva], ["ICO (solo voz)", IMPUESTOS.ico], ["Retefuente (sobre el bruto)", IMPUESTOS.retefuente],
            ["ICO de voz", opcionesUsadas.icoIncluido ? "Incluido en el valor del plan (valor / 1,23)" : "Encima del valor del plan (valor / 1,19 + 4 %)"],
            ["Generado", new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })]
        ]), "Parámetros");
        return wb;
    }

    /** Archivo de una filial: hojas «Facturas» y «Liquidación», como en la
        carpeta Compañía (en la Liquidación no va la columna Validación). */
    function libroFilial(XLSX, r, filial) {
        const wb = XLSX.utils.book_new();
        const res = r.resumen.filter(x => x.filial === filial);
        const liq = r.liquidacion.filter(f => f.filial === filial);
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, CAB_RES,
            [...res.map(filaRes), filaTotal("Total general", sumar(liq))], rango(3, 8)), "Facturas");
        const quitar = new Set([7]);      // Validación
        XLSX.utils.book_append_sheet(wb, hoja(XLSX, CAB_LIQ.filter((_, i) => !quitar.has(i)),
            liq.map(f => filaLiq(f).filter((_, i) => !quitar.has(i))), rango(8, 14)), "Liquidación");
        return wb;
    }

    const nombreArchivo = s => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Sin empresa";

    /* ---------------------------------------------------------------
       8 · Destino: carpeta de la red o .zip
       Los archivos de filial van DIRECTO en la carpeta del mes
       («10. Octubre»), sin subcarpetas, dentro de «AAAA Facturación».
    --------------------------------------------------------------- */
    const RUTA_RED = "\\\\296nas01\\TodosNal1\\Especiales\\Documentacion\\Movil Exito\\Auxiliar Movil Exito\\Plan Corporativo";
    const carpetaAnio = corte => `${corte.getFullYear()} Facturación`;
    const rutaDestino = corte => `${RUTA_RED}\\${carpetaAnio(corte)}\\${nombreMes(corte)}`;

    /** [{ nombre: "CyR.xlsx", datos: ArrayBuffer }, …] */
    function archivosFiliales(XLSX, r) {
        return r.filiales.map(f => ({
            nombre: nombreArchivo(f.filial) + ".xlsx",
            datos: XLSX.write(libroFilial(XLSX, r, f.filial), { bookType: "xlsx", type: "array" })
        }));
    }

    /** ZIP con una sola carpeta, la del mes: «10. Octubre/<Filial>.xlsx». */
    async function zipFiliales(XLSX, JSZip, r, corte) {
        const zip = new JSZip();
        const carpeta = zip.folder(nombreMes(corte));
        for (const a of archivosFiliales(XLSX, r)) carpeta.file(a.nombre, a.datos);
        return zip.generateAsync({ type: "blob" });
    }

    /** Escribe en una carpeta elegida con el selector del navegador
        (FileSystemDirectoryHandle). Acepta que se elija «Plan Corporativo»,
        «AAAA Facturación» o la propia carpeta del mes. Si ya hay archivos con
        el mismo nombre y no se pidió reemplazar, no escribe nada y los
        devuelve en «existentes». */
    async function escribirEnCarpeta(base, corte, archivos, opciones) {
        const o = opciones || {};
        const anio = carpetaAnio(corte), mes = nombreMes(corte);
        let dirMes, ruta;
        if (norm(base.name) === norm(mes)) { dirMes = base; ruta = base.name; }
        else {
            const dirAnio = norm(base.name) === norm(anio) ? base : await base.getDirectoryHandle(anio, { create: true });
            dirMes = await dirAnio.getDirectoryHandle(mes, { create: true });
            ruta = (dirAnio === base ? base.name : `${base.name}\\${anio}`) + "\\" + mes;
        }
        const nombres = new Set(archivos.map(a => a.nombre));
        const existentes = [];
        for await (const [nombre, h] of dirMes.entries()) if (h.kind === "file" && nombres.has(nombre)) existentes.push(nombre);
        if (existentes.length && !o.reemplazar) return { ruta, escritos: [], existentes };
        const escritos = [];
        for (const a of archivos) {
            const fh = await dirMes.getFileHandle(a.nombre, { create: true });
            const w = await fh.createWritable();
            await w.write(a.datos);
            await w.close();
            escritos.push(a.nombre);
        }
        return { ruta, escritos, existentes };
    }

    global.Prefactura = {
        DIA_CORTE, IMPUESTOS, TARIFAS_BASE, AGRUPACIONES_BASE, MESES,
        elegirHoja, filasDeHoja, leerActivas, evaluarObservacion, calcular, calcularDesdeBruto, leerCargos, leerAgrupaciones, filialDe,
        procesar, sumar, leerAnterior, compararAnterior,
        libroConsolidado, libroFilial, archivosFiliales, zipFiliales, escribirEnCarpeta, RUTA_RED, rutaDestino,
        carpetaAnio, nombreMes, nombreArchivo, compacto
    };
})(typeof window !== "undefined" ? window : globalThis);
