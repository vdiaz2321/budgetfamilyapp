-- Some free-night certificates are capped by hotel category, not points: the
-- World of Hyatt card's anniversary night is good at any Category 1–4 hotel.
-- free_night_points_limit had no way to say that, so the Hyatt card showed no
-- free night at all and was left out of the "Free nights unbooked" count.
-- free_night_category_max holds the top category (4 = "Cat 1–4"). A card uses
-- one cap or the other; the edit form clears the one not chosen.
alter table public.credit_card_details
  add column if not exists free_night_category_max smallint
    check (free_night_category_max is null or free_night_category_max between 1 and 8);
