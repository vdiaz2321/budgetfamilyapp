// What the law lets each kind of kids' account do, and when it hands over.
//
// The one definition, shared by the Kids Funding popup (which offers the
// actions) and the server actions (which refuse the rest). Dates are plain
// "YYYY-MM-DD" strings compared as text, so a timezone can never shift a
// hand-over by a day.
//
// Sources: IRS Notice 2025-68 (Trump Accounts), Fidelity's 529 and UTMA pages,
// Fla. Stat. 710.123 (UTMA). The Trump Account rules are still being finalised.

export type KidAccountType = "529" | "UTMA" | "Trump Account" | "Checking" | "Savings";

export const KID_ACCOUNT_TYPES: {
  type: KidAccountType;
  kind: "investment" | "checking" | "savings_bucket";
  tax: "education" | "taxable" | "deferred";
  retirementKind: "trump_account" | null;
  /** What the person running the account is called, for this type. */
  controllerLabel: string;
}[] = [
  { type: "529", kind: "investment", tax: "education", retirementKind: null, controllerLabel: "Owner" },
  { type: "UTMA", kind: "investment", tax: "taxable", retirementKind: null, controllerLabel: "Custodian" },
  { type: "Trump Account", kind: "investment", tax: "deferred", retirementKind: "trump_account", controllerLabel: "Responsible party" },
  { type: "Checking", kind: "checking", tax: "taxable", retirementKind: null, controllerLabel: "Parent" },
  { type: "Savings", kind: "savings_bucket", tax: "taxable", retirementKind: null, controllerLabel: "Parent" },
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

export function controllerLabelFor(type: string | null): string {
  return KID_ACCOUNT_TYPES.find((t) => t.type === type)?.controllerLabel ?? "Controlled by";
}

/** The backup for whoever runs it, for the types that have one. */
export function successorLabelFor(type: string | null): string | null {
  if (type === "529") return "Successor owner";
  if (type === "UTMA") return "Successor custodian";
  if (type === "Trump Account") return "Successor";
  return null;
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
  if (tracking === "handed_over") return `Save and hand over${restCents !== 0 ? ` ${money(restCents)}` : ""} to ${kidName}`;
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

/** The UTMA ages to pick from: the three the law uses, plus whatever is set now. */
export function utmaAgeOptions(current: number): number[] {
  return [...new Set([18, 21, 25, current])].sort((x, y) => x - y);
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
export function handOverFrom(type: string | null, birthMonth: string | null, utmaAge: number): string | null {
  if (!birthMonth) return null;
  if (type === "UTMA") return monthAtAge(birthMonth, utmaAge);
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
  utmaAge: number;
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
