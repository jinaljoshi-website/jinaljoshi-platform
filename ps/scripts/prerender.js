// ps/scripts/prerender.js
// Runs after both builds complete. Renders each public page to real HTML and writes it
// directly into dist/, so a crawler or automated compliance check that never executes
// JavaScript sees actual content, not the empty <div id="root"> shell every plain React
// SPA ships by default.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';
import { render, setPricing } from '../dist-server/entry-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const ROUTES = [
  { path: '/',         outFile: 'index.html' },
  { path: '/terms',    outFile: 'terms/index.html' },
  { path: '/privacy',  outFile: 'privacy/index.html' },
  { path: '/refund',   outFile: 'refund/index.html' },
  { path: '/shipping', outFile: 'shipping/index.html' },
  { path: '/contact',  outFile: 'contact/index.html' },
];

const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');

// Prices must be real in the static HTML too — a gateway reviewer or crawler with
// no JavaScript sees this file. Fail the build rather than ship blank prices.
const SNAPSHOT = path.join(__dirname, '..', 'pricing-snapshot.json');

async function fetchConfig(attempts = 3) {
  // Vercel sets this as a real environment variable. Locally it lives in .env,
  // which plain Node does not read — so fall back to Vite's own env loader.
  const base = process.env.VITE_API_URL
    || loadEnv('production', path.join(__dirname, '..'), '').VITE_API_URL;
  if (!base) throw new Error('VITE_API_URL is not set');
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${base}/api/public/config`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { config } = await res.json();
      if (!config?.token_rate_inr) throw new Error('incomplete payload');
      return config;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.log(`  pricing fetch attempt ${i} failed (${err.message}) — retrying in ${i * 3}s`);
        await new Promise((r) => setTimeout(r, i * 3000));
      }
    }
  }
  throw lastErr;
}

let config;
try {
  config = await fetchConfig();
  fs.writeFileSync(SNAPSHOT, JSON.stringify(config, null, 2));
  console.log('✓ Loaded live pricing for pre-render');
} catch (err) {
  console.warn(`⚠ Live pricing unavailable (${err.message}) — falling back to last snapshot`);
  if (!fs.existsSync(SNAPSHOT)) {
    console.error('✗ No pricing snapshot exists. Refusing to build pages with no prices.\n');
    process.exit(1);
  }
  config = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf-8'));
  console.warn('  Static pages will show prices from the last successful build.');
}
setPricing(config);

for (const route of ROUTES) {
  const appHtml = render(route.path);
  const finalHtml = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  const outPath = path.join(distDir, route.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, finalHtml);
  console.log(`✓ Pre-rendered ${route.path} → dist/${route.outFile}`);
}