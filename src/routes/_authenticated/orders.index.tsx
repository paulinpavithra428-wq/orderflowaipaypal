import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { OrdersTable } from "@/components/orders-table";
import { PageError, PagePending } from "@/components/page-states";
import { Input } from "@/components/ui/input";
import { analyzeOrder, OVERALL_LABELS, type OverallStatus } from "@/lib/bottleneck";
import { ordersQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({
    meta: [
      { title: "Orders — OrderFlow AI" },
      { name: "description", content: "All PayPal orders with payment, inventory, supplier and delivery status." },
      { property: "og:title", content: "Orders — OrderFlow AI" },
      { property: "og:description", content: "All PayPal orders with payment, inventory, supplier and delivery status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(ordersQuery),
  pendingComponent: PagePending,
  errorComponent: PageError,
  component: OrdersPage,
});

type Filter = "all" | OverallStatus;
const FILTERS: Filter[] = ["all", "at_risk", "awaiting_payment", "in_progress", "fulfilled"];

function OrdersPage() {
  const { data: orders } = useSuspenseQuery(ordersQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const withStatus = useMemo(
    () => orders.map((o) => ({ o, status: analyzeOrder({ ...o, amount: Number(o.amount) }).overallStatus })),
    [orders],
  );
  const term = q.trim().toLowerCase();
  const visible = withStatus
    .filter(({ status }) => filter === "all" || status === filter)
    .filter(
      ({ o }) =>
        !term ||
        [o.id, o.customer_name, o.product, o.supplier_name].some((v) => v.toLowerCase().includes(term)),
    )
    .map(({ o }) => o);

  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title="All orders"
        description="Statuses come from verified checks. Open any order to let AI explain the bottleneck."
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-1 shadow-card">
          {FILTERS.map((f) => {
            const count = f === "all" ? withStatus.length : withStatus.filter((x) => x.status === f).length;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  filter === f ? "bg-navy text-navy-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "all" ? "All" : OVERALL_LABELS[f]} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order, customer, product…"
            className="bg-card pl-9"
          />
        </div>
      </div>
      <OrdersTable orders={visible} />
    </>
  );
}
