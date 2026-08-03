// backend/routes/selfies.js
// Selfie of the Day.
//
// Access comes from one of three places: the fan's tier includes it, they hold a
// pass whose window contains that selfie's date, or they unlocked that one
// selfie individually. Single unlocks are permanent — they were bought outright,
// not rented.

const router  = require('express').Router();
const pool    = require('../db/pool');
const authMid = require('../middleware/auth');
const { getConfigNumber, getConfigValue, getGuestMultiplier } = require('../lib/config');
const { spendTokens } = require('../lib/tokens');
const { roundTokensUp } = require('../lib/pricing');
const { assertNotBlocked } = require('../lib/moderation');

async function loadViewer(client, userId) {
  const { rows } = await client.query(
    `SELECT tier, membership_expires_at, coin_balance FROM users WHERE id = $1`, [userId]
  );
  const u = rows[0];
  const isActive = u?.membership_expires_at && new Date(u.membership_expires_at) > new Date();
  return { user: u, tier: isActive ? u.tier : 'guest', isGuest: !isActive };
}

// Which tiers see selfies without paying. Stored as a comma-separated list so
// adding Premium later is a config change rather than a deploy.
async function tierIncludesSelfies(tier) {
  const raw = (await getConfigValue('selfie_free_tiers')) || '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(tier);
}

async function priceFor(key, isGuest) {
  const base = await getConfigNumber(key);
  if (!isGuest) return base;
  return roundTokensUp(base * (await getGuestMultiplier()));
}

// ─────────────────────────────────────────────
// GET /api/selfies
// ─────────────────────────────────────────────

router.get('/', authMid, async (req, res) => {
  try {
    const { tier, isGuest } = await loadViewer(pool, req.user.userId);
    const includedInTier = await tierIncludesSelfies(tier);

    const [selfies, unlocks, passes, unlockCost, passCost, passPosts, latest] = await Promise.all([
      pool.query(
        `SELECT id, image_key, caption, selfie_date, seq FROM daily_selfies
         WHERE visible = TRUE ORDER BY seq DESC LIMIT 90`
      ),
      pool.query(`SELECT selfie_id FROM selfie_unlocks WHERE user_id = $1`, [req.user.userId]),
      pool.query(
        `SELECT from_seq, to_seq, posts_covered FROM selfie_passes
         WHERE user_id = $1 ORDER BY to_seq DESC`,
        [req.user.userId]
      ),
      priceFor('selfie_unlock_cost', isGuest),
      priceFor('selfie_pass_cost', isGuest),
      getConfigNumber('selfie_pass_posts'),
      pool.query(`SELECT COALESCE(MAX(seq), 0)::int AS n FROM daily_selfies WHERE visible = TRUE`),
    ]);

    const unlocked = new Set(unlocks.rows.map((r) => r.selfie_id));
    const coveredByPass = (seq) => passes.rows.some((p) => seq >= p.from_seq && seq <= p.to_seq);

    const items = selfies.rows.map((s) => {
      const open = includedInTier || unlocked.has(s.id) || coveredByPass(s.seq);
      return {
        id: s.id,
        date: s.selfie_date,
        caption: s.caption,
        // The image is only sent when it has been paid for. A locked selfie
        // returns no URL at all, so it cannot be read out of the response.
        imageUrl: open ? s.image_key : null,
        unlocked: open,
        reason: !open ? null : includedInTier ? 'membership' : unlocked.has(s.id) ? 'unlocked' : 'pass',
      };
    });

    // A pass runs until its posts are used up, however long that takes — so what
    // matters to the fan is how many are left, not a date.
    const active = passes.rows.find((p) => latest.rows[0].n < p.to_seq) || null;
    res.json({
      items,
      includedInTier,
      unlockCost, passCost, passPosts,
      activePass: active
        ? { remaining: Math.max(0, active.to_seq - Math.max(active.from_seq - 1, latest.rows[0].n)), covers: active.posts_covered }
        : null,
      isGuest,
    });
  } catch (err) {
    console.error('selfies/list error:', err);
    res.status(500).json({ error: 'Could not load selfies' });
  }
});

// ─────────────────────────────────────────────
// POST /api/selfies/:id/unlock
// ─────────────────────────────────────────────

router.post('/:id/unlock', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await assertNotBlocked(req.user.userId);
  } catch (err) {
    client.release();
    return res.status(403).json({ error: err.code || 'RESTRICTED', message: err.message });
  }

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, image_key, selfie_date, seq FROM daily_selfies WHERE id = $1 AND visible = TRUE`,
      [req.params.id]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const selfie = rows[0];

    const { tier, isGuest } = await loadViewer(client, req.user.userId);
    if (await tierIncludesSelfies(tier)) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, alreadyOpen: true, imageUrl: selfie.image_key });
    }

    // Nothing is charged twice — an existing unlock or a covering pass short-circuits.
    const { rows: had } = await client.query(
      `SELECT 1 FROM selfie_unlocks WHERE user_id = $1 AND selfie_id = $2`,
      [req.user.userId, selfie.id]
    );
    const { rows: covered } = await client.query(
      `SELECT 1 FROM selfie_passes WHERE user_id = $1 AND $2 BETWEEN from_seq AND to_seq`,
      [req.user.userId, selfie.seq]
    );
    if (had.length || covered.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, alreadyOpen: true, imageUrl: selfie.image_key });
    }

    const cost = await priceFor('selfie_unlock_cost', isGuest);
    let spend;
    try {
      // Content, so gifted tokens are allowed.
      spend = await spendTokens(client, {
        userId: req.user.userId, amount: cost, type: 'content_unlock',
        label: `Selfie · ${new Date(selfie.selfie_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        relatedId: selfie.id, allowGifted: true,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') { await client.query('ROLLBACK'); return res.status(402).json(err.httpBody); }
      throw err;
    }

    await client.query(
      `INSERT INTO selfie_unlocks (user_id, selfie_id, coin_ledger_id) VALUES ($1, $2, $3)`,
      [req.user.userId, selfie.id, spend.ledgerId]
    );
    await client.query('COMMIT');
    res.json({ ok: true, imageUrl: selfie.image_key, charged: cost });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('selfies/unlock error:', err);
    res.status(500).json({ error: 'Could not unlock' });
  } finally { client.release(); }
});

// ─────────────────────────────────────────────
// POST /api/selfies/pass
// ─────────────────────────────────────────────

router.post('/pass', authMid, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { tier, isGuest } = await loadViewer(client, req.user.userId);

    if (await tierIncludesSelfies(tier)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ALREADY_INCLUDED', message: 'Selfies are already part of your membership.' });
    }

    const { rows: latestRow } = await client.query(
      `SELECT COALESCE(MAX(seq), 0)::int AS n FROM daily_selfies WHERE visible = TRUE`
    );
    const latest = latestRow[0].n;

    // A second pass while one still has posts left would buy nothing.
    const { rows: existing } = await client.query(
      `SELECT to_seq FROM selfie_passes WHERE user_id = $1 AND to_seq > $2 ORDER BY to_seq DESC LIMIT 1`,
      [req.user.userId, latest]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'PASS_ACTIVE',
        message: `Your pass still has ${existing[0].to_seq - latest} selfie${existing[0].to_seq - latest === 1 ? '' : 's'} to run.`,
      });
    }

    const cost  = await priceFor('selfie_pass_cost', isGuest);
    const posts = (await getConfigNumber('selfie_pass_posts')) || 30;

    let spend;
    try {
      spend = await spendTokens(client, {
        userId: req.user.userId, amount: cost, type: 'content_unlock',
        label: `Selfie pass · ${posts} selfies`, allowGifted: true,
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') { await client.query('ROLLBACK'); return res.status(402).json(err.httpBody); }
      throw err;
    }

    // Starts at the most recent selfie rather than the next one, so buying a pass
    // opens something immediately instead of leaving the fan waiting for
    // tomorrow. The range is fixed now, so changing selfie_pass_posts later
    // cannot shorten what somebody already bought.
    const fromSeq = Math.max(1, latest);
    const { rows } = await client.query(
      `INSERT INTO selfie_passes (user_id, from_seq, to_seq, posts_covered, coin_ledger_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING from_seq, to_seq`,
      [req.user.userId, fromSeq, fromSeq + posts - 1, posts, spend.ledgerId]
    );
    await client.query('COMMIT');
    res.json({ ok: true, covers: posts, charged: cost });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('selfies/pass error:', err);
    res.status(500).json({ error: 'Could not buy the pass' });
  } finally { client.release(); }
});

module.exports = router;