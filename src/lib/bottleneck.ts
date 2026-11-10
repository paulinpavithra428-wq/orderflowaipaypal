// Deterministic fulfilment checks. These rules — not the AI — decide the facts:
// which stage is blocked, the priority and the confidence. The AI only explains them.

export type PaymentStatus = "COMPLETED" | "PENDING" | "FAILED" | "REFUNDED" | "DENIED" | string;
export type InventoryStatus = "available" | "low" | "unavailable" | string;
export type SupplierStatus = "confirmed" | "pending" | "not_confirmed" | string;
export type DeliveryStatus = "scheduled" | "in_transit" | "delivered" | "not_scheduled" | string;

export interface OrderFacts {
  id: string;
  quantity: number;
  amount: number;
  paypal_payment_status: PaymentStatus;
  inventory_status: InventoryStatus;
  inventory_on_hand: number;
  supplier_status: SupplierStatus;
  delivery_status: DeliveryStatus;
  ordered_at: string;
}

export type StageKey = "payment" | "inventory" | "supplier" | "delivery";
export type BottleneckKey = StageKey | "none";
export type CheckState = "pass" | "fail" | "waiting";
export type Priority = "Low" | "Medium" | "High";
export type OverallStatus = "fulfilled" | "in_progress" | "at_risk" | "awaiting_payment";

export interface StageCheck {
  key: StageKey;
  label: string;
  state: CheckState;
  value: string;
  detail: string;
}

export interface BottleneckAnalysis {
  checks: StageCheck[];
  bottleneck: BottleneckKey;
  bottleneckLabel: string;
  secondaryIssues: StageKey[];
  priority: Priority;
  confidence: number;
  daysWaiting: number;
  evidence: string[];
  overallStatus: OverallStatus;
}

export const STAGE_LABELS: Record<StageKey, string> = {
  payment: "PayPal payment",
  inventory: "Inventory",
  supplier: "Supplier confirmation",
  delivery: "Delivery arrangement",
};

export const BOTTLENECK_LABELS: Record<BottleneckKey, string> = {
  payment: "Payment not completed",
  inventory: "Inventory shortage",
  supplier: "Supplier has not confirmed",
  delivery: "Delivery not scheduled",
  none: "No bottleneck detected",
};

export function daysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function paymentCheck(o: OrderFacts): StageCheck {
  const s = o.paypal_payment_status.toUpperCase();
  if (s === "COMPLETED") {
    return { key: "payment", label: STAGE_LABELS.payment, state: "pass", value: "Completed", detail: "PayPal reports the payment as completed." };
  }
  if (s === "PENDING") {
    return { key: "payment", label: STAGE_LABELS.payment, state: "fail", value: "Pending", detail: "PayPal has not released the funds yet." };
  }
  const value = s.charAt(0) + s.slice(1).toLowerCase();
  return { key: "payment", label: STAGE_LABELS.payment, state: "fail", value, detail: `PayPal reports the payment as ${value.toLowerCase()}.` };
}

function inventoryCheck(o: OrderFacts): StageCheck {
  const base = { key: "inventory" as const, label: STAGE_LABELS.inventory };
  if (o.inventory_status === "unavailable" || o.inventory_on_hand <= 0) {
    return { ...base, state: "fail", value: "Unavailable", detail: `0 units on hand; order needs ${o.quantity}.` };
  }
  if (o.inventory_on_hand < o.quantity) {
    return { ...base, state: "fail", value: "Insufficient", detail: `${o.inventory_on_hand} on hand; order needs ${o.quantity}.` };
  }
  if (o.inventory_status === "low") {
    return { ...base, state: "pass", value: "Low stock", detail: `${o.inventory_on_hand} on hand covers this order of ${o.quantity}.` };
  }
  return { ...base, state: "pass", value: "Available", detail: `${o.inventory_on_hand} units on hand; order needs ${o.quantity}.` };
}

function supplierCheck(o: OrderFacts): StageCheck {
  const base = { key: "supplier" as const, label: STAGE_LABELS.supplier };
  if (o.supplier_status === "confirmed") {
    return { ...base, state: "pass", value: "Confirmed", detail: "Supplier has confirmed the order." };
  }
  if (o.supplier_status === "pending") {
    return { ...base, state: "fail", value: "Awaiting reply", detail: "Supplier has been notified but has not replied." };
  }
  return { ...base, state: "fail", value: "Not confirmed", detail: "Supplier has not confirmed the order." };
}

function deliveryCheck(o: OrderFacts): StageCheck {
  const base = { key: "delivery" as const, label: STAGE_LABELS.delivery };
  switch (o.delivery_status) {
    case "delivered":
      return { ...base, state: "pass", value: "Delivered", detail: "Carrier reports the parcel as delivered." };
    case "in_transit":
      return { ...base, state: "pass", value: "In transit", detail: "Parcel is on its way with the carrier." };
    case "scheduled":
      return { ...base, state: "pass", value: "Scheduled", detail: "Collection is booked with a carrier." };
    default:
      return { ...base, state: "fail", value: "Not scheduled", detail: "No carrier collection has been booked." };
  }
}

/** Stage order is the fulfilment dependency order: payment gates everything, delivery depends on all. */
export function analyzeOrder(order: OrderFacts, now: Date = new Date()): BottleneckAnalysis {
  const daysWaiting = daysSince(order.ordered_at, now);
  const payment = paymentCheck(order);
  const inventory = inventoryCheck(order);
  const supplier = supplierCheck(order);
  const delivery = deliveryCheck(order);

  // Payment gates every later stage: unfinished downstream work is expected, not a fault.
  if (payment.state === "fail") {
    for (const c of [inventory, supplier, delivery]) if (c.state === "fail") c.state = "waiting";
  } else if (inventory.state === "fail" || supplier.state === "fail") {
    // Delivery cannot be booked until goods and supplier are ready.
    if (delivery.state === "fail") delivery.state = "waiting";
  }

  const checks = [payment, inventory, supplier, delivery];
  const failing = checks.filter((c) => c.state === "fail");
  const bottleneck: BottleneckKey = failing[0]?.key ?? "none";
  const secondaryIssues = failing.slice(1).map((c) => c.key);

  const priority = computePriority(bottleneck, daysWaiting, inventory.value);
  const confidence = bottleneck === "none" ? 90 : failing.length === 1 ? 95 : 80;

  const evidence = checks.map((c) => `${c.label}: ${c.value} — ${c.detail}`);
  evidence.push(`Order placed ${daysWaiting} day${daysWaiting === 1 ? "" : "s"} ago.`);

  return {
    checks,
    bottleneck,
    bottleneckLabel: BOTTLENECK_LABELS[bottleneck],
    secondaryIssues,
    priority,
    confidence,
    daysWaiting,
    evidence,
    overallStatus: computeOverallStatus(order, bottleneck),
  };
}

export function computePriority(bottleneck: BottleneckKey, daysWaiting: number, inventoryValue = ""): Priority {
  switch (bottleneck) {
    case "none":
      return "Low";
    case "inventory":
      return inventoryValue === "Unavailable" || daysWaiting >= 5 ? "High" : "Medium";
    case "payment":
      return daysWaiting >= 3 ? "High" : "Medium";
    case "supplier":
    case "delivery":
      return daysWaiting >= 3 ? "High" : "Medium";
  }
}

export function computeOverallStatus(order: OrderFacts, bottleneck: BottleneckKey): OverallStatus {
  if (order.paypal_payment_status.toUpperCase() !== "COMPLETED") return "awaiting_payment";
  if (order.delivery_status === "delivered") return "fulfilled";
  if (bottleneck === "none") return "in_progress";
  return "at_risk";
}

export const OVERALL_LABELS: Record<OverallStatus, string> = {
  fulfilled: "Fulfilled",
  in_progress: "In progress",
  at_risk: "At risk",
  awaiting_payment: "Awaiting payment",
};
