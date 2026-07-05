export const metadata = { title: "Annual · Budget Family App" };

export default function AnnualPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Annual / Year
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Toggle between the Annual Breakdown pivot and the Year summary. Coming
        after Budget.
      </p>
    </div>
  );
}
