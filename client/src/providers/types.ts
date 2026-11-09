/**
 * Capa de proveedor: la página del ponente solo conoce esta interfaz, de modo que
 * cambiar de Soniox a otro servicio supone escribir otro archivo en esta carpeta.
 */
export interface TranslationOptions {
  /** Código del idioma que habla el ponente (es, en, de, fr). */
  sourceLanguage: string;
  /** Idiomas a los que se traduce. */
  targetLanguages: string[];
  /** Nombres propios y jerga que el reconocimiento debe escribir bien. */
  glossary: string[];
}

export interface TextUpdate {
  /** Idioma del texto: el original o uno de los destinos. */
  language: string;
  /** Texto nuevo ya definitivo, que no volverá a cambiar. */
  finalText: string;
  /** Texto provisional actual, que sustituye al anterior. */
  partialText: string;
  /** El ponente ha hecho una pausa: la frase actual se puede cerrar. */
  endOfSentence: boolean;
}

export interface TranslationSession {
  stop(): Promise<void>;
}

export interface TranslationProvider {
  start(
    audio: MediaStream,
    options: TranslationOptions,
    onUpdate: (update: TextUpdate) => void,
    onError: (message: string) => void,
  ): Promise<TranslationSession>;
}
