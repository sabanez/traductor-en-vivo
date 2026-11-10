import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import { getOrCreateRoom, handleUpgrade, roomAudio } from './rooms';
import { parseVoices, Tts, TtsError } from './tts';

const { SONIOX_API_KEY, SONIOX_REGION = 'eu', PORT = '3001', ACCESS_PASSWORD } = process.env;

if (!SONIOX_API_KEY) {
  console.error('Falta SONIOX_API_KEY. Copia .env.example a .env y rellénalo.');
  process.exit(1);
}

const regionHost = SONIOX_REGION === 'global' ? '' : `.${SONIOX_REGION}`;
// SONIOX_API_URL y SONIOX_WS_URL solo se usan para apuntar a un Soniox simulado en las pruebas.
const apiUrl = process.env.SONIOX_API_URL ?? `https://api${regionHost}.soniox.com`;
const wsUrl = process.env.SONIOX_WS_URL ?? `wss://stt-rt${regionHost}.soniox.com/transcribe-websocket`;
const ttsWsUrl = process.env.SONIOX_TTS_WS_URL ?? `wss://tts-rt${regionHost}.soniox.com/tts-websocket`;
// SONIOX_TTS=off deja la voz del navegador (gratis pero robótica).
const tts =
  process.env.SONIOX_TTS === 'off'
    ? null
    : new Tts({
        apiKey: SONIOX_API_KEY,
        wsUrl: ttsWsUrl,
        model: process.env.SONIOX_TTS_MODEL ?? 'tts-rt-v2',
        voices: parseVoices(process.env.SONIOX_TTS_VOICES),
        speed: Number(process.env.SONIOX_TTS_SPEED ?? '1'),
        concurrency: Number(process.env.SONIOX_TTS_CONCURRENCY ?? '3'),
      });
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public');

const app = express();
app.use(express.json());

// Para la comprobación de salud del hosting; va antes de la contraseña.
app.get('/healthz', (_req, res) => {
  res.send('ok');
});

// Protección provisional del ponente hasta tener el inicio de sesión con Google: si
// ACCESS_PASSWORD está definida, el navegador pide usuario y contraseña (el usuario da igual).
// Los asistentes no la necesitan: entran con el enlace de la sala y no pueden gastar saldo.
const requirePassword: RequestHandler = (req, res, next) => {
  if (!ACCESS_PASSWORD) return next();
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  const password = scheme === 'Basic' ? Buffer.from(encoded ?? '', 'base64').toString().split(':').slice(1).join(':') : '';
  if (password === ACCESS_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Traductor en vivo", charset="UTF-8"').status(401).send('Acceso restringido');
};

if (!ACCESS_PASSWORD && process.env.NODE_ENV === 'production') {
  console.warn('ACCESS_PASSWORD no está definida: cualquiera con la URL puede usar tu saldo de Soniox.');
}

// La clave de Soniox nunca sale del servidor: el navegador recibe una clave temporal
// que solo sirve para abrir conexiones de transcripción durante unos minutos.
app.post('/api/session', requirePassword, async (_req, res) => {
  try {
    const response = await fetch(`${apiUrl}/v1/auth/temporary-api-key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SONIOX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 300 }),
    });
    if (!response.ok) throw new Error(`Soniox respondió ${response.status}: ${await response.text()}`);
    const { api_key } = (await response.json()) as { api_key: string };
    res.json({ provider: 'soniox', apiKey: api_key, wsUrl });
  } catch (error) {
    console.error('No se pudo obtener la clave temporal de Soniox:', error);
    res.status(502).json({ error: 'No se pudo obtener la clave temporal de Soniox' });
  }
});

// El ponente recupera su sala (si sigue viva) o crea una nueva.
app.post('/api/rooms', requirePassword, (req, res) => {
  const { id, key } = (req.body ?? {}) as { id?: string; key?: string };
  res.json(getOrCreateRoom(id, key));
});

// Audio de una frase para los asistentes (no necesita contraseña: solo frases de la sala).
app.post('/api/tts', async (req, res) => {
  const { room, language, text } = (req.body ?? {}) as { room?: string; language?: string; text?: string };
  if (!tts) {
    res.status(503).json({ error: 'Voz de Soniox desactivada' });
    return;
  }
  const audio = roomAudio(String(room), String(language), String(text), () =>
    tts.synthesize(String(language), String(text)),
  );
  if (!audio) {
    res.status(404).json({ error: 'Frase no encontrada en la sala' });
    return;
  }
  try {
    res.type('audio/mpeg').set('Cache-Control', 'no-store').send(await audio);
  } catch (error) {
    if (!(error instanceof TtsError && error.status === 503)) console.error('No se pudo generar la voz:', error);
    res.status(error instanceof TtsError ? error.status : 502).json({ error: 'No se pudo generar la voz' });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.get(['/', '/index.html'], requirePassword, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.get('/s/:id', (_req, res) => {
    res.sendFile(path.join(publicDir, 'sala.html'));
  });
  app.use(express.static(publicDir, { index: false }));
}

const server = app.listen(Number(PORT), () => {
  console.log(`Servidor escuchando en http://localhost:${PORT} (Soniox, región ${SONIOX_REGION})`);
});
server.on('upgrade', handleUpgrade);
