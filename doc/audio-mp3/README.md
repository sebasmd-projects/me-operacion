# Convertir audio a MP3 — Documentación técnica

> **Versión: v1.0.0** · Convención: `Major.Minor.Patch` (*major* · *minor* · *fix/documentación*).
> Base compartida: ver `doc/lanzador/README.md`.

Convierte uno o varios archivos de audio a **MP3 real** sin cargar información a servidores. Está optimizada inicialmente para archivos `.ogg` y `.m4a` y acepta los demás formatos que el navegador pueda decodificar.

---

## 1. Objetivos

- Convertir audios (por ejemplo, grabaciones de llamadas o notas de voz) a MP3 sin instalar programas.
- Que **ningún audio salga del equipo**: todo el proceso ocurre en el navegador.
- Mantener un nombre de salida predecible (`mp3-*.mp3`) y descargar los lotes juntos.

---

## 2. Arquitectura y archivos

| Archivo | Qué hace |
| --- | --- |
| `herramientas/convertir_audio_mp3.html` | Marcado. Sin lógica. |
| `assets/logica-audio-mp3.js` | Decodificación, normalización a 44,1 kHz, codificación MP3, nombres de salida y ZIP. |
| `assets/me-audio-mp3-puente.js` | Enganche con el shell (`MEUI.init`, versión, registro). |

No usa `me-api.js`: no consulta ningún servicio interno.

---

## 3. Herramientas de terceros

| Librería | Para qué |
| --- | --- |
| **Web Audio API** (del navegador) | Decodificar el audio de entrada. |
| **lamejs** (CDN) | Codificar a MP3. |
| **JSZip** (CDN) | Agrupar varios resultados en un `.zip`. |

---

## 4. Funcionalidad

1. Abre **Convertir audio a MP3** desde el menú lateral o desde Inicio.
2. Arrastra uno o varios audios, o selecciónalos desde el explorador de archivos.
3. Elige la calidad. Para audios de voz se recomienda **128 kbps**; 96 kbps reduce el tamaño.
4. Pulsa **Convertir pendientes**.
5. Escucha cada resultado en el reproductor y descárgalo, o usa **Descargar resultados**. Si hay varios, se genera un ZIP.

### Convención de nombres

- `llamada.ogg` se convierte en `mp3-llamada.mp3`.
- `grabación.m4a` se convierte en `mp3-grabación.mp3`.
- Si dos archivos producen el mismo nombre, el siguiente recibe un consecutivo: `mp3-llamada-2.mp3`.
- Si el nombre ya comienza por `mp3-`, no se duplica el prefijo.

---

## 5. Riesgos y límites

- **Compatibilidad de entrada**: depende del motor multimedia del navegador y de los códecs del sistema. En Microsoft Edge, OGG/Opus y M4A/AAC habituales funcionan. Un contenedor dañado o un códec no reconocido se marca como error sin detener el resto del lote.
- **Dependencia de CDN**: si `lamejs` o `JSZip` no cargan, la conversión o el ZIP no están disponibles.
- **Memoria**: los audios se decodifican completos en memoria; lotes muy grandes o archivos muy largos pueden volver lento el navegador.
- **Privacidad**: la lectura, normalización y codificación ocurren localmente; ningún audio se envía a servicios internos ni externos.

---

## 6. Historial de cambios

| Versión | Cambios |
| --- | --- |
| **1.0.0** | Conversión local de OGG, M4A y otros formatos compatibles a MP3; selección múltiple y arrastrar/soltar; calidades de 96, 128, 192 y 256 kbps; descarga individual o conjunta en ZIP; prefijo `mp3-` con control de nombres repetidos; reproductor para validar cada resultado antes de descargarlo. Documentación llevada a la estructura común (sin cambio de versión de la herramienta). |
