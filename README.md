# MUSICAL SYSTEM

Mezclador DJ de dos decks en el navegador. El sonido sale de un `AudioContext` real: cada deck decodifica el archivo elegido, crea un `AudioBufferSourceNode` y lo suma en el master.

## Qué hace esta versión

- Cargar un MP3 u otro audio que el navegador pueda decodificar, sin modificar el archivo.
- Deck A y Deck B, la misma lógica: play, pausa, stop, seek, cue, volumen, tiempo y duración.
- Los dos decks pueden sonar a la vez.
- Crossfader de potencia constante, volumen master y EQ de tres bandas.
- Waveform calculada del PCM, espectro y medidores leídos del analizador.
- BPM de etiqueta ID3, estimación por autocorrelación o entrada manual. Si no hay pulso claro, queda en "No detectado".
- Pitch/tempo acoplados con `playbackRate`. Sync de tempo si ambos decks tienen BPM y el resultado cabe en el rango.
- Loop real y jog: empuje de tempo en play, búsqueda en pausa.
- Errores visibles si el archivo está vacío, no es audio, no decodifica o el navegador bloquea el audio.

## Qué todavía no hace

Keylock, scratch, sync de fase, biblioteca persistente y cue por auriculares. Esos controles no están en la interfaz para no simularlos.

## Uso

```bash
npm install
npm run dev
```

Abre la app, pulsa **Activar audio** si el navegador lo pide, carga un archivo en cada deck y pulsa Play. No hay pistas incluidas.

## Scripts

- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
