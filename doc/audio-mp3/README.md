# Convertir audio a MP3

## Objetivo

Convertir uno o varios archivos de audio a MP3 sin cargar información a servidores. La herramienta está optimizada inicialmente para archivos `.ogg` y `.m4a` y acepta los demás formatos que el navegador pueda decodificar.

## Uso

1. Abre **Convertir audio a MP3** desde el menú lateral o desde Inicio.
2. Arrastra uno o varios audios, o selecciónalos desde el explorador de archivos.
3. Elige la calidad. Para audios de voz se recomienda **128 kbps**; 96 kbps reduce el tamaño.
4. Pulsa **Convertir pendientes**.
5. Descarga cada resultado o usa **Descargar resultados**. Si hay varios, se genera un ZIP.

## Convención de nombres

- `llamada.ogg` se convierte en `mp3-llamada.mp3`.
- `grabación.m4a` se convierte en `mp3-grabación.mp3`.
- Si dos archivos producen el mismo nombre, el siguiente recibe un consecutivo: `mp3-llamada-2.mp3`.
- Si el nombre ya comienza por `mp3-`, no se duplica el prefijo.

## Privacidad y compatibilidad

La lectura, normalización y codificación ocurren localmente en el navegador. Ningún audio sale del equipo. El formato de salida sí es MP3 real; la aplicación no se limita a cambiar la extensión.

La compatibilidad de entrada depende del motor multimedia del navegador y de los códecs instalados en el sistema. En Microsoft Edge, los formatos OGG/Opus y M4A/AAC habituales son compatibles. Un contenedor dañado o un códec no reconocido se marcará como error sin detener los demás archivos del lote.

## Historial de cambios

### 1.0.0

- Conversión local de OGG, M4A y otros formatos compatibles a MP3.
- Selección múltiple y arrastrar/soltar.
- Calidades de 96, 128, 192 y 256 kbps.
- Descarga individual o conjunta en ZIP.
- Prefijo de salida `mp3-` y control de nombres repetidos.
- Reproductor para validar cada resultado antes de descargarlo.
