import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { AttendeeMessage, GlossaryEntry, PresenterMessage, ServerToPresenterMessage, TextUpdate } from '../shared/protocol';

// Frases que se guardan por idioma para quien entra tarde a la sala.
const MAX_LINES = 300;
// Límite del glosario, para que nadie pueda llenar la memoria del servidor.
const MAX_GLOSSARY = 200;
// Una sala sin actividad durante este tiempo se borra.
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
// Frases recientes que se pueden pedir en audio y audios guardados por sala.
const SPEAKABLE_LINES = 30;
const MAX_AUDIO_CACHE = 60;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

interface Room {
  id: string;
  key: string;
  live: boolean;
  lines: Map<string, string[]>;
  current: Map<string, string>;
  glossary: GlossaryEntry[];
  presenter: WebSocket | null;
  attendees: Set<WebSocket>;
  /** Audio ya generado (o en curso) por idioma y frase, compartido entre asistentes. */
  audio: Map<string, Promise<Buffer>>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

function randomId(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

/** Devuelve la sala del ponente si sigue existiendo con esa clave, o crea una nueva. */
export function getOrCreateRoom(id?: string, key?: string): { id: string; key: string } {
  const existing = id ? rooms.get(id) : undefined;
  if (existing && existing.key === key) {
    existing.lastActivity = Date.now();
    return { id: existing.id, key: existing.key };
  }
  const room: Room = {
    id: randomId(8),
    key: randomBytes(24).toString('base64url'),
    live: false,
    lines: new Map(),
    current: new Map(),
    glossary: [],
    presenter: null,
    attendees: new Set(),
    audio: new Map(),
    lastActivity: Date.now(),
  };
  rooms.set(room.id, room);
  return { id: room.id, key: room.key };
}

function send(socket: WebSocket, message: AttendeeMessage | ServerToPresenterMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: Room, message: AttendeeMessage): void {
  for (const attendee of room.attendees) send(attendee, message);
}

function sendAudience(room: Room): void {
  if (room.presenter) send(room.presenter, { type: 'audience', count: room.attendees.size });
}

function applyUpdate(room: Room, update: TextUpdate): void {
  const current = (room.current.get(update.language) ?? '') + update.finalText;
  if (update.endOfSentence && current.trim()) {
    const lines = room.lines.get(update.language) ?? [];
    lines.push(current.trim());
    if (lines.length > MAX_LINES) lines.shift();
    room.lines.set(update.language, lines);
    room.current.set(update.language, '');
  } else {
    room.current.set(update.language, current);
  }
}

function handlePresenter(room: Room, socket: WebSocket): void {
  room.presenter?.close();
  room.presenter = socket;
  sendAudience(room);
  socket.on('message', (data) => {
    room.lastActivity = Date.now();
    const message = JSON.parse(data.toString()) as PresenterMessage;
    if (message.type === 'status') {
      room.live = message.live;
      broadcast(room, { type: 'status', live: room.live });
    } else if (message.type === 'glossary') {
      room.glossary = message.entries.slice(0, MAX_GLOSSARY).map((e) => ({
        term: String(e.term).slice(0, 100),
        definition: String(e.definition).slice(0, 500),
      }));
      broadcast(room, { type: 'glossary', entries: room.glossary });
    } else if (message.type === 'update') {
      const { language, finalText, partialText, endOfSentence } = message;
      const update = { language, finalText, partialText, endOfSentence };
      applyUpdate(room, update);
      broadcast(room, { type: 'update', ...update });
    }
  });
  socket.on('close', () => {
    if (room.presenter !== socket) return;
    room.presenter = null;
    room.live = false;
    broadcast(room, { type: 'status', live: false });
  });
}

function handleAttendee(room: Room, socket: WebSocket): void {
  room.attendees.add(socket);
  send(socket, {
    type: 'snapshot',
    live: room.live,
    lines: Object.fromEntries(room.lines),
    current: Object.fromEntries(room.current),
    glossary: room.glossary,
  });
  sendAudience(room);
  socket.on('close', () => {
    room.attendees.delete(socket);
    sendAudience(room);
  });
}

/**
 * Audio de una frase de la sala. Solo se generan frases que el ponente ha dicho de verdad,
 * para que nadie pueda usar el saldo de Soniox con textos propios.
 */
export function roomAudio(
  roomId: string,
  language: string,
  text: string,
  generate: () => Promise<Buffer>,
): Promise<Buffer> | null {
  const room = rooms.get(roomId);
  if (!room || !(room.lines.get(language) ?? []).slice(-SPEAKABLE_LINES).includes(text)) return null;
  const cacheKey = `${language}\n${text}`;
  let audio = room.audio.get(cacheKey);
  if (!audio) {
    audio = generate();
    // Si falla se olvida, para que otro asistente pueda volver a intentarlo.
    audio.catch(() => room.audio.delete(cacheKey));
    room.audio.set(cacheKey, audio);
    if (room.audio.size > MAX_AUDIO_CACHE) room.audio.delete(room.audio.keys().next().value!);
  }
  return audio;
}

const wss = new WebSocketServer({ noServer: true });

/** Atiende las conexiones WebSocket del ponente (/ws/presenter) y de los asistentes (/ws/room). */
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const room = rooms.get(url.searchParams.get('id') ?? '');

  if (url.pathname === '/ws/presenter') {
    // Solo quien creó la sala (y por tanto pasó la contraseña) conoce la clave.
    if (!room || room.key !== url.searchParams.get('key')) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handlePresenter(room, ws));
  } else if (url.pathname === '/ws/room') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (room) {
        handleAttendee(room, ws);
      } else {
        send(ws, { type: 'not-found' });
        ws.close();
      }
    });
  } else {
    socket.destroy();
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const idle = !room.presenter && room.attendees.size === 0;
    if (idle && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(id);
  }
}, 60 * 60 * 1000).unref();
