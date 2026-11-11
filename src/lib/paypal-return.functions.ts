import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getPaypalConfig, syncPaymentFromPaypal } from "@/lib/paypal.server";

/**
 * Called by the public /paypal/return page after the buyer approves on PayPal.
 * The redirect itself proves nothing: the server looks the PayPal order up, captures it only if
 * PayPal reports it APPROVED, and stores the result only if amount, currency and order reference match.
 * Returns no customer data.
 */
export const confirmPaypalReturn = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().regex(/^[A-Z0-9]{8,40}$/) }).parse(input))
  .handler(async ({ data }) => {
    const config = getPaypalConfig();
    if (!config) return { found: false, verified: false, orderId: null, status: "NOT_CONFIGURED", reason: "PayPal is not connected." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, amount, currency, paypal_order_id, merchant_id")
      .eq("paypal_order_id", data.token)
      .maybeSingle();
    if (!order?.paypal_order_id) {
      return { found: false, verified: false, orderId: null, status: "UNKNOWN", reason: "No OrderFlow order matches this PayPal checkout." };
    }
    try {
      const result = await syncPaymentFromPaypal(config, { ...order, paypal_order_id: order.paypal_order_id }, { capture: true });
      await supabaseAdmin.from("activity_log").insert({
        order_id: order.id,
        merchant_id: order.merchant_id,
        action_type: result.verified ? "payment_verified" : "payment_check",
        description: result.verified
          ? `Buyer completed PayPal Sandbox checkout; server captured and verified payment for ${order.id}.`
          : `Buyer returned from PayPal for ${order.id}, but payment is not verified: ${result.reason}`,
        details: { status: result.status, capture_id: result.captureId, source: "return_page" },
      });
      return { found: true, verified: result.verified, orderId: order.id, status: result.status, reason: result.reason };
    } catch (e) {
      console.error("PayPal return confirmation failed", e);
      return { found: true, verified: false, orderId: order.id, status: "ERROR", reason: "PayPal could not be reached to verify this payment." };
    }
  });
