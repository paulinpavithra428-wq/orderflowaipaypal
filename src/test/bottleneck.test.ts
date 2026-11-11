import { describe, expect, it } from "vitest";

import { analyzeOrder, type OrderFacts } from "@/lib/bottleneck";

const now = new Date("2026-11-10T12:00:00Z");

function order(overrides: Partial<OrderFacts>): OrderFacts {
  return {
    id: "T1",
    quantity: 1,
    amount: 100,
    paypal_payment_status: "COMPLETED",
    payment_verified_at: "2026-11-08T12:00:00Z",
    available: 10,
    supplier_status: "confirmed",
    supplier_confirmed_qty: null,
    supplier_dispatch_date: null,
    delivery_status: "not_scheduled",
    ordered_at: "2026-11-08T12:00:00Z",
    ...overrides,
  };
}

describe("bottleneck detection", () => {
  it("scenario 1: paid, in stock, supplier not confirmed -> supplier bottleneck", () => {
    const a = analyzeOrder(order({ supplier_status: "not_confirmed" }), now);
    expect(a.bottleneck).toBe("supplier");
    expect(a.overallStatus).toBe("at_risk");
  });

  it("scenario 2: paid, out of stock, supplier confirmed -> inventory bottleneck, High", () => {
    const a = analyzeOrder(order({ available: 0 }), now);
    expect(a.bottleneck).toBe("inventory");
    expect(a.priority).toBe("High");
  });

  it("scenario 3: paid, in stock, supplier confirmed, no delivery -> delivery bottleneck", () => {
    expect(analyzeOrder(order({}), now).bottleneck).toBe("delivery");
  });

  it("headphones: 10 ordered, 4 on hand, supplier pending -> shortage of 6, supplier as secondary", () => {
    const a = analyzeOrder(order({ quantity: 10, available: 4, supplier_status: "pending" }), now);
    expect(a.bottleneck).toBe("inventory");
    expect(a.shortage).toBe(6);
    expect(a.secondaryIssues).toContain("supplier");
    expect(a.priority).toBe("High");
  });

  it("supplier confirming fewer units than the shortage is still a supplier issue", () => {
    const a = analyzeOrder(order({ quantity: 10, available: 4, supplier_confirmed_qty: 3 }), now);
    expect(a.checks.find((c) => c.key === "supplier")?.state).toBe("fail");
  });

  it("COMPLETED status without PayPal verification does not count as paid", () => {
    const a = analyzeOrder(order({ payment_verified_at: null }), now);
    expect(a.bottleneck).toBe("payment");
    expect(a.overallStatus).toBe("awaiting_payment");
  });

  it("pending payment is the bottleneck even when later stages are unfinished", () => {
    const a = analyzeOrder(order({ paypal_payment_status: "PENDING", supplier_status: "pending" }), now);
    expect(a.bottleneck).toBe("payment");
  });

  it("missing stock record means insufficient evidence, never an invented quantity", () => {
    const a = analyzeOrder(order({ available: null, delivery_status: "scheduled" }), now);
    expect(a.bottleneck).toBe("unknown");
    expect(a.evidenceSufficient).toBe(false);
  });

  it("delivered order has no bottleneck and counts as fulfilled", () => {
    const a = analyzeOrder(order({ delivery_status: "delivered" }), now);
    expect(a.bottleneck).toBe("none");
    expect(a.overallStatus).toBe("fulfilled");
  });

  it("supplier bottleneck waiting 3+ days is High priority, under 3 days is Medium", () => {
    const old = analyzeOrder(order({ supplier_status: "not_confirmed", ordered_at: "2026-11-07T12:00:00Z" }), now);
    const fresh = analyzeOrder(order({ supplier_status: "not_confirmed", ordered_at: "2026-11-09T12:00:00Z" }), now);
    expect(old.priority).toBe("High");
    expect(fresh.priority).toBe("Medium");
  });
});
