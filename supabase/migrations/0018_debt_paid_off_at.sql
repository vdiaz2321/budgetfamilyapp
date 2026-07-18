-- Tracks the calendar date a debt's balance first reached $0, so the
-- Snowball page can keep showing a paid-off card through the end of that
-- year and then drop it once the year turns over.
alter table debts
  add column if not exists paid_off_at date;
