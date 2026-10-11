// Shown while the Travel Log renders. Without a loading boundary a click on a
// link to /travel (the Accounts "Travel Log" button) left the old page on
// screen for the whole server render, so the click read as "nothing
// happened". With it, the link's prefetch also caches this skeleton, so the
// page switches at once. Mirrors the real layout: toolbar, rewards card with
// its stat tiles, then card rows.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-sky-100 dark:bg-sky-900/50 ${className}`} />;
}

export default function TravelLoading() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <Bar className="h-9 w-24 rounded-xl" />
        <Bar className="h-9 w-24 rounded-xl" />
        <Bar className="h-9 w-36 rounded-xl" />
      </div>

      {/* Rewards card */}
      <div className="-mx-4 space-y-4 overflow-hidden bg-surface px-4 py-5 shadow-sm ring-1 ring-black/5 sm:mx-0 sm:rounded-2xl sm:px-6 dark:ring-white/10">
        <Bar className="h-6 w-56" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-line">
              <Bar className="h-3 w-20" />
              <Bar className="h-6 w-24" />
            </div>
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-line pt-4">
            <Bar className="h-4 w-40" />
            <div className="ml-auto hidden gap-8 sm:flex">
              <Bar className="h-8 w-20" />
              <Bar className="h-8 w-20" />
              <Bar className="h-8 w-20" />
            </div>
            <Bar className="h-8 w-16 sm:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}
