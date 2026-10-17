import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import { commerceOrders, shippingLabels } from "../drizzle/schema";
import { getAppUser } from "./appAuth";

type LabelRow = typeof shippingLabels.$inferSelect;
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[character] ?? character));
const labelDto = (row: LabelRow) => ({ ...row, weightKg: row.weightGrams / 1000, createdAt: row.createdAt.toISOString(), labelUrl: `/api/shipping/labels/${encodeURIComponent(row.labelId)}` });
const createSvg = (label: ReturnType<typeof labelDto>) => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="816" height="1056" viewBox="0 0 816 1056">
  <rect width="816" height="1056" fill="#fffefb"/>
  <rect x="24" y="24" width="768" height="1008" rx="18" fill="#fffefb" stroke="#182329" stroke-width="3"/>
  <text x="48" y="82" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#182329">MerchantHub · DEMO</text>
  <text x="48" y="112" font-family="Arial,sans-serif" font-size="13" letter-spacing="2" fill="#2d9c8b">SAMPLE SHIPPING LABEL · NOT A CARRIER BOOKING</text>
  <line x1="48" y1="142" x2="768" y2="142" stroke="#e8e4da" stroke-width="2"/>
  <text x="48" y="184" font-family="Arial,sans-serif" font-size="13" fill="#65706e">SHIP TO</text>
  <text x="48" y="220" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#182329">${escapeXml(label.destination)}</text>
  <text x="48" y="254" font-family="Arial,sans-serif" font-size="15" fill="#65706e">Order ${escapeXml(label.orderId)} · ${escapeXml(label.service)}</text>
  <rect x="48" y="282" width="720" height="68" rx="10" fill="#e9f6f2"/>
  <text x="70" y="312" font-family="Arial,sans-serif" font-size="12" fill="#2d9c8b">DEMO TRACKING REFERENCE</text>
  <text x="70" y="338" font-family="monospace" font-size="23" font-weight="700" fill="#182329">${escapeXml(label.tracking)}</text>
  <text x="48" y="402" font-family="Arial,sans-serif" font-size="13" fill="#65706e">CARRIER (SAMPLE)</text>
  <text x="48" y="434" font-family="Arial,sans-serif" font-size="21" font-weight="700" fill="#182329">${escapeXml(label.carrier)}</text>
  <text x="330" y="402" font-family="Arial,sans-serif" font-size="13" fill="#65706e">PACKAGE</text>
  <text x="330" y="434" font-family="Arial,sans-serif" font-size="21" font-weight="700" fill="#182329">${escapeXml(label.packageType)} · ${label.weightKg.toFixed(1)} kg</text>
  <rect x="48" y="480" width="720" height="280" fill="#fff" stroke="#e8e4da"/>
  <text x="408" y="786" text-anchor="middle" font-family="monospace" font-size="22" letter-spacing="5" fill="#182329">${escapeXml(label.tracking)}</text>
  <line x1="48" y1="842" x2="768" y2="842" stroke="#e8e4da" stroke-width="2"/>
  <text x="48" y="884" font-family="Arial,sans-serif" font-size="13" fill="#65706e">GENERATED</text>
  <text x="48" y="914" font-family="Arial,sans-serif" font-size="17" fill="#182329">${escapeXml(new Date(label.createdAt).toLocaleString("en-PH"))}</text>
  <text x="48" y="972" font-family="Arial,sans-serif" font-size="12" fill="#9aa39f">School-project demonstration only. No carrier pickup is booked.</text>
