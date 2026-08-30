/**
 * Read every row of a Supabase select, in pages.
 *
 * PostgREST caps an unbounded select at 1000 rows (`db-max-rows`) and returns
 * the truncated set with no error and no flag — so any total summed from a
 * query that outgrows one page is silently, quietly wrong. That is exactly how
 * the Accounts page came to disagree with Transactions about a card balance:
 * the household crossed 1000 credit-card charges and every "owed" figure
 * drifted low.
 *
 * Use this for anything that aggregates across history. A query already bounded
 * to something small (one month, one account) doesn't need it.
 *
 * The paged query MUST have a stable `.order(...)`, or Postgres is free to
 * return rows in a different order per page and rows will be missed.
 */
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    // A failed page used to read as `data: null` -> an empty page -> "shorter
    // than PAGE_SIZE, so that was the last one", and the partial result was
    // returned as if complete. Callers sum it and persist the total, which is
    // the same silently-wrong balance this helper exists to prevent.
    if (error) throw new Error(`Could not read all rows: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}
