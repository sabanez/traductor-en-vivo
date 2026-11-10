import { LANGUAGES, type Language } from './languages';
import { sonioxProvider } from './providers/soniox';
import type { TextUpdate, TranslationSession } from './providers/types';

// Para cambiar de proveedor basta con cambiar esta línea.
const provider = sonioxProvider;

const sourceGroup = document.querySelector<HTMLElement>('#source-language')!;
const targetGroup = document.querySelector<HTMLElement>('#target-language')!;
const glossaryInput = document.querySelector<HTMLInputElement>('#glossary')!;
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status')!;
const statusText = document.querySelector<HTMLSpanElement>('#status-text')!;
const usageLabel = document.querySelector<HTMLSpanElement>('#usage')!;
const panelsContainer = document.querySelector<HTMLElement>('#panels')!;

interface Panel {
  element: HTMLElement;
  finals: HTMLElement;
  current: HTMLElement;
  partial: HTMLElement;
}

let session: TranslationSession | null = null;
let microphone: MediaStream | null = null;
let usageTimer: number | undefined;
let startedAt = 0;
let panels = new Map<string, Panel>();
let target = LANGUAGES[1];

function buildSegments(group: HTMLElement, name: string, languages: Language[], selected: Language, onSelect: (language: Language) => void): void {
  group.replaceChildren();
  for (const language of languages) {
    const option = document.createElement('label');
    option.className = 'segment';
    option.title = language.name;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = language.code;
    radio.checked = language.code === selected.code;
    radio.addEventListener('change', () => onSelect(language));
    option.append(radio, language.code.toUpperCase());
    group.append(option);
  }
}

function selectedSource(): Language {
  const checked = sourceGroup.querySelector<HTMLInputElement>('input:checked');
  return LANGUAGES.find((l) => l.code === checked?.value) ?? LANGUAGES[0];
}

// Se traduce siempre a todos los idiomas (los necesitará la sala de participantes);
// el selector solo decide cuál se ve, así que cambiarlo es instantáneo y no pierde texto.
function selectTarget(language: Language): void {
  target = language;
  for (const [code, panel] of panels) {
    if (code !== selectedSource().code) panel.element.hidden = code !== target.code;
  }
}

function selectSource(source: Language): void {
  const targets = LANGUAGES.filter((l) => l.code !== source.code);
  if (target.code === source.code) target = targets[0];
  buildSegments(targetGroup, 'target-language', targets, target, selectTarget);
  buildPanels(source);
  selectTarget(target);
}

buildSegments(sourceGroup, 'source-language', LANGUAGES, LANGUAGES[0], selectSource);

function buildPanels(source: Language): void {
  panelsContainer.replaceChildren();
  panels = new Map();
  const ordered = [source, ...LANGUAGES.filter((l) => l.code !== source.code)];
  for (const language of ordered) {
    const isOriginal = language.code === source.code;
    const panel = document.createElement('article');
    panel.className = 'panel';
    const title = document.createElement('h2');
    const code = document.createElement('span');
    code.className = 'panel-code';
    code.textContent = language.code.toUpperCase();
    title.append(code, isOriginal ? `${language.name} · original` : language.name);
    const finals = document.createElement('div');
    finals.className = 'finals';
    const live = document.createElement('p');
    live.className = 'live';
    const current = document.createElement('span');
    const partial = document.createElement('span');
    partial.className = 'partial';
    live.append(current, partial);
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = isOriginal ? 'Aquí aparecerá lo que digas.' : 'Aquí aparecerá la traducción.';
    panel.append(title, placeholder, finals, live);
    panelsContainer.append(panel);
    panels.set(language.code, { element: panel, finals, current, partial });
  }
}

function showUpdate(update: TextUpdate): void {
  const panel = panels.get(update.language);
  if (!panel) return;
  panel.current.textContent += update.finalText;
  panel.partial.textContent = update.partialText;
  if (update.endOfSentence && panel.current.textContent.trim()) {
    const line = document.createElement('p');
    line.textContent = panel.current.textContent.trim();
    panel.finals.append(line);
    panel.finals.scrollTop = panel.finals.scrollHeight;
    panel.current.textContent = '';
  }
}

function setStatus(text: string, running: boolean): void {
  statusText.textContent = text;
  statusLabel.classList.toggle('running', running);
  statusLabel.classList.toggle('error', text.startsWith('Error'));
  toggleButton.textContent = running ? 'Detener' : 'Empezar';
  toggleButton.classList.toggle('stop', running);
  sourceGroup.querySelectorAll('input').forEach((input) => (input.disabled = running));
  glossaryInput.disabled = running;
}

function updateUsage(): void {
  const minutes = (Date.now() - startedAt) / 60000;
  usageLabel.textContent = `${minutes.toFixed(1)} min`;
}

async function start(): Promise<void> {
  const source = selectedSource();
  toggleButton.disabled = true;
  setStatus('Conectando…', true);

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    buildPanels(source);
    selectTarget(target);
    session = await provider.start(
      microphone,
      {
        sourceLanguage: source.code,
        targetLanguages: LANGUAGES.filter((l) => l.code !== source.code).map((l) => l.code),
        glossary: glossaryInput.value.split(',').map((t) => t.trim()).filter(Boolean),
      },
      showUpdate,
      (message) => void stop(`Error: ${message}`),
    );
    startedAt = Date.now();
    updateUsage();
    usageTimer = window.setInterval(updateUsage, 5000);
    setStatus('Escuchando', true);
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
}

toggleButton.addEventListener('click', () => {
  void (session ? stop() : start());
});

selectSource(LANGUAGES[0]);
