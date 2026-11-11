import { queryOptions } from "@tanstack/react-query";

import { getOrderDetail, getPaypalSettings, listActivity, listOrders } from "@/lib/orders.functions";
import { getProfile, listInvestigations, listProducts, listSuppliers } from "@/lib/business.functions";

export const ordersQuery = queryOptions({
  queryKey: ["orders"],
  queryFn: () => listOrders(),
});

export const orderDetailQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["order", orderId],
    queryFn: () => getOrderDetail({ data: { orderId } }),
  });

export const activityQuery = queryOptions({
  queryKey: ["activity"],
  queryFn: () => listActivity(),
});

export const paypalSettingsQuery = queryOptions({
  queryKey: ["paypal-settings"],
  queryFn: () => getPaypalSettings(),
});

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: () => getProfile(),
});

export const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: () => listProducts(),
});

export const suppliersQuery = queryOptions({
  queryKey: ["suppliers"],
  queryFn: () => listSuppliers(),
});

export const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: () => listInvestigations(),
});
