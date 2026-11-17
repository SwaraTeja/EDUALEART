import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<'checking' | 'up' | 'down'>('checking');
  const [forgot, setForgot] = useState(false);
  const [info, setInfo] = useState<string>((useLocation().state as { message?: string } | null)?.message ?? '');
  const navigate = useNavigate();
  const { user, signIn } = useAuth();

  // Health check: tells the user up-front if the API (or its database) is unreachable.
  useEffect(() => {
    api.get('/health').then(() => setServer('up')).catch(() => setServer('down'));
  }, []);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      if (forgot) {
        await api.post('/auth/request-reset', { email });
        setInfo('If that e-mail is registered, a reset link has been sent.');
        setForgot(false);
      } else {
        await signIn(email, password);
        navigate('/');
      }
    } catch (err) {
      setError(errorMessage(err, forgot ? 'Could not send the reset e-mail' : 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-24 p-6 border rounded bg-white">
      <h1 className="text-xl font-semibold mb-4">{forgot ? 'Reset your password' : 'Sign in to EduAlert'}</h1>
      {server === 'down' && <div className="mb-3"><Notice kind="error">The server is unreachable right now. You can try again, but sign-in will fail until it is back.</Notice></div>}
      {info && <div className="mb-3"><Notice kind="success">{info}</Notice></div>}
      <form onSubmit={submit} className="space-y-3">
        <input className="w-full border rounded px-3 py-2" placeholder="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {!forgot && (
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <button className="w-full bg-indigo-600 disabled:opacity-50 text-white py-2 rounded" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : forgot ? 'Send reset link' : 'Log in'}
        </button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setForgot(!forgot); setError(''); }}>
          {forgot ? 'Back to sign in' : 'Forgot password?'}
        </button>
        <Link to="/register" className="text-indigo-600 hover:underline">Student sign-up</Link>
      </div>
    </div>
  );
}
