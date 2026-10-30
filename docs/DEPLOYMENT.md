# Deploying RentEase (Cloudflare Workers + MongoDB Atlas)

Cloudflare Workers + R2 is the deployment target for this project. Use
`server/wrangler.jsonc` and `client/wrangler.jsonc`; the empty `versel.json` files
are legacy placeholders and are not deployment configuration.

### Product galleries and reviews

- Listings support **1–6 ordered photos**, each at most **2.5 MB** (JPEG, PNG or WebP).
  The first image is the cover used throughout the catalog. Shop owners can edit
  photos from Inventory; admins can edit them in the product dialog.
- Uploads remain on the same origin: the web Worker forwards `/api/*` and
  `/uploads/*` to the API. The API stores public product objects under `products/`
  in the environment's `MEDIA_BUCKET`. Do not use a Worker filesystem for uploads.
  R2 bindings provide persistent object storage ([Cloudflare documentation](https://developers.cloudflare.com/r2/get-started/workers-api/)).
- A full upload contains at most 15 MB of image bytes (about 20 MB after base64
  encoding), within Express's 22 MB JSON limit. Keep these limits aligned if they
  change. A Vercel Function has a [4.5 MB payload limit](https://vercel.com/docs/functions/limitations),
  so moving this API there requires a different upload flow.
- Existing `photos` arrays and `/uploads/products/<uuid>` paths remain compatible;
  no product data migration is required. Copy existing local files into R2 using
  the migration steps below before switching the frontend to the hosted API.
- Both `/api/public/reviews/product/:id` and `/api/reviews/product/:id` return
  `reviews`, an all-review `summary` with a five-star `distribution`, and
  `pagination`. Supported query parameters: `page` (starting at 1), `rating`
  (1–5, optional), and `sort` (`newest`, `highest`, `lowest`). Pages contain 10
  reviews. Only customer-to-owner reviews contribute to these public summaries.
  The existing completed-rental and one-review-per-rental rules still apply.

Before rollout, run `npm test`, `npm run build`, and `npm run test:worker`.
The Worker smoke test uses temporary MongoDB and local R2 to publish three
photos, retrieve them, change the cover, remove a photo, and check the review API.
Deploy the API before the web app, then check these steps in **staging**:

1. Publish a listing with photos added in separate selections; verify all are kept.
2. Change the cover and remove a photo. Reload and verify the gallery and catalog.
3. Try thumbnails, arrows, swipe, fullscreen, zoom, keyboard navigation, and Escape.
4. Complete a test rental, submit a review from My rentals, and verify the public
   star breakdown, rating filters, sorting, and pagination.

The production payment provider is still `sandbox` and real payments are not
connected. Production intentionally rejects simulated payments unless explicitly
enabled; configure a real provider before accepting paid customer bookings.

```
Browser ──► rentease-web  (Worker + static assets: client/dist, SPA fallback)
              │  /api/*, /uploads/*  (service binding, same origin - no CORS)
              ▼
            rentease-api  (Worker: server/src/worker.mjs)
              ├─ GET /uploads/products/* ──► R2 "media" bucket (public photos)
              └─ everything else ──► Durable Object "ApiServer" (one instance)
                                       Express app + Mongoose ──► MongoDB Atlas
                                       private R2 "identity" bucket, Images binding
                                       alarm: delivery dispatch · cron: retention
```

| Environment | Web Worker             | API Worker             | R2 buckets                                            | Deployed by               |
| ----------- | ---------------------- | ---------------------- | ----------------------------------------------------- | ------------------------- |
| staging     | `rentease-web-staging` | `rentease-api-staging` | `rentease-media-staging`, `rentease-identity-staging` | every push to `main`      |
| production  | `rentease-web`         | `rentease-api`         | `rentease-media`, `rentease-identity`                 | published release, manual |

## How the Node server maps onto Workers

| On Node (`npm run start-dev`)              | On Cloudflare Workers                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.listen()` on a port                   | Express runs inside the `ApiServer` Durable Object via `cloudflare:node`. A Durable Object can keep the Atlas connection pool open across requests; a plain Worker cannot. |
| `server/uploads/products` on disk          | R2 media bucket, served by the Worker with immutable caching. Stored URLs are unchanged (`/uploads/products/<uuid>.<ext>`).                       |
| `server/private/identity-v2` on disk       | Private R2 identity bucket (same AES-256-GCM encryption, same keys).                                                                            |
| `sharp` for identity photos                | Cloudflare Images binding (`src/worker/cloudflare-images.mjs`), same validation rules.                                                           |
| 3-second dispatch `setInterval`            | Durable Object alarm, every 3 s while any delivery is still searching, re-armed by requests and a 5-minute cron.                                 |
| `npm run identity:retention`               | Daily cron (20:30 UTC). Dry run unless `IDENTITY_RETENTION_PURGE` is `"apply"` in `server/wrangler.jsonc`.                                     |
| SMTP port 465                              | Port 587 (STARTTLS). nodemailer could not open implicit-TLS 465 from workerd in testing.                                                         |

Local development on Node is unchanged; the Node defaults (disk, sharp) are swapped
only by the Worker (`src/worker/platform.mjs`).

## One-time setup

### 1. MongoDB Atlas

1. Create a project and a cluster. Pick the region closest to your users. Use one cluster
   per environment (or at least a separate database name per environment).
   Transactions need a replica set, which every Atlas cluster is.
2. **Database Access**: add a user with *Read and write to any database* (or scoped to the
   RentEase database), with a long generated password.
3. **Network Access**: add `0.0.0.0/0`. Workers and GitHub Actions do not have fixed egress
   IP addresses, so an IP allow-list cannot be narrower. Rely on the strong per-environment
   database password, and rotate it if it leaks.
4. **Connect → Drivers**: copy the `mongodb+srv://…` string and add the database name, for example
   `mongodb+srv://rentease:<password>@cluster0.xxxxx.mongodb.net/rentease?retryWrites=true&w=majority`.
   That is the environment's `MONGO_URI`.
5. Set `API_LOCATION_HINT` in `server/wrangler.jsonc` to the Durable Object region nearest the
   cluster: `apac` (Mumbai/Singapore), `weur`, `enam`, `wnam`, `oc`, `sam`, `afr`, `me`.
   It only takes effect when the Durable Object is first created.

### 2. Cloudflare

1. Use the **Workers Paid** plan. Password hashing (bcrypt) and photo uploads need far more
   CPU per request than the Free plan allows.
2. Create the R2 buckets once (`npx wrangler login` first, or set `CLOUDFLARE_API_TOKEN`):

   ```sh
   cd server
   for bucket in rentease-media-staging rentease-identity-staging rentease-media rentease-identity; do
     npx wrangler r2 bucket create "$bucket"
   done
   ```

   Keep the identity buckets private: never enable public access or an r2.dev URL on them.
3. Make sure **Images** is enabled for the account (dashboard → Images). The binding is only
   used for identity photo uploads, and 5,000 unique transformations a month are included.
4. Create an API token (**My Profile → API Tokens → Create token → "Edit Cloudflare Workers"**
   template). Note your **Account ID** and your `*.workers.dev` subdomain (Workers & Pages → Overview).

### 3. GitHub

Create two Environments under **Settings → Environments**: `staging` and `production`.
Give `production` **required reviewers** so production deploys wait for an approval.
Protect `main` and require the `CI` checks to pass on pull requests.

Generate the random secrets once per environment and keep a backup somewhere safe.
Changing `IDENTITY_ENCRYPTION_KEY` makes stored identity photos unreadable, and changing
`IDENTITY_HASH_KEY` breaks duplicate-NIC detection.

```sh
npm --prefix server run secrets:generate > staging.secrets.env   # git-ignored
# edit staging.secrets.env: fill in MONGO_URI, SMTP_*, ADMIN_EMAIL, GEOAPIFY_API_KEY
# and delete any line you leave empty
gh secret set --env staging -f staging.secrets.env
rm staging.secrets.env
# repeat with production.secrets.env / --env production
```

Per environment:

| Name                                             | Kind     | Required | Purpose                                                                    |
| ------------------------------------------------ | -------- | -------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`  | secret   | yes      | Lets the workflow deploy (can also be repository secrets).                  |
| `APP_URL`                                        | variable | yes      | Public URL used for the post-deploy smoke test, e.g. `https://rentease-web-staging.<subdomain>.workers.dev`. |
| `MONGO_URI`                                      | secret   | yes      | Atlas connection string for this environment.                              |
| `SESSION_SECRET`, `OTP_SECRET`                   | secret   | yes      | Session and OTP signing keys.                                              |
| `IDENTITY_ENCRYPTION_KEY`, `IDENTITY_HASH_KEY`   | secret   | yes      | Base64 32-byte identity keys (see warning above).                          |
| `RENTAL_OTP_SECRET`                              | secret   | no       | Dedicated pickup/return OTP key.                                           |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`            | secret   | for email| Gmail: your address, an app password, `RentEase <you@gmail.com>`.          |
| `ADMIN_EMAIL`                                    | secret   | no       | Signing in with this email promotes the account to administrator.          |
| `GEOAPIFY_API_KEY`                               | secret   | no       | Server-side routing key.                                                   |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | secret | no | SMS notifications.                                                  |
| `VITE_GEOAPIFY_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY` | secret | no      | Browser keys baked into the web build (restrict them to `APP_URL`).        |
| `VITE_GOOGLE_MAPS_MAP_ID`                        | variable | no       | Google Maps map ID.                                                        |

Non-secret settings (`SMTP_HOST`, `SMTP_PORT`, `PAYMENT_PROVIDER`, retention, pool size, …) live
in the `vars` of each environment in `server/wrangler.jsonc`. The deploy workflow uploads only
the non-empty secrets above. Secrets already on a Worker are never deleted by a deploy.

### 4. First deploy and first administrator

Push to `main` (or run **Actions → Deploy → Run workflow → staging**). The workflow runs CI,
deploys the API, then the web app, and checks that `APP_URL/api/health` reports
`"database":"connected"`. Then register in the app with the `ADMIN_EMAIL` address and sign in;
the account is promoted to administrator. Alternatively, from your own terminal (it prompts for
the password): `cd server && MONGO_URI="<atlas uri>" ADMIN_EMAIL=you@example.com node scripts/createAdmin.mjs`.

To serve production from your own domain, add the domain to Cloudflare and uncomment the
`routes` entry in `client/wrangler.jsonc`.

## Day to day

- **Pull request** → `CI`: client lint + tests + build, server tests, both Worker bundles
  (`wrangler deploy --dry-run`), and `npm run test:worker`, which boots the API on the real
  Workers runtime against a throwaway MongoDB replica set.
- **Merge to `main`** → CI, then deploy to **staging**.
- **Publish a GitHub release** (or run *Deploy* manually with `production`) → CI, approval, then
  deploy to **production**.
- **Roll back**: `npx wrangler rollback --env production` in `server/` and in `client/`, or
  re-run *Deploy* manually on the previous release tag.
- **Database migrations**: *Actions → Database maintenance* runs `inspect-db`,
  `migrate-handovers` or `migrate-identity` against an environment's Atlas cluster. They are dry
  runs unless *apply* is ticked.
- **Logs**: `npx wrangler tail --env production` in `server/` (or the dashboard; observability is enabled).

You can also deploy from your machine: `npm run deploy:staging` at the repository root
(after `npx wrangler login`). Secrets must already be set on the Worker
(`npx wrangler secret bulk staging.secrets.env --env staging` in `server/`).

## Local development

- **Node (unchanged)**: `npm run dev:server` and `npm run dev:client`.
- **Workers runtime**: in `server/`, copy `.dev.vars.example` to `.dev.vars` (or rely on
  `server/.env`, which `wrangler dev` reads when there is no `.dev.vars`) and run
  `npm run dev:worker` (port 8787, local R2 and Durable Object state in `.wrangler/`). Then run the
  client with `API_PROXY_TARGET=http://localhost:8787` in `client/.env`.
- **Smoke test**: `npm run test:worker`. On Windows, if the MongoDB download is slow, point it at
  an installed server: `MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"`.

## Moving existing local data

```sh
mongodump --uri "mongodb://127.0.0.1:27017/rentease" --out dump
mongorestore --uri "<atlas MONGO_URI without the database name>" dump

cd server   # product photos keep their /uploads/products/<file> URLs
for f in uploads/products/*; do
  npx wrangler r2 object put "rentease-media/products/$(basename "$f")" --file "$f" --remote
done
# Identity photos only stay readable with the SAME IDENTITY_ENCRYPTION_KEY as before.
for f in private/identity-v2/*.bin; do
  npx wrangler r2 object put "rentease-identity/identity-v2/$(basename "$f")" --file "$f" --remote
done
```

## Capacity notes

All API traffic shares one Durable Object, which is single-threaded and keeps one MongoDB pool
(`MONGO_MAX_POOL_SIZE`, default 2: Workers allow six outbound connections in flight and the
driver also keeps three Atlas monitoring sockets). That suits a launch-sized marketplace; watch CPU time and
request latency in the dashboard as traffic grows. Server-sent delivery events share one set of
change streams per collection, so open dashboards do not add database connections.
