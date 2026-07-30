// studio/src/sections/Merch.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

async function uploadImage(file) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context: 'content',
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export function Merch() {
  const [items,     setItems]     = useState([]);
  const [tokenRate, setTokenRate] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [configErr, setConfigErr] = useState(false);
  const [form,    setForm]    = useState({ title: '', description: '', price_coins: '', total_stock: '', visible: false, is_auction_item: false, csr_pct: '' });
  const [sales,   setSales]   = useState([]);
  const [tab,     setTab]     = useState('merch');   // 'merch' | 'outfits' | 'fulfilment'
  const [donationRef, setDonationRef] = useState({});
  const [imgFiles,    setImgFiles]    = useState([]);   // [{ file, preview }]
  const [editImages,  setEditImages]  = useState([]);   // [{ url }] or [{ file, preview }]
  const [imgUploading, setImgUploading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const imgRef = useRef(null);
  const editImgRef = useRef(null);

  // The rupee figures shown here must match what fans are actually charged, so the
  // rate comes from platform_config rather than a constant. Rendering waits for it —
  // pricing merchandise against a stale rate is worse than a moment's delay.
  useEffect(() => {
    Promise.all([
      api.get('/api/studio/merch'),
      api.get('/api/studio/config'),
    ])
      .then(([merchData, cfgData]) => {
        setItems(merchData.items || []);
        api.get('/api/studio/auction/fulfilment').then((d) => setSales(d.sales || [])).catch(() => {});
        const rate = parseFloat(cfgData.config?.token_rate_inr);
        if (Number.isNaN(rate)) setConfigErr(true); else setTokenRate(rate);
      })
      .catch(() => setConfigErr(true))
      .finally(() => setLoading(false));
  }, []);

  const handleImgPick = (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = '';
    if (!picked.length) return;
    setImgFiles((prev) => [...prev, ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const moveImage = (list, setList, from, to) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setList(next);
  };

  // Uploads anything not already on R2, and returns the final ordered URL list.
  // The first entry becomes the cover.
  const resolveUrls = async (list) => {
    const out = [];
    for (const entry of list) {
      out.push(entry.url ? entry.url : await uploadImage(entry.file));
    }
    return out;
  };

  const handleCreate = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      let photoUrls = [];
      if (imgFiles.length) {
        setImgUploading(true);
        photoUrls = await resolveUrls(imgFiles);
        setImgUploading(false);
      }
      const data = await api.post('/api/studio/merch', {
        title:           form.title,
        description:     form.description,
        price_coins:     parseInt(form.price_coins) || 0,
        total_stock:     form.is_auction_item ? 1 : (parseInt(form.total_stock) || 0),
        visible:         form.visible,
        images:          photoUrls,
        is_auction_item: form.is_auction_item,
        csr_pct:         form.is_auction_item ? parseFloat(form.csr_pct) : undefined,
      });
      setItems((prev) => [data.item, ...prev]);
      setForm({ title: '', description: '', price_coins: '', total_stock: '', visible: false, is_auction_item: false, csr_pct: '' });
      setImgFiles([]);
      setSuccess('Item created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false); setImgUploading(false);
    }
  };

  const startEdit = (item) => {
    setEditing(item.id);
    setEditForm({ title: item.title, description: item.description, price_coins: item.price_coins, remaining: item.remaining, visible: item.visible, csr_pct: item.csr_pct ?? '' });
    setEditImages((item.images || (item.img_key ? [item.img_key] : [])).map((url) => ({ url })));
  };

  const handleEditImgPick = (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = '';
    if (!picked.length) return;
    setEditImages((prev) => [...prev, ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      setImgUploading(true);
      const photoUrls = await resolveUrls(editImages);
      setImgUploading(false);
      const data = await api.patch(`/api/studio/merch/${id}`, {
        ...editForm,
        price_coins: parseInt(editForm.price_coins),
        // An outfit is always quantity 1, so its stock is never edited — sending
        // NaN here would wipe the remaining count.
        remaining:   Number.isNaN(parseInt(editForm.remaining)) ? undefined : parseInt(editForm.remaining),
        csr_pct:     editForm.csr_pct === '' || editForm.csr_pct === undefined ? undefined : parseFloat(editForm.csr_pct),
        images:      photoUrls,
      });
      setItems((prev) => prev.map((i) => i.id === id ? data.item : i));
      setEditing(null);
      setEditImages([]);
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
  if (configErr || tokenRate === null) {
    return <div style={S.error}>Could not load the current token rate, so prices cannot be shown. Refresh to try again.</div>;
  }

  const merchItems = items.filter((i) => !i.is_auction_item);
  const outfits    = items.filter((i) =>  i.is_auction_item);
  const inStock    = merchItems.filter((i) => i.remaining > 0);
  const soldOut    = merchItems.filter((i) => i.remaining <= 0);
  const pendingDonations = sales.filter((s) => !s.donation_confirmed_at).length;

  const confirmDonation = async (saleId) => {
    setError('');
    try {
      await api.post(`/api/studio/auction/${saleId}/donation-confirmed`, {
        reference: donationRef[saleId]?.trim() || undefined,
      });
      const d = await api.get('/api/studio/auction/fulfilment');
      setSales(d.sales || []);
      setSuccess('Donation recorded.');
    } catch (err) { setError(err.message); }
  };

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
            tokenRateInr={tokenRate}
          />
          {form.is_auction_item ? (
            <Field label="Charity share (%)">
              <input style={S.input} type="number" min={0} max={100} step="0.5"
                     value={form.csr_pct}
                     onChange={(e) => setForm({ ...form, csr_pct: e.target.value })}
                     placeholder="e.g. 20" />
            </Field>
          ) : (
            <Field label="Stock quantity">
              <input style={S.input} type="number" min={1} value={form.total_stock} onChange={(e) => setForm({ ...form, total_stock: e.target.value })} placeholder="e.g. 50" />
            </Field>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 6 }}>
            Product photos
          </div>
          <PhotoManager list={imgFiles} setList={setImgFiles} inputRef={imgRef} onPick={handleImgPick} uploading={imgUploading} />
        </div>

        <label style={auctionToggle}>
          <input type="checkbox" checked={form.is_auction_item}
                 onChange={(e) => setForm({ ...form, is_auction_item: e.target.checked })} />
          <span>
            <strong style={{ color: colors.text }}>This is a one-of-one Outfit</strong>
            <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
              Shoot-worn, quantity 1, sold through the Shoot Wardrobe with a share to charity.
              It joins the auction queue rather than the normal shop grid.
            </span>
          </span>
        </label>
        <div style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'center' }}>
          <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
            Publish immediately
          </label>
          <button onClick={handleCreate}
                  disabled={saving || !form.title.trim() || !form.price_coins || (form.is_auction_item && form.csr_pct === '')}
                  style={{ ...S.btn, opacity: (saving || !form.title.trim() || !form.price_coins || (form.is_auction_item && form.csr_pct === '')) ? 0.5 : 1 }}>
            {saving ? 'Creating…' : form.is_auction_item ? 'Add to wardrobe queue' : 'Add item'}
          </button>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { key: 'merch',      label: `Merchandise (${merchItems.length})` },
          { key: 'outfits',    label: `Outfits (${outfits.length})` },
          { key: 'fulfilment', label: `Fulfilment (${sales.length})${pendingDonations ? ` · ${pendingDonations} to donate` : ''}` },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     tab === t.key ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`,
              color:      tab === t.key ? colors.accent : colors.muted,
              fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12,
              padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'outfits' && (
        <>
          <T.sectionTitle>Shoot Wardrobe ({outfits.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12, marginBottom: 32 }}>
            {outfits.length === 0 && <T.muted>No outfits listed yet. Tick "This is a one-of-one Outfit" above to add one.</T.muted>}
            {outfits.map((item) => (
              <div key={item.id} style={S.card}>
                {editing === item.id ? (
                  <div>
                    <div style={S.formGrid}>
                      <Field label="Title">
                        <input style={S.input} value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                      </Field>
                      <Field label="Description">
                        <input style={S.input} value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                      </Field>
                      <TokenField label="Listed price (tokens)" value={editForm.price_coins}
                                  onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={tokenRate} />
                      <Field label="Charity share (%)">
                        <input style={S.input} type="number" min={0} max={100} step="0.5"
                               value={editForm.csr_pct ?? ''}
                               onChange={(e) => setEditForm({ ...editForm, csr_pct: e.target.value })} />
                      </Field>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 6 }}>Photos</div>
                      <PhotoManager list={editImages} setList={setEditImages} inputRef={editImgRef}
                                    onPick={handleEditImgPick} uploading={imgUploading} compact />
                    </div>

                    {item.auction_status === 'active' && (
                      <div style={{ ...S.rowSub, color: '#D9A45C', marginTop: 12, lineHeight: 1.6 }}>
                        This piece is live in the auction. Changing the listed price also changes the
                        opening bid and the buy-out price for anyone watching it right now.
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!editForm.visible} onChange={(e) => setEditForm({ ...editForm, visible: e.target.checked })} />
                        Visible to fans
                      </label>
                      <button onClick={() => handleUpdate(item.id)} style={S.btn}>Save</button>
                      <button onClick={() => { setEditing(null); setEditImages([]); }} style={S.ghostBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  {item.img_key && (
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={item.img_key} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}` }} />
                      {(item.images?.length || 0) > 1 && (
                        <span style={photoCount}>{item.images.length}</span>
                      )}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={S.rowTitle}>{item.title}</div>
                    <div style={S.rowSub}>
                      Listed at {item.price_coins} tokens (₹{(item.price_coins * tokenRate).toLocaleString('en-IN')})
                      {item.csr_pct != null && ` · ${item.csr_pct}% to charity`}
                    </div>
                    {item.auction_status === 'active' && (
                      <div style={{ ...S.rowSub, color: colors.accent, marginTop: 4 }}>
                        Live now · {item.current_highest_bid ? `highest bid ${item.current_highest_bid}` : 'no bids yet'}
                      </div>
                    )}
                    {item.auction_status === 'awaiting_payment' && (
                      <div style={{ ...S.rowSub, color: '#D9A45C', marginTop: 4 }}>Won — awaiting claim</div>
                    )}
                    {item.went_unsold_at && item.auction_status === 'queued' && (
                      <div style={{ ...S.rowSub, marginTop: 4 }}>Cooling off since {new Date(item.went_unsold_at).toLocaleDateString()}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>
                      {item.auction_status || 'queued'}
                    </span>
                    <button onClick={() => startEdit(item)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Edit</button>
                  </div>
                </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'fulfilment' && (
        <>
          <T.sectionTitle>Sold outfits ({sales.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 12, marginBottom: 32 }}>
            {sales.length === 0 && <T.muted>Nothing sold yet.</T.muted>}
            {sales.map((s) => {
              const ship = typeof s.shipping_address === 'string' ? JSON.parse(s.shipping_address || '{}') : (s.shipping_address || {});
              return (
                <div key={s.id} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={S.rowTitle}>{s.title}</div>
                      <div style={S.rowSub}>
                        {s.sold_price_coins} tokens via {s.sold_via === 'bid' ? 'winning bid' : 'buy now'} ·{' '}
                        {s.display_name || s.email}
                      </div>
                      {ship.name && (
                        <div style={{ ...S.rowSub, marginTop: 6, lineHeight: 1.6 }}>
                          {ship.name} · {ship.phone}<br />
                          {ship.line1}, {ship.city}, {ship.state} {ship.pincode}
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 220 }}>
                      <div style={{ ...S.rowSub, color: colors.accent }}>
                        {s.csr_pct != null ? `${s.csr_pct}% to ` : 'Charity: '}{s.charity_key || '—'}
                      </div>
                      {s.donation_confirmed_at ? (
                        <div style={{ ...S.rowSub, color: colors.success, marginTop: 6 }}>
                          Donated {new Date(s.donation_confirmed_at).toLocaleDateString()}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          <input
                            value={donationRef[s.id] || ''}
                            onChange={(e) => setDonationRef({ ...donationRef, [s.id]: e.target.value })}
                            placeholder="Reference number"
                            style={{ ...S.input, width: 150, padding: '5px 10px', fontSize: 11 }}
                          />
                          <button onClick={() => confirmDonation(s.id)} style={{ ...S.btn, fontSize: 11, padding: '5px 10px' }}>
                            Mark donated
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'merch' && <>
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
            editImgRef={editImgRef}
            editImages={editImages}
            setEditImages={setEditImages}
            handleEditImgPick={handleEditImgPick}
            tokenRate={tokenRate}
            imgUploading={imgUploading}
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
            editImgRef={editImgRef}
            editImages={editImages}
            setEditImages={setEditImages}
            handleEditImgPick={handleEditImgPick}
            tokenRate={tokenRate}
            imgUploading={imgUploading}
          />
        ))}
      </div>
      </>}
    </div>
  );
}

const auctionToggle = { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: '12px 14px', background: 'rgba(193,125,74,0.05)', border: '1px solid rgba(193,125,74,0.2)', borderRadius: 8, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: '#9B8F83', cursor: 'pointer', lineHeight: 1.5 };

function PhotoManager({ list, setList, inputRef, onPick, uploading, compact }) {
  const size = compact ? 52 : 64;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: list.length ? 8 : 0 }}>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPick} />
        <button onClick={() => inputRef.current?.click()} style={S.ghostBtn}>
          {list.length ? 'Add more photos' : 'Choose photos'}
        </button>
        {uploading && <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted }}>Uploading…</span>}
        {list.length > 1 && (
          <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: colors.muted }}>
            First photo is the cover
          </span>
        )}
      </div>
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {list.map((entry, n) => (
            <div key={n} style={{ position: 'relative' }}>
              <img src={entry.url || entry.preview} alt="" style={{
                width: size, height: size, objectFit: 'cover', borderRadius: 6,
                border: n === 0 ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              }} />
              <div style={{ display: 'flex', gap: 2, marginTop: 3, justifyContent: 'center' }}>
                <button onClick={() => moveIn(list, setList, n, n - 1)} disabled={n === 0} style={tinyBtn} title="Move left">←</button>
                <button onClick={() => setList(list.filter((_, k) => k !== n))} style={{ ...tinyBtn, color: '#D99A9A' }} title="Remove">×</button>
                <button onClick={() => moveIn(list, setList, n, n + 1)} disabled={n === list.length - 1} style={tinyBtn} title="Move right">→</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function moveIn(list, setList, from, to) {
  if (to < 0 || to >= list.length) return;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  setList(next);
}

const photoCount = { position: 'absolute', bottom: -4, right: -4, background: colors.accent, color: '#1A1714', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '1px 5px' };
const tinyBtn = { background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted, fontSize: 10, lineHeight: 1, padding: '2px 5px', borderRadius: 3, cursor: 'pointer' };

function MerchRow({ item, soldOut, editing, editForm, setEditForm, onStartEdit, onCancelEdit, onUpdate, onRestock, editImgRef, editImages, setEditImages, handleEditImgPick, tokenRate, imgUploading }) {
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
            <TokenField label="Price (tokens)" value={editForm.price_coins} onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={tokenRate} />
            <Field label="Remaining stock">
              <input style={S.input} type="number" min={0} value={editForm.remaining} onChange={(e) => setEditForm({ ...editForm, remaining: e.target.value })} />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 6 }}>Product photos</div>
            <PhotoManager list={editImages} setList={setEditImages} inputRef={editImgRef} onPick={handleEditImgPick} uploading={imgUploading} compact />
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
              {item.price_coins} tokens (₹{(item.price_coins * tokenRate).toLocaleString('en-IN')}) ·{' '}
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