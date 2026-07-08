// backend/lib/geoip.js
// Looks up country info for an IP address using a free-tier geolocation API.
// Only called at signup/login, never on every request, to stay well within rate limits.

async function lookupIpCountry(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    // Local/private IPs (dev environment) — can't be geolocated
    return { country: null, countryCode: null };
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`);
    const data = await res.json();
    if (data.status === 'success') {
      return { country: data.country, countryCode: data.countryCode };
    }
    return { country: null, countryCode: null };
  } catch (err) {
    console.error('geoip/lookupIpCountry error:', err.message);
    return { country: null, countryCode: null };
  }
}

function getClientIp(req) {
  // Railway and most proxies set x-forwarded-for; take the first (original client) IP
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

module.exports = { lookupIpCountry, getClientIp };