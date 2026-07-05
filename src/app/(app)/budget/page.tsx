export const metadata = { title: "Budget · Budget Family App" };

export default function BudgetPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Budget
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Planned vs. actual per subcategory, by month. Coming after the Log.
      </p>
    </div>
  );
}
