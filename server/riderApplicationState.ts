export type RiderApplicationDecision = "approved" | "denied";

export function riderApplicationUpdate(status: RiderApplicationDecision) {
  return {
    riderApplicationStatus: status,
    role: status === "approved" ? ("rider" as const) : ("user" as const),
  };
}
