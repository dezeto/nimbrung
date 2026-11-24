// Matching what's typed against song titles the way a guest expects: "beyonce"
// finds "Beyoncé", "LOVE" finds "love". Folding drops accents, so the folded
// text can be shorter than the original; the map keeps each folded character
// pointing back at where it came from, to mark the right letters.

/** Lower case, accents off: "Beyoncé" → "beyonce". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Where `query` appears in `text`, ignoring case and accents, as [start, end)
 * indexes into `text` itself; undefined when it doesn't.
 */
export function findMatch(text: string, query: string): [number, number] | undefined {
  const needle = fold(query.trim());
  if (!needle) return undefined;
  let folded = "";
  const from: number[] = []; // folded index → start of its character in text
  const to: number[] = []; // folded index → end of its character in text
  let i = 0;
  for (const char of text) {
    const part = fold(char);
    for (let k = 0; k < part.length; k++) {
      from.push(i);
      to.push(i + char.length);
    }
    folded += part;
    i += char.length;
  }
  const at = folded.indexOf(needle);
  if (at < 0) return undefined;
  return [from[at], to[at + needle.length - 1]];
}

/** True when `query` appears in any of `texts`, ignoring case and accents. */
export function matchesAny(texts: (string | undefined)[], query: string): boolean {
  const needle = fold(query.trim());
  return !needle || texts.some((text) => text && fold(text).includes(needle));
}
