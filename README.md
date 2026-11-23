# Traductor en vivo

Traducción simultánea de presentaciones internas. El ponente habla al micrófono y la página muestra en directo la transcripción y su traducción a español, inglés, alemán y francés.

Estado: **paso 2, sala de asistentes** con [Soniox](https://soniox.com). Falta el inicio de sesión con la cuenta de Google de la empresa.

## Cómo funciona

- **Ponente** (`/`, protegida con `ACCESS_PASSWORD`): habla al micrófono y ve el original y una traducción de vista previa. El idioma se detecta automáticamente, aunque se puede fijar. Arriba tiene el enlace y el código QR de su sala para compartirlos.
- **Asistentes** (`/s/<sala>`): entran con el enlace, sin contraseña. Eligen idioma (español, inglés, alemán, francés, catalán o el original) y, si quieren, escuchan la traducción con una voz natural de Soniox (o la del navegador si Soniox falla). No pueden empezar ni detener nada, y tampoco pueden gastar saldo.
- El navegador del ponente convierte el micrófono a PCM de 16 kHz y lo envía directamente a Soniox. Como Soniox traduce a un solo idioma por conexión, se abre una por idioma destino. El texto llega al servidor, que lo reparte por WebSocket a los asistentes de la sala y guarda lo dicho para quien entra tarde.
- El servidor (Node + TypeScript) solo emite claves temporales de 5 minutos, así que la clave de Soniox nunca llega al navegador.
- **Fuente de audio**: el ponente elige entre el micrófono y el **audio del ordenador** (un vídeo, un webinar, una conferencia). Lo segundo usa la función de compartir del navegador y solo funciona en Chrome o Edge de escritorio: se comparte la pestaña donde suena el vídeo con su audio, o, en Windows y ChromeOS, la pantalla entera con el audio del sistema (para aplicaciones como Zoom o Teams). En Mac lo fiable es la pestaña. Con la pestaña se puede marcar que el original no suene en el ordenador del ponente, para oír solo la traducción.
- **Bucle de audio**: al capturar la pantalla entera con el audio del sistema, cualquier voz de la traducción que suene en ese ordenador se volvería a traducir. Las pestañas de asistente abiertas en el mismo navegador lo detectan y desactivan su voz mientras dure la captura; en otro navegador del mismo ordenador no se puede detectar, así que la traducción hay que escucharla en el móvil u otro dispositivo. Compartiendo solo la pestaña del vídeo no hay bucle.
- El glosario (un término por línea, con explicación opcional tras «:») se envía a Soniox como `context.terms` para que escriba bien nombres propios y jerga de la empresa. Los asistentes también lo ven, con las explicaciones, desde el botón **Glosario**.
- Lo específico de Soniox está en `client/src/providers/soniox.ts`. Para cambiar de proveedor hay que escribir otro archivo que cumpla `client/src/providers/types.ts`.
- Las salas se guardan en memoria: si el servidor se reinicia, el ponente obtiene una sala nueva y hay que volver a compartir el enlace.

## Instalación de la versión de prueba

Requisitos: [Node.js 22](https://nodejs.org) o superior y Chrome o Edge.

1. En la [consola de Soniox](https://console.soniox.com):
   - Recarga saldo (con 10 $ hay para unas 20 horas de prueba con tres idiomas).
   - Crea una API key con el permiso **Temporary API keys**.
   - Solicita la región **EU** para el proyecto. Mientras no esté aprobada, usa `SONIOX_REGION=global`.
2. Descarga el código e instala las dependencias:

```bash
git clone https://github.com/sabanez/traductor-en-vivo.git
cd traductor-en-vivo
npm install
```

3. Copia `.env.example` a `.env` y pon tu clave y la región.
4. Arranca en modo desarrollo:

```bash
npm run dev
```

5. Abre http://localhost:5173, permite el micrófono y pulsa **Empezar**. Abre el enlace de la sala en otra pestaña o en el móvil para verlo como asistente.

Para producción: `npm run build` y luego `npm start`, que sirve la web en el puerto `PORT`.

### VPS propio

La instalación actual está en https://livetranslate.labolife.com. Dónde está cada cosa, cómo actualizar y cómo diagnosticar: [docs/despliegue-vps.md](docs/despliegue-vps.md).

### Publicarlo para pruebas (Render, gratis)

1. Entra en [render.com](https://render.com) con tu cuenta de GitHub.
2. **New > Blueprint** y elige este repositorio: Render lee `render.yaml`.
3. Rellena `SONIOX_API_KEY` y `ACCESS_PASSWORD` cuando te las pida.
4. Al terminar te da una URL `https://….onrender.com`. Al abrirla pide usuario y contraseña: el usuario puede ser cualquiera y la contraseña es `ACCESS_PASSWORD`.

El plan gratuito se duerme tras 15 minutos sin visitas y tarda alrededor de un minuto en despertar. Ábrela un rato antes de la prueba.

### Probar sin cuenta de Soniox

`npm run dev:mock` arranca un Soniox simulado que devuelve frases de ejemplo. Sirve para comprobar que la página funciona sin gastar saldo.

## Voz

El servidor genera cada frase con Soniox TTS una sola vez por idioma, y solo si algún asistente tiene el audio activado en ese idioma. La conexión con Soniox se mantiene abierta mientras hay actividad y el audio llega al asistente a trozos, según se genera, para que empiece a sonar cuanto antes. Todos los que escuchan el mismo idioma reciben el mismo audio. Solo se generan frases que el ponente ha dicho, así que nadie puede usar el saldo con textos propios.

Variables opcionales:

- `SONIOX_TTS_VOICES`: voz por idioma, por ejemplo `es=Lucia,ca=Lucia,en=Emma,de=Maya,fr=Claire`, o un solo nombre para todos. Por defecto Lucia en español y catalán y Maya en el resto. Todas las voces hablan todos los idiomas.
- `SONIOX_TTS_SPEED`: velocidad entre 0.7 y 1.3 (por defecto 1).
- `SONIOX_TTS_CONCURRENCY`: generaciones simultáneas (por defecto 3, el límite de una cuenta nueva de Soniox; se puede subir en la consola).
- `SONIOX_TTS=off`: vuelve a la voz del navegador, que es gratis.

## Coste

Unos 0,60–0,90 $ por hora de presentación con cinco idiomas destino para la transcripción y la traducción, más unos 0,70 $ por hora por cada idioma que alguien escuche en audio. No depende del número de asistentes. El contador de la página muestra los minutos consumidos en la sesión.

## Próximos pasos

- Inicio de sesión con la cuenta de Google de la empresa.
