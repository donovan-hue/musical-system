# Musical System — Cabina DJ Digital

Estación DJ completa que corre 100% en el navegador (escritorio y móvil), con biblioteca local persistente, convertidor URL→MP3 real (yt-dlp + FFmpeg) y motor de audio Web Audio. Nada de mocks: cada control está conectado al motor.

## La cabina (pantalla principal)

**Deck A / Deck B** (independientes, cada uno con):
- Artwork real (carátula ID3 reducida), título, artista, **tonalidad** (análisis de cromas real) y género.
- BPM grande (tag ID3 → estimación por autocorrelación → manual con ×2/½), duración, transcurrido y restante.
- **Waveform real** desde los picos del PCM: reproducción sincronizada, búsqueda por clic/arrastre, **zoom 1×/4×/16×** centrado en el playhead, **beat grid** (marcadores por beat cuando hay BPM), cue principal y **8 hot cues** con color.
- Play/pausa, stop, cue (saltar), set cue, **Sync** real (rechaza lo que salga del rango ±8%).
- **Loops**: por beats cuantizados (½, 1, 2, 4, 8, 16) sobre la rejilla de BPM, y manuales In/Out/Salir (nativos `loopStart`/`loopEnd`).
- **Hot cues 1–8** persistidos por pista: clic fija (vacío) o salta (lleno), Alt+clic / clic derecho borra; teclas 1–8 sobre el deck bajo el crossfader.
- **Pitch acoplado** ±8% (tempo+tono), **jog**: nudge de tempo girando mientras suena, búsqueda al arrastrar en pausa; funciona con mouse y táctil.
- **FX insert real**: Echo (sincronizado a ¾ de beat), Reverb (impulso sintetizado), Flanger y Phaser (LFOs reales) con monto. `reverse` y `beat repeat` aparecen deshabilitados con su razón exacta: requieren AudioWorklet.

**Mixer central** (entre ambos decks):
- Por canal: **Trim (gain)**, High/Mid/Low (−26/+9 dB), **Filtro DJ** (LP↔HP real en un knob), Volumen, **CUE** (envío al bus de monitorización) y medidor de nivel con peak-hold.
- Master: volumen, **limitador bypassable** con medidor de reducción de ganancia, espectro del bus, **CUE MIX** (mezcla master↔cue con ley de potencia constante) y **crossfader** de potencia constante (−3 dB al centro).

## Paneles (pestañas inferiores)

- **📚 Biblioteca**: búsqueda (título/artista/álbum/género), filtro ★ favoritas, orden (recientes/título/artista/BPM/duración), importar, **doble clic = previsualizar** (carga en un deck libre y reproduce), `→ A`/`→ B`, **＋ Cola**, playlists con orden real persistido y metadatos (título, artista, álbum, tonalidad, BPM, género, duración, artwork, fecha, origen, tamaño).
- **⏭ Cola**: preparar la próxima mezcla — añadir desde la biblioteca, reordenar, quitar, "Reproducir siguiente" (al deck libre), auto-carga al terminar una pista (**auto-DJ**), vaciar y **guardar como playlist**.
- **🥁 Sampler**: 6 pads con sonidos **sintetizados en vivo** (kick, snare, clap, hat, tom, zap — osciladores/ruido/envolventes Web Audio), pad iluminado mientras suena, volumen propio, teclas A S D F G H.
- **⏺ Grabadora**: **grabación real del bus master** con MediaRecorder (sin micrófono: graba el stream interno post-limitador), iniciar/pausar/continuar/detener, cronómetro, nombrar y guardar la sesión, lista con reproducción integrada, descarga (webm/opus, mp4 u ogg según navegador) y borrado.
- **🕘 Historial**: pistas reproducidas (deck, fecha, segundos), conversiones realizadas y sesiones grabadas — todo persistido (tope 300 eventos), con borrado.
- **⤓ Convertidor**: URL → `POST /api/convert` → **yt-dlp + FFmpeg → MP3 192 kbps** → descarga real + "Añadir a la biblioteca" (entra al mismo pipeline de análisis que los archivos locales).

