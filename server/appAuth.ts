import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse } from "cookie";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "../drizzle/schema";

const SESSION_COOKIE = "merchant_hub_session";
const SESSION_SECRET = process.env.MANUS_JWT_SECRET ?? process.env.SESSION_SECRET ?? "merchant-hub-demo-session-secret";
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin123";
const RIDER_EMAIL = "rider@gmail.com";
const RIDER_PASSWORD = "rider123";
const PASSWORD_SECRET = process.env.PASSWORD_SECRET ?? "merchant-hub-password-secret-v1";
const LEGACY_PASSWORD_SECRETS = [process.env.MANUS_JWT_SECRET, process.env.SESSION_SECRET, "merchant-hub-demo-session-secret"].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
type SessionUser = { id: number; name: string; email: string; role: "user" | "admin" | "rider"; province?: string | null; municipality?: string | null; walletCents: number; storeName?: string | null; storeImage?: string | null; sellerEnabled: boolean; sellerApplicationStatus?: "none" | "pending" | "approved" | "denied" };

const hashPasswordWithSecret = (password: string, secret: string) => new Promise<string>((resolve, reject) => {
  crypto.scrypt(password, secret, 64, (error, derived) => {
    if (error) return reject(error);
    resolve(derived.toString("hex"));
  });
});
const hashPassword = (password: string) => hashPasswordWithSecret(password, PASSWORD_SECRET);

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

const isCanonicalAdmin = (user: { role: string; email?: string | null }) => user.role === "admin" && String(user.email ?? "").toLowerCase() === ADMIN_EMAIL;
const publicUser = (user: typeof users.$inferSelect): SessionUser => ({ id: user.id, name: user.name ?? user.email ?? "MerchantHub user", email: user.email ?? "", role: isCanonicalAdmin(user) ? "admin" : user.role === "admin" ? "user" : user.role, province: user.province, municipality: user.municipality, walletCents: user.walletCents, storeName: user.storeName, storeImage: user.storeImage, sellerEnabled: isCanonicalAdmin(user) || (Boolean(user.sellerEnabled) && user.sellerApplicationStatus === "approved"), sellerApplicationStatus: user.sellerApplicationStatus });

