# Echo Asset Manager

> AI-powered asset & portfolio management for ECHO Prime (v1.0.0). Track assets
> across organizations and locations, with categories, maintenance, valuations,
> and insurance — a Cloudflare Worker on D1 + KV.

Private to Echo Prime Technologies.

## Model

**Organizations** and **users** own **assets**, classified by **category** and
**location**. Each asset can carry **maintenance** records, **valuations** over
time, and **insurance** details. A **dashboard** summarizes the portfolio and
**export** produces a data dump.

## API

Auth: `X-Echo-API-Key`. Requests are rate-limited (KV) and inputs sanitized.
Each resource path responds to `GET` (list/read) and `POST` (create) — and to
`PUT`/`DELETE` on `/:id` where applicable.

| Route | Resource |
|---|---|
| `/` , `/health` | Service info / liveness |
| `/orgs` | Organizations |
| `/users` | Users |
| `/categories` | Asset categories |
| `/locations` | Asset locations |
| `/assets` | Assets (the core records) |
| `/maintenance` | Maintenance records |
| `/valuations` | Asset valuations |
| `/insurance` | Insurance details |
| `/dashboard` | Portfolio summary |
| `/export` | Data export |

## Bindings

`DB` (D1), `AM_CACHE` (KV), `ECHO_API_KEY`, plus service bindings
`ENGINE_RUNTIME`, `SHARED_BRAIN`, `EMAIL_SENDER` (declared in `wrangler.toml`).

## Develop

```bash
npm install
npx wrangler dev       # local Worker
npx wrangler deploy    # deploy
```

Secrets/bindings live in `wrangler.toml` / the Cloudflare dashboard — never commit them.

## License

Proprietary — © Echo Prime Technologies. All rights reserved.
