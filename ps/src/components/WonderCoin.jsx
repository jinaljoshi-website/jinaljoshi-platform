import coinUrl from '../assets/wonder-coin.svg';
import { C, F } from '../tokens';
import { tokensToMoney } from '../data';

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
  // On by default. A token is an abstraction, and somebody deciding whether to
  // spend deserves to know what it costs without doing arithmetic. Anywhere it
  // genuinely does not belong passes showInr={false}.
  showInr = true,
  hideAmount = false,
  textColor = C.text,
  // Left unset, this follows textColor rather than staying grey.
  //
  // The default muted grey is for dark surfaces, and it was applied whatever the
  // caller did with textColor. Fifteen places set a dark textColor for a light
  // or accent-coloured button and left subColor alone, so the rupee line came
  // out grey on orange and could not be read — the token count was legible and
  // the price beneath it was not, which is the wrong way round for the number
  // somebody is actually deciding on.
  subColor,
  gap = 8,
  fontSize,
  subSize = 12,
  // Something that belongs to the price rather than after it.
  //
  // A rate written as the component followed by "/ min" put those two words
  // beside the rupee line and attached to neither: 27, then ₹1,782, then
  // / min, which somebody read as one thousand seven hundred rupees for a
  // twenty-seven minute call. It is ₹1,782 a minute.
  //
  // Given here it is appended to both lines, so each is a complete statement
  // and there is nothing left to pair up wrongly.
  suffix = null,
}) {
  // In whatever currency this fan chose to pay in, falling back to rupees.
  const priceLabel = tokensToMoney(amount);

  // Derived rather than defaulted. A caller that has thought about it passes
  // subColor and that wins; one that has only set textColor gets a sub-label
  // that at least sits on the same background legibly. C.text is the ordinary
  // dark-surface case, where the established grey is right.
  const resolvedSub = subColor ?? (textColor === C.text ? C.muted : textColor);

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
            {amount}{suffix ? <span style={{ fontSize: '0.72em', opacity: 0.85 }}> {suffix}</span> : null}
          </div>
          {showInr && priceLabel !== null && (
            <div
              style={{
                fontFamily: F.sans,
                fontSize: subSize,
                color: resolvedSub,
                // Held back from the main figure so the two still read as a
                // pair rather than one flat block of text.
                opacity: resolvedSub === C.muted ? 1 : 0.75,
                marginTop: 4,
                whiteSpace: 'nowrap',
              }}
            >
              {priceLabel}{suffix ? ` ${suffix}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}