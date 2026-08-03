// backend/lib/welcome.js
// The first thing Jinal says to someone, sent on her behalf.
//
// Written as a real direct message rather than an email or a banner, because it
// arrives where a reply can happen. The whole point is the last line — an
// invitation to say hello — and that only works if it lands in the thread they
// would reply in.

const pool = require('../db/pool');
const { pushToUser } = require('./notify');

// Held here rather than in config: this is Jinal's own voice, not a setting.
// Editing it should be a deliberate change to the codebase, not something
// altered in passing on a settings screen.
function joinedMessage(name) {
  return `Dear ${name},

It is an absolute delight to host you here in Personal Space.
I look forward to our interactions and would love to know all about your experience here.

Your continued support, love and blessings mean a lot to me and act as a constant boost towards working harder and being better everyday.

Thank you!
Please feel free to drop in a 'Hi' whenever you are willing to communicate; I will make it a point to revert at the earliest.

Regards,
JJ`;
}

function memberMessage(name, tier) {
  const tierName = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'a member';
  return `Dear ${name},

Thank you for becoming ${tier ? `a ${tierName} member` : tierName}. It genuinely means a great deal.

There is more waiting for you now — sets, conversations, and time together that I keep for the people who choose to be here properly. Do take your time with it.

If there is something you would like to see, or something you think could be better, tell me. I read everything.

Regards,
JJ`;
}

// The fan's own name where they have given one. Otherwise the first part of
// their email address, stripped of separators and digits — "Dear Priya" rather
// than "Dear priya.sharma91". It is a guess, but a warm one, and better than
// addressing a personal letter to an email address.
function addressAs(user) {
  const display = user.display_name?.trim();
  if (display) return display;

  const first = String(user.email || '')
    .split('@')[0]
    .split(/[._\-+0-9]/)
    .filter(Boolean)[0];

  if (!first) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

async function send(userId, content, tag) {
  const artistId = process.env.ARTIST_USER_ID;
  if (!artistId) {
    console.error('welcome: ARTIST_USER_ID is not set, message not sent');
    return null;
  }

  // Never twice. A second verification link, a membership renewal, or a retry
  // after a failure elsewhere must not produce a duplicate — receiving the same
  // heartfelt note twice reads as automation, which is the one thing it must
  // not look like.
  const { rows: already } = await pool.query(
    `SELECT 1 FROM direct_messages
     WHERE sender_id = $1 AND recipient_id = $2 AND content LIKE $3 LIMIT 1`,
    [artistId, userId, `%${tag}%`]
  );
  if (already.length) return null;

  const { rows } = await pool.query(
    `INSERT INTO direct_messages (sender_id, recipient_id, content, tokens_charged)
     VALUES ($1, $2, $3, 0) RETURNING id`,
    [artistId, userId, content]
  );

  pushToUser(userId, {
    title: 'A message from Jinal',
    body:  'She has written to you.',
    url:   '/platform/chat',
    tag:   'welcome-dm',
  }).catch((e) => console.error('welcome push failed:', e.message));

  return rows[0].id;
}

// Sent once the email is confirmed, not at signup — an unverified account cannot
// sign in to read it, and abandoned registrations would otherwise leave a
// personal message sitting in a thread nobody opens.
async function sendJoinedWelcome(user) {
  try {
    return await send(user.id, joinedMessage(addressAs(user)), 'delight to host you here');
  } catch (err) {
    // A failed welcome must never block someone finishing registration.
    console.error('sendJoinedWelcome error:', err.message);
    return null;
  }
}

async function sendMembershipWelcome(user, tier) {
  try {
    return await send(user.id, memberMessage(addressAs(user), tier), 'choose to be here properly');
  } catch (err) {
    console.error('sendMembershipWelcome error:', err.message);
    return null;
  }
}

module.exports = { sendJoinedWelcome, sendMembershipWelcome, joinedMessage, memberMessage, addressAs };