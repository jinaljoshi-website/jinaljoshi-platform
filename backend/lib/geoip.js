// backend/lib/geoip.js
// Looks up country info for an IP address using a free-tier geolocation API.
// Only called at signup/login, never on every request, to stay well within rate limits.

// Remembered per address.
//
// This was described as signup-and-login only, and it is also called on every
// checkout and every visit to the coins page. The free service allows forty-five
// lookups a minute, and past that it answers with a failure — which came back as
// null, which read as India. A member in London could be charged rupees not
// because anybody thought they were in India, but because the lookup was
// throttled at the moment they paid.
//
// An address does not move country in a few hours, so the answer is kept for
// six. A failure is kept for a minute only: long enough to stop hammering a
// service that is refusing, short enough that the next attempt gets a real
// answer.
const cache = new Map();
const HIT_MS  = 6 * 60 * 60 * 1000;
const MISS_MS = 60 * 1000;

async function lookupIpCountry(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    // Local/private IPs (dev environment) — can't be geolocated
    return { country: null, countryCode: null, known: false };
  }

  const hit = cache.get(ip);
  if (hit && hit.until > Date.now()) return hit.value;

  const remember = (value, ms) => {
    cache.set(ip, { value, until: Date.now() + ms });
    // Kept small. A map that only grows is a slow leak on a long-running process.
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return value;
  };

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode`);
    const data = await res.json();
    if (data.status === 'success') {
      return remember({ country: data.country, countryCode: data.countryCode, known: true }, HIT_MS);
    }
    // Said out loud, because a throttled lookup and a genuinely unknown address
    // look identical from outside, and only one of them is worth fixing.
    console.error(`geoip: lookup failed for an address — ${data.message || 'no reason given'}`);
    return remember({ country: null, countryCode: null, known: false }, MISS_MS);
  } catch (err) {
    console.error('geoip/lookupIpCountry error:', err.message);
    return remember({ country: null, countryCode: null, known: false }, MISS_MS);
  }
}

function getClientIp(req) {
  // Railway and most proxies set x-forwarded-for; take the first (original client) IP
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

module.exports = { lookupIpCountry, getClientIp };