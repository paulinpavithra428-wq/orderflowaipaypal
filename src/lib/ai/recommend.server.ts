import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, NoObjectGeneratedError, Output, jsonSchema, streamText } from "ai";

import type { BottleneckAnalysis } from "@/lib/bottleneck";
import { createLovableAiGatewayRunIdFetch } from "./run-id.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

export interface Recommendation {
  finding: string;
  recommended_action: string;
  explanation: string;
  message_recipient: string;
  message_subject: string;
  suggested_message: string;
}

export interface OrderContext {
  id: string;
  customer_name: string;
  customer_email: string;
  product: string;
  quantity: number;
  amount: number;
  currency: string;
  supplier_name: string;
  supplier_email: string;
  carrier: string | null;
  inventory_on_hand: number;
}

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public status: number | undefined,
  ) {
    super(message);
  }
}

const schema = jsonSchema<Recommendation>({
  type: "object",
  additionalProperties: false,
  required: [
    "finding",
    "recommended_action",
    "explanation",
    "message_recipient",
    "message_subject",
    "suggested_message",
  ],
  properties: {
    finding: { type: "string" },
    recommended_action: { type: "string" },
    explanation: { type: "string" },
    message_recipient: { type: "string" },
    message_subject: { type: "string" },
    suggested_message: { type: "string" },
  },
});

const INSTRUCTIONS = `You are OrderFlow AI, an operations assistant for a small online business that takes payments through PayPal.
You receive the verified facts for one order plus the bottleneck that deterministic checks already identified.
Rules:
- Use ONLY the facts provided. Never invent dates, tracking numbers, stock counts, prices, names or promises.
- Do not change the detected bottleneck, priority or confidence; explain them.
- Write for a non-technical business owner: plain, calm, specific.
- "finding": 1-2 sentences stating what is fine and what exactly blocks fulfilment (like: "The customer has successfully paid, and the product is available. However, the supplier has not confirmed the order. This is the main bottleneck preventing fulfilment.").
- "recommended_action": one concrete next step with a timeframe (e.g. "Contact the supplier and request confirmation within the next 24 hours.").
- "explanation": 2-4 sentences on why this is the bottleneck and the risk of waiting, referencing the evidence.
- "message_recipient": who the draft is for, as "Name <email>" when an email is provided (supplier for supplier/inventory issues, the carrier or warehouse team for delivery, the customer for payment issues).
- "message_subject": short email subject including the order ID.
- "suggested_message": a short, polite, editable email draft (under 140 words) signed "[Your name]". It will be reviewed by the owner and never sent automatically. Do not offer refunds, discounts or payments.`;

export async function generateRecommendation(
  order: OrderContext,
  analysis: BottleneckAnalysis,
): Promise<Recommendation> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new AiUnavailableError("AI is not configured for this app.", 401);

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const facts = {
    order: {
      id: order.id,
      customer: `${order.customer_name} <${order.customer_email}>`,
      product: order.product,
      quantity: order.quantity,
      amount: `${Number(order.amount).toFixed(2)} ${order.currency}`,
      supplier: `${order.supplier_name} <${order.supplier_email}>`,
      carrier: order.carrier ?? "none booked",
      units_on_hand: order.inventory_on_hand,
      days_since_order: analysis.daysWaiting,
    },
    checks: analysis.checks.map((c) => ({ stage: c.label, result: c.state, value: c.value, detail: c.detail })),
    detected_bottleneck: analysis.bottleneckLabel,
    secondary_issues: analysis.secondaryIssues,
    priority: analysis.priority,
    confidence_percent: analysis.confidence,
  };

  const result = streamText({
    model: provider.responses(MODEL),
    instructions: INSTRUCTIONS,
    messages: [{ role: "user", content: `Order facts:\n${JSON.stringify(facts, null, 2)}` }],
    output: Output.object({ schema }),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  try {
    const output = await result.output;
    return output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new AiUnavailableError("The AI response could not be read.", undefined);
    }
    if (APICallError.isInstance(error)) {
      const status = error.statusCode;
      let message = "The AI service is temporarily unavailable.";
      try {
        const body = JSON.parse(error.responseBody ?? "{}") as { message?: string; error?: { message?: string } };
        message = body.message ?? body.error?.message ?? message;
      } catch {
        /* keep default */
      }
      if (status === 429) message = "AI rate limit reached. Please try again in a minute.";
      if (status === 402) message = message || "AI credits are exhausted.";
      console.error("AI gateway error", status, error.responseBody);
      throw new AiUnavailableError(message, status);
    }
    console.error("AI error", error);
    throw new AiUnavailableError("The AI service is temporarily unavailable.", undefined);
  }
}

