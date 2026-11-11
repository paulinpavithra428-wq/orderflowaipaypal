import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type Supplier = Tables<"suppliers">;
export type ProductWithSupplier = Tables<"products"> & { suppliers: { name: string; email: string } | null };
export type InvestigationWithOrder = Tables<"investigations"> & {
  orders: {
    product: string;
    quantity: number;
    paypal_payment_status: string;
    payment_verified_at: string | null;
    payment_source: string;
    delivery_status: string;
  } | null;
};

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("business_name, is_demo")
      .eq("id", context.userId)
      .maybeSingle();
    return { businessName: data?.business_name ?? "My business", isDemo: data?.is_demo ?? false };
  });

export const listSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("suppliers").select("*").order("name");
    if (error) {
      console.error("listSuppliers failed", error);
      throw new Error("Could not load suppliers.");
    }
    return data;
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("products")
      .select("*, suppliers(name, email)")
      .order("name");
    if (error) {
      console.error("listProducts failed", error);
      throw new Error("Could not load inventory.");
    }
    return data as ProductWithSupplier[];
  });

export const listInvestigations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("investigations")
      .select("*, orders(product, quantity, paypal_payment_status, payment_verified_at, payment_source, delivery_status)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("listInvestigations failed", error);
      throw new Error("Could not load AI insights.");
    }
    return data as InvestigationWithOrder[];
  });

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  leadTimeDays: z.number().int().min(0).max(365).nullable(),
});

export const createSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => supplierSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("suppliers").insert({
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      lead_time_days: data.leadTimeDays,
    });
    if (error) {
      console.error("createSupplier failed", error);
      throw new Error("Could not save the supplier.");
    }
    return { ok: true };
  });

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(40),
  unitPrice: z.number().min(0.01).max(100000),
  onHand: z.number().int().min(0).max(1_000_000),
  supplierId: z.string().uuid().nullable(),
});

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => productSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("products").insert({
      name: data.name,
      sku: data.sku,
      unit_price: data.unitPrice,
      on_hand: data.onHand,
      supplier_id: data.supplierId,
    });
    if (error) {
      console.error("createProduct failed", error);
      throw new Error("Could not save the product.");
    }
    return { ok: true };
  });

const stockSchema = z.object({ productId: z.string().uuid(), onHand: z.number().int().min(0).max(1_000_000) });

/** Merchant-entered stock count. Never called automatically. */
export const updateStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => stockSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("products")
      .update({ on_hand: data.onHand })
      .eq("id", data.productId)
      .select("name");
    if (error || !rows?.length) throw new Error("Could not update stock.");
    await context.supabase.from("activity_log").insert({
      merchant_id: context.userId,
      action_type: "stock_updated",
      description: `Owner set stock for ${rows[0].name} to ${data.onHand}.`,
      details: { product_id: data.productId, on_hand: data.onHand },
    });
    return { ok: true };
  });

const orderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10_000),
  customerName: z.string().trim().min(1).max(120),
  customerEmail: z.string().trim().email().max(200),
});

/** Creates an unpaid PayPal Sandbox order. Amount comes from the product price, never from the browser. */
export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: product, error: pErr } = await db
      .from("products")
      .select("*, suppliers(name, email)")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr || !product) throw new Error("Product not found.");
    const p = product as ProductWithSupplier;
    const amount = Math.round(Number(p.unit_price) * data.quantity * 100) / 100;
    const { data: order, error } = await db
      .from("orders")
      .insert({
        customer_name: data.customerName,
        customer_email: data.customerEmail,
        product: p.name,
        sku: p.sku,
        quantity: data.quantity,
        amount,
        currency: p.currency,
        product_id: p.id,
        supplier_id: p.supplier_id,
        supplier_name: p.suppliers?.name ?? "No supplier linked",
        supplier_email: p.suppliers?.email ?? "unknown@example.com",
        supplier_status: "pending",
        delivery_status: "not_scheduled",
      })
      .select("id")
      .single();
    if (error || !order) {
      console.error("createOrder failed", error);
      throw new Error("Could not create the order.");
    }
    await db.from("activity_log").insert({
      order_id: order.id,
      merchant_id: context.userId,
      action_type: "order_created",
      description: `Owner created ${order.id}: ${data.quantity} × ${p.name} for ${data.customerName}.`,
      details: { amount, payment_source: "paypal_sandbox" },
    });
    return { orderId: order.id };
  });
