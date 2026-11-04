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

export type KidAccountType = "529" | "UTMA" | "Trump Account" | "Checking" | "Savings";

export const KID_ACCOUNT_TYPES: {
  type: KidAccountType;
  kind: "investment" | "checking" | "savings_bucket";
  tax: "education" | "taxable" | "deferred";
  retirementKind: "trump_account" | null;
}[] = [
  { type: "529", kind: "investment", tax: "education", retirementKind: null },
  { type: "UTMA", kind: "investment", tax: "taxable", retirementKind: null },
  { type: "Trump Account", kind: "investment", tax: "deferred", retirementKind: "trump_account" },
  { type: "Checking", kind: "checking", tax: "taxable", retirementKind: null },
  { type: "Savings", kind: "savings_bucket", tax: "taxable", retirementKind: null },
];

// Per child, per year, from everyone except the government and charities.
// Indexed to inflation after 2027, so this needs revisiting then.
export const TRUMP_ANNUAL_LIMIT_CENTS = 500000;

const TYPE_ORDER: string[] = KID_ACCOUNT_TYPES.map((t) => t.type);

/** Reading order inside a child: 529, UTMA, Trump, then the bank accounts. */
export function kidTypeRank(type: string | null): number {
  const at = TYPE_ORDER.indexOf(type ?? "");
  return at === -1 ? TYPE_ORDER.length : at;
}

export function kidTypeOf(subtype: string | null, retirementKind: string | null): string | null {
  if (retirementKind === "trump_account") return "Trump Account";
  return subtype?.trim() || null;
}

/** The backup for whoever runs it, for the types that have one. */
export function successorLabelFor(type: string | null): string | null {
  return type === "529" || type === "UTMA" || type === "Trump Account" ? "Takes over if you can't" : null;
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

// The age for money given directly, only for states whose law was read: Fla. Stat.
// 710.123, Tex. Prop. Code 141.021, Cal. Prob. Code 3920.5, O.C.G.A. 44-5-130,
// N.Y. EPTL 7-6.20, N.C.G.S. 33A-20, C.R.S. 11-50-121, T.C.A. 35-7-121. Published
// state tables disagree, so any other state starts with no age, never a guess.
const UTMA_GIFT_AGE: Record<string, number> = { CA: 18, CO: 21, FL: 21, GA: 21, NC: 21, NY: 21, TN: 21, TX: 21 };

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
  if (type === "UTMA") return utmaAge == null ? null : monthAtAge(birthMonth, utmaAge);
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
  const dated = type === "UTMA" || type === "Trump Account";
  const opened = dated && legalDate != null && legalDate <= today;
  return {
    changeBeneficiary: type === "529",
    moveTo529: type === "529" && balanceCents > 0,
    // A UTMA or Trump Account is the child's money: it can only end at $0, once
    // it's been spent on them or rolled over.
    close: type === "529" || bank || ((type === "UTMA" || type === "Trump Account") && balanceCents === 0),
    handOver: bank || opened,
    handOverOpensOn: dated && !opened ? legalDate : null,
  };
}

/**
 * Why money may not leave a kids' account this way, or null if it may.
 *
 * A UTMA and a Trump Account legally belong to their child, so neither can move
 * to another child's account. A Trump Account also can't be withdrawn at all
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
  if ((fromType === "UTMA" || fromType === "Trump Account") && toKidId && toKidId !== fromKidId) {
    return `A ${fromType === "UTMA" ? "UTMA" : "Trump Account"} legally belongs to ${who}, so it can't move to another child.`;
  }
  return null;
}
