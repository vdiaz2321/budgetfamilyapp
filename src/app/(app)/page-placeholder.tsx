export default function PagePlaceholder({
  title,
  blurb,
  step,
}: {
  title: string;
  blurb: string;
  step?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {step ? (
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
            {step}
          </span>
        ) : null}
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted">{blurb}</p>

      <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          Coming up in the build
        </p>
        <p className="mt-1 text-sm text-muted">
          This screen is next in line — the shell and navigation are ready.
        </p>
      </div>
    </div>
  );
}
