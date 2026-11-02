// The Transactions CSV import across the file shapes people actually upload:
// Victor's sheet, a reordered sheet, a bank export, quoted cells, date formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/app/(app)/invest/import-utils.ts";
import {
  detectDateOrder,
  guessMapping,
  mappingProblem,
  matchImportAccount,
  parseImportAmount,
  parseImportDate,
  planImport,
} from "../src/app/(app)/transactions/import-utils.ts";

const subs = [
  { id: "s-rest", name: "Restaurants", categoryId: "c-exp", categoryName: "Expenses" },
  { id: "s-fed", name: "Federal Taxes", categoryId: "c-tax", categoryName: "Taxes" },
  { id: "s-cola", name: "COLA", categoryId: "c-inc", categoryName: "Income" },
];
const categories = [
  { id: "c-exp", name: "Expenses" },
  { id: "c-tax", name: "Taxes" },
  { id: "c-inc", name: "Income" },
  { id: "c-debt", name: "Debt" },
  { id: "c-bills", name: "Bills" },
];
const accounts = [
  { id: "a-sap", name: "1175 Sapphire V" },
  { id: "a-f1", name: "Fidelity" },
  { id: "a-f2", name: "Fidelity" },
];

function plan(csv, overrides = {}) {
  const { headers, rows } = parseCsv(csv);
  const mapping = { ...guessMapping(headers), ...overrides.mapping };
  return planImport({ headers, rows, mapping, dateOrder: overrides.dateOrder ?? null, subs, categories, accounts });
}

const SHEET = "Date,$,Debted $,Category,Subcategory,Payee,Credit Card,Memo_Remarks\n";

test("Victor's sheet is recognised and pre-matched: his Category is our Type", () => {
  const { headers } = parseCsv(SHEET + "1-Nov-26,,75.82,Expenses,Restaurants,Alessia,Sapphire,\n");
  const m = guessMapping(headers);
  assert.deepEqual(m, { date: 0, amount: 2, type: 3, category: 4, payee: 5, account: 6, remarks: 7 });
  assert.equal(mappingProblem(m, headers), null);
});

test("reordered columns import with every value in the right field", () => {
  const p = plan("Payee,Amount,Remarks,Category,Type,Account,Date\nAlessia,75.82,lunch,Restaurants,Expenses,Sapphire,2026-11-01\n");
  assert.equal(p.rows.length, 1);
  const r = p.rows[0];
  assert.equal(r.payee, "Alessia");
  assert.equal(r.memo, "lunch");
  assert.equal(r.amountCents, 7582);
  assert.equal(r.occurredOn, "2026-11-01");
  assert.equal(r.subcategoryId, "s-rest");
  assert.equal(r.account.id, "a-sap");
});

test("quoted commas stay in their cell", () => {
  const p = plan(SHEET + '1-Nov-26,,"$1,200.00",Expenses,Restaurants,"Smith, Co",Sapphire,\n');
  assert.equal(p.rows[0].amountCents, 120000);
  assert.equal(p.rows[0].payee, "Smith, Co");
  assert.equal(p.rows[0].card, "Sapphire");
});

test("a Category that isn't in the budget never imports and is named", () => {
  const p = plan("Date,Amount,Category\n2026-11-01,5,Llamas\n2026-11-02,6,Llamas\n");
  assert.equal(p.rows.length, 0);
  assert.deepEqual(p.unknown, [{ key: "Llamas", rowCount: 2 }]);
});

test("Type is optional, and a broad Type still finds a Category filed elsewhere", () => {
  assert.equal(plan("Date,Amount,Category\n2026-11-01,5,restaurants\n").rows[0].subcategoryId, "s-rest");
  const exported = plan("Date,Amount,Type,Category\n2026-11-01,5,Bills,Federal Taxes\n");
  assert.equal(exported.rows[0].subcategoryId, "s-fed");
  assert.equal(exported.rows[0].categoryId, "c-tax");
});

test("sheet rules stay out of other files: no auto-create, no skip list", () => {
  const other = plan("Date,Amount,Type,Category\n2026-11-01,5,Debt,Savor2946J (Mar26)\n2026-11-01,5,Income,Side Income\n");
  assert.deepEqual(other.autoCreate, []);
  assert.equal(other.skipped.length, 0);
  assert.equal(other.unknown.length, 2);
});