</svg>`;
};

const canViewOrder = (user: { id: number; role: string }, order: { buyerId: number; sellerId: number; riderId: number | null }) =>
  user.role === "admin" || order.buyerId === user.id || order.sellerId === user.id || order.riderId === user.id;

export const registerShippingRoutes = (app: Express) => {
  app.get("/api/shipping/labels", async (req: Request, res: Response) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in to view shipping labels." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Shipping labels are unavailable because the database is offline." });

    if (user.role === "admin") {
      const rows = await db.select().from(shippingLabels).orderBy(desc(shippingLabels.createdAt)).limit(100);
      return res.json({ ok: true, labels: rows.map(labelDto) });
    }
    const orders = await db.select({ orderId: commerceOrders.orderId }).from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id), eq(commerceOrders.riderId, user.id)));
    const orderIds = orders.map((order) => order.orderId);
    const rows = orderIds.length ? await db.select().from(shippingLabels).where(inArray(shippingLabels.orderId, orderIds)).orderBy(desc(shippingLabels.createdAt)).limit(100) : [];
    return res.json({ ok: true, labels: rows.map(labelDto) });
  });

  app.post("/api/shipping/labels", async (req: Request, res: Response) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Please log in to generate a shipping label." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Shipping label storage is unavailable because the database is offline." });

    const orderId = String(req.body?.orderId ?? "").trim();
    const carrier = String(req.body?.carrier ?? "").trim().slice(0, 80);
    const service = String(req.body?.service ?? "").trim().slice(0, 80);
    const packageType = String(req.body?.packageType ?? "").trim().slice(0, 60);
    const weightKg = Number(req.body?.weightKg);
    if (!orderId || !carrier || !service || !packageType || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 100) {
      return res.status(400).json({ ok: false, error: "Choose an order, carrier, service, package type, and a weight between 0 and 100 kg." });
    }

    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, orderId)).limit(1))[0];
    if (!order) return res.status(404).json({ ok: false, error: "Marketplace order not found." });
    if (user.role !== "admin" && order.sellerId !== user.id) return res.status(403).json({ ok: false, error: "Only the order's seller or an admin can generate its label." });
    if (["Cancelled", "Delivered"].includes(order.status)) return res.status(409).json({ ok: false, error: "A label cannot be generated for a cancelled or delivered order." });

    const existing = (await db.select().from(shippingLabels).where(eq(shippingLabels.orderId, orderId)).orderBy(desc(shippingLabels.createdAt)).limit(1))[0];
    if (existing) return res.json({ ok: true, existing: true, ...labelDto(existing) });

    const destination = [order.addressDetails, order.municipality, order.province].filter(Boolean).join(", ").slice(0, 120);
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const labelId = `LBL-${Date.now().toString(36).toUpperCase()}-${suffix}`;
    const carrierCode = carrier.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2).padEnd(2, "X");
    const tracking = `DEMO-${carrierCode}-${suffix}`;
    try {
      const result = await db.insert(shippingLabels).values({
        labelId,
        orderId,
        tracking,
        carrier,
        service,
        destination: destination || `${order.municipality}, ${order.province}`.slice(0, 120),
        packageType,
        weightGrams: Math.round(weightKg * 1000),
      }).$returningId();
      const row = (await db.select().from(shippingLabels).where(eq(shippingLabels.id, result[0].id)).limit(1))[0];
      if (!row) return res.status(500).json({ ok: false, error: "The label was not saved." });
      return res.status(201).json({ ok: true, ...labelDto(row) });
    } catch (error) {
      console.error("[Shipping] Label persistence failed", error);
      return res.status(503).json({ ok: false, error: "Shipping label could not be saved." });
    }
  });

  app.get("/api/shipping/labels/:labelId", async (req: Request, res: Response) => {
    const user = await getAppUser(req);
    if (!user) return res.status(401).send("Please log in to view this label.");
    const db = await getDb();
    if (!db) return res.status(503).send("Shipping label storage is unavailable.");
    const row = (await db.select().from(shippingLabels).where(eq(shippingLabels.labelId, req.params.labelId)).limit(1))[0];
    if (!row) return res.status(404).send("Label not found");
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, row.orderId)).limit(1))[0];
    if (!order || !canViewOrder(user, order)) return res.status(404).send("Label not found");
    res.type("image/svg+xml").set("Cache-Control", "no-store").send(createSvg(labelDto(row)));
  });
};
