import { type AttendeeMessage, type GlossaryEntry, ORIGINAL } from '../../shared/protocol';
import { findLanguage, LANGUAGES } from './languages';
import { Transcript } from './transcript';

const LANGUAGE_STORAGE_KEY = 'traductor-idioma';

const languageSelect = document.querySelector<HTMLSelectElement>('#language')!;
const audioButton = document.querySelector<HTMLButtonElement>('#audio')!;
const audioLabel = document.querySelector<HTMLSpanElement>('#audio-label')!;
const audioNote = document.querySelector<HTMLParagraphElement>('#audio-note')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status')!;
const statusText = document.querySelector<HTMLSpanElement>('#status-text')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const glossaryButton = document.querySelector<HTMLButtonElement>('#glossary-open')!;
const glossaryCount = document.querySelector<HTMLSpanElement>('#glossary-count')!;
const glossaryDialog = document.querySelector<HTMLDialogElement>('#glossary-dialog')!;
const glossaryList = document.querySelector<HTMLElement>('#glossary-list')!;

// La sala viene en la ruta (/s/<id>) en producción y como ?id= en desarrollo.
const roomId = new URLSearchParams(location.search).get('id') ?? location.pathname.split('/').pop() ?? '';

// Se guarda todo lo recibido para poder cambiar de idioma sin perder lo ya dicho.
const lines = new Map<string, string[]>();
const current = new Map<string, string>();
let audioOn = false;

for (const language of LANGUAGES) languageSelect.add(new Option(language.name, language.code));
languageSelect.add(new Option('Original (sin traducir)', ORIGINAL));
languageSelect.value = initialLanguage();

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && (saved === ORIGINAL || findLanguage(saved))) return saved;
  } catch {
    // Sin almacenamiento se usa el idioma del navegador.
  }
  const browser = navigator.language.slice(0, 2);
  return findLanguage(browser) ? browser : 'es';
}

const transcript = new Transcript('La traducción aparecerá aquí cuando el ponente empiece a hablar.', speak);
panel.append(transcript.element);

function showLanguage(): void {
  const code = languageSelect.value;
  const language = findLanguage(code);
  transcript.setTitle(language ? code.toUpperCase() : 'ORIG', language ? language.name : 'Original');
  transcript.reset(lines.get(code), current.get(code));
  stopAudio();
  document.documentElement.lang = language ? code : 'es';
}

languageSelect.addEventListener('change', () => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, languageSelect.value);
  } catch {
    // No pasa nada si no se puede recordar.
  }
  showLanguage();
});

// --- Audio: voz natural de Soniox, con la voz del navegador como reserva ---

// Si la voz de Soniox falla varias veces seguidas se pasa a la del navegador.
const MAX_FAILURES = 3;
let audioContext: AudioContext | null = null;
let soniox = true;
let failures = 0;
// Frases pedidas en orden; se reproducen en ese orden aunque lleguen desordenadas.
let queue: Clip[] = [];
let playing = false;
// Momento (en el reloj del AudioContext) en que acaba lo ya programado.
let nextTime = 0;
const sources = new Set<AudioBufferSourceNode>();
// Cambia al silenciar o cambiar de idioma, para cortar la frase que se esté reproduciendo.
let generation = 0;

/** Audio de una frase que llega a trozos desde el servidor (PCM de 16 bits, mono). */
class Clip {
  private readonly parts: AudioBuffer[] = [];
  private done = false;
  private wake: (() => void) | null = null;
  failed = false;

  constructor(
    code: string,
    sentence: string,
    private readonly context: AudioContext,
  ) {
    void this.load(code, sentence);
  }

  private async load(code: string, sentence: string): Promise<void> {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomId, language: code, text: sentence }),
      });
      if (response.status === 503 && (await response.clone().text()).includes('desactivada')) soniox = false;
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const rate = Number(response.headers.get('X-Sample-Rate') ?? '24000');
      const reader = response.body.getReader();
      let carry: Uint8Array | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let bytes = value;
        if (carry) {
          bytes = new Uint8Array(carry.length + value.length);
          bytes.set(carry);
          bytes.set(value, carry.length);
          carry = null;
        }
        // Un trozo puede partir una muestra de 2 bytes por la mitad: se guarda para el siguiente.
        if (bytes.length % 2) {
          carry = bytes.slice(-1);
          bytes = bytes.subarray(0, -1);
        }
        if (bytes.length === 0) continue;
        const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
        const buffer = this.context.createBuffer(1, samples.length, rate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
        this.parts.push(buffer);
        this.notify();
      }
      failures = 0;
    } catch (error) {
      console.warn('Voz de Soniox no disponible:', error);
      this.failed = true;
      failures += 1;
      if (failures >= MAX_FAILURES) {
        soniox = false;
        updateAudioNote();
      }
    } finally {
      this.done = true;
      this.notify();
    }
  }

  private notify(): void {
    this.wake?.();
    this.wake = null;
  }

  async *buffers(): AsyncGenerator<AudioBuffer> {
    let index = 0;
    for (;;) {
      while (index < this.parts.length) yield this.parts[index++];
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

function schedule(buffer: AudioBuffer): void {
  const context = audioContext!;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  // Un pequeño margen evita cortes si el trozo llega justo a tiempo.
  const start = Math.max(nextTime, context.currentTime + 0.05);
  source.start(start);
  nextTime = start + buffer.duration;
  sources.add(source);
  source.onended = () => sources.delete(source);
}

/** Espera hasta poco antes de que acabe lo programado, para enlazar la frase siguiente sin hueco. */
function untilAlmostDone(): Promise<void> {
  const remaining = nextTime - (audioContext?.currentTime ?? 0) - 0.15;
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, remaining * 1000)));
}

