import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { shippingLabels } from "../drizzle/schema";

type ShippingLabel = {
  labelId: string;
  orderId: string;
  tracking: string;
  carrier: string;
  service: string;
  destination: string;
  packageType: string;
  weightKg: number;
  createdAt: string;
  svg: string;
};

const labels = new Map<string, ShippingLabel>();
const KNOWN_ORDER_IDS = new Set(["MH-2841", "MH-2840", "MH-2837", "MH-2835", "MH-2829", "MH-2823"]);
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[character] ?? character));

const barcode = (tracking: string) => tracking.split("").map((character, index) => {
  const width = character.charCodeAt(0) % 3 === 0 ? 4 : character.charCodeAt(0) % 2 === 0 ? 2 : 1;
  return `<rect x="${24 + index * 7}" y="174" width="${width}" height="54" fill="#182329"/>`;
}).join("");

const createSvg = (label: ShippingLabel) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="816" height="1056" viewBox="0 0 816 1056">
  <rect width="816" height="1056" fill="#fffefb"/>
  <rect x="24" y="24" width="768" height="1008" rx="18" fill="#fffefb" stroke="#182329" stroke-width="3"/>
  <text x="48" y="82" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#182329">MerchantHub</text>
  <text x="48" y="112" font-family="Arial, sans-serif" font-size="13" letter-spacing="2" fill="#2d9c8b">AUTOMATED SHIPPING LABEL</text>
  <line x1="48" y1="142" x2="768" y2="142" stroke="#e8e4da" stroke-width="2"/>
  <text x="48" y="184" font-family="Arial, sans-serif" font-size="13" fill="#65706e">SHIP TO</text>
  <text x="48" y="220" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#182329">${escapeXml(label.destination)}</text>
  <text x="48" y="254" font-family="Arial, sans-serif" font-size="15" fill="#65706e">Order ${escapeXml(label.orderId)} · ${escapeXml(label.service)}</text>
  <rect x="48" y="282" width="720" height="68" rx="10" fill="#e9f6f2"/>
  <text x="70" y="312" font-family="Arial, sans-serif" font-size="12" fill="#2d9c8b">TRACKING NUMBER</text>
  <text x="70" y="338" font-family="Arial, sans-serif" font-size="23" font-family="monospace" font-weight="700" fill="#182329">${escapeXml(label.tracking)}</text>
  <text x="48" y="402" font-family="Arial, sans-serif" font-size="13" fill="#65706e">CARRIER</text>
  <text x="48" y="434" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#182329">${escapeXml(label.carrier)}</text>
  <text x="330" y="402" font-family="Arial, sans-serif" font-size="13" fill="#65706e">PACKAGE</text>
  <text x="330" y="434" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#182329">${escapeXml(label.packageType)} · ${label.weightKg.toFixed(1)} kg</text>
  <rect x="48" y="480" width="720" height="280" fill="#fff" stroke="#e8e4da"/>
  ${barcode(label.tracking)}
  <text x="408" y="274" text-anchor="middle" font-family="Arial, sans-serif" font-size="1" fill="#fff">.</text>
  <text x="408" y="272" text-anchor="middle" font-family="monospace" font-size="1" fill="#fff">.</text>
  <text x="408" y="786" text-anchor="middle" font-family="monospace" font-size="22" letter-spacing="5" fill="#182329">${escapeXml(label.tracking)}</text>
  <line x1="48" y1="842" x2="768" y2="842" stroke="#e8e4da" stroke-width="2"/>
  <text x="48" y="884" font-family="Arial, sans-serif" font-size="13" fill="#65706e">GENERATED</text>
  <text x="48" y="914" font-family="Arial, sans-serif" font-size="17" fill="#182329">${escapeXml(new Date(label.createdAt).toLocaleString("en-PH"))}</text>
  <text x="48" y="972" font-family="Arial, sans-serif" font-size="12" fill="#9aa39f">Keep this label visible and attach it flat to the widest side of the parcel.</text>
</svg>`;

export const registerShippingRoutes = (app: Express) => {
  app.post("/api/shipping/labels", async (req: Request, res: Response) => {
    const orderId = String(req.body?.orderId ?? "").trim();
    const destination = String(req.body?.destination ?? "").trim().slice(0, 100);
    const carrier = String(req.body?.carrier ?? "").trim().slice(0, 80);
    const service = String(req.body?.service ?? "").trim().slice(0, 80);
    const packageType = String(req.body?.packageType ?? "").trim().slice(0, 60);
    const weightKg = Number(req.body?.weightKg);
    if (!KNOWN_ORDER_IDS.has(orderId) || !destination || !carrier || !service || !packageType || !Number.isFinite(weightKg) || weightKg <= 0) {
      return res.status(400).json({ ok: false, error: "recognized orderId, destination, carrier, service, packageType, and positive weightKg are required" });
    }
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const labelId = `LBL-${Date.now().toString(36).toUpperCase()}`;
    const carrierCode = carrier.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2).padEnd(2, "X");
    const tracking = `MHX-${carrierCode}-${suffix}`;
    const label: ShippingLabel = { labelId, orderId, tracking, carrier, service, destination, packageType, weightKg: Math.round(weightKg * 10) / 10, createdAt: new Date().toISOString(), svg: "" };
    label.svg = createSvg(label);
    const db = await getDb();
    if (db) {
      try {
        await db.insert(shippingLabels).values({
          labelId: label.labelId,
          orderId: label.orderId,
          tracking: label.tracking,
          carrier: label.carrier,
          service: label.service,
          destination: label.destination,
          packageType: label.packageType,
          weightGrams: Math.round(label.weightKg * 1000),
        });
      } catch (error) {
        console.error("[Shipping] Label persistence failed", error);
        return res.status(503).json({ ok: false, error: "Shipping label storage is temporarily unavailable" });
      }
    }
    labels.set(labelId, label);
    return res.json({ ok: true, labelId, orderId, tracking, carrier, service, destination, packageType, weightKg: label.weightKg, createdAt: label.createdAt, labelUrl: `/api/shipping/labels/${labelId}` });
  });

  app.get("/api/shipping/labels/:labelId", async (req, res) => {
    let label = labels.get(req.params.labelId);
    if (!label) {
      const db = await getDb();
      const row = db ? (await db.select().from(shippingLabels).where(eq(shippingLabels.labelId, req.params.labelId)).limit(1))[0] : undefined;
      if (row) {
        label = { ...row, weightKg: row.weightGrams / 1000, createdAt: row.createdAt.toISOString(), svg: "" };
        label.svg = createSvg(label);
        labels.set(label.labelId, label);
      }
    }
    if (!label) return res.status(404).send("Label not found");
    res.type("image/svg+xml").set("Cache-Control", "no-store").send(label.svg);
  });
};
