import { LANGUAGES, type Language } from './languages';
import { sonioxProvider } from './providers/soniox';
import type { TextUpdate, TranslationSession } from './providers/types';

// Para cambiar de proveedor basta con cambiar esta línea.
const provider = sonioxProvider;

const sourceSelect = document.querySelector<HTMLSelectElement>('#source-language')!;
const glossaryInput = document.querySelector<HTMLInputElement>('#glossary')!;
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status')!;
const usageLabel = document.querySelector<HTMLSpanElement>('#usage')!;
const panelsContainer = document.querySelector<HTMLElement>('#panels')!;

interface Panel {
  finals: HTMLElement;
  current: HTMLElement;
  partial: HTMLElement;
}

let session: TranslationSession | null = null;
let microphone: MediaStream | null = null;
let usageTimer: number | undefined;
let startedAt = 0;
let panels = new Map<string, Panel>();

for (const language of LANGUAGES) {
  sourceSelect.add(new Option(language.name, language.code));
}

function buildPanels(source: Language): void {
  panelsContainer.replaceChildren();
  panels = new Map();
  const ordered = [source, ...LANGUAGES.filter((l) => l.code !== source.code)];
  for (const language of ordered) {
    const panel = document.createElement('article');
    panel.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = language.code === source.code ? `${language.name} (original)` : language.name;
    const finals = document.createElement('div');
    finals.className = 'finals';
    const live = document.createElement('p');
    live.className = 'live';
    const current = document.createElement('span');
    const partial = document.createElement('span');
    partial.className = 'partial';
    live.append(current, partial);
    panel.append(title, finals, live);
    panelsContainer.append(panel);
    panels.set(language.code, { finals, current, partial });
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
  statusLabel.textContent = text;
  statusLabel.classList.toggle('running', running);
  toggleButton.textContent = running ? 'Parar' : 'Empezar';
  sourceSelect.disabled = running;
  glossaryInput.disabled = running;
}

function updateUsage(): void {
  const minutes = (Date.now() - startedAt) / 60000;
  usageLabel.textContent = `${minutes.toFixed(1)} min de audio en esta sesión`;
}

async function start(): Promise<void> {
  const source = LANGUAGES.find((l) => l.code === sourceSelect.value)!;
  toggleButton.disabled = true;
  setStatus('Conectando…', true);

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    buildPanels(source);
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

buildPanels(LANGUAGES[0]);