async function playQueue(): Promise<void> {
  if (playing) return;
  playing = true;
  while (queue.length > 0 && audioOn && audioContext) {
    // Si hay más de dos frases esperando, el audio va atrasado: se salta a las últimas.
    if (queue.length > 2) queue = queue.slice(-2);
    const clip = queue.shift()!;
    const current = generation;
    for await (const buffer of clip.buffers()) {
      if (!audioOn || !audioContext || current !== generation) break;
      schedule(buffer);
    }
    await untilAlmostDone();
  }
  playing = false;
}

function stopAudio(): void {
  generation += 1;
  queue = [];
  for (const source of sources) source.stop();
  sources.clear();
  nextTime = 0;
  speechSynthesis.cancel();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith(lang.slice(0, 2)));
  // Las voces "Natural", "Online" o de Google suenan bastante mejor que las del sistema.
  const better = (v: SpeechSynthesisVoice) => /natural|online|google|premium|enhanced/i.test(v.name);
  return (
    voices.find((v) => v.lang === lang && better(v)) ??
    voices.find(better) ??
    voices.find((v) => v.lang === lang) ??
    voices[0]
  );
}

function speakWithBrowser(sentence: string, lang: string): void {
  // Si la voz se queda atrás respecto al ponente, se salta lo pendiente y se lee lo último.
  if (speechSynthesis.pending) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(sentence);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function speak(sentence: string): void {
  const code = languageSelect.value;
  const language = findLanguage(code);
  if (!audioOn || !language) return;
  if (soniox && audioContext) {
    queue.push(new Clip(code, sentence, audioContext));
    void playQueue();
  } else {
    speakWithBrowser(sentence, language.voice);
  }
}

function updateAudioNote(): void {
  const language = findLanguage(languageSelect.value);
  const browserVoice = audioOn && language && !soniox;
  const missingVoice = browserVoice && speechSynthesis.getVoices().length > 0 && !pickVoice(language.voice);
  audioNote.hidden = !browserVoice;
  audioNote.textContent = !browserVoice
    ? ''
    : missingVoice
      ? `La voz natural no está disponible y este dispositivo no tiene voz en ${language.name}.`
      : 'La voz natural no está disponible: se usa la voz del dispositivo.';
}

audioButton.addEventListener('click', () => {
  audioOn = !audioOn;
  audioButton.setAttribute('aria-pressed', String(audioOn));
  audioButton.classList.toggle('on', audioOn);
  audioLabel.textContent = audioOn ? 'Silenciar' : 'Escuchar';
  // El navegador solo deja reproducir audio después de un clic: se prepara aquí.
  if (audioOn) {
    audioContext ??= new AudioContext();
    void audioContext.resume();
  } else {
    stopAudio();
  }
  updateAudioNote();
});
languageSelect.addEventListener('change', updateAudioNote);
speechSynthesis.addEventListener('voiceschanged', updateAudioNote);

// --- Glosario del ponente ---

function showGlossary(entries: GlossaryEntry[]): void {
  glossaryButton.hidden = entries.length === 0;
  glossaryCount.textContent = String(entries.length);
  glossaryList.replaceChildren();
  for (const entry of [...entries].sort((a, b) => a.term.localeCompare(b.term))) {
    const term = document.createElement('dt');
    term.textContent = entry.term;
    const definition = document.createElement('dd');
    definition.textContent = entry.definition;
    glossaryList.append(term, definition);
  }
  if (entries.length === 0 && glossaryDialog.open) glossaryDialog.close();
}

glossaryButton.addEventListener('click', () => glossaryDialog.showModal());
// Un clic fuera del cuadro lo cierra.
glossaryDialog.addEventListener('click', (event) => {
  if (event.target === glossaryDialog) glossaryDialog.close();
});

// --- Conexión con la sala ---

function setStatus(text: string, live: boolean, error = false): void {
  statusText.textContent = text;
  statusLabel.classList.toggle('running', live);
  statusLabel.classList.toggle('error', error);
}

function store(code: string, finalText: string, endOfSentence: boolean): void {
  const text = (current.get(code) ?? '') + finalText;
  if (endOfSentence && text.trim()) {
    lines.set(code, [...(lines.get(code) ?? []), text.trim()]);
    current.set(code, '');
  } else {
    current.set(code, text);
  }
}

function connect(): void {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws/room?id=${encodeURIComponent(roomId)}`);
  let notFound = false;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string) as AttendeeMessage;
    switch (message.type) {
      case 'snapshot':
        lines.clear();
        current.clear();
        for (const [code, list] of Object.entries(message.lines)) lines.set(code, list);
        for (const [code, text] of Object.entries(message.current)) current.set(code, text);
        showLanguage();
        showGlossary(message.glossary);
        setStatus(message.live ? 'En directo' : 'En pausa', message.live);
        break;
      case 'glossary':
        showGlossary(message.entries);
        break;
      case 'status':
        setStatus(message.live ? 'En directo' : 'En pausa', message.live);
        break;
      case 'update':
        store(message.language, message.finalText, message.endOfSentence);
        if (message.language === languageSelect.value) transcript.apply(message);
        break;
      case 'not-found':
        notFound = true;
        setStatus('Sala no encontrada', false, true);
        break;
    }
  };
  socket.onclose = () => {
    if (notFound) return;
    setStatus('Reconectando…', false);
    window.setTimeout(connect, 2000);
  };
}

showLanguage();
connect();
