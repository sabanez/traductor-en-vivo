/** Mensajes entre el navegador del ponente, el servidor y los asistentes. */

/** Clave del texto original (lo que dice el ponente, sin traducir). */
export const ORIGINAL = 'original';

export interface TextUpdate {
  /** `original` o el código del idioma de la traducción. */
  language: string;
  /** Texto nuevo ya definitivo, que no volverá a cambiar. */
  finalText: string;
  /** Texto provisional actual, que sustituye al anterior. */
  partialText: string;
  /** El ponente ha hecho una pausa: la frase actual se puede cerrar. */
  endOfSentence: boolean;
}

/** Término del glosario, con una explicación opcional para los asistentes. */
export interface GlossaryEntry {
  term: string;
  definition: string;
}

export type PresenterMessage =
  | ({ type: 'update' } & TextUpdate)
  | { type: 'status'; live: boolean }
  | { type: 'glossary'; entries: GlossaryEntry[] };

export type AttendeeMessage =
  | {
      type: 'snapshot';
      live: boolean;
      lines: Record<string, string[]>;
      current: Record<string, string>;
      glossary: GlossaryEntry[];
    }
  | ({ type: 'update' } & TextUpdate)
  | { type: 'status'; live: boolean }
  | { type: 'glossary'; entries: GlossaryEntry[] }
  | { type: 'not-found' };

export type ServerToPresenterMessage = { type: 'audience'; count: number };
