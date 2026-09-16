/**
 * Stands in for a screen until its own task builds it. Deliberately plain: the
 * responsive shell arrives in task 13 and the screens in tasks 15–20, so
 * anything richer here would only be thrown away.
 */
export function Placeholder({ name }: { name: string }) {
  return (
    <main className="p-6">
      <h1 className="font-heading text-2xl">{name}</h1>
      <p className="text-ink2 mt-2 text-sm">Not built yet — see docs/phases/phase-1.md.</p>
    </main>
  );
}
