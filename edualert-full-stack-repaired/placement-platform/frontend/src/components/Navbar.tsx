import { Link, useNavigate } from 'react-router-dom';
import { isStaff, roleLabel, useAuth } from '../lib/auth';

export function Navbar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  if (!user) return null;

  const logout = async () => { await signOut(); navigate('/login'); };
  const link = 'text-sm text-gray-700 hover:text-indigo-600';

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b bg-white">
      <div className="flex flex-wrap gap-x-6 gap-y-1 items-center">
        <Link to="/" className="font-bold text-indigo-600">EduAlert</Link>
        <Link to="/" className={link}>Dashboard</Link>
        {isStaff(user.role) && <Link to="/students" className={link}>Students</Link>}
        <Link to="/drives" className={link}>Drives</Link>
        <Link to="/courses" className={link}>Lectures</Link>
        <Link to="/roadmaps" className={link}>Roadmaps</Link>
        <Link to="/guides" className={link}>Guides</Link>
        <Link to="/tips" className={link}>Tips</Link>
        <Link to="/booking" className={link}>Mentors</Link>
        <Link to="/chat" className={link}>AI Assistant</Link>
        {user.role === 'ADMIN' && <Link to="/admin" className={link}>Users</Link>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">{user.firstName} · {roleLabel[user.role]}</span>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-red-600">Log out</button>
      </div>
    </nav>
  );
}
