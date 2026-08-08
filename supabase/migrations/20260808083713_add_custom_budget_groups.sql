-- Custom budget groups share one of the existing accounting kinds so every
-- downstream total keeps its current meaning. The original five categories
-- are marked as system groups; user-created groups are limited to the three
-- organizational kinds requested by the product.
alter table public.categories
  add column if not exists is_system boolean not null default false;

with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, kind
      order by sort_order, created_at, id
    ) as kind_rank
  from public.categories
)
update public.categories as categories
set is_system = true
from ranked
where categories.id = ranked.id
  and ranked.kind_rank = 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'categories_custom_kind_check'
      and conrelid = 'public.categories'::regclass
  ) then
    alter table public.categories
      add constraint categories_custom_kind_check
      check (is_system or kind in ('bills', 'expenses', 'savings'));
  end if;
end $$;

create unique index if not exists categories_one_system_kind_idx
  on public.categories (household_id, kind)
  where is_system;

create index if not exists categories_household_sort_idx
  on public.categories (household_id, sort_order, name);
