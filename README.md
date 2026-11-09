# Traductor en vivo

Traducción simultánea de presentaciones internas. El ponente habla al micrófono y la página muestra en directo la transcripción y su traducción a español, inglés, alemán y francés.

Estado: **paso 1, prototipo del ponente** con [Soniox](https://soniox.com). Todavía no hay sala de participantes, audio traducido ni inicio de sesión con Google.

## Cómo funciona

- El navegador del ponente convierte el micrófono a PCM de 16 kHz y lo envía directamente a Soniox.
- Soniox traduce a un solo idioma por conexión, así que se abren tres (una por idioma destino) con el mismo audio. El texto original sale de la primera.
- El servidor (Node + TypeScript) solo emite claves temporales de 5 minutos, así que la clave de Soniox nunca llega al navegador.
- El glosario se envía como `context.terms` para que Soniox escriba bien nombres propios y jerga de la empresa.
- Todo lo específico de Soniox está en `client/src/providers/soniox.ts`. Para cambiar de proveedor hay que escribir otro archivo que cumpla `client/src/providers/types.ts`.

## Instalación de la versión de prueba

Requisitos: [Node.js 22](https://nodejs.org) o superior y Chrome o Edge.

1. En la [consola de Soniox](https://console.soniox.com):
   - Recarga saldo (con 10 $ hay para unas 20 horas de prueba con tres idiomas).
   - Crea una API key con el permiso **Temporary API keys**.
   - Solicita la región **EU** para el proyecto. Mientras no esté aprobada, usa `SONIOX_REGION=global`.
2. Descarga el código e instala las dependencias:

```bash
git clone https://github.com/sabanez/-traductor-en-vivo.git traductor-en-vivo
cd traductor-en-vivo
npm install
```

3. Copia `.env.example` a `.env` y pon tu clave y la región.
4. Arranca en modo desarrollo:

```bash
npm run dev
```

5. Abre http://localhost:5173, permite el micrófono, elige el idioma en que vas a hablar y pulsa **Empezar**.

Para producción: `npm run build` y luego `npm start`, que sirve la web en el puerto `PORT`.

### Probar sin cuenta de Soniox

`npm run dev:mock` arranca un Soniox simulado que devuelve frases de ejemplo. Sirve para comprobar que la página funciona sin gastar saldo.

## Coste

Unos 0,36–0,54 $ por hora de presentación con tres idiomas destino. No depende del número de asistentes. El contador de la página muestra los minutos consumidos en la sesión.

## Próximos pasos

- Sala de participantes con WebSockets, selector de idioma y voz sintetizada.
- Inicio de sesión con la cuenta de Google de la empresa.
