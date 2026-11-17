import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

interface Step { id: string; title: string; description: string | null; category: string | null; durationDays: number | null; resourceUrl: string | null; done: boolean }
interface Roadmap { id: string; title: string; targetRole: string | null; description: string | null; published: boolean; progressPct: number; steps: Step[] }

const cats = ['', 'DSA', 'APTITUDE', 'COMMUNICATION', 'DOMAIN', 'HR'];

export function Roadmaps() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const student = user?.role === 'STUDENT';
  const [items, setItems] = useState<Roadmap[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', targetRole: '', description: '' });
  const [stepDraft, setStepDraft] = useState<Record<string, { title: string; category: string; durationDays: string; resourceUrl: string }>>({});

  const load = useCallback(() => {
    api.get('/roadmaps').then((r) => { setItems(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load roadmaps')));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const createRoadmap = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api.post('/roadmaps', { title: draft.title, targetRole: draft.targetRole || null, description: draft.description || null });
      setDraft({ title: '', targetRole: '', description: '' });
    });
  };
  const addStep = (roadmapId: string, e: React.FormEvent) => {
    e.preventDefault();
    const d = stepDraft[roadmapId];
    if (!d?.title.trim()) return;
    act(async () => {
      await api.post(`/roadmaps/${roadmapId}/steps`, {
        title: d.title, category: d.category || null,
        durationDays: d.durationDays ? Number(d.durationDays) : null, resourceUrl: d.resourceUrl.trim() || null,
      });
      setStepDraft((s) => ({ ...s, [roadmapId]: { title: '', category: '', durationDays: '', resourceUrl: '' } }));
    });
  };
  const field = (id: string) => stepDraft[id] ?? { title: '', category: '', durationDays: '', resourceUrl: '' };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Career roadmaps</h1>
      {error && <Notice kind="error">{error}</Notice>}

      {staff && (
        <form onSubmit={createRoadmap} className="border rounded p-3 bg-white mb-4 space-y-2">
          <h2 className="font-medium text-sm">New roadmap</h2>
          <input className="w-full border rounded px-3 py-1.5" placeholder="Title" required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className="w-full border rounded px-3 py-1.5" placeholder="Target role (optional)" maxLength={100} value={draft.targetRole} onChange={(e) => setDraft({ ...draft, targetRole: e.target.value })} />
          <textarea className="w-full border rounded px-3 py-1.5" placeholder="Description (optional)" maxLength={2000} rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Create</button>
        </form>
      )}

      {items === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-gray-500">No roadmaps yet.</p>}

      <div className="space-y-4">
        {items?.map((r) => (
          <section key={r.id} className="border rounded p-4 bg-white">
            <div className="flex justify-between gap-2">
              <div>
                <h2 className="font-semibold">{r.title}{!r.published && <span className="ml-2 text-xs text-amber-600">Draft</span>}</h2>
                {r.targetRole && <p className="text-xs text-gray-500">Target role: {r.targetRole}</p>}
              </div>
              {staff && (
                <span className="text-xs space-x-3 whitespace-nowrap">
                  <button disabled={busy} className="text-indigo-600" onClick={() => act(() => api.patch(`/roadmaps/${r.id}`, { published: !r.published }))}>{r.published ? 'Unpublish' : 'Publish'}</button>
                  <button disabled={busy} className="text-red-600" onClick={() => window.confirm('Delete this roadmap and all student progress on it?') && act(() => api.delete(`/roadmaps/${r.id}`))}>Delete</button>
                </span>
              )}
            </div>
            {r.description && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{r.description}</p>}
            {student && (
              <div className="mt-2" aria-label={`Progress ${r.progressPct}%`}>
                <div className="h-2 bg-gray-100 rounded"><div className="h-2 bg-indigo-600 rounded" style={{ width: `${r.progressPct}%` }} /></div>
                <p className="text-xs text-gray-500 mt-1">{r.progressPct}% complete</p>
              </div>
            )}
            <ol className="mt-3 space-y-2">
              {r.steps.map((s, i) => (
                <li key={s.id} className="flex items-start gap-3 text-sm">
                  {student ? (
                    <input type="checkbox" className="mt-1" checked={s.done} disabled={busy} aria-label={`Mark "${s.title}" ${s.done ? 'not done' : 'done'}`}
                      onChange={() => act(() => (s.done ? api.delete(`/roadmaps/steps/${s.id}/complete`) : api.post(`/roadmaps/steps/${s.id}/complete`)))} />
                  ) : <span className="text-gray-400 w-4 text-right">{i + 1}.</span>}
                  <div className="flex-1">
                    <p className={s.done ? 'line-through text-gray-400' : ''}>{s.title}</p>
                    <p className="text-xs text-gray-500">
                      {[s.category, s.durationDays ? `${s.durationDays} day(s)` : null].filter(Boolean).join(' · ')}
                      {s.resourceUrl && <> {s.category || s.durationDays ? '· ' : ''}<a className="text-indigo-600" href={s.resourceUrl} target="_blank" rel="noopener noreferrer">Resource</a></>}
                    </p>
                  </div>
                  {staff && <button disabled={busy} className="text-xs text-red-600" onClick={() => window.confirm('Delete this step?') && act(() => api.delete(`/roadmaps/steps/${s.id}`))}>Remove</button>}
                </li>
              ))}
              {r.steps.length === 0 && <li className="text-sm text-gray-500">No steps yet.</li>}
            </ol>
            {staff && (
              <form onSubmit={(e) => addStep(r.id, e)} className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                <input className="flex-1 min-w-[10rem] border rounded px-2 py-1 text-sm" placeholder="New step title" maxLength={160} value={field(r.id).title} onChange={(e) => setStepDraft({ ...stepDraft, [r.id]: { ...field(r.id), title: e.target.value } })} />
                <select className="border rounded px-2 py-1 text-sm" value={field(r.id).category} onChange={(e) => setStepDraft({ ...stepDraft, [r.id]: { ...field(r.id), category: e.target.value } })}>{cats.map((c) => <option key={c} value={c}>{c || 'No category'}</option>)}</select>
                <input type="number" min={1} max={365} className="w-24 border rounded px-2 py-1 text-sm" placeholder="Days" value={field(r.id).durationDays} onChange={(e) => setStepDraft({ ...stepDraft, [r.id]: { ...field(r.id), durationDays: e.target.value } })} />
                <input type="url" className="flex-1 min-w-[10rem] border rounded px-2 py-1 text-sm" placeholder="Resource URL (optional)" value={field(r.id).resourceUrl} onChange={(e) => setStepDraft({ ...stepDraft, [r.id]: { ...field(r.id), resourceUrl: e.target.value } })} />
                <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1 rounded text-sm">Add step</button>
              </form>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
