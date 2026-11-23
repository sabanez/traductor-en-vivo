/**
 * Aviso entre pestañas del mismo navegador: cuando el ponente captura el audio de todo el
 * ordenador, la voz de la traducción que suene en una pestaña de asistente de ese mismo
 * ordenador se volvería a captar y a traducir sin fin. La página del asistente lo escucha
 * aquí y deja de reproducir la voz mientras dure la captura.
 */
const CHANNEL = 'traductor-captura-sistema';

export type LoopbackMessage = { type: 'capturing'; active: boolean } | { type: 'query' };

export function openLoopbackChannel(onMessage: (message: LoopbackMessage) => void): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<LoopbackMessage>) => onMessage(event.data);
  return channel;
}
