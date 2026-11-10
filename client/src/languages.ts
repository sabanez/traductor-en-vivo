export interface Language {
  /** Código ISO del idioma (es, en, de, fr, ca). */
  code: string;
  name: string;
  /** Voz preferida para leer la traducción en voz alta. */
  voice: string;
}

export const LANGUAGES: Language[] = [
  { code: 'es', name: 'Español', voice: 'es-ES' },
  { code: 'en', name: 'English', voice: 'en-GB' },
  { code: 'de', name: 'Deutsch', voice: 'de-DE' },
  { code: 'fr', name: 'Français', voice: 'fr-FR' },
  { code: 'ca', name: 'Català', voice: 'ca-ES' },
];

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
