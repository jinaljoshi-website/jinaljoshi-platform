// backend/routes/health.js
//
// Whether the thing is actually working, in one request.
//
// ── Why this exists ─────────────────────────────────────────────────
//
// The API went down tonight because a file was committed under the wrong case,
// and it was noticed because somebody happened to be looking. Nothing was
// watching. Railway will say a container crashed, but not that the database
// stopped answering, or that a scheduled job has been failing every night since
// Tuesday — and those are the failures that last, because nothing about them
// looks broken from outside.
//
// ── What "healthy" means here ───────────────────────────────────────
//
// Not that the process is running: a process can run perfectly while refusing
// every query. It means the database answers, and the scheduler has done
// something recently. Anything less is a service that looks alive and is not.
//
// ── Two endpoints, on purpose ───────────────────────────────────────
//
// /health is public and says almost nothing — a word and a status code, which
// is all an uptime checker reads, and all a stranger should learn. /health/full
// requires the artist and says everything, because a summary that omits the
// detail sends somebody to the logs anyway.

const router = require('express').Router();
const pool   = require('../db/pool');

// A job that has not run in this long has stopped, whatever it says.
//
// The most frequent job runs every fifteen seconds and the least frequent twice
// a day, so one threshold cannot fit both. Each says how long is too long for
// itself, generously, so a slow minute is never mistaken for a failure.
const STALE_AFTER_MINUTES = {
  'call-cutoffs':      5,
  'missed-calls':      5,
  'call-reminders':    10,
  'call-no-shows':     10,
  'auctions':          10,
  'membership-expiry': 10,
  'fx-rates':          60 * 26,   // twice daily, so a full day and then some
};

// ─────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────
//
// For an uptime checker, which reads the status code and nothing else.
// Deliberately terse: a public endpoint that lists internals is a public
// endpoint that helps somebody map the service.
router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    // 503 rather than 500: this is not an error in handling the request, it is
    // the service saying it cannot serve. Checkers treat the two differently.
    res.status(503).json({ ok: false });
  }
});

// ─────────────────────────────────────────────
// GET /api/health/full
// ─────────────────────────────────────────────
//
// The whole picture, for somebody who already knows something is wrong.
router.get('/full', async (req, res) => {
  const started = Date.now();
  const out = { ok: true, at: new Date().toISOString(), checks: {} };

  // The database, and how long it took to say so. A query that answers in two
  // seconds is a database in trouble even though it answered.
  try {
    const t0 = Date.now();
    const { rows } = await pool.query('SELECT NOW() AS now');
    out.checks.database = {
      ok: true,
      ms: Date.now() - t0,
      serverTime: rows[0].now,
      slow: Date.now() - t0 > 1000,
    };
  } catch (err) {
    out.ok = false;
    out.checks.database = { ok: false, error: err.message };
  }

  // The scheduler. A job that has not succeeded within its own window has
  // stopped, and stopping is silent — which is the whole reason for this.
  try {
    const { schedulerHealth } = require('../lib/scheduler');
    const jobs = schedulerHealth();
    const reported = Object.keys(jobs);

    out.checks.scheduler = { ok: true, jobs: {} };

    // Nothing reported at all means the scheduler never started, which looks
    // identical to a healthy service that happens to have nothing to do.
    if (reported.length === 0) {
      out.ok = false;
      out.checks.scheduler = { ok: false, error: 'No job has reported since start' };
    } else {
      for (const [name, h] of Object.entries(jobs)) {
        const limit = STALE_AFTER_MINUTES[name] ?? 60;
        const stale = h.minutesSinceOk === null || h.minutesSinceOk > limit;
        if (stale || h.error) {
          out.ok = false;
          out.checks.scheduler.ok = false;
        }
        out.checks.scheduler.jobs[name] = {
          lastOkAt: h.lastOkAt,
          minutesSinceOk: h.minutesSinceOk,
          stale,
          error: h.error,
        };
      }
    }
  } catch (err) {
    out.ok = false;
    out.checks.scheduler = { ok: false, error: err.message };
  }

  // Configuration that has to be present for money to work. Not a health check
  // exactly, but the failure it catches — a variable lost in a redeploy — looks
  // exactly like a healthy service until somebody tries to pay.
  const required = ['DATABASE_URL', 'JWT_SECRET', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL',
                    'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  out.checks.config = { ok: missing.length === 0, missing };
  if (missing.length) out.ok = false;

  out.checks.uptimeSeconds = Math.round(process.uptime());
  out.tookMs = Date.now() - started;

  res.status(out.ok ? 200 : 503).json(out);
});

module.exports = router;