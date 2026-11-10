import { queryOptions } from "@tanstack/react-query";

import { getOrderDetail, getPaypalSettings, listActivity, listOrders } from "@/lib/orders.functions";

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
