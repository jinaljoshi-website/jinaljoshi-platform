// studio/src/components/SectionTabs.jsx
// One row of tabs, shared.
//
// Availability sat apart from Calls, Selfie of the Day apart from the Gallery,
// the request menu apart from the requests themselves — each pair being one
// job split across two places in the menu. Merging them means fewer things to
// find and no navigating back and forth to do a single thing.
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

export function SectionTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, margin: '16px 0 22px', flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{
            fontFamily: sans, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer',
            background: active === t.key ? 'rgba(193,125,74,0.12)' : 'transparent',
            border:     active === t.key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
            color:      active === t.key ? colors.accent : colors.muted,
          }}>
          {t.label}
          {t.count > 0 && (
            <span style={{
              marginLeft: 7, background: colors.accent, color: '#1A1714',
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
            }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}