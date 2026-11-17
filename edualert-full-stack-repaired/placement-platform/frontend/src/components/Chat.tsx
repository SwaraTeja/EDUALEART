import { useEffect, useRef, useState } from 'react';
import api, { errorMessage, tokens } from '../lib/api';
import { API_BASE } from '../lib/config';
import { Notice } from './Notice';

interface Message { role: 'user' | 'assistant'; text: string }

export function Chat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/ai/session')
      .then(async (res) => {
        setSessionId(res.data.sessionId);
        const history = await api.get(`/ai/session/${res.data.sessionId}/messages`);
        setMessages(history.data.map((m: any) => ({ role: m.role.toLowerCase(), text: m.content })));
      })
      .catch((e) => setError(errorMessage(e, 'Could not start the assistant')));
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!sessionId || !text || sending) return;
    setSending(true); setError(''); setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: '' }]);
    const append = (delta: string) => setMessages((prev) => { const next = [...prev]; const last = next[next.length - 1]; next[next.length - 1] = { ...last, text: last.text + delta }; return next; });
    const dropEmptyReply = () => setMessages((prev) => (prev[prev.length - 1]?.text === '' ? prev.slice(0, -1) : prev));

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // fetch (not EventSource) so the JWT goes in the Authorization header instead of the URL.
      const res = await fetch(`${API_BASE}/ai/chat/${sessionId}`, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access}` },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The assistant is unavailable (HTTP ${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.text) append(data.text);
          if (data.error) { setError(data.error); dropEmptyReply(); }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e instanceof TypeError ? 'Cannot reach the server. Check your connection and try again.' : e.message);
        dropEmptyReply();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">AI Placement Assistant</h1>
      <div className="border rounded h-96 overflow-y-auto p-3 space-y-3 bg-white">
        {messages.length === 0 && !error && <p className="text-sm text-gray-400">Ask about your placement readiness, what to study next, or how to prepare for interviews.</p>}
        {messages.map((m, i) => (
          <p key={i} className={`whitespace-pre-wrap ${m.role === 'assistant' ? 'text-indigo-700' : 'text-gray-800'}`}>
            <strong>{m.role === 'assistant' ? 'Assistant' : 'You'}:</strong> {m.text}
          </p>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <div className="mt-2"><Notice kind="error">{error}</Notice></div>}
      <div className="mt-3 flex gap-2">
        <input className="flex-1 border rounded px-3 py-2" value={input} maxLength={2000} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="Ask about your placement readiness..." disabled={sending || !sessionId} />
        <button className="bg-indigo-600 disabled:opacity-50 text-white px-4 rounded" onClick={sendMessage} disabled={sending || !sessionId}>{sending ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
