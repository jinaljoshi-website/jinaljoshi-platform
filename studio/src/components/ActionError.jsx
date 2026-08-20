// studio/src/components/ActionError.jsx
//
// The message, where the thing that failed is.
//
// Every screen here puts failures in one banner near the heading. In a long
// review that banner is above the fold, so a rejected action looks like a click
// that did nothing at all — which is what happened when marking a photograph
// purchase-only returned 409 and the review just sat there. Two rounds of
// hunting for a phantom while the server had already said exactly what was
// wrong.
//
// So: put it under the button, the dropdown, the row. Small, quiet, and gone
// when the next attempt succeeds.
//
// Kept deliberately plain. An error beside an action competes with the action
// for attention, and the point is to be read once and then leave.
import { useState } from 'react';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

export default function ActionError({ children, style }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      style={{
        fontFamily: sans,
        fontSize: 11,
        lineHeight: 1.5,
        color: '#D99A9A',
        marginTop: 6,
        // No box and no background: this sits inside somebody else's layout and
        // should not push it about. A colour and a line of text is enough to be
        // noticed by whoever is looking at the control it belongs to.
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Errors held per thing rather than per page.
//
// One error variable for a whole screen means the second failure erases the
// first, and a message ends up under a control that did not produce it. Keyed
// by whatever identifies the action — an item id, a set id, a button name — so
// two failures can coexist and each stays where it belongs.
export function useActionErrors() {
  const [errors, setErrors] = useState({});
  return {
    errors,
    errorFor: (key) => errors[key] || null,
    setActionError: (key, message) =>
      setErrors((prev) => ({ ...prev, [key]: message || null })),
    clearActionError: (key) =>
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }),
  };
}