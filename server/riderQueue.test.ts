import { describe, expect, it } from "vitest";
import { filterRiderOrders, riderQueueFilters } from "../client/src/data/riderQueue";

const orders = [
  { orderId: "1", status: "Processing" },
  { orderId: "2", status: "Rider assigned" },
  { orderId: "3", status: "Picked up" },
  { orderId: "4", status: "In transit" },
  { orderId: "5", status: "Delivered" },
  { orderId: "6", status: "Cancelled" },
];

describe("rider queue filters", () => {
  it("provides separate buckets for orders to accept and every delivery stage", () => {
    expect(riderQueueFilters).toHaveLength(6);
    expect(filterRiderOrders(orders, "Available").map((order) => order.orderId)).toEqual(["1"]);
    expect(filterRiderOrders(orders, "Assigned").map((order) => order.orderId)).toEqual(["2"]);
    expect(filterRiderOrders(orders, "Picked up").map((order) => order.orderId)).toEqual(["3"]);
    expect(filterRiderOrders(orders, "In transit").map((order) => order.orderId)).toEqual(["4"]);
    expect(filterRiderOrders(orders, "Delivered").map((order) => order.orderId)).toEqual(["5"]);
    expect(filterRiderOrders(orders, "Cancelled").map((order) => order.orderId)).toEqual(["6"]);
  });
});
