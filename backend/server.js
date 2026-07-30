require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { startScheduler } = require('./lib/scheduler');

const app = express();

app.use(cors({
  origin: [
    'https://ps.jinaljoshi.in',
    'https://studio.jinaljoshi.in',
    'https://jinaljoshi.in',
    'https://www.jinaljoshi.in',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
  ],
  credentials: true,
}));

// Razorpay signs the exact bytes it sends, so the webhook needs the raw body.
// Re-serialising the parsed object is not guaranteed to reproduce them.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Public routes (no auth)
app.use('/api/public',       require('./routes/public'));

// Authenticated routes
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/coins',        require('./routes/coins'));
app.use('/api/membership',   require('./routes/membership'));
app.use('/api/community',    require('./routes/community'));
app.use('/api/chat',         require('./routes/chat'));
app.use('/api/calls',        require('./routes/calls'));
app.use('/api/stream-calls', require('./routes/streamcalls'));
app.use('/api/stream-chat',  require('./routes/streamchat'));
app.use('/api/gallery',      require('./routes/gallery'));
app.use('/api/landing',     require('./routes/landing'));
app.use('/api/shop/auction', require('./routes/auction').router);
app.use('/api/shop',         require('./routes/shop'));
app.use('/api/extras',       require('./routes/extras'));
app.use('/api/push',         require('./routes/push'));
app.use('/api/studio/analytics', require('./routes/analytics'));
app.use('/api/studio',       require('./routes/studio'));
app.use('/api/upload',       require('./routes/upload'));
app.use('/api/portfolio', require('./routes/portfolio'));


app.get('/api/health', (req, res) => res.json({ ok: true, service: 'backend' }));
app.get('/',           (req, res) => res.json({ message: 'Backend is running.' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  // Report any missing pricing config on boot, so a bad deploy is obvious
  // immediately rather than on a fan's first purchase.
  require('./lib/config').checkPricingConfig();
  startScheduler();
});