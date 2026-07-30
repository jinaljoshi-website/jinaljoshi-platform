import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { setPricing } from './data'

// Pricing is fetched BEFORE the first render, so no component can ever paint a
// number that did not come from Studio. If it fails we still boot — pages simply
// render without prices rather than inventing one.
async function loadPricing(attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/public/config`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPricing(data.config);
      return true;
    } catch (err) {
      console.error(`Pricing config attempt ${i} failed:`, err.message);
      if (i < attempts) await new Promise((r) => setTimeout(r, i * 1500));
    }
  }
  // Let the app boot without prices rather than showing a blank screen, and
  // keep trying quietly in the background so a brief outage self-heals.
  const retry = setInterval(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/public/config`);
      if (!res.ok) return;
      const data = await res.json();
      setPricing(data.config);
      clearInterval(retry);
      window.location.reload();
    } catch { /* keep waiting */ }
  }, 15000);
  return false;
}

loadPricing().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
});