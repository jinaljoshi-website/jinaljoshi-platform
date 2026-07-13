// backend/lib/time.js
// Computes "today" in a specific user's local timezone, rather than server UTC —
// so daily limits (chat messages, community posts) reset at each fan's own midnight.

function getLocalDateStr(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10); // fallback for an invalid/missing timezone string
  }
}

module.exports = { getLocalDateStr };