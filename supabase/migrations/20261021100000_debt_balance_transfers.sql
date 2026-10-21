-- Balance transfers: a second promo balance on a card that already has one.
--
-- A card carried as a payoff debt is linked through `debts.account_id`, and
-- `debts_account_link_idx` allows exactly one debt per card. A balance
-- transfer is a separate promo with its own end date, go-to APR and fee, so
-- folding it into that one row would blend two deadlines into one number.
--
-- A transfer is therefore its own `debts` row with `account_id` left null (the
-- card's own payoff debt and every lookup keyed on it are untouched) and these
-- columns saying where it lives and where it came from:
--
--   bt_card_account_id  the card now holding the transferred balance
--   bt_from_account_id  the card the balance left
--   bt_fee_cents        the transfer fee, already included in the balance
--   bt_transaction_id   the card payment that paid down the source card, so
--                       undoing the transfer removes it too
--
-- The receiving card's register is not zeroed for a transfer (v_card_balances
-- only does that for `account_id` debts): the transfer's liability is this row,
-- and its payments are logged against its own budget item, not paid to the card.
alter table public.debts
  add column if not exists bt_card_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists bt_from_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists bt_fee_cents bigint not null default 0,
  add column if not exists bt_transaction_id uuid references public.transactions(id) on delete set null;

create index if not exists debts_bt_card_idx
  on public.debts (bt_card_account_id)
  where bt_card_account_id is not null;

comment on column public.debts.bt_card_account_id is
  'Card holding this balance transfer. Null = not a balance transfer.';
