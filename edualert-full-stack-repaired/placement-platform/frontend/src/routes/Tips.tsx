import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

interface MyTip { id: string; category: string; title: string; body: string; actionText: string | null; actionUrl: string | null; currentPct: number; belowPct: number }
interface AdminTip { id: string; category: string; title: string; body: string; actionText: string | null; actionUrl: string | null; belowPct: number; isActive: boolean }

const cats = ['DSA', 'APTITUDE', 'COMMUNICATION', 'DOMAIN', 'HR'];

function StudentTips() {
  const [data, setData] = useState<{ skills: Record<string, number> | null; tips: MyTip[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/tips/me').then((r) => setData(r.data)).catch((e) => setError(errorMessage(e, 'Could not load your tips')));
  }, []);
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {data && data.tips.length === 0 && <Notice kind="success">No focus areas right now — keep practising!</Notice>}
      <div className="space-y-3">
        {data?.tips.map((t) => (
          <article key={t.id} className="border rounded p-3 bg-white">
            <p className="text-xs text-gray-500">{t.category} · your score {Math.round(t.currentPct)}% (focus below {Math.round(t.belowPct)}%)</p>
            <h2 className="font-semibold">{t.title}</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{t.body}</p>
            {t.actionUrl && <a className="inline-block mt-2 text-sm text-indigo-600" href={t.actionUrl} target="_blank" rel="noopener noreferrer">{t.actionText || 'Take action'} →</a>}
            {!t.actionUrl && t.actionText && <p className="mt-2 text-sm text-indigo-600">Action: {t.actionText}</p>}
          </article>
        ))}
      </div>
    </>
  );
}

function ManageTips() {
  const [tips, setTips] = useState<AdminTip[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blank = { category: 'DSA', title: '', body: '', actionText: '', actionUrl: '', belowPct: '60' };
  const [draft, setDraft] = useState(blank);

  const load = useCallback(() => {
    api.get('/tips').then((r) => { setTips(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load tips')));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api.post('/tips', {
        category: draft.category, title: draft.title, body: draft.body,
        actionText: draft.actionText.trim() || null, actionUrl: draft.actionUrl.trim() || null, belowPct: Number(draft.belowPct),
      });
      setDraft(blank);
    });
  };

  return (
    <>
      <p className="text-sm text-gray-600 mb-3">A tip is shown to a student whose score in its category is below the tip’s threshold.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <form onSubmit={create} className="border rounded p-3 bg-white mb-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select className="border rounded px-2 py-1.5 text-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input className="flex-1 min-w-[10rem] border rounded px-3 py-1.5" placeholder="Title" required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <label className="text-sm text-gray-600 flex items-center gap-1">Below <input type="number" min={1} max={100} required className="w-20 border rounded px-2 py-1" value={draft.belowPct} onChange={(e) => setDraft({ ...draft, belowPct: e.target.value })} /> %</label>
        </div>
        <textarea className="w-full border rounded px-3 py-1.5" placeholder="Tip" required maxLength={2000} rows={2} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          <input className="flex-1 min-w-[10rem] border rounded px-3 py-1.5" placeholder="Action label (optional)" maxLength={80} value={draft.actionText} onChange={(e) => setDraft({ ...draft, actionText: e.target.value })} />
          <input type="url" className="flex-1 min-w-[10rem] border rounded px-3 py-1.5" placeholder="Action link (optional)" value={draft.actionUrl} onChange={(e) => setDraft({ ...draft, actionUrl: e.target.value })} />
        </div>
        <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Add tip</button>
      </form>
      {tips === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {tips?.length === 0 && <p className="text-sm text-gray-500">No tips yet.</p>}
      <div className="space-y-2">
        {tips?.map((t) => (
          <article key={t.id} className="border rounded p-3 bg-white">
            <div className="flex justify-between gap-2">
              <div>
                <h2 className="font-semibold">{t.title}{!t.isActive && <span className="ml-2 text-xs text-amber-600">Inactive</span>}</h2>
                <p className="text-xs text-gray-500">{t.category} · shown when score &lt; {t.belowPct}%</p>
              </div>
              <span className="text-xs space-x-3 whitespace-nowrap">
                <button disabled={busy} className="text-indigo-600" onClick={() => act(() => api.patch(`/tips/${t.id}`, { isActive: !t.isActive }))}>{t.isActive ? 'Deactivate' : 'Activate'}</button>
                <button disabled={busy} className="text-red-600" onClick={() => window.confirm('Delete this tip?') && act(() => api.delete(`/tips/${t.id}`))}>Delete</button>
              </span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{t.body}</p>
          </article>
        ))}
      </div>
    </>
  );
}

export function Tips() {
  const { user } = useAuth();
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Tips &amp; actions</h1>
      {user?.role === 'STUDENT' && <StudentTips />}
      {isStaff(user?.role) && <ManageTips />}
      {user?.role === 'MENTOR' && <Notice kind="info">Tips are personalised for students and managed by the placement cell.</Notice>}
    </div>
  );
}
