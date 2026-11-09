export interface Language {
  /** Código de traducción de Azure (en, es, ...). */
  code: string;
  /** Locale de reconocimiento de voz de Azure (en-US, es-ES, ...). */
  locale: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: 'es', locale: 'es-ES', name: 'Español' },
  { code: 'en', locale: 'en-US', name: 'English' },
  { code: 'de', locale: 'de-DE', name: 'Deutsch' },
  { code: 'fr', locale: 'fr-FR', name: 'Français' },
];
