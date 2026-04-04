/**
 * Billing calculation for tiered pricing model
 * Base: $99/month includes up to 3 technicians
 * Additional: $50/tech for 4th tech and beyond
 */

export interface BillingCalculation {
  baseFee: number; // $99
  includedTechs: number; // 3
  additionalTechs: number; // total techs - included
  additionalFee: number; // additional techs * $50
  totalMonthlyCost: number; // base + additional
  costPerTech: number; // total / num techs
}

export function calculateBilling(totalTechs: number): BillingCalculation {
  const baseFee = 99;
  const includedTechs = 3;
  const additionalCostPerTech = 50;

  const additionalTechs = Math.max(0, totalTechs - includedTechs);
  const additionalFee = additionalTechs * additionalCostPerTech;
  const totalMonthlyCost = baseFee + additionalFee;
  const costPerTech = totalTechs > 0 ? totalMonthlyCost / totalTechs : 0;

  return {
    baseFee,
    includedTechs,
    additionalTechs,
    additionalFee,
    totalMonthlyCost,
    costPerTech,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatMonthly(amount: number): string {
  return `${formatCurrency(amount)}/month`;
}
