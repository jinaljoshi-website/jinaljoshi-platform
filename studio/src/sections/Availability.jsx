// studio/src/sections/Availability.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';

export function Availability() {
  const [slots,   setSlots]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ type: 'unavailable', start_date: '', end_date: '', start_time: '', end_time: '', multiplier: '1.5', note: '' });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get('/api/studio/availability').then((d) => setSlots(d.slots || [])).finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const data = await api.post('/api/studio/availability', {
        type:        form.type,
        start_date:  form.start_date,
        end_date:    form.end_date,
        start_time:  form.start_time || null,
        end_time:    form.end_time   || null,
        multiplier:  parseFloat(form.multiplier) || 1.0,
        note:        form.note,
      });
      setSlots((prev) => [...prev, data.slot]);
      setForm({ type: 'unavailable', start_date: '', end_date: '', start_time: '', end_time: '', multiplier: '1.5', note: '' });
      setSuccess('Slot saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.post(`/api/studio/availability/${id}/delete`, {});
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const unavailable = slots.filter((s) => s.type === 'unavailable');
  const primetime   = slots.filter((s) => s.type === 'primetime');

  if (loading) return <T.muted>Loading availability…</T.muted>;

  return (
    <div>
      <Eyebrow>Call availability</Eyebrow>
      <T.title>Schedule & primetime</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* Add slot form */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>Add slot</T.sectionTitle>
        <div style={S.formGrid}>
          <Field label="Type">
            <select style={S.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="unavailable">Unavailable — block bookings</option>
              <option value="primetime">Primetime — apply price multiplier</option>
            </select>
          </Field>
          <Field label="From date">
            <input style={S.input} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="To date">
            <input style={S.input} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
          <Field label="From time (optional — leave blank for all day)">
            <input style={S.input} type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </Field>
          <Field label="To time (optional)">
            <input style={S.input} type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </Field>
          {form.type === 'primetime' && (
            <Field label="Price multiplier (e.g. 1.5 = 50% more expensive)">
              <input style={S.input} type="number" min="1" step="0.1" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} />
            </Field>
          )}
          <Field label="Note (optional)">
            <input style={S.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Diwali break" />
          </Field>
        </div>
        <button onClick={handleAdd} disabled={saving || !form.start_date || !form.end_date} style={{ ...S.btn, marginTop: 14, opacity: (saving || !form.start_date || !form.end_date) ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Add slot'}
        </button>
      </Card>

      {/* Unavailable dates */}
      <T.sectionTitle>Unavailable dates ({unavailable.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        {unavailable.length === 0 && <T.muted>No unavailable dates set.</T.muted>}
        {unavailable.map((s) => (
          <SlotRow key={s.id} slot={s} onDelete={handleDelete} />
        ))}
      </div>

      {/* Primetime slots */}
      <T.sectionTitle>Primetime slots ({primetime.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 10 }}>
        {primetime.length === 0 && <T.muted>No primetime slots set.</T.muted>}
        {primetime.map((s) => (
          <SlotRow key={s.id} slot={s} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}

function SlotRow({ slot, onDelete }) {
  const isPrimetime = slot.type === 'primetime';
  return (
    <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div>
        <div style={S.rowTitle}>
          {slot.start_date} → {slot.end_date}
          {slot.start_time && ` · ${slot.start_time}–${slot.end_time}`}
        </div>
        <div style={S.rowSub}>
          {isPrimetime ? `${slot.multiplier}× price multiplier` : 'Unavailable for bookings'}
          {slot.note && ` · ${slot.note}`}
        </div>
      </div>
      <button onClick={() => onDelete(slot.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>
        Remove
      </button>
    </div>
  );
}