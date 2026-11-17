import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { Notice } from './Notice';

interface Ann { id: string; title: string; body: string; pinned: boolean; postedAt: string; postedBy: { firstName: string; lastName: string } }

export function Announcements({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Ann[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ title: '', body: '', pinned: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/announcements').then((r) => { setItems(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load announcements')));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const post = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => { await api.post('/announcements', draft); setDraft({ title: '', body: '', pinned: false }); });
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium mb-2">Announcements</h2>
      {error && <Notice kind="error">{error}</Notice>}
      {canManage && (
        <form onSubmit={post} className="border rounded p-3 bg-white mb-3 space-y-2">
          <input className="w-full border rounded px-3 py-1.5" placeholder="Title" required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className="w-full border rounded px-3 py-1.5" placeholder="Message" required maxLength={5000} rows={2} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600"><input type="checkbox" className="mr-2" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />Pin</label>
            <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Post</button>
          </div>
        </form>
      )}
      {items === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-gray-500">No announcements yet.</p>}
      <div className="space-y-2">
        {items?.map((a) => (
          <article key={a.id} className="border rounded p-3 bg-white">
            <div className="flex justify-between gap-2">
              <h3 className="font-semibold">{a.pinned && <span title="Pinned">📌 </span>}{a.title}</h3>
              {canManage && (
                <span className="text-xs space-x-3 whitespace-nowrap">
                  <button disabled={busy} className="text-indigo-600" onClick={() => act(() => api.patch(`/announcements/${a.id}`, { pinned: !a.pinned }))}>{a.pinned ? 'Unpin' : 'Pin'}</button>
                  <button disabled={busy} className="text-red-600" onClick={() => window.confirm('Delete this announcement?') && act(() => api.delete(`/announcements/${a.id}`))}>Delete</button>
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.body}</p>
            <p className="text-xs text-gray-400 mt-1">{a.postedBy.firstName} {a.postedBy.lastName} · {new Date(a.postedAt).toLocaleDateString()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
