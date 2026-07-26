import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { setPricing } from './data'

// Pricing is fetched BEFORE the first render, so no component can ever paint a
// number that did not come from Studio. If it fails we still boot — pages simply
// render without prices rather than inventing one.
async function loadPricing() {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/public/config`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setPricing(data.config);
  } catch (err) {
    console.error('Pricing config unavailable:', err.message);
  }
}

loadPricing().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
});