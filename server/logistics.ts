import type { Express, Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { commerceOrders, listingsOwned, riderLocations, users } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
export const registerLogisticsRoutes = (app: Express) => {
  app.post("/api/orders/checkout", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const body = req.body ?? {}; const listingId = String(body.listingId ?? "");
    if (!listingId) return res.status(400).json({ ok: false, error: "Listing is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const listing = (await db.select().from(listingsOwned).where(eq(listingsOwned.listingId, listingId)).limit(1))[0];
    if (!listing || listing.lifecycle !== "official") return res.status(404).json({ ok: false, error: "This listing is no longer available." });
    if (listing.ownerId === user.id) return res.status(403).json({ ok: false, error: "You cannot buy your own listing." });
    const requestedQuantity = Math.max(1, Math.round(Number(body.quantity) || 1));
    if (requestedQuantity > listing.stock) return res.status(409).json({ ok: false, error: `Only ${listing.stock} item(s) remain in stock.` });
    const orderId = `MH-${Date.now().toString().slice(-6)}`;
    await db.insert(commerceOrders).values({ orderId, listingId, buyerId: user.id, sellerId: listing.ownerId, quantity: requestedQuantity, amountCents: Math.max(0, Math.round(Number(body.amountCents) || 0)), payment: body.payment === "COD" ? "COD" : "Online", province: String(body.province || user.province || "Unknown"), municipality: String(body.municipality || user.municipality || "Unknown"), addressDetails: body.addressDetails ? String(body.addressDetails).slice(0, 240) : null, destinationLatitude: body.destinationLatitude ? String(body.destinationLatitude) : null, destinationLongitude: body.destinationLongitude ? String(body.destinationLongitude) : null, status: "Processing" });
    await db.update(listingsOwned).set({ stock: listing.stock - requestedQuantity }).where(eq(listingsOwned.listingId, listingId));
    await createNotification(user.id, "order_created", "Order placed", `Your order ${orderId} is being prepared for ${body.municipality || user.municipality || "your location"}.`, orderId);
    return res.status(201).json({ ok: true, orderId, location: { province: body.province || user.province, municipality: body.municipality || user.municipality, addressDetails: body.addressDetails || null } });
  });
  app.get("/api/orders/active", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = user.role === "rider" ? await db.select().from(commerceOrders).where(or(eq(commerceOrders.status, "Processing"), and(eq(commerceOrders.riderId, user.id), or(eq(commerceOrders.status, "Rider assigned"), eq(commerceOrders.status, "Picked up"), eq(commerceOrders.status, "In transit"))))) : user.role === "admin" ? await db.select().from(commerceOrders) : await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerId, user.id), eq(commerceOrders.sellerId, user.id)));
    const orders = await Promise.all(rows.map(async (row) => { const buyer = (await db.select({ name: users.name }).from(users).where(eq(users.id, row.buyerId)).limit(1))[0]; const seller = (await db.select({ name: users.name, storeName: users.storeName }).from(users).where(eq(users.id, row.sellerId)).limit(1))[0]; return { ...row, buyerName: buyer?.name ?? `Buyer ${row.buyerId}`, sellerName: seller?.storeName || seller?.name || `Seller ${row.sellerId}` }; }));
    return res.json({ ok: true, orders });
  });
  app.get("/api/orders/:orderId", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!order || (user.role !== "admin" && user.id !== order.buyerId && user.id !== order.sellerId && user.id !== order.riderId)) return res.status(404).json({ ok: false, error: "Order not found." });
    const buyer = (await db.select({ name: users.name }).from(users).where(eq(users.id, order.buyerId)).limit(1))[0]; const seller = (await db.select({ name: users.name, storeName: users.storeName }).from(users).where(eq(users.id, order.sellerId)).limit(1))[0];
    return res.json({ ok: true, order: { ...order, buyerName: buyer?.name ?? `Buyer ${order.buyerId}`, sellerName: seller?.storeName || seller?.name || `Seller ${order.sellerId}` } });
  });
  app.post("/api/orders/:orderId/accept", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    if (user.role !== "rider") return res.status(403).json({ ok: false, error: "Only the rider account can accept deliveries." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(commerceOrders).set({ riderId: user.id, status: "Rider assigned" }).where(and(eq(commerceOrders.orderId, req.params.orderId), eq(commerceOrders.status, "Processing")));
    const row = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (row) await createNotification(row.buyerId, "delivery_update", "Rider accepted your delivery", `Your order ${row.orderId} was accepted by the rider.`, row.orderId);
    return res.json({ ok: true, order: row ?? null });
  });
  app.post("/api/orders/:orderId/status", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    if (user.role !== "rider" && user.role !== "admin") return res.status(403).json({ ok: false, error: "Only a rider or admin can update delivery status." });
    const nextStatus = req.body?.status;
    if (!["Rider assigned", "Picked up", "In transit", "Delivered", "Cancelled"].includes(nextStatus)) return res.status(400).json({ ok: false, error: "Invalid delivery status." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const current = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!current) return res.status(404).json({ ok: false, error: "Order not found." });
    if (user.role === "rider" && current.riderId !== user.id) return res.status(403).json({ ok: false, error: "This delivery is not assigned to you." });
    await db.update(commerceOrders).set({ status: nextStatus }).where(eq(commerceOrders.orderId, req.params.orderId));
    await createNotification(current.buyerId, "delivery_update", `Delivery ${nextStatus.toLowerCase()}`, `Order ${current.orderId} is now ${nextStatus}.`, current.orderId);
    if (current.sellerId) await createNotification(current.sellerId, "delivery_update", `Order ${nextStatus.toLowerCase()}`, `Order ${current.orderId} is now ${nextStatus}.`, current.orderId);
    return res.json({ ok: true, status: nextStatus });
  });
  app.post("/api/rider/location", async (req, res) => {
    const user = await auth(req, res); if (!user || user.role !== "rider") return res.status(403).json({ ok: false, error: "Rider access required." });
    const latitude = String(req.body?.latitude ?? ""); const longitude = String(req.body?.longitude ?? ""); if (!latitude || !longitude) return res.status(400).json({ ok: false, error: "Coordinates are required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const active = (await db.select().from(commerceOrders).where(and(eq(commerceOrders.riderId, user.id), or(eq(commerceOrders.status, "Rider assigned"), eq(commerceOrders.status, "Picked up"), eq(commerceOrders.status, "In transit")))).limit(1))[0];
    await db.insert(riderLocations).values({ riderId: user.id, orderId: active?.orderId ?? null, latitude, longitude, accuracy: req.body?.accuracy ? String(req.body.accuracy) : null, moving: req.body?.moving ? 1 : 0 }).onDuplicateKeyUpdate({ set: { orderId: active?.orderId ?? null, latitude, longitude, accuracy: req.body?.accuracy ? String(req.body.accuracy) : null, moving: req.body?.moving ? 1 : 0 } });
    return res.json({ ok: true, updatedAt: new Date().toISOString(), moving: Boolean(req.body?.moving) });
  });
  app.get("/api/orders/:orderId/location", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const order = (await db.select().from(commerceOrders).where(eq(commerceOrders.orderId, req.params.orderId)).limit(1))[0];
    if (!order || (user.role !== "rider" && user.id !== order.buyerId && user.id !== order.sellerId && user.role !== "admin")) return res.status(404).json({ ok: false, error: "Order not found." });
    const location = (await db.select().from(riderLocations).where(eq(riderLocations.orderId, req.params.orderId)).limit(1))[0] ?? (order.riderId ? (await db.select().from(riderLocations).where(eq(riderLocations.riderId, order.riderId)).limit(1))[0] : undefined);
    return res.json({ ok: true, order, location: location ?? null });
  });
};
