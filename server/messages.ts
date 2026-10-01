import type { Express, Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { listingsOwned, messages, users, wishlists } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => { const user = await getAppUser(req); if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; } return user; };
export const registerMessageRoutes = (app: Express) => {
  app.get("/api/messages", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(messages).where(or(eq(messages.senderId, user.id), eq(messages.recipientId, user.id)));
    const people = await db.select({ id: users.id, name: users.name, email: users.email, storeName: users.storeName }).from(users);
    const listings = await db.select({ id: listingsOwned.listingId, title: listingsOwned.title }).from(listingsOwned);
    const peopleMap = new Map(people.map((person) => [person.id, person])); const listingMap = new Map(listings.map((listing) => [listing.id, listing.title]));
    return res.json({ ok: true, messages: rows.map((row) => ({ ...row, otherUserId: row.senderId === user.id ? row.recipientId : row.senderId, otherUser: peopleMap.get(row.senderId === user.id ? row.recipientId : row.senderId)?.name ?? "MerchantHub user", listingTitle: row.listingId ? listingMap.get(row.listingId) ?? "Listing" : "General message" })) });
  });
  app.post("/api/messages/:messageId/read", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(messages).set({ readAt: new Date() }).where(and(eq(messages.id, Number(req.params.messageId)), eq(messages.recipientId, user.id)));
    return res.json({ ok: true });
  });
  app.post("/api/messages", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const recipientId = Number(req.body?.recipientId); const body = String(req.body?.body ?? "").trim(); const listingId = req.body?.listingId ? String(req.body.listingId) : null;
    if (!Number.isInteger(recipientId) || recipientId === user.id || !body) return res.status(400).json({ ok: false, error: "Recipient and message are required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const recipient = (await db.select().from(users).where(eq(users.id, recipientId)).limit(1))[0]; if (!recipient) return res.status(404).json({ ok: false, error: "Recipient not found." });
    const result = await db.insert(messages).values({ recipientId, senderId: user.id, listingId, body }).$returningId();
    await createNotification(recipientId, "system", "New message", `${user.name} sent you a message${listingId ? " about a listing" : ""}.`, listingId ?? undefined);
    return res.status(201).json({ ok: true, messageId: result[0]?.id });
  });
  app.get("/api/wishlist", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(wishlists).where(eq(wishlists.userId, user.id)); return res.json({ ok: true, listingIds: rows.map((row) => row.listingId) });
  });
  app.post("/api/wishlist", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const listingId = String(req.body?.listingId ?? ""); if (!listingId) return res.status(400).json({ ok: false, error: "Listing is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const existing = (await db.select().from(wishlists).where(and(eq(wishlists.userId, user.id), eq(wishlists.listingId, listingId))).limit(1))[0];
    if (existing) await db.delete(wishlists).where(eq(wishlists.id, existing.id)); else await db.insert(wishlists).values({ userId: user.id, listingId });
    return res.json({ ok: true, saved: !existing });
  });
};
