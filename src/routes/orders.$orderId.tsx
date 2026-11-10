import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PagePending, PageError } from "@/components/page-states";
import { CheckIcon, DecisionBadge, OverallBadge, PaymentBadge, PriorityBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { analyzeOrder } from "@/lib/bottleneck";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { decideInvestigation, runInvestigation, type Investigation } from "@/lib/orders.functions";
import { orderDetailQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orders/$orderId")({
  head: ({ params }) => ({
    meta: [
      { title: `Investigate ${params.orderId} — OrderFlow AI` },
      { name: "description", content: `AI investigation of why order ${params.orderId} is not yet fulfilled.` },
      { property: "og:title", content: `Investigate ${params.orderId} — OrderFlow AI` },
      { property: "og:description", content: `AI investigation of why order ${params.orderId} is not yet fulfilled.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context, params }) => {
    const res = await context.queryClient.ensureQueryData(orderDetailQuery(params.orderId));
    if (!res.order) throw notFound();
    return res;
  },
  pendingComponent: PagePending,
  errorComponent: PageError,
  notFoundComponent: () => (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h2 className="text-xl font-semibold">Order not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">This order ID does not exist in your workspace.</p>
      <Button asChild className="mt-4">
        <Link to="/orders">Back to orders</Link>
      </Button>
    </div>
  ),
  component: InvestigationPage,
});

const SOURCE_LABEL: Record<string, string> = {
  demo: "Demo transaction",
  paypal_sandbox: "PayPal Sandbox",
  paypal_live: "PayPal Live",
};

function InvestigationPage() {
  const { orderId } = Route.useParams();
  const { data } = useSuspenseQuery(orderDetailQuery(orderId));
  const order = data.order!;
  const payment = data.payment!;
  const latest = data.investigations[0] ?? null;
  const analysis = analyzeOrder({ ...order, amount: Number(order.amount), paypal_payment_status: payment.status });

  const qc = useQueryClient();
  const run = useServerFn(runInvestigation);
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["order", orderId] }),
      qc.invalidateQueries({ queryKey: ["orders"] }),
      qc.invalidateQueries({ queryKey: ["activity"] }),
    ]);

  const investigate = useMutation({
    mutationFn: () => run({ data: { orderId } }),
    onSuccess: async (res) => {
      await invalidate();
      if (res.aiError) toast.warning("AI unavailable — showing rule-based recommendation", { description: res.aiError });
      else toast.success("Investigation complete");
    },
    onError: (e) => toast.error("Investigation failed", { description: e.message }),
  });

  return (
    <>
      <Link
        to="/orders"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All orders
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-primary uppercase">Order investigation</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold sm:text-3xl">{order.id}</h1>
            <OverallBadge status={analysis.overallStatus} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {order.product} ×{order.quantity} · {order.customer_name} · {formatMoney(order.amount, order.currency)} ·
            placed {formatDate(order.ordered_at)}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => investigate.mutate()}
          disabled={investigate.isPending}
          variant={latest ? "outline" : "default"}
        >
          {investigate.isPending ? <Loader2 className="animate-spin" /> : latest ? <RefreshCw /> : <Sparkles />}
          {investigate.isPending ? "Investigating…" : latest ? "Re-run investigation" : "Investigate with AI"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <section className="rounded-xl border bg-card p-5 shadow-card sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Fulfilment checks</h2>
                <p className="text-xs text-muted-foreground">Verified by rules — the AI never changes these facts</p>
              </div>
              <Badge variant="neutral">
                <ShieldCheck className="size-3" /> Deterministic
              </Badge>
            </div>
            <ol className="flex flex-col gap-2">
              {analysis.checks.map((c, i) => {
                const isBottleneck = c.key === analysis.bottleneck;
                return (
                  <li
                    key={c.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3.5",
                      isBottleneck ? "border-danger/30 bg-danger-soft" : "bg-background",
                    )}
                  >
                    <span className="mt-0.5 text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                    <CheckIcon state={c.state} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{c.label}</span>
                        <span className="text-sm text-muted-foreground">· {c.value}</span>
                        {isBottleneck && <Badge variant="danger">Main bottleneck</Badge>}
                        {c.state === "waiting" && <Badge variant="neutral">Waiting on earlier step</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {investigate.isPending ? (
            <InvestigatingState />
          ) : latest ? (
            <RecommendationPanel key={latest.id} inv={latest} onChanged={invalidate} />
          ) : (
            <section className="rounded-xl border border-dashed bg-card p-8 text-center shadow-card">
              <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary-gradient shadow-elevated">
                <Sparkles className="size-5 text-primary-foreground" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">No investigation yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                OrderFlow AI will review the four checks above, explain the bottleneck and draft a message for you to
                review.
              </p>
              <Button className="mt-5" onClick={() => investigate.mutate()}>
                <Sparkles /> Investigate with AI
              </Button>
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">PayPal payment</h2>
              <Badge variant={payment.source === "demo" ? "warning" : "info"}>{SOURCE_LABEL[payment.source]}</Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <PaymentBadge value={payment.status} />
              </dd>
              <dt className="text-muted-foreground">Transaction ID</dt>
              <dd className="font-mono text-xs break-all">{payment.transactionId ?? "—"}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-semibold">{formatMoney(payment.amount, payment.currency)}</dd>
              <dt className="text-muted-foreground">Payer</dt>
              <dd className="break-all">{payment.payerEmail ?? "—"}</dd>
              <dt className="text-muted-foreground">Captured</dt>
              <dd>{formatDateTime(payment.createTime)}</dd>
            </dl>
            {payment.note && <p className="mt-3 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">{payment.note}</p>}
            {payment.source === "demo" && !payment.note && (
              <p className="mt-3 text-xs text-muted-foreground">
                Demo data.{" "}
                <Link to="/settings" className="font-medium text-primary hover:underline">
                  Connect PayPal Sandbox
                </Link>{" "}
                to load real transactions.
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-card">
            <h2 className="mb-4 text-base font-semibold">Order details</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                {order.customer_name}
                <span className="block text-xs text-muted-foreground">{order.customer_email}</span>
              </dd>
              <dt className="text-muted-foreground">SKU</dt>
              <dd className="font-mono text-xs">{order.sku}</dd>
              <dt className="text-muted-foreground">On hand</dt>
              <dd>{order.inventory_on_hand} units</dd>
              <dt className="text-muted-foreground">Supplier</dt>
              <dd>
                {order.supplier_name}
                <span className="block text-xs text-muted-foreground">{order.supplier_email}</span>
              </dd>
              <dt className="text-muted-foreground">Carrier</dt>
              <dd>
                {order.carrier ?? "None booked"}
                {order.tracking_number && (
                  <span className="block font-mono text-xs text-muted-foreground">{order.tracking_number}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Waiting</dt>
              <dd>
                {analysis.daysWaiting} day{analysis.daysWaiting === 1 ? "" : "s"}
              </dd>
            </dl>
          </section>

          {data.investigations.length > 0 && (
            <section className="rounded-xl border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-base font-semibold">Investigation history</h2>
              <ul className="flex flex-col gap-3">
                {data.investigations.map((inv) => (
                  <li key={inv.id} className="flex items-start justify-between gap-3 border-b pb-3 text-sm last:border-0 last:pb-0">
                    <div>
                      <p className="font-medium">{inv.bottleneck_label}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(inv.created_at)}</p>
                    </div>
                    <DecisionBadge status={inv.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function InvestigatingState() {
  const steps = ["Checking PayPal payment", "Checking inventory", "Checking supplier", "Checking delivery", "Writing recommendation"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <section className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-card">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-accent">
        <div className="h-full w-1/3 animate-scan bg-primary-gradient" />
      </div>
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
        <h2 className="text-base font-semibold">OrderFlow AI is investigating…</h2>
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i <= step ? "text-foreground" : "text-muted-foreground/60")}>
            {i < step ? <Check className="size-4 text-success" /> : i === step ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4" />}
            {s}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecommendationPanel({ inv, onChanged }: { inv: Investigation; onChanged: () => Promise<unknown> }) {
  const decide = useServerFn(decideInvestigation);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(inv.suggested_message ?? "");
  const evidence = Array.isArray(inv.evidence) ? (inv.evidence as string[]) : [];
  const pending = inv.status === "pending";
  const confidenceLabel = inv.confidence >= 90 ? "High" : inv.confidence >= 75 ? "Medium" : "Low";

  const mutation = useMutation({
    mutationFn: (
      input:
        | { action: "approve"; message: string | null }
        | { action: "edit"; message: string }
        | { action: "dismiss" },
    ) => decide({ data: { ...input, investigationId: inv.id } }),
    onSuccess: async (_r, input) => {
      await onChanged();
      setEditing(false);
      if (input.action === "approve") toast.success("Action approved and logged", { description: "Nothing was sent automatically." });
      if (input.action === "edit") toast.success("Message saved");
      if (input.action === "dismiss") toast("Recommendation dismissed");
    },
    onError: (e) => toast.error(e.message),
  });

  const copy = async () => {
    const text = `${inv.message_subject ? `Subject: ${inv.message_subject}\n\n` : ""}${inv.suggested_message ?? ""}`;
    await navigator.clipboard.writeText(text);
    toast.success("Message copied");
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="relative bg-hero p-5 text-navy-foreground sm:p-6">
        <div className="absolute inset-0 grid-glow opacity-60" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info" className="border-transparent">
              <Sparkles className="size-3" />
              {inv.ai_generated ? "AI recommendation" : "Rule-based recommendation"}
            </Badge>
            <PriorityBadge priority={inv.priority} />
            <DecisionBadge status={inv.status} />
          </div>
          <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-navy-muted uppercase">Detected bottleneck</p>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{inv.bottleneck_label}</h2>
          <p className="mt-3 text-sm leading-relaxed text-navy-foreground/90">“{inv.finding}”</p>
          <div className="mt-5 max-w-sm">
            <div className="mb-1.5 flex justify-between text-xs text-navy-muted">
              <span>Confidence</span>
              <span className="font-semibold text-navy-foreground">
                {confidenceLabel} · {inv.confidence}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-navy-foreground/15">
              <div className="h-full rounded-full bg-primary-gradient" style={{ width: `${inv.confidence}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-5 sm:p-6">
        {!inv.ai_generated && inv.bottleneck_key !== "none" && (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-xs text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            The AI service was unavailable for this run, so this recommendation uses OrderFlow's built-in rules. Re-run
            to try the AI again.
          </p>
        )}

        <div className="rounded-lg border border-primary/20 bg-info-soft p-4">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recommended next action</p>
          <p className="mt-1 text-base font-semibold text-foreground">{inv.recommended_action}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">AI explanation</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{inv.explanation}</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Supporting evidence</h3>
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {evidence.map((e) => (
                <li key={e} className="flex gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {inv.suggested_message && (
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/60 px-4 py-2.5">
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-foreground">Suggested message · draft</p>
                <p className="truncate text-muted-foreground">
                  To: {inv.message_recipient} {inv.message_subject && <>· {inv.message_subject}</>}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={copy}>
                <Copy /> Copy
              </Button>
            </div>
            {editing ? (
              <div className="p-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={9}
                  className="font-sans text-sm"
                  aria-label="Edit suggested message"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setDraft(inv.suggested_message ?? ""); setEditing(false); }}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!draft.trim() || mutation.isPending}
                    onClick={() => mutation.mutate({ action: "edit", message: draft })}
                  >
                    Save message
                  </Button>
                </div>
              </div>
            ) : (
              <p className="p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{inv.suggested_message}</p>
            )}
          </div>
        )}

        {pending && inv.bottleneck_key !== "none" ? (
          <div className="flex flex-col gap-3 border-t pt-5">
            <p className="text-xs text-muted-foreground">
              Owner approval required — nothing is sent, paid, refunded or changed automatically.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "dismiss" })}>
                <ThumbsDown /> Dismiss recommendation
              </Button>
              {inv.suggested_message && !editing && (
                <Button variant="outline" disabled={mutation.isPending} onClick={() => setEditing(true)}>
                  <Pencil /> Edit message
                </Button>
              )}
              <Button
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: "approve", message: editing ? draft : null })}
              >
                {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Approve action
              </Button>
            </div>
          </div>
        ) : inv.status === "approved" ? (
          <p className="flex items-center gap-2 rounded-lg bg-success-soft p-3 text-sm text-success">
            <Check className="size-4" />
            Approved {formatDateTime(inv.decided_at)} and recorded in the activity log. Copy the message to send it
            yourself.
          </p>
        ) : inv.status === "dismissed" ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Dismissed {formatDateTime(inv.decided_at)}. Re-run the investigation for a fresh recommendation.
          </p>
        ) : null}
      </div>
    </section>
  );
}
