import { parseInflationHistory } from "@/lib/inflation";
import { parseChildren, parseColaByYear, parseDentalPlans, parseHealthPlans, type IncomeLine } from "@/lib/retirement";
import type { FiPlan } from "./fi-section";

// The stored retirement_plan row and income lines in the shape the Retirement
// details cards read. Shared by the page and the editor's live preview, so
// the preview never reads a field differently from what Save then shows.

type PlanRow = Record<string, unknown> | null | undefined;

/** The FiPlan fields that come straight from the retirement_plan row. */
export function fiPlanFields(row: PlanRow) {
  const r = (row ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    birthYear: r.birth_year ?? null,
    targetRetireYear: r.target_retire_year ?? null,
    targetRetireMonth: r.target_retire_month ?? null,
    annualSpendCents: r.annual_spend_cents ?? null,
    annualContributionCents: r.annual_contribution_cents ?? null,
    investmentReturnPct: r.investment_return_pct == null ? 7.5 : Number(r.investment_return_pct),
    withdrawStartYear: r.withdraw_start_year ?? null,
    spouseRetireYear: r.spouse_retire_year ?? null,
    spouseBirthYear: r.spouse_birth_year ?? null,
    spouseSsClaimAge: r.spouse_ss_claim_age ?? null,
    withdrawalRatePct: r.withdrawal_rate_pct == null ? 4 : Number(r.withdrawal_rate_pct),
    // A pension, VA, Social Security — income the portfolio never has to
    // fund, so the FI number stops pretending it does.
    guaranteedIncomeCents: r.guaranteed_income_cents ?? null,
    guaranteedIncomeStartYear: r.guaranteed_income_start_year ?? null,
    serviceStartYear: r.service_start_year ?? null,
    serviceStartMonth: r.service_start_month ?? null,
    high3MonthlyCents: r.high3_monthly_cents ?? null,
    basePayByYear: (r.base_pay_by_year ?? {}) as Record<string, number>,
    inflationPct: r.inflation_pct == null ? 2.5 : Number(r.inflation_pct),
    inflationHistory: parseInflationHistory(r.inflation_history),
    cashReturnPct: r.cash_return_pct == null ? 3 : Number(r.cash_return_pct),
    cola: {
      pct: r.cola_pct == null ? 2.5 : Number(r.cola_pct),
      byYear: parseColaByYear(r.cola_by_year),
      military: r.cola_military ?? true,
      va: r.cola_va ?? true,
      socialSecurity: r.cola_social_security ?? true,
    },
    sbpEnabled: !!r.sbp_enabled,
    sbpPct: r.sbp_pct == null ? 6.5 : Number(r.sbp_pct),
    longevityAge: r.longevity_age ?? 90,
    spouseLongevityAge: r.spouse_longevity_age ?? 90,
    children: parseChildren(r.children),
    insurance: {
      sgliCents: Number(r.sgli_cents ?? 50000000),
      sgliPayout: r.sgli_payout === "monthly36" ? "monthly36" : "lump",
      // Kept only when switched on.
      vgliCents: r.vgli_enabled ? Number(r.vgli_cents ?? 0) : 0,
      vgliPayout: r.vgli_payout === "monthly36" ? "monthly36" : "lump",
    },
    healthcareAnnualCents: r.healthcare_annual_cents ?? null,
    healthcareAnnualPer: r.healthcare_annual_per === "yr" ? "yr" : "mo",
    healthPlans: parseHealthPlans(r.health_plans),
    dentalPlans: parseDentalPlans(r.dental_plans),
    healthcareStartAge: r.healthcare_start_age ?? 65,
  } satisfies Partial<FiPlan>;
}

/** A stored income line (or one about to be) as the model reads it. */
export function toIncomeLine(l: Record<string, any>): IncomeLine { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: l.id ?? "",
    name: l.name,
    kind: l.kind,
    // Typed per year: exactly a twelfth of it, not the rounded monthly.
    monthlyCents: l.annual_cents != null ? Number(l.annual_cents) / 12 : l.monthly_cents,
    annualCents: l.annual_cents == null ? null : Number(l.annual_cents),
    startYear: l.start_year,
    startMonth: l.start_month ?? null,
    endYear: l.end_year,
    endMonth: l.end_month ?? null,
    raisePct: l.raise_pct == null ? null : Number(l.raise_pct),
    piaCents: l.pia_cents == null ? null : Number(l.pia_cents),
    taxable: l.taxable,
    owner: l.owner === "spouse" ? "spouse" : "self",
    survivorPct: [25, 50].includes(Number(l.survivor_pct)) ? (Number(l.survivor_pct) as 25 | 50) : 0,
    fersStartEarly: !!l.fers_start_early,
  };
}
