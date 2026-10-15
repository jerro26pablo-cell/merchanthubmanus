import { randomBytes } from "node:crypto";
import { stripeEvents } from "../drizzle/schema";

/**
 * The demo intentionally reuses the existing stripe_events table for the
 * marketplace's internal payment audit trail. These rows look like normal
 * Stripe event records, but no Stripe API or webhook is involved.
 */
export async function recordDemoStripeEvent(db: any, type: string) {
  await db.insert(stripeEvents).values({
    id: `evt_${randomBytes(16).toString("hex")}`,
    type,
    eventCreatedAt: new Date(),
  });
}
