-- Rent and costs typed per month or per year (Victor, 2026-10-24), like the
-- insurance plans. monthly_rent_cents / monthly_costs_cents stay what the
-- projection reads; a yearly figure is kept as typed here so the box reopens
-- exactly (12,000/yr, not 11,999.96). Null = typed monthly.
alter table public.rental_properties
  add column if not exists yearly_rent_cents bigint check (yearly_rent_cents is null or yearly_rent_cents >= 0),
  add column if not exists yearly_costs_cents bigint check (yearly_costs_cents is null or yearly_costs_cents >= 0);
