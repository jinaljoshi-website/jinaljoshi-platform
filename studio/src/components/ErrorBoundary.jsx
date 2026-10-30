// studio/src/components/ErrorBoundary.jsx
//
// Neither app had one of these. Any error thrown while rendering — a null that
// was expected to be an object, a value rendered where React wanted a string —
// unmounted the entire tree and left a white screen with no way back except a
// reload, and nothing on it to say what happened.
//
// That is not hypothetical here: the dashboard destructured its data without
// checking it had arrived, so one failed request to /api/studio/dashboard did
// exactly this on the section she lands on, and the App re-checks that same
// endpoint every five minutes, so it recurred.
//
// A boundary cannot catch everything — not errors inside event handlers, and
// not ones thrown in async code after render — but it catches the whole class
// that white-screens a page, which is the one that leaves somebody stuck.
import { Component } from 'react';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    // Logged in full, because what is shown on screen deliberately is not.
    console.error('Studio render error:', err, info?.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;

    return (
      <div style={{ fontFamily: sans, color: colors.text, padding: '32px 24px', maxWidth: 520 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          This section couldn’t be displayed.
        </div>
        <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.6, marginBottom: 18 }}>
          Something went wrong while drawing it. Nothing has been changed or lost —
          the rest of Studio still works.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => this.setState({ err: null })}
            style={{ fontFamily: sans, fontSize: 13, padding: '8px 16px', borderRadius: 8,
                     cursor: 'pointer', background: colors.accent, border: 'none', color: '#1A1714' }}>
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{ fontFamily: sans, fontSize: 13, padding: '8px 16px', borderRadius: 8,
                     cursor: 'pointer', background: 'transparent',
                     border: `1px solid ${colors.border}`, color: colors.muted }}>
            Reload Studio
          </button>
        </div>
        {/* The message, not the stack. Enough to repeat back when something is
            wrong, without putting internals on screen. */}
        <div style={{ fontSize: 11, color: colors.muted, opacity: 0.7, marginTop: 16, wordBreak: 'break-word' }}>
          {String(this.state.err?.message || this.state.err)}
        </div>
      </div>
    );
  }
}