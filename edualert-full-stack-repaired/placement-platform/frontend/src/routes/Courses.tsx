import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { Notice } from '../components/Notice';

const cats = ['', 'DSA', 'APTITUDE', 'COMMUNICATION', 'DOMAIN', 'HR'];

export function Courses() {
  const [courses, setCourses] = useState<any[] | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams();
      if (category) q.set('category', category);
      if (search.trim()) q.set('search', search.trim());
      api.get(`/courses?${q}`).then((r) => { setCourses(r.data); setError(''); }).catch((e) => setError(errorMessage(e, 'Could not load lectures')));
    }, 250);
    return () => clearTimeout(t);
  }, [category, search]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Lectures</h1>
      <div className="flex gap-2 mb-4">
        <input className="flex-1 border rounded px-3 py-1.5 text-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="border rounded px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c || 'All categories'}</option>)}</select>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {courses === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {courses?.length === 0 && <p className="text-sm text-gray-500">No lectures found.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {courses?.map((c) => (
          <Link key={c.id} to={`/course/${c.id}`} className="border rounded p-3 bg-white hover:shadow">
            <h2 className="font-semibold">{c.title}</h2>
            <p className="text-sm text-gray-500">{c.category} · {c.lessons.length} lesson(s){c.durationMinutes ? ` · ${c.durationMinutes} min` : ''}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
