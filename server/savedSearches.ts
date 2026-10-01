import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { listingsOwned, savedSearches } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const normalize = (value: unknown) => String(value ?? "").trim().slice(0, 255);
const tokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
const matches = (saved: typeof savedSearches.$inferSelect, listing: typeof listingsOwned.$inferSelect) => {
  const haystack = `${listing.title} ${listing.description} ${listing.category} ${listing.listingType}`.toLowerCase();
  const queryMatches = tokens(saved.query).every((token) => haystack.includes(token));
  const filterMatches = !saved.filter || saved.filter === "All items" || saved.filter === listing.listingType || saved.filter.toLowerCase() === listing.category.toLowerCase();
  return queryMatches && filterMatches;
};

export async function notifySavedSearchMatches(listing: typeof listingsOwned.$inferSelect) {
  if (listing.lifecycle !== "official") return;
  const db = await getDb(); if (!db) return;
  const searches = await db.select().from(savedSearches);
  for (const saved of searches.filter((search) => search.userId !== listing.ownerId && matches(search, listing))) {
    await createNotification(saved.userId, "system", "Saved search match", `A new listing, “${listing.title}”, matches your saved search “${saved.name}”.`, listing.listingId);
  }
}

export function registerSavedSearchRoutes(app: Express) {
  app.get("/api/saved-searches", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(savedSearches).where(eq(savedSearches.userId, user.id));
    return res.json({ ok: true, searches: rows });
  });
  app.post("/api/saved-searches", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const query = normalize(req.body?.query); const filter = normalize(req.body?.filter) || "All items"; const name = normalize(req.body?.name) || [query, filter === "All items" ? "" : filter].filter(Boolean).join(" · ") || "All marketplace items";
    if (!query && filter === "All items") return res.status(400).json({ ok: false, error: "Add a search term or choose a filter before saving." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const existing = (await db.select().from(savedSearches).where(and(eq(savedSearches.userId, user.id), eq(savedSearches.query, query), eq(savedSearches.filter, filter))).limit(1))[0];
    if (existing) return res.json({ ok: true, search: existing, existing: true });
    const result = await db.insert(savedSearches).values({ userId: user.id, name, query, filter }).$returningId();
    const search = (await db.select().from(savedSearches).where(eq(savedSearches.id, result[0].id)).limit(1))[0];
    return res.status(201).json({ ok: true, search });
  });
  app.delete("/api/saved-searches/:id", async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.delete(savedSearches).where(and(eq(savedSearches.id, Number(req.params.id)), eq(savedSearches.userId, user.id)));
    return res.json({ ok: true });
  });
}
