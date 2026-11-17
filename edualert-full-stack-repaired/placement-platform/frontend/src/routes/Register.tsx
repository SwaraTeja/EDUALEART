import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { Notice } from '../components/Notice';

/** Public sign-up creates STUDENT accounts only. Officers / mentors / admins are provisioned by an admin. */
export function Register() {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', password: '', rollNumber: '', branch: '', year: '1' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.post('/auth/signup', { ...f, year: Number(f.year) });
      navigate('/login', { state: { message: 'Account created. You can sign in now.' } });
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account'));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full border rounded px-3 py-2';
  return (
    <div className="max-w-sm mx-auto mt-16 p-6 border rounded bg-white">
      <h1 className="text-xl font-semibold mb-1">Create a student account</h1>
      <p className="text-xs text-gray-500 mb-4">TPC officer and mentor accounts are created by an administrator.</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          <input className={input} placeholder="First name" required value={f.firstName} onChange={set('firstName')} />
          <input className={input} placeholder="Last name" required value={f.lastName} onChange={set('lastName')} />
        </div>
        <input className={input} type="email" placeholder="Email" required value={f.email} onChange={set('email')} />
        <input className={input} type="password" placeholder="Password (min 8 characters)" minLength={8} maxLength={72} required autoComplete="new-password" value={f.password} onChange={set('password')} />
        <input className={input} placeholder="Roll number" required value={f.rollNumber} onChange={set('rollNumber')} />
        <div className="flex gap-2">
          <input className={input} placeholder="Branch (e.g. CSE)" required value={f.branch} onChange={set('branch')} />
          <input className={input} type="number" min={1} max={6} placeholder="Year" required value={f.year} onChange={set('year')} />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="w-full bg-indigo-600 disabled:opacity-50 text-white py-2 rounded" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
      <p className="mt-4 text-sm"><Link to="/login" className="text-indigo-600 hover:underline">Back to sign in</Link></p>
    </div>
  );
}
