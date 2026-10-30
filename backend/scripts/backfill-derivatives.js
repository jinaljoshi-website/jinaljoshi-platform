#!/usr/bin/env node
//
// backend/scripts/backfill-derivatives.js
//
// Make a thumbnail and a blurred placeholder for every photograph already in
// the library. Run once.
//
//   railway run node scripts/backfill-derivatives.js
//
// Options:
//   --limit N     stop after N items (try --limit 20 first)
//   --concurrency N   how many at a time (default 4)
//   --redo        remake derivatives for rows that already have them
//   --dry         report what would be done and change nothing
//
// ── Why this runs here and not in a browser ─────────────────────────
//
// The set cover's blur is made in the Studio page, by reading the pixels into
// a canvas. Doing 16,000 photographs that way would mean pulling every
// full-resolution original down through one laptop — tens of gigabytes, hours
// of it, and a closed tab losing the lot. Running inside Railway, next to the
// bucket, it is unattended and costs no bandwidth of yours.
//
// ── Safe to stop and restart ────────────────────────────────────────
//
// Progress lives in the rows themselves: anything with a thumbnail already is
// skipped. Interrupt it, run it again, and it carries on from where it was.

const pool = require('../db/pool');
const { deriveItem } = require('../lib/imagederive');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const LIMIT       = value('limit', Infinity);
const CONCURRENCY = Math.max(1, value('concurrency', 4));
const REDO        = flag('redo');
const DRY         = flag('dry');

const kb = (b) => (b / 1024).toFixed(1) + 'KB';

async function main() {
  const { rows } = await pool.query(
    `SELECT i.id, i.r2_key, i.media_type, s.title
       FROM set_items i
       JOIN sets s ON s.id = i.set_id
      WHERE i.r2_key IS NOT NULL
        AND COALESCE(i.media_type, 'image') <> 'video'
        ${REDO ? '' : 'AND i.thumb_key IS NULL'}
      ORDER BY i.created_at ASC`
  );

  const todo = rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT);

  console.log(`${rows.length} photographs need derivatives${REDO ? ' (redoing everything)' : ''}.`);
  if (todo.length !== rows.length) console.log(`Doing ${todo.length} of them this run.`);
  if (DRY) {
    console.log('Dry run — nothing will be written.');
    for (const r of todo.slice(0, 10)) console.log(`  would do ${r.id}  ${r.r2_key}`);
    if (todo.length > 10) console.log(`  …and ${todo.length - 10} more`);
    await pool.end();
    return;
  }
  if (!todo.length) { await pool.end(); return; }

  let done = 0, failed = 0, srcTotal = 0, outTotal = 0;
  const started = Date.now();
  const failures = [];

  // A few at a time. Enough to keep the network busy, few enough that several
  // full-resolution decodes are never in memory at once.
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const item = todo[i];
      try {
        const out = await deriveItem(item.id, item.r2_key, item.media_type);
        if (out) {
          done++;
          srcTotal += out.sourceBytes;
          outTotal += out.thumbBytes + out.blurBytes;
        }
      } catch (err) {
        failed++;
        failures.push({ id: item.id, key: item.r2_key, title: item.title, why: err.message });
      }

      const seen = done + failed;
      if (seen % 50 === 0 || seen === todo.length) {
        const secs = (Date.now() - started) / 1000;
        const rate = seen / Math.max(secs, 0.001);
        const left = Math.round((todo.length - seen) / Math.max(rate, 0.001));
        console.log(
          `  ${String(seen).padStart(6)} / ${todo.length}` +
          `   ${failed} failed` +
          `   ${rate.toFixed(1)}/s` +
          `   about ${Math.floor(left / 60)}m ${left % 60}s left`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const secs = Math.round((Date.now() - started) / 1000);
  console.log('');
  console.log(`Done in ${Math.floor(secs / 60)}m ${secs % 60}s.`);
  console.log(`  ${done} derived, ${failed} failed`);
  if (done) {
    console.log(`  read ${kb(srcTotal)} of originals, wrote ${kb(outTotal)} of derivatives` +
                `  (${(100 * outTotal / srcTotal).toFixed(1)}% of the size)`);
  }

  if (failures.length) {
    console.log('');
    console.log('These need a look:');
    for (const f of failures.slice(0, 25)) {
      console.log(`  ${f.id}  ${f.title || ''}`);
      console.log(`     ${f.key}`);
      console.log(`     ${f.why}`);
    }
    if (failures.length > 25) console.log(`  …and ${failures.length - 25} more`);
    console.log('');
    console.log('Run the script again to retry only these — anything that worked is skipped.');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('backfill failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});