export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const cls = kind === 'error' ? 'text-red-700 bg-red-50 border-red-200' : kind === 'success' ? 'text-green-700 bg-green-50 border-green-200' : 'text-indigo-700 bg-indigo-50 border-indigo-200';
  return <p role={kind === 'error' ? 'alert' : 'status'} className={`text-sm border rounded px-3 py-2 ${cls}`}>{children}</p>;
}
