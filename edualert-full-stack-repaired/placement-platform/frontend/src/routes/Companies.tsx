import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

const blank = { name: '', sector: '', minCgpa: '', maxBacklogs: '', eligibleBranches: '', status: 'UPCOMING', driveDate: '' };
const statuses = ['APPLIED', 'SHORTLISTED', 'SELECTED', 'REJECTED'];

export function Companies() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const student = user?.role === 'STUDENT';
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<{ id: string; rows: any[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/companies').then((r) => { setList(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load drives')));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setOk('');
    try { await fn(); setOk(success); load(); return true; } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const body = {
      name: form.name, sector: form.sector || null, status: form.status,
      minCgpa: form.minCgpa === '' ? null : Number(form.minCgpa),
      maxBacklogs: form.maxBacklogs === '' ? null : Number(form.maxBacklogs),
      eligibleBranches: form.eligibleBranches.split(',').map((s) => s.trim()).filter(Boolean),
      driveDate: form.driveDate ? new Date(form.driveDate).toISOString() : null,
    };
    const done = await run(() => (editing ? api.patch(`/companies/${editing}`, body) : api.post('/companies', body)), editing ? 'Drive updated.' : 'Drive created.');
    if (done) { setForm(null); setEditing(null); }
  };

  const edit = (c: any) => {
    setEditing(c.id);
    setForm({ name: c.name, sector: c.sector ?? '', minCgpa: c.minCgpa ?? '', maxBacklogs: c.maxBacklogs ?? '', eligibleBranches: c.eligibleBranches.join(', '), status: c.status, driveDate: c.driveDate ? c.driveDate.slice(0, 10) : '' });
  };

  const showApplicants = async (id: string) => {
    if (applicants?.id === id) return setApplicants(null);
    try { setApplicants({ id, rows: (await api.get(`/companies/${id}/applications`)).data }); } catch (e) { setError(errorMessage(e)); }
  };
  const setStatus = async (appId: string, status: string, companyId: string) => {
    if (await run(() => api.patch(`/companies/applications/${appId}`, { status }), 'Application updated.')) setApplicants({ id: companyId, rows: (await api.get(`/companies/${companyId}/applications`)).data });
  };

  const inp = 'border rounded px-2 py-1.5 text-sm w-full';
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Placement drives</h1>
        {staff && <button className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm" onClick={() => { setEditing(null); setForm({ ...blank }); }}>Add drive</button>}
      </div>
      <div className="space-y-2 mb-3">{error && <Notice kind="error">{error}</Notice>}{ok && <Notice kind="success">{ok}</Notice>}</div>

      {form && (
        <form onSubmit={save} className="border rounded p-4 bg-white mb-4 grid grid-cols-2 md:grid-cols-3 gap-2">
          <input className={inp} placeholder="Company" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inp} placeholder="Sector" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />
          <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>UPCOMING</option><option>OPEN</option><option>CLOSED</option></select>
          <input className={inp} type="number" min={0} max={10} step="0.1" placeholder="Min CGPA" value={form.minCgpa} onChange={(e) => setForm({ ...form, minCgpa: e.target.value })} />
          <input className={inp} type="number" min={0} placeholder="Max backlogs" value={form.maxBacklogs} onChange={(e) => setForm({ ...form, maxBacklogs: e.target.value })} />
          <input className={inp} type="date" value={form.driveDate} onChange={(e) => setForm({ ...form, driveDate: e.target.value })} />
          <input className={`${inp} col-span-2 md:col-span-3`} placeholder="Eligible branches, comma separated (blank = all)" value={form.eligibleBranches} onChange={(e) => setForm({ ...form, eligibleBranches: e.target.value })} />
          <div className="col-span-2 md:col-span-3 flex justify-end gap-2">
            <button type="button" className="px-3 py-1.5 text-sm text-gray-600" onClick={() => { setForm(null); setEditing(null); }}>Cancel</button>
            <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">{editing ? 'Save changes' : 'Create drive'}</button>
          </div>
        </form>
      )}

      {list === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-gray-500">No drives yet.</p>}
      <div className="space-y-3">
        {list?.map((c) => (
          <div key={c.id} className="border rounded p-4 bg-white">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <h2 className="font-semibold">{c.name} <span className="text-xs font-normal text-gray-500">{c.sector}</span></h2>
                <p className="text-xs text-gray-500">
                  {c.status} {c.driveDate && `· ${new Date(c.driveDate).toLocaleDateString()}`} · {c.minCgpa != null ? `CGPA ≥ ${c.minCgpa}` : 'any CGPA'} · {c.maxBacklogs != null ? `≤ ${c.maxBacklogs} backlogs` : 'any backlogs'} · {c.eligibleBranches.length ? c.eligibleBranches.join('/') : 'all branches'}
                </p>
              </div>
              <div className="text-sm space-x-3 whitespace-nowrap">
                {student && c.myApplication && <span className="text-indigo-700">Applied · {c.myApplication.status}</span>}
                {student && !c.myApplication && c.status !== 'CLOSED' && (
                  <button disabled={busy || !c.eligibility?.eligible} className="bg-indigo-600 disabled:opacity-40 text-white px-3 py-1 rounded" onClick={() => run(() => api.post(`/companies/${c.id}/apply`), `Applied to ${c.name}.`)}>Apply</button>
                )}
                {student && c.myApplication?.status === 'APPLIED' && <button className="text-red-600" onClick={() => run(() => api.delete(`/companies/${c.id}/apply`), 'Application withdrawn.')}>Withdraw</button>}
                {staff && <><button className="text-indigo-600" onClick={() => showApplicants(c.id)}>Applicants</button><button className="text-indigo-600" onClick={() => edit(c)}>Edit</button>
                  <button className="text-red-600" onClick={() => window.confirm(`Delete ${c.name} and its applications?`) && run(() => api.delete(`/companies/${c.id}`), 'Drive deleted.')}>Delete</button></>}
              </div>
            </div>
            {student && c.eligibility && !c.eligibility.eligible && !c.myApplication && <p className="text-xs text-amber-700 mt-1">Not eligible: {c.eligibility.reasons.join('; ')}</p>}
            {applicants && applicants.id === c.id && (
              <div className="mt-3 border-t pt-2 text-sm">
                {applicants.rows.length === 0 && <p className="text-gray-500">No applicants yet.</p>}
                {applicants.rows.map((a) => (
                  <div key={a.id} className="flex justify-between items-center py-1">
                    <span>{a.student.user.firstName} {a.student.user.lastName} <span className="text-xs text-gray-400">{a.student.rollNumber}</span></span>
                    <select className="border rounded px-2 py-1 text-xs" value={a.status} onChange={(e) => setStatus(a.id, e.target.value, c.id)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
