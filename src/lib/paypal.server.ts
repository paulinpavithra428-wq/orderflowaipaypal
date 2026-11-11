// PayPal REST API (server-only). Credentials come from project secrets:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET  (required)
//   PAYPAL_WEBHOOK_ID                        (required for webhook signature verification)
// Sandbox is the default; set PAYPAL_ENVIRONMENT=live only for production credentials.

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  baseUrl: string;
}

export const REQUIRED_PAYPAL_SECRETS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const;

export function missingPaypalSecrets(): string[] {
  return REQUIRED_PAYPAL_SECRETS.filter((name) => !process.env[name]);
}

export function getPaypalConfig(): PaypalConfig | null {
  const clientId = process.env["PAYPAL_CLIENT_ID"];
  const clientSecret = process.env["PAYPAL_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  const environment = process.env["PAYPAL_ENVIRONMENT"] === "live" ? "live" : "sandbox";
  return {
    clientId,
    clientSecret,
    environment,
    baseUrl: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

export class PaypalError extends Error {
  constructor(
    message: string,
    public status: number,
    public issue?: string,
  ) {
    super(message);
  }
}

export async function getPaypalAccessToken(config: PaypalConfig): Promise<{ token: string; appId: string | null }> {
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
  } catch (e) {
    console.error("PayPal token network error", e);
    throw new PaypalError("Could not reach PayPal.", 0);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("PayPal token request failed", res.status, body);
    throw new PaypalError(
      res.status === 401 ? "PayPal rejected the Client ID / Secret (invalid_client)." : `PayPal returned HTTP ${res.status}.`,
      res.status,
    );
  }
  const json = (await res.json()) as { access_token: string; app_id?: string };
  return { token: json.access_token, appId: json.app_id ?? null };
}

async function paypalRequest<T>(config: PaypalConfig, path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await getPaypalAccessToken(config);
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PayPal ${init.method ?? "GET"} ${path} failed`, res.status, text);
    let issue: string | undefined;
    let message = `PayPal returned HTTP ${res.status}.`;
    try {
      const j = JSON.parse(text) as { message?: string; details?: { issue?: string; description?: string }[] };
      issue = j.details?.[0]?.issue;
      message = j.details?.[0]?.description ?? j.message ?? message;
    } catch {
      /* keep defaults */
    }
    throw new PaypalError(message, res.status, issue);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface PaypalCapture {
  id: string;
  status: string;
  amount?: { value: string; currency_code: string };
  custom_id?: string;
  create_time?: string;
  update_time?: string;
}

export interface PaypalOrder {
  id: string;
  status: string;
  links?: { href: string; rel: string }[];
  payer?: { email_address?: string };
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount?: { value: string; currency_code: string };
    payments?: { captures?: PaypalCapture[] };
  }[];
}

export function createPaypalOrder(
  config: PaypalConfig,
  input: { orderId: string; amount: number; currency: string; description: string; returnUrl: string; cancelUrl: string },
) {
  return paypalRequest<PaypalOrder>(config, "/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": `create-${input.orderId}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          invoice_id: `${input.orderId}-${Date.now()}`,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "OrderFlow AI Sandbox",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    }),
  });
}

export function getPaypalOrder(config: PaypalConfig, paypalOrderId: string) {
  return paypalRequest<PaypalOrder>(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export function capturePaypalOrder(config: PaypalConfig, paypalOrderId: string, appOrderId: string) {
  return paypalRequest<PaypalOrder>(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    // Stable per order so a retried capture is de-duplicated by PayPal.
    headers: { "PayPal-Request-Id": `capture-${appOrderId}-${paypalOrderId}` },
  });
}

export function approveLink(order: PaypalOrder): string | null {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}

export interface VerificationResult {
  verified: boolean;
  status: string;
  captureId: string | null;
  amount: number | null;
  reason: string | null;
}

/** Checks a PayPal order really pays for this app order: matching reference, amount, currency and a COMPLETED capture. */
export function verifyPaypalOrder(
  paypalOrder: PaypalOrder,
  expected: { orderId: string; amount: number; currency: string },
): VerificationResult {
  const unit = paypalOrder.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0] ?? null;
  const status = capture?.status ?? paypalOrder.status;
  const base = { status, captureId: capture?.id ?? null, amount: capture?.amount ? Number(capture.amount.value) : null };
  const ref = unit?.custom_id ?? unit?.reference_id ?? capture?.custom_id;
  if (ref !== expected.orderId) return { ...base, verified: false, reason: "PayPal order does not reference this order." };
  if (!capture) return { ...base, verified: false, reason: `No capture yet (PayPal order is ${paypalOrder.status}).` };
  if (capture.status !== "COMPLETED") return { ...base, verified: false, reason: `Capture status is ${capture.status}.` };
  const amt = capture.amount;
  if (!amt || amt.currency_code !== expected.currency || Math.abs(Number(amt.value) - expected.amount) > 0.001) {
    return { ...base, verified: false, reason: "Captured amount or currency does not match the order total." };
  }
  return { ...base, verified: true, reason: null };
}

export async function verifyWebhookSignature(
  config: PaypalConfig,
  webhookId: string,
  headers: Headers,
  event: unknown,
): Promise<boolean> {
  const get = (n: string) => headers.get(n);
  const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (required.some((h) => !get(h))) return false;
  try {
    const res = await paypalRequest<{ verification_status: string }>(config, "/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({
        auth_algo: get("paypal-auth-algo"),
        cert_url: get("paypal-cert-url"),
        transmission_id: get("paypal-transmission-id"),
        transmission_sig: get("paypal-transmission-sig"),
        transmission_time: get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    return res.verification_status === "SUCCESS";
  } catch (e) {
    console.error("Webhook verification call failed", e);
    return false;
  }
}

/** Fetch the PayPal order for an app order, verify it and persist the result with the service role. */
export async function syncPaymentFromPaypal(
  config: PaypalConfig,
  order: { id: string; amount: number | string; currency: string; paypal_order_id: string; merchant_id: string | null },
  opts: { capture: boolean },
): Promise<VerificationResult> {
  let ppOrder = await getPaypalOrder(config, order.paypal_order_id);
  if (opts.capture && ppOrder.status === "APPROVED") {
    ppOrder = await capturePaypalOrder(config, order.paypal_order_id, order.id);
  }
  const result = verifyPaypalOrder(ppOrder, { orderId: order.id, amount: Number(order.amount), currency: order.currency });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const update = result.verified
    ? {
        paypal_payment_status: "COMPLETED",
        paypal_transaction_id: result.captureId,
        payment_verified_at: new Date().toISOString(),
        payment_verified_amount: result.amount,
      }
    : {
        paypal_payment_status: result.status,
        paypal_transaction_id: result.captureId,
        payment_verified_at: null,
        payment_verified_amount: null,
      };
  const { error } = await supabaseAdmin.from("orders").update(update).eq("id", order.id);
  if (error) {
    console.error("Failed to store payment verification", error);
    throw new Error("Could not save the payment result.");
  }
  return result;
}
