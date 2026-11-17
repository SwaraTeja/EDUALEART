import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

interface Guide { id: string; title: string; category: string; summary: string | null; body: string; published: boolean; company: { id: string; name: string } | null }

const cats = ['', 'DSA', 'APTITUDE', 'COMMUNICATION', 'DOMAIN', 'HR'];
const empty = { title: '', category: 'DSA', summary: '', body: '' };

export function Guides() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams();
      if (category) q.set('category', category);
      if (search.trim()) q.set('search', search.trim());
      api.get(`/guides?${q}`).then((r) => { setGuides(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load guides')));
    }, 250);
    return () => clearTimeout(t);
  }, [category, search, reload]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setReload((n) => n + 1); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, []);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => { await api.post('/guides', { ...draft, summary: draft.summary || null }); setDraft(empty); });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Preparation guides</h1>
      <div className="flex gap-2 mb-4">
        <input className="flex-1 border rounded px-3 py-1.5 text-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="border rounded px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c || 'All categories'}</option>)}</select>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      {staff && (
        <form onSubmit={create} className="border rounded p-3 bg-white mb-4 space-y-2">
          <h2 className="font-medium text-sm">New guide</h2>
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-3 py-1.5" placeholder="Title" required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <select className="border rounded px-2 py-1.5 text-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{cats.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <input className="w-full border rounded px-3 py-1.5" placeholder="Summary (optional)" maxLength={500} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          <textarea className="w-full border rounded px-3 py-1.5" placeholder="Guide content (plain text)" required maxLength={20000} rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">Publish guide</button>
        </form>
      )}

      {guides === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {guides?.length === 0 && <p className="text-sm text-gray-500">No guides found.</p>}
      <div className="space-y-2">
        {guides?.map((g) => (
          <article key={g.id} className="border rounded p-3 bg-white">
            <div className="flex justify-between gap-2">
              <button className="text-left" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                <h2 className="font-semibold">{g.title}{!g.published && <span className="ml-2 text-xs text-amber-600">Draft</span>}</h2>
                <p className="text-xs text-gray-500">{g.category}{g.company ? ` · ${g.company.name}` : ''}</p>
                {g.summary && <p className="text-sm text-gray-700">{g.summary}</p>}
              </button>
              {staff && (
                <span className="text-xs space-x-3 whitespace-nowrap">
                  <button disabled={busy} className="text-indigo-600" onClick={() => act(() => api.patch(`/guides/${g.id}`, { published: !g.published }))}>{g.published ? 'Unpublish' : 'Publish'}</button>
                  <button disabled={busy} className="text-red-600" onClick={() => window.confirm('Delete this guide?') && act(() => api.delete(`/guides/${g.id}`))}>Delete</button>
                </span>
              )}
            </div>
            {open === g.id && <p className="text-sm text-gray-800 whitespace-pre-wrap mt-2 border-t pt-2">{g.body}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
