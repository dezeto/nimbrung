import { cn } from "@web/ui/lib/utils";

/**
 * The quiet credit line at the foot of a screen, so a guest who likes the jam
 * knows where to get Nimbrung for their own.
 */
export function MadeWith({ className = "" }: { className?: string }) {
  return (
    <p className={cn("text-center text-xs t-2", className)}>
      © {new Date().getFullYear()} Nimbrung · Host your own jam at{" "}
      <a
        href="https://nimbrung.dezeto.dev"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 hover:text-[var(--lg-ink)]"
      >
        nimbrung.dezeto.dev
      </a>
    </p>
  );
}
