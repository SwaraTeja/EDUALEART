import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../lib/api';
import { roleLabel, Role, useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

/** Admin-only: the supported way to create TPC officer / mentor / admin accounts. */
export function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [f, setF] = useState({ email: '', firstName: '', lastName: '', role: 'TPC_OFFICER' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/admin/users').then((r) => setUsers(r.data)).catch((e) => setError(errorMessage(e, 'Could not load users')));
  }, []);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setOk('');
    try {
      const r = await api.post('/admin/users', f);
      setOk(r.data.emailed ? `Account created. A set-password link was e-mailed to ${r.data.email}.` : `Account created. E-mail is not configured — give ${r.data.email} this single-use link (valid 72h): ${r.data.setPasswordUrl}`);
      setF({ ...f, email: '', firstName: '', lastName: '' }); load();
    } catch (err) { setError(errorMessage(err, 'Could not create the account')); } finally { setBusy(false); }
  };
  const toggle = async (id: string, isActive: boolean) => {
    setError(''); setOk('');
    try { await api.patch(`/admin/users/${id}`, { isActive }); load(); } catch (err) { setError(errorMessage(err)); }
  };

  const inp = 'border rounded px-2 py-1.5 text-sm w-full';
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">User accounts</h1>
      <div className="space-y-2 mb-3">{error && <Notice kind="error">{error}</Notice>}{ok && <Notice kind="success"><span className="break-all">{ok}</span></Notice>}</div>
      <form onSubmit={create} className="border rounded p-4 bg-white mb-6 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <input className={inp} placeholder="First name" required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        <input className={inp} placeholder="Last name" required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        <input className={`${inp} col-span-2 md:col-span-1`} type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select className={inp} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="TPC_OFFICER">TPC Officer</option><option value="MENTOR">Mentor</option><option value="ADMIN">Admin</option>
        </select>
        <button disabled={busy} className="bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <div className="bg-white border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b"><tr><th className="p-2">Name</th><th className="p-2">Role</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="p-2">{u.firstName} {u.lastName}<div className="text-xs text-gray-400">{u.email}</div></td>
                <td className="p-2">{roleLabel[u.role as Role]}</td>
                <td className="p-2">{u.isActive ? 'Active' : <span className="text-red-600">Disabled</span>}{!u.lastLoginAt && <span className="text-xs text-gray-400"> · never signed in</span>}</td>
                <td className="p-2 text-right">{u.id !== me?.id && <button className={u.isActive ? 'text-red-600' : 'text-indigo-600'} onClick={() => toggle(u.id, !u.isActive)}>{u.isActive ? 'Disable' : 'Enable'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
