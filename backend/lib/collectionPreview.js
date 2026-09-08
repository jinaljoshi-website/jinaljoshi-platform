// backend/lib/collectionPreview.js
//
// Buying a look at one or two photographs before the whole set.
//
// ── The price ───────────────────────────────────────────────────────
//
// A quarter of the set for one photograph, a third and a bit for two — or what
// the photographs are actually worth if that is more.
//
// The second half of that rule is what makes it fair on a small set. A
// collection of three photographs at three hundred tokens is a hundred each; a
// flat quarter would sell one of the three for seventy-five, which is less than
// it is worth. Whichever is higher means a preview never undercuts the set it
// is previewing.
//
// ── And it counts ───────────────────────────────────────────────────
//
// Every step credits what came before. One photograph, then a second, then the
// set, paying only the difference each time — so somebody who previews and then
// buys pays the price of the set and not a penny more. A preview that added to
// the total would be a toll for looking, which is a different and worse thing.

const ONE_PHOTO_FRACTION = 0.25;
const TWO_PHOTO_FRACTION = 0.35;

// What a preview costs, before crediting anything already paid.
//
// Rounded up to whole tokens, because a token is the smallest thing anybody can
// spend and a price of 74.25 cannot be paid.
function priceFor(level, setPriceCoins, itemCount) {
  const price = Number(setPriceCoins) || 0;
  const count = Math.max(1, Number(itemCount) || 1);
  const perPhoto = price / count;
  const photos = level === 2 ? 2 : 1;
  const fraction = level === 2 ? TWO_PHOTO_FRACTION : ONE_PHOTO_FRACTION;

  const byFraction = price * fraction;
  const byPhotos   = perPhoto * photos;

  // Never more than the set itself. On a collection of two photographs, two
  // previews are the whole thing, and charging more than the set for it would
  // be absurd.
  return Math.min(price, Math.ceil(Math.max(byFraction, byPhotos)));
}

// What is left to pay, given what has been paid already.
function dueFor(level, setPriceCoins, itemCount, alreadyPaid = 0) {
  const full = level === 'full' ? Math.ceil(Number(setPriceCoins) || 0)
                                : priceFor(level, setPriceCoins, itemCount);
  return Math.max(0, full - Number(alreadyPaid || 0));
}

// What can be bought next, and for how much.
//
// Returned as a list rather than a single next step, because after one
// photograph the useful question is "a second, or all of them?" and both should
// be on the screen at once.
function optionsFor({ setPriceCoins, itemCount, preview }) {
  const paid = preview ? Number(preview.coins_paid) : 0;
  const level = preview ? Number(preview.level) : 0;
  const opts = [];

  if (level < 1 && itemCount > 1) {
    opts.push({ kind: 'preview', level: 1, photos: 1,
                due: dueFor(1, setPriceCoins, itemCount, paid) });
  }
  // Only where a second photograph is not simply the rest of the set.
  if (level < 2 && itemCount > 2) {
    opts.push({ kind: 'preview', level: 2, photos: 2,
                due: dueFor(2, setPriceCoins, itemCount, paid) });
  }
  opts.push({ kind: 'full', due: dueFor('full', setPriceCoins, itemCount, paid) });

  return opts.filter((o) => o.due > 0 || o.kind === 'full');
}

module.exports = { ONE_PHOTO_FRACTION, TWO_PHOTO_FRACTION, priceFor, dueFor, optionsFor };