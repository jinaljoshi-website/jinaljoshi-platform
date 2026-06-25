require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors({
  origin: [
    'https://ps.jinaljoshi.in',
    'https://studio.jinaljoshi.in',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
  ],
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/coins',        require('./routes/coins'));
app.use('/api/membership',   require('./routes/membership'));
app.use('/api/community',    require('./routes/community'));
app.use('/api/chat',         require('./routes/chat'));
app.use('/api/calls',        require('./routes/calls'));
app.use('/api/stream-calls', require('./routes/streamcalls'));
app.use('/api/gallery',      require('./routes/gallery'));
app.use('/api/shop',         require('./routes/shop'));
app.use('/api/push',         require('./routes/push'));
app.use('/api/studio',       require('./routes/studio'));
app.use('/api/upload',       require('./routes/upload'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'backend' }));
app.get('/',           (req, res) => res.json({ message: 'Backend is running.' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));