/** Rule-based text used when the AI is unavailable — clearly labelled as such in the UI. */
export function fallbackRecommendation(order: OrderContext, analysis: BottleneckAnalysis): Recommendation {
  const supplier = `${order.supplier_name} <${order.supplier_email}>`;
  const sign = "\n\nThank you,\n[Your name]";
  switch (analysis.bottleneck) {
    case "payment":
      return {
        finding: `PayPal has not completed the payment for order ${order.id}, so fulfilment should not start yet.`,
        recommended_action: "Check the payment in PayPal and contact the customer if it is still pending after 24 hours.",
        explanation: "Shipping before the payment completes risks losing the goods if the payment fails.",
        message_recipient: `${order.customer_name} <${order.customer_email}>`,
        message_subject: `Your order ${order.id} — payment pending`,
        suggested_message: `Hi ${order.customer_name},\n\nThank you for your order of ${order.product}. PayPal is still showing your payment as pending. Could you check your PayPal account to make sure it has gone through? We will prepare your order as soon as it is confirmed.${sign}`,
      };
    case "inventory":
      return {
        finding: `The customer has paid for order ${order.id}, but there is not enough ${order.product} in stock to fulfil it.`,
        recommended_action: "Ask the supplier for a restock date today and update the customer once you have it.",
        explanation: `Only ${order.inventory_on_hand} unit(s) are on hand for an order of ${order.quantity}. Delivery cannot be arranged until stock arrives.`,
        message_recipient: supplier,
        message_subject: `Restock request for ${order.product} — order ${order.id}`,
        suggested_message: `Hello ${order.supplier_name} team,\n\nWe have a paid customer order (${order.id}) for ${order.quantity} x ${order.product} but are currently out of stock. Could you confirm when you can deliver more units?${sign}`,
      };
    case "supplier":
      return {
        finding: `The customer has paid and the product is available, but ${order.supplier_name} has not confirmed order ${order.id}. This is the main bottleneck preventing fulfilment.`,
        recommended_action: "Contact the supplier and request confirmation within the next 24 hours.",
        explanation: "Delivery cannot be scheduled until the supplier confirms. Every extra day increases the risk of a late order.",
        message_recipient: supplier,
        message_subject: `Confirmation needed for order ${order.id}`,
        suggested_message: `Hello ${order.supplier_name} team,\n\nCould you please confirm order ${order.id} (${order.quantity} x ${order.product})? Our customer has already paid and we would like to arrange delivery. A reply within 24 hours would be greatly appreciated.${sign}`,
      };
    case "delivery":
      return {
        finding: `Order ${order.id} is paid, in stock and confirmed by the supplier, but no delivery has been scheduled.`,
        recommended_action: "Book a carrier collection today so the order can ship.",
        explanation: "All upstream steps are complete; the only remaining blocker is arranging shipping.",
        message_recipient: "Warehouse / shipping team",
        message_subject: `Please book delivery for order ${order.id}`,
        suggested_message: `Hi team,\n\nOrder ${order.id} (${order.quantity} x ${order.product} for ${order.customer_name}) is ready to go. Please book a carrier collection today and share the tracking number.${sign}`,
      };
    default:
      return {
        finding: `Order ${order.id} has no blocking issues. Every fulfilment check has passed.`,
        recommended_action: "No action needed — keep monitoring until delivery.",
        explanation: "Payment, inventory, supplier and delivery checks all passed.",
        message_recipient: "",
        message_subject: "",
        suggested_message: "",
      };
  }
}
