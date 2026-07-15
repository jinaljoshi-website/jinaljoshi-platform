import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';

export default function Profile() {
  const [user,        setUser]        = useState(null);
  const [allowances,  setAllowances]  = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [dob,         setDob]         = useState('');
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/api/auth/profile'),
      api.get('/api/chat/status').catch(() => null),
      api.get('/api/community/status').catch(() => null),
      api.get('/api/gallery/sets').catch(() => null),
    ])
      .then(([profileData, chatStatus, communityStatus, galleryData]) => {
        setUser(profileData.user);
        setDisplayName(profileData.user.display_name || '');
        setDob(profileData.user.dob ? String(profileData.user.dob).slice(0, 10) : '');
        setAllowances({
          chatFreeRemaining:  chatStatus?.freeRemaining,
          chatFreePerMonth:   chatStatus?.freeDMsPerMonth,
          chatDailyRemaining: chatStatus?.dailyRemaining,
          chatDailyCap:       chatStatus?.dailyDMCap,
          communityFreeRemaining: communityStatus?.freeRemaining,
          communityFreeDailyLimit: communityStatus?.freeDailyLimit,
          galleryCreditsRemaining: galleryData?.creditsRemaining,
          galleryCreditsMax:       galleryData?.creditsMax,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const data = await api.patch('/api/auth/profile', {
        displayName: displayName.trim() || null,
        dob: dob || null,
      });
      setUser(data.user);
      setSuccess('Profile updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading…</div>;

  const isGuest = user?.tier === 'guest' || !user?.membership_expires_at || new Date(user.membership_expires_at) < new Date();

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={eyebrow}>Account</div>
        <h1 style={title}>Your profile</h1>
        <p style={text}>Update your name and date of birth. Your name appears in the community.</p>
      </div>

      {error   && <div style={errorBox}>{error}</div>}
      {success && <div style={successBox}>{success}</div>}

      <div style={formCard}>
        <div style={field}>
          <div style={label}>Email address</div>
          <div style={staticVal}>{user?.email}</div>
          <div style={hint}>Email cannot be changed.</div>
        </div>

        <div style={field}>
          <div style={label}>Your name</div>
          <input
            style={input}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What should we call you?"
          />
          <div style={hint}>Shown next to your messages in the community.</div>
        </div>

        <div style={field}>
          <div style={label}>Date of birth</div>
          <input
            style={input}
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
          <div style={hint}>Used for your daily horoscope on the home screen. You must be 18+.</div>
        </div>

        <div style={field}>
          <div style={label}>Membership</div>
          <div style={staticVal}>
            {isGuest
              ? 'No active membership'
              : `${user?.tier?.charAt(0).toUpperCase() + user?.tier?.slice(1)} · expires ${new Date(user?.membership_expires_at).toLocaleDateString()}`
            }
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {allowances && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 14 }}>Your allowances</div>
          <div style={allowanceGrid}>
            {!isGuest && allowances.chatFreePerMonth > 0 && (
              <AllowanceCard
                label="Free messages this month"
                value={`${allowances.chatFreeRemaining} / ${allowances.chatFreePerMonth}`}
              />
            )}
            {!isGuest && allowances.chatDailyCap > 0 && (
              <AllowanceCard
                label="Messages remaining today"
                value={`${allowances.chatDailyRemaining} / ${allowances.chatDailyCap}`}
              />
            )}
            {allowances.communityFreeDailyLimit > 0 && (
              <AllowanceCard
                label="Free community messages today"
                value={`${allowances.communityFreeRemaining} / ${allowances.communityFreeDailyLimit}`}
              />
            )}
            {allowances.galleryCreditsMax > 0 && (
              <AllowanceCard
                label="Gallery unlock credits this month"
                value={`${allowances.galleryCreditsRemaining} / ${allowances.galleryCreditsMax}`}
              />
            )}
          </div>
          {isGuest && (
            <p style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 12 }}>
              Free message and unlock allowances are a membership benefit — join a tier to start earning them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AllowanceCard({ label, value }) {
  return (
    <div style={allowanceCard}>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 26, color: C.accent }}>{value}</div>
    </div>
  );
}

const eyebrow   = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title     = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px,5vw,48px)', margin: '0 0 10px' };
const text      = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 560 };
const formCard  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, maxWidth: 480 };
const field     = { marginBottom: 22 };
const label     = { fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 8 };
const input     = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, padding: '12px 14px', borderRadius: 8, outline: 'none', fontFamily: F.sans, fontSize: 15 };
const staticVal = { fontFamily: F.sans, fontSize: 15, color: C.text, padding: '12px 0' };
const hint      = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 6, opacity: 0.8 };
const saveBtn   = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '12px 24px', borderRadius: 8, cursor: 'pointer' };
const errorBox  = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const successBox = { background: 'rgba(100,160,100,0.12)', border: '1px solid rgba(100,160,100,0.35)', color: '#8FC88F', padding: 12, borderRadius: 8, marginBottom: 16, fontFamily: F.sans, fontSize: 14 };
const allowanceGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 14, maxWidth: 720 };
const allowanceCard = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px' };