export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-9 w-40 rounded-lg bg-border/70" />
        <div className="h-9 w-20 rounded-lg bg-border/70 md:hidden" />
      </div>

      <div className="flex justify-center">
        <div className="w-full min-w-0 max-w-[760px] space-y-4">
          {/* Hero card — left-to-budget */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 rounded bg-border/70" />
              <div className="h-3 w-20 rounded bg-border/70" />
            </div>
            <div className="mt-3 h-10 w-48 rounded bg-border/70" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-24 rounded bg-border/70" />
                    <div className="h-3 w-16 rounded bg-border/70" />
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-border/70" />
                </div>
              ))}
            </div>
          </div>

          {/* Bulk add row */}
          <div className="flex justify-end">
            <div className="h-8 w-32 rounded-lg bg-border/70" />
          </div>

          {/* Category group cards */}
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 rounded-full bg-border/70" />
                  <div className="h-4 w-32 rounded bg-border/70" />
                  <div className="ml-auto h-4 w-20 rounded bg-border/70" />
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-border/70" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
