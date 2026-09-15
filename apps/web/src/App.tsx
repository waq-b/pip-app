import { BUCKETS } from "@finance-app/shared";

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">finance-app-personal</h1>
      <p className="text-slate-400">
        Phase 0 scaffold placeholder — real screens arrive in Phase 1.
      </p>
      <ul className="flex gap-3 text-sm text-slate-300">
        {BUCKETS.map((bucket) => (
          <li key={bucket} className="rounded border border-slate-700 px-3 py-1">
            {bucket}
          </li>
        ))}
      </ul>
    </main>
  );
}

export default App;
