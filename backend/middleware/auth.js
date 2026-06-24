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

    const { rows } = await pool.query(
      'SELECT session_id FROM active_sessions WHERE user_id = $1',
      [decoded.userId]
    );

    if (!rows.length || rows[0].session_id !== decoded.sessionId) {
      return res.status(401).json({
        error: 'SESSION_EXPIRED',
        message: 'You were signed in on another device.'
      });
    }

    await pool.query(
      'UPDATE active_sessions SET last_seen_at = NOW() WHERE user_id = $1',
      [decoded.userId]
    );

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid login token' });
  }
};