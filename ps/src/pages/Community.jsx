import { useCallback, useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api, getUser } from '../api';

const ARTIST_ID = import.meta.env.VITE_ARTIST_USER_ID;

function rectsEqual(a, b) {
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

// What a run of the same thing is called when it is collapsed. Keyed on the
// leading emoji, which every system message already carries and which is a
// more reliable marker than parsing the sentence.
const RUN_LABELS = {
  '🔓': ['set unlocked',       'sets unlocked'],
  '📞': ['call booked',        'calls booked'],
  '🔴': ['priority call',      'priority calls'],
  '🛍️': ['order',              'orders'],
  '🌟': ['request',            'requests'],
  '💫': ['bid',                'bids'],
  '🎉': ['person joined',      'people joined'],
  '✨': ['membership',         'memberships'],
  '⬆️': ['upgrade',            'upgrades'],
  '🎁': ['gift',               'gifts'],
};

// Consecutive updates of the same kind fold into one line. Ten separate
// "someone unlocked a set" entries read as noise and push everything else off
// the screen; "6 sets unlocked" reads as a busy room and takes one line.
// Strictly in time order — nothing is reordered, only adjacent runs merged.
function groupUpdates(list) {
  const out = [];
  for (const u of list) {
    const emoji = (u.content.match(/^(\p{Extended_Pictographic}\uFE0F?)/u) || [])[1] || '';
    const last  = out[out.length - 1];
    if (last && last.emoji === emoji && RUN_LABELS[emoji]) {
      last.items.push(u);
    } else {
      out.push({ emoji, items: [u] });
    }
  }
  return out;
}

export default function Community() {
  const [posts,   setPosts]   = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const [communityBg, setCommunityBg] = useState('');
  const [hideSystemPosts, setHideSystemPosts] = useState(false);
  const [updates,     setUpdates]     = useState([]);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [reportingId, setReportingId] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportMsg, setReportMsg] = useState('');
  const bottomRef  = useRef(null);
  const isAtBottom = useRef(true);
  const currentUser = getUser();

  // Background layer geometry — measured carefully to avoid the exact bug that crashed a
  // real fan's phone in Chat.jsx: rAF-coalesced (at most one measurement per frame),
  // value-diffed (React only re-renders when the rect actually changed, since
  // getBoundingClientRect always returns a new object even when nothing moved), and
  // deliberately NOT listening to 'scroll' at all — this feed's position relative to the
  // viewport never changes from its own internal scrolling, so that listener was pure
  // unthrottled overhead that fired far more aggressively on real mobile hardware
  // (inertia scrolling) than any desktop testing session ever revealed.
  const [feedRect, setFeedRect] = useState(null);
  const feedElRef = useRef(null);
  const feedObserverRef = useRef(null);
  const lastRectRef = useRef(null);
  const rafRef = useRef(null);

  const recomputeFeedRect = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!feedElRef.current) return;
      const rect = feedElRef.current.getBoundingClientRect();
      if (!rectsEqual(rect, lastRectRef.current)) {
        lastRectRef.current = rect;
        setFeedRect(rect);
      }
    });
  };

  const feedRef = useCallback((node) => {
    if (feedObserverRef.current) {
      feedObserverRef.current.disconnect();
      feedObserverRef.current = null;
    }
    feedElRef.current = node;
    if (node) {
      const observer = new ResizeObserver(() => recomputeFeedRect());
      observer.observe(node);
      feedObserverRef.current = observer;
      recomputeFeedRect();
    }
  }, []);

  useEffect(() => { recomputeFeedRect(); }, [updates.length, updatesOpen]);

  useEffect(() => {
    window.addEventListener('resize', recomputeFeedRect);
    return () => {
      window.removeEventListener('resize', recomputeFeedRect);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const [olderCount,    setOlderCount]    = useState(0);
  const [expandedRuns,  setExpandedRuns]  = useState([]);
  const [replyTo,       setReplyTo]       = useState(null);
  const [polls,           setPolls]           = useState([]);
  const [questionWindows, setQuestionWindows] = useState([]);
  const [voting,          setVoting]          = useState(false);

  // Refetched after a vote rather than adjusted locally, so the tally shown is
  // the tally stored — a count nudged optimistically would drift from the real
  // one the moment two people voted at once.
  const vote = async (pollId, optionIndex) => {
    setVoting(true);
    try {
      await api.post(`/api/community/polls/${pollId}/vote`, { optionIndex });
      await load(true);
    } catch (err) { setError(err.message); } finally { setVoting(false); }
  };

  const loadUpdates = (hours = 48) => api.get(`/api/community/updates?hours=${hours}`)
    .then((d) => { setUpdates(d.updates || []); setOlderCount(d.olderAvailable || 0); })
    .catch(() => {});

  // A month is as far back as this goes. Beyond that it stops being catching up
  // and becomes an archive nobody reads.
  const loadOlder = () => loadUpdates(720);

  const load = (silent = false) => api.get('/api/community/posts')
    .then((d) => {
      setPosts(d.posts || []);
      setPolls(d.polls || []);
      setQuestionWindows(d.questionWindows || []);
      if (!silent) setLoading(false);
    })
    .catch((err) => { if (!silent) setError(err.message); setLoading(false); });

  const loadStatus = () => api.get('/api/community/status')
    .then((d) => {
      setCommunityBg(d.communityBg || '');
      setHideSystemPosts(!!d.hideSystemPosts);
    })
    .catch(() => {});

  useEffect(() => {
    load();
    loadUpdates();
    loadStatus();
    const interval = setInterval(() => load(true), 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [posts]);

  useEffect(() => {
    if (!loading) recomputeFeedRect();
  }, [loading]);

  const handleScroll = (e) => {
    const el = e.target;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true); setError('');
    try {
      await api.post('/api/community/post', {
        content: message.trim(),
        parentId: replyTo?.id || null,
      });
      setReplyTo(null);
      setMessage('');
      isAtBottom.current = true;
      load(true);
    } catch (err) {
      setError(err.message);
    } finally { setSending(false); }
  };

  const toggleSystemPosts = async () => {
    const next = !hideSystemPosts;
    setHideSystemPosts(next);
    try {
      await api.post('/api/community/preferences', { hideSystemPosts: next });
    } catch (err) {
      setHideSystemPosts(!next);
    }
  };

  const startReport = (postId) => {
    setReportingId(postId);
    setReportReason('');
    setReportMsg('');
  };

  const cancelReport = () => {
    setReportingId(null);
    setReportReason('');
  };

  const submitReport = async (postId) => {
    setReportSending(true);
    try {
      const data = await api.post('/api/community/report', { postId, reason: reportReason.trim() || undefined });
      setReportMsg(data.message);
      setReportingId(null);
      setReportReason('');
    } catch (err) {
      setReportMsg(err.message);
    } finally {
      setReportSending(false);
    }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading community…</div>;

  const visiblePosts = posts;

  // A lookup, so a reply can show what it answers without another request.
  const postById = {};
  posts.forEach((p) => { postById[p.id] = p; });

  const pollByPost = {};
  (polls || []).forEach((p) => { pollByPost[p.postId] = p; });

  const windowByPost = {};
  (questionWindows || []).forEach((w) => { windowByPost[w.postId] = w; });

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg, borderRadius: communityBg ? 10 : 0, overflow: 'hidden' }}>
      <div style={{ ...stickyHeader, padding: '10px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={eyebrow}>Updates</div>
            <h1 style={title}>Public Corner</h1>
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, textAlign: 'right' }}>
            Everyone, in one place
          </div>
        </div>
        {error && <div style={{ ...errorBox, marginTop: 8 }}>{error}</div>}
        {reportMsg && <div style={{ ...successBox, marginTop: 8 }}>{reportMsg}</div>}
      </div>

      <div ref={feedRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {communityBg && feedRect && (
          <div style={{ position: 'fixed', top: feedRect.top, left: feedRect.left, width: feedRect.width, height: feedRect.height, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${communityBg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(28px)', transform: 'scale(1.15)' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <img src={communityBg} alt="" style={{ height: '100%', width: 'auto', maxWidth: 'none', display: 'block' }} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,9,8,0.55)' }} />
          </div>
        )}
        {communityBg && !feedRect && (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${communityBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}

        <div style={{ position: 'relative', zIndex: 2, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px' }} onScroll={handleScroll}>
          {visiblePosts.length === 0 && (
            <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>
              {posts.length === 0 ? 'Be the first to say something!' : 'No messages to show right now.'}
            </div>
          )}
          {visiblePosts.map((post) => {
            const poll = pollByPost[post.id];
            if (poll) return <PollCard key={post.id} poll={poll} onVote={vote} voting={voting} />;
            const win = windowByPost[post.id];
            if (win) return <QuestionWindowCard key={post.id} window={win} onAsk={setReplyTo} />;
            return (
            <PostBubble
              key={post.id}
              post={post}
              parent={post.parent_id ? postById[post.parent_id] : null}
              artistId={ARTIST_ID}
              isOwn={currentUser?.id === post.user_id}
              onReply={setReplyTo}
              isReporting={reportingId === post.id}
              reportReason={reportReason}
              onReportReasonChange={setReportReason}
              onStartReport={() => startReport(post.id)}
              onCancelReport={cancelReport}
              onSubmitReport={() => submitReport(post.id)}
              reportSending={reportSending}
            />
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ ...composer, padding: '10px 16px', flexShrink: 0 }}>
        {replyTo && (
          <div style={replyingTo}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.sans, fontSize: 10, color: C.accent }}>
                Replying to {replyTo.is_artist ? 'Jinal' : (replyTo.display_name || 'a member')}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTo.content}
              </div>
            </div>
            <button onClick={() => setReplyTo(null)} style={{ ...replyBtn, color: C.accent }}>✕</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={replyTo ? 'Write your reply…' : 'Say something to the community…'}
            style={composerInput}
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            style={{ ...sendBtn, opacity: (sending || !message.trim()) ? 0.5 : 1 }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {updates.length > 0 && (
        <div style={updatesBar}>
          <button onClick={() => setUpdatesOpen(!updatesOpen)} style={updatesToggle}>
            <span>{updates.length} system update{updates.length === 1 ? '' : 's'} in the last two days</span>
            <span style={{ color: C.accent }}>{updatesOpen ? 'Hide' : 'See them'}</span>
          </button>
          {updatesOpen && (
            <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 10 }}>
              {groupUpdates(updates).map((g, gi) => {
                const single = g.items.length === 1;
                const open   = expandedRuns.includes(gi);
                const labels = RUN_LABELS[g.emoji];
                return (
                  <div key={gi} style={updateRow}>
                    {single ? (
                      <>
                        <div style={{ fontFamily: F.sans, fontSize: 12, color: g.items[0].kind === 'news' ? C.text : C.muted, lineHeight: 1.6 }}>
                          {g.items[0].content}
                        </div>
                        <div style={updateTime}>
                          {new Date(g.items[0].created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setExpandedRuns(open ? expandedRuns.filter((x) => x !== gi) : [...expandedRuns, gi])}
                                style={runToggle}>
                          <span>{g.emoji} {g.items.length} {labels[1]}</span>
                          <span style={{ color: C.accent, fontSize: 11 }}>{open ? 'Less' : 'See which'}</span>
                        </button>
                        {open && (
                          <div style={{ marginTop: 6 }}>
                            {g.items.map((u) => (
                              <div key={u.id} style={{ padding: '5px 0 5px 14px', borderLeft: `1px solid ${C.border}`, marginLeft: 2 }}>
                                <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{u.content}</div>
                                <div style={updateTime}>
                                  {new Date(u.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!open && (
                          <div style={updateTime}>
                            {new Date(g.items[g.items.length - 1].created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {new Date(g.items[0].created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {olderCount > 0 && (
                <button onClick={loadOlder} style={olderBtn}>
                  Load older · {olderCount} more from the last month
                </button>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// The message being replied to, shown above the reply itself. Without it a
// reply to something said twenty messages ago is unreadable, which is why
// every group chat does this.
// A poll, in the room. Results appear the moment you vote and not before —
// seeing the tally first tells you what everyone else picked, and most people
// then pick that.
function PollCard({ poll, onVote, voting }) {
  const voted = poll.myVote !== null && poll.myVote !== undefined;
  const show  = voted || poll.closed;

  return (
    <div style={pollCard}>
      <div style={{ fontFamily: F.display, fontSize: 17, color: C.text, marginBottom: 12, lineHeight: 1.35 }}>
        {poll.question}
      </div>

      <div style={{ display: 'grid', gap: 8,
                    gridTemplateColumns: poll.optionKind === 'image' ? 'repeat(auto-fit, minmax(120px, 1fr))' : '1fr' }}>
        {poll.options.map((o) => {
          const mine = poll.myVote === o.index;
          return (
            <button key={o.index}
                    onClick={() => !poll.closed && onVote(poll.id, o.index)}
                    disabled={poll.closed || voting}
                    style={{ ...pollOption, cursor: poll.closed ? 'default' : 'pointer',
                             borderColor: mine ? C.accent : C.border,
                             background: mine ? 'rgba(193,125,74,0.12)' : 'transparent' }}>
              {o.imageUrl
                ? <img src={o.imageUrl} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                : <span style={{ fontFamily: F.sans, fontSize: 13, color: mine ? C.accent : C.text }}>{o.label}</span>}

              {show && (
                <>
                  <div style={pollTrack}><div style={{ ...pollFill, width: `${o.pct}%` }} /></div>
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, marginTop: 3 }}>
                    {o.pct}% · {o.votes}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 10 }}>
        {poll.closed
          ? `Closed · ${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`
          : voted
            ? `${poll.totalVotes} voted so far · you can change your mind until it closes`
            : 'Tap one to see what everyone else thinks'}
      </div>
    </div>
  );
}

// An hour where questions are wanted. The countdown is the point — it is why
// people write now rather than meaning to later.
function QuestionWindowCard({ window: w, onAsk }) {
  const mins = Math.max(0, Math.round((new Date(w.closesAt) - Date.now()) / 60000));
  return (
    <div style={{ ...pollCard, borderColor: w.closed ? C.border : C.accent }}>
      <div style={{ fontFamily: F.display, fontSize: 17, color: C.text, marginBottom: 6, lineHeight: 1.35 }}>
        {w.prompt}
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 12, color: w.closed ? C.muted : C.accent, marginBottom: w.closed ? 0 : 10 }}>
        {w.closed
          ? 'This window has closed'
          : mins > 60 ? `Open for another ${Math.round(mins / 60)} hours` : `Closes in ${mins} minutes`}
      </div>
      {!w.closed && (
        <button onClick={() => onAsk(w)} style={askBtn}>Ask something →</button>
      )}
    </div>
  );
}

function QuotedParent({ parent }) {
  if (!parent) return null;
  return (
    <div style={quoteBox}>
      <div style={{ fontFamily: F.sans, fontSize: 10, color: C.accent, marginBottom: 2 }}>
        {parent.is_artist ? 'Jinal Joshi' : (parent.display_name || 'Member')}
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, lineHeight: 1.45,
                    overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {parent.content}
      </div>
    </div>
  );
}

function PostBubble({ post, parent, artistId, isOwn, onReply, isReporting, reportReason, onReportReasonChange, onStartReport, onCancelReport, onSubmitReport, reportSending }) {
  const isArtist = post.is_artist || post.user_id === artistId;
  const isSystem = post.is_system;

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <div style={systemBubble}>{post.content}</div>
      </div>
    );
  }

  if (isArtist) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>
        <div style={{ ...bubble, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.25)`, maxWidth: '75%' }}>
          <QuotedParent parent={parent} />
          {post.content}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={timestamp}>{new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <button onClick={() => onReply(post)} style={replyBtn}>Reply</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 3 }}>
        {post.display_name || post.email?.split('@')[0] || 'Member'}
        {post.tier && post.tier !== 'guest' && (
          <span style={{ marginLeft: 6, color: C.accent, fontSize: 10 }}>· {post.tier}</span>
        )}
      </div>
      <div style={{ ...bubble, background: C.surface, border: `1px solid ${C.border}`, maxWidth: '75%' }}>
        <QuotedParent parent={parent} />
        {post.content}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={timestamp}>{new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <button onClick={() => onReply(post)} style={replyBtn}>Reply</button>
        {!isOwn && !isReporting && (
          <button onClick={onStartReport} style={reportLink}>Report</button>
        )}
      </div>
      {isReporting && (
        <div style={reportBox}>
          <input
            value={reportReason}
            onChange={(e) => onReportReasonChange(e.target.value)}
            placeholder="Why are you reporting this? (optional)"
            style={reportInput}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={onSubmitReport} disabled={reportSending} style={{ ...reportSubmitBtn, opacity: reportSending ? 0.5 : 1 }}>
              {reportSending ? '…' : 'Submit'}
            </button>
            <button onClick={onCancelReport} style={reportCancelBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(18px,2.4vw,26px)', margin: '0 0 4px' };
const stickyHeader = { flexShrink: 0, background: 'rgba(13,12,10,1)', borderBottom: `1px solid ${C.border}` };
const systemToggleBtn = { display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '6px 10px', borderRadius: 999, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' };
const toggleDot     = { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' };
const bubble       = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, padding: '10px 14px', borderRadius: 10, wordBreak: 'break-word' };
const systemBubble = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(242,235,224,0.04)', border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 14px', fontStyle: 'italic' };
const timestamp    = { fontFamily: F.sans, fontSize: 10, color: C.muted, marginTop: 3 };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const successBox   = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const updatesBar    = { borderTop: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.015)', padding: '8px 16px', flexShrink: 0, position: 'relative', zIndex: 3 };
const updatesToggle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F.sans, fontSize: 12, color: C.muted };
const updateRow     = { padding: '8px 0', borderBottom: `1px solid ${C.border}` };
const replyingTo = { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(193,125,74,0.08)', borderLeft: `2px solid ${C.accent}`, borderRadius: 6, padding: '6px 10px', marginBottom: 8 };

const pollCard   = { background: 'rgba(22,20,16,0.92)', border: `1px solid ${C.accent}`, borderRadius: 12, padding: '16px 18px', margin: '4px 0' };
const pollOption = { border: '1px solid', borderRadius: 8, padding: '10px 12px', textAlign: 'left', width: '100%', background: 'transparent' };
const pollTrack  = { height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginTop: 8, overflow: 'hidden' };
const pollFill   = { height: 3, background: C.accent, borderRadius: 2, transition: 'width 0.3s' };
const askBtn     = { background: 'rgba(193,125,74,0.12)', border: `1px solid ${C.accent}`, color: C.accent, fontFamily: F.sans, fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer' };

const quoteBox = { borderLeft: `2px solid ${C.accent}`, paddingLeft: 8, marginBottom: 6, opacity: 0.85 };
const replyBtn = { background: 'none', border: 'none', color: C.muted, fontFamily: F.sans, fontSize: 11, cursor: 'pointer', padding: 0 };

const updateTime    = { fontFamily: F.mono, fontSize: 10, color: C.muted, opacity: 0.7, marginTop: 3 };
const runToggle     = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F.sans, fontSize: 12, color: C.muted, textAlign: 'left' };

const olderBtn      = { width: '100%', background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 11, padding: '10px 0 2px', cursor: 'pointer', textAlign: 'center' };

const composer     = { flexShrink: 0, borderTop: `1px solid ${C.border}`, background: 'rgba(13,12,10,1)' };
const composerInput = { flex: 1, width: '100%', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' };
const sendBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 8, flexShrink: 0, cursor: 'pointer' };
const reportLink   = { fontFamily: F.sans, fontSize: 10, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, marginTop: 3 };
const reportBox    = { marginTop: 6, maxWidth: '75%' };
const reportInput  = { width: '100%', boxSizing: 'border-box', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 13, padding: '8px 10px', borderRadius: 6, outline: 'none' };
const reportSubmitBtn = { background: '#9C5A5A', border: 'none', color: '#fff', fontFamily: F.sans, fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer' };
const reportCancelBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer' };