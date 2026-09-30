# MerchantHub: GitHub and Render Deployment Outline

## Current project assessment

MerchantHub is currently a **full-stack Node application**:

- Frontend: React 19 + Vite + Tailwind
- Backend: Express + tRPC plus additional Express routes
- Database: MySQL through Drizzle ORM
- Payments: Stripe Checkout and Stripe webhooks
- Storage: Manus Forge/S3-compatible storage helper
- Package manager: pnpm 10.18.0
- Current production entrypoint: `dist/index.js`
- Current container entrypoint: `node dist/index.js`

The existing `Dockerfile` is suitable for Render. **Render is the recommended deployment target for the current application** because it can build and run the existing long-lived Express server without converting the backend to serverless functions.

## Recommended production architecture

### Recommended deployment: Render

- Deploy the complete Dockerized application to Render using the committed `render.yaml` Blueprint.
- Keep MySQL on a managed provider.
- Configure Stripe webhook delivery to the backend URL.

This is the lowest-risk route because it preserves the current Express route registration, raw Stripe webhook handling, cookies, uploads, and long-running server behavior.

### Optional later architecture: Vercel frontend

The Vite frontend can be separated and hosted on Vercel later, with the Render service remaining the API/backend. This requires configuring the frontend API origin and carefully testing cross-origin cookies.

### Not recommended now: all-Vercel deployment

Convert the backend to Vercel Functions before production:

1. Create a Vercel function entrypoint under `api/`.
2. Adapt each Express route or mount a carefully tested serverless-compatible handler.
3. Preserve raw request bytes for `/api/stripe/webhook` so Stripe signature verification remains valid.
4. Replace server startup/listening logic with request-handler exports.
5. Confirm database connection reuse across warm invocations.
6. Configure Vercel rewrites for `/api/*` and the Vite SPA fallback.
7. Test authentication cookies, file uploads, webhook retries, and all API routes in a preview deployment.

This option is possible but is not a settings-only change. The current `server/_core/index.ts` calls `server.listen()` and creates an HTTP server, which is not the deployment contract for Vercel Functions.

## Render deployment steps

1. Open the Render dashboard and choose **New → Blueprint**.
2. Connect the public GitHub repository `jerro26pablo-cell/merchanthubmanus`.
3. Select the `main` branch. Render detects the committed `render.yaml`.
4. Review the `merchanthub` web service and keep the Docker runtime.
5. Enter the `DATABASE_URL`, Manus, and Stripe values prompted by Render.
6. Apply the Blueprint and wait for the Docker build to finish.
7. Open the generated `onrender.com` URL and verify `/api/health` returns `{"status":"ok"}`.
8. Run the Drizzle migrations against the production MySQL database:

   ```bash
   pnpm db:migrate
   ```

9. The Docker startup command runs `pnpm db:migrate` before starting the app, which initializes the schema on the free Render plan.
10. Configure the Stripe webhook endpoint as `https://<your-render-host>/api/stripe/webhook`.
11. Test registration, login, listings, checkout, webhook processing, and storage before sharing the URL.

The Blueprint generates secure values for `MANUS_JWT_SECRET` and `SESSION_SECRET`. It intentionally prompts for database, storage, Manus, and Stripe values instead of committing them to GitHub.

## GitHub repository preparation

### Files to commit

- `client/`
- `server/`
- `shared/`
- `drizzle/`
- `assets/`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `Dockerfile`
- `README.md`
- `.gitignore`
- `.env.example`
- `docs/github-vercel-deployment.md`
- `render.yaml`

### Files and values not to commit

- `.env` and all environment-specific files
- API keys, Stripe secrets, database URLs, JWT/session secrets
- `node_modules/`, `dist/`, and runtime logs
- `.manus-logs/` and other local debugging output
- Any production database dump

The archive has no `.git` directory, so the GitHub repository must be initialized from this project directory.

## Required security cleanup before publishing

`server/appAuth.ts` currently contains demo credentials in source code:

- `admin@gmail.com` / `admin123`
- `rider@gmail.com` / `rider123`

Before making the repository public or deploying production:

