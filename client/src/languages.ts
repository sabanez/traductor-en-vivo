export interface Language {
  /** Código ISO del idioma (es, en, de, fr). */
  code: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
];
