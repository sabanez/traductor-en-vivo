import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

/**
 * Voz natural con Soniox TTS. El servidor genera el audio una sola vez por frase e idioma
 * y lo reparte a todos los asistentes que lo piden, así el coste depende de los idiomas
 * escuchados (unos 0,70 $/h cada uno) y no del número de asistentes.
 *
 * Para que la voz empiece cuanto antes, la conexión con Soniox se mantiene abierta mientras
 * hay actividad y el audio se reenvía a los asistentes trozo a trozo, según se genera.
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

/** Formato del audio: PCM de 16 bits, mono. El navegador lo reproduce sin decodificar. */
export const TTS_SAMPLE_RATE = 24000;

const DEFAULT_VOICES: Record<string, string> = { es: 'Lucia', ca: 'Lucia', '*': 'Maya' };
// Si hay más frases esperando que esto, el asistente se ha quedado atrás y se descartan las viejas.
const MAX_QUEUE = 8;
const TIMEOUT_MS = 20_000;
// Soniox cierra la conexión a los 40 s sin mensajes; se cierra antes para no recibir el error.
const IDLE_CLOSE_MS = 30_000;

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

/** Audio de una frase que se va llenando; varios asistentes pueden leerlo a la vez. */
export class AudioStream {
  readonly chunks: Buffer[] = [];
  done = false;
  error: TtsError | undefined;
  private readonly listeners = new Set<() => void>();

  push(chunk: Buffer): void {
    if (this.done || chunk.length === 0) return;
    this.chunks.push(chunk);
    this.notify();
  }

  finish(error?: TtsError): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.notify();
  }

  /** Avisa de cada cambio. Devuelve la función para dejar de escuchar. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

interface Pending {
  stream: AudioStream;
  timer: NodeJS.Timeout;
}

export class Tts {
  private running = 0;
  private readonly waiting: Array<{ start: () => void; reject: (error: TtsError) => void }> = [];
  private connection: Promise<WebSocket> | null = null;
  private readonly pending = new Map<string, Pending>();
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: TtsConfig) {}

  voiceFor(language: string): string {
    return this.config.voices[language] ?? this.config.voices['*'] ?? 'Maya';
  }

  /** Empieza a generar la frase y devuelve su audio, que se irá llenando. */
  synthesize(language: string, text: string): AudioStream {
    const stream = new AudioStream();
    void this.run(language, text, stream);
    return stream;
  }

  private async run(language: string, text: string, stream: AudioStream): Promise<void> {
    try {
      await this.acquire();
    } catch (error) {
      stream.finish(error as TtsError);
      return;
    }
    const release = stream.subscribe(() => {
      if (!stream.done) return;
      release();
      this.release();
    });
    try {
      const socket = await this.connect();
      clearTimeout(this.idleTimer);
      const streamId = randomUUID();
      const timer = setTimeout(() => {
        this.end(streamId, new TtsError('Soniox TTS no respondió a tiempo', 504));
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ stream_id: streamId, cancel: true }));
      }, TIMEOUT_MS);
      this.pending.set(streamId, { stream, timer });
      socket.send(
        JSON.stringify({
          stream_id: streamId,
          model: this.config.model,
          language,
          voice: this.voiceFor(language),
          audio_format: 'pcm_s16le',
          sample_rate: TTS_SAMPLE_RATE,
          speed: this.config.speed,
        }),
      );
      socket.send(JSON.stringify({ stream_id: streamId, text, text_end: true }));
    } catch (error) {
      stream.finish(error instanceof TtsError ? error : new TtsError(`Soniox TTS: ${String(error)}`, 502));
    }
  }

  private end(streamId: string, error?: TtsError): void {
    const pending = this.pending.get(streamId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(streamId);
    if (!error && pending.stream.chunks.length === 0) error = new TtsError('Soniox TTS no devolvió audio', 502);
    pending.stream.finish(error);
    if (this.pending.size === 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => void this.connection?.then((socket) => socket.close()), IDLE_CLOSE_MS);
    }
  }

  private connect(): Promise<WebSocket> {
    if (this.connection) return this.connection;
    const connection = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.config.wsUrl, { headers: { Authorization: `Bearer ${this.config.apiKey}` } });
      socket.once('open', () => resolve(socket));
      socket.on('error', (error) => reject(new TtsError(`Soniox TTS: ${error.message}`, 502)));
      socket.on('message', (data) => this.handleMessage(data.toString()));
      socket.on('close', () => {
        if (this.connection === connection) this.connection = null;
        for (const streamId of [...this.pending.keys()]) {
          this.end(streamId, new TtsError('Se cerró la conexión con Soniox TTS', 502));
        }
        reject(new TtsError('Se cerró la conexión con Soniox TTS', 502));
      });
    });
    connection.catch(() => {
      if (this.connection === connection) this.connection = null;
    });
    this.connection = connection;
    return connection;
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as {
      stream_id?: string;
      audio?: string;
      terminated?: boolean;
      error_code?: number;
      error_message?: string;
    };
    const error = message.error_code
      ? new TtsError(`Soniox TTS: ${message.error_code} ${message.error_message ?? ''}`, 502)
      : undefined;
    if (!message.stream_id) {
      // Error de la conexión entera (por ejemplo, clave no válida): fallan todas las frases.
      if (error) for (const streamId of [...this.pending.keys()]) this.end(streamId, error);
      return;
    }
    const pending = this.pending.get(message.stream_id);
    if (!pending) return;
    if (message.audio) pending.stream.push(Buffer.from(message.audio, 'base64'));
    if (error) this.end(message.stream_id, error);
    else if (message.terminated) this.end(message.stream_id);
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
}
