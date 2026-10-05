-- Points cashed out now bring their cash with them (2026-10-05).
--
-- A "Cashed out" rewards entry writes one transaction alongside it:
--   * statement credit -> a card_payment to that card with no source account
--     (lowers what the card owes; no bank moves, not spending, not income)
--   * deposit          -> an Income / Card Rewards transaction into a bank
--
-- The transaction points back at the entry so the two stay one record:
-- deleting the entry deletes its transaction (done in the server action, which
-- also puts any balance back), and the log shows the cash received.
-- ON DELETE SET NULL: deleting the entry from SQL never leaves a dangling id.

alter table public.transactions
  add column if not exists reward_activity_id uuid
    references public.credit_card_reward_activities(id) on delete set null;

create index if not exists transactions_reward_activity_id_idx
  on public.transactions (reward_activity_id)
  where reward_activity_id is not null;
