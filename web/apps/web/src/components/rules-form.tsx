import { Minus, Plus } from "lucide-react";

import type { Rules } from "@/api/client";

type Props = { rules: Rules; saving: boolean; onSave: (rules: Rules) => void };

const STEPPER_MAX = 20;

/**
 * House rules as settings rows: each change saves right away, like the
 * system Settings app, so there is no Save button to forget.
 */
export function RulesForm({ rules, saving, onSave }: Props) {
  const set = (change: Partial<Rules>) => onSave({ ...rules, ...change });

  return (
    <div className="grid" aria-busy={saving}>
      <Row label="Songs per guest per minute" hint="0 = no limit. You’re never limited.">
        <Stepper
          label="Songs per guest per minute"
          value={rules.maxAddsPerMinute}
          onChange={(maxAddsPerMinute) => set({ maxAddsPerMinute })}
        />
      </Row>
      <Row label="Votes needed to skip" hint="0 = only you can skip.">
        <Stepper
          label="Votes needed to skip"
          value={rules.skipVotesNeeded}
          onChange={(skipVotesNeeded) => set({ skipVotesNeeded })}
        />
      </Row>
      <Row label="Ask to join" hint="New guests wait until you let them in. Turning it off lets everyone waiting in.">
        <button
          type="button"
          role="switch"
          aria-checked={rules.askToJoin}
          aria-label="Ask to join"
          className="switch"
          onClick={() => set({ askToJoin: !rules.askToJoin })}
        />
      </Row>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[var(--nb-separator)] py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-[15px] font-medium">{label}</p>
        {children}
      </div>
      <p className="text-xs t-2">{hint}</p>
    </div>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div role="group" aria-label={label} className="seg-group shrink-0">
      <button type="button" aria-label="Fewer" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <Minus className="size-4" aria-hidden />
      </button>
      <span aria-live="polite" className="w-6 text-center text-[15px] font-semibold tabular-nums">
        {value}
      </span>
      <button type="button" aria-label="More" disabled={value >= STEPPER_MAX} onClick={() => onChange(value + 1)}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
