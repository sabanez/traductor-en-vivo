import { ORIGINAL } from '../../../shared/protocol';
import type { TextUpdate, TranslationOptions, TranslationProvider, TranslationSession } from './types';

const MODEL = 'stt-rt-v6';
const SAMPLE_RATE = 16000;
// Marcas que Soniox envía como tokens: fin de frase detectado y finalización forzada.
const END_TOKEN = '<end>';
const FIN_TOKEN = '<fin>';
const SENTENCE_END = /[.?!]\s*$/;

interface SonioxToken {
  text: string;
  is_final: boolean;
  translation_status?: 'none' | 'original' | 'translation';
  language?: string;
}

interface SonioxResponse {
  tokens: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

interface Session {
  provider: 'soniox';
  apiKey: string;
  wsUrl: string;
}

async function createSession(): Promise<Session> {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) throw new Error('El servidor no pudo crear la sesión de Soniox');
  return response.json();
}

function openSocket(session: Session, options: TranslationOptions, targetLanguage: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // En el navegador la clave temporal viaja en la lista de subprotocolos del WebSocket.
    const socket = new WebSocket(session.wsUrl, ['soniox-api-key', session.apiKey]);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          model: MODEL,
          audio_format: 'pcm_s16le',
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          // Sin idioma fijo, las pistas orientan la detección sin limitarla.
          language_hints: options.sourceLanguage ? [options.sourceLanguage] : options.expectedLanguages,
          enable_language_identification: true,
          enable_endpoint_detection: true,
          context: options.glossary.length > 0 ? { terms: options.glossary } : undefined,
          translation: { type: 'one_way', target_language: targetLanguage },
        }),
      );
      resolve(socket);
    };
    socket.onerror = () => reject(new Error('No se pudo conectar con Soniox'));
  });
}

/**
 * Soniox traduce a un único idioma por conexión, así que abrimos una por idioma destino
 * y les enviamos el mismo audio. El texto original se toma solo de la primera.
 */
export const sonioxProvider: TranslationProvider = {
  async start(audio, options, onUpdate, onError): Promise<TranslationSession> {
    const session = await createSession();
    const sockets = await Promise.all(options.targetLanguages.map((t) => openSocket(session, options, t)));

    sockets.forEach((socket, index) => {
      const target = options.targetLanguages[index];
      const includeOriginal = index === 0;
      socket.onmessage = (event) => {
        const response = JSON.parse(event.data as string) as SonioxResponse;
        if (response.error_code) {
          onError(`Soniox (${response.error_code}): ${response.error_message ?? 'error desconocido'}`);
          return;
        }
        emitUpdates(response.tokens, target, includeOriginal, onUpdate);
      };
    });

    const context = new AudioContext();
    await context.audioWorklet.addModule('/pcm-worklet.js');
    const source = context.createMediaStreamSource(audio);
    const worklet = new AudioWorkletNode(context, 'pcm-worklet');
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      }
    };
    source.connect(worklet);

    return {
      async stop() {
        source.disconnect();
        worklet.disconnect();
        await context.close();
        // Un mensaje de texto vacío le dice a Soniox que no llega más audio.
        for (const socket of sockets) {
          if (socket.readyState === WebSocket.OPEN) socket.send('');
        }
      },
    };
  },
};

function emitUpdates(
  tokens: SonioxToken[],
  targetLanguage: string,
  includeOriginal: boolean,
  onUpdate: (update: TextUpdate) => void,
): void {
  // Lo que el ponente ya dice en el idioma destino no se traduce: Soniox lo marca como
  // "none" con ese idioma, así que también va al panel de ese idioma.
  const isTarget = (t: SonioxToken) =>
    t.translation_status === 'translation' || (t.translation_status === 'none' && t.language === targetLanguage);
  const groups: { language: string; tokens: SonioxToken[] }[] = [{ language: targetLanguage, tokens: tokens.filter(isTarget) }];
  if (includeOriginal) {
    groups.push({ language: ORIGINAL, tokens: tokens.filter((t) => t.translation_status !== 'translation') });
  }

  for (const group of groups) {
    let finalText = '';
    let partialText = '';
    for (const token of group.tokens) {
      const isMarker = token.text === END_TOKEN || token.text === FIN_TOKEN;
      if (!token.is_final) {
        if (!isMarker) partialText += token.text;
        continue;
      }
      if (!isMarker) finalText += token.text;
      // Cerramos la frase en una pausa del ponente o al final de una oración.
      if (isMarker || SENTENCE_END.test(finalText)) {
        onUpdate({ language: group.language, finalText, partialText: '', endOfSentence: true });
        finalText = '';
      }
    }
    onUpdate({ language: group.language, finalText, partialText, endOfSentence: false });
  }
}
