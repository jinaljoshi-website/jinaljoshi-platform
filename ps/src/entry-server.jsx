// ps/src/entry-server.jsx
// Used only at build time, never shipped to real browsers. Exports a render function that
// turns any of the public, crawlable pages into a real HTML string, using the exact same
// components the live app uses — nothing is duplicated, so there's no risk of these pages
// drifting out of sync with the real app the way a hand-written static copy would.
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Homepage from './pages/Homepage';
import Terms    from './pages/Terms';
import Privacy  from './pages/Privacy';
import Refund   from './pages/Refund';
import Shipping from './pages/Shipping';
import Contact  from './pages/Contact';

const PAGES = {
  '/':         Homepage,
  '/terms':    Terms,
  '/privacy':  Privacy,
  '/refund':   Refund,
  '/shipping': Shipping,
  '/contact':  Contact,
};

export function render(routePath) {
  const Component = PAGES[routePath];
  return renderToString(
    React.createElement(MemoryRouter, { initialEntries: [routePath] }, React.createElement(Component))
  );
}