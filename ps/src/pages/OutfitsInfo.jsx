// ps/src/pages/OutfitsInfo.jsx
// Public explainer for the Outfits section. Linked from Shop and the homepage
// footer, and pre-rendered so it is readable without JavaScript.
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';
import { cfgNum } from '../data';

const CHARITIES = [
  'CRY — Child Rights and You',
  'Akshaya Patra Foundation',
  'Smile Foundation',
  "Prime Minister's National Relief Fund",
  'National Defence Fund',
];

export default function OutfitsInfo() {
  const navigate = useNavigate();

  const startPct   = cfgNum('auction_starting_bid_pct');
  const bidMult    = cfgNum('auction_buynow_bid_multiplier');
  const baseMult   = cfgNum('auction_buynow_base_multiplier');
  const hours      = cfgNum('auction_duration_hours');
  const claimHours = cfgNum('auction_claim_hours');
  const cooldown   = cfgNum('auction_cooldown_days');
  const fee        = cfgNum('auction_handling_fee');
  const minBal     = cfgNum('auction_min_balance_to_bid');
  const gstPct     = cfgNum('domestic_gst_rate_pct');

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoin size={20} />
          <span style={{ fontFamily: F.display, fontSize: 18, color: C.text, cursor: 'pointer' }} onClick={() => navigate('/')}>Personal Space</span>
        </div>
        <button onClick={() => navigate(-1)} style={backBtn}>← Back</button>
      </div>

      <div style={page}>
        <div style={header}>
          <div style={eyebrow}>Outfits</div>
          <h1 style={title}>How Outfits work</h1>
          <p style={subtitle}>
            Pieces Jinal has actually worn on a shoot, offered one at a time. Every sale sends a
            share of the proceeds to a charity you choose.
          </p>
        </div>

        <Section title="One piece, one owner">
          <p>Every item in the Outfits section is a genuine one-of-one. It is the actual garment worn on set, not a reproduction, and there is exactly one of each. Once it sells, it is gone.</p>
          <p>Because of that, each item carries its own photographs and a short note about where it was worn.</p>
        </Section>

        <Section title="A share of every sale goes to charity">
          <p>For each item, Jinal sets a clearly defined percentage of the proceeds that will be donated. That percentage is shown on the item itself before you buy, so you always know what it is.</p>
          <p><strong style={{ color: C.text }}>You choose which charity receives it.</strong> At checkout you pick from a shortlist Jinal has verified:</p>
          <ul>{CHARITIES.map((c) => <li key={c}>{c}</li>)}</ul>
          <p>If you would rather not choose, a default from this list is used.</p>
          <p><strong style={{ color: C.text }}>You are not donating directly.</strong> You are buying an item from Jinal. She then makes the donation herself, from her own proceeds, to the charity you selected. Your payment is for the item, in full.</p>
        </Section>

        <Section title="How the donation is calculated">
          <p>The donation is worked out on the value of the item, not the sticker price. J Token prices include {gstPct !== null ? `${gstPct}% ` : ''}GST, so the tax component is removed first, and the item&rsquo;s percentage is applied to what remains.</p>
          <p>{fee !== null ? `The ${fee}-token handling and packaging fee` : 'The handling and packaging fee'} is excluded — it covers the cost of getting the item to you and is not part of the proceeds.</p>
          <p>At the end of every month, Jinal completes the donations and posts a summary to the community, including the total sent to each charity.</p>
        </Section>

        <Section title="Buying an outfit outright">
          <p>Every outfit that is not currently in the auction can be bought immediately at its listed price, by members and non-members alike. Non-members pay the standard guest rate that applies across the platform.</p>
          <p>Membership discounts do not apply to Outfits. These are one-of-one pieces sold at a flat price, so that every member competes on equal terms.</p>
        </Section>

        <Section title="The auction">
          <p>One outfit at a time is offered by auction, shown at the top of the Outfits section. It runs for {hours !== null ? `${hours} hours` : 'a fixed window'}.</p>
          <ul>
            <li><strong style={{ color: C.text }}>Bidding is for members only.</strong> A membership is required to place a bid.</li>
            <li>Bidding opens at {startPct !== null ? `${startPct}%` : 'a set percentage'} of the item&rsquo;s listed price.</li>
            <li>You can raise a bid in steps of 5, 10, 20 or 50 tokens.</li>
            <li>{minBal !== null ? `You need at least ${minBal} tokens in your balance to bid.` : 'A minimum balance is required to bid.'} You may bid above your balance, up to a limit, provided you accept that you must top up to claim the item if you win.</li>
            <li>Tokens are not deducted when you bid. You are only charged if you win and claim.</li>
          </ul>
          <p>While an auction is running, the item can also be bought outright, ending the auction immediately. That price is {bidMult !== null && baseMult !== null ? `whichever is higher: ${bidMult}× the current highest bid, or ${baseMult}× the listed price` : 'set as a multiple of the current bid or the listed price'}. Like bidding, buying the live auction item is available to members only.</p>
        </Section>

        <Section title="If you win">
          <p>You will be notified as soon as the auction closes, and you have {claimHours !== null ? `${claimHours} hours` : 'a set window'} to pay for and claim the item. Reminders are sent well before the deadline, and the window is extended more than once before anything is lost.</p>
          <p>If a winning bid is repeatedly left unclaimed, access to future auctions may be suspended for a period. Bids are a commitment, and other members were prevented from winning while yours stood.</p>
          <p>An item that goes unsold returns to the general listing after {cooldown !== null ? `${cooldown} days` : 'a short cooling-off period'}, and rejoins the queue for a future auction.</p>
        </Section>

        <Section title="Delivery, and returns">
          <p>Physical items carry a flat {fee !== null ? `${fee}-token ` : ''}handling and packaging fee. Courier charges are settled separately at the time of dispatch.</p>
          <p><strong style={{ color: C.text }}>One-of-one items cannot be returned or exchanged.</strong> There is only one of each, and a donation is made against the sale. The sole exception is an item that arrives damaged.</p>
          <p><strong style={{ color: C.text }}>To claim for damage, you must record an unboxing video.</strong> A continuous recording, starting before the parcel is opened, showing the sealed packaging and the item being removed. Without it a damage claim cannot be assessed. Send it to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> within 3 days of delivery.</p>
          <p>Where a damage claim is accepted, a token credit is issued to your balance. Cash refunds are not available on any purchase.</p>
        </Section>

        <Section title="Questions">
          <p>Write to <a href="mailto:orders@jinaljoshi.in" style={link}>orders@jinaljoshi.in</a> and Jinal or her team will come back to you.</p>
          <p>See also the <span style={link} onClick={() => navigate('/refund')}>Refund &amp; Cancellation Policy</span> and the <span style={link} onClick={() => navigate('/shipping')}>Shipping Policy</span>.</p>
        </Section>

        <div style={footerNote}>Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionWrap}>
      <h2 style={sectionTitle}>{title}</h2>
      <div style={sectionBody}>{children}</div>
    </div>
  );
}

const topBar       = { position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: 'rgba(13,12,10,0.94)', borderBottom: `1px solid rgba(242,235,224,0.08)`, backdropFilter: 'blur(12px)' };
const backBtn      = { background: 'transparent', border: `1px solid rgba(242,235,224,0.08)`, color: '#9B8F83', fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const page         = { maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' };
const header       = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)`, textAlign: 'left' };
const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'left' };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(36px,5vw,56px)', color: C.text, margin: '0 0 16px', textAlign: 'left' };
const subtitle     = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.7, margin: 0, textAlign: 'left' };
const sectionWrap  = { marginBottom: 40, paddingBottom: 40, borderBottom: `1px solid rgba(242,235,224,0.06)`, textAlign: 'left' };
const sectionTitle = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(22px,3vw,30px)', color: C.text, margin: '0 0 16px', textAlign: 'left' };
const sectionBody  = { fontFamily: F.sans, fontSize: 15, color: '#9B8F83', lineHeight: 1.85, textAlign: 'left' };
const link         = { color: C.accent, textDecoration: 'none', cursor: 'pointer' };
const footerNote   = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', letterSpacing: '0.08em', textAlign: 'center', marginTop: 48 };