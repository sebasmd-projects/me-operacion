/* =====================================================================
   dependencias.js · Registro ÚNICO de librerías de CDN
   ---------------------------------------------------------------------
   Aquí viven el nombre, la versión y las URLs de cada librería externa.
   Cambiar una versión es cambiar UNA línea de este archivo; las páginas
   solo dicen qué usan:

     <head>
       <script src="../assets/base/dependencias.js"
               data-me-deps="datatables xlsx"></script>
       <link rel="stylesheet" href="../assets/base/me-ui.css">
       ...

   Va en el <head>, antes de cualquier otro script. Bootstrap, Bootstrap
   Icons y las fuentes se cargan siempre; no hace falta declararlos.
   Las librerías que dependen de otras (datatables → jquery) arrastran
   sus requisitos solas y no se repiten.

   POR QUÉ document.write
   Las herramientas son scripts clásicos que se abren sobre file:// y no
   hay paso de build. Un <script> escrito con document.write mientras el
   HTML se analiza se descarga y se ejecuta en orden, de forma síncrona,
   ANTES de los scripts de la página que vienen después. Con createElement
   el orden no está garantizado (los scripts insertados son asíncronos) y
   con import/fetch file:// lo bloquea. Es la única forma de conservar el
   orden de siempre sin herramientas de construcción.

   Cada entrada del registro:
     nombre    texto para el log y la documentación
     version   la versión que se pide; se sustituye en {v} de las URLs
     requiere  otras librerías que deben cargarse antes (por clave)
     css, js   listas de URLs, en el orden en que se cargan
     defer     (opcional) los .js se piden con `defer`: se bajan en paralelo y
               corren al terminar el análisis del HTML (jsPDF pesa ~350 KB y
               bloqueante retrasaba el primer pintado de la página)
===================================================================== */
(function (global) {
  "use strict";

  /* =====================================================================
     1 · REGISTRO
  ===================================================================== */
  const REGISTRO = {
    bootstrap: {
      nombre: "Bootstrap", version: "5.3.3",
      css: ["https://cdn.jsdelivr.net/npm/bootstrap@{v}/dist/css/bootstrap.min.css"],
      js: ["https://cdn.jsdelivr.net/npm/bootstrap@{v}/dist/js/bootstrap.bundle.min.js"]
    },
    iconos: {
      nombre: "Bootstrap Icons", version: "1.11.3",
      css: ["https://cdn.jsdelivr.net/npm/bootstrap-icons@{v}/font/bootstrap-icons.min.css"]
    },
    fuentes: {
      nombre: "Google Fonts (Archivo e IBM Plex Mono)", version: "",
      css: ["https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800"
        + "&family=IBM+Plex+Mono:wght@400;500;600&display=swap"]
    },
    jquery: {
      nombre: "jQuery", version: "3.7.1",
      js: ["https://code.jquery.com/jquery-{v}.min.js"]
    },
    datatables: {
      nombre: "DataTables", version: "2.3.2",
      requiere: ["jquery", "bootstrap"],
      css: ["https://cdn.datatables.net/{v}/css/dataTables.bootstrap5.css"],
      js: ["https://cdn.datatables.net/{v}/js/dataTables.js",
        "https://cdn.datatables.net/{v}/js/dataTables.bootstrap5.js"]
    },
    xlsx: {
      nombre: "SheetJS", version: "0.18.5",
      js: ["https://cdnjs.cloudflare.com/ajax/libs/xlsx/{v}/xlsx.full.min.js"]
    },
    tomselect: {
      nombre: "Tom Select", version: "2.4.3",
      css: ["https://cdn.jsdelivr.net/npm/tom-select@{v}/dist/css/tom-select.bootstrap5.min.css"],
      js: ["https://cdn.jsdelivr.net/npm/tom-select@{v}/dist/js/tom-select.complete.min.js"]
    },
    jszip: {
      nombre: "JSZip", version: "3.10.1",
      js: ["https://cdnjs.cloudflare.com/ajax/libs/jszip/{v}/jszip.min.js"]
    },
    jspdf: {
      nombre: "jsPDF", version: "2.5.1", defer: true,
      js: ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/{v}/jspdf.umd.min.js"]
    },
    lamejs: {
      nombre: "lamejs", version: "1.2.1",
      js: ["https://cdnjs.cloudflare.com/ajax/libs/lamejs/{v}/lame.min.js"]
    },
    chartjs: {
      nombre: "Chart.js", version: "4.4.1",
      js: ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/{v}/chart.umd.min.js"]
    },
    marked: {
      nombre: "marked", version: "12.0.2",
      js: ["https://cdn.jsdelivr.net/npm/marked@{v}/marked.min.js"]
    }
  };

  /* Se cargan en TODAS las páginas, en este orden. */
  const SIEMPRE = ["fuentes", "bootstrap", "iconos"];

  /* =====================================================================
     2 · RESOLUCIÓN
  ===================================================================== */
  const urlDe = (plantilla, lib) => plantilla.replace("{v}", lib.version);

  /** Claves en el orden de carga: primero lo que otro necesita, sin repetir. */
  function resolver(declaradas) {
    const orden = [];
    const visitar = clave => {
      if (orden.indexOf(clave) >= 0) return;
      const lib = REGISTRO[clave];
      if (!lib) throw new Error("dependencias.js: la librería «" + clave + "» no está en el registro.");
      (lib.requiere || []).forEach(visitar);
      orden.push(clave);
    };
    SIEMPRE.concat(declaradas).forEach(visitar);
    return orden;
  }

  /** URLs de una librería ya con la versión puesta: { css: [...], js: [...] }. */
  function urls(clave) {
    const lib = REGISTRO[clave];
    if (!lib) throw new Error("dependencias.js: la librería «" + clave + "» no está en el registro.");
    return {
      css: (lib.css || []).map(u => urlDe(u, lib)),
      js: (lib.js || []).map(u => urlDe(u, lib))
    };
  }

  /* =====================================================================
     3 · ESCRITURA EN EL <head>
     Primero todos los estilos y luego los scripts, como estaba antes en
     cada HTML. El cierre del script va partido («<\/script>») para que el
     analizador no lo tome por el final de ESTE archivo.
  ===================================================================== */
  function escribir(claves) {
    const css = [], js = [];
    claves.forEach(clave => {
      const lib = REGISTRO[clave];
      const u = urls(clave);
      u.css.forEach(href => css.push('<link rel="stylesheet" href="' + href + '">'));
      u.js.forEach(src => js.push('<script ' + (lib.defer ? "defer " : "") + 'src="' + src + '"><\/script>'));
    });
    document.write(css.concat(js).join("\n"));
  }

  /* =====================================================================
     4 · ARRANQUE
  ===================================================================== */
  const propio = document.currentScript || document.querySelector("script[data-me-deps]");
  const declaradas = ((propio && propio.getAttribute("data-me-deps")) || "")
    .split(/\s+/).filter(Boolean);

  escribir(resolver(declaradas));

  /** API mínima: otros módulos consultan la URL de una librería (p. ej. me-ui.js
      carga «marked» solo cuando se abre una documentación). */
  global.ME_DEPENDENCIAS = { registro: REGISTRO, urls };
})(window);
