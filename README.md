# Musical System — Mezclador DJ

Mezclador DJ de dos decks que corre 100% en el navegador, con biblioteca local persistente.
Reconstrucción de la especificación del PR #1 (cerrado sin merge), ahora con pruebas y una base más sólida.

## Características

**Motor de audio (Web Audio API, un solo `AudioContext`)**
- Dos decks independientes que suman a un bus master real: `source → EQ low/mid/high → volumen de canal → crossfader → master`.
- Play / pausa / stop / seek / cue (marcar y saltar) sobre nodos reales.
- EQ de 3 bandas por canal (−26 dB a +9 dB), volumen por canal, crossfader de potencia constante (−3 dB al centro), volumen master.
- **Limitador master** bypassable (`DynamicsCompressorNode`, ratio 20:1) con medidor de reducción de ganancia.

**Decks**
- **Waveform** dibujada desde los picos del PCM decodificado; clic/arrastre para buscar; marcador de cue y región de loop.
- Medidores de nivel por deck (con peak-hold) y espectro del bus master.
- **BPM**: del tag ID3 (`TBPM`), si no, estimado por autocorrelación de envolvente de onsets; editable a mano y con ×2 / ½ para corregir octavas.
- **Pitch y tempo acoplados** (fader ±8 %, estilo vinilo), **Sync** de tempo entre decks (rechaza lo que salga del rango de pitch), **loop nativo** (`loopStart`/`loopEnd`) con In/Out/Salir, y **jog**: nudge de tempo girando mientras suena, búsqueda al arrastrar en pausa.
- Sin keylock, scratch, sync de fase ni cue de audífonos: esos controles no se muestran a propósito.

**Biblioteca local**
- Los bytes originales del archivo se guardan en **OPFS**; si el navegador no lo expone, respaldo automático en **IndexedDB**; último recurso, memoria (avisado con un toast).
- Metadatos (título/artista/álbum/BPM/duración/picos) persistidos; una pista importada sigue disponible tras recargar.
- **Playlists con orden real** (Subir/Bajar persiste), que sobreviven recargas.
- La última pista seleccionada **no** se carga sola: solo con un clic explícito en `→ A` / `→ B`.
- Archivos vacíos o que no son audio se rechazan con un error y no se guardan.
- El ajuste del mezclador (volúmenes, EQ, crossfader, master, limitador, pitch) **se restaura** tras recargar y se conserva al cargar una pista en un deck.

## Atajos

| Tecla | Acción |
| --- | --- |
| `Q` | Play/Pausa Deck A |
| `P` | Play/Pausa Deck B |
| `Espacio` | Play/Pausa del deck debajo del crossfader |

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest (36 pruebas: formato, ID3, BPM/peaks, matemática de mezcla, biblioteca)
npm run build      # typecheck + bundle de producción en dist/
```

## Arquitectura

```
src/
  audio/
    engine.ts     AudioContext único, master, limitador bypassable, medidores
    deck.ts       Cadena de un deck + transporte (cue/loop/jog/pitch)
    analysis.ts   Picos de PCM, mono, estimación de BPM (puro, testeable en Node)
    crossfade.ts  Ley de potencia constante (puro)
    rate.ts       BPM efectivo, syncRate, rango de pitch (puro)
    settings.ts   Estado del mezclador y rangos de EQ
  library/
    storage.ts    OPFS → IndexedDB → memoria
    library.ts    Pistas + playlists con orden persistido
    fileValidate.ts  Rechazo barato de archivos vacíos / no-audio
  ui/             Vistas (deck, mixer, biblioteca, waveform, toasts) y persistencia del mezclador
  util/           Formato, parser ID3v2 (2.2/2.3/2.4)
  main.ts         Orquestación: importación, carga a decks, render loop
tests/            Vitest sobre los módulos puros (sin DOM ni Web Audio)
```

La lógica de audio-matemática y biblioteca vive en módulos puros para poder probarse en Node;
todo lo que toca `AudioContext` o DOM queda en clases que solo se instancian en el navegador
(el contexto se crea en el primer gesto del usuario, por la política de autoplay).

## Convertidor URL → MP3 (flujo real, sin mocks)

La interfaz hace `POST /api/convert` con `{ "url": "…" }`; el servidor sondea la URL con **yt-dlp**, descarga el mejor audio, lo codifica a **MP3 192 kbps** con **FFmpeg** y responde el binario `audio/mpeg`; el navegador inicia la descarga y deja un enlace manual.

- Éxito: `200` con el MP3; cabeceras `Content-Disposition` (nombre sugerido), `X-Track-Title` y `X-Track-Duration`.
- Error: JSON `{ "ok": false, "code": "…", "error": "…", "detail": "…" }` con el estado HTTP que corresponde: `400` URL vacía/inválida o no soportada, `405` método, `500` fallo de FFmpeg, `502` descarga/sondeo fallido (con el stderr real de yt-dlp), `503` sin herramientas u ocupado (máx. 2 conversiones simultáneas), `504` timeout.

### Herramientas del servidor
- `yt-dlp`: `pip install yt-dlp` (o el binario oficial).
- `ffmpeg`: del sistema, o el binario estático de `@ffmpeg-installer/ffmpeg` (se usa automáticamente si no hay `ffmpeg` en el PATH; incluido en devDependencies).

### Variables de entorno (opcionales)

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `YT_DLP_PATH` | `yt-dlp` en el PATH | Ruta al binario yt-dlp |
| `FFMPEG_PATH` | `ffmpeg` en PATH; si falta, `@ffmpeg-installer/ffmpeg` | Ruta al binario ffmpeg |
| `PORT` | `8080` | Puerto de `npm run start` (producción) |

El frontend **no hardcodea ninguna URL**: llama a `/api/convert` relativo al mismo origen. En `npm run dev` y `npm run preview` lo sirve el middleware de Vite (`server/convert-plugin.ts`); en producción, `npm run start` sirve `dist/` + el endpoint.
