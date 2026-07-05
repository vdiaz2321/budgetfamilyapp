"use client";

import { useTransition } from "react";
import { addSubcategory, deleteSubcategory } from "./actions";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";

type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
};

type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  due_day: number | null;
};

const COLUMN_HEADERS: Record<CategoryKind, { bg: string; text: string }> = {
  income:   { bg: "bg-sky-100 dark:bg-sky-950",       text: "text-sky-900 dark:text-sky-100" },
  savings:  { bg: "bg-rose-100 dark:bg-rose-950",     text: "text-rose-900 dark:text-rose-100" },
  bills:    { bg: "bg-pink-100 dark:bg-pink-950",     text: "text-pink-900 dark:text-pink-100" },
  expenses: { bg: "bg-amber-100 dark:bg-amber-950",   text: "text-amber-900 dark:text-amber-100" },
  debt:     { bg: "bg-violet-100 dark:bg-violet-950", text: "text-violet-900 dark:text-violet-100" },
};

type Props = {
  categories: Category[];
  subcategories: Subcategory[];
};

export function CategoriesGrid({ categories, subcategories }: Props) {
  const subsByCat = new Map<string, Subcategory[]>();
  for (const s of subcategories) {
    if (!subsByCat.has(s.category_id)) subsByCat.set(s.category_id, []);
    subsByCat.get(s.category_id)!.push(s);
  }

  return (
    <section>
      <header className="mb-3 rounded-t-xl bg-zinc-800 px-4 py-2 text-center text-sm font-semibold tracking-widest text-white">
        C A T E G O R I E S
      </header>

      <div className="grid gap-3 lg:grid-cols-5">
        {categories.map((cat) => (
          <CategoryColumn
            key={cat.id}
            category={cat}
            subcategories={subsByCat.get(cat.id) ?? []}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryColumn({
  category,
  subcategories,
}: {
  category: Category;
  subcategories: Subcategory[];
}) {
  const hasDue = KINDS_WITH_DUE.includes(category.kind);
  const colors = COLUMN_HEADERS[category.kind];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`${colors.bg} ${colors.text} rounded-t-xl px-3 py-2 text-center text-xs font-semibold uppercase tracking-widest`}>
        {category.name}
      </div>

      {hasDue ? (
        <div className="grid grid-cols-[1fr,60px,28px] items-center gap-1 border-b border-zinc-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <span>{category.kind === "bills" ? "Bill" : "Debt"}</span>
          <span className="text-right">Due</span>
          <span />
        </div>
      ) : null}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {subcategories.map((s) => (
          <SubcategoryRow key={s.id} subcategory={s} hasDue={hasDue} />
        ))}
      </ul>

      <AddSubcategoryForm categoryId={category.id} hasDue={hasDue} />
    </div>
  );
}

function SubcategoryRow({
  subcategory,
  hasDue,
}: {
  subcategory: Subcategory;
  hasDue: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <li className={`grid ${hasDue ? "grid-cols-[1fr,60px,28px]" : "grid-cols-[1fr,28px]"} items-center gap-1 px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-200`}>
      <span className="truncate">{subcategory.name}</span>
      {hasDue ? (
        <span className="text-right text-zinc-500 dark:text-zinc-400">
          {subcategory.due_day ?? "—"}
        </span>
      ) : null}
      <form
        action={(fd) => start(() => deleteSubcategory(fd))}
        className="justify-self-end"
      >
        <input type="hidden" name="id" value={subcategory.id} />
        <button
          type="submit"
          disabled={pending}
          title="Delete"
          className="text-zinc-400 hover:text-red-600 disabled:opacity-40"
        >
          ×
        </button>
      </form>
    </li>
  );
}

function AddSubcategoryForm({
  categoryId,
  hasDue,
}: {
  categoryId: string;
  hasDue: boolean;
}) {
  const [pending, start] = useTransition();

  return (
    <form
      action={(fd) => start(() => addSubcategory(fd))}
      className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800"
    >
      <input type="hidden" name="categoryId" value={categoryId} />
      <div className={`grid ${hasDue ? "grid-cols-[1fr,60px]" : "grid-cols-1"} gap-1`}>
        <input
          name="name"
          placeholder="Add row…"
          required
          className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        {hasDue ? (
          <input
            name="dueDay"
            type="number"
            min={1}
            max={31}
            placeholder="—"
            className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full rounded-md bg-emerald-600 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Adding…" : "+ Add"}
      </button>
    </form>
  );
}
