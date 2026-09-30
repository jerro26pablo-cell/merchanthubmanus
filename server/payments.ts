import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { paymentOrders, stripeEvents } from "../drizzle/schema";
import { ENV } from "./_core/env";

const SUPPORTED_CURRENCIES = ["php", "usd", "eur", "gbp", "sgd", "aud"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
const CURRENCY_RATES: Record<SupportedCurrency, number> = { php: 1, usd: 0.0176, eur: 0.0163, gbp: 0.0139, sgd: 0.0236, aud: 0.0268 };
const SUBSCRIBED_EVENT_TYPES = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
]);
const CHECKOUT_ORDERS: Record<string, { itemTitle: string; amountPhp: number }> = {
  "MH-2841": { itemTitle: "Sony WH-1000XM5 Headphones", amountPhp: 8450 },
  "MH-2840": { itemTitle: "Handmade Leather Market Tote", amountPhp: 1850 },
  "MH-2837": { itemTitle: "Fujifilm X100V Silver", amountPhp: 43100 },
  "MH-2835": { itemTitle: "New Balance 990v5 Grey", amountPhp: 6900 },
  "MH-2829": { itemTitle: "Hand-thrown Ceramic Set", amountPhp: 2400 },
  "MH-2823": { itemTitle: "Vintage Walnut Record Player", amountPhp: 5100 },
};

const asCurrency = (value: unknown): SupportedCurrency | null => {
  const currency = String(value ?? "").toLowerCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency) ? currency as SupportedCurrency : null;
};

const browserOrigin = (req: Request) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0];
  return forwardedHost ? `${forwardedProto}://${forwardedHost}` : "http://localhost:3000";
};

const recordCheckout = async (input: {
  orderId: string;
  sessionId: string;
  currency: SupportedCurrency;
  amountMinor: number;
  customerEmail: string;
  customerName: string;
  itemTitle: string;
}) => {
  const db = await getDb();
  if (!db) return;
  await db.insert(paymentOrders).values({
    orderId: input.orderId,
    stripeCheckoutSessionId: input.sessionId,
    currency: input.currency,
    amountMinor: input.amountMinor,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    itemTitle: input.itemTitle,
    status: "processing",
  }).onDuplicateKeyUpdate({
    set: {
      stripeCheckoutSessionId: input.sessionId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      updatedAt: new Date(),
    },
  });
};

const updatePaymentFromCheckout = async (session: Record<string, any>) => {
  const orderId = String(session.metadata?.order_id ?? session.client_reference_id ?? "");
  if (!orderId) return;
  const db = await getDb();
  if (!db) return;
  await db.update(paymentOrders).set({
    status: session.payment_status === "paid" ? "paid" : "processing",
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    updatedAt: new Date(),
  }).where(eq(paymentOrders.orderId, orderId));
};

const updatePaymentFromIntent = async (intent: Record<string, any>, status: "paid" | "failed") => {
  const orderId = String(intent.metadata?.order_id ?? "");
  if (!orderId) return;
  const db = await getDb();
  if (!db) return;
  await db.update(paymentOrders).set({
    status,
    stripePaymentIntentId: typeof intent.id === "string" ? intent.id : undefined,
    updatedAt: new Date(),
  }).where(eq(paymentOrders.orderId, orderId));
};

const recordEventOnce = async (event: Record<string, any>) => {
  const db = await getDb();
  if (!db) return true;
  try {
    await db.insert(stripeEvents).values({
      id: String(event.id),
      type: String(event.type),
      eventCreatedAt: new Date(Number(event.created ?? Math.floor(Date.now() / 1000)) * 1000),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const causeCode = typeof error === "object" && error && "cause" in error ? String((error as { cause?: { code?: string } }).cause?.code ?? "") : "";
    if (message.includes("duplicate") || message.includes("unique") || causeCode === "ER_DUP_ENTRY") return false;
    throw error;
  }
};

const verifyStripeSignature = (rawBody: Buffer, signature: string | undefined, secret: string) => {
  if (!signature || !secret) return false;
  const parts = Object.fromEntries(signature.split(",").map((part) => {
    const [key, value] = part.split("=", 2);
    return [key, value];
  }));
  const timestamp = Number(parts.t);
  const signedPayload = `${parts.t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(parts.v1, "utf8");
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const registerPaymentRoutes = (app: Express) => {
  app.get("/api/payments/config", (_req, res) => {
    res.json({
      stripeEnabled: Boolean(ENV.stripeSecretKey),
      supportedCurrencies: SUPPORTED_CURRENCIES,
      testMode: true,
    });
  });

  app.get("/api/payments/history", async (_req, res) => {
    const db = await getDb();
    if (!db) return res.json({ ok: true, payments: [] });
    const rows = await db.select().from(paymentOrders).orderBy(desc(paymentOrders.createdAt)).limit(12);
    return res.json({ ok: true, payments: rows.map((row) => ({
      id: row.orderId,
      sessionId: row.stripeCheckoutSessionId,
      item: row.itemTitle,
      amountMinor: row.amountMinor,
      currency: row.currency.toUpperCase(),
      status: row.status,
      customerName: row.customerName,
      createdAt: row.createdAt,
    })) });
  });

  app.post("/api/payments/checkout", async (req: Request, res: Response) => {
    const currency = asCurrency(req.body?.currency);
    const orderId = String(req.body?.orderId ?? "").trim();
    const order = CHECKOUT_ORDERS[orderId];
    const customerEmail = String(req.body?.customerEmail ?? "alex@example.com").trim().slice(0, 320);
    const customerName = String(req.body?.customerName ?? "Alex Rivera").trim().slice(0, 120);

    if (!currency || !orderId || !order) {
      return res.status(400).json({ ok: false, error: "currency and a recognized orderId are required" });
    }
    if (!ENV.stripeSecretKey) {
      return res.status(503).json({ ok: false, error: "Stripe sandbox is not configured in this runtime" });
    }

    try {
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", `${browserOrigin(req)}/payments?payment=success&session_id={CHECKOUT_SESSION_ID}`);
      params.set("cancel_url", `${browserOrigin(req)}/payments?payment=cancelled`);
      params.set("client_reference_id", orderId);
      params.set("customer_email", customerEmail);
      params.set("allow_promotion_codes", "true");
      params.set("line_items[0][price_data][currency]", currency);
      const amountMinor = Math.max(50, Math.round(order.amountPhp * CURRENCY_RATES[currency] * 100));
      params.set("line_items[0][price_data][unit_amount]", String(amountMinor));
      params.set("line_items[0][price_data][product_data][name]", order.itemTitle);
      params.set("line_items[0][price_data][product_data][description]", `MerchantHub order ${orderId}`);
      params.set("line_items[0][quantity]", "1");
      params.set("metadata[order_id]", orderId);
      params.set("metadata[user_id]", "demo-alex-rivera");
      params.set("metadata[customer_email]", customerEmail);
      params.set("metadata[customer_name]", customerName);

      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
      const payload = await response.json() as Record<string, any>;
      if (!response.ok || !payload.url) {
        console.error("[Stripe] Checkout creation failed", payload);
        return res.status(502).json({ ok: false, error: payload.error?.message ?? "Stripe could not create a checkout session" });
      }
      await recordCheckout({ orderId, sessionId: String(payload.id), currency, amountMinor, customerEmail, customerName, itemTitle: order.itemTitle });
      return res.json({ ok: true, checkoutUrl: payload.url, sessionId: payload.id, amountMinor, currency });
    } catch (error) {
      console.error("[Stripe] Checkout request failed", error);
      return res.status(502).json({ ok: false, error: "Payment gateway is temporarily unavailable" });
    }
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
    if (!verifyStripeSignature(rawBody, req.header("stripe-signature"), ENV.stripeWebhookSecret)) {
      return res.status(400).send("Invalid signature");
    }
    let event: Record<string, any>;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).send("Invalid payload");
    }
    try {
      const shouldProcess = await recordEventOnce(event);
      if (shouldProcess && SUBSCRIBED_EVENT_TYPES.has(String(event.type))) {
        if (event.type === "checkout.session.completed") await updatePaymentFromCheckout(event.data?.object ?? {});
        if (event.type === "payment_intent.succeeded") await updatePaymentFromIntent(event.data?.object ?? {}, "paid");
        if (event.type === "payment_intent.payment_failed") await updatePaymentFromIntent(event.data?.object ?? {}, "failed");
      }
      return res.json({ received: true, duplicate: !shouldProcess });
    } catch (error) {
      console.error("[Stripe] Webhook processing failed", error);
      return res.status(500).send("Webhook processing failed");
    }
  });
};
