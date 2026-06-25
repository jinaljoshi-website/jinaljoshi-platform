// studio/src/sections/Community.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

export function Community() {
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/api/studio/community')
      .then((d) => setPosts(d.posts || []))
      .finally(() => setLoading(false));
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

  if (loading) return <T.muted>Loading community…</T.muted>;

  return (
    <div>
      <Eyebrow>Community</Eyebrow>
      <T.title>Community feed</T.title>

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

      {/* Posts list */}
      {posts.length === 0 && <T.muted>No community posts yet.</T.muted>}
      <div style={{ display: 'grid', gap: 10 }}>
        {posts.map((p) => (
          <div key={p.id} style={{ ...S.card, opacity: p.removed ? 0.4 : 1 }}>
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
            <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, color: colors.text, lineHeight: 1.6 }}>
              {p.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}