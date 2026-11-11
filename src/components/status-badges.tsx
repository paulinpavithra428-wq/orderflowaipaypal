import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { OVERALL_LABELS, type CheckState, type OverallStatus, type Priority } from "@/lib/bottleneck";

type Variant = NonNullable<BadgeProps["variant"]>;

const PAYMENT: Record<string, [Variant, string]> = {
  COMPLETED: ["success", "Completed"],
  CREATED: ["neutral", "Checkout created"],
  PAYER_ACTION_REQUIRED: ["warning", "Awaiting buyer"],
  APPROVED: ["info", "Approved, not captured"],
  PENDING: ["warning", "Pending"],
  DECLINED: ["danger", "Declined"],
  VOIDED: ["neutral", "Voided"],
  FAILED: ["danger", "Failed"],
  DENIED: ["danger", "Denied"],
  REFUNDED: ["neutral", "Refunded"],
};
const INVENTORY: Record<string, [Variant, string]> = {
  available: ["success", "Available"],
  low: ["warning", "Low stock"],
  unavailable: ["danger", "Unavailable"],
};
const SUPPLIER: Record<string, [Variant, string]> = {
  confirmed: ["success", "Confirmed"],
  pending: ["warning", "Confirmation pending"],
  delayed: ["danger", "Delayed"],
  not_confirmed: ["danger", "Not confirmed"],
};
const DELIVERY: Record<string, [Variant, string]> = {
  delivered: ["success", "Delivered"],
  in_transit: ["info", "In transit"],
  scheduled: ["info", "Scheduled"],
  not_scheduled: ["danger", "Not scheduled"],
};
const OVERALL: Record<OverallStatus, Variant> = {
  fulfilled: "success",
  in_progress: "info",
  at_risk: "danger",
  awaiting_payment: "warning",
};

function Dot() {
  return <span className="size-1.5 rounded-full bg-current" />;
}

function make(map: Record<string, [Variant, string]>) {
  return function StatusBadge({ value, dot = true }: { value: string; dot?: boolean }) {
    const [variant, label] = map[value] ?? ["neutral", value];
    return (
      <Badge variant={variant}>
        {dot && <Dot />}
        {label}
      </Badge>
    );
  };
}

export const PaymentBadge = make(PAYMENT);
export const InventoryBadge = make(INVENTORY);
export const SupplierBadge = make(SUPPLIER);
export const DeliveryBadge = make(DELIVERY);

export function OverallBadge({ status }: { status: OverallStatus }) {
  return <Badge variant={OVERALL[status]}>{OVERALL_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority | string }) {
  const variant: Variant = priority === "High" ? "danger" : priority === "Medium" ? "warning" : "success";
  return <Badge variant={variant}>{priority} priority</Badge>;
}

export function CheckIcon({ state }: { state: CheckState }) {
  if (state === "pass") return <CheckCircle2 className="size-5 text-success" />;
  if (state === "fail") return <XCircle className="size-5 text-danger" />;
  return <Clock className="size-5 text-muted-foreground" />;
}

export function DecisionBadge({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === "approved") return <Badge variant="success">Action approved</Badge>;
  if (status === "dismissed" || status === "rejected") return <Badge variant="neutral">Rejected</Badge>;
  if (status === "resolved") return <Badge variant="success">Resolved</Badge>;
  return (
    <Badge variant="info">
      <AlertTriangle className="size-3" />
      Awaiting approval
    </Badge>
  );
}

const SOURCE: Record<string, [Variant, string]> = {
  demo: ["warning", "DEMO"],
  paypal_sandbox: ["info", "PayPal Sandbox"],
  paypal_live: ["success", "PayPal Live"],
};

/** Labels where a payment came from, so demo transactions can never be mistaken for Sandbox ones. */
export function SourceBadge({ source }: { source: string }) {
  const [variant, label] = SOURCE[source] ?? ["neutral", source];
  return <Badge variant={variant}>{label}</Badge>;
}

export function InventoryFromStock({ available, quantity }: { available: number | null; quantity: number }) {
  if (available === null) return <Badge variant="neutral">No stock record</Badge>;
  if (available >= quantity) return <Badge variant="success">In stock</Badge>;
  if (available === 0) return <Badge variant="danger">Out of stock</Badge>;
  return <Badge variant="warning">Short {quantity - available}</Badge>;
}
