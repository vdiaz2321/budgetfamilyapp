// What the law lets each kind of kids' account do, and when it hands over.
//
// The one definition, shared by the Kids Funding popup (which offers the
// actions) and the server actions (which refuse the rest). Dates are plain
// "YYYY-MM-DD" strings compared as text, so a timezone can never shift a
// hand-over by a day.
//
// Sources: IRS Notice 2025-68 (Trump Accounts), Fidelity's 529 and UTMA pages,
// Fla. Stat. 710.123 and 710.103 (UTMA). The Trump Account rules are still being
// finalised.
//
// Added 2026-11-05, each rule checked against:
//   Coverdell ESA  IRS Pub. 970 ch. 7; 26 U.S.C. 530(d)(6) and 529(e)(2)
//   ABLE account   26 U.S.C. 529A; 26 CFR 1.529A-2 and 1.529A-3; IRS "ABLE
//                  accounts" page; SSA POMS SI 01130.740
//   Custodial Roth IRA  IRS Pub. 590-A; IRS 2026 limits (Notice 2025-67);
//                  Fidelity "Roth IRA for Kids", Schwab Custodial IRA
// No UGMA type: South Carolina, the last state on it, replaced it with the UTMA
// in 2022 (S.C. Act 128), so an old UGMA account is entered as a UTMA.

export type KidAccountType =
  | "529"
  | "Coverdell ESA"
  | "UTMA"
  | "Custodial Roth IRA"
  | "Trump Account"
  | "ABLE Account"
  | "Checking"
  | "Savings";

export const KID_ACCOUNT_TYPES: {
  type: KidAccountType;
  kind: "investment" | "checking" | "savings_bucket";
  tax: "education" | "taxable" | "deferred" | "free";
  retirementKind: "trump_account" | "roth_ira" | null;
}[] = [
  { type: "529", kind: "investment", tax: "education", retirementKind: null },
  { type: "Coverdell ESA", kind: "investment", tax: "education", retirementKind: null },
  { type: "UTMA", kind: "investment", tax: "taxable", retirementKind: null },
  { type: "Custodial Roth IRA", kind: "investment", tax: "free", retirementKind: "roth_ira" },
  { type: "Trump Account", kind: "investment", tax: "deferred", retirementKind: "trump_account" },
  { type: "ABLE Account", kind: "investment", tax: "free", retirementKind: null },
  { type: "Checking", kind: "checking", tax: "taxable", retirementKind: null },
  { type: "Savings", kind: "savings_bucket", tax: "taxable", retirementKind: null },
];

// Per child, per year, from everyone except the government and charities.
// Indexed to inflation after 2027, so this needs revisiting then.
export const TRUMP_ANNUAL_LIMIT_CENTS = 500000;

/**
 * Each type's yearly cap, for the "$x of $y this year" line. Dollar figures are
 * for 2026 and need revisiting each year.
 *   Coverdell: $2,000 per child across all their Coverdells (Pub. 970).
 *   Custodial Roth: the 2026 IRA limit, $7,500, and never more than the child
 *     earned that year (Pub. 590-A; Notice 2025-67).
 *   ABLE: the gift-tax exclusion, $20,000 for 2026 (IRS ABLE page).
 */
export const KID_ANNUAL_LIMIT_CENTS: Partial<Record<KidAccountType, number>> = {
  "Coverdell ESA": 200000,
  "Custodial Roth IRA": 750000,
  "Trump Account": TRUMP_ANNUAL_LIMIT_CENTS,
  "ABLE Account": 2000000,
};

/** The child's own money by law: it can't go to another child, and it closes only at $0. */
const CHILD_OWNED = new Set(["UTMA", "Custodial Roth IRA", "Trump Account", "ABLE Account"]);
export function isChildOwned(type: string | null): boolean {
  return CHILD_OWNED.has(type ?? "");
}

/**
 * Types whose beneficiary can change, each to a narrower set of people:
 * a 529 to a family member; a Coverdell to a family member under 30
 * (530(d)(6)); an ABLE account to a sibling who is ABLE-eligible too
 * (1.529A-2). Kept in step with public.kids_change_beneficiary.
 */
const BENEFICIARY_CHANGES = new Set(["529", "Coverdell ESA", "ABLE Account"]);