export async function getAppUser(req: Request): Promise<SessionUser | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const id = verifySession(parse(req.headers.cookie ?? "")[SESSION_COOKIE]);
  if (!id) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] && !result[0].deactivatedAt ? publicUser(result[0]) : undefined;
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
    if (row?.deactivatedAt) return res.status(403).json({ ok: false, error: "This account has been deactivated. Contact MerchantHub support." });
    if (!row?.passwordHash) return res.status(401).json({ ok: false, error: "Email or password is incorrect." });
    const currentHash = await hashPassword(plainPassword);
    let passwordMatches = safeEqual(currentHash, row.passwordHash);
    let usedLegacyHash = false;
    for (const legacySecret of LEGACY_PASSWORD_SECRETS) {
      if (!passwordMatches && safeEqual(await hashPasswordWithSecret(plainPassword, legacySecret), row.passwordHash)) { passwordMatches = true; usedLegacyHash = true; }
    }
    if (!passwordMatches) return res.status(401).json({ ok: false, error: "Email or password is incorrect." });
    if (usedLegacyHash && row.id) await db.update(users).set({ passwordHash: currentHash }).where(eq(users.id, row.id));
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
    await db.update(users).set({ storeName, storeImage, sellerEnabled: user.sellerEnabled ? 1 : 0, sellerApplicationStatus: user.sellerEnabled ? "approved" : "pending" }).where(eq(users.id, user.id));
    const row = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    return res.json({ ok: true, user: row ? publicUser(row) : user, applicationSubmitted: !user.sellerEnabled });
  });
  app.patch("/api/auth/profile", async (req, res) => {
    const user = await getAppUser(req); if (!user) return res.status(401).json({ ok: false, error: "Please log in." });
    const updates: Partial<typeof users.$inferInsert> = {};
    if (req.body?.name !== undefined && String(req.body.name).trim()) updates.name = String(req.body.name).trim().slice(0, 160);
    if (req.body?.email !== undefined && String(req.body.email).trim()) updates.email = String(req.body.email).trim().toLowerCase();
    if (req.body?.province !== undefined) updates.province = String(req.body.province).trim();
    if (req.body?.municipality !== undefined) updates.municipality = String(req.body.municipality).trim();
    if (req.body?.storeImage !== undefined) updates.storeImage = req.body.storeImage ? String(req.body.storeImage) : null;
    if (!Object.keys(updates).length) return res.status(400).json({ ok: false, error: "Add at least one profile change." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    await db.update(users).set(updates).where(eq(users.id, user.id));
    const row = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0]; return res.json({ ok: true, user: row ? publicUser(row) : user });
  });
  app.get("/api/admin/seller-applications", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(users).where(eq(users.sellerApplicationStatus, "pending"));
    return res.json({ ok: true, applications: rows.map((row) => ({ id: row.id, name: row.name, email: row.email, storeName: row.storeName, storeImage: row.storeImage, province: row.province, municipality: row.municipality, createdAt: row.createdAt })) });
  });
  app.patch("/api/admin/seller-applications/:userId", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const status = req.body?.status === "approved" ? "approved" : req.body?.status === "denied" ? "denied" : null;
    if (!status) return res.status(400).json({ ok: false, error: "Status must be approved or denied." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const targetId = Number(req.params.userId); const result = await db.update(users).set({ sellerApplicationStatus: status, sellerEnabled: status === "approved" ? 1 : 0 }).where(and(eq(users.id, targetId), eq(users.sellerApplicationStatus, "pending")));
    if (result[0]?.affectedRows === 0) return res.status(404).json({ ok: false, error: "Pending seller application not found." });
    return res.json({ ok: true, status });
  });
  app.get("/api/admin/users", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const rows = await db.select().from(users);
    return res.json({ ok: true, users: rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, storeName: row.storeName, sellerEnabled: Boolean(row.sellerEnabled), sellerApplicationStatus: row.sellerApplicationStatus, deactivatedAt: row.deactivatedAt, createdAt: row.createdAt })) });
  });
  app.patch("/api/admin/users/:userId/deactivate", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const targetId = Number(req.params.userId); if (!Number.isInteger(targetId) || targetId === user.id) return res.status(400).json({ ok: false, error: "Choose another user to deactivate." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const target = (await db.select().from(users).where(eq(users.id, targetId)).limit(1))[0]; if (!target || target.role === "admin") return res.status(404).json({ ok: false, error: "User cannot be deactivated." });
    await db.update(users).set({ deactivatedAt: new Date(), sellerEnabled: 0 }).where(eq(users.id, targetId));
    return res.json({ ok: true, deactivated: true });
  });
  app.patch("/api/admin/users/:userId/activate", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const targetId = Number(req.params.userId); if (!Number.isInteger(targetId) || targetId === user.id) return res.status(400).json({ ok: false, error: "Choose another user to activate." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    const target = (await db.select().from(users).where(eq(users.id, targetId)).limit(1))[0]; if (!target || !target.deactivatedAt || target.role === "admin") return res.status(404).json({ ok: false, error: "Deactivated user cannot be activated." });
    await db.update(users).set({ deactivatedAt: null, sellerEnabled: target.sellerApplicationStatus === "approved" ? 1 : 0 }).where(eq(users.id, targetId));
    return res.json({ ok: true, activated: true });
  });
  app.post("/api/admin/reset-demo", async (req, res) => {
    const user = await getAppUser(req); if ((!user || user.role !== "admin" || user.email.toLowerCase() !== ADMIN_EMAIL)) return res.status(403).json({ ok: false, error: "Admin access is required." });
    const db = await getDb(); if (!db) return res.status(503).json({ ok: false, error: "Database is not available yet." });
    try {
      await db.execute(sql.raw("DELETE FROM proxy_bids")); await db.execute(sql.raw("DELETE FROM commerce_orders")); await db.execute(sql.raw("DELETE FROM payment_orders")); await db.execute(sql.raw("DELETE FROM stripe_events")); await db.execute(sql.raw("DELETE FROM shipping_labels")); await db.execute(sql.raw("DELETE FROM notifications")); await db.execute(sql.raw("DELETE FROM messages")); await db.execute(sql.raw("DELETE FROM wishlists")); await db.execute(sql.raw("DELETE FROM rider_locations")); await db.execute(sql.raw("DELETE FROM listings_owned"));
      await db.execute(sql.raw("DELETE FROM users WHERE role NOT IN ('admin','rider')"));
      const demo = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
      if (!demo) return res.status(500).json({ ok: false, error: "Admin account could not be loaded." });
      await db.update(users).set({ storeName: "MerchantHub Operations Store", sellerEnabled: 1 }).where(eq(users.id, demo.id));
      return res.json({ ok: true, message: "Fresh marketplace reset complete.", preservedAccounts: [ADMIN_EMAIL, RIDER_EMAIL], listings: 0 });
    } catch (error) { console.error("[Admin] Demo reset failed", error); const detail = (error as any)?.cause?.message || (error as any)?.sqlMessage || (error instanceof Error ? error.message : String(error)); return res.status(500).json({ ok: false, error: `Demo reset failed: ${detail}` }); }
  });
}

export { ADMIN_EMAIL };
