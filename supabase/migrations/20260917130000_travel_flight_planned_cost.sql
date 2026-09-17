-- What an estimated flight was expected to cost, kept once it is bought so the
-- trip can show planned against actual. Set by the save action the moment an
-- estimate is switched to bought; null for flights that were never estimates.
alter table travel_flights
  add column if not exists planned_cost_cents bigint
    check (planned_cost_cents is null or planned_cost_cents >= 0);
