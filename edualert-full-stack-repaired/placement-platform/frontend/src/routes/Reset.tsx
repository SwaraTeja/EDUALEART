import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { Notice } from '../components/Notice';

/** Landing page for e-mailed links: password reset AND first-time "set your password" for provisioned accounts. */
export function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, newPassword: pw });
      navigate('/login', { state: { message: 'Password saved. You can sign in now.' } });
    } catch (err) {
      setError(errorMessage(err, 'Could not save the password'));
    } finally {
      setBusy(false);
    }
  };

  if (!token) return <div className="max-w-sm mx-auto mt-24"><Notice kind="error">This link is missing its token. Request a new one from the sign-in page.</Notice></div>;

  return (
    <div className="max-w-sm mx-auto mt-24 p-6 border rounded bg-white">
      <h1 className="text-xl font-semibold mb-4">Choose a new password</h1>
      <form onSubmit={submit} className="space-y-3">
        <input className="w-full border rounded px-3 py-2" type="password" placeholder="New password (min 8 characters)" minLength={8} maxLength={72} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="w-full border rounded px-3 py-2" type="password" placeholder="Repeat password" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {error && <Notice kind="error">{error}</Notice>}
        <button className="w-full bg-indigo-600 disabled:opacity-50 text-white py-2 rounded" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
      <p className="mt-4 text-sm"><Link to="/login" className="text-indigo-600 hover:underline">Back to sign in</Link></p>
    </div>
  );
}
