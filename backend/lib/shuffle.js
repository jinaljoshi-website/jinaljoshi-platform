// backend/lib/shuffle.js
//
// A set reads differently each time it is opened.
//
// The order is not random per request — it is random per *viewing*, which is a
// different thing and the distinction is the whole design. A gallery refetches:
// after an unlock, on navigating back, when a poll comes round. If the order
// were rolled fresh each time, the photos would rearrange under somebody
// mid-scroll and whatever they were looking at would jump elsewhere. That reads
// as a fault, not as variety.
//
// So the client makes a seed when it opens a set and sends the same one with
// every request until it closes. Same seed, same order — refetching is stable.
// Open it again tomorrow, new seed, new order.
//
// Nothing is stored. The seed lives in the browser for as long as the set is
// open and is never written down, which is right for something whose only job
// is to be different next time.

// A small, fast, well-distributed string hash. Not for anything that matters
// cryptographically — this decides which photograph comes third.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Fisher–Yates, driven by a counter fed through the same hash, so the shuffle
// is uniform and depends only on the seed and the ids. Two people with
// different seeds see different orders; the same person with the same seed sees
// the same one however many times the page asks.
function shuffleSeeded(arr, seed) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash(`${seed}:${i}`) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Shuffles within tier bands rather than across them.
//
// A set is arranged in Studio and that arrangement means something: the bands
// are what a membership opens, and mixing them would make a set look like it
// had been reordered rather than shuffled. So each band is shuffled in place
// and the bands stay where they were.
//
// The cover is pinned first wherever it lands. It is chosen deliberately, it is
// the image the blurred preview showed, and it is what drew somebody in — so it
// should not wander into the middle of the set on the second visit.
function shuffleWithinBands(items, seed, { coverKey = null } = {}) {
  if (!seed || items.length < 2) return items;

  const bands = [];
  const index = new Map();
  for (const item of items) {
    const band = item.tier_category || 'none';
    if (!index.has(band)) { index.set(band, bands.length); bands.push([]); }
    bands[index.get(band)].push(item);
  }

  const out = bands.flatMap((band, n) => shuffleSeeded(band, `${seed}:${n}`));

  if (coverKey) {
    const at = out.findIndex((i) => i.r2_key === coverKey);
    if (at > 0) out.unshift(out.splice(at, 1)[0]);
  }
  return out;
}

module.exports = { shuffleWithinBands, shuffleSeeded };