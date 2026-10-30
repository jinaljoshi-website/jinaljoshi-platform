// ps/src/components/ErrorBoundary.jsx
//
// Neither app had one of these. An error thrown while rendering unmounted the
// whole tree and left a white screen — no message, no way back but a reload.
//
// That is not hypothetical: the Membership page once shipped rendering an
// object where React wanted a string, and every fan who opened it got a blank
// page. A passing build said nothing about it, and nothing on screen said
// anything either.
//
// A boundary cannot catch errors inside event handlers or in async code after
// render, but it catches the class that white-screens a page, which is the one
// that leaves somebody stuck with nowhere to go.
import { Component } from 'react';
import { C, F } from '../tokens';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    // Logged in full; what is shown on screen deliberately is not.
    console.error('Render error:', err, info?.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;

    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: F.sans,
                    minHeight: '100vh', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontFamily: F.display, fontSize: 24, marginBottom: 10 }}>
            This page didn’t load properly.
          </div>
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 22 }}>
            Something went wrong on our side. Nothing you’ve paid for has been
            affected, and your tokens and unlocks are safe.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => this.setState({ err: null })}
              style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px',
                       borderRadius: 8, cursor: 'pointer', background: C.accent,
                       border: 'none', color: '#1A1714' }}>
              Try again
            </button>
            <button
              onClick={() => { window.location.href = '/platform/gallery'; }}
              style={{ fontFamily: F.sans, fontSize: 14, padding: '10px 20px', borderRadius: 8,
                       cursor: 'pointer', background: 'transparent',
                       border: `1px solid ${C.border}`, color: C.muted }}>
              Back to the gallery
            </button>
          </div>
        </div>
      </div>
    );
  }
}