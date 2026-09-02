// backend/scripts/moderation-audit.js
//
// What an automated moderator makes of photographs already published.
//
// This changes nothing. It reads a sample, asks Rekognition what it sees, and
// prints the answer. Nothing is hidden, flagged, deleted or written back.
//
// The question is not "does it catch explicit material" — there is none here to
// catch. It is the opposite: how often does an automated check wrongly object to
// lingerie, swimwear and sheer fabric, which are ordinary fashion photography
// and the substance of this library.
//
// That number decides whether a check at upload is worth having. If nothing
// scores as explicit, it is a strong thing to be able to say and cheap to keep
// running. If a tenth of the library trips it, the check would be a daily
// argument with a machine and worth abandoning.
//
//   node scripts/moderation-audit.js            → 100 photographs
//   node scripts/moderation-audit.js 500        → 500
//   node scripts/moderation-audit.js 500 all    → 500, every category
//
// Costs roughly $1 per 1,000 images.

require('dotenv').config();
const pool = require('../db/pool');
const { RekognitionClient, DetectModerationLabelsCommand } =
  require('@aws-sdk/client-rekognition');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const SAMPLE = parseInt(process.argv[2], 10) || 100;
const SCOPE  = process.argv[3] || 'suggestive';

const client = new RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' });

// Read out of the bucket, not over the web.
//
// The public host sits behind Cloudflare, which refuses anything that does not
// look like a browser — and refuses it with a 404 rather than a 403, so a
// blocked request is indistinguishable from a missing file. Browser headers do
// not help, because the check is on the TLS fingerprint rather than what the
// request claims to be.
//
// Going straight to R2 with the platform's own credentials sidesteps all of it,
// and is what the backend does anyway when it needs the bytes.
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function fetchImage(stored) {
  // What the column holds is not always a key.
  //
  // Some rows carry a bare key like content/abc.jpg and others a whole URL,
  // which is why the platform's own helper starts by asking whether the value
  // begins with http. R2 wants the key alone, so anything that arrives as a URL
  // has its host stripped back off.
  const key = stored.startsWith('http')
    ? new URL(stored).pathname.replace(/^\//, '')
    : stored;

  const out = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }));
  const chunks = [];
  for await (const c of out.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  // Rekognition takes 5MB inline; anything larger would need staging in S3,
  // which is not worth the setup for an audit.
  if (buf.length > 5 * 1024 * 1024) throw new Error(`over 5MB (${(buf.length/1048576).toFixed(1)}MB)`);
  return buf;
}

(async () => {
  for (const k of ['R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!process.env[k]) throw new Error(`${k} is not set`);
  }

  // Weighted towards the sets most likely to trip a moderator, because a clean
  // result on landscape photographs would prove nothing.
  // Everything, rather than whatever the titles happen to mention.
  //
  // The scope was matched on words in a set's name, which finds "Blue Pool &
  // Green Bikini" and misses "To Err is Human" — and a sample that quietly
  // excludes the sets nobody thought to name descriptively is not a sample of
  // anything. At a rupee for eleven photographs there is no reason to choose.
  const where = `s.visible = TRUE`;

  const { rows } = await pool.query(
    `SELECT i.id, i.r2_key, s.title AS set_title, s.is_collection
       FROM set_items i JOIN sets s ON s.id = i.set_id
      WHERE ${where} AND i.media_type <> 'video'
      ORDER BY random()
      LIMIT $1`,
    [SAMPLE]
  );

  console.log(`\nChecking ${rows.length} photographs in ${process.env.AWS_REGION || 'ap-south-1'}`);
  console.log('Scope: every published photograph\n');

  const labelCounts = new Map();   // label → [confidences]
  const flagged = [];              // anything Rekognition calls Explicit
  let checked = 0, failed = 0;

  for (const r of rows) {
    try {
      const bytes = await fetchImage(r.r2_key);
      const out = await client.send(new DetectModerationLabelsCommand({
        Image: { Bytes: bytes },
        // Low, deliberately. The point is to see the whole distribution and
        // choose a threshold from it, not to accept one chosen in advance.
        MinConfidence: 40,
      }));

      const labels = out.ModerationLabels || [];
      for (const l of labels) {
        const key = `${l.ParentName ? l.ParentName + ' / ' : ''}${l.Name}`;
        if (!labelCounts.has(key)) labelCounts.set(key, []);
        labelCounts.get(key).push(l.Confidence);
      }

      // The top-level category is what a policy would actually act on.
      const explicit = labels.filter((l) =>
        (l.TaxonomyLevel === 1 && l.Name === 'Explicit') ||
        ['Explicit Nudity', 'Explicit Sexual Activity'].includes(l.Name));
      if (explicit.length) {
        flagged.push({
          set: r.set_title,
          key: r.r2_key,
          top: Math.max(...explicit.map((l) => l.Confidence)),
          labels: explicit.map((l) => `${l.Name} ${l.Confidence.toFixed(0)}%`).join(', '),
        });
      }

      checked += 1;
      if (checked % 25 === 0) process.stdout.write(`  ${checked}…\n`);
    } catch (err) {
      failed += 1;
      // The first few reasons, in full. Twenty silent failures taught nobody
      // anything, and a wrong base URL looks exactly like a wrong key.
      if (failed <= 3) {
        console.log(`  could not read ${r.r2_key}`);
        console.log(`    ${err.name || ''} ${err.message}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`Checked ${checked}, could not read ${failed}\n`);

  console.log('EVERY LABEL THAT FIRED, most common first\n');
  console.log('  ' + 'label'.padEnd(64) + 'count'.padStart(6) + 'avg'.padStart(7) + 'max'.padStart(7));
  const sorted = [...labelCounts.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [label, confs] of sorted) {
    const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
    const max = Math.max(...confs);
    console.log('  ' + label.padEnd(64) +
                String(confs.length).padStart(6) +
                `${avg.toFixed(0)}%`.padStart(7) +
                `${max.toFixed(0)}%`.padStart(7));
  }

  console.log(`\n${'─'.repeat(64)}`);

  // What a policy would actually do, at each plausible line.
  //
  // A single count is misleading, because it treats a 47% guess as though it
  // meant the same as a 96% one. Amazon's own guidance is that anything below
  // 50% returns a high rate of false positives, and a real gate sits at 80 or
  // above. Showing the whole curve lets the threshold be chosen from evidence
  // rather than argued about.
  if (checked) {
    console.log('\nWHAT WOULD BE BLOCKED, AT EACH THRESHOLD\n');
    console.log('  threshold   blocked   of checked');
    for (const t of [50, 60, 70, 80, 90, 95]) {
      const n = flagged.filter((f) => f.top >= t).length;
      console.log(`  ${String(t).padStart(6)}%   ${String(n).padStart(7)}   ${((n / checked) * 100).toFixed(1)}%`);
    }
    console.log('');
  }

  if (!checked) {
    console.log('\nNothing was checked, so this proves nothing.\n');
    console.log('Every image failed to download. The likeliest cause is the base');
    console.log('URL: R2_PUBLIC_URL must be the host that actually serves the');
    console.log('photographs. Try opening one of the paths printed above under');
    console.log('that host in a browser and see what comes back.\n');
  } else if (!flagged.filter((f) => f.top >= 80).length) {
    console.log(`\nNothing among the ${checked} checked would be blocked at 80%.\n`);
    if (flagged.length) {
      console.log(`${flagged.length} scored above 40%, the highest at ${Math.max(...flagged.map((f) => f.top)).toFixed(0)}%.`);
      console.log('Below 50% the model is guessing, by Amazon\'s own account, and');
      console.log('these sit among photographs it labelled with 90% confidence when');
      console.log('it was sure. Worth knowing they exist; not worth acting on.\n');
    }
    console.log('That is the result worth having: an automated check at upload would');
    console.log('have passed every one of these, so it can be added without becoming');
    console.log('an argument with a machine.\n');
  } else {
    const real = flagged.filter((f) => f.top >= 80).sort((a, b) => b.top - a.top);
    console.log(`\n${real.length} of ${checked} would be blocked at 80%:\n`);
    for (const f of real) {
      console.log(`  set:    ${f.set}`);
      console.log(`    ${f.labels}`);
      console.log(`    ${f.key}\n`);
    }
    console.log('Worth looking at each of these yourself before deciding anything.');
    console.log('A classifier objecting is not the same as it being right.\n');
  }

  await pool.end();
})().catch((err) => {
  // Said properly. An empty message tells nobody anything, and the errors that
  // arrive here are usually a missing credential or an unreachable database,
  // both of which name themselves if asked.
  console.error('\nAudit failed.');
  console.error('  name:   ', err.name || '(none)');
  console.error('  message:', err.message || '(empty)');
  if (err.$metadata)  console.error('  aws:    ', JSON.stringify(err.$metadata));
  if (err.code)       console.error('  code:   ', err.code);
  if (process.env.DEBUG) console.error(err);
  console.error('\nWhat is set:');
  for (const k of ['AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','R2_PUBLIC_URL','DATABASE_URL']) {
    console.error(`  ${k.padEnd(22)} ${process.env[k] ? 'set' : 'MISSING'}`);
  }
  process.exit(1);
});