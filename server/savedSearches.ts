import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { getAppUser } from "./appAuth";
import { listingsOwned, savedSearches, users } from "../drizzle/schema";
import { createNotification } from "./notifications";

const auth = async (req: Request, res: Response) => {
  const user = await getAppUser(req);
  if (!user) { res.status(401).json({ ok: false, error: "Please log in." }); return undefined; }
  return user;
};
const normalize = (value: unknown, length = 255) => String(value ?? "").trim().slice(0, length);
const tokens = (value: string) => value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
type SearchDefinition = { query: string; filter: string; province?: string | null; municipality?: string | null };
type SearchListing = { title: string; description: string | null; category: string; listingType: string };
type SearchLocation = { province?: string | null; municipality?: string | null };
export function matchesSavedSearch(saved: SearchDefinition, listing: SearchListing, location: SearchLocation = {}) {
  const haystack = `${listing.title} ${listing.description ?? ""} ${listing.category} ${listing.listingType}`.toLocaleLowerCase();
  const queryMatches = tokens(saved.query).every((token) => haystack.includes(token));
  const filter = saved.filter.trim().toLocaleLowerCase();
  const filterMatches = !filter || filter === "all items" || filter === listing.listingType.toLocaleLowerCase() || filter === listing.category.toLocaleLowerCase();
  const provinceMatches = !saved.province || saved.province.trim().toLocaleLowerCase() === (location.province ?? "").trim().toLocaleLowerCase();
  const municipalityMatches = !saved.municipality || saved.municipality.trim().toLocaleLowerCase() === (location.municipality ?? "").trim().toLocaleLowerCase();
  return queryMatches && filterMatches && provinceMatches && municipalityMatches;
}

export async function notifySavedSearchMatches(listing: typeof listingsOwned.$inferSelect) {
  if (listing.lifecycle !== "official" || listing.stock <= 0) return;
  const db = await getDb(); if (!db) return;
  const owner = (await db.select({ province: users.province, municipality: users.municipality }).from(users).where(eq(users.id, listing.ownerId)).limit(1))[0];
  const searches = await db.select().from(savedSearches);
  for (const saved of searches.filter((search) => search.userId !== listing.ownerId && matchesSavedSearch(search, listing, owner ?? {}))) {
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
    const query = normalize(req.body?.query);
    const filter = normalize(req.body?.filter, 80) || "All items";
    const province = normalize(req.body?.province, 120) || null;
    const municipality = normalize(req.body?.municipality, 120) || null;
    if (!query && filter === "All items" && !province && !municipality) return res.status(400).json({ ok: false, error: "Add a search term, choose a filter, or select a location before saving." });
    if (municipality && !province) return res.status(400).json({ ok: false, error: "Choose a province for the municipality filter." });
    const locationName = [municipality, province].filter(Boolean).join(", ");
    const name = normalize(req.body?.name, 120) || [query, filter === "All items" ? "" : filter, locationName].filter(Boolean).join(" · ") || "All marketplace items";
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const existing = (await db.select().from(savedSearches).where(and(eq(savedSearches.userId, user.id), eq(savedSearches.query, query), eq(savedSearches.filter, filter), province ? eq(savedSearches.province, province) : isNull(savedSearches.province), municipality ? eq(savedSearches.municipality, municipality) : isNull(savedSearches.municipality))).limit(1))[0];
    if (existing) return res.json({ ok: true, search: existing, existing: true });
    const result = await db.insert(savedSearches).values({ userId: user.id, name, query, filter, province, municipality }).$returningId();
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
