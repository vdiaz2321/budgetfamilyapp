-- The imported remarks repeated two things the log now has columns for: the
-- party size ("4 x pax") and breakfast ("b'fast incl" / "Breakfast"). Both are
-- stripped here, leaving only the notes that say something the columns don't
-- ("$200 credit", "no cancel", "Family Room"). Verified first: every "N x pax"
-- prefix matched that stay's own pax value, so nothing is lost by dropping it.
update travel_stays
set remarks = nullif(
  regexp_replace(
    regexp_replace(
      regexp_replace(remarks, '^\s*\d+\s*x\s*pax\s*', '', 'i'),
      '\s*(b''fast incl\.?|breakfast)\s*', '', 'i'),
    '^[\s/]+|[\s/]+$', '', 'g'),
  '')
where remarks is not null
  and remarks <> ''
  and (remarks ~* '^\s*\d+\s*x\s*pax' or remarks ~* '(b''fast|breakfast)');
