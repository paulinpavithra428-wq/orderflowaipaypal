import { createFileRoute } from "@tanstack/react-router";

import { getPaypalConfig, syncPaymentFromPaypal, verifyWebhookSignature } from "@/lib/paypal.server";

interface PaypalEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

const HANDLED = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.ORDER.COMPLETED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
]);

export const Route = createFileRoute("/api/public/paypal/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getPaypalConfig();
        const webhookId = process.env["PAYPAL_WEBHOOK_ID"];
        if (!config || !webhookId) return new Response("PayPal webhook not configured", { status: 503 });

        const raw = await request.text();
        if (raw.length > 200_000) return new Response("Payload too large", { status: 413 });
        let event: PaypalEvent;
        try {
          event = JSON.parse(raw) as PaypalEvent;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!event.id || !event.event_type) return new Response("Invalid event", { status: 400 });

        // 1. Signature first — nothing is stored or acted on before PayPal confirms the event.
        const valid = await verifyWebhookSignature(config, webhookId, request.headers, event);
        if (!valid) return new Response("Invalid signature", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 2. Idempotency: the event id is the primary key, so a redelivery cannot be processed twice.
        const { error: insertError } = await supabaseAdmin.from("paypal_webhook_events").insert({
          id: event.id,
          event_type: event.event_type,
          resource_id: event.resource?.id ?? null,
          status: "received",
        });
        if (insertError) {
          if (insertError.code === "23505") return Response.json({ ok: true, duplicate: true });
          console.error("Storing webhook event failed", insertError);
          return new Response("Storage error", { status: 500 });
        }

        if (!HANDLED.has(event.event_type)) {
          await supabaseAdmin.from("paypal_webhook_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", event.id);
          return Response.json({ ok: true, ignored: true });
        }

        const paypalOrderId = event.event_type.startsWith("CHECKOUT.ORDER")
          ? event.resource?.id
          : event.resource?.supplementary_data?.related_ids?.order_id;
        const { data: order } = paypalOrderId
          ? await supabaseAdmin
              .from("orders")
              .select("id, amount, currency, paypal_order_id, merchant_id")
              .eq("paypal_order_id", paypalOrderId)
              .maybeSingle()
          : { data: null };

        if (!order?.paypal_order_id) {
          await supabaseAdmin
            .from("paypal_webhook_events")
            .update({ status: "unmatched", detail: "No order references this PayPal order.", processed_at: new Date().toISOString() })
            .eq("id", event.id);
          return Response.json({ ok: true, matched: false });
        }

        try {
          // 3. Re-read the order from PayPal; only a matching COMPLETED capture marks it paid.
          const result = await syncPaymentFromPaypal(
            config,
            { ...order, paypal_order_id: order.paypal_order_id },
            { capture: event.event_type === "CHECKOUT.ORDER.APPROVED" },
          );
          await supabaseAdmin
            .from("paypal_webhook_events")
            .update({
              order_id: order.id,
              status: result.verified ? "verified" : "not_verified",
              detail: result.reason,
              processed_at: new Date().toISOString(),
            })
            .eq("id", event.id);
          await supabaseAdmin.from("activity_log").insert({
            order_id: order.id,
            merchant_id: order.merchant_id,
            action_type: result.verified ? "payment_verified" : "payment_check",
            description: `PayPal webhook ${event.event_type} for ${order.id}: ${result.verified ? "payment verified" : result.reason}`,
            details: { event_id: event.id, status: result.status, capture_id: result.captureId, source: "webhook" },
          });
          return Response.json({ ok: true, verified: result.verified });
        } catch (e) {
          console.error("Webhook processing failed", e);
          // Allow PayPal to retry: remove the ledger row so the redelivery is processed.
          await supabaseAdmin.from("paypal_webhook_events").delete().eq("id", event.id);
          return new Response("Processing failed", { status: 500 });
        }
      },
    },
  },
});