## Tema claro y oscuro

Dos sistemas visuales completos sobre variables CSS: **oscuro** (cabina nocturna: negro/grafito/metal, alto contraste) y **claro** (plata/blanco, contraste limpio). El interruptor está en la barra superior y persiste. La lógica no cambia: solo el sistema visual.

## Responsive y accesibilidad

- Escritorio: decks + mixer central en fila, panel inferior con pestañas. Tablet: decks lado a lado, mixer abajo. Móvil (<780 px): todo apilado, mixer con canales lado a lado, jog más grande, objetivo táctil ≥44 px (`pointer: coarse`).
- Teclado: `Q`/`P` play A/B, `Espacio` play del deck bajo el crossfader, `1–8` hot cues, `A S D F G H` sampler. Foco visible, `aria-label`/`aria-pressed`/`role=tablist`, estados disabled reales.

## Convertidor URL → MP3 (flujo real, sin mocks)

`POST /api/convert` con `{ "url": "…" }`: sondeo con yt-dlp, descarga del mejor audio, codificación FFmpeg `libmp3lame 192k`, respuesta `audio/mpeg` con `Content-Disposition`/`X-Track-Title`/`X-Track-Duration`. Errores en JSON `{ok:false, code, error, detail}` con el stderr real: `400` URL, `405` método, `500` FFmpeg, `502` descarga, `503` sin herramientas/ocupado (máx. 2), `504` timeout.

### Herramientas y variables del servidor
- `yt-dlp`: `pip install yt-dlp`. `ffmpeg`: del sistema o el binario estático de `@ffmpeg-installer/ffmpeg` (fallback automático).
- `YT_DLP_PATH`, `FFMPEG_PATH`, `PORT` (opcionales). El frontend **no hardcodea URLs** (ruta relativa same-origin; middleware de Vite en dev/preview, `npm run start` en producción).

## Desarrollo

```bash
npm install
npm run dev        # cabina en http://localhost:5173
npm run typecheck  # tsc --noEmit (estricto)
npm run lint       # eslint
npm run test       # vitest — 58 pruebas
npm run build      # typecheck + bundle en dist/
npm run start      # producción: dist/ + /api/convert (PORT, default 8080)
```

## Arquitectura

```
src/
  audio/
    engine.ts     AudioContext único: master, limitador, bus de cue + CUE MIX, tap de grabación, sampler
    deck.ts       Cadena completa por deck (EQ→trim→filtro→FX→vol→crossfader, cue send) + transporte
    fx.ts         Módulos FX reales: echo/reverb/flanger/phaser (+ razón de los que requieren worklet)
    sampler.ts    Síntesis en vivo de los 6 pads
    recorder.ts   MediaRecorder del bus master (estados reales, MIME soportado)
    key.ts        Tonalidad por cromas (DFT) + perfiles Krumhansl; beat grid y loops cuantizados (puro)
    analysis.ts   Picos de PCM, mono, estimación de BPM (puro)
    crossfade.ts  Ley de potencia constante (puro)   rate.ts  BPM efectivo/sync (puro)
    settings.ts   Estado persistente del mezclador
  library/
    storage.ts    OPFS → IndexedDB → memoria   library.ts  Pistas, playlists, cola, favoritos,
                  hot cues, historial y grabaciones (persistido)
  ui/             Cabina: decks, mixer, waveform (zoom/grid/hot cues), biblioteca, cola, sampler,
                  grabadora, historial, convertidor, tema claro/oscuro
  server/ (server/) POST /api/convert real + servidor de producción
tests/            58 pruebas vitest sobre módulos puros
```

CI: `.github/workflows/ci.yml` — `npm ci → typecheck → lint → test → build` en cada push/PR (Node 22).

## Fase 5 — Biblioteca real, playlists y calidad de audio

