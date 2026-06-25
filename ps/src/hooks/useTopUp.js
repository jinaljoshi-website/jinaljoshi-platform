// ps/src/hooks/useTopUp.js
// Shared hook to manage the TopUpModal across all pages

import { useState } from 'react';

export function useTopUp() {
  const [showTopUp,   setShowTopUp]   = useState(false);
  const [topUpAmount, setTopUpAmount] = useState(0);

  const openTopUp = (requiredTokens = 0) => {
    setTopUpAmount(requiredTokens);
    setShowTopUp(true);
  };

  const closeTopUp = () => setShowTopUp(false);

  return { showTopUp, topUpAmount, openTopUp, closeTopUp };
}