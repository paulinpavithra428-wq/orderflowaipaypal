import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { OVERALL_LABELS, type CheckState, type OverallStatus, type Priority } from "@/lib/bottleneck";

type Variant = NonNullable<BadgeProps["variant"]>;

const PAYMENT: Record<string, [Variant, string]> = {
  COMPLETED: ["success", "Completed"],
  PENDING: ["warning", "Pending"],
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
  pending: ["warning", "Awaiting reply"],
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
  if (status === "dismissed") return <Badge variant="neutral">Dismissed</Badge>;
  return (
    <Badge variant="info">
      <AlertTriangle className="size-3" />
      Awaiting approval
    </Badge>
  );
}
