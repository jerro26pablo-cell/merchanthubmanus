export type RiderQueueFilter = "Available" | "Assigned" | "Picked up" | "In transit" | "Delivered";

export const riderQueueFilters: RiderQueueFilter[] = ["Available", "Assigned", "Picked up", "In transit", "Delivered"];

const statusForFilter: Record<RiderQueueFilter, string> = {
  Available: "Processing",
  Assigned: "Rider assigned",
  "Picked up": "Picked up",
  "In transit": "In transit",
  Delivered: "Delivered",
};

export function filterRiderOrders<T extends { status: string }>(orders: T[], filter: RiderQueueFilter): T[] {
  return orders.filter((order) => order.status === statusForFilter[filter]);
}
