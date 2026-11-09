import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const { AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, PORT = '3001' } = process.env;

if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
  console.error('Faltan AZURE_SPEECH_KEY o AZURE_SPEECH_REGION. Copia .env.example a .env y rellénalo.');
  process.exit(1);
}

const app = express();

// La clave de Azure nunca sale del servidor: el navegador recibe un token que caduca a los 10 minutos.
app.get('/api/speech-token', async (_req, res) => {
  try {
    const response = await fetch(
      `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY } },
    );
    if (!response.ok) throw new Error(`Azure respondió ${response.status}`);
    res.json({ token: await response.text(), region: AZURE_SPEECH_REGION });
  } catch (error) {
    console.error('No se pudo obtener el token de Azure:', error);
    res.status(502).json({ error: 'No se pudo obtener el token de Azure Speech' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public');
  app.use(express.static(publicDir));
}

app.listen(Number(PORT), () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
