import { useEffect, useState } from "react";
import { PipMark } from "./pip-mark";

/** How long a first answer can take before Pip says it's waking (DESIGN §9). */
export const WARMING_AFTER_MS = 3000;

/**
 * "Pip's warming up" (DESIGN §9, phase-6.md decision 7): no spinner that never
 * ends and nothing to tap. Built from the launch splash — the mark, the name's
 * type, one line — and replaced by the screen as soon as the answer arrives.
 */
export function WarmingUp({ after = WARMING_AFTER_MS }: { after?: number }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), after);
    return () => clearTimeout(timer);
  }, [after]);

  return (
    <div className="bg-ground text-ink grid min-h-svh place-items-center px-6" aria-busy="true">
      {slow ? (
        <div role="status" className="flex max-w-[300px] flex-col items-center gap-3.5 text-center">
          <PipMark size={56} className="motion-safe:animate-pulse [animation-duration:1.5s]" />
          <h1 className="font-heading m-0 text-[26px] font-normal">Pip's warming up</h1>
          <p className="text-ink2 m-0 text-[13.5px] leading-normal font-medium">
            Pip naps when nobody's looking, so the first look after a while takes up to a minute.
            This screen will change by itself.
          </p>
        </div>
      ) : null}
    </div>
  );
}
