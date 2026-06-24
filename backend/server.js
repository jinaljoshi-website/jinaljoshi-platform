require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Main route modules
app.use('/api/auth', require('./routes/auth'));
app.use('/api/coins', require('./routes/coins'));

// Health check
app.get('/api/health', async (req, res) => {
  res.json({ ok: true, service: 'backend' });
});

// Root check
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});