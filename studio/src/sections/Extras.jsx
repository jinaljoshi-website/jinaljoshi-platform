// studio/src/sections/Extras.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE = 66;

export function Extras() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ title: '', price_coins: '', visible: false });
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/api/studio/extras').then((d) => setItems(d.items || [])).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const data = await api.post('/api/studio/extras', {
        title:       form.title,
        price_coins: parseInt(form.price_coins) || 0,
        visible:     form.visible,
      });
      setItems((prev) => [data.item, ...prev]);
      setForm({ title: '', price_coins: '', visible: false });
      setSuccess('Request type created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditing(item.id);
    setEditForm({ title: item.title, price_coins: item.price_coins, visible: item.visible });
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/extras/${id}`, {
        ...editForm,
        price_coins: parseInt(editForm.price_coins),
      });
      setItems((prev) => prev.map((i) => i.id === id ? data.item : i));
      setEditing(null);
      setSuccess('Request type updated.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <T.muted>Loading extras…</T.muted>;

  return (
    <div>
      <Eyebrow>Extras</Eyebrow>
      <T.title>Personalised request types</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* Create form */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>Add new request type</T.sectionTitle>
        <div style={S.formGrid}>
          <Field label="Title">
            <input style={S.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Birthday Greeting" />
          </Field>
          <TokenField
            label="Base price (tokens)"
            value={form.price_coins}
            onChange={(v) => setForm({ ...form, price_coins: v })}
            tokenRateInr={TOKEN_RATE}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'center' }}>
          <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
            Make available to fans immediately
          </label>
          <button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.price_coins} style={{ ...S.btn, opacity: (saving || !form.title.trim() || !form.price_coins) ? 0.5 : 1 }}>
            {saving ? 'Creating…' : 'Add request type'}
          </button>
        </div>
      </Card>

      {/* Items list */}
      <T.sectionTitle>All request types ({items.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 12 }}>
        {items.length === 0 && <T.muted>No request types yet. Add one above.</T.muted>}
        {items.map((item) => (
          <div key={item.id} style={S.card}>
            {editing === item.id ? (
              <div>
                <div style={S.formGrid}>
                  <Field label="Title">
                    <input style={S.input} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                  </Field>
                  <TokenField label="Base price (tokens)" value={editForm.price_coins} onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={TOKEN_RATE} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.visible} onChange={(e) => setEditForm({ ...editForm, visible: e.target.checked })} />
                    Available to fans
                  </label>
                  <button onClick={() => handleUpdate(item.id)} style={S.btn}>Save</button>
                  <button onClick={() => setEditing(null)} style={S.ghostBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.rowTitle}>{item.title}</div>
                  <div style={S.rowSub}>
                    {item.price_coins} tokens base price (₹{(item.price_coins * TOKEN_RATE).toLocaleString('en-IN')}) · members and guests see this discounted or doubled automatically
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: item.visible ? colors.success : colors.muted }}>
                    {item.visible ? 'Live' : 'Hidden'}
                  </span>
                  <button onClick={() => startEdit(item)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Edit</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}