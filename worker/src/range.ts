/**
 * One byte range of a `Range` header (RFC 9110, 14.2), for the reader's media route (TEMPRA-164:
 * a video seeks by asking for ranges). Free of Worker APIs.
 *
 * - `null`: serve the whole thing (no header, another unit, several ranges, or a header that
 *   does not parse, which a server may ignore);
 * - `"unsatisfiable"`: a 416, every range starting at or past the end;
 * - else the first and last byte, both inclusive, clamped to the size.
 */
export function byteRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    // The last `b` bytes.
    const n = Number(b);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (b !== "" && Number(b) < start) return null;
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Number(b);
  return { start, end: Math.min(end, size - 1) };
}
