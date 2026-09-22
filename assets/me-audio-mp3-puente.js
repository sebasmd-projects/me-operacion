(function (global) {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    global.MEUI?.init({
      app: "audio-mp3",
      version: "1.0.0",
      titulo: "Convertir audio a MP3",
      descripcion: "Convierte uno o varios audios localmente y conserva su nombre como mp3-*.mp3.",
      doc: "../doc/audio-mp3/README.md",
      sesiones: [],
      etiquetas: ["Audio", "MP3", "Local"]
    });

    const herramienta = global.AudioMP3;
    const entrada = document.querySelector("#audio-input");
    const zona = document.querySelector("#audio-drop");
    if (!herramienta || !entrada || !zona) return;

    const abrirSelector = () => entrada.click();
    zona.addEventListener("click", abrirSelector);
    zona.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        abrirSelector();
      }
    });
    entrada.addEventListener("change", () => {
      herramienta.agregar(entrada.files);
      entrada.value = "";
    });
    ["dragenter", "dragover"].forEach((nombre) => zona.addEventListener(nombre, (evento) => {
      evento.preventDefault();
      zona.classList.add("is-over");
    }));
    ["dragleave", "drop"].forEach((nombre) => zona.addEventListener(nombre, (evento) => {
      evento.preventDefault();
      zona.classList.remove("is-over");
    }));
    zona.addEventListener("drop", (evento) => herramienta.agregar(evento.dataTransfer?.files));

    document.querySelector("#audio-convertir").addEventListener("click", herramienta.convertirPendientes);
    document.querySelector("#audio-descargar-todo").addEventListener("click", herramienta.descargarTodo);
    document.querySelector("#audio-limpiar").addEventListener("click", herramienta.limpiar);
    document.querySelector("#audio-lista").addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-audio-accion]");
      const fila = evento.target.closest("[data-audio-id]");
      if (!boton || !fila) return;
      if (boton.dataset.audioAccion === "descargar") herramienta.descargar(fila.dataset.audioId);
      if (boton.dataset.audioAccion === "eliminar") herramienta.eliminar(fila.dataset.audioId);
    });

    herramienta.renderizar();
  });
})(window);
