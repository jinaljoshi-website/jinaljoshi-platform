// studio/src/sections/Merch.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE = 66;

export function Merch() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ title: '', description: '', price_coins: '', total_stock: '', visible: false });
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null); // id of item being edited
  const [editForm, setEditForm] = useState({});
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/api/studio/merch').then((d) => setItems(d.items || [])).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const data = await api.post('/api/studio/merch', {
        title:       form.title,
        description: form.description,
        price_coins: parseInt(form.price_coins) || 0,
        total_stock: parseInt(form.total_stock) || 0,
        visible:     form.visible,
      });
      setItems((prev) => [data.item, ...prev]);
      setForm({ title: '', description: '', price_coins: '', total_stock: '', visible: false });
      setSuccess('Item created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditing(item.id);
    setEditForm({ title: item.title, description: item.description, price_coins: item.price_coins, remaining: item.remaining, visible: item.visible });
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/merch/${id}`, {
        ...editForm,
        price_coins: parseInt(editForm.price_coins),
        remaining:   parseInt(editForm.remaining),
      });
      setItems((prev) => prev.map((i) => i.id === id ? data.item : i));
      setEditing(null);
      setSuccess('Item updated.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <T.muted>Loading merchandise…</T.muted>;

  return (
    <div>
      <Eyebrow>Merchandise</Eyebrow>
      <T.title>Shop items</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* Create form */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>Add new item</T.sectionTitle>
        <div style={S.formGrid}>
          <Field label="Title">
            <input style={S.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Signature tee — black" />
          </Field>
          <Field label="Description">
            <input style={S.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description for fans" />
          </Field>
          <TokenField
            label="Price (tokens)"
            value={form.price_coins}
            onChange={(v) => setForm({ ...form, price_coins: v })}
            tokenRateInr={TOKEN_RATE}
          />
          <Field label="Stock quantity">
            <input style={S.input} type="number" min={1} value={form.total_stock} onChange={(e) => setForm({ ...form, total_stock: e.target.value })} placeholder="e.g. 50" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'center' }}>
          <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
            Publish immediately
          </label>
          <button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.price_coins} style={{ ...S.btn, opacity: (saving || !form.title.trim() || !form.price_coins) ? 0.5 : 1 }}>
            {saving ? 'Creating…' : 'Add item'}
          </button>
        </div>
      </Card>

      {/* Items list */}
      <T.sectionTitle>All items ({items.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 12 }}>
        {items.length === 0 && <T.muted>No merchandise yet.</T.muted>}
        {items.map((item) => (
          <div key={item.id} style={S.card}>
            {editing === item.id ? (
              // Edit mode
              <div>
                <div style={S.formGrid}>
                  <Field label="Title">
                    <input style={S.input} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                  </Field>
                  <Field label="Description">
                    <input style={S.input} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                  </Field>
                  <TokenField label="Price (tokens)" value={editForm.price_coins} onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={TOKEN_RATE} />
                  <Field label="Remaining stock">
                    <input style={S.input} type="number" min={0} value={editForm.remaining} onChange={(e) => setEditForm({ ...editForm, remaining: e.target.value })} />
                  </Field>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.visible} onChange={(e) => setEditForm({ ...editForm, visible: e.target.checked })} />
                    Visible
                  </label>
                  <button onClick={() => handleUpdate(item.id)} style={S.btn}>Save</button>
                  <button onClick={() => setEditing(null)} style={S.ghostBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              // View mode
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.rowTitle}>{item.title}</div>
                  {item.description && <div style={{ ...S.rowSub, marginBottom: 4 }}>{item.description}</div>}
                  <div style={S.rowSub}>
                    {item.price_coins} tokens (₹{(item.price_coins * TOKEN_RATE).toLocaleString('en-IN')}) ·{' '}
                    {item.remaining}/{item.total_stock} remaining
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