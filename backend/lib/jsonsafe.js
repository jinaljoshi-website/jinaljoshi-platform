// backend/lib/jsonsafe.js
//
// Text on its way into a Postgres json or jsonb column.
//
// Postgres is stricter than JavaScript about what a JSON string may contain,
// and two things it refuses will happily come out of JSON.stringify:
//
//   • a NUL character (\u0000), which Postgres cannot store in json at all
//   • an unpaired surrogate, which is what you get when a string is cut
//     through the middle of an emoji
//
// Either one fails the whole statement with 22P02, "invalid input syntax for
// type json" — and because that insert is usually a side note next to the
// thing the member actually asked for, it takes the real work down with it.
// A DM preview is not worth losing the DM.
//
// This is what went wrong in chat/send: the preview was built with
// `content.slice(0, 80)`, and a message whose 80th UTF-16 unit landed inside an
// emoji produced "…\ud83d" — a lone high surrogate. Valid JSON text to
// JavaScript, rejected by Postgres, and the member's message was rolled back
// and refused. It only bit when an emoji sat exactly on the boundary, which is
// why it looked intermittent.

// A lone high surrogate with no low surrogate after it, or a lone low
// surrogate with no high surrogate before it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Make a string safe to put inside JSON bound for Postgres.
function scrub(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\u0000/g, '')
    .replace(LONE_SURROGATE, '');
}

// Truncate by characters rather than by UTF-16 code units.
//
// Array.from walks a string by code point, so an emoji counts as one character
// and can never be split in half. That is the whole fix: `"🙂".length` is 2 and
// `Array.from("🙂").length` is 1, and it was the former that cut emoji in two.
function clip(value, max) {
  const s = scrub(value);
  if (!Number.isFinite(max) || max <= 0) return s;
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

// Serialise for a json/jsonb column.
//
// `maxChars` is a ceiling on the finished JSON. Note what this does when the
// text is too long: it replaces the value rather than cutting it. Truncating
// JSON text produces something that is no longer JSON — a severed escape or an
// unclosed brace — which is a different way to earn the same 22P02. A marker
// row tells you the data was dropped; a broken row tells you nothing, because
// the insert never happened.
function jsonForPg(value, { maxChars = null } = {}) {
  let text;
  try {
    text = JSON.stringify(value, (_key, v) => (typeof v === 'string' ? scrub(v) : v));
  } catch {
    // Circular, or a BigInt, or anything else stringify refuses.
    return JSON.stringify({ unserialisable: true });
  }
  if (text === undefined) text = 'null';
  if (Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    return JSON.stringify({ truncated: true, chars: text.length });
  }
  return text;
}

module.exports = { clip, scrub, jsonForPg };