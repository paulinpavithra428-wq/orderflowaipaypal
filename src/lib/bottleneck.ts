// Deterministic fulfilment checks. These rules — not the AI — decide the facts:
// which stage is blocked, shortages, priority and confidence. The AI only explains them.

export interface OrderFacts {
  id: string;
  quantity: number;
  amount: number;
  paypal_payment_status: string;
  payment_verified_at: string | null;
  /** Units on hand for the linked product; null when no inventory record exists. */
  available: number | null;
  supplier_status: string;
  supplier_confirmed_qty: number | null;
  supplier_dispatch_date: string | null;
  delivery_status: string;
  ordered_at: string;
}

export type StageKey = "payment" | "inventory" | "supplier" | "delivery";
export type BottleneckKey = StageKey | "unknown" | "none";
export type CheckState = "pass" | "fail" | "waiting" | "unknown";
export type Priority = "Low" | "Medium" | "High";
export type OverallStatus = "fulfilled" | "in_progress" | "at_risk" | "awaiting_payment";
export type FulfilmentStatus = "delivered" | "in_transit" | "scheduled" | "blocked" | "not_started";

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
  required: number;
  available: number | null;
  shortage: number;
  evidence: string[];
  evidenceSufficient: boolean;
  missingEvidence: string[];
  rootCause: string;
  businessImpact: string;
  overallStatus: OverallStatus;
  fulfilmentStatus: FulfilmentStatus;
}

export const STAGE_LABELS: Record<StageKey, string> = {
  payment: "PayPal payment",
  inventory: "Inventory",
  supplier: "Supplier confirmation",
  delivery: "Delivery arrangement",
};

export const FULFILMENT_LABELS: Record<FulfilmentStatus, string> = {
  delivered: "Delivered",
  in_transit: "In transit",
  scheduled: "Ready to ship",
  blocked: "Blocked",
  not_started: "Not started",
};

export function daysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function isPaymentVerified(o: Pick<OrderFacts, "paypal_payment_status" | "payment_verified_at">) {
  return o.paypal_payment_status.toUpperCase() === "COMPLETED" && Boolean(o.payment_verified_at);
}

function paymentCheck(o: OrderFacts): StageCheck {
  const base = { key: "payment" as const, label: STAGE_LABELS.payment };
  const s = o.paypal_payment_status.toUpperCase();
  if (s === "COMPLETED" && o.payment_verified_at) {
    return { ...base, state: "pass", value: "Verified", detail: "PayPal confirms the payment was captured." };
  }
  if (s === "COMPLETED") {
    return { ...base, state: "fail", value: "Not verified", detail: "Payment is marked complete but has not been verified with PayPal." };
  }
  const map: Record<string, [string, string]> = {
    CREATED: ["Awaiting checkout", "A PayPal order exists but the customer has not paid yet."],
    PAYER_ACTION_REQUIRED: ["Awaiting checkout", "The customer still needs to approve the payment in PayPal."],
    APPROVED: ["Approved, not captured", "The customer approved the payment but it has not been captured yet."],
    PENDING: ["Pending", "PayPal has not released the funds yet."],
    DECLINED: ["Declined", "PayPal declined the payment."],
    FAILED: ["Failed", "PayPal reports the payment as failed."],
    DENIED: ["Denied", "PayPal denied the payment."],
    REFUNDED: ["Refunded", "The payment has been refunded."],
    VOIDED: ["Voided", "The PayPal order was voided."],
  };
  const [value, detail] = map[s] ?? [s, `PayPal reports the payment as ${s.toLowerCase()}.`];
  return { ...base, state: "fail", value, detail };
}

function inventoryCheck(o: OrderFacts): StageCheck {
  const base = { key: "inventory" as const, label: STAGE_LABELS.inventory };
  if (o.available === null) {
    return { ...base, state: "unknown", value: "No stock record", detail: "This order is not linked to an inventory item, so stock cannot be checked." };
  }
  if (o.available >= o.quantity) {
    return { ...base, state: "pass", value: "Available", detail: `${o.available} on hand covers the ${o.quantity} required.` };
  }
  const shortage = o.quantity - o.available;
  return {
    ...base,
    state: "fail",
    value: o.available === 0 ? "Out of stock" : `Short by ${shortage}`,
    detail: `${o.quantity} required, ${o.available} on hand — short by ${shortage}.`,
  };
}

function supplierCheck(o: OrderFacts, shortage: number): StageCheck {
  const base = { key: "supplier" as const, label: STAGE_LABELS.supplier };
  const dispatch = o.supplier_dispatch_date ? ` Dispatch date provided: ${o.supplier_dispatch_date}.` : " No dispatch date has been provided.";
  switch (o.supplier_status) {
    case "confirmed": {
      if (shortage > 0 && o.supplier_confirmed_qty !== null && o.supplier_confirmed_qty < shortage) {
        return {
          ...base,
          state: "fail",
          value: "Partial confirmation",
          detail: `Supplier confirmed ${o.supplier_confirmed_qty} units but ${shortage} are needed.${dispatch}`,
        };
      }
      const qty = o.supplier_confirmed_qty !== null ? ` ${o.supplier_confirmed_qty} units confirmed.` : "";
      return { ...base, state: "pass", value: "Confirmed", detail: `Supplier has confirmed the order.${qty}${shortage > 0 ? dispatch : ""}` };
    }
    case "delayed":
      return { ...base, state: "fail", value: "Delayed", detail: `Supplier reported a delay.${dispatch}` };
    case "pending":
      return { ...base, state: "fail", value: "Confirmation pending", detail: `Supplier has been contacted but has not confirmed quantity.${dispatch}` };
    case "not_confirmed":
      return { ...base, state: "fail", value: "Not confirmed", detail: "Supplier has not confirmed the order." };
    default:
      return { ...base, state: "unknown", value: "Unknown", detail: "No supplier status has been recorded." };
  }
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

function supplierLabel(status: string): string {
  if (status === "pending") return "Supplier confirmation pending";
  if (status === "delayed") return "Supplier delay";
  if (status === "confirmed") return "Supplier confirmed too few units";
  return "Supplier has not confirmed";
}

/** Stage order is the fulfilment dependency order: payment gates everything, delivery depends on all. */
export function analyzeOrder(order: OrderFacts, now: Date = new Date()): BottleneckAnalysis {
  const daysWaiting = daysSince(order.ordered_at, now);
  const shortage = order.available === null ? 0 : Math.max(0, order.quantity - order.available);
  const payment = paymentCheck(order);
  const inventory = inventoryCheck(order);
  const supplier = supplierCheck(order, shortage);
  const delivery = deliveryCheck(order);

  if (order.delivery_status === "delivered" || order.delivery_status === "in_transit") {
    // Goods already left: upstream stock/supplier gaps no longer block this order.
    for (const c of [inventory, supplier]) if (c.state !== "pass") c.state = "pass";
  }
  if (payment.state === "fail") {
    for (const c of [inventory, supplier, delivery]) if (c.state === "fail") c.state = "waiting";
  } else if (inventory.state !== "pass" || supplier.state !== "pass") {
    if (delivery.state === "fail") delivery.state = "waiting";
  }

  const checks = [payment, inventory, supplier, delivery];
  const failing = checks.filter((c) => c.state === "fail");
  const unknown = checks.filter((c) => c.state === "unknown");
  const bottleneck: BottleneckKey = failing[0]?.key ?? (unknown.length ? "unknown" : "none");
  const secondaryIssues = failing.slice(1).map((c) => c.key);

  const labels: Record<BottleneckKey, string> = {
    payment: "Payment not verified",
    inventory: "Inventory shortage",
    supplier: supplierLabel(order.supplier_status),
    delivery: "Delivery not arranged",
    unknown: "Insufficient evidence",
    none: "No bottleneck detected",
  };

  const priority = computePriority(bottleneck, daysWaiting, { shortage, available: order.available, supplierStatus: order.supplier_status });
  const evidenceSufficient = unknown.length === 0;
  const confidence = !evidenceSufficient ? 60 : bottleneck === "none" ? 90 : failing.length === 1 ? 95 : 85;

  const evidence = checks.map((c) => `${c.label}: ${c.value} — ${c.detail}`);
  evidence.push(`Order placed ${daysWaiting} day${daysWaiting === 1 ? "" : "s"} ago.`);

  const { rootCause, businessImpact } = describe(bottleneck, order, shortage, secondaryIssues);

  return {
    checks,
    bottleneck,
    bottleneckLabel: labels[bottleneck],
    secondaryIssues,
    priority,
    confidence,
    daysWaiting,
    required: order.quantity,
    available: order.available,
    shortage,
    evidence,
    evidenceSufficient,
    missingEvidence: unknown.map((c) => c.detail),
    rootCause,
    businessImpact,
    overallStatus: computeOverallStatus(order, bottleneck),
    fulfilmentStatus: computeFulfilmentStatus(order, bottleneck),
  };
}

function describe(b: BottleneckKey, o: OrderFacts, shortage: number, secondary: StageKey[]) {
  const supplierToo = secondary.includes("supplier");
  switch (b) {
    case "payment":
      return {
        rootCause: "The payment has not been verified as captured by PayPal.",
        businessImpact: "Fulfilling now risks shipping goods that are never paid for.",
      };
    case "inventory":
      return {
        rootCause: `Only ${o.available ?? 0} of the ${o.quantity} units are in stock (short by ${shortage})${supplierToo ? ", and the supplier has not confirmed a restock" : ""}.`,
        businessImpact: `The customer has paid ${o.amount.toFixed(2)} but the order cannot be fully fulfilled until ${shortage} more units arrive.`,
      };
    case "supplier":
      return {
        rootCause: o.supplier_status === "delayed" ? "The supplier has reported a delay." : "The supplier has not confirmed the order.",
        businessImpact: "Delivery cannot be arranged until the supplier confirms, so the paid order will ship late.",
      };
    case "delivery":
      return {
        rootCause: "Payment, stock and supplier are all ready, but no carrier collection has been booked.",
        businessImpact: "The order is ready but will not reach the customer until shipping is arranged.",
      };
    case "unknown":
      return {
        rootCause: "There is not enough recorded information to identify the bottleneck with confidence.",
        businessImpact: "The order's real status is unclear; missing data must be recorded before acting.",
      };
    default:
      return { rootCause: "No blocking issue found.", businessImpact: "No impact — the order is on track." };
  }
}

export function computePriority(
  bottleneck: BottleneckKey,
  daysWaiting: number,
  ctx: { shortage?: number; available?: number | null; supplierStatus?: string } = {},
): Priority {
  switch (bottleneck) {
    case "none":
      return "Low";
    case "unknown":
      return "Medium";
    case "inventory":
      return ctx.available === 0 || (ctx.shortage ?? 0) >= 5 || daysWaiting >= 5 ? "High" : "Medium";
    case "supplier":
      return ctx.supplierStatus === "delayed" || daysWaiting >= 3 ? "High" : "Medium";
    case "payment":
    case "delivery":
      return daysWaiting >= 3 ? "High" : "Medium";
  }
}

export function computeOverallStatus(order: OrderFacts, bottleneck: BottleneckKey): OverallStatus {
  if (!isPaymentVerified(order)) return "awaiting_payment";
  if (order.delivery_status === "delivered") return "fulfilled";
  if (bottleneck === "none") return "in_progress";
  return "at_risk";
}

export function computeFulfilmentStatus(order: OrderFacts, bottleneck: BottleneckKey): FulfilmentStatus {
  if (order.delivery_status === "delivered") return "delivered";
  if (order.delivery_status === "in_transit") return "in_transit";
  if (!isPaymentVerified(order)) return "not_started";
  if (bottleneck === "none") return "scheduled";
  return "blocked";
}

export const OVERALL_LABELS: Record<OverallStatus, string> = {
  fulfilled: "Fulfilled",
  in_progress: "In progress",
  at_risk: "At risk",
  awaiting_payment: "Awaiting payment",
};

/** Build facts from an order row joined with its product's stock. */
export function toFacts(
  o: {
    id: string;
    quantity: number;
    amount: number | string;
    paypal_payment_status: string;
    payment_verified_at: string | null;
    supplier_status: string;
    supplier_confirmed_qty: number | null;
    supplier_dispatch_date: string | null;
    delivery_status: string;
    ordered_at: string;
  },
  available: number | null,
): OrderFacts {
  return { ...o, amount: Number(o.amount), available };
}
