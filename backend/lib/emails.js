// backend/lib/emails.js
//
// The letters the platform sends of its own accord.
//
// Kept apart from lib/email.js, which is the machinery — Resend, tokens, rate
// limits. This is what the letters say.
//
// ── The line these all sit on ───────────────────────────────────────
//
// Two kinds of email leave this platform and only one of them is optional.
//
// A tax invoice, a password reset, an email verification: each answers
// something the person just did, and withholding one would be a fault rather
// than a courtesy. Those go out regardless.
//
// An invitation, a welcome, a reminder that a membership is ending: these are
// the platform starting a conversation. Every one carries a way out, and
// `sendOptional` refuses to send to somebody who has taken it. That check lives
// here rather than in each caller, because a rule enforced in six places is a
// rule that will one day be enforced in five.

const pool = require('../db/pool');
const { sendTransactionalEmail } = require('./email');

const SITE = process.env.PS_URL || 'https://ps.jinaljoshi.in';

// Enough of a house style to look like it came from the same place, without a
// framework to maintain.
const shell = (body, optoutToken) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1A1714;">
    <div style="font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase;
                color: #C17D4A; margin-bottom: 24px;">Personal Space</div>
    ${body}
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #E8E2DA;
                font-size: 12px; color: #8A8178; line-height: 1.6;">
      <p style="margin: 0 0 8px;">Jinal Joshi · Personal Space · Mumbai</p>
      ${optoutToken ? `
      <p style="margin: 0;">
        <a href="${SITE}/emails/stop?t=${optoutToken}" style="color: #8A8178;">
          Stop receiving emails like this
        </a>
        — you will still get invoices and anything you ask for.
      </p>` : ''}
    </div>
  </div>`;

// Sent only if they still want to hear from us.
//
// Returns quietly rather than throwing when somebody has opted out, because a
// scheduler running through two hundred members should not stop at the first
// person who unsubscribed.
async function sendOptional(userId, { subject, body }) {
  const { rows } = await pool.query(
    `SELECT email, display_name, emails_unsubscribed_at, email_optout_token
       FROM users WHERE id = $1 AND closed_at IS NULL`,
    [userId]
  );
  if (!rows.length) return { sent: false, reason: 'no such account' };
  const u = rows[0];
  if (u.emails_unsubscribed_at) return { sent: false, reason: 'unsubscribed' };

  await sendTransactionalEmail({
    to: u.email,
    subject,
    html: shell(body(u.display_name || 'there'), u.email_optout_token),
  });
  return { sent: true };
}

// ── Invitation ──────────────────────────────────────────────────────
//
// Sent to an address that has no account yet, so it cannot go through
// sendOptional and carries no unsubscribe link: there is nobody to unsubscribe.
// One email, sent once, to somebody being asked to join.
async function sendInvitationEmail({ email, tier, months, reason }) {
  const forHowLong = months
    ? `for the next ${months} month${months === 1 ? '' : 's'}`
    : 'for as long as you keep the account';

  await sendTransactionalEmail({
    to: email,
    subject: 'A membership I have kept aside for you',
    html: shell(`
      <h2 style="font-size: 22px; font-weight: 500; margin: 0 0 20px;">
        There is something here with your name on it
      </h2>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        Hello,
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        You have supported my work for a long while now, in ways that came before any
        of this existed and without ever being asked to. I have not forgotten it, and
        I wanted to do something about it rather than simply say thank you again.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        So I have kept a <strong>${tier}</strong> membership aside for you on Personal
        Space, ${forHowLong}, with nothing to pay.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        Personal Space is where the fuller version of my work lives — the complete
        sets behind what you see on social media, behind-the-scenes footage, Selfie of
        the Day, and things that never get posted anywhere at all. There is also a
        chat, and I do read it.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${SITE}/auth?mode=signup&email=${encodeURIComponent(email)}"
           style="display:inline-block; background:#C17D4A; color:#fff; padding:13px 26px;
                  border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
          Come in
        </a>
      </p>
      <p style="font-size: 14px; line-height: 1.75; color: #6B6259; margin: 0 0 24px;">
        One small thing — please sign up with this address, <strong>${email}</strong>,
        and the membership will find you on its own. Any other address and it will not.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0;">
        Warmly,<br/>
        <strong>JJ</strong><br/>
        <span style="color: #8A8178;">Personal Space</span>
      </p>
    `, null),
  });
}

// ── Welcome ─────────────────────────────────────────────────────────
//
// After the email is verified rather than at signup, so it does not arrive
// alongside the verification and get read as a duplicate.
async function sendWelcomeEmail(userId) {
  // The gifted tokens are read rather than written into the sentence.
  //
  // The number is a setting and has changed before. An email promising ten when
  // the account was credited five is a small lie that arrives before anything
  // else does.
  let gift = 0;
  try {
    const { getConfigNumber } = require('./config');
    gift = await getConfigNumber('welcome_gift_tokens');
  } catch { /* no promise made if it cannot be read */ }

  return sendOptional(userId, {
    subject: 'Welcome to Personal Space',
    body: () => `
      <h2 style="font-size: 22px; font-weight: 500; margin: 0 0 20px;">
        Welcome to Personal Space!
      </h2>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        Your interest in my work drives my passion and hunger to be a better version
        of myself every day. Thank you for your continued love and support.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        Here in Personal Space you get access to everything I curate and create —
        photo sets, early video access, behind-the-scenes footage, Selfie of the Day,
        and at times even work that never made it to social media. Should you feel
        like it, you can always drop in a hello using the chat, and I will respond at
        the earliest.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        No purchases here are mandatory. You can browse through everything and only
        pay to unlock extra content with J Tokens, which you can top up seamlessly
        anywhere on the platform.${gift > 0 ? ` As a token of appreciation, I have
        gifted <strong>${gift} tokens</strong> to your account that you can use for
        chat or to unlock media.` : ''}
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 24px;">
        And if you find yourself using several features, there is always the option
        of a membership at whichever level suits you — it comes with content unlocks
        and chat access included, according to the level.
      </p>
      <p style="margin: 0 0 28px;">
        <a href="${SITE}/platform/gallery"
           style="display:inline-block; background:#C17D4A; color:#fff; padding:13px 26px;
                  border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
          Come and have a look
        </a>
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 24px;">
        I look forward to knowing you more, and hopefully to an interaction soon.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0;">
        Regards,<br/>
        <strong>JJ</strong><br/>
        <span style="color: #8A8178;">Personal Space</span>
      </p>
    `,
  });
}

// ── Membership ending ───────────────────────────────────────────────
//
// Two letters, and they are not written by the same person.
//
// Three days out is a notice: it exists so nobody is surprised, and a warm
// paragraph would be in the way of the date. One day out is a goodbye, and it
// should sound like one — because for most people it is one, and pretending
// otherwise while asking for money reads as exactly that.
async function sendRenewalReminderEmail(userId, { tier, expiresAt, daysLeft }) {
  const when = new Date(expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Three days: short, plain, and out of the way.
  if (daysLeft > 1) {
    return sendOptional(userId, {
      subject: `Your ${tier} membership ends on ${when}`,
      body: () => `
        <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
          A quick note that your <strong>${tier}</strong> membership ends on
          <strong>${when}</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.75; margin: 0 0 24px;">
          You can renew or change tier any time before then. If you would rather not,
          nothing needs doing — everything you have already unlocked stays yours, and
          your J Tokens are unaffected.
        </p>
        <p style="margin: 0;">
          <a href="${SITE}/platform/membership"
             style="display:inline-block; background:#C17D4A; color:#fff; padding:12px 24px;
                    border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
            Renew or change tier
          </a>
        </p>
      `,
    });
  }

  // One day: hers.
  return sendOptional(userId, {
    subject: 'Your membership ends today',
    body: () => `
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">Hey,</p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        I believe you already know that your membership is about to expire today. You
        can choose to renew, or change your tier, to carry on enjoying your membership
        benefits.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        Should you choose not to renew, your account still remains active and you can
        browse the platform as a guest. Anything you unlocked using membership credits
        will still be there for you.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 16px;">
        While it is a bit sad to see you go, I honour and respect your decision. I
        would like to wholeheartedly thank you for your contribution to my journey. I
        shall forever be grateful for your time and your gesture.
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0 0 24px;">
        I wish nothing less than the best for you. Kudos! And should you ever wish to
        access more here, you know the drill.
      </p>
      <p style="margin: 0 0 28px;">
        <a href="${SITE}/platform/membership"
           style="display:inline-block; background:#C17D4A; color:#fff; padding:13px 26px;
                  border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
          Renew or change tier
        </a>
      </p>
      <p style="font-size: 15px; line-height: 1.75; margin: 0;">
        Cheers,<br/>
        <strong>JJ</strong>
      </p>
    `,
  });
}

module.exports = {
  sendOptional,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendRenewalReminderEmail,
};