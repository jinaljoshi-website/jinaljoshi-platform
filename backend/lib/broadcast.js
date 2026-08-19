// backend/lib/broadcast.js
//
// One message written once, addressed to each member by name.
//
// A broadcast that opens "Hi there" tells everybody it was sent to everybody,
// and on a platform whose whole proposition is that Jinal is on the other end
// of it, that costs more than it saves. So the message is a template and each
// recipient gets their own copy with their own details filled in.
//
// The placeholders are deliberately few and deliberately plain. Every one is
// something Jinal would actually say in a sentence — a name, a tier, a date —
// rather than a field from a database, and each has a fallback that reads as
// English when the underlying value is missing. A member with no display name
// gets "there", so "Hi {name}" becomes "Hi there" rather than "Hi null".
//
// Nothing here sends anything. It turns one row and one template into one
// string, which makes it testable without a database and impossible to get
// half-sent while experimenting.

const { effectiveMembership, daysRemaining } = require('./membership');

// What may appear in a template, and what each resolves to.
//
// Kept as a list rather than scattered through a switch so the Studio screen
// can offer exactly what exists — a placeholder nobody can discover may as well
// not be there, and one offered but unimplemented is worse.
const FIELDS = [
  { key: 'name',    label: 'First name',        example: 'Rahul' },
  { key: 'tier',    label: 'Membership tier',   example: 'Premium' },
  { key: 'expires', label: 'Membership expiry', example: '14 October 2026' },
  { key: 'days',    label: 'Days remaining',    example: '23' },
  { key: 'tokens',  label: 'Token balance',     example: '48' },
];

// A display name is often a full name, and a message opening with somebody's
// surname reads like a letter from a bank.
function firstName(row) {
  const n = (row.display_name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

function valuesFor(row, now = new Date()) {
  const state = effectiveMembership(row, now);
  const left  = daysRemaining(row, now);

  return {
    name: firstName(row),
    // Guests are members too, and calling somebody a Guest to their face is
    // not the same as recording it in a database.
    tier: state.isActive
      ? state.tier.charAt(0).toUpperCase() + state.tier.slice(1)
      : 'free member',
    expires: row.membership_expires_at
      ? new Date(row.membership_expires_at).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'long', year: 'numeric',
          timeZone: row.timezone || 'Asia/Kolkata',
        })
      : '—',
    days: state.isActive ? String(left) : '0',
    tokens: String(row.coin_balance ?? 0),
  };
}

// Fills a template for one member.
//
// An unknown placeholder is left exactly as written rather than blanked. A typo
// then shows up in the preview as "{naem}" — visible, and obviously wrong —
// instead of vanishing silently and leaving a sentence with a hole in it.
function render(template, row, now = new Date()) {
  const values = valuesFor(row, now);
  return String(template || '').replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole
  );
}

// Which placeholders a template uses, and which of them are not real.
//
// Used by the preview so a mistake is caught before several hundred people
// receive it, which is the one moment where catching it still costs nothing.
function inspect(template) {
  const used = [...String(template || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const known = new Set(FIELDS.map((f) => f.key));
  return {
    used:    [...new Set(used)],
    unknown: [...new Set(used.filter((u) => !known.has(u)))],
  };
}

module.exports = { FIELDS, render, inspect, valuesFor, firstName };