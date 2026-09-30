import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse } from "cookie";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "../drizzle/schema";

const SESSION_COOKIE = "merchant_hub_session";
const SESSION_SECRET = process.env.MANUS_JWT_SECRET ?? process.env.SESSION_SECRET ?? "merchant-hub-demo-session-secret";
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin123";
const RIDER_EMAIL = "rider@gmail.com";
const RIDER_PASSWORD = "rider123";
type SessionUser = { id: number; name: string; email: string; role: "user" | "admin" | "rider"; province?: string | null; municipality?: string | null; walletCents: number; storeName?: string | null; storeImage?: string | null; sellerEnabled: boolean };

const hashPassword = (password: string) => new Promise<string>((resolve, reject) => {
  crypto.scrypt(password, SESSION_SECRET, 64, (error, derived) => {
    if (error) return reject(error);
    resolve(derived.toString("hex"));
  });
});

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const signSession = (user: SessionUser) => {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
};

const verifySession = (token: string | undefined) => {
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (!safeEqual(signature, expected)) return undefined;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id: number; exp: number };
    return data.exp > Date.now() ? data.id : undefined;
  } catch { return undefined; }
};

const publicUser = (user: typeof users.$inferSelect): SessionUser => ({ id: user.id, name: user.name ?? user.email ?? "MerchantHub user", email: user.email ?? "", role: user.role, province: user.province, municipality: user.municipality, walletCents: user.walletCents, storeName: user.storeName, storeImage: user.storeImage, sellerEnabled: Boolean(user.sellerEnabled) });

export async function getAppUser(req: Request): Promise<SessionUser | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const id = verifySession(parse(req.headers.cookie ?? "")[SESSION_COOKIE]);
  if (!id) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ? publicUser(result[0]) : undefined;
}

const setSessionCookie = (req: Request, res: Response, user: SessionUser) => {
  res.cookie(SESSION_COOKIE, signSession(user), { httpOnly: true, sameSite: "lax", secure: req.secure || req.headers["x-forwarded-proto"] === "https", maxAge: 60 * 60 * 24 * 30 * 1000, path: "/" });
};

const clearSessionCookie = (req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: req.secure || req.headers["x-forwarded-proto"] === "https", path: "/" });
};

export function registerAppAuthRoutes(app: Express) {
  app.get("/api/auth/me", async (req, res) => {
    const user = await getAppUser(req);
    return res.json({ ok: true, user: user ?? null });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, province, municipality } = req.body as Record<string, unknown>;
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!String(name ?? "").trim() || !normalizedEmail.includes("@") || String(password ?? "").length < 6 || !String(province ?? "").trim() || !String(municipality ?? "").trim()) return res.status(400).json({ ok: false, error: "Complete all fields. Password must be at least 6 characters." });
    if (normalizedEmail === ADMIN_EMAIL) return res.status(403).json({ ok: false, error: "That email is reserved for the admin account." });
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing[0]) return res.status(409).json({ ok: false, error: "An account with that email already exists." });
    const [created] = await db.insert(users).values({ openId: `local:${normalizedEmail}`, name: String(name).trim(), email: normalizedEmail, passwordHash: await hashPassword(String(password)), province: String(province).trim(), municipality: String(municipality).trim(), walletCents: 0, loginMethod: "password", role: "user" }).$returningId();
    const row = await db.select().from(users).where(eq(users.id, created.id)).limit(1);
    if (!row[0]) return res.status(500).json({ ok: false, error: "Account could not be loaded after registration." });
    const user = publicUser(row[0]);
    setSessionCookie(req, res, user);
    return res.json({ ok: true, user });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body as Record<string, unknown>;
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const plainPassword = String(password ?? "");
    const db = await getDb();
    if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    let row = (await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1))[0];
    if (normalizedEmail === ADMIN_EMAIL && plainPassword === ADMIN_PASSWORD) {
      if (!row) {
        const [created] = await db.insert(users).values({ openId: "local:admin@gmail.com", name: "MerchantHub Admin", email: ADMIN_EMAIL, passwordHash: await hashPassword(ADMIN_PASSWORD), province: "South Cotabato", municipality: "Polomolok", walletCents: 0, loginMethod: "password", role: "admin" }).$returningId();
        row = (await db.select().from(users).where(eq(users.id, created.id)).limit(1))[0];
      } else if (row.role !== "admin") {
        await db.update(users).set({ role: "admin", passwordHash: await hashPassword(ADMIN_PASSWORD) }).where(eq(users.id, row.id));
        row = (await db.select().from(users).where(eq(users.id, row!.id)).limit(1))[0];
      }
    }
    if (normalizedEmail === RIDER_EMAIL && plainPassword === RIDER_PASSWORD) {
      if (!row) {
        const [created] = await db.insert(users).values({ openId: "local:rider@gmail.com", name: "MerchantHub Rider", email: RIDER_EMAIL, passwordHash: await hashPassword(RIDER_PASSWORD), province: "South Cotabato", municipality: "Polomolok", walletCents: 0, loginMethod: "password", role: "rider" }).$returningId();
        row = (await db.select().from(users).where(eq(users.id, created.id)).limit(1))[0];
      } else if (row.role !== "rider") {
        await db.update(users).set({ role: "rider", passwordHash: await hashPassword(RIDER_PASSWORD) }).where(eq(users.id, row.id));
        row = (await db.select().from(users).where(eq(users.id, row!.id)).limit(1))[0];
      }
    }
    if (!row?.passwordHash || !safeEqual(await hashPassword(plainPassword), row.passwordHash)) return res.status(401).json({ ok: false, error: "Email or password is incorrect." });
    const user = publicUser(row);
    setSessionCookie(req, res, user);
    return res.json({ ok: true, user });
  });

  app.post("/api/auth/logout", (req, res) => { clearSessionCookie(req, res); return res.json({ ok: true }); });
  app.patch("/api/auth/seller-profile", async (req, res) => {
    const user = await getAppUser(req); if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const storeName = String(req.body?.storeName ?? "").trim(); const storeImage = req.body?.storeImage ? String(req.body.storeImage) : null;
    if (!storeName) return res.status(400).json({ ok: false, error: "Store name is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(users).set({ storeName, storeImage, sellerEnabled: 1 }).where(eq(users.id, user.id));
    const row = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    return res.json({ ok: true, user: row ? publicUser(row) : user });
  });
  app.post("/api/admin/reset-demo", async (req, res) => {
    const user = await getAppUser(req); if (user?.role !== "admin") return res.status(403).json({ ok: false, error: "Admin access is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    try {
      await db.execute(sql.raw("DELETE FROM proxy_bids")); await db.execute(sql.raw("DELETE FROM commerce_orders")); await db.execute(sql.raw("DELETE FROM payment_orders")); await db.execute(sql.raw("DELETE FROM stripe_events")); await db.execute(sql.raw("DELETE FROM shipping_labels")); await db.execute(sql.raw("DELETE FROM notifications")); await db.execute(sql.raw("DELETE FROM rider_locations")); await db.execute(sql.raw("DELETE FROM listings_owned"));
      await db.execute(sql.raw("DELETE FROM users WHERE role NOT IN ('admin','rider')"));
      const demo = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
      if (!demo) return res.status(500).json({ ok: false, error: "Admin account could not be loaded." });
      await db.update(users).set({ storeName: "MerchantHub Operations Store", sellerEnabled: 1 }).where(eq(users.id, demo.id));
      const seed = [
        ["demo-buy-now", "Demo Buy Now Camera", "Buy now", 125000, "Cameras"],
        ["demo-auction-headphones", "Demo Auction Headphones", "Auction", 650000, "Audio"],
        ["demo-both-record-player", "Demo Auction + Buy Now Record Player", "Both", 280000, "Collectibles"],
      ] as const;
      for (const [listingId, title, listingType, priceCents, category] of seed) await db.execute(sql.raw(`INSERT INTO listings_owned (listingId, ownerId, title, description, category, listingType, priceCents, stock, \`condition\`, imageData, auctionEndAt, reserveThresholdCents, minimumIncrementCents, lifecycle) VALUES ('${listingId}', ${demo.id}, '${title}', 'Demo listing for the MerchantHub marketplace.', '${category}', '${listingType}', ${priceCents}, 1, 'Like new', NULL, ${listingType === "Buy now" ? "NULL" : "DATE_ADD(NOW(), INTERVAL 7 DAY)"}, ${listingType === "Buy now" ? "NULL" : Math.round(priceCents * 0.8)}, ${listingType === "Buy now" ? "NULL" : 1000}, 'official')`));
      return res.json({ ok: true, message: "Demo marketplace reset complete.", preservedAccounts: [ADMIN_EMAIL, RIDER_EMAIL] });
    } catch (error) { console.error("[Admin] Demo reset failed", error); const detail = (error as any)?.cause?.message || (error as any)?.sqlMessage || (error instanceof Error ? error.message : String(error)); return res.status(500).json({ ok: false, error: `Demo reset failed: ${detail}` }); }
  });
}

export { ADMIN_EMAIL };
