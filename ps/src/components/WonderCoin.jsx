import coinUrl from '../assets/wonder-coin.svg';
import { C, F } from '../tokens';
import { tokenRateInr } from '../data';

export function WonderCoin({ size = 18, alt = 'Wonder Coin' }) {
  return (
    <img
      src={coinUrl}
      alt={alt}
      width={size}
      height={size}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        objectFit: 'contain',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    />
  );
}

export function WonderCoinAmount({
  amount,
  size = 18,
  showInr = false,
  hideAmount = false,
  textColor = C.text,
  subColor = C.muted,
  gap = 8,
  fontSize,
  subSize = 12,
}) {
  const rate     = tokenRateInr();
  const inrValue = rate === null ? null : amount * rate;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: hideAmount ? 0 : gap,
      }}
    >
      <WonderCoin size={size} />
      {!hideAmount && (
        <div style={{ lineHeight: 1.1 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: fontSize || Math.max(14, Math.round(size * 1.15)),
              color: textColor,
              whiteSpace: 'nowrap',
            }}
          >
            {amount}
          </div>
          {showInr && inrValue !== null && (
            <div
              style={{
                fontFamily: F.sans,
                fontSize: subSize,
                color: subColor,
                marginTop: 4,
                whiteSpace: 'nowrap',
              }}
            >
              ₹{inrValue.toLocaleString('en-IN')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
