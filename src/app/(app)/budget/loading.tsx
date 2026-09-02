// Shown while the budget page renders for a new month. Without a loading
// boundary a month switch left the OLD month on screen for the whole server
// render — several seconds in dev — so the click read as "nothing happened"
// and the reflex was to reload the browser. The skeleton mirrors the real
// layout (hero card, toolbar, group rows, right rail) so the switch reads as
// the same page loading rather than a different page appearing.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-black/10 dark:bg-white/10 ${className}`} />;
}

export default function BudgetLoading() {
  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <Bar className="h-8 w-56" />

        {/* Hero card */}
        <div className="-mx-4 overflow-hidden bg-surface px-6 py-5 shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-2xl dark:ring-white/10">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] md:gap-x-8">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Bar className="h-3 w-24" />
                  <Bar className="h-7 w-32" />
                </div>
              ))}
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bar key={i} className="h-11 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <Bar className="h-10 w-full rounded-xl" />

        {/* Category groups */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="-mx-4 flex items-center gap-3 bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-xl dark:ring-white/10"
          >
            <Bar className="h-2.5 w-2.5 rounded-full" />
            <Bar className="h-4 w-32" />
            <div className="ml-auto hidden gap-8 sm:flex">
              <Bar className="h-8 w-20" />
              <Bar className="h-8 w-20" />
              <Bar className="h-8 w-20" />
            </div>
          </div>
        ))}
      </div>

      {/* Right rail */}
      <aside className="hidden w-[380px] shrink-0 space-y-3 lg:block">
        <Bar className="h-11 w-full rounded-xl" />
        <Bar className="h-72 w-full rounded-2xl" />
      </aside>
    </div>
  );
}