/** The types that carry an age to transfer, set by state law or the custodial agreement. */
export function hasHandOverAge(type: string | null): boolean {
  return type === "UTMA" || type === "Custodial Roth IRA";
}

/**
 * A Coverdell must be paid out within 30 days of its child turning 30, and
 * takes no new money after 18 (Pub. 970). Null without a birth month.
 */
export function coverdellDates(birthMonth: string | null): { lastContribution: string; useBy: string } | null {
  if (!birthMonth) return null;
  return { lastContribution: monthAtAge(birthMonth, 18), useBy: monthAtAge(birthMonth, 30) };
}

const TYPE_ORDER: string[] = KID_ACCOUNT_TYPES.map((t) => t.type);

/** Reading order inside a child: 529, UTMA, Trump, then the bank accounts. */
export function kidTypeRank(type: string | null): number {
  const at = TYPE_ORDER.indexOf(type ?? "");
  return at === -1 ? TYPE_ORDER.length : at;
}

/** Who holds it: an ABLE account sits with a state program, another investment at a brokerage, anything else at a bank. */
export function institutionLabelFor(type: string | null): "Brokerage" | "Bank" | "Program" {
  if (type === "ABLE Account") return "Program";
  return KID_ACCOUNT_TYPES.find((t) => t.type === type)?.kind === "investment" ? "Brokerage" : "Bank";
}

export function kidTypeOf(subtype: string | null, retirementKind: string | null): string | null {
  if (retirementKind === "trump_account") return "Trump Account";
  return subtype?.trim() || null;
}

/**
 * A real account can't turn into another type, so the type is only open to fixing
 * a typo: until the item has a history or more than one month of balances.
 */
export function kidTypeLocked(type: string | null, hasEvents: boolean, monthsOfHistory: number): boolean {
  if (!KID_ACCOUNT_TYPES.some((t) => t.type === type)) return false;
  return hasEvents || monthsOfHistory > 1;
}

/** What Save will do, in words, so one button can do it all safely. */
export function kidSaveLabel(input: {
  dirty: boolean;
  transferring: boolean;
  toName: string;
  /** Null for a whole account. */
  partCents: number | null;
  tracking: "keep" | "closed" | "handed_over";
  restCents: number;
  kidName: string;
  money: (cents: number) => string;
}): string {
  const { dirty, transferring, toName, partCents, tracking, restCents, kidName, money } = input;
  if (!dirty) return "No changes";
  const to = toName ? ` to ${toName}` : "";
  if (transferring) {
    const stopping = tracking === "closed";
    if (partCents == null) return stopping ? `Transfer${to} and stop tracking` : `Save and transfer${to}`;
    const amount = partCents > 0 ? money(partCents) : "part";
    if (!stopping) return `Save and transfer ${amount}${to}`;
    return restCents > 0 ? `Transfer ${amount}${to}, stop tracking ${money(restCents)}` : `Transfer ${amount}${to} and stop tracking`;
  }
  if (tracking === "closed") return `Save and stop tracking${restCents !== 0 ? ` ${money(restCents)}` : ""}`;
  if (tracking === "handed_over") return `Save and transfer${restCents !== 0 ? ` ${money(restCents)}` : ""} to ${kidName}`;
  return "Save changes";
}

