// studio/src/sections/Community.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import BackgroundPicker from '../components/BackgroundPicker';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono    = "'DM Mono', 'Courier New', monospace";
const display = "'Cormorant Garamond', Georgia, serif";

const studioPoll = { background: 'rgba(22,20,16,0.92)', border: `1px solid ${colors.accent}`, borderRadius: 12, padding: '14px 16px' };

const msgBubble = { maxWidth: '72%', fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6, padding: '10px 14px', borderRadius: 12 };
const quoteBox  = { borderLeft: `2px solid ${colors.accent}`, paddingLeft: 8, marginBottom: 6, opacity: 0.85 };
const modBtn    = { background: 'none', border: 'none', color: colors.muted, fontFamily: sans, fontSize: 11, cursor: 'pointer', padding: 0 };

const updatesPanel  = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: '12px 16px', margin: '16px 0 20px' };
const updatesToggle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: sans, fontSize: 12, color: colors.muted, textAlign: 'left' };

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

  // Announcements are kept apart from the conversation here as well. Moderating
  // is the reason to open this screen, and reading past the platform's own
  // noise to do it made a simple job slower than it needed to be.
  const [updates, setUpdates] = useState([]);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [hovered, setHovered] = useState(null);

  const [mode,      setMode]      = useState('say');
  const [pollQ,     setPollQ]     = useState('');
  const [pollKind,  setPollKind]  = useState('text');
  const [pollOpts,  setPollOpts]  = useState(['', '']);
  const [askPrompt, setAskPrompt] = useState('');
  const [askHours,  setAskHours]  = useState(1);

  const [polls,           setPolls]           = useState([]);
  const [questionWindows, setQuestionWindows] = useState([]);

  const pollByPost = {};
  polls.forEach((p) => { pollByPost[p.postId] = p; });
  const windowByPost = {};
  questionWindows.forEach((w) => { windowByPost[w.postId] = w; });

  const refresh = async () => {
    const d = await api.get('/api/studio/community');
    setPosts(d.posts || []); setUpdates(d.updates || []);
    setPolls(d.polls || []); setQuestionWindows(d.questionWindows || []);
  };

  const createPoll = async () => {
    setPosting(true);
    try {
      await api.post('/api/studio/community/poll', {
        question: pollQ.trim(), optionKind: pollKind,
        options: pollOpts.map((o) => o.trim()).filter(Boolean),
      });
      setPollQ(''); setPollOpts(['', '']); setMode('say');
      await refresh();
    } catch (err) { setError(err.message); } finally { setPosting(false); }
  };

  const openWindow = async () => {
    setPosting(true);
    try {
      await api.post('/api/studio/community/question-window', {
        prompt: askPrompt.trim(), hours: askHours,
      });
      setAskPrompt(''); setMode('say');
      await refresh();
    } catch (err) { setError(err.message); } finally { setPosting(false); }
  };


  const loadReports = () => api.get('/api/studio/reports').then((d) => setReports(d.reports || [])).catch(() => {});

  useEffect(() => {
    api.get('/api/studio/community')
      .then((d) => {
        setPosts(d.posts || []);
        setUpdates(d.updates || []);
        setPolls(d.polls || []);
        setQuestionWindows(d.questionWindows || []);
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
      api.get('/api/studio/community')
        .then((d) => { setPosts(d.posts || []); setUpdates(d.updates || []); })
        .catch(() => {});
    } catch (err) {
      alert(err.message);
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) return <T.muted>Loading community…</T.muted>;

  return (
    <div>
      <Eyebrow>Everyone, in one place</Eyebrow>
      <T.title>Public Corner</T.title>

      {/* The wallpaper for this room, set from inside it. */}
      <BackgroundPicker
        type="community"
        current={communityBg}
        onChange={setCommunityBg}
        label="Public Corner background"
      />

      {updates.length > 0 && (
        <div style={updatesPanel}>
          <button onClick={() => setUpdatesOpen(!updatesOpen)} style={updatesToggle}>
            <span>{updates.length} system update{updates.length === 1 ? '' : 's'} in the last two days</span>
            <span style={{ color: colors.accent }}>{updatesOpen ? 'Hide' : 'See them'}</span>
          </button>
          {updatesOpen && (
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 10 }}>
              {updates.map((u) => (
                <div key={u.id} style={{ padding: '7px 0', borderBottom: `1px solid ${colors.border}` }}>
                  <div style={{ fontFamily: sans, fontSize: 12, color: u.kind === 'news' ? colors.text : colors.muted, lineHeight: 1.55 }}>
                    {u.content}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, opacity: 0.7, marginTop: 2 }}>
                    {new Date(u.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

        {/* Three ways to start something, in one place. A poll and a question
            window are both just a post with a shape, so they belong beside the
            box rather than behind a menu somewhere else. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {[
            { key: 'say',   label: 'Say something' },
            { key: 'poll',  label: 'Run a poll' },
            { key: 'ask',   label: 'Open questions' },
          ].map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              style={{
                fontFamily: sans, fontSize: 12, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                background: mode === m.key ? 'rgba(193,125,74,0.12)' : 'transparent',
                border:     mode === m.key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
                color:      mode === m.key ? colors.accent : colors.muted,
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'poll' && (
          <div style={{ marginBottom: 10 }}>
            <input value={pollQ} onChange={(e) => setPollQ(e.target.value)}
                   placeholder="What do you want to ask them?"
                   style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {['text', 'image'].map((k) => (
                <button key={k} onClick={() => setPollKind(k)}
                  style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 12px',
                           ...(pollKind === k ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
                  {k === 'text' ? 'Words' : 'Pictures'}
                </button>
              ))}
            </div>
            {pollOpts.map((o, i) => (
              <input key={i} value={o}
                     onChange={(e) => setPollOpts(pollOpts.map((x, j) => (j === i ? e.target.value : x)))}
                     placeholder={pollKind === 'image' ? `Image ${i + 1} — paste the URL` : `Option ${i + 1}`}
                     style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pollOpts.length < 4 && (
                <button onClick={() => setPollOpts([...pollOpts, ''])} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 12px' }}>
                  Add another
                </button>
              )}
              {pollOpts.length > 2 && (
                <button onClick={() => setPollOpts(pollOpts.slice(0, -1))} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 12px' }}>
                  One fewer
                </button>
              )}
            </div>
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 8 }}>
              Stays at the top for 48 hours, then drops into the room with the result kept.
            </div>
          </div>
        )}

        {mode === 'ask' && (
          <div style={{ marginBottom: 10 }}>
            <input value={askPrompt} onChange={(e) => setAskPrompt(e.target.value)}
                   placeholder="Ask me anything about the shoot — open for an hour"
                   style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>Open for</span>
              {[1, 2, 4].map((h) => (
                <button key={h} onClick={() => setAskHours(h)}
                  style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 12px',
                           ...(askHours === h ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
                  {h} hour{h === 1 ? '' : 's'}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 8 }}>
              A window that closes gets a burst worth sitting down to. One left open gets a trickle.
            </div>
          </div>
        )}

        {mode === 'say' && <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write something for your members…"
          rows={3}
          style={{ ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 10 }}
        />}

        <button
          onClick={mode === 'poll' ? createPoll : mode === 'ask' ? openWindow : handlePost}
          disabled={posting || (mode === 'say' ? !content.trim() : mode === 'poll'
            ? (!pollQ.trim() || pollOpts.filter(Boolean).length < 2)
            : !askPrompt.trim())}
          style={{ ...S.btn, opacity: posting ? 0.5 : 1 }}
        >
          {posting ? 'Posting…' : mode === 'poll' ? 'Start the poll' : mode === 'ask' ? 'Open the window' : 'Post'}
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
          {posts.length === 0 && <T.muted>Nothing said yet.</T.muted>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '58vh', overflowY: 'auto' }}>
            {[...posts].reverse().map((p) => {
              const poll = pollByPost[p.id];
              if (poll) return (
                <div key={p.id} style={{ alignSelf: 'stretch' }}>
                  <div style={studioPoll}>
                    <div style={{ fontFamily: display, fontSize: 16, color: colors.text, marginBottom: 10 }}>
                      {poll.question}
                    </div>
                    <div style={{ display: 'grid', gap: 7,
                                  gridTemplateColumns: poll.optionKind === 'image' ? 'repeat(auto-fit, minmax(110px, 1fr))' : '1fr' }}>
                      {poll.options.map((o) => (
                        <div key={o.index} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 10px' }}>
                          {o.imageUrl
                            ? <img src={o.imageUrl} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 5, display: 'block' }} />
                            : <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{o.label}</div>}
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginTop: 7, overflow: 'hidden' }}>
                            <div style={{ height: 3, width: `${o.pct}%`, background: colors.accent, borderRadius: 2 }} />
                          </div>
                          <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                            {o.pct}% · {o.votes} vote{o.votes === 1 ? '' : 's'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 10 }}>
                      {poll.closed ? 'Closed' : 'Running'} · {poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}
                      {' · '}
                      <button onClick={() => updatePost(p.id, { pinned: !p.pinned })} style={modBtn}>
                        {p.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  </div>
                </div>
              );

              const win = windowByPost[p.id];
              if (win) return (
                <div key={p.id} style={{ alignSelf: 'stretch' }}>
                  <div style={{ ...studioPoll, borderColor: win.closed ? colors.border : colors.accent }}>
                    <div style={{ fontFamily: display, fontSize: 16, color: colors.text, marginBottom: 5 }}>{win.prompt}</div>
                    <div style={{ fontFamily: sans, fontSize: 11, color: win.closed ? colors.muted : colors.accent }}>
                      {win.closed ? 'Closed' : `Open until ${new Date(win.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      {' · '}
                      <button onClick={() => updatePost(p.id, { pinned: !p.pinned })} style={modBtn}>
                        {p.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  </div>
                </div>
              );

              const mine   = p.is_artist;
              const parent = p.parent_id ? posts.find((x) => x.id === p.parent_id) : null;
              return (
                <div key={p.id}
                     onMouseEnter={() => setHovered(p.id)}
                     onMouseLeave={() => setHovered(null)}
                     style={{ display: 'flex', flexDirection: 'column',
                              alignItems: mine ? 'flex-end' : 'flex-start',
                              opacity: p.removed ? 0.35 : 1 }}>
                  <div style={{ fontFamily: sans, fontSize: 11, color: mine ? colors.accent : colors.muted, marginBottom: 3 }}>
                    {mine ? '★ Jinal' : (p.display_name || 'Member')}
                    {p.pinned  && <span style={{ color: colors.accent, marginLeft: 6 }}>· pinned</span>}
                    {p.removed && <span style={{ color: '#D99A9A', marginLeft: 6 }}>· removed</span>}
                  </div>

                  <div style={{ ...msgBubble,
                                background: mine ? 'rgba(193,125,74,0.12)' : 'rgba(22,20,16,0.92)',
                                border: `1px solid ${mine ? 'rgba(193,125,74,0.25)' : colors.border}` }}>
                    {parent && (
                      <div style={quoteBox}>
                        <div style={{ fontFamily: sans, fontSize: 10, color: colors.accent, marginBottom: 2 }}>
                          {parent.is_artist ? 'Jinal' : (parent.display_name || 'Member')}
                        </div>
                        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, lineHeight: 1.4,
                                      overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {parent.content}
                        </div>
                      </div>
                    )}
                    {p.content}
                  </div>

                  {/* Her controls, on the message itself. Shown on hover so the
                      room reads as a conversation rather than a control panel,
                      and always shown on a removed one so it can be put back. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3,
                                opacity: (hovered === p.id || p.removed || p.pinned) ? 1 : 0,
                                transition: 'opacity 120ms ease' }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted }}>
                      {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button onClick={() => updatePost(p.id, { pinned: !p.pinned })} style={modBtn}>
                      {p.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button onClick={() => updatePost(p.id, { removed: !p.removed })}
                            style={{ ...modBtn, color: p.removed ? '#8FC88F' : '#D99A9A' }}>
                      {p.removed ? 'Restore' : 'Remove'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}