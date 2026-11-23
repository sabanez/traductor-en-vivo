/**
 * Fuente de audio del ponente: el micrófono o lo que suena en el ordenador (un vídeo,
 * un webinar…). Lo segundo se captura con getDisplayMedia, que es la única vía que da el
 * navegador; solo Chrome y Edge entregan audio, y solo al compartir una pestaña o, en
 * Windows y ChromeOS, la pantalla entera con el audio del sistema.
 */

export type SourceKind = 'microphone' | 'computer';

export interface CapturedAudio {
  /** Solo las pistas de audio, que es lo que se envía a traducir. */
  audio: MediaStream;
  /** Qué se compartió: `browser` (una pestaña) o `monitor` (pantalla con audio del sistema). */
  surface: string | null;
  stop(): void;
  /** Avisa cuando el usuario deja de compartir desde la barra del navegador. */
  onEnded(callback: () => void): void;
}

type Platform = 'windows' | 'mac' | 'linux' | 'chromeos' | 'mobile' | 'other';

function platform(): Platform {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

/** Chrome, Edge y demás navegadores Chromium; Firefox y Safari no dan audio al compartir. */
function isChromium(): boolean {
  return /Chrome\/|Edg\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
}

/** Si este navegador puede capturar el audio del ordenador, y qué explicar al ponente. */
export function computerAudioSupport(): { supported: boolean; hint: string } {
  const os = platform();
  if (os === 'mobile' || !navigator.mediaDevices?.getDisplayMedia) {
    return { supported: false, hint: 'Este dispositivo no permite capturar su audio. Usa Chrome o Edge en un ordenador.' };
  }
  if (!isChromium()) {
    return { supported: false, hint: 'Este navegador no captura audio al compartir. Usa Chrome o Edge.' };
  }
  const tab =
    'Al pulsar Empezar, elige la pestaña donde suena el vídeo o el webinar y deja activada la opción de compartir también su audio.';
  if (os === 'windows' || os === 'chromeos') {
    return {
      supported: true,
      hint: `${tab} Para una aplicación (Zoom, Teams…) comparte la pantalla entera con la opción de compartir el audio del sistema; en ese caso escucha la traducción en el móvil, porque todo lo que suene en este ordenador se volvería a traducir.`,
    };
  }
  return {
    supported: true,
    hint: `${tab} En este sistema lo fiable es capturar una pestaña del navegador: abre el webinar en Chrome o Edge, no en su aplicación.`,
  };
}

export async function captureMicrophone(): Promise<CapturedAudio> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  return wrap(stream, stream, null);
}

export async function captureComputer(muteOriginal: boolean): Promise<CapturedAudio> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // El navegador exige pedir vídeo; se pide lo mínimo y no se usa.
      video: { frameRate: 1, width: 320, height: 180 },
      audio: {
        // Es audio ya mezclado (voz, música): procesarlo como un micrófono lo estropea.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Solo en pestañas: se sigue capturando pero deja de sonar en este ordenador.
        suppressLocalAudioPlayback: muteOriginal,
      } as MediaTrackConstraints,
      // Pistas para Chrome: proponer pestañas, no ofrecer esta misma y permitir el audio del sistema.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('no se compartió nada');
    }
    throw error;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      'lo compartido no tiene audio. Vuelve a pulsar Empezar, elige una pestaña y activa la opción de compartir su audio.',
    );
  }
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  return wrap(new MediaStream(audioTracks), stream, surface ?? null);
}

function wrap(audio: MediaStream, all: MediaStream, surface: string | null): CapturedAudio {
  return {
    audio,
    surface,
    stop: () => all.getTracks().forEach((track) => track.stop()),
    onEnded(callback) {
      // Basta con que acabe el audio: si se deja de compartir, acaban todas las pistas.
      audio.getAudioTracks()[0]?.addEventListener('ended', callback, { once: true });
    },
  };
}
