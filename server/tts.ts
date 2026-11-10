import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

/**
 * Voz natural con Soniox TTS. El servidor genera el audio una sola vez por frase e idioma
 * y lo reparte a todos los asistentes que lo piden, así el coste depende de los idiomas
 * escuchados (unos 0,70 $/h cada uno) y no del número de asistentes.
 */

export interface TtsConfig {
  apiKey: string;
  wsUrl: string;
  model: string;
  /** Voz por idioma; `*` es la voz para los idiomas sin una propia. */
  voices: Record<string, string>;
  speed: number;
  /** Generaciones simultáneas permitidas por Soniox (3 por defecto en la cuenta). */
  concurrency: number;
}

const DEFAULT_VOICES: Record<string, string> = { es: 'Lucia', ca: 'Lucia', '*': 'Maya' };
// Si hay más frases esperando que esto, el asistente se ha quedado atrás y se descartan las viejas.
const MAX_QUEUE = 8;
const TIMEOUT_MS = 20_000;

/** Lee "es=Lucia,en=Emma" (o un solo nombre para todos los idiomas). */
export function parseVoices(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return DEFAULT_VOICES;
  if (!value.includes('=')) return { '*': value.trim() };
  const voices: Record<string, string> = { ...DEFAULT_VOICES };
  for (const pair of value.split(',')) {
    const [lang, voice] = pair.split('=').map((s) => s.trim());
    if (lang && voice) voices[lang] = voice;
  }
  return voices;
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class Tts {
  private running = 0;
  private readonly waiting: Array<{ start: () => void; reject: (error: Error) => void }> = [];

  constructor(private readonly config: TtsConfig) {}

  voiceFor(language: string): string {
    return this.config.voices[language] ?? this.config.voices['*'] ?? 'Maya';
  }

  /** Devuelve el audio MP3 de la frase. */
  async synthesize(language: string, text: string): Promise<Buffer> {
    await this.acquire();
    try {
      return await this.generate(language, text);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.config.concurrency) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= MAX_QUEUE) this.waiting.shift()?.reject(new TtsError('Cola de voz llena', 503));
    return new Promise((resolve, reject) => {
      this.waiting.push({
        start: () => {
          this.running += 1;
          resolve();
        },
        reject,
      });
    });
  }

  private release(): void {
    this.running -= 1;
    this.waiting.shift()?.start();
  }

  // Una conexión por frase: evita gestionar el cierre por inactividad (40 s) de Soniox
  // a cambio de unos milisegundos de conexión.
  private generate(language: string, text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const streamId = randomUUID();
      const chunks: Buffer[] = [];
      const socket = new WebSocket(this.config.wsUrl, { headers: { Authorization: `Bearer ${this.config.apiKey}` } });
      let failure: TtsError | undefined;
      const timer = setTimeout(() => {
        failure = new TtsError('Soniox TTS no respondió a tiempo', 504);
        socket.terminate();
      }, TIMEOUT_MS);

      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            stream_id: streamId,
            model: this.config.model,
            language,
            voice: this.voiceFor(language),
            audio_format: 'mp3',
            sample_rate: 24000,
            speed: this.config.speed,
          }),
        );
        socket.send(JSON.stringify({ stream_id: streamId, text, text_end: true }));
      });
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          audio?: string;
          terminated?: boolean;
          error_code?: number;
          error_message?: string;
        };
        if (message.error_code) {
          failure = new TtsError(`Soniox TTS: ${message.error_code} ${message.error_message ?? ''}`, 502);
        }
        if (message.audio) chunks.push(Buffer.from(message.audio, 'base64'));
        if (message.terminated) socket.close();
      });
      socket.on('error', (error) => {
        failure ??= new TtsError(`Soniox TTS: ${error.message}`, 502);
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!failure && chunks.length === 0) failure = new TtsError('Soniox TTS no devolvió audio', 502);
        if (failure) reject(failure);
        else resolve(Buffer.concat(chunks));
      });
    });
  }
}
