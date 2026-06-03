// Per-target escaping helpers. The two targets need different quoting:
//  - shell (curl / wscat): POSIX single-quote wrapping
//  - JS (fetch): a JS string literal

/** POSIX single-quote a string: wrap in '…' and rewrite each embedded ' as '\''.
 *  Safe for arbitrary content (spaces, double quotes, $, backticks, newlines). */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A JS string literal — JSON.stringify handles quotes, backslashes, newlines, unicode. */
export function jsString(s: string): string {
  return JSON.stringify(s);
}
