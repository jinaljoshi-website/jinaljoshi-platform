import { useEffect, useState } from 'react';
import { api } from '../api';
import { COIN_PACKS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Coins() {
  const [balance, setBalance] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/coins/balance')
      .then((data) => {
        setBalance(data.balance ?? 0);
        setLedger(data.ledger || []);
      })
      .catch((err) => {
        setError(err.message || 'Could not load coin balance.');
      });
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Wonder Coins</div>
        <h1 style={title}>Coins & balance</h1>
        <p style={text}>
          The backend guide includes `/api/coins/balance` and a `coin_ledger` table, so this page is where members view balances and recharge options.
        </p>
      </div>

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ color: C.muted, marginBottom: 8 }}>Current balance</div>
        <div>
          {balance === null ? (
            <div style={{ fontFamily: F.display, fontSize: 44 }}>—</div>
          ) : (
            <WonderCoinAmount amount={balance} size={40} fontSize={44} />
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        {COIN_PACKS.map((pack) => (
          <div key={pack.amount} style={card}>
            <div style={{ marginBottom: 8 }}>
              <WonderCoinAmount amount={pack.amount} size={20} showInr />
            </div>
            <div style={{ color: C.muted, marginBottom: 14 }}>{pack.label}</div>
            <button style={button}>Recharge</button>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontFamily: F.display, fontSize: 28, marginBottom: 14 }}>Recent activity</div>

        {error && <div style={{ color: '#d58f8f', marginBottom: 12 }}>{error}</div>}

        {!ledger.length ? (
          <div style={{ color: C.muted }}>No transactions yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {ledger.map((entry) => (
              <div key={entry.id} style={row}>
                <div>
                  <div style={{ color: C.text }}>{entry.label}</div>
                  <div style={{ color: C.muted, fontSize: 12 }}>{entry.type}</div>
                </div>
                <div style={{ color: C.text }}>
                  <WonderCoinAmount amount={entry.amount} size={16} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const eyebrow = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px, 5vw, 52px)', margin: '0 0 10px' };
const text = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${C.border}` };
const button = { background: C.accent, color: '#1A1714', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };