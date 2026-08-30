-- A link to the fund's page at the brokerage, so a holding in the table can be
-- opened where its real numbers live.
alter table public.investment_position_snapshots add column url text;
