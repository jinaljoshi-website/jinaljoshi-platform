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

// Calendar-anniversary arithmetic. Buying on the 5th runs to the 4th of the
// following month, whatever that month's length. A member who joins on the 31st
// is clamped to the last day of the target month rather than overflowing —
// JavaScript's setMonth turns 31 Jan into 3 Mar, which would quietly hand
// month-end joiners extra days on every single renewal.
function addMonthsClamped(date, months) {
  const d         = new Date(date);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return d;
}

// Monthly allowances run on the member's OWN anniversary, never the calendar
// month. Someone who joined on the 5th gets a fresh allowance on the 5th, and
// nothing resets on the 1st for anybody. Keying on the calendar month meant a
// member who joined on the 31st received two full allowances within 24 hours.
//
// Guests have no membership, so they fall back to a calendar bucket — that row
// only tracks daily counters, and no entitlement hangs off it.
// `at` answers the same question about a past moment rather than about now,
// which is how the renewal gift is dated: a renewal grants extra free calls
// "next month", and the only way to know whether a renewal falls in the period
// before this one is to ask which period it landed in. Defaults to now, so
// every existing caller is unaffected.
function getAllotmentPeriodKey(membershipStartedAt, at) {
  if (!membershipStartedAt) return new Date().toISOString().slice(0, 7);
  const start = new Date(membershipStartedAt);
  const now   = at ? new Date(at) : new Date();
  let periods = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  // Step back if this month's anniversary has not arrived yet, using the same
  // clamping rule as expiry so month-end joiners line up exactly.
  if (periods > 0 && now < addMonthsClamped(start, periods)) periods -= 1;
  if (periods < 0) periods = 0;
  return `${start.toISOString().slice(0, 10)}#${periods}`;
}

module.exports = { getLocalDateStr, addMonthsClamped, getAllotmentPeriodKey };