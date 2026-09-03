const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// Reads a cookie by name without a parser dependency.
function cookieValue(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

module.exports = async (req, res, next) => {
  // The header first, then the cookie.
  //
  // Personal Space keeps its token in localStorage and sends it as a bearer
  // header, and that is untouched: changing it would sign everybody out to fix
  // something that is not broken.
  //
  // The shop is a different origin and cannot read that localStorage, so login
  // is also carried by a cookie scoped to the whole of jinaljoshi.in. One sign
  // in, both sites, and the same session either way.
  const header = req.headers.authorization;
  const token = (header && header.startsWith('Bearer '))
    ? header.split(' ')[1]
    : cookieValue(req, 'jj_session');

  if (!token) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Checks whether THIS specific session still exists, rather than comparing against
    // a single row — works correctly whether the account has exactly one active session
    // (fans) or several at once (Jinal's multi-device access).
    const { rows } = await pool.query(
      'SELECT 1 FROM active_sessions WHERE user_id = $1 AND session_id = $2',
      [decoded.userId, decoded.sessionId]
    );

    if (!rows.length) {
      return res.status(401).json({
        error: 'SESSION_EXPIRED',
        message: 'You were signed in on another device.'
      });
    }

    await pool.query(
      'UPDATE active_sessions SET last_seen_at = NOW() WHERE user_id = $1 AND session_id = $2',
      [decoded.userId, decoded.sessionId]
    );

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid login token' });
  }
};