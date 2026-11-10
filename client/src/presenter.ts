import QRCode from 'qrcode';
import { ORIGINAL, type PresenterMessage, type ServerToPresenterMessage, type TextUpdate } from '../../shared/protocol';
import { findLanguage, LANGUAGES } from './languages';
import { sonioxProvider } from './providers/soniox';
import type { TranslationSession } from './providers/types';
import { Transcript } from './transcript';

// Para cambiar de proveedor basta con cambiar esta línea.
const provider = sonioxProvider;
const AUTO = 'auto';
const ROOM_STORAGE_KEY = 'traductor-sala';

const sourceSelect = document.querySelector<HTMLSelectElement>('#source-language')!;
const previewSelect = document.querySelector<HTMLSelectElement>('#preview-language')!;
const glossaryInput = document.querySelector<HTMLInputElement>('#glossary')!;
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status')!;
const statusText = document.querySelector<HTMLSpanElement>('#status-text')!;
const usageLabel = document.querySelector<HTMLSpanElement>('#usage')!;
const audienceLabel = document.querySelector<HTMLSpanElement>('#audience')!;
const panelsContainer = document.querySelector<HTMLElement>('#panels')!;
const shareLink = document.querySelector<HTMLAnchorElement>('#share-url')!;
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!;
const qrButton = document.querySelector<HTMLButtonElement>('#qr')!;
const qrDialog = document.querySelector<HTMLDialogElement>('#qr-dialog')!;

let session: TranslationSession | null = null;
let microphone: MediaStream | null = null;
let usageTimer: number | undefined;
let startedAt = 0;
let room: { id: string; key: string } | null = null;
let roomSocket: WebSocket | null = null;

// --- Paneles: el original siempre visible y una traducción como vista previa ---

const original = new Transcript('Aquí aparecerá lo que digas.');
original.setTitle('ORIG', 'Original');
const translations = new Map(
  LANGUAGES.map((l) => {
    const transcript = new Transcript('Aquí aparecerá la traducción.');
    transcript.setTitle(l.code.toUpperCase(), l.name);
    return [l.code, transcript] as const;
  }),
);
panelsContainer.append(original.element, ...[...translations.values()].map((t) => t.element));

sourceSelect.add(new Option('Detección automática', AUTO));
for (const language of LANGUAGES) {
  sourceSelect.add(new Option(language.name, language.code));
  previewSelect.add(new Option(language.name, language.code));
}
previewSelect.value = 'en';

function showPreview(): void {
  for (const [code, transcript] of translations) transcript.element.hidden = code !== previewSelect.value;
}
previewSelect.addEventListener('change', showPreview);
showPreview();

// --- Sala: enlace compartido y reparto del texto a los asistentes ---

function loadStoredRoom(): { id?: string; key?: string } {
  try {
    return JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function shareUrl(id: string): string {
  // En desarrollo Vite sirve la página de la sala tal cual; en producción la ruta es /s/<id>.
  return import.meta.env.DEV ? `${location.origin}/sala.html?id=${id}` : `${location.origin}/s/${id}`;
}

async function setUpRoom(): Promise<void> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loadStoredRoom()),
  });
  room = (await response.json()) as { id: string; key: string };
  try {
    localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(room));
  } catch {
    // Sin almacenamiento la sala dura lo que dure la pestaña.
  }
  const url = shareUrl(room.id);
  shareLink.href = url;
  shareLink.textContent = url.replace(/^https?:\/\//, '');
  const options = { margin: 0, color: { dark: '#1a1a18', light: '#ffffff' } };
  qrButton.innerHTML = await QRCode.toString(url, { ...options, type: 'svg' });
  document.querySelector('#qr-large')!.innerHTML = await QRCode.toString(url, { ...options, type: 'svg' });
  document.querySelector('#qr-caption')!.textContent = shareLink.textContent;
  connectRoom();
}

function connectRoom(): void {
  if (!room) return;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  roomSocket = new WebSocket(`${protocol}://${location.host}/ws/presenter?id=${room.id}&key=${encodeURIComponent(room.key)}`);
  roomSocket.onopen = () => sendToRoom({ type: 'status', live: session !== null });
  roomSocket.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as ServerToPresenterMessage;
    if (message.type === 'audience') {
      audienceLabel.textContent = `${message.count} ${message.count === 1 ? 'asistente' : 'asistentes'}`;
    }
  };
  // Si se corta (por ejemplo, el servidor se reinicia), se vuelve a conectar.
  roomSocket.onclose = () => window.setTimeout(connectRoom, 2000);
}

function sendToRoom(message: PresenterMessage): void {
  if (roomSocket?.readyState === WebSocket.OPEN) roomSocket.send(JSON.stringify(message));
}

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(shareLink.href);
  copyButton.textContent = 'Copiado';
  window.setTimeout(() => (copyButton.textContent = 'Copiar enlace'), 1500);
});
qrButton.addEventListener('click', () => qrDialog.showModal());

// --- Traducción ---

function handleUpdate(update: TextUpdate): void {
  if (update.language === ORIGINAL) {
    original.apply(update);
    sendToRoom({ type: 'update', ...update });
    // Con el idioma fijado no se traduce a él mismo: sus asistentes reciben el original.
    if (sourceSelect.value !== AUTO) handleUpdate({ ...update, language: sourceSelect.value });
    return;
  }
  translations.get(update.language)?.apply(update);
  sendToRoom({ type: 'update', ...update });
}

function setStatus(text: string, running: boolean): void {
  statusText.textContent = text;
  statusLabel.classList.toggle('running', running);
  statusLabel.classList.toggle('error', text.startsWith('Error'));
  toggleButton.textContent = running ? 'Detener' : 'Empezar';
  toggleButton.classList.toggle('stop', running);
  sourceSelect.disabled = running;
  glossaryInput.disabled = running;
}

function updateUsage(): void {
  const minutes = (Date.now() - startedAt) / 60000;
  usageLabel.textContent = `${minutes.toFixed(1)} min`;
}

async function start(): Promise<void> {
  const source = sourceSelect.value === AUTO ? null : findLanguage(sourceSelect.value)!;
  toggleButton.disabled = true;
  setStatus('Conectando…', true);

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    session = await provider.start(
      microphone,
      {
        sourceLanguage: source?.code ?? null,
        targetLanguages: LANGUAGES.filter((l) => l.code !== source?.code).map((l) => l.code),
        expectedLanguages: LANGUAGES.map((l) => l.code),
        glossary: glossaryInput.value.split(',').map((t) => t.trim()).filter(Boolean),
      },
      handleUpdate,
      (message) => void stop(`Error: ${message}`),
    );
    startedAt = Date.now();
    updateUsage();
    usageTimer = window.setInterval(updateUsage, 5000);
    setStatus('En directo', true);
    sendToRoom({ type: 'status', live: true });
  } catch (error) {
    console.error(error);
    await stop(`Error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    toggleButton.disabled = false;
  }
}

async function stop(message = 'Parado'): Promise<void> {
  window.clearInterval(usageTimer);
  const current = session;
  session = null;
  await current?.stop();
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
  setStatus(message, false);
  sendToRoom({ type: 'status', live: false });
}

toggleButton.addEventListener('click', () => {
  void (session ? stop() : start());
});

setUpRoom().catch((error) => {
  console.error(error);
  shareLink.textContent = 'No se pudo crear la sala';
});
