export type RiderQueueFilter = "Available" | "Assigned" | "Picked up" | "In transit" | "Delivered" | "Cancelled";

export const riderQueueFilters: RiderQueueFilter[] = ["Available", "Assigned", "Picked up", "In transit", "Delivered", "Cancelled"];

const statusForFilter: Record<RiderQueueFilter, string> = {
  Available: "Processing",
  Assigned: "Rider assigned",
  "Picked up": "Picked up",
  "In transit": "In transit",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

export function filterRiderOrders<T extends { status: string }>(orders: T[], filter: RiderQueueFilter): T[] {
  return orders.filter((order) => order.status === statusForFilter[filter]);
}
