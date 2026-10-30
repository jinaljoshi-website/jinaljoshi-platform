// backend/lib/collectionPreview.js
//
// Buying a look at part of a collection before the whole of it.
//
// ── The price ───────────────────────────────────────────────────────
//
// What the photographs are worth, plus a fifth for breaking the set open.
//
//     per photograph = set price ÷ how many it holds × 1.20
//
// The markup is what makes this safe to offer at any quantity. Every
// photograph bought singly comes to 120% of the set, so buying the set whole
// is always the better deal and there is no way to assemble one cheaply out of
// previews. It also means the comparison is honest at a glance rather than
// something the reader has to work out.
//
// This replaces a flat quarter of the set for one photograph and a third for
// two, which was calibrated for a preview that could only ever be those two
// sizes. On anything but a tiny collection it charged far more than the
// photographs were worth: a quarter of a forty-eight photograph set, for one of
// them.
//
// ── The ceiling ─────────────────────────────────────────────────────
//
// A preview is never charged more than the set it previews. Past about
// five-sixths of the photographs the markup carries the price over the set's
// own, and charging more than the set for less than the set would be a trap
// however clearly it was labelled. Those quantities are still offered, priced
// at the set, and marked so nobody takes one by accident.
//
// ── And it counts ───────────────────────────────────────────────────
//
// Every step credits what came before. Two photographs, then five, then the
// set, paying only the difference each time — so somebody who previews and
// then buys pays the price of the set and not a penny more. A preview that
// added to the total would be a toll for looking, which is a different and
// worse thing.

// A fifth on top, for breaking the set.
const PREVIEW_MARKUP = 1.20;

// The most that may be previewed: one fewer than the set holds.
//
// A collection can never be assembled photograph by photograph — the last one
// only ever comes with the set.
function maxPreviewPhotos(itemCount) {
  return Math.max(0, (Number(itemCount) || 0) - 1);
}

function perPhotoPrice(setPriceCoins, itemCount) {
  const price = Number(setPriceCoins) || 0;
  const count = Math.max(1, Number(itemCount) || 1);
  return (price / count) * PREVIEW_MARKUP;
}

// What a preview of this many photographs costs, before crediting anything
// already paid.
//
// Rounded up to whole tokens, because a token is the smallest thing anybody
// can spend and a price of 74.25 cannot be paid.
function priceFor(photos, setPriceCoins, itemCount) {
  const n        = Math.max(1, Math.floor(Number(photos) || 1));
  const setPrice = Math.ceil(Number(setPriceCoins) || 0);
  return Math.min(setPrice, Math.ceil(perPhotoPrice(setPriceCoins, itemCount) * n));
}

// What is left to pay, given what has been paid already.
function dueFor(photos, setPriceCoins, itemCount, alreadyPaid = 0) {
  const full = photos === 'full'
    ? Math.ceil(Number(setPriceCoins) || 0)
    : priceFor(photos, setPriceCoins, itemCount);
  return Math.max(0, full - Number(alreadyPaid || 0));
}

// Every quantity still available, and the set.
//
// A list rather than a next step, because this fills a dropdown: the member
// chooses how many, sees the price move, and sees the whole set sitting at the
// bottom of the same list for comparison.
//
// Quantities already bought are left out — there is no sense offering three
// photographs to somebody who has five.
function optionsFor({ setPriceCoins, itemCount, preview }) {
  const paid     = preview ? Number(preview.coins_paid) : 0;
  const have     = preview ? Number(preview.level) : 0;
  const max      = maxPreviewPhotos(itemCount);
  const setPrice = Math.ceil(Number(setPriceCoins) || 0);

  const opts = [];
  for (let n = have + 1; n <= max; n++) {
    const price = priceFor(n, setPriceCoins, itemCount);
    opts.push({
      kind: 'preview',
      // level is a count of photographs. It reads as a rung of a ladder
      // because it once was one, and the column keeps the name.
      level: n,
      photos: n,
      price,
      due: Math.max(0, price - paid),
      // At this quantity the whole set costs the same or less for more
      // photographs. The page says so rather than letting somebody find out
      // afterwards.
      setIsBetter: price >= setPrice,
    });
  }

  opts.push({
    kind: 'full',
    photos: Number(itemCount) || 0,
    price: setPrice,
    due: Math.max(0, setPrice - paid),
  });

  return opts.filter((o) => o.due > 0 || o.kind === 'full');
}

module.exports = {
  PREVIEW_MARKUP,
  maxPreviewPhotos,
  perPhotoPrice,
  priceFor,
  dueFor,
  optionsFor,
};