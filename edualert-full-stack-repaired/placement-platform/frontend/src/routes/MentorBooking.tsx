import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

const fmt = (s: string) => new Date(s).toLocaleString();

export function MentorBooking() {
  const { user } = useAuth();
  const role = user?.role;
  const [slots, setSlots] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [slotForm, setSlotForm] = useState({ start: '', end: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const calls: Promise<void>[] = [];
    if (role === 'MENTOR') calls.push(api.get('/bookings/mentor/slots').then((r) => setMine(r.data)));
    else calls.push(api.get('/bookings/slots').then((r) => setSlots(r.data)));
    if (role === 'STUDENT') calls.push(api.get('/bookings/mine').then((r) => setMine(r.data)));
    Promise.all(calls).catch((e) => setStatus({ kind: 'error', text: errorMessage(e, 'Could not load sessions') })).finally(() => setLoading(false));
  }, [role]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setStatus(null);
    try { setStatus({ kind: 'success', text: await fn() }); } catch (e) { setStatus({ kind: 'error', text: errorMessage(e, 'That did not work') }); } finally { setBusy(false); load(); }
  };

  const book = (slotId: string) => run(async () => {
    const r = await api.post('/bookings/book', { slotId });
    return r.data.emailSent ? 'Booked! A confirmation email is on its way.' : 'Booked! (We could not send the confirmation e-mail, but your session is confirmed.)';
  });
  const cancel = (id: string) => run(async () => { await api.delete(`/bookings/${id}`); return 'Booking cancelled.'; });
  const addSlot = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post('/bookings/mentor/slots', { startTime: new Date(slotForm.start).toISOString(), endTime: new Date(slotForm.end).toISOString() });
      setSlotForm({ start: '', end: '' });
      return 'Slot published.';
    });
  };
  const removeSlot = (id: string) => run(async () => { await api.delete(`/bookings/mentor/slots/${id}`); return 'Slot withdrawn.'; });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">{role === 'MENTOR' ? 'Your sessions' : 'Book a Mentor Session'}</h1>
      {status && <div className="mb-3"><Notice kind={status.kind}>{status.text}</Notice></div>}

      {role === 'MENTOR' && (
        <>
          <form onSubmit={addSlot} className="border rounded p-3 bg-white mb-4 flex flex-wrap gap-2 items-end">
            <label className="text-xs text-gray-500">Start<input type="datetime-local" required className="block border rounded px-2 py-1 text-sm" value={slotForm.start} onChange={(e) => setSlotForm({ ...slotForm, start: e.target.value })} /></label>
            <label className="text-xs text-gray-500">End<input type="datetime-local" required className="block border rounded px-2 py-1 text-sm" value={slotForm.end} onChange={(e) => setSlotForm({ ...slotForm, end: e.target.value })} /></label>
            <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Publish slot</button>
          </form>
          <div className="space-y-2">
            {mine.map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded p-3 bg-white">
                <div>
                  <p className="font-medium text-sm">{fmt(s.startTime)} – {new Date(s.endTime).toLocaleTimeString()}</p>
                  <p className="text-xs text-gray-500">{s.booking ? `Booked by ${s.booking.student.user.firstName} ${s.booking.student.user.lastName} (${s.booking.student.rollNumber})${s.booking.notes ? ` — "${s.booking.notes}"` : ''}` : 'Open'}</p>
                </div>
                {!s.booking && <button disabled={busy} onClick={() => removeSlot(s.id)} className="text-red-600 text-sm">Withdraw</button>}
              </div>
            ))}
            {!loading && mine.length === 0 && <p className="text-sm text-gray-500">You have not published any slots.</p>}
          </div>
        </>
      )}

      {role !== 'MENTOR' && (
        <>
          {role === 'STUDENT' && mine.length > 0 && (
            <section className="mb-6">
              <h2 className="font-medium mb-2">Your bookings</h2>
              <div className="space-y-2">
                {mine.map((b) => (
                  <div key={b.id} className="flex items-center justify-between border rounded p-3 bg-indigo-50">
                    <p className="text-sm">{b.slot.mentor.user.firstName} {b.slot.mentor.user.lastName} · {fmt(b.slot.startTime)}</p>
                    <button disabled={busy} onClick={() => window.confirm('Cancel this session?') && cancel(b.id)} className="text-red-600 text-sm">Cancel</button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <h2 className="font-medium mb-2">Open slots</h2>
          <div className="space-y-2">
            {slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded p-3 bg-white">
                <div>
                  <p className="font-medium">{s.mentor?.user?.firstName} {s.mentor?.user?.lastName}</p>
                  <p className="text-sm text-gray-500">{fmt(s.startTime)} – {new Date(s.endTime).toLocaleTimeString()}</p>
                </div>
                {role === 'STUDENT' && <button disabled={busy} onClick={() => book(s.id)} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Book</button>}
              </div>
            ))}
            {!loading && slots.length === 0 && <p className="text-sm text-gray-500">No open slots right now.</p>}
          </div>
        </>
      )}
    </div>
  );
}
