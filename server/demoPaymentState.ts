export type DemoPaymentMethod = "demo_wallet" | "cod";
export type DemoPaymentStatus = "pending" | "paid" | "cancelled";

export function demoPaymentStatus(method: DemoPaymentMethod, orderStatus: string): DemoPaymentStatus {
  if (orderStatus === "Cancelled") return "cancelled";
  if (method === "demo_wallet" || orderStatus === "Delivered") return "paid";
  return "pending";
}
