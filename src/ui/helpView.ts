export class HelpView {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'help-view panel-view';
    this.el.innerHTML = `
      <div class="panel-head">
        <span class="panel-hint">Guía rápida de operación de la cabina DJ y características técnicas de AudioLad Studio.</span>
      </div>
      <div class="help-content">
        <article class="help-section">
          <h3>🎛️ 1. Decks A y B</h3>
          <ul>
            <li><b>Play / Pausa & Stop</b>: Control de reproducción con retorno a Cue con Stop.</li>
            <li><b>Cue & Set</b>: <code>Set</code> marca el punto de retorno en la posición actual. <code>Cue</code> salta a ese punto inmediatamente.</li>
            <li><b>Sync de Tempo</b>: Iguala el BPM del deck al del deck opuesto siempre que esté dentro del rango de pitch permitido (±8%).</li>
            <li><b>Jog Wheel</b>: Al girar con el mouse o táctil mientras suena realiza <i>pitch bend / nudge</i>; al arrastrar en pausa realiza búsqueda fina (<i>scrub</i>).</li>
            <li><b>Waveform y Zoom</b>: Muestra picos reales del audio. Usa el botón de zoom (1×, 4×, 16×) para centrarte en transitorios o ver la pista completa.</li>
            <li><b>Rejilla de Beats y Loops</b>: Los botones de ½ a 16 beats fijan bucles cuantizados al BPM detectado. También dispones de <code>In</code> / <code>Out</code> para bucles manuales.</li>
            <li><b>Hot Cues (1–8)</b>: Clic en un pad vacío fija el punto; clic en un pad asignado salta a él. Para borrarlo usa <kbd>Alt</kbd> + Clic o clic derecho.</li>
          </ul>
        </article>

        <article class="help-section">
          <h3>🎚️ 2. Mezclador Central (Mixer)</h3>
          <ul>
            <li><b>Canales A y B</b>: Trim de ganancia independiente, ecualizador de 3 bandas (−26 dB a +9 dB), filtro DJ bipolar (giro a la izquierda: paso bajo / LP; giro a la derecha: paso alto / HP).</li>
            <li><b>Monitoreo CUE</b>: Activa el botón CUE para enviar el canal al bus de auriculares.</li>
            <li><b>Crossfader</b>: Curva de potencia constante (−3 dB en el centro) para transiciones limpias y fluidas.</li>
            <li><b>Master</b>: Fader de volumen general, limitador dinámico con medidor de reducción de ganancia (GR) y visualizador de espectro FFT de 56 bandas.</li>
          </ul>
        </article>

        <article class="help-section">
          <h3>🥁 3. Sampler y Grabadora</h3>
          <ul>
            <li><b>Sampler en vivo</b>: 6 instrumentos sintetizados en tiempo real mediante Web Audio (Kick, Snare, Clap, HiHat, Tom, Zap). No utiliza muestras estáticas; responde al instante por teclado (<kbd>A</kbd>–<kbd>H</kbd>) o pulsación táctil.</li>
            <li><b>Grabación del Master</b>: Graba directamente el flujo de audio digital post-limitador (sin micrófono). Soporta WebM/Opus, MP4 u OGG según el navegador. Guarda la sesión en la biblioteca o descárgala en tu disco.</li>
          </ul>
        </article>

        <article class="help-section">
          <h3>⤓ 4. Convertidor y Fuentes Externas</h3>
          <ul>
            <li><b>yt-dlp + FFmpeg</b>: Procesa URLs de audio conservando la calidad de origen (direct stream copy) o codificando a MP3 320 kbps.</li>
            <li><b>Seguridad y Privacidad</b>: Todas las peticiones están protegidas contra SSRF y respetan el almacenamiento local en tu navegador (OPFS / IndexedDB).</li>
          </ul>
        </article>
      </div>
    `;
  }
}
