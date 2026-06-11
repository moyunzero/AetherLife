/**
 * Computes a deterministic 32-bit unsigned hash of a string compatible with Python's `stable_string_hash`.
 *
 * @param s - The input string to hash (processed as UTF-16 code units)
 * @returns The 32-bit unsigned hash of `s`
 */
export function stableStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
