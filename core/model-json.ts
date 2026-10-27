/** Reads the JSON object a model wrote in reply. Models wrap it in code fences or a sentence, and inside strings
 *  they often put a raw line break or tab ("Bad control character in string literal") or a lone backslash from
 *  LaTeX such as \alpha or \sum ("Bad escaped character"). Those are mended inside strings only, so the text
 *  means what the model meant; anything else that is broken still throws. */

// After a backslash, a letter run that is a LaTeX command rather than a JSON escape. \f and \b are never wanted in a
// document (form feed, backspace), so \frac, \beta, \bar… keep their backslash; \n, \t and \r stay escapes unless the
// word is a common command (\nabla, \theta, \rho…), because "\nThe" is a new line far more often than a command.
const LATEX = /^(?:f[a-z]|b[a-z]|n(?:abla|eq|eg|u|leq|geq|subset|exists|parallel|ewline)\b|t(?:heta|au|imes|ext|frac|o|ilde|op|riangle|herefore)\b|r(?:ho|ight|angle|ceil|floor|ightarrow|m)\b)/;

/** Escapes what JSON does not allow inside strings, leaving everything outside strings alone. */
export function mendJsonStrings(text: string, { quotes = false } = {}) {
  let out = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) { out += c; if (c === '"') inString = true; continue; }
    // With `quotes`, a quote ends the string only where JSON could go on after it; any other is a quote in the text
    // ("the "inconclusive" case") that the model forgot to escape.
    if (c === '"' && quotes && !closes(text, i + 1)) { out += '\\"'; continue; }
    if (c === '"') { out += c; inString = false; continue; }
    if (c === '\\') {
      const next = text[i + 1] ?? '';
      if (/[bfnrt]/.test(next) && LATEX.test(text.slice(i + 1, i + 14))) { out += '\\\\'; continue; }
      if (/["\\/bfnrt]/.test(next)) { out += c + next; i++; continue; }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += c + next; i++; continue; }
      out += '\\\\'; continue; // a lone backslash: keep it as a character
    }
    const code = c.charCodeAt(0);
    if (code < 0x20) out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : '\\u' + code.toString(16).padStart(4, '0');
    else out += c;
  }
  return out;
}

/** Whether what follows a quote is what can follow the end of a JSON string: , : } ] or the end. After a comma, the next
 *  thing must start a value or key, so "a "b", c" keeps its inner quotes as text. */
function closes(text: string, at: number) {
  const rest = /^\s*([\s\S]?)/.exec(text.slice(at, at + 200))!, c = rest[1];
  if (c === '' || c === '}' || c === ']' || c === ':') return true;
  if (c !== ',') return false;
  return /^\s*,\s*(?:["{[\]}\d-]|true|false|null)/.test(text.slice(at, at + 200));
}

/** The outermost {…} (or […]) of a model's reply, parsed, mending strings when the plain parse fails or would turn LaTeX into
 *  control characters. */
export function parseModelJson<T = any>(raw: string, missing = 'The reply held no JSON.'): T {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // An object, or a list when the reply is one (calculation checks are lists); a [ in a sentence before the object
  // ("see [1]") does not count.
  const brace = text.indexOf('{'), bracket = text.indexOf('[');
  const spans = [[brace, text.lastIndexOf('}')], [bracket, text.lastIndexOf(']')]].filter(([s, e]) => s >= 0 && e > s);
  if (!spans.length) throw Error(missing);
  if (spans.length > 1 && text.startsWith('[')) spans.reverse();
  let failure: unknown;
  for (const [start, end] of spans) { try { return readBody(text.slice(start, end + 1)); } catch (error) { failure ??= error; } }
  throw failure;
}

function readBody(body: string) {
  // A strict parse would accept "\frac" as a form feed followed by "rac", so mend first whenever such an escape is there.
  if (!/\\[bfnrt]/.test(body)) { try { return JSON.parse(body); } catch { /* mend below */ } }
  try { return JSON.parse(mendJsonStrings(body)); }
  catch (error) {
    // Last, quotes the model left unescaped inside strings; the first error is kept when even that does not help.
    try { return JSON.parse(mendJsonStrings(body, { quotes: true })); } catch { throw error; }
  }
}
