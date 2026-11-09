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
      count += 1;
      socket.send(JSON.stringify({ tokens: [{ text: `Frase ${count} en curso`, is_final: false, translation_status: 'original' }] }));
      socket.send(
        JSON.stringify({
          tokens: [
            { text: `Frase ${count}.`, is_final: true, translation_status: 'original' },
            { text: `[${target}] Sentence ${count}.`, is_final: true, translation_status: 'translation' },
            { text: '<end>', is_final: true },
          ],
        }),
      );
    }, 700);
  });
});

server.listen(4000, () => console.log('Soniox simulado en http://localhost:4000'));
