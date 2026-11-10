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

const wss = new WebSocketServer({ server, path: '/transcribe-websocket' });

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
