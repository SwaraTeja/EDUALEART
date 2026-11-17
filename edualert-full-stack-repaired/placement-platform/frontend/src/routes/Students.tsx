import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { Notice } from '../components/Notice';

interface Row { id: string; rollNumber: string; branch: string; year: number; cgpa: number; backlogs: number; user: { firstName: string; lastName: string; email: string }; scores: { placementScore: number; riskLevel: string }[] }
const blank = { firstName: '', lastName: '', email: '', rollNumber: '', branch: '', year: '1', cgpa: '', backlogs: '0' };
const LIMIT = 15;

export function Students() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search.trim()) q.set('search', search.trim());
    if (risk) q.set('riskLevel', risk);
    api.get(`/students?${q}`)
      .then((r) => { setRows(r.data); setTotal(Number(r.headers['x-total-count'] ?? r.data.length)); setError(''); })
      .catch((e) => setError(errorMessage(e, 'Could not load students')))
      .finally(() => setLoading(false));
  }, [page, search, risk]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setError(''); setOk('');
    const body = { ...form, year: Number(form.year), cgpa: Number(form.cgpa), backlogs: Number(form.backlogs) };
    try {
      if (editing) {
        const { email: _e, ...patch } = body; // e-mail is the login identity and is not editable here
        await api.patch(`/students/${editing}`, patch);
        setOk('Student updated.');
      } else {
        const r = await api.post('/students', body);
        setOk(r.data.setPasswordUrl
          ? `Student added. E-mail is not configured, so give them this one-time link to set a password: ${r.data.setPasswordUrl}`
          : 'Student added. A set-password link was e-mailed to them.');
      }
      setForm(null); setEditing(null); load(); // re-fetch: the list always reflects what the DB actually holds
    } catch (err) {
      setError(errorMessage(err, 'Could not save the student'));
    } finally { setBusy(false); }
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete ${r.user.firstName} ${r.user.lastName} (${r.rollNumber}) and all their data? This cannot be undone.`)) return;
    setError(''); setOk('');
    try { await api.delete(`/students/${r.id}`); setOk('Student deleted.'); if (rows.length === 1 && page > 1) setPage(page - 1); else load(); }
    catch (err) { setError(errorMessage(err, 'Could not delete the student')); }
  };

  const edit = (r: Row) => {
    setEditing(r.id);
    setForm({ firstName: r.user.firstName, lastName: r.user.lastName, email: r.user.email, rollNumber: r.rollNumber, branch: r.branch, year: String(r.year), cgpa: String(r.cgpa), backlogs: String(r.backlogs) });
  };

  const inp = 'border rounded px-2 py-1.5 text-sm w-full';
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-semibold">Students <span className="text-sm text-gray-500 font-normal">({total})</span></h1>
        <button className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setEditing(null); setForm({ ...blank }); }}>Add student</button>
      </div>

      <div className="space-y-2 mb-3">
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="success"><span className="break-all">{ok}</span></Notice>}
      </div>

      {form && (
        <form onSubmit={save} className="border rounded p-4 bg-white mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={inp} placeholder="First name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input className={inp} placeholder="Last name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <input className={`${inp} col-span-2`} type="email" placeholder="Email" required disabled={!!editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={inp} placeholder="Roll number" required value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
          <input className={inp} placeholder="Branch" required value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
          <input className={inp} type="number" min={1} max={6} placeholder="Year" required value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          <input className={inp} type="number" min={0} max={10} step="0.01" placeholder="CGPA" required value={form.cgpa} onChange={(e) => setForm({ ...form, cgpa: e.target.value })} />
          <input className={inp} type="number" min={0} placeholder="Backlogs" required value={form.backlogs} onChange={(e) => setForm({ ...form, backlogs: e.target.value })} />
          <div className="col-span-2 md:col-span-4 flex gap-2 justify-end">
            <button type="button" className="px-3 py-1.5 text-sm text-gray-600" onClick={() => { setForm(null); setEditing(null); }}>Cancel</button>
            <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">{busy ? 'Saving…' : editing ? 'Save changes' : 'Create student'}</button>
          </div>
        </form>
      )}

      <div className="flex gap-2 mb-3">
        <input className={inp} placeholder="Search name, roll number, e-mail…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="border rounded px-2 py-1.5 text-sm" value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1); }}>
          <option value="">All risk levels</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
        </select>
      </div>

      <div className="bg-white border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b"><tr><th className="p-2">Roll</th><th className="p-2">Name</th><th className="p-2">Branch</th><th className="p-2">CGPA</th><th className="p-2">Score</th><th className="p-2" /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = r.scores[0];
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2">{r.rollNumber}</td>
                  <td className="p-2">{r.user.firstName} {r.user.lastName}<div className="text-xs text-gray-400">{r.user.email}</div></td>
                  <td className="p-2">{r.branch} · Y{r.year}</td>
                  <td className="p-2">{r.cgpa}{r.backlogs ? <span className="text-xs text-red-600"> ({r.backlogs} bl)</span> : null}</td>
                  <td className="p-2">{s ? <span className={s.riskLevel === 'HIGH' ? 'text-red-600' : s.riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-green-600'}>{s.placementScore.toFixed(0)}% {s.riskLevel}</span> : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap space-x-3"><button className="text-indigo-600" onClick={() => edit(r)}>Edit</button><button className="text-red-600" onClick={() => remove(r)}>Delete</button></td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">No students found.</td></tr>}
            {loading && <tr><td colSpan={6} className="p-4 text-center text-gray-400">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 text-sm">
        <button disabled={page <= 1} className="disabled:opacity-40 text-indigo-600" onClick={() => setPage(page - 1)}>← Previous</button>
        <span className="text-gray-500">Page {page} of {pages}</span>
        <button disabled={page >= pages} className="disabled:opacity-40 text-indigo-600" onClick={() => setPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}
