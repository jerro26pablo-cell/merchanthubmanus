import { describe, expect, it } from "vitest";
import { demoPaymentStatus } from "./demoPaymentState";

describe("demoPaymentStatus", () => {
  it("records a demo-wallet payment as paid at checkout", () => {
    expect(demoPaymentStatus("demo_wallet", "Processing")).toBe("paid");
  });

  it("keeps COD pending until delivery", () => {
    expect(demoPaymentStatus("cod", "Processing")).toBe("pending");
    expect(demoPaymentStatus("cod", "In transit")).toBe("pending");
    expect(demoPaymentStatus("cod", "Delivered")).toBe("paid");
  });

  it("marks either method cancelled when its order is cancelled", () => {
    expect(demoPaymentStatus("demo_wallet", "Cancelled")).toBe("cancelled");
    expect(demoPaymentStatus("cod", "Cancelled")).toBe("cancelled");
  });
});
