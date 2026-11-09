import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const { SONIOX_API_KEY, SONIOX_REGION = 'eu', PORT = '3001' } = process.env;

if (!SONIOX_API_KEY) {
  console.error('Falta SONIOX_API_KEY. Copia .env.example a .env y rellénalo.');
  process.exit(1);
}

const regionHost = SONIOX_REGION === 'global' ? '' : `.${SONIOX_REGION}`;
// SONIOX_API_URL y SONIOX_WS_URL solo se usan para apuntar a un Soniox simulado en las pruebas.
const apiUrl = process.env.SONIOX_API_URL ?? `https://api${regionHost}.soniox.com`;
const wsUrl = process.env.SONIOX_WS_URL ?? `wss://stt-rt${regionHost}.soniox.com/transcribe-websocket`;

const app = express();

// Para la comprobación de salud del hosting; va antes de la contraseña.
app.get('/healthz', (_req, res) => {
  res.send('ok');
});

// Protección provisional hasta tener el inicio de sesión con Google: si ACCESS_PASSWORD
// está definida, el navegador pide usuario y contraseña (el usuario da igual).
const { ACCESS_PASSWORD } = process.env;
if (ACCESS_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const password = scheme === 'Basic' ? Buffer.from(encoded ?? '', 'base64').toString().split(':').slice(1).join(':') : '';
    if (password === ACCESS_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Traductor en vivo", charset="UTF-8"').status(401).send('Acceso restringido');
  });
} else if (process.env.NODE_ENV === 'production') {
  console.warn('ACCESS_PASSWORD no está definida: cualquiera con la URL puede usar tu saldo de Soniox.');
}

// La clave de Soniox nunca sale del servidor: el navegador recibe una clave temporal
// que solo sirve para abrir conexiones de transcripción durante unos minutos.
app.post('/api/session', async (_req, res) => {
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

if (process.env.NODE_ENV === 'production') {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public');
  app.use(express.static(publicDir));
}

app.listen(Number(PORT), () => {
  console.log(`Servidor escuchando en http://localhost:${PORT} (Soniox, región ${SONIOX_REGION})`);
});
