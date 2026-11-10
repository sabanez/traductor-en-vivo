import type { GlossaryEntry } from '../../shared/protocol';

/**
 * Un término por línea, con explicación opcional tras dos puntos:
 *   Labolife: laboratorio que organiza la presentación
 *   micro-inmunoterapia
 * Una sola línea con comas y sin explicaciones se toma como lista de términos.
 */
export function parseGlossary(text: string): GlossaryEntry[] {
  const lines = text.includes('\n') || text.includes(':') ? text.split('\n') : text.split(',');
  return lines
    .map((line) => {
      const separator = line.indexOf(':');
      const term = (separator === -1 ? line : line.slice(0, separator)).trim();
      const definition = separator === -1 ? '' : line.slice(separator + 1).trim();
      return { term, definition };
    })
    .filter((entry) => entry.term);
}