test("in the sheet, a category is only auto-created when a row needs it", () => {
  assert.deepEqual(plan(SHEET + "1-Nov-26,,5,Expenses,Restaurants,,,\n").autoCreate, []);
  const needs = plan(SHEET + "1-Nov-26,,5,Debt,Savor2946J (Mar26),,,\n");
  assert.deepEqual(needs.autoCreate, ["Debt|Savor2946J (Mar26)"]);
  assert.equal(needs.rows[0].subcategoryId, null);
  assert.equal(needs.rows[0].categoryId, "c-debt");
});

test("sheet skip rule still applies", () => {
  const p = plan(SHEET + "1-Nov-26,,5,Income,Johana Income,,,\n");
  assert.equal(p.rows.length, 0);
  assert.match(p.skipped[0].reason, /skip rule/);
});

test("bank-style minus amounts keep their size; mixed signs are flagged", () => {
  const spend = plan("Date,Amount,Category\n2026-11-01,-75.82,Restaurants\n");
  assert.equal(spend.rows[0].amountCents, 7582);
  assert.equal(spend.bothSigns, false);
  assert.equal(plan("Date,Amount,Category\n2026-11-01,-7,Restaurants\n2026-11-02,3,Restaurants\n").bothSigns, true);
});

test("a minus in the sheet stays a bad row, as it always was", () => {
  const p = plan(SHEET + "1-Nov-26,,-5,Expenses,Restaurants,,,\n");
  assert.equal(p.rows.length, 0);
  assert.match(p.skipped[0].reason, /amount/);
});

test("a repeated row in one file is reported, not silently lost", () => {
  const p = plan("Date,Amount,Category\n2026-11-01,5,Restaurants\n2026-11-01,5,Restaurants\n");
  assert.equal(p.rows.length, 1);
  assert.match(p.skipped[0].reason, /earlier row/);
});

test("amount formats", () => {
  assert.equal(parseImportAmount("$1,200.00"), 120000);
  assert.equal(parseImportAmount("(75.82)"), -7582);
  assert.equal(parseImportAmount("75.82-"), -7582);
  assert.equal(parseImportAmount("75,82"), 7582);
  assert.equal(parseImportAmount("1.234,56"), 123456);
  assert.ok(Number.isNaN(parseImportAmount("abc")));
  assert.ok(Number.isNaN(parseImportAmount("")));
});

test("date formats, and impossible dates are refused", () => {
  assert.equal(parseImportDate("1-Nov-26", null), "2026-11-01");
  assert.equal(parseImportDate("1 November 2026", null), "2026-11-01");
  assert.equal(parseImportDate("Nov 1, 2026", null), "2026-11-01");
  assert.equal(parseImportDate("2026-11-01", null), "2026-11-01");
  assert.equal(parseImportDate("03/04/2026", "mdy"), "2026-03-04");
  assert.equal(parseImportDate("03/04/2026", "dmy"), "2026-04-03");
  assert.equal(parseImportDate("03.04.26", "dmy"), "2026-04-03");
  assert.equal(parseImportDate("03/04/2026", null), null);
  assert.equal(parseImportDate("31-Feb-26", null), null);
});

test("date order is detected only when the file proves it", () => {
  assert.equal(detectDateOrder(["1-Nov-26"]), null);
  assert.equal(detectDateOrder(["03/04/26", "11/25/26"]), "mdy");
  assert.equal(detectDateOrder(["03/04/26", "25/11/26"]), "dmy");
  assert.equal(detectDateOrder(["03/04/26"]), "ask");
});

test("mapping problems are named", () => {
  const headers = ["A", "B", "C"];
  const base = { date: 0, amount: 1, type: -1, category: 2, payee: -1, account: -1, remarks: -1 };
  assert.equal(mappingProblem(base, headers), null);
  assert.match(mappingProblem({ ...base, amount: -1 }, headers), /Amount/);
  assert.match(mappingProblem({ ...base, payee: 0 }, headers), /Date and Payee/);
  assert.match(mappingProblem({ ...base, payee: 9 }, headers), /Payee/);
});

test("account match: exact or one clear fit, never a coin flip", () => {
  assert.equal(matchImportAccount("Sapphire", accounts, false).id, "a-sap");
  assert.equal(matchImportAccount("1175 sapphire v", accounts, false).id, "a-sap");
  assert.equal(matchImportAccount("Fidelity", accounts, false), null);
  assert.equal(matchImportAccount("Nope", accounts, false), null);
});
