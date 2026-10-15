import { describe, expect, it } from "vitest";
import { riderApplicationUpdate } from "./riderApplicationState";

describe("riderApplicationUpdate", () => {
  it("grants the rider role only after admin approval", () => {
    expect(riderApplicationUpdate("approved")).toEqual({
      riderApplicationStatus: "approved",
      role: "rider",
    });
  });

  it("keeps a denied applicant as a regular user", () => {
    expect(riderApplicationUpdate("denied")).toEqual({
      riderApplicationStatus: "denied",
      role: "user",
    });
  });
});