/** Delete's warning, naming what happens to the Budget items made with the account. */
export function kidDeleteWarning(budget: { erase: string[]; keep: string[] }): string {
  const named = (names: string[]) => `Budget ${names.length > 1 ? "items" : "item"} ${names.join(", ")}`;
  const ask = budget.erase.length > 0
    ? `Erase this account, all its past months and ${named(budget.erase)}?`
    : "Erase this account and all its past months?";
  return budget.keep.length > 0 ? `${ask} ${named(budget.keep)} stays, since it has activity.` : ask;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2031-04-01" → "Apr 2031". */
export function monthYear(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;
}

/** "2031-04-15" → "Apr 15, 2031". */
export function fullDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

/** The month a child reaches an age, from their birth month. */
export function monthAtAge(birthMonth: string, age: number): string {
  return `${Number(birthMonth.slice(0, 4)) + age}${birthMonth.slice(4, 7)}-01`;
}

/** The UTMA ages to pick from. States differ, and some let the account set its own. */
export function utmaAgeOptions(): number[] {
  return [18, 19, 20, 21, 22, 23, 24, 25];
}

export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

// The age a UTMA hands over for money given directly (a gift, or by will or
// trust), from each state's termination section, read 2026-11-05. Where a state
// lets the giver pick a later age (up to 21, 25 or, in Wyoming, 30), this is the
// age when none was picked; the account's own age always wins.
//   21: AL 35-5A-21 · AK 13.46.190 · AZ 14-7670 (2025's HB 2659 would make it
//       25; not enacted as of this reading) · AR 9-26-220 · CO 11-50-121 ·
//       CT 45a-559e · DE 12-4520 · FL 710.123 · GA 44-5-130 · HI 553A-20 ·
//       ID 68-820 · IL 760 ILCS 20/21 · IN 30-2-8.5-35 · IA 565B.20 ·
//       KS 38-1721 · MD Est. & Trusts 13-320 · MA 201A §20 · MN 527.40 ·
//       MS 91-20-41 · MO 404.051 · MT 72-26-803 · NE 43-2721 · NH 463-A:20 ·
//       NJ 46:38A-52 · NM 46-7-31 · NY EPTL 7-6.20 · NC 33A-20 · ND 47-24.1-20 ·
//       OH 5814.09 · OR 126.872 · PA 20 Pa.C.S. 5320 · RI 18-7-21 ·
//       SC 63-5-700 (UTMA since 2022) · TN 35-7-121 · TX Prop. 141.021 ·
//       UT 75A-8-121 · VT 14-3230 (UTMA since 2015) · WA 11.114.200 ·
//       WV 36-7-20 · WI 54.892 · WY 34-13-133
//   18: CA Prob. 3920.5 · DC 21-320 · KY 385.202 · ME 33-1671 · MI 554.546 ·
//       NV 167.095 · OK 58-1221 · SD 55-10A-22 · VA 64.2-1919
//   22: LA R.S. 9:770 (Act 60 of 2023)
const UTMA_GIFT_AGE: Record<string, number> = {
  AL: 21, AK: 21, AZ: 21, AR: 21, CA: 18, CO: 21, CT: 21, DE: 21, DC: 18, FL: 21,
  GA: 21, HI: 21, ID: 21, IL: 21, IN: 21, IA: 21, KS: 21, KY: 18, LA: 22, ME: 18,
  MD: 21, MA: 21, MI: 18, MN: 21, MS: 21, MO: 21, MT: 21, NE: 21, NV: 18, NH: 21,
  NJ: 21, NM: 21, NY: 21, NC: 21, ND: 21, OH: 21, OK: 18, OR: 21, PA: 21, RI: 21,
  SC: 21, SD: 18, TN: 21, TX: 21, UT: 21, VT: 21, VA: 18, WA: 21, WV: 21, WI: 21,
  WY: 21,
};

export function utmaGiftAge(state: string | null): number | null {
  return (state && UTMA_GIFT_AGE[state]) || null;
}

export function utmaStateName(code: string | null): string | null {
  return US_STATES.find((s) => s.code === code)?.name ?? null;
}

/** A UTMA's state and age from a form; blank means not known yet. */
export function parseUtma(stateRaw: string, ageRaw: string): { state: string | null; age: number | null; error: string | null } {
  const state = stateRaw.trim() || null;
  const age = ageRaw.trim() ? Number(ageRaw) : null;
  if (state && !US_STATES.some((s) => s.code === state)) return { state: null, age: null, error: "Pick a state from the list." };
  if (age != null && (!Number.isInteger(age) || age < 18 || age > 25)) return { state: null, age: null, error: "The age to transfer must be 18 to 25." };
  return { state, age, error: null };
}

/** "Florida · age 21 · Apr 2034", saying what's missing rather than guessing a date. */
export function utmaLine(state: string | null, age: number | null, birthMonth: string | null): string {
  const name = utmaStateName(state);
  if (age == null) return name ? `${name} · Age needed` : "State needed";
  const date = birthMonth ? ` · ${monthYear(monthAtAge(birthMonth, age))}` : "";
  return name ? `${name} · age ${age}${date}` : `State needed · age ${age}${date}`;
}

/** The note under a UTMA's age: what the state's law says and when that lands. */
export function utmaTransferNote(state: string, age: number, kidName: string, birthMonth: string | null): string {
  const name = utmaStateName(state) ?? state;
  const usual = utmaGiftAge(state);
  const gets = birthMonth ? `${kidName} gets it in ${monthYear(monthAtAge(birthMonth, age))}.` : "";
  const why = usual == null ? `Set to ${age}.` : usual === age ? `${name}'s age for gifts is ${usual}.` : `${name}'s age for gifts is ${usual}, but this one is set to ${age}.`;
  return [why, gets, "You start the transfer. Moving doesn't change this."].filter(Boolean).join(" ");
}

/** Soon means inside the last 12 months before the date. */
export function handOverStatus(handOver: string | null, today: string): "soon" | "past" | null {
  if (!handOver) return null;
  if (handOver <= today) return "past";
  const yearBefore = `${Number(handOver.slice(0, 4)) - 1}${handOver.slice(4)}`;
  return yearBefore <= today ? "soon" : null;
}

/**
 * A Trump Account's special rules end on January 1 of the year the child turns
 * 18, not on the birthday: from then on it runs under traditional IRA rules.
 */
export function trumpOpensOn(birthMonth: string): string {
  return `${Number(birthMonth.slice(0, 4)) + 18}-01-01`;
}

/**
 * The first day a hand-over can be recorded, or null when there's no legal date
 * (a 529 stays with its owner; a bank account follows the bank's own rules).
 */
export function handOverFrom(type: string | null, birthMonth: string | null, utmaAge: number | null): string | null {
  if (!birthMonth) return null;
  if (hasHandOverAge(type)) return utmaAge == null ? null : monthAtAge(birthMonth, utmaAge);
  if (type === "Trump Account") return trumpOpensOn(birthMonth);
  return null;
}

export type KidActions = {
  changeBeneficiary: boolean;
  moveTo529: boolean;
  close: boolean;
  handOver: boolean;
  /** Hand-over is the right action but its date hasn't come: when it opens. */
  handOverOpensOn: string | null;
};

export function kidActionsFor(input: {
  type: string | null;
  balanceCents: number;
  birthMonth: string | null;
  utmaAge: number | null;
  today: string;
}): KidActions {
  const { type, balanceCents, birthMonth, utmaAge, today } = input;
  const bank = type === "Checking" || type === "Savings";
  const legalDate = handOverFrom(type, birthMonth, utmaAge);
  const dated = hasHandOverAge(type) || type === "Trump Account";
  const opened = dated && legalDate != null && legalDate <= today;
  return {
    changeBeneficiary: BENEFICIARY_CHANGES.has(type ?? ""),
    moveTo529: type === "529" && balanceCents > 0,
    // The child's own money can only end at $0, once it's been spent on them or
    // rolled over. A 529 or Coverdell stays the parent's to close.
    close: type === "529" || type === "Coverdell ESA" || bank || (isChildOwned(type) && balanceCents === 0),
    handOver: bank || opened,
    handOverOpensOn: dated && !opened ? legalDate : null,
  };
}

/**
 * Why money may not leave a kids' account this way, or null if it may.
 *
 * The child's own money (UTMA, custodial Roth IRA, Trump Account, ABLE account)
 * can't move to another child's account; an ABLE account passes only by a
 * beneficiary change. A Trump Account also can't be withdrawn at all
 * until the year its child turns 18.
 */
export function kidMoveBlock(input: {
  fromType: string | null;
  fromKidId: string | null;
  fromKidName: string | null;
  fromBirthMonth: string | null;
  toKidId: string | null;
  today: string;
}): string | null {
  const { fromType, fromKidId, fromKidName, fromBirthMonth, toKidId, today } = input;
  const who = fromKidName ?? "this child";
  if (fromType === "Trump Account") {
    const opens = fromBirthMonth ? trumpOpensOn(fromBirthMonth) : null;
    if (!opens || today < opens) {
      return opens
        ? `${who}'s Trump Account can't be withdrawn or moved until ${fullDate(opens)}.`
        : `A Trump Account can't be withdrawn or moved until the year its child turns 18.`;
    }
  }
  if (isChildOwned(fromType) && toKidId && toKidId !== fromKidId) {
    return fromType === "ABLE Account"
      ? `${who}'s ABLE account can only pass to a sibling who qualifies, by changing its beneficiary.`
      : `A ${fromType} legally belongs to ${who}, so it can't move to another child.`;
  }
  return null;
}
