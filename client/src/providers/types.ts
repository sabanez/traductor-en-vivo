import type { TextUpdate } from '../../../shared/protocol';

export type { TextUpdate };

/**
 * Capa de proveedor: la página del ponente solo conoce esta interfaz, de modo que
 * cambiar de Soniox a otro servicio supone escribir otro archivo en esta carpeta.
 */
export interface TranslationOptions {
  /** Código del idioma que habla el ponente, o null para detectarlo automáticamente. */
  sourceLanguage: string | null;
  /** Idiomas a los que se traduce. */
  targetLanguages: string[];
  /** Todos los idiomas posibles, para orientar la detección automática. */
  expectedLanguages: string[];
  /** Nombres propios y jerga que el reconocimiento debe escribir bien. */
  glossary: string[];
}

export interface TranslationSession {
  stop(): Promise<void>;
}

/** Las actualizaciones del texto original llegan con `language` igual a `original`. */
export interface TranslationProvider {
  start(
    audio: MediaStream,
    options: TranslationOptions,
    onUpdate: (update: TextUpdate) => void,
    onError: (message: string) => void,
  ): Promise<TranslationSession>;
}
