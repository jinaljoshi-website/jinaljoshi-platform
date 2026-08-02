// backend/lib/qikink.js
// Print-on-demand fulfilment.
//
// Sandbox and live differ only in the base URL and the client secret — ClientId
// is the same for both — so switching over is an environment variable change,
// not a code change.

const BASE = (process.env.QIKINK_BASE_URL || 'https://sandbox.qikink.com').replace(/\/+$/, '');

// "Previous token will be overwritten when new token is generated." So a token
// must be cached and shared, not fetched per request: two concurrent calls each
// asking for their own would invalidate each other and one would fail with no
// obvious cause. The in-flight promise is held too, so a burst of orders during
// a cold start produces one token request rather than a dozen.
let cached = { token: null, expiresAt: 0 };
let inFlight = null;

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const body = new URLSearchParams({
      ClientId:      process.env.QIKINK_CLIENT_ID,
      client_secret: process.env.QIKINK_CLIENT_SECRET,
    });
    const res = await fetch(`${BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Qikink auth failed (${res.status})`);
    const data = await res.json();
    if (!data.Accesstoken) throw new Error('Qikink returned no access token');

    // Expire a minute early rather than exactly on time — a token that lapses
    // mid-request fails an order the fan has already paid for.
    const ttl = (parseInt(data.expires_in, 10) || 3600) * 1000;
    cached = { token: data.Accesstoken, expiresAt: Date.now() + ttl - 60000 };
    return cached.token;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

async function call(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ClientId:       process.env.QIKINK_CLIENT_ID,
      Accesstoken:    token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(data.message || data.error || `Qikink returned ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const PRINT_TYPE = { DTG: 1, EMBROIDERY: 3, PUFF: 6, GLOW: 7, DTF: 17 };
const PLACEMENT  = { FRONT: 'fr', BACK: 'bk', LEFT_POCKET: 'lp', RIGHT_POCKET: 'rp',
                     RIGHT_SLEEVE: 'rs', LEFT_SLEEVE: 'ls' };

// Both design_url and mockup_url are files WE host — Qikink fetches them rather
// than us uploading. R2 on media.jinaljoshi.in already serves exactly this.
function buildLineItem({ sku, quantity = 1, price, designCode, designUrl, mockupUrl,
                         widthInches, heightInches, placement = PLACEMENT.FRONT,
                         printTypeId = PRINT_TYPE.DTF }) {
  if (quantity > 100) throw new Error('Qikink allows at most 100 of one line item');
  return {
    search_from_my_products: 0,          // artwork supplied here, not pre-registered
    quantity: String(quantity),
    print_type_id: printTypeId,
    price: String(price),
    sku,
    designs: [{
      design_code: designCode,
      width_inches:  String(widthInches),
      height_inches: String(heightInches),
      placement_sku: placement,
      design_link: designUrl,
      mockup_link: mockupUrl,
    }],
  };
}

// gateway 'prepaid' throughout: fans pay us before we ever place an order, so
// there is no cash-on-delivery case to handle.
async function createOrder({ orderNumber, shipping, lineItems }) {
  return call('/api/order/create', {
    method: 'POST',
    body: {
      order_number: String(orderNumber),
      qikink_shipping: '1',
      gateway: 'prepaid',
      total_order_value: String(
        lineItems.reduce((s, li) => s + parseFloat(li.price) * parseInt(li.quantity, 10), 0)
      ),
      line_items: lineItems,
      shipping_address: {
        first_name: shipping.name,
        last_name:  shipping.lastName || '',
        address1:   shipping.line1,
        address2:   shipping.line2 || '',
        phone:      shipping.phone,
        email:      shipping.email || '',
        city:       shipping.city,
        zip:        String(shipping.pincode),
        province:   shipping.state,
        country_code: 'IN',
      },
    },
  });
}

const getOrder  = (id)     => call(`/api/order/${id}`);
const listOrders = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return call(`/api/order${q ? `?${q}` : ''}`);
};

// Proves credentials and connectivity without creating anything.
async function ping() {
  const token = await getToken();
  return { ok: true, base: BASE, tokenLength: token.length, expiresInMs: cached.expiresAt - Date.now() };
}

module.exports = { getToken, call, createOrder, getOrder, listOrders, ping,
                   buildLineItem, PRINT_TYPE, PLACEMENT, BASE };