// studio/src/sections/Community.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

export function Community() {
  const [posts,       setPosts]       = useState([]);
  const [communityBg, setCommunityBg] = useState('');
  const [loading,      setLoading]     = useState(true);
  const [content,      setContent]     = useState('');
  const [posting,      setPosting]     = useState(false);
  const [error,        setError]       = useState('');

  const [reports,        setReports]        = useState([]);
  const [reportReasons,  setReportReasons]  = useState({}); // reportId -> reason input
  const [resolvingId,    setResolvingId]    = useState(null);

  const loadReports = () => api.get('/api/studio/reports').then((d) => setReports(d.reports || [])).catch(() => {});

  useEffect(() => {
    api.get('/api/studio/community')
      .then((d) => {
        setPosts(d.posts || []);
        setCommunityBg(d.communityBg || '');
      })
      .finally(() => setLoading(false));
    loadReports();
  }, []);

  const updatePost = async (id, patch) => {
    try {
      const data = await api.patch(`/api/studio/community/${id}`, patch);
      setPosts((prev) => prev.map((p) => p.id === id ? data.post : p));
    } catch (err) { alert(err.message); }
  };

  const handlePost = async () => {
    if (!content.trim()) return;
    setError(''); setPosting(true);
    try {
      const data = await api.post('/api/community/post', { content: content.trim() });
      setPosts((prev) => [{ ...data.post, display_name: 'Jinal Joshi', is_artist: true }, ...prev]);
      setContent('');
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const resolveReport = async (reportId, action) => {
    setResolvingId(reportId);
    try {
      await api.post(`/api/studio/reports/${reportId}/resolve`, {
        action,
        reason: reportReasons[reportId]?.trim() || undefined,
      });
      setReports((prev) => prev.filter((r) => r.id !== reportId));
      // Refresh posts too, since a removal changes what's shown
      api.get('/api/studio/community').then((d) => setPosts(d.posts || [])).catch(() => {});
    } catch (err) {
      alert(err.message);
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) return <T.muted>Loading community…</T.muted>;

  return (
    <div>
      <Eyebrow>Updates</Eyebrow>
      <T.title>Public Corner</T.title>

      {/* Reports queue */}
      {reports.length > 0 && (
        <Card style={{ marginBottom: 24, border: '1px solid rgba(156,90,90,0.3)' }}>
          <T.sectionTitle>Pending reports ({reports.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12 }}>
            {reports.map((r) => (
              <div key={r.id} style={{ background: 'rgba(156,90,90,0.06)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14 }}>
                <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 6 }}>
                  Reported by {r.reporter_name || r.reporter_email} · post by {r.author_name || r.author_email} · {new Date(r.created_at).toLocaleString()}
                </div>
                {r.reason && (
                  <div style={{ fontFamily: sans, fontSize: 12, color: '#D99A9A', marginBottom: 8, fontStyle: 'italic' }}>
                    Reason given: "{r.reason}"
                  </div>
                )}
                <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
                  {r.post_content}
                </div>
                <input
                  value={reportReasons[r.id] || ''}
                  onChange={(e) => setReportReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Internal note for this decision (optional)"
                  style={{ ...S.input, width: '100%', boxSizing: 'border-box', fontSize: 12, marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => resolveReport(r.id, 'dismiss')} disabled={resolvingId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Dismiss</button>
                  <button onClick={() => resolveReport(r.id, 'remove')} disabled={resolvingId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A' }}>Remove post</button>
                  <button onClick={() => resolveReport(r.id, 'remove_and_mute')} disabled={resolvingId === r.id} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D9A45C' }}>Remove + Mute author</button>
                  <button onClick={() => resolveReport(r.id, 'remove_and_block')} disabled={resolvingId === r.id} style={{ ...S.btn, fontSize: 12, padding: '6px 12px', background: '#9C5A5A', border: 'none' }}>Remove + Restrict author</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Post composer */}
      <Card style={{ marginBottom: 24 }}>
        <T.sectionTitle>Post to community</T.sectionTitle>
        {error && <div style={S.error}>{error}</div>}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write something for your members…"
          rows={3}
          style={{ ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 10 }}
        />
        <button
          onClick={handlePost}
          disabled={posting || !content.trim()}
          style={{ ...S.btn, opacity: (posting || !content.trim()) ? 0.5 : 1 }}
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </Card>

      {communityBg && (
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.accent, marginBottom: 10 }}>
          Showing the current live community background, exactly what members see — manage it from Settings → Backgrounds
        </div>
      )}

      <div style={{ position: 'relative', borderRadius: communityBg ? 10 : 0, overflow: 'hidden' }}>
        {communityBg && (
          <>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${communityBg})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,9,8,0.55)', zIndex: 1 }} />
          </>
        )}
        <div style={{ position: 'relative', zIndex: 2, padding: communityBg ? 14 : 0 }}>
          {posts.length === 0 && <T.muted>No community posts yet.</T.muted>}
          <div style={{ display: 'grid', gap: 10 }}>
            {posts.map((p) => (
              <div key={p.id} style={{ ...S.card, background: communityBg ? 'rgba(22,20,16,0.9)' : S.card.background, opacity: p.removed ? 0.4 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                  <div style={S.rowSub}>
                    {p.is_artist ? '★ Jinal' : (p.display_name || 'Member')} · {new Date(p.created_at).toLocaleDateString()}
                    {p.pinned && <span style={{ color: colors.accent, marginLeft: 8 }}>· Pinned</span>}
                    {p.removed && <span style={{ color: '#D99A9A', marginLeft: 8 }}>· Removed</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => updatePost(p.id, { pinned: !p.pinned })}
                      style={{ ...S.btn, background: p.pinned ? 'rgba(193,125,74,0.15)' : 'transparent', color: p.pinned ? '#C17D4A' : '#9B8F83', border: '1px solid rgba(242,235,224,0.08)', fontSize: 11, padding: '4px 8px' }}
                    >
                      {p.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      onClick={() => updatePost(p.id, { removed: !p.removed })}
                      style={{ ...S.btn, background: p.removed ? 'rgba(156,90,90,0.15)' : 'transparent', color: p.removed ? '#D99A9A' : '#9B8F83', border: '1px solid rgba(242,235,224,0.08)', fontSize: 11, padding: '4px 8px' }}
                    >
                      {p.removed ? 'Restore' : 'Remove'}
                    </button>
                  </div>
                </div>
                <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6 }}>
                  {p.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}