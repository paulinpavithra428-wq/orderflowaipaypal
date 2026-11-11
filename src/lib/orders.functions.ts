import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { analyzeOrder } from "@/lib/bottleneck";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  approveLink,
  createPaypalOrder,
  getPaypalAccessToken,
  getPaypalConfig,
  missingPaypalSecrets,
  PaypalError,
  syncPaymentFromPaypal,
} from "@/lib/paypal.server";
import {
  AiUnavailableError,
  fallbackRecommendation,
  generateRecommendation,
} from "@/lib/ai/recommend.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";

export type Order = Tables<"orders">;
export type Investigation = Tables<"investigations">;
export type Activity = Tables<"activity_log">;

/** Order row plus units on hand for its linked product (null when no inventory record exists). */
export type OrderWithStock = Order & { available: number | null };

export type OrderWithLatest = OrderWithStock & {
  latest_investigation_status: string | null;
};

export interface PaymentDetails {
  source: string;
  status: string;
  transactionId: string | null;
  amount: number;
  currency: string;
  payerEmail: string | null;
  createTime: string | null;
  note: string | null;
}

type OrderRowWithProduct = Order & { products: { on_hand: number } | null };

function withStock(row: OrderRowWithProduct): OrderWithStock {
  const { products, ...order } = row;
  return { ...order, available: products ? products.on_hand : null };
}

/** Payment facts come from the stored, server-verified PayPal result — never from the browser. */
function paymentFromOrder(order: Order): PaymentDetails {
  const verified = order.paypal_payment_status.toUpperCase() === "COMPLETED" && Boolean(order.payment_verified_at);
  let note: string | null = null;
  if (order.payment_source !== "demo" && !verified) {
    note = order.paypal_order_id
      ? "This payment has not been verified with PayPal yet."
      : "No PayPal checkout has been created for this order yet.";
  }
  return {
    source: order.payment_source,
    status: order.paypal_payment_status,
    transactionId: order.paypal_transaction_id,
    amount: Number(order.payment_verified_amount ?? order.amount),
    currency: order.currency,
    payerEmail: null,
    createTime: order.payment_verified_at,
    note,
  };
}

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const [ordersRes, invRes] = await Promise.all([
      db.from("orders").select("*, products(on_hand)").order("ordered_at", { ascending: false }),
      db.from("investigations").select("order_id, status, created_at").order("created_at", { ascending: false }),
    ]);
    if (ordersRes.error) {
      console.error("listOrders failed", ordersRes.error);
      throw new Error("Could not load orders.");
    }
    const latest = new Map<string, string>();
    for (const inv of invRes.data ?? []) if (!latest.has(inv.order_id)) latest.set(inv.order_id, inv.status);
    return (ordersRes.data as OrderRowWithProduct[]).map(
      (o): OrderWithLatest => ({ ...withStock(o), latest_investigation_status: latest.get(o.id) ?? null }),
    );
  });

const orderIdSchema = z.object({ orderId: z.string().min(1).max(40) });

export const getOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: row, error } = await db
      .from("orders")
      .select("*, products(on_hand)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) {
      console.error("getOrderDetail failed", error);
      throw new Error("Could not load the order.");
    }
    if (!row) return { order: null, investigations: [] as Investigation[], payment: null };
    const order = withStock(row as OrderRowWithProduct);
    const { data: investigations } = await db
      .from("investigations")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false });
    return { order, investigations: investigations ?? [], payment: paymentFromOrder(order) };
  });

export const runInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: row, error } = await db
      .from("orders")
      .select("*, products(on_hand)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !row) throw new Error("Order not found.");
    const order = withStock(row as OrderRowWithProduct);
    const payment = paymentFromOrder(order);

    // 1. Deterministic checks decide the facts.
    const analysis = analyzeOrder({ ...order, amount: Number(order.amount) });
    const aiOrder = { ...order, amount: Number(order.amount), inventory_on_hand: order.available ?? order.inventory_on_hand };

    // 2. AI explains the verified facts; rule-based text if AI is unavailable.
    let rec;
    let aiGenerated = true;
    let aiError: string | null = null;
    if (analysis.bottleneck === "none") {
      rec = fallbackRecommendation(aiOrder, analysis);
      aiGenerated = false;
    } else {
      try {
        rec = await generateRecommendation(aiOrder, analysis);
      } catch (e) {
        console.error("AI recommendation failed", e);
        aiError = e instanceof AiUnavailableError ? e.message : "The AI service is temporarily unavailable.";
        rec = fallbackRecommendation(aiOrder, analysis);
        aiGenerated = false;
      }
    }

    const { data: inv, error: insertError } = await db
      .from("investigations")
      .insert({
        order_id: order.id,
        merchant_id: context.userId,
        bottleneck_key: analysis.bottleneck,
        bottleneck_label: analysis.bottleneckLabel,
        priority: analysis.priority,
        confidence: analysis.confidence,
        evidence: analysis.evidence,
        evidence_sufficient: analysis.evidenceSufficient,
        root_cause: analysis.rootCause,
        business_impact: analysis.businessImpact,
        finding: rec.finding,
        recommended_action: rec.recommended_action,
        explanation: rec.explanation,
        message_recipient: rec.message_recipient || null,
        message_subject: rec.message_subject || null,
        suggested_message: rec.suggested_message || null,
        payment_source: payment.source,
        ai_generated: aiGenerated,
        status: "pending",
      })
      .select("*")
      .single();
    if (insertError || !inv) {
      console.error("Saving investigation failed", insertError);
      throw new Error("Could not save the investigation.");
    }

    await db.from("activity_log").insert({
      order_id: order.id,
      merchant_id: context.userId,
      investigation_id: inv.id,
      action_type: "investigation_run",
      description: `Investigated ${order.id}: ${analysis.bottleneckLabel} (${analysis.priority} priority).`,
      details: { ai_generated: aiGenerated, payment_source: payment.source },
    });

    return { investigation: inv, aiError };
  });

const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    investigationId: z.string().uuid(),
    message: z.string().max(4000).nullable(),
  }),
  z.object({ action: z.literal("edit"), investigationId: z.string().uuid(), message: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("reject"), investigationId: z.string().uuid(), note: z.string().max(1000).optional() }),
  z.object({ action: z.literal("resolve"), investigationId: z.string().uuid(), note: z.string().max(1000).optional() }),
]);

export const decideInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => decisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: inv, error } = await db
      .from("investigations")
      .select("*")
      .eq("id", data.investigationId)
      .maybeSingle();
    if (error || !inv) throw new Error("Recommendation not found.");
    if (data.action === "resolve") {
      if (inv.status === "resolved" || inv.status === "rejected" || inv.status === "dismissed") {
        throw new Error("This issue is already closed.");
      }
    } else if (inv.status !== "pending") {
      throw new Error("This recommendation has already been decided.");
    }

    const log = (action_type: string, description: string, details: Record<string, unknown>) =>
      db.from("activity_log").insert({
        order_id: inv.order_id,
        merchant_id: context.userId,
        investigation_id: inv.id,
        action_type,
        description,
        details: details as never,
      });

    if (data.action === "edit") {
      const { error: e } = await db
        .from("investigations")
        .update({ suggested_message: data.message })
        .eq("id", inv.id);
      if (e) throw new Error("Could not save the message.");
      await log("message_edited", `Owner edited the suggested message for ${inv.order_id}.`, { message: data.message });
      return { ok: true };
    }

    const now = new Date().toISOString();
    if (data.action === "approve") {
      const message = data.message ?? inv.suggested_message;
      const { error: e } = await db
        .from("investigations")
        .update({ status: "approved", decided_at: now, suggested_message: message })
        .eq("id", inv.id);
      if (e) throw new Error("Could not approve the action.");
      await log("action_approved", `Owner approved: ${inv.recommended_action}`, {
        bottleneck: inv.bottleneck_label,
        recipient: inv.message_recipient,
        subject: inv.message_subject,
        message,
        sent_automatically: false,
      });
      return { ok: true };
    }

    if (data.action === "resolve") {
      const { error: e } = await db
        .from("investigations")
        .update({ status: "resolved", resolved_at: now, decided_at: inv.decided_at ?? now, decision_note: data.note ?? null })
        .eq("id", inv.id);
      if (e) throw new Error("Could not mark the issue resolved.");
      await log("issue_resolved", `Owner marked the ${inv.bottleneck_label.toLowerCase()} issue on ${inv.order_id} as resolved.`, {
        note: data.note ?? null,
        order_status_changed: false,
      });
      return { ok: true };
    }

    const { error: e } = await db
      .from("investigations")
      .update({ status: "rejected", decided_at: now, decision_note: data.note ?? null })
      .eq("id", inv.id);
    if (e) throw new Error("Could not reject the recommendation.");
    await log("recommendation_rejected", `Owner rejected the recommendation for ${inv.order_id} (${inv.bottleneck_label}).`, {
      note: data.note ?? null,
    });
    return { ok: true };
  });

export const listActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("listActivity failed", error);
      throw new Error("Could not load the activity log.");
    }
    return data;
  });

export const getPaypalSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const config = getPaypalConfig();
    return {
      configured: Boolean(config),
      environment: config?.environment ?? "sandbox",
      missingSecrets: missingPaypalSecrets(),
      webhookConfigured: Boolean(process.env["PAYPAL_WEBHOOK_ID"]),
    };
  });

/** Real OAuth client-credentials request. "connected" is only returned when PayPal issues a token. */
export const testPaypalConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const missing = missingPaypalSecrets();
    const config = getPaypalConfig();
    const checkedAt = new Date().toISOString();
    if (!config) {
      return {
        state: "disconnected" as const,
        message: `Missing secret${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} under Project Settings → Secrets with exactly ${missing.length === 1 ? "this name" : "these names"}.`,
        checkedAt,
      };
    }
    try {
      const { appId } = await getPaypalAccessToken(config);
      return {
        state: "connected" as const,
        message: `PayPal ${config.environment === "live" ? "Live" : "Sandbox"} issued an OAuth access token${appId ? ` for app ${appId}` : ""}.`,
        checkedAt,
      };
    } catch (e) {
      return { state: "failed" as const, message: e instanceof Error ? e.message : "Could not reach PayPal.", checkedAt };
    }
  });

async function loadAccessibleOrder(db: SupabaseClient<Database>, orderId: string) {
  const { data, error } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !data) throw new Error("Order not found.");
  return data as Order;
}

/** Merchant-initiated: creates a PayPal Sandbox checkout for an unpaid order. No money moves until the buyer approves. */
export const createPaypalCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const order = await loadAccessibleOrder(context.supabase, data.orderId);
    if (order.payment_source === "demo") throw new Error("Demo orders use simulated payments and cannot be sent to PayPal.");
    if (order.payment_verified_at) throw new Error("This order's payment is already verified.");
    const config = getPaypalConfig();
    if (!config) throw new Error(`PayPal is not connected. Missing: ${missingPaypalSecrets().join(", ")}.`);
    const origin = new URL(getRequest().url).origin;
    try {
      const pp = await createPaypalOrder(config, {
        orderId: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        description: `${order.quantity} × ${order.product}`,
        returnUrl: `${origin}/paypal/return`,
        cancelUrl: `${origin}/paypal/return?cancelled=1`,
      });
      const link = approveLink(pp);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ paypal_order_id: pp.id, paypal_payment_status: pp.status, payment_verified_at: null, payment_verified_amount: null })
        .eq("id", order.id);
      if (error) throw new Error("Could not save the PayPal order.");
      await context.supabase.from("activity_log").insert({
        order_id: order.id,
        merchant_id: context.userId,
        action_type: "paypal_checkout_created",
        description: `Owner created a PayPal Sandbox checkout for ${order.id} (PayPal order ${pp.id}).`,
        details: { paypal_order_id: pp.id, amount: Number(order.amount) },
      });
      return { approveUrl: link, paypalOrderId: pp.id };
    } catch (e) {
      if (e instanceof PaypalError) throw new Error(`PayPal: ${e.message}`);
      throw e;
    }
  });

/** Re-reads the PayPal order server-side, captures it if the buyer approved, and stores the verified result. */
export const refreshPaypalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const order = await loadAccessibleOrder(context.supabase, data.orderId);
    if (!order.paypal_order_id) throw new Error("No PayPal checkout exists for this order yet.");
    const config = getPaypalConfig();
    if (!config) throw new Error(`PayPal is not connected. Missing: ${missingPaypalSecrets().join(", ")}.`);
    try {
      const result = await syncPaymentFromPaypal(
        config,
        { ...order, paypal_order_id: order.paypal_order_id },
        { capture: true },
      );
      await context.supabase.from("activity_log").insert({
        order_id: order.id,
        merchant_id: context.userId,
        action_type: result.verified ? "payment_verified" : "payment_check",
        description: result.verified
          ? `PayPal Sandbox payment verified for ${order.id} (capture ${result.captureId}).`
          : `PayPal check for ${order.id}: ${result.reason}`,
        details: { status: result.status, capture_id: result.captureId },
      });
      return result;
    } catch (e) {
      if (e instanceof PaypalError) throw new Error(`PayPal: ${e.message}`);
      throw e;
    }
  });
