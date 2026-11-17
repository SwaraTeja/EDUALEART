import { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { Register } from './routes/Register';
import { Reset } from './routes/Reset';
import { CoursePlayer } from './routes/CoursePlayer';
import { Courses } from './routes/Courses';
import { MentorBooking } from './routes/MentorBooking';
import { Companies } from './routes/Companies';
import { Students } from './routes/Students';
import { Admin } from './routes/Admin';
import { Roadmaps } from './routes/Roadmaps';
import { Guides } from './routes/Guides';
import { Tips } from './routes/Tips';
import { Chat } from './components/Chat';
import { Navbar } from './components/Navbar';

const Guard = ({ children }: { children: ReactNode }) => <RequireAuth>{children}</RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/" element={<Guard><Dashboard /></Guard>} />
          <Route path="/chat" element={<Guard><Chat /></Guard>} />
          <Route path="/courses" element={<Guard><Courses /></Guard>} />
          <Route path="/course/:id" element={<Guard><CoursePlayer /></Guard>} />
          <Route path="/booking" element={<Guard><MentorBooking /></Guard>} />
          <Route path="/drives" element={<Guard><Companies /></Guard>} />
          <Route path="/roadmaps" element={<Guard><Roadmaps /></Guard>} />
          <Route path="/guides" element={<Guard><Guides /></Guard>} />
          <Route path="/tips" element={<Guard><Tips /></Guard>} />
          <Route path="/students" element={<RequireAuth roles={['TPC_OFFICER', 'ADMIN']}><Students /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth roles={['ADMIN']}><Admin /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
