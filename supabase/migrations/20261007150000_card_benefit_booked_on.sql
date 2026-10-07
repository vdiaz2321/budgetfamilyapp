-- Split the free-night "Booked / check-in" date in two.
--
-- benefit_used_on held both the day a free night was reserved and the night
-- it was for, depending on who typed it. It now means the CHECK-IN date only
-- (what a stay stamps, and what the reward-activity trigger copies), and the
-- new benefit_booked_on is the day it was reserved. Either one set means the
-- certificate is spent.

alter table public.credit_card_details
  add column if not exists benefit_booked_on date;

comment on column public.credit_card_details.benefit_used_on is
  'Free-night certificate: check-in date of the night it pays for.';
comment on column public.credit_card_details.benefit_booked_on is
  'Free-night certificate: the day it was reserved.';

-- 0809 Hyatt World: Victor confirmed 2026-07-23 is the day he booked, not the
-- check-in (2026-10-07). The other cards' dates are check-ins and stay put.
update public.credit_card_details d
set benefit_booked_on = d.benefit_used_on,
    benefit_used_on = null,
    updated_at = now()
from public.accounts a
where a.id = d.account_id
  and a.name = '0809 Hyatt World'
  and d.benefit_used_on = date '2026-07-23';
