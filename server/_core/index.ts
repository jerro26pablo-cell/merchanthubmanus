import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerPaymentRoutes } from "../payments";
import { registerShippingRoutes } from "../shipping";
import { registerAppAuthRoutes } from "../appAuth";
import { registerBiddingRoutes } from "../bidding";
import { registerListingRoutes } from "../listings";
import { registerLogisticsRoutes } from "../logistics";
import { registerNotificationRoutes } from "../notifications";
import { registerMessageRoutes } from "../messages";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Stripe signatures must be verified against the exact raw request bytes.
  app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerPaymentRoutes(app);
  registerShippingRoutes(app);
  registerAppAuthRoutes(app);
  registerBiddingRoutes(app);
  registerListingRoutes(app);
  registerLogisticsRoutes(app);
  registerNotificationRoutes(app);
  registerMessageRoutes(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
