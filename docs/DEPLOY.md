# Deploying

One VPS runs the whole platform: the admin, the commerce core, the agent, and
every storefront, as one Node process behind Caddy. Caddy terminates TLS for
the admin host, the storefront subdomains and every custom domain a store
verifies. There is no build step and no second service to run.

## What you need

- A Linux VPS with Docker and Docker Compose (2 GB of RAM is plenty).
- A domain you control, with three records pointing at the server's IP:
  - `admin.yourbrand.com` (A) — the admin.
  - `*.stores.yourbrand.com` (A, wildcard) — one subdomain per store.
  - `edge.stores.yourbrand.com` (A) — what customers' custom domains CNAME to.
- Ports 80 and 443 open.
- An Anthropic or OpenAI key, or both. Without one the platform still runs,
  on its rules writers, and the admin says so on every page.

## First run

```sh
git clone <this repo> amboras && cd amboras
cp .env.example .env         # fill in AMBORAS_SECRET, the hosts, ACME_EMAIL and a model key
docker compose up -d --build
docker compose exec app node --disable-warning=ExperimentalWarning src/seed.ts   # optional demo store
```

Open `https://admin.yourbrand.com`. The first visit issues the certificate;
register, type one sentence, and the store exists at
`https://<slug>.stores.yourbrand.com`.

State is one sqlite file plus uploads in the `app_data` volume. Backing up
is copying that volume; restoring is copying it back.

## How custom domains get their certificate

The Domains page tells the owner the exact records for their registrar. When
the owner presses **Check**, the app looks the name up; when it verifies as
hosted, the app records it and, from that moment, answers `200` at
`/_edge/tls-ask?domain=<name>`. Caddy asks that endpoint before issuing any
certificate on demand, so:

- a verified custom domain gets a certificate on its first HTTPS visit, with
  no step in the admin;
- a stranger pointing a random name at the server gets nothing, because the
  app answers `404` for names it does not serve;
- the admin host and the storefront root's subdomains are always cleared.

"ssl: issued" on the Domains page means the name is cleared and Caddy issues
on first visit; it is not a certificate stored in the app.

Forwarded domains (the registrar redirects to the store's platform address)
never need a certificate here; the registrar serves the redirect.

## Updating

```sh
git pull && docker compose up -d --build
```

Migrations run on boot. Interrupted agent runs are recovered on boot.

## Running on Railway

The same image runs on [Railway](https://railway.com) with no Caddy: Railway's
edge terminates TLS, forwards the scheme in `X-Forwarded-Proto`, and issues
certificates for whatever domains you attach to the service. `railway.json`
in the repo tells it to build the `Dockerfile`, poll `/healthz` before
switching traffic, and restart on failure.

1. **Create the service** from this repo (dashboard: New Project → Deploy from
   GitHub repo; or `railway init` then `railway up` from a checkout). The
   first build runs before the variables exist, so it may fail its health
   check once; that is fine.
2. **Attach a volume** (right-click the service → Add Volume) mounted at
   `/app/data`. The sqlite file and every upload live there; without it the
   database is thrown away on every deploy.
3. **Set the variables** on the service:

   | Variable | Value |
   |---|---|
   | `AMBORAS_SECRET` | a long random string, generated once (`openssl rand -hex 32`) |
   | `AMBORAS_DB` | `/app/data/amboras.db` |
   | `PORT` | `4100`, the same port the Dockerfile exposes, so there is no guessing which one the edge targets |
   | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | the writers; optional, the rules writers stand in without one |

   Leave `AMBORAS_ADMIN_HOST`, `AMBORAS_STOREFRONT_HOST` and
   `AMBORAS_PUBLIC_ORIGIN` unset to begin with. `AMBORAS_PUBLIC_ORIGIN`
   defaults to `https://` + the `RAILWAY_PUBLIC_DOMAIN` Railway injects, so
   emails and ad links carry the right address from the first boot.
4. **Generate a domain** (Settings → Networking → Generate Domain) or attach
   your own. Redeploy. Open the URL, register, type one sentence: the store
   answers at `https://<your-domain>/s/<slug>`.

Optional demo store, once the volume is attached:

```sh
railway ssh -- node --disable-warning=ExperimentalWarning src/seed.ts
```

### Subdomains and custom domains on Railway

Without a storefront host, every store is a path under the admin's domain
(`/s/<slug>`), which is enough to build, test and sell. For one hostname per
store:

- Attach `admin.yourbrand.com` and the wildcard `*.stores.yourbrand.com` to
  the service as custom domains (Railway shows the CNAME records to add; a
  wildcard needs the extra verification record it lists, and must not be
  proxied through Cloudflare's orange cloud). Then set
  `AMBORAS_ADMIN_HOST=admin.yourbrand.com`,
  `AMBORAS_STOREFRONT_HOST=stores.yourbrand.com` and
  `AMBORAS_PUBLIC_ORIGIN=https://admin.yourbrand.com`, and redeploy.
- A merchant's own domain (the **host** mode on the Domains page) needs its
  certificate from Railway, not from the app: add that hostname to the
  service as another custom domain after the Domains page verifies it. The
  on-demand issuance that Caddy does through `/_edge/tls-ask` has no
  equivalent on Railway, so this step is manual, once per domain. **Forward**
  mode needs nothing on Railway; the registrar serves the redirect.
- Set `AMBORAS_EDGE_HOST` to the hostname you tell registrars to CNAME to
  (a name that itself CNAMEs to the Railway service works); leave
  `AMBORAS_EDGE_IP` empty, Railway does not give a fixed IP.

### Updating on Railway

Every push to the connected branch builds and deploys; the health check
keeps the old container serving until the new one answers `/healthz`.
Migrations run on boot against the file in the volume. Backing up is a
volume snapshot in the dashboard, or copying `/app/data` out over
`railway ssh`.

## Running without Docker

`node --version` must be 22.18 or newer.

```sh
npm ci
cp .env.example .env && set -a && . ./.env && set +a
npm run seed
npm start                    # http://localhost:4100
```

Put any reverse proxy that terminates TLS in front of port 4100. If it is not
Caddy with on-demand TLS, custom domains need their certificates arranged
there; the `/_edge/tls-ask` endpoint is available to whatever fronts the
process.

## Environment

See `.env.example`. The ones that matter in production:

| Variable | Why |
|---|---|
| `AMBORAS_SECRET` | Every password hash, sealed credential and visitor fingerprint depends on it. Generate a long random string once and never change it. |
| `AMBORAS_ADMIN_HOST` | The hostname Caddy issues the admin certificate for. |
| `AMBORAS_STOREFRONT_HOST` | Stores answer at `<slug>.<this>`. |
| `AMBORAS_EDGE_HOST`, `AMBORAS_EDGE_IP` | What the Domains page tells registrars to point at. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | The writers. `AMBORAS_TEXT_PROVIDER` picks the default family when both are set; model ids are `AMBORAS_MODEL` and `AMBORAS_OPENAI_MODEL`. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Image re-shoots with GPT Image 2 and Gemini 3 Pro Image. |
| `RESEND_API_KEY`, `AMBORAS_EMAIL_DOMAIN` | Transactional email actually sends. |
| `META_AD_LIBRARY_TOKEN` | The Ads tab searches the Meta Ad Library. |
| `AMBORAS_META_API_VERSION` | Graph API version for Meta CAPI; defaults to `v25.0`. Pixel IDs and sealed Meta/TikTok server tokens are configured per store in Settings. |
