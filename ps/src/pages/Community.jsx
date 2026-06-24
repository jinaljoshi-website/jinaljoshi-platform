import { C, F } from '../tokens';

const posts = [
  { id: 1, author: 'Jinal', tier: 'All members', text: 'Welcome to Personal Space. Thank you for being here.' },
  { id: 2, author: 'Jinal', tier: 'Inner Circle+', text: 'A new behind-the-scenes set is dropping tonight.' },
  { id: 3, author: 'Jinal', tier: 'Patron', text: 'Priority call slots for next week will open tomorrow.' },
];

export default function Community() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Community feed</div>
        <h1 style={title}>Community</h1>
        <p style={text}>
          The backend guide includes a `community_posts` table with `tier_scope`, `pinned`, and `removed`, so this screen is the frontend home for that feed.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {posts.map((post) => (
          <div key={post.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ color: C.text, fontWeight: 600 }}>{post.author}</div>
              <div style={{ color: C.accent, fontSize: 12 }}>{post.tier}</div>
            </div>
            <div style={{ color: C.muted, lineHeight: 1.75 }}>{post.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const eyebrow = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px, 5vw, 52px)', margin: '0 0 10px' };
const text = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 };