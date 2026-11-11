import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Boxes,
  Brain,
  CheckCircle2,
  CircleDollarSign,
  FlaskConical,
  Hourglass,
  Loader2,
  Package,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/app-shell";
import { OrdersTable } from "@/components/orders-table";
import { PriorityBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { startDemoSession } from "@/lib/demo.functions";
import { PageError, PagePending } from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { analyzeOrder, FULFILMENT_LABELS, isPaymentVerified, STAGE_LABELS, type StageKey } from "@/lib/bottleneck";
import { formatMoney } from "@/lib/format";
import { ordersQuery, profileQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Your payment is complete. Is your order? — OrderFlow AI" },
      { name: "description", content: "OrderFlow AI investigates what happens after payment and finds fulfilment bottlenecks." },
      { property: "og:title", content: "Your payment is complete. Is your order? — OrderFlow AI" },
      { property: "og:description", content: "OrderFlow AI investigates what happens after payment and finds fulfilment bottlenecks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([context.queryClient.ensureQueryData(ordersQuery), context.queryClient.ensureQueryData(profileQuery)]),
  pendingComponent: PagePending,
  errorComponent: PageError,
  component: Dashboard,
});

const barConfig = { count: { label: "Orders blocked", color: "var(--chart-1)" } } satisfies ChartConfig;
const pieConfig = {
  fulfilled: { label: "Fulfilled", color: "var(--success)" },
  in_progress: { label: "In progress", color: "var(--primary-glow)" },
  at_risk: { label: "At risk", color: "var(--danger)" },
  awaiting_payment: { label: "Awaiting payment", color: "var(--warning)" },
} satisfies ChartConfig;

function Dashboard() {
  const { data: orders } = useSuspenseQuery(ordersQuery);
  const { data: profile } = useSuspenseQuery(profileQuery);
  const analyses = orders.map((o) => ({ o, a: analyzeOrder({ ...o, amount: Number(o.amount) }) }));

  // Only server-verified captures count as paid.
  const paid = analyses.filter(({ o }) => isPaymentVerified(o));
  const paidTotal = paid.reduce((s, { o }) => s + Number(o.amount), 0);
  const paidDemo = paid.filter(({ o }) => o.payment_source === "demo").length;
  const paidSandbox = paid.length - paidDemo;
  const awaiting = paid.filter(({ o }) => o.delivery_status !== "delivered").length;
  const pendingReview = orders.filter((o) => o.latest_investigation_status === "pending").length;
  const atRisk = analyses.filter(({ a }) => a.overallStatus === "at_risk");
  const fulfilled = analyses.filter(({ a }) => a.overallStatus === "fulfilled").length;

  const stageCounts = (["payment", "inventory", "supplier", "delivery"] as StageKey[]).map((k) => ({
    stage: STAGE_LABELS[k].replace(" confirmation", "").replace(" arrangement", ""),
    count: analyses.filter(({ a }) => a.bottleneck === k).length,
  }));
  const statusCounts = (Object.keys(pieConfig) as (keyof typeof pieConfig)[]).map((k) => ({
    status: k,
    value: analyses.filter(({ a }) => a.overallStatus === k).length,
    fill: pieConfig[k].color,
  }));

  const cards = [
    { label: "Total orders", value: orders.length, icon: Package, tone: "text-primary bg-info-soft" },
    {
      label: "Payments received",
      value: paid.length,
      sub: `${formatMoney(paidTotal)} · ${paidDemo} demo · ${paidSandbox} Sandbox`,
      icon: CircleDollarSign,
      tone: "text-success bg-success-soft",
    },
    { label: "Awaiting fulfilment", value: awaiting, icon: Hourglass, tone: "text-warning-foreground bg-warning-soft" },
    { label: "Orders at risk", value: atRisk.length, icon: ShieldAlert, tone: "text-danger bg-danger-soft" },
    { label: "Fulfilled", value: fulfilled, icon: CheckCircle2, tone: "text-success bg-success-soft" },
  ];

  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  const sortedRisk = [...atRisk].sort((x, y) => rank[x.a.priority] - rank[y.a.priority] || y.a.daysWaiting - x.a.daysWaiting);
  const topRisk = sortedRisk[0];

  if (orders.length === 0) return <EmptyDashboard isDemo={profile.isDemo} />;

  return (
    <>
      <PageHeader
        eyebrow={profile.isDemo ? "DEMO workspace · sample data" : "Overview"}
        title="Your payment is complete. Is your order?"
        description="OrderFlow AI investigates what happens after payment, identifies fulfilment bottlenecks and recommends what your business should do next."
      />

      <section className="relative mb-8 overflow-hidden rounded-2xl bg-hero p-6 text-navy-foreground shadow-elevated sm:p-8">
        <div className="absolute inset-0 grid-glow opacity-70" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-navy-muted uppercase">OrderFlow AI</p>
            <h2 className="mt-2 text-xl font-bold sm:text-2xl">
              Payment received does not always mean order fulfilled.
            </h2>
            <p className="mt-2 text-sm text-navy-muted">
              {atRisk.length > 0
                ? `${atRisk.length} paid order${atRisk.length === 1 ? " is" : "s are"} stuck right now. OrderFlow AI finds what is stopping fulfilment.`
                : "No paid orders are stuck right now."}
            </p>
          </div>
          {topRisk && (
            <Button asChild variant="secondary" size="lg" className="shrink-0">
              <Link to="/orders/$orderId" params={{ orderId: topRisk.o.id }}>
                Investigate {topRisk.o.id}
                <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map(({ label, value, sub, icon: Icon, tone }) => (
          <div key={label} className="rounded-xl border bg-card p-5 shadow-card">
            <div className={`mb-4 flex size-9 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="size-4.5" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-3xl font-bold text-foreground tabular-nums">{value}</p>
            {sub && <p className="mt-0.5 text-xs font-medium text-muted-foreground">{sub}</p>}
          </div>
        ))}
      </section>

      {sortedRisk.length > 0 && (
        <section className="mb-8 rounded-xl border bg-card p-5 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="size-4.5 text-primary" />
              <h3 className="text-base font-semibold">Fulfilment risks</h3>
              {pendingReview > 0 && <Badge variant="info">{pendingReview} awaiting your approval</Badge>}
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/orders">
                All orders <ArrowRight />
              </Link>
            </Button>
          </div>
          <ul className="grid gap-3 md:grid-cols-3">
            {sortedRisk.slice(0, 3).map(({ o, a }) => (
              <li key={o.id}>
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: o.id }}
                  className="flex h-full flex-col gap-2 rounded-lg border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{o.id}</span>
                    <PriorityBadge priority={a.priority} />
                  </div>
                  <p className="text-sm font-semibold">{a.bottleneckLabel}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{a.rootCause}</p>
                  <p className="mt-auto text-xs text-muted-foreground">
                    Payment verified · Fulfilment {FULFILMENT_LABELS[a.fulfilmentStatus].toLowerCase()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border bg-card p-5 shadow-card lg:col-span-3">
          <h3 className="text-base font-semibold">Where orders get stuck</h3>
          <p className="mb-4 text-xs text-muted-foreground">Main bottleneck per order, by fulfilment stage</p>
          <ChartContainer config={barConfig} className="h-56 w-full">
            <BarChart data={stageCounts} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="stage" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-card lg:col-span-2">
          <h3 className="text-base font-semibold">Order status</h3>
          <p className="mb-2 text-xs text-muted-foreground">All orders in the workspace</p>
          <ChartContainer config={pieConfig} className="mx-auto h-44 w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} />
              <Pie data={statusCounts} dataKey="value" nameKey="status" innerRadius={48} outerRadius={72} strokeWidth={2} isAnimationActive={false}>
                {statusCounts.map((s) => (
                  <Cell key={s.status} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {statusCounts.map((s) => (
              <li key={s.status} className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ background: pieConfig[s.status].color }} />
                {pieConfig[s.status].label}
                <span className="ml-auto font-semibold text-foreground">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent orders</h3>
          <Button asChild variant="ghost" size="sm">
            <Link to="/orders">
              View all orders <ArrowRight />
            </Link>
          </Button>
        </div>
        <OrdersTable orders={orders} />
      </section>
    </>
  );
}

function EmptyDashboard({ isDemo }: { isDemo: boolean }) {
  const startDemo = useServerFn(startDemoSession);
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function openDemo() {
    setBusy(true);
    try {
      const tokens = await startDemo();
      qc.clear();
      const { error } = await supabase.auth.setSession(tokens);
      if (error) throw error;
      await router.invalidate();
    } catch (e) {
      toast.error("Could not open the demo", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Your payment is complete. Is your order?"
        description="OrderFlow AI investigates what happens after payment, identifies fulfilment bottlenecks and recommends what your business should do next."
      />
      <section className="relative overflow-hidden rounded-2xl bg-hero p-6 text-navy-foreground shadow-elevated sm:p-10">
        <div className="absolute inset-0 grid-glow opacity-70" />
        <div className="relative max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-navy-muted uppercase">No orders yet</p>
          <h2 className="mt-2 text-xl font-bold sm:text-2xl">Payment received does not always mean order fulfilled.</h2>
          <p className="mt-2 text-sm text-navy-muted">
            Add a product with its stock and supplier, then create an order and send it to PayPal Sandbox. OrderFlow AI
            will check payment, stock, supplier and delivery for you.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="lg">
              <Link to="/orders">
                <Boxes /> Go to orders
              </Link>
            </Button>
            {!isDemo && (
              <Button size="lg" variant="outline" className="border-navy-foreground/30 bg-transparent text-navy-foreground hover:bg-navy-foreground/10 hover:text-navy-foreground" onClick={openDemo} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Explore the DEMO workspace instead
              </Button>
            )}
          </div>
          {!isDemo && (
            <p className="mt-3 text-xs text-navy-muted">
              The demo switches you to a separate sample account. Nothing is added to your business.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
