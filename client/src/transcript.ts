import type { TextUpdate } from '../../shared/protocol';

/** Panel de texto en directo: frases cerradas arriba, la frase en curso y lo provisional debajo. */
export class Transcript {
  readonly element: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly finals: HTMLElement;
  private readonly current: HTMLElement;
  private readonly partial: HTMLElement;

  constructor(placeholder: string, private readonly onSentence?: (sentence: string) => void) {
    this.element = document.createElement('article');
    this.element.className = 'panel';
    this.heading = document.createElement('h2');
    const hint = document.createElement('p');
    hint.className = 'placeholder';
    hint.textContent = placeholder;
    this.finals = document.createElement('div');
    this.finals.className = 'finals';
    const live = document.createElement('p');
    live.className = 'live';
    this.current = document.createElement('span');
    this.partial = document.createElement('span');
    this.partial.className = 'partial';
    live.append(this.current, this.partial);
    this.element.append(this.heading, hint, this.finals, live);
  }

  setTitle(code: string, name: string): void {
    const chip = document.createElement('span');
    chip.className = 'panel-code';
    chip.textContent = code;
    this.heading.replaceChildren(chip, name);
  }

  apply(update: TextUpdate): void {
    this.current.textContent += update.finalText;
    this.partial.textContent = update.partialText;
    const sentence = this.current.textContent.trim();
    if (update.endOfSentence && sentence) {
      this.addLine(sentence);
      this.current.textContent = '';
      this.onSentence?.(sentence);
    }
  }

  /** Sustituye todo el contenido, por ejemplo al entrar tarde a la sala o al cambiar de idioma. */
  reset(lines: string[] = [], current = ''): void {
    this.finals.replaceChildren();
    for (const line of lines) this.addLine(line);
    this.current.textContent = current;
    this.partial.textContent = '';
  }

  private addLine(text: string): void {
    const line = document.createElement('p');
    line.textContent = text;
    this.finals.append(line);
    this.finals.scrollTop = this.finals.scrollHeight;
  }
}
