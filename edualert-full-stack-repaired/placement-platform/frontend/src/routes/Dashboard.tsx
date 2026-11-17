import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { Announcements } from '../components/Announcements';
import { Notice } from '../components/Notice';

const riskCls = (r: string) => (r === 'HIGH' ? 'text-red-600' : r === 'MEDIUM' ? 'text-amber-600' : 'text-green-600');

function StudentView() {
  const [profile, setProfile] = useState<any>(null);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [board, setBoard] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    // Each call reports its own failure — nothing is silently replaced by mock data.
    api.get('/students/me').then((r) => setProfile(r.data)).catch((e) => setError(errorMessage(e, 'Could not load your profile')));
    api.get('/courses/recommended/me').then((r) => setRecommended(r.data)).catch(() => setRecommended([]));
    api.get('/alerts?resolved=false').then((r) => setAlerts(r.data)).catch(() => setAlerts([]));
    api.get('/analytics/leaderboard').then((r) => setBoard(r.data)).catch(() => setBoard([]));
  }, []);

  if (error) return <div className="p-6 max-w-4xl mx-auto"><Notice kind="error">{error}</Notice></div>;
  if (!profile) return <div className="p-6">Loading…</div>;

  const latest = profile.scores?.[0];
  const skills = profile.skills;
  const bars: [string, number][] = skills
    ? [['DSA', skills.dsaPct], ['Aptitude', skills.aptitudePct], ['Communication', skills.communicationPct], ['Domain', skills.domainPct], ['Mock interviews', skills.mockInterviewPct]]
    : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Welcome, {profile.user?.firstName}</h1>

      <section className="mb-8 bg-white border rounded p-5">
        <h2 className="text-lg font-medium mb-1">Your Placement Readiness Score</h2>
        <p className="text-4xl font-bold text-indigo-600">{latest ? `${latest.placementScore.toFixed(1)}%` : '—'}</p>
        {latest ? <p className={`${riskCls(latest.riskLevel)} text-sm`}>{latest.riskLevel} risk</p> : <p className="text-sm text-gray-500">Your score appears once your academic details have been entered by the placement cell.</p>}
        <p className="text-xs text-gray-500 mt-2">CGPA {profile.cgpa} · {profile.backlogs} backlog(s) · {profile.branch}, year {profile.year}</p>
        {bars.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {bars.map(([label, v]) => (
              <div key={label} className="text-xs">
                <div className="flex justify-between"><span>{label}</span><span>{v}%</span></div>
                <div className="h-1.5 bg-gray-100 rounded"><div className="h-1.5 bg-indigo-500 rounded" style={{ width: `${Math.min(100, v)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-2">Alerts</h2>
          <div className="space-y-2">{alerts.map((a) => <div key={a.id} className="border rounded p-3 bg-white text-sm"><span className={`font-medium ${riskCls(a.level)}`}>{a.level}</span> — {a.message}</div>)}</div>
        </section>
      )}

      <Announcements canManage={false} />

      <section className="mb-8">
        <h2 className="text-lg font-medium mb-2">Recommended for you</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recommended.map((c) => (
            <Link key={c.id} to={`/course/${c.id}`} className="border rounded p-3 bg-white hover:shadow">
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-gray-500">{c.category}</p>
            </Link>
          ))}
          {recommended.length === 0 && <p className="text-sm text-gray-500">No recommendations yet.</p>}
        </div>
      </section>

      {board.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-2">Leaderboard</h2>
          <ol className="bg-white border rounded divide-y text-sm">
            {board.map((b) => (
              <li key={b.rank} className={`flex justify-between px-3 py-2 ${b.isYou ? 'bg-indigo-50 font-medium' : ''}`}>
                <span>{b.rank}. {b.displayName}{b.isYou ? ' (you)' : ''} <span className="text-gray-400">· {b.branch}</span></span>
                <span>{b.placementScore.toFixed(1)}%</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function StaffView() {
  const [sum, setSum] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api.get('/analytics/summary'), api.get('/alerts?resolved=false'), api.get('/analytics/branch-breakdown')])
      .then(([s, a, b]) => { setSum(s.data); setAlerts(a.data); setBranches(b.data); setError(''); })
      .catch((e) => setError(errorMessage(e, 'Could not load dashboard data')));
  }, []);
  useEffect(load, [load]);

  const resolve = async (id: string) => {
    try { await api.patch(`/alerts/${id}/resolve`); load(); } catch (e) { setError(errorMessage(e)); }
  };

  if (error && !sum) return <div className="p-6 max-w-4xl mx-auto"><Notice kind="error">{error}</Notice></div>;
  if (!sum) return <div className="p-6">Loading…</div>;

  const Card = ({ label, value, cls = '' }: { label: string; value: number | string; cls?: string }) => (
    <div className="border rounded p-4 bg-white"><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold ${cls}`}>{value}</p></div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Placement cell overview</h1>
      {error && <div className="mb-3"><Notice kind="error">{error}</Notice></div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Card label="Students" value={sum.students} />
        <Card label="High risk" value={sum.riskDistribution.HIGH} cls="text-red-600" />
        <Card label="Open alerts" value={sum.openAlerts} cls="text-amber-600" />
        <Card label="Placed" value={sum.applications.SELECTED ?? 0} cls="text-green-600" />
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-medium mb-2">Open alerts</h2>
        {alerts.length === 0 && <p className="text-sm text-gray-500">No open alerts.</p>}
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="border rounded p-3 bg-white text-sm flex justify-between gap-3">
              <span><span className={`font-medium ${riskCls(a.level)}`}>{a.level}</span> · {a.student.user.firstName} {a.student.user.lastName} ({a.student.rollNumber}) — {a.message}</span>
              <button className="text-indigo-600 whitespace-nowrap" onClick={() => resolve(a.id)}>Resolve</button>
            </div>
          ))}
        </div>
      </section>

      {branches.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-2">By branch</h2>
          <div className="bg-white border rounded divide-y text-sm">
            {branches.map((b) => <div key={b.branch} className="flex justify-between px-3 py-2"><span>{b.branch}</span><span className="text-gray-600">{b.studentCount} students · avg CGPA {b.avgCgpa}</span></div>)}
          </div>
        </section>
      )}

      <Announcements canManage />
    </div>
  );
}

function MentorView() {
  const { user } = useAuth();
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Welcome, {user?.firstName}</h1>
      <p className="text-sm mb-6"><Link to="/booking" className="text-indigo-600 hover:underline">Manage your availability and sessions →</Link></p>
      <Announcements canManage={false} />
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  if (user?.role === 'STUDENT') return <StudentView />;
  if (isStaff(user?.role)) return <StaffView />;
  return <MentorView />;
}
