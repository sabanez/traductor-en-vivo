import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { LANGUAGES, type Language } from './languages';

// Los tokens de Azure caducan a los 10 minutos; los renovamos antes.
const TOKEN_REFRESH_MS = 9 * 60 * 1000;

const sourceSelect = document.querySelector<HTMLSelectElement>('#source-language')!;
const glossaryInput = document.querySelector<HTMLInputElement>('#glossary')!;
const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')!;
const statusLabel = document.querySelector<HTMLSpanElement>('#status')!;
const usageLabel = document.querySelector<HTMLSpanElement>('#usage')!;
const panelsContainer = document.querySelector<HTMLElement>('#panels')!;

interface Panel {
  finals: HTMLElement;
  partial: HTMLElement;
}

let recognizer: sdk.TranslationRecognizer | null = null;
let tokenTimer: number | undefined;
let usageTimer: number | undefined;
let startedAt = 0;
let panels = new Map<string, Panel>();

for (const language of LANGUAGES) {
  sourceSelect.add(new Option(language.name, language.code));
}

async function fetchToken(): Promise<{ token: string; region: string }> {
  const response = await fetch('/api/speech-token');
  if (!response.ok) throw new Error('No se pudo obtener el token del servidor');
  return response.json();
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
    const partial = document.createElement('p');
    partial.className = 'partial';
    panel.append(title, finals, partial);
    panelsContainer.append(panel);
    panels.set(language.code, { finals, partial });
  }
}

function showText(code: string, text: string, isFinal: boolean): void {
  const panel = panels.get(code);
  if (!panel) return;
  if (isFinal) {
    if (text) {
      const line = document.createElement('p');
      line.textContent = text;
      panel.finals.append(line);
      panel.finals.scrollTop = panel.finals.scrollHeight;
    }
    panel.partial.textContent = '';
  } else {
    panel.partial.textContent = text;
  }
}

function showResult(result: sdk.TranslationRecognitionResult, source: Language, isFinal: boolean): void {
  showText(source.code, result.text, isFinal);
  for (const language of LANGUAGES) {
    if (language.code === source.code) continue;
    showText(language.code, result.translations?.get(language.code) ?? '', isFinal);
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
    const { token, region } = await fetchToken();
    const config = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = source.locale;
    for (const language of LANGUAGES) {
      if (language.code !== source.code) config.addTargetLanguage(language.code);
    }

    recognizer = new sdk.TranslationRecognizer(config, sdk.AudioConfig.fromDefaultMicrophoneInput());

    const terms = glossaryInput.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (terms.length > 0) {
      const phraseList = sdk.PhraseListGrammar.fromRecognizer(recognizer);
      for (const term of terms) phraseList.addPhrase(term);
    }

    buildPanels(source);
    recognizer.recognizing = (_sender, event) => showResult(event.result, source, false);
    recognizer.recognized = (_sender, event) => {
      if (event.result.reason === sdk.ResultReason.TranslatedSpeech) showResult(event.result, source, true);
    };
    recognizer.canceled = (_sender, event) => {
      if (event.reason === sdk.CancellationReason.Error) {
        console.error(event.errorDetails);
        void stop(`Error: ${event.errorDetails}`);
      }
    };

    await new Promise<void>((resolve, reject) => recognizer!.startContinuousRecognitionAsync(resolve, reject));

    tokenTimer = window.setInterval(async () => {
      try {
        if (recognizer) recognizer.authorizationToken = (await fetchToken()).token;
      } catch (error) {
        console.error('No se pudo renovar el token', error);
      }
    }, TOKEN_REFRESH_MS);
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
  window.clearInterval(tokenTimer);
  window.clearInterval(usageTimer);
  const current = recognizer;
  recognizer = null;
  if (current) {
    await new Promise<void>((resolve) => current.stopContinuousRecognitionAsync(resolve, () => resolve()));
    current.close();
  }
  setStatus(message, false);
}

toggleButton.addEventListener('click', () => {
  void (recognizer ? stop() : start());
});

buildPanels(LANGUAGES[0]);
