# Traductor en vivo

Traducción simultánea de presentaciones internas. El ponente habla al micrófono y la página muestra en directo la transcripción y su traducción a español, inglés, alemán y francés.

Estado: **paso 1, prototipo del ponente**. Todavía no hay sala de participantes, audio traducido ni inicio de sesión con Google.

## Cómo funciona

- El navegador del ponente envía el audio directamente a Azure Speech, que transcribe y traduce a los tres idiomas restantes en un solo flujo.
- El servidor (Node + TypeScript) solo emite tokens temporales, así que la clave de Azure nunca llega al navegador.
- El glosario sirve para que reconozca bien nombres propios y términos de la empresa.

## Puesta en marcha

1. Crea un recurso **Speech** en el [portal de Azure](https://portal.azure.com) (región `westeurope`, plan gratuito F0 para pruebas).
2. Copia `.env.example` a `.env` y pon la clave y la región.
3. Instala y arranca:

```bash
npm install
npm run dev
```

4. Abre http://localhost:5173 en Chrome o Edge, permite el micrófono y pulsa **Empezar**.

Para producción: `npm run build` y luego `npm start` (sirve la web en el puerto `PORT`).

## Próximos pasos

- Sala de participantes con WebSockets, selector de idioma y voz sintetizada.
- Inicio de sesión con la cuenta de Google de la empresa.
