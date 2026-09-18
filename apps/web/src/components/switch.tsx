import type { ReactNode } from "react";

/**
 * A switch row (DESIGN §10.1): the whole row is the tap target, the switch
 * carries `role="switch"`. 42×25 track, 20px knob sliding over 140ms — the
 * one new motion. On is `solid`; off is ink at low strength.
 */
export function SwitchRow({
  label,
  detail,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  detail?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="text-ink flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 py-1 text-left disabled:cursor-default disabled:opacity-45"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-bold">{label}</span>
        {detail ? (
          <span className="text-ink2 text-[12.5px] leading-snug font-medium">{detail}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={`relative h-[25px] w-[42px] flex-none rounded-full transition-colors duration-[140ms] ${checked ? "bg-solid" : "bg-ink/20"}`}
      >
        <span
          className={`absolute top-[2.5px] h-5 w-5 rounded-full transition-[left] duration-[140ms] motion-reduce:transition-none ${checked ? "bg-solid-ink left-[19.5px]" : "bg-card left-[2.5px]"}`}
        />
      </span>
    </button>
  );
}
