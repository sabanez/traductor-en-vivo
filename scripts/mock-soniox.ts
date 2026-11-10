// Soniox simulado para probar el prototipo sin cuenta ni micrófono real.
// Uso: npx tsx scripts/mock-soniox.ts y arrancar el servidor con
// SONIOX_API_URL=http://localhost:4000 SONIOX_WS_URL=ws://localhost:4000/transcribe-websocket
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/auth/temporary-api-key') {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ api_key: 'snx_temp_mock', expires_at: new Date(Date.now() + 300_000).toISOString() }));
    return;
  }
  res.writeHead(404).end();
});

const SENTENCES: Record<string, string[]> = {
  original: ['Buenos días a todos y gracias por venir.', 'Hoy repasaremos los resultados del trimestre.', 'Empezamos por las ventas en Europa.'],
  en: ['Good morning everyone and thank you for coming.', "Today we'll review the quarterly results.", "Let's start with sales in Europe."],
  de: ['Guten Morgen allerseits und danke fürs Kommen.', 'Heute besprechen wir die Quartalsergebnisse.', 'Wir beginnen mit dem Umsatz in Europa.'],
  fr: ['Bonjour à tous et merci d’être venus.', "Aujourd'hui, nous passerons en revue les résultats du trimestre.", 'Commençons par les ventes en Europe.'],
  ca: ['Bon dia a tothom i gràcies per venir.', 'Avui repassarem els resultats del trimestre.', 'Comencem per les vendes a Europa.'],
};

const wss = new WebSocketServer({ noServer: true });
const ttsWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const target = req.url === '/tts-websocket' ? ttsWss : req.url === '/transcribe-websocket' ? wss : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

/** WAV con un tono corto: hace de voz generada (su duración crece con el texto). */
function toneWav(text: string): Buffer {
  const rate = 24000;
  const samples = Math.min(rate * 3, Math.round(rate * 0.04 * text.length));
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 600, (samples - i) / 600);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000 * fade), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

ttsWss.on('connection', (socket, req) => {
  if (req.headers.authorization !== 'Bearer mock') {
    socket.send(JSON.stringify({ error_code: 401, error_type: 'unauthenticated', error_message: 'Bad key' }));
    socket.close();
    return;
  }
  let config: { stream_id: string; language: string; voice: string } | undefined;
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (!config) {
      config = message;
      return;
    }
    console.log(`voz ${config.voice} (${config.language}): ${message.text}`);
    const wav = toneWav(message.text);
    const half = Math.floor(wav.length / 2);
    for (const [part, end] of [[wav.subarray(0, half), false], [wav.subarray(half), true]] as const) {
      socket.send(JSON.stringify({ audio: part.toString('base64'), audio_end: end, stream_id: config.stream_id }));
    }
    socket.send(JSON.stringify({ terminated: true, stream_id: config.stream_id }));
  });
});

wss.on('connection', (socket, req) => {
  console.log('conexión, subprotocolos:', req.headers['sec-websocket-protocol']);
  let target = '?';
  let audioBytes = 0;
  let count = 0;
  let timer: NodeJS.Timeout | undefined;

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      audioBytes += (data as Buffer).length;
      return;
    }
    const text = data.toString();
    if (text === '') {
      clearInterval(timer);
      console.log(`fin (${target}), audio recibido: ${audioBytes} bytes`);
      socket.send(JSON.stringify({ tokens: [], finished: true }));
      socket.close();
      return;
    }
    const config = JSON.parse(text);
    target = config.translation.target_language;
    console.log('config:', text);
    timer = setInterval(() => {
      const original = SENTENCES.original[count % 3];
      count += 1;
      // El ponente habla en español: hacia el español no hay traducción y Soniox lo marca como "none".
      if (target === 'es') {
        socket.send(
          JSON.stringify({
            tokens: [
              { text: original + ' ', is_final: true, translation_status: 'none', language: 'es' },
              { text: '<end>', is_final: true },
              { text: 'Y ahora vamos a', is_final: false, translation_status: 'none', language: 'es' },
            ],
          }),
        );
        return;
      }
      const translated = (SENTENCES[target] ?? SENTENCES.en)[(count - 1) % 3];
      socket.send(
        JSON.stringify({
          tokens: [
            { text: original + ' ', is_final: true, translation_status: 'original', language: 'es' },
            { text: translated + ' ', is_final: true, translation_status: 'translation', language: target },
            { text: '<end>', is_final: true },
            { text: 'Y ahora vamos a', is_final: false, translation_status: 'original', language: 'es' },
            { text: '…', is_final: false, translation_status: 'translation', language: target },
          ],
        }),
      );
    }, 700);
  });
});

server.listen(4000, () => console.log('Soniox simulado en http://localhost:4000'));