1. Remove the passwords from source code.
2. Create admin/rider accounts through a controlled seed or one-time setup flow.
3. Store any bootstrap credentials in a secret manager, never in Git.
4. Rotate `MANUS_JWT_SECRET` or `SESSION_SECRET` before production.
5. Review the frontend for demo-only user data and credentials before launch.

## Environment variables

The application currently references these runtime variables:

| Variable | Used for | Required |
|---|---|---:|
| `DATABASE_URL` | MySQL/Drizzle database connection | Yes |
| `MANUS_JWT_SECRET` | Platform/session signing | Yes for secure auth |
| `SESSION_SECRET` | Legacy fallback session signing | Use only as fallback |
| `MANUS_PROJECT_ID` | Platform project identity | Only if Manus features are used |
| `MANUS_OAUTH_API_URL` | Manus OAuth | Only if Manus OAuth is used |
| `OWNER_OPEN_ID` | Owner role fallback | Optional |
| `MANUS_API_URL` | Manus Forge storage API | Required for current storage helper |
| `MANUS_API_KEY` | Manus Forge storage authentication | Required for current storage helper |
| `STRIPE_SECRET_KEY` | Stripe Checkout | Required for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | Required for webhooks |
| `NODE_ENV` | Runtime mode | Set to `production` in production |
| `PORT` | Container listener port | Container deployment only; host supplies it when applicable |

Use the included `.env.example` as the variable-name checklist. Put real values in Render environment settings, not GitHub.

## Local verification before the first push

From the repository root:

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

The current build produces:

- frontend files under `dist/public/`
- bundled backend entrypoint at `dist/index.js`

The current container deployment then starts `node dist/index.js`.

## GitHub setup sequence

```bash
git init
git add .
git commit -m "Initial MerchantHub application"
git branch -M main
git remote add origin https://github.com/<account>/<repository>.git
git push -u origin main
```

Recommended branches:

- `main`: production-ready code
- `feature/*`: individual changes and pull requests
- Optional `develop`: integration branch if multiple contributors are involved

## Optional Vercel frontend sequence

1. Import the repository into Vercel.
2. Set the project root to the frontend location if the frontend is deployed separately; otherwise use a dedicated frontend branch or workspace.
3. Set the framework preset to Vite.
4. Set the build command to `pnpm build:static`.
5. Set the output directory to `dist/public` if the project is built from the repository root.
6. Add the frontend API base URL pointing to the deployed Express backend.
7. Configure SPA fallback so direct client-side routes resolve to `index.html`.
8. Deploy a Preview environment.
9. Verify API calls, auth cookies, payments, and direct routes.
10. Promote the verified build to Production.

The static Vite build alone is not a complete MerchantHub deployment because the application depends on `/api/*` routes and the database.

## Render acceptance checklist

- Homepage loads from the Render URL.
- Client-side routes work after a direct refresh.
- Frontend requests reach the backend without CORS or cookie errors.
- `GET /api/health` returns a successful response from the backend.
- Registration, login, logout, and session restoration work.
- MySQL migrations have been applied to the production database.
- Stripe Checkout uses production/test keys intentionally selected for the environment.
- Stripe webhook signature verification succeeds at the public HTTPS endpoint.
- Storage upload and download paths work.
- No secrets or demo passwords appear in the repository or browser bundle.
- Render environment variables are configured separately from GitHub.

## Suggested GitHub issues

1. **Repository hardening** — remove demo credentials, add `.env.example`, exclude debug logs.
2. **Production configuration** — define database, session, storage, and Stripe environment variables.
3. **Render deployment** — deploy the current Dockerfile using `render.yaml` and verify `/api/health`.
4. **Optional Vercel frontend deployment** — publish the Vite build and configure API origin/SPA fallback.
5. **Database migration** — apply checked-in Drizzle migrations to managed MySQL.
6. **Stripe verification** — configure webhook endpoint and test success/failure/retry flows.
7. **Production security review** — review authentication, CORS/cookies, uploads, rate limits, and secrets.
8. **Optional all-Vercel migration** — convert Express routes to Vercel-compatible function handlers.
