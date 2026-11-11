import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import {
  DecisionBadge,
  DeliveryBadge,
  InventoryFromStock,
  OverallBadge,
  PaymentBadge,
  SourceBadge,
  SupplierBadge,
} from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { analyzeOrder } from "@/lib/bottleneck";
import { formatMoney } from "@/lib/format";
import type { OrderWithLatest } from "@/lib/orders.functions";

export function OrdersTable({ orders, emptyText }: { orders: OrderWithLatest[]; emptyText?: string }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
        {emptyText ?? "No orders match this view."}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <th className="px-2.5 py-3">Order · Customer</th>
              <th className="px-2.5 py-3">Product · Amount</th>
              <th className="px-2.5 py-3">PayPal</th>
              <th className="px-2.5 py-3">Inventory</th>
              <th className="px-2.5 py-3">Supplier</th>
              <th className="px-2.5 py-3">Delivery</th>
              <th className="px-2.5 py-3">Overall</th>
              <th className="px-2.5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const a = analyzeOrder({ ...o, amount: Number(o.amount) });
              return (
                <tr key={o.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-2.5 py-3">
                    <div className="font-mono text-xs font-semibold text-foreground">{o.id}</div>
                    <div className="text-xs text-muted-foreground">{o.customer_name}</div>
                  </td>
                  <td className="max-w-[140px] px-2.5 py-3">
                    <div className="truncate font-medium text-foreground" title={o.product}>
                      {o.product}
                      {o.quantity > 1 && <span className="ml-1 text-xs text-muted-foreground">×{o.quantity}</span>}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground tabular-nums">
                      {formatMoney(o.amount, o.currency)}
                    </div>
                  </td>
                  <td className="px-2.5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <PaymentBadge dot={false} value={o.paypal_payment_status} />
                      <SourceBadge source={o.payment_source} />
                    </div>
                  </td>
                  <td className="px-2.5 py-3">
                    <InventoryFromStock available={o.available} quantity={o.quantity} />
                  </td>
                  <td className="px-2.5 py-3">
                    <SupplierBadge dot={false} value={o.supplier_status} />
                  </td>
                  <td className="px-2.5 py-3">
                    <DeliveryBadge dot={false} value={o.delivery_status} />
                  </td>
                  <td className="px-2.5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <OverallBadge status={a.overallStatus} />
                      <DecisionBadge status={o.latest_investigation_status} />
                    </div>
                  </td>
                  <td className="px-2.5 py-3 text-right">
                    <Button asChild size="sm" variant={a.overallStatus === "at_risk" ? "default" : "outline"}>
                      <Link to="/orders/$orderId" params={{ orderId: o.id }}>
                        <Sparkles />
                        Investigate with AI
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
