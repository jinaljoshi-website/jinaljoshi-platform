// studio/src/sections/Merch.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE = 66;

async function uploadImage(file) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context: 'content',
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export function Merch() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ title: '', description: '', price_coins: '', total_stock: '', visible: false });
  const [imgFile,    setImgFile]    = useState(null);
  const [imgPreview, setImgPreview] = useState('');
  const [imgUploading, setImgUploading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editImgFile,    setEditImgFile]    = useState(null);
  const [editImgPreview, setEditImgPreview] = useState('');
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const imgRef = useRef(null);
  const editImgRef = useRef(null);

  useEffect(() => {
    api.get('/api/studio/merch').then((d) => setItems(d.items || [])).finally(() => setLoading(false));
  }, []);

  const handleImgPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImgFile(file);
    setImgPreview(URL.createObjectURL(file));
  };

  const handleCreate = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      let imgKey = null;
      if (imgFile) {
        setImgUploading(true);
        imgKey = await uploadImage(imgFile);
        setImgUploading(false);
      }
      const data = await api.post('/api/studio/merch', {
        title:       form.title,
        description: form.description,
        price_coins: parseInt(form.price_coins) || 0,
        total_stock: parseInt(form.total_stock) || 0,
        visible:     form.visible,
        img_key:     imgKey,
      });
      setItems((prev) => [data.item, ...prev]);
      setForm({ title: '', description: '', price_coins: '', total_stock: '', visible: false });
      setImgFile(null); setImgPreview('');
      setSuccess('Item created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false); setImgUploading(false);
    }
  };

  const startEdit = (item) => {
    setEditing(item.id);
    setEditForm({ title: item.title, description: item.description, price_coins: item.price_coins, remaining: item.remaining, visible: item.visible });
    setEditImgFile(null); setEditImgPreview(item.img_key || '');
  };

  const handleEditImgPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEditImgFile(file);
    setEditImgPreview(URL.createObjectURL(file));
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      let imgKey = undefined;
      if (editImgFile) {
        setImgUploading(true);
        imgKey = await uploadImage(editImgFile);
        setImgUploading(false);
      }
      const data = await api.patch(`/api/studio/merch/${id}`, {
        ...editForm,
        price_coins: parseInt(editForm.price_coins),
        remaining:   parseInt(editForm.remaining),
        ...(imgKey ? { img_key: imgKey } : {}),
      });
      setItems((prev) => prev.map((i) => i.id === id ? data.item : i));
      setEditing(null);
      setEditImgFile(null); setEditImgPreview('');
      setSuccess('Item updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setImgUploading(false);
    }
  };

  const quickRestock = async (item, amount) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/merch/${item.id}`, {
        remaining: item.remaining + amount,
      });
      setItems((prev) => prev.map((i) => i.id === item.id ? data.item : i));
      setSuccess(`Added ${amount} to "${item.title}".`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <T.muted>Loading merchandise…</T.muted>;

  const inStock  = items.filter((i) => i.remaining > 0);
  const soldOut  = items.filter((i) => i.remaining <= 0);

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

      {/* In stock items */}
      <T.sectionTitle>In stock ({inStock.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 12, marginBottom: 32 }}>
        {inStock.length === 0 && <T.muted>Nothing currently in stock.</T.muted>}
        {inStock.map((item) => (
          <MerchRow
            key={item.id}
            item={item}
            editing={editing === item.id}
            editForm={editForm}
            setEditForm={setEditForm}
            onStartEdit={() => startEdit(item)}
            onCancelEdit={() => setEditing(null)}
            onUpdate={() => handleUpdate(item.id)}
            onRestock={(amt) => quickRestock(item, amt)}
          />
        ))}
      </div>

      {/* Sold out items */}
      <T.sectionTitle>Sold out ({soldOut.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 12 }}>
        {soldOut.length === 0 && <T.muted>Nothing sold out right now.</T.muted>}
        {soldOut.map((item) => (
          <MerchRow
            key={item.id}
            item={item}
            soldOut
            editing={editing === item.id}
            editForm={editForm}
            setEditForm={setEditForm}
            onStartEdit={() => startEdit(item)}
            onCancelEdit={() => setEditing(null)}
            onUpdate={() => handleUpdate(item.id)}
            onRestock={(amt) => quickRestock(item, amt)}
          />
        ))}
      </div>
    </div>
  );
}

function MerchRow({ item, soldOut, editing, editForm, setEditForm, onStartEdit, onCancelEdit, onUpdate, onRestock }) {
  return (
    <div style={{ ...S.card, ...(soldOut ? { border: '1px solid rgba(156,90,90,0.3)' } : {}) }}>
      {editing ? (
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
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 6 }}>Product image</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input ref={editImgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleEditImgPick} />
              <button onClick={() => editImgRef.current?.click()} style={S.ghostBtn}>Change photo</button>
              {editImgPreview && <img src={editImgPreview} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}` }} />}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={editForm.visible} onChange={(e) => setEditForm({ ...editForm, visible: e.target.checked })} />
              Visible
            </label>
            <button onClick={onUpdate} style={S.btn}>Save</button>
            <button onClick={onCancelEdit} style={S.ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          {item.img_key && (
            <img src={item.img_key} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}`, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={S.rowTitle}>{item.title}</div>
            {item.description && <div style={{ ...S.rowSub, marginBottom: 4 }}>{item.description}</div>}
            <div style={S.rowSub}>
              {item.price_coins} tokens (₹{(item.price_coins * TOKEN_RATE).toLocaleString('en-IN')}) ·{' '}
              {soldOut ? <span style={{ color: '#D99A9A' }}>0/{item.total_stock} remaining</span> : `${item.remaining}/${item.total_stock} remaining`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {soldOut && (
              <>
                <button onClick={() => onRestock(5)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>+5 stock</button>
                <button onClick={() => onRestock(10)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>+10 stock</button>
              </>
            )}
            <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: soldOut ? '#D99A9A' : (item.visible ? colors.success : colors.muted) }}>
              {soldOut ? 'Sold out' : (item.visible ? 'Live' : 'Hidden')}
            </span>
            <button onClick={onStartEdit} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Edit</button>
          </div>
        </div>
      )}
    </div>
  );
}