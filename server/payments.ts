import type { Express, Request, Response } from "express";
import { desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import { commerceOrders, paymentOrders } from "../drizzle/schema";
import { getAppUser } from "./appAuth";

const DEMO_PAYMENT_CONFIG = {
  mode: "demo-wallet-cod",
  stripeEnabled: false,
  stripeEventsEnabled: false,
  supportedMethods: ["E-wallet", "COD"],
  currency: "PHP",
};

export const registerPaymentRoutes = (app: Express) => {
  app.get("/api/payments/config", (_req, res) => {
    res.json({ ok: true, ...DEMO_PAYMENT_CONFIG });
  });

  app.get("/api/payments/history", async (req: Request, res: Response) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in to view payment history." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Payment history is unavailable because the database is offline." });

    let rows;
    if (user.role === "admin") {
      rows = await db.select().from(paymentOrders).orderBy(desc(paymentOrders.createdAt)).limit(100);
    } else {
      const ownedOrders = await db.select({ orderId: commerceOrders.orderId }).from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id)));
      const orderIds = ownedOrders.map((row) => row.orderId);
      rows = orderIds.length
        ? await db.select().from(paymentOrders).where(inArray(paymentOrders.orderId, orderIds)).orderBy(desc(paymentOrders.createdAt)).limit(100)
        : [];
    }

    return res.json({ ok: true, payments: rows.map((row) => ({
      id: row.orderId,
      orderId: row.orderId,
      paymentMethod: row.paymentMethod,
      item: row.itemTitle,
      amountMinor: row.amountMinor,
      currency: row.currency.toUpperCase(),
      status: row.status,
      customerName: row.customerName,
      createdAt: row.createdAt,
    })) });
  });

  app.post("/api/payments/checkout", (_req, res) => {
    return res.status(410).json({ ok: false, error: "Stripe checkout is disabled for this school demo. Choose Demo wallet or Cash on Delivery at checkout." });
  });

  app.post("/api/stripe/webhook", (_req, res) => {
    return res.status(410).json({ ok: false, error: "Stripe webhooks are disabled in demo-wallet/COD mode. The Stripe Events table will remain empty." });
  });
};
