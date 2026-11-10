import { describe, expect, it } from "vitest";

import { analyzeOrder, type OrderFacts } from "@/lib/bottleneck";

const now = new Date("2026-11-10T12:00:00Z");

function order(overrides: Partial<OrderFacts>): OrderFacts {
  return {
    id: "T1",
    quantity: 1,
    amount: 100,
    paypal_payment_status: "COMPLETED",
    inventory_status: "available",
    inventory_on_hand: 10,
    supplier_status: "confirmed",
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

  it("scenario 2: paid, out of stock, supplier confirmed -> inventory bottleneck", () => {
    const a = analyzeOrder(order({ inventory_status: "unavailable", inventory_on_hand: 0 }), now);
    expect(a.bottleneck).toBe("inventory");
    expect(a.priority).toBe("High");
  });

  it("scenario 3: paid, in stock, supplier confirmed, no delivery -> delivery bottleneck", () => {
    const a = analyzeOrder(order({}), now);
    expect(a.bottleneck).toBe("delivery");
  });

  it("pending payment is the bottleneck even when later stages are unfinished", () => {
    const a = analyzeOrder(order({ paypal_payment_status: "PENDING", supplier_status: "pending" }), now);
    expect(a.bottleneck).toBe("payment");
    expect(a.overallStatus).toBe("awaiting_payment");
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
