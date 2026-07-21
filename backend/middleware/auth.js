const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const token = header.split(' ')[1];

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