// ps/scripts/prerender.js
// Runs after both builds complete. Renders each public page to real HTML and writes it
// directly into dist/, so a crawler or automated compliance check that never executes
// JavaScript sees actual content, not the empty <div id="root"> shell every plain React
// SPA ships by default.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const API_BASE = process.env.VITE_API_URL;
try {
  if (!API_BASE) throw new Error('VITE_API_URL is not set');
  const res = await fetch(`${API_BASE}/api/public/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { config } = await res.json();
  if (!config?.token_rate_inr) throw new Error('config payload incomplete');
  setPricing(config);
  console.log('✓ Loaded live pricing for pre-render');
} catch (err) {
  console.error(`\n✗ Could not load pricing for pre-render: ${err.message}`);
  console.error('  Refusing to build pages with missing prices.\n');
  process.exit(1);
}

for (const route of ROUTES) {
  const appHtml = render(route.path);
  const finalHtml = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  const outPath = path.join(distDir, route.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, finalHtml);
  console.log(`✓ Pre-rendered ${route.path} → dist/${route.outFile}`);
}