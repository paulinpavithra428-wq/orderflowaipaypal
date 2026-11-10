import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { analyzeOrder } from "@/lib/bottleneck";
import { getDb } from "@/lib/db.server";
import { getPaymentDetails, getPaypalAccessToken, getPaypalConfig } from "@/lib/paypal.server";
import {
  AiUnavailableError,
  fallbackRecommendation,
  generateRecommendation,
} from "@/lib/ai/recommend.server";
import type { Tables } from "@/integrations/supabase/types";

export type Order = Tables<"orders">;
export type Investigation = Tables<"investigations">;
export type Activity = Tables<"activity_log">;

export type OrderWithLatest = Order & {
  latest_investigation_status: string | null;
};

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const [ordersRes, invRes] = await Promise.all([
    db.from("orders").select("*").order("ordered_at", { ascending: false }),
    db.from("investigations").select("order_id, status, created_at").order("created_at", { ascending: false }),
  ]);
  if (ordersRes.error) throw new Error("Could not load orders.");
  const latest = new Map<string, string>();
  for (const inv of invRes.data ?? []) if (!latest.has(inv.order_id)) latest.set(inv.order_id, inv.status);
  return ordersRes.data.map(
    (o): OrderWithLatest => ({ ...o, latest_investigation_status: latest.get(o.id) ?? null }),
  );
});

const orderIdSchema = z.object({ orderId: z.string().min(1).max(40) });

export const getOrderDetail = createServerFn({ method: "GET" })
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data }) => {
    const db = getDb();
    const { data: order, error } = await db.from("orders").select("*").eq("id", data.orderId).maybeSingle();
    if (error) throw new Error("Could not load the order.");
    if (!order) return { order: null, investigations: [], payment: null };
    const [{ data: investigations }, payment] = await Promise.all([
      db.from("investigations").select("*").eq("order_id", order.id).order("created_at", { ascending: false }),
      getPaymentDetails(order),
    ]);
    return { order, investigations: investigations ?? [], payment };
  });

export const runInvestigation = createServerFn({ method: "POST" })
  .inputValidator((input) => orderIdSchema.parse(input))
  .handler(async ({ data }) => {
    const db = getDb();
    const { data: order, error } = await db.from("orders").select("*").eq("id", data.orderId).maybeSingle();
    if (error || !order) throw new Error("Order not found.");

    // 1. Deterministic checks — the PayPal status comes from the API when connected.
    const payment = await getPaymentDetails(order);
    const analysis = analyzeOrder({ ...order, amount: Number(order.amount), paypal_payment_status: payment.status });

    // 2. AI explains the verified facts; rule-based text if AI is unavailable.
    let rec;
    let aiGenerated = true;
    let aiError: string | null = null;
    if (analysis.bottleneck === "none") {
      rec = fallbackRecommendation(order, analysis);
      aiGenerated = false;
    } else {
      try {
        rec = await generateRecommendation(order, analysis);
      } catch (e) {
        aiError = e instanceof AiUnavailableError ? e.message : "The AI service is temporarily unavailable.";
        rec = fallbackRecommendation(order, analysis);
        aiGenerated = false;
      }
    }

    const { data: inv, error: insertError } = await db
      .from("investigations")
      .insert({
        order_id: order.id,
        bottleneck_key: analysis.bottleneck,
        bottleneck_label: analysis.bottleneckLabel,
        priority: analysis.priority,
        confidence: analysis.confidence,
        evidence: analysis.evidence,
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
    if (insertError || !inv) throw new Error("Could not save the investigation.");

    await db.from("activity_log").insert({
      order_id: order.id,
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
  z.object({ action: z.literal("dismiss"), investigationId: z.string().uuid() }),
]);

export const decideInvestigation = createServerFn({ method: "POST" })
  .inputValidator((input) => decisionSchema.parse(input))
  .handler(async ({ data }) => {
    const db = getDb();
    const { data: inv, error } = await db
      .from("investigations")
      .select("*")
      .eq("id", data.investigationId)
      .maybeSingle();
    if (error || !inv) throw new Error("Recommendation not found.");
    if (inv.status !== "pending") throw new Error("This recommendation has already been decided.");

    if (data.action === "edit") {
      const { error: e } = await db
        .from("investigations")
        .update({ suggested_message: data.message })
        .eq("id", inv.id);
      if (e) throw new Error("Could not save the message.");
      await db.from("activity_log").insert({
        order_id: inv.order_id,
        investigation_id: inv.id,
        action_type: "message_edited",
        description: `Owner edited the suggested message for ${inv.order_id}.`,
        details: { message: data.message },
      });
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
      await db.from("activity_log").insert({
        order_id: inv.order_id,
        investigation_id: inv.id,
        action_type: "action_approved",
        description: `Owner approved: ${inv.recommended_action}`,
        details: {
          bottleneck: inv.bottleneck_label,
          recipient: inv.message_recipient,
          subject: inv.message_subject,
          message,
          sent_automatically: false,
        },
      });
      return { ok: true };
    }

    const { error: e } = await db
      .from("investigations")
      .update({ status: "dismissed", decided_at: now })
      .eq("id", inv.id);
    if (e) throw new Error("Could not dismiss the recommendation.");
    await db.from("activity_log").insert({
      order_id: inv.order_id,
      investigation_id: inv.id,
      action_type: "recommendation_dismissed",
      description: `Owner dismissed the recommendation for ${inv.order_id} (${inv.bottleneck_label}).`,
      details: {},
    });
    return { ok: true };
  });

export const listActivity = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const { data, error } = await db
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not load the activity log.");
  return data;
});

export const getPaypalSettings = createServerFn({ method: "GET" }).handler(async () => {
  const config = getPaypalConfig();
  return {
    configured: Boolean(config),
    environment: config?.environment ?? "sandbox",
    clientIdHint: config ? `••••${config.clientId.slice(-4)}` : null,
  };
});

export const testPaypalConnection = createServerFn({ method: "POST" }).handler(async () => {
  const config = getPaypalConfig();
  if (!config) return { ok: false, message: "No PayPal credentials are saved yet. The app is using demo transactions." };
  try {
    await getPaypalAccessToken(config);
    return { ok: true, message: `Connected to PayPal ${config.environment === "live" ? "Live" : "Sandbox"}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not reach PayPal." };
  }
});
