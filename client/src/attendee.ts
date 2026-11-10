import { type AttendeeMessage, ORIGINAL } from '../../shared/protocol';
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
  speechSynthesis.cancel();
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

// --- Audio: lectura en voz alta con la voz del navegador ---

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}

function speak(sentence: string): void {
  const language = findLanguage(languageSelect.value);
  if (!audioOn || !language) return;
  // Si la voz se queda atrás respecto al ponente, se salta lo pendiente y se lee lo último.
  if (speechSynthesis.pending) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(sentence);
  utterance.lang = language.voice;
  const voice = pickVoice(language.voice);
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function updateAudioNote(): void {
  const language = findLanguage(languageSelect.value);
  const missingVoice = audioOn && language && speechSynthesis.getVoices().length > 0 && !pickVoice(language.voice);
  audioNote.hidden = !missingVoice;
  audioNote.textContent = missingVoice ? `Este dispositivo no tiene voz en ${language.name}: se usará la voz por defecto.` : '';
}

audioButton.addEventListener('click', () => {
  audioOn = !audioOn;
  audioButton.setAttribute('aria-pressed', String(audioOn));
  audioButton.classList.toggle('on', audioOn);
  audioLabel.textContent = audioOn ? 'Silenciar' : 'Escuchar';
  if (!audioOn) speechSynthesis.cancel();
  updateAudioNote();
});
languageSelect.addEventListener('change', updateAudioNote);
speechSynthesis.addEventListener('voiceschanged', updateAudioNote);

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
        setStatus(message.live ? 'En directo' : 'En pausa', message.live);
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
