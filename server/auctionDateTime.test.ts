import { describe, expect, it } from "vitest";
import { philippineDateTimeToUtcIso, utcIsoToPhilippineDateTime } from "../client/src/data/auctionDateTime";

describe("auction deadline Philippine-time conversion", () => {
  it("stores Philippine datetime-local values as the matching UTC instant", () => {
    expect(philippineDateTimeToUtcIso("2030-10-02T14:30")).toBe("2030-10-02T06:30:00.000Z");
  });

  it("round-trips a UTC auction end back to Philippine wall time", () => {
    expect(utcIsoToPhilippineDateTime("2030-10-02T06:30:00.000Z")).toBe("2030-10-02T14:30");
  });

  it("rejects missing, malformed, and impossible local dates", () => {
    expect(philippineDateTimeToUtcIso("")).toBeNull();
    expect(philippineDateTimeToUtcIso("not-a-date")).toBeNull();
    expect(philippineDateTimeToUtcIso("2030-13-40T14:30")).toBeNull();
  });
});
