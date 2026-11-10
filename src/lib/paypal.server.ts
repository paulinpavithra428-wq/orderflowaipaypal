// PayPal REST API integration (server-only). Credentials come from server secrets:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, optional PAYPAL_ENVIRONMENT = "sandbox" | "live".
// Without credentials every lookup returns a clearly labelled demo transaction.

export type PaymentSource = "paypal_sandbox" | "paypal_live" | "demo";

export interface PaymentDetails {
  source: PaymentSource;
  transactionId: string | null;
  status: string;
  amount: string;
  currency: string;
  payerEmail: string | null;
  createTime: string | null;
  updateTime: string | null;
  note: string | null;
}

interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  baseUrl: string;
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

export async function getPaypalAccessToken(config: PaypalConfig): Promise<string> {
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const res = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.error("PayPal token request failed", res.status, await res.text().catch(() => ""));
    throw new Error(res.status === 401 ? "PayPal rejected the credentials." : `PayPal returned ${res.status}.`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

interface DemoOrder {
  paypal_transaction_id: string | null;
  paypal_payment_status: string;
  amount: number;
  currency: string;
  customer_email: string;
  ordered_at: string;
}

function demoDetails(order: DemoOrder, note: string | null = null): PaymentDetails {
  return {
    source: "demo",
    transactionId: order.paypal_transaction_id,
    status: order.paypal_payment_status.toUpperCase(),
    amount: Number(order.amount).toFixed(2),
    currency: order.currency,
    payerEmail: order.customer_email,
    createTime: order.ordered_at,
    updateTime: order.ordered_at,
    note,
  };
}

/** Look up the PayPal capture linked to an order; falls back to the stored demo record. */
export async function getPaymentDetails(order: DemoOrder): Promise<PaymentDetails> {
  const config = getPaypalConfig();
  if (!config || !order.paypal_transaction_id) return demoDetails(order);

  try {
    const token = await getPaypalAccessToken(config);
    const res = await fetch(
      `${config.baseUrl}/v2/payments/captures/${encodeURIComponent(order.paypal_transaction_id)}`,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
    );
    if (res.status === 404) {
      return demoDetails(order, `Transaction not found in PayPal ${config.environment}; showing the demo record.`);
    }
    if (!res.ok) {
      console.error("PayPal capture lookup failed", res.status);
      return demoDetails(order, `PayPal lookup failed (${res.status}); showing the demo record.`);
    }
    const c = (await res.json()) as {
      id: string;
      status: string;
      amount?: { value: string; currency_code: string };
      payee?: { email_address?: string };
      create_time?: string;
      update_time?: string;
    };
    return {
      source: config.environment === "live" ? "paypal_live" : "paypal_sandbox",
      transactionId: c.id,
      status: c.status,
      amount: c.amount?.value ?? Number(order.amount).toFixed(2),
      currency: c.amount?.currency_code ?? order.currency,
      payerEmail: c.payee?.email_address ?? null,
      createTime: c.create_time ?? null,
      updateTime: c.update_time ?? null,
      note: null,
    };
  } catch (error) {
    console.error("PayPal lookup error", error);
    return demoDetails(order, "PayPal could not be reached; showing the demo record.");
  }
}
