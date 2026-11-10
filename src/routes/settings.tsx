import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Lock, PlugZap, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { PageError, PagePending } from "@/components/page-states";
import { PaymentBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { testPaypalConnection } from "@/lib/orders.functions";
import { ordersQuery, paypalSettingsQuery } from "@/lib/queries";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "PayPal settings — OrderFlow AI" },
      { name: "description", content: "Connect PayPal Sandbox so OrderFlow AI can read real payment details." },
      { property: "og:title", content: "PayPal settings — OrderFlow AI" },
      { property: "og:description", content: "Connect PayPal Sandbox so OrderFlow AI can read real payment details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(paypalSettingsQuery),
      context.queryClient.ensureQueryData(ordersQuery),
    ]),
  pendingComponent: PagePending,
  errorComponent: PageError,
  component: SettingsPage,
});

function SettingsPage() {
  const { data: settings } = useSuspenseQuery(paypalSettingsQuery);
  const { data: orders } = useSuspenseQuery(ordersQuery);
  const test = useServerFn(testPaypalConnection);
  const mutation = useMutation({
    mutationFn: () => test(),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.warning(r.message)),
    onError: () => toast.error("Could not test the connection."),
  });

  return (
    <>
      <PageHeader
        eyebrow="Integrations"
        title="PayPal settings"
        description="OrderFlow AI reads payment status and transaction IDs from the PayPal REST API. It never moves money."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-6 shadow-card lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-navy text-navy-foreground">
                <PlugZap className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold">PayPal REST API</h2>
                <p className="text-xs text-muted-foreground">
                  Environment: {settings.environment === "live" ? "Live" : "Sandbox"}
                </p>
              </div>
            </div>
            {settings.configured ? (
              <Badge variant="success">Credentials saved {settings.clientIdHint}</Badge>
            ) : (
              <Badge variant="warning">Demo mode</Badge>
            )}
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            {settings.configured
              ? "Your PayPal credentials are stored securely on the server. Investigations look up each order's capture by its transaction ID; if a transaction isn't found, the demo record is shown and clearly labelled."
              : "No PayPal credentials are connected, so the app uses clearly labelled demo transactions. Everything else — checks, AI recommendations and approvals — works the same."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Test connection
            </Button>
          </div>

          <div className="mt-8 border-t pt-6">
            <h3 className="mb-3 text-sm font-semibold">Connect PayPal Sandbox</h3>
            <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <Step n={1} />
                Create a REST app at developer.paypal.com → Apps &amp; Credentials (Sandbox).
              </li>
              <li className="flex gap-3">
                <Step n={2} />
                Copy the Client ID and Secret, then ask in the chat to add them as
                <code className="rounded bg-muted px-1 font-mono text-xs">PAYPAL_CLIENT_ID</code>and
                <code className="rounded bg-muted px-1 font-mono text-xs">PAYPAL_CLIENT_SECRET</code>.
              </li>
              <li className="flex gap-3">
                <Step n={3} />
                Click “Test connection”. Payment lookups switch from demo data to PayPal Sandbox automatically.
              </li>
            </ol>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          {[
            { icon: Lock, title: "Secrets stay on the server", body: "Credentials are never sent to the browser or stored in code." },
            { icon: ShieldCheck, title: "Read-only by design", body: "No payments, refunds or captures are ever created." },
            { icon: Server, title: "Sandbox first", body: "Defaults to PayPal Sandbox; live mode is opt-in." },
            { icon: KeyRound, title: "OAuth 2.0", body: "Uses client-credentials tokens requested per lookup." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3 rounded-xl border bg-card p-4 shadow-card">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </aside>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Demo transactions</h2>
          <Badge variant="warning">Demo data</Badge>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/60 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-3">Transaction ID</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Payer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{o.paypal_transaction_id}</td>
                    <td className="px-4 py-3">
                      <Link to="/orders/$orderId" params={{ orderId: o.id }} className="font-mono text-xs font-semibold text-primary hover:underline">
                        {o.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{o.customer_email}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(o.amount, o.currency)}</td>
                    <td className="px-4 py-3">
                      <PaymentBadge value={o.paypal_payment_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-info-soft text-xs font-bold text-primary">
      {n}
    </span>
  );
}
