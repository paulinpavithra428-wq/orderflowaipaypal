import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Pencil, Sparkles, XCircle } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { PageError, PagePending } from "@/components/page-states";
import { formatDateTime } from "@/lib/format";
import { activityQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity log — OrderFlow AI" },
      { name: "description", content: "Every investigation, approval, edit and dismissal recorded in one place." },
      { property: "og:title", content: "Activity log — OrderFlow AI" },
      { property: "og:description", content: "Every investigation, approval, edit and dismissal recorded in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(activityQuery),
  pendingComponent: PagePending,
  errorComponent: PageError,
  component: ActivityPage,
});

type ActivityType = { label: string; icon: typeof Sparkles; tone: string };
const INVESTIGATION: ActivityType = { label: "Investigation", icon: Sparkles, tone: "bg-info-soft text-info" };
const TYPES: Record<string, ActivityType> = {
  investigation_run: { label: "Investigation", icon: Sparkles, tone: "bg-info-soft text-info" },
  action_approved: { label: "Approved", icon: CheckCircle2, tone: "bg-success-soft text-success" },
  message_edited: { label: "Message edited", icon: Pencil, tone: "bg-warning-soft text-warning-foreground" },
  recommendation_dismissed: { label: "Dismissed", icon: XCircle, tone: "bg-muted text-muted-foreground" },
};

function ActivityPage() {
  const { data: items } = useSuspenseQuery(activityQuery);
  return (
    <>
      <PageHeader
        eyebrow="Audit trail"
        title="Activity log"
        description="A record of every investigation and every decision you made. Approved actions are never sent automatically."
      />
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          No activity yet. Investigate an order to get started.
        </div>
      ) : (
        <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[19px] before:w-px before:bg-border">
          {items.map((item) => {
            const t = TYPES[item.action_type] ?? INVESTIGATION;
            const Icon = t.icon;
            const details = (item.details ?? {}) as { message?: string; recipient?: string };
            return (
              <li key={item.id} className="relative flex gap-4">
                <span className={cn("relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-4 border-background", t.tone)}>
                  <Icon className="size-4" />
                </span>
                <div className="flex-1 rounded-xl border bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground">{t.label}</span>
                      {item.order_id && (
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: item.order_id }}
                          className="font-mono font-semibold text-primary hover:underline"
                        >
                          {item.order_id}
                        </Link>
                      )}
                    </div>
                    <time className="text-xs text-muted-foreground">{formatDateTime(item.created_at)}</time>
                  </div>
                  <p className="mt-1.5 text-sm text-foreground">{item.description}</p>
                  {item.action_type === "action_approved" && details.message && (
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-medium text-primary">
                        Approved message{details.recipient ? ` to ${details.recipient}` : ""}
                      </summary>
                      <p className="mt-2 rounded-md bg-muted p-3 whitespace-pre-wrap">{details.message}</p>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
