import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Notice } from '../components/Notice';

const REPORT_EVERY_MS = 10_000;

export function CoursePlayer() {
  const { id } = useParams();
  const { user } = useAuth();
  const isStudent = user?.role === 'STUDENT';
  const [course, setCourse] = useState<any>(null);
  const [progress, setProgress] = useState<Record<string, { watchedSeconds: number; completedAt: string | null }>>({});
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReport = useRef(0);

  useEffect(() => {
    api.get(`/courses/${id}`)
      .then((r) => { setCourse(r.data); setActiveLessonId(r.data.lessons?.[0]?.id ?? null); })
      .catch((e) => setError(errorMessage(e, 'Could not load this lecture')));
    if (isStudent) {
      api.get(`/courses/${id}/progress`).then((r) => setProgress(Object.fromEntries(r.data.map((p: any) => [p.lessonId, p])))).catch(() => {});
    }
  }, [id, isStudent]);

  const activeLesson = course?.lessons.find((l: any) => l.id === activeLessonId);

  // Throttled: the browser fires timeupdate ~4×/s; we report at most once per 10s (+ on pause / end).
  const report = useCallback((force = false) => {
    const v = videoRef.current;
    if (!isStudent || !v || !activeLessonId) return;
    const now = Date.now();
    if (!force && now - lastReport.current < REPORT_EVERY_MS) return;
    lastReport.current = now;
    api.post('/courses/lesson-progress', { lessonId: activeLessonId, watchedSeconds: Math.floor(v.currentTime) })
      .then((r) => setProgress((p) => ({ ...p, [activeLessonId]: r.data })))
      .catch((e) => setError(errorMessage(e, 'Could not save your progress')));
  }, [isStudent, activeLessonId]);

  const resume = () => {
    const w = progress[activeLessonId ?? '']?.watchedSeconds;
    if (videoRef.current && w && !progress[activeLessonId ?? '']?.completedAt) videoRef.current.currentTime = w;
  };

  const openQuiz = async (quizId: string) => {
    setResult(null); setAnswers({});
    try { setQuiz((await api.get(`/courses/quizzes/${quizId}`)).data); } catch (e) { setError(errorMessage(e, 'Could not load the quiz')); }
  };
  const submitQuiz = async () => {
    try {
      const body = { quizId: quiz.id, answers: Object.entries(answers).map(([questionId, chosenIndex]) => ({ questionId, chosenIndex })) };
      setResult((await api.post('/courses/quiz-attempt', body)).data);
    } catch (e) { setError(errorMessage(e, 'Could not submit the quiz')); }
  };
  const certificate = async () => {
    setError(''); setMsg('');
    try { const r = await api.post(`/courses/${id}/certificate`); setMsg(`Certificate issued: ${r.data.certificateUrl}`); } catch (e) { setError(errorMessage(e)); }
  };

  if (error && !course) return <div className="p-6 max-w-3xl mx-auto"><Notice kind="error">{error}</Notice></div>;
  if (!course) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2">
        <h1 className="text-xl font-semibold mb-2">{course.title}</h1>
        <div className="space-y-2 mb-2">{error && <Notice kind="error">{error}</Notice>}{msg && <Notice kind="success"><span className="break-all">{msg}</span></Notice>}</div>
        {activeLesson && (
          <video ref={videoRef} key={activeLesson.id} src={activeLesson.videoUrl} controls className="w-full rounded bg-black"
            onLoadedMetadata={resume} onTimeUpdate={() => report()} onPause={() => report(true)} onEnded={() => report(true)} />
        )}
        <p className="text-sm text-gray-600 mt-2">{course.description}</p>
        {isStudent && <button onClick={certificate} className="mt-3 text-sm text-indigo-600 hover:underline">Get certificate (after completing all lessons)</button>}

        {activeLesson?.quizzes?.length > 0 && isStudent && (
          <div className="mt-4 border rounded bg-white p-3">
            {activeLesson.quizzes.map((q: any) => <button key={q.id} onClick={() => openQuiz(q.id)} className="text-sm text-indigo-600 mr-4">Take quiz: {q.title}</button>)}
            {quiz && activeLesson.quizzes.some((q: any) => q.id === quiz.id) && (
              <div className="mt-3 space-y-3">
                {quiz.questions.map((q: any, i: number) => (
                  <fieldset key={q.id}>
                    <legend className="text-sm font-medium">{i + 1}. {q.text}</legend>
                    {q.options.map((o: string, oi: number) => (
                      <label key={oi} className="block text-sm"><input type="radio" name={q.id} className="mr-2" checked={answers[q.id] === oi} onChange={() => setAnswers({ ...answers, [q.id]: oi })} />{o}</label>
                    ))}
                  </fieldset>
                ))}
                <button onClick={submitQuiz} className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm">Submit</button>
                {result && <Notice kind="info">Score: {result.score.toFixed(0)}% ({result.correct}/{result.total} correct)</Notice>}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-medium mb-2">Lessons</h2>
        <ul className="space-y-1">
          {course.lessons.map((l: any) => (
            <li key={l.id}>
              <button onClick={() => { setActiveLessonId(l.id); setQuiz(null); lastReport.current = 0; }}
                className={`w-full text-left px-3 py-2 rounded ${l.id === activeLessonId ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100'}`}>
                {progress[l.id]?.completedAt ? '✓ ' : ''}{l.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