### Modelo de datos
- **Pista física** (bytes en OPFS/IndexedDB + metadatos completos) separada de **referencia en playlist** (`trackIds`): una playlist nunca es un archivo; una pista puede vivir en muchas playlists sin copiarse.
- Metadatos por pista: título, artista, álbum, género, año, nº de pista, duración, portada (APIC real o URL de Spotify), BPM (tag/estimado/manual), tonalidad (cromas+Krumhansl), waveform, **calidad real** (formato, códec ffprobe, bitrate efectivo, sample rate, canales), fuente (`Archivo`/`URL`/`Spotify`/`Fuente elegida`), URL de origen, **hash SHA-256** (dedup), `spotifyId`, estado de análisis (`✓ / ◐ / PENDIENTE / ✗`) y fecha de importación.
- **Deduplicación**: importar dos veces el mismo archivo (o traer un audio idéntico) no crea copias; en playlists solo se añaden referencias.

### Calidad de audio (regla absoluta: no degradar)
- `POST /api/fetch-audio` (`{"url": "...", "mode": "original"|"mp3"}`):
  - `original` (**por defecto**): sirve el archivo descargado por yt-dlp **sin re-codificar** (`X-Audio-Preserved: 1`) y reporta calidad real vía ffprobe (`X-Audio-Codec/Bitrate/Samplerate/Channels`).
  - `mp3`: conversión **explícita** a MP3 320 kbps, solo cuando el usuario la elige.
- `POST /api/convert` (legado, MP3 192) sigue disponible por compatibilidad.

### Spotify (legítimo)
- `POST /api/spotify/playlist` usa la **API oficial** con Client Credentials: nombre, propietario, portada, orden y metadatos de cada pista (título, artista, álbum, duración, nº, fecha, `spotifyId`, URL exacta).
- **Nunca extrae audio protegido**: las pistas se crean como referencias "pendientes de fuente de audio autorizada". Sin `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` el endpoint responde **501** con el requisito exacto (nada simulado).
- `POST /api/match` busca candidatos reales (yt-dlp `ytsearch5`); **el usuario elige** la fuente exacta — el sistema jamás sustituye remixes/live/edits silenciosamente.

### Playlists inteligentes
- Especificaciones persistidas (campo/operador/valor sobre artista, género, BPM, tonalidad, duración, fecha, fuente, formato, favorita…) que se **evalúan siempre al vuelo** (`src/library/smart.ts`, con pruebas). Nunca materializan copias.

### UI de biblioteca
Buscador; filtro por fuente y favoritas; orden (recientes/título/artista/BPM/duración); **multiselección** con acciones por lote (→A, →B, ＋playlist, ↻ re-analizar, ✕ quitar); **reproducción previa** (▶ con HTMLAudio real); edición inline de metadatos; columnas de **calidad**, **fuente** y **estado de análisis** (real: "PENDIENTE DE ANÁLISIS", nunca valores inventados); playlists numeradas `01 — Artista — Canción` con ▶/→A/→B por elemento; pestaña **⇪ Lotes** con progreso individual (Pista 1 — completada / 2 — procesando / 3 — pendiente / 4 — error) donde un fallo no cancela el resto; **exportar/importar metadatos** (JSON portátil).

### Dónde vive cada cosa
| Qué | Dónde |
| --- | --- |
| Bytes de audio y grabaciones | OPFS (respaldo IndexedDB, último recurso memoria) |
| Metadatos, playlists, smart, cola, historial | Documento JSON en el mismo store (`library.v1`) |
| Ajustes del mezclador | `localStorage` |
| Conversión/fuentes/Spotify/match | Servidor sin estado (endpoints, sin base de datos) |
| Cache | Solo la del navegador |

### Requisito externo identificado (Spotify)
Para activar la importación de metadatos: crea credenciales en developer.spotify.com/dashboard (Web API) y define `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` como variables de entorno del servidor. Sin ellas, la función queda explícitamente marcada como "autorización requerida" (HTTP 501).
