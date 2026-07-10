# MTR Monitor dashboard

Next.js + shadcn/ui dashboard for the multi-node MTR monitor. Charts **packet loss
over time** — `y(x) = loss(time)` — with filled, colored area lines, querying the
central InfluxDB 3 Core over its SQL API. The InfluxDB token stays server-side (in the
`/api/*` route handlers); the browser never sees it.

## Filters

- **Destination** — single-select (loss/hop paths are only coherent within one destination).
- **Time range** — 15m / 1h / 3h / 6h / 24h / 72h (bounded by InfluxDB 3 Core's ~72h window).
- **Node** — multiselect, or **All**.
- **Hop mode**:
  - **Per hop** — one filled colored line per hop (use the **Hops** multiselect to pick
    which hops, or **All**; select a single hop for a single-hop view).
  - **Average all hops** — one line = mean loss across hops.
  - **Max all hops** — one line = worst-hop loss.
- When more than one node is selected, series are split and labelled `node · hop`.

Data auto-refreshes every 30s.

## Run locally (bun)

```bash
cd dashboard
bun install
cp .env.example .env.local      # then set INFLUX_TOKEN (and INFLUX_HOST if not localhost)
bun dev                         # http://localhost:3000
```

Environment (server-side only):

| Variable          | Default                  | Meaning                        |
|-------------------|--------------------------|--------------------------------|
| `INFLUX_HOST`     | `http://localhost:8181`  | Central InfluxDB 3 URL         |
| `INFLUX_TOKEN`    | *(required)*             | Admin or read token (`apiv3_…`)|
| `INFLUX_DATABASE` | `mtr`                    | Database name                  |

## Run with Docker

Built as a standalone Next server. The stack compose file (`server/docker-compose.yml`)
includes it as the `dashboard` service:

```bash
cd server
echo "INFLUX_TOKEN=apiv3_..." > .env
docker compose up -d influxdb3 dashboard   # dashboard on :3000
```

## How it works

- `app/api/meta` — returns the filter vocabulary (destinations; nodes/hops per destination).
- `app/api/series` — builds a `date_bin`-bucketed SQL query (per-hop or avg/max aggregation),
  returns time-bucketed rows pivoted into one series per line.
- `components/loss-dashboard.tsx` — filter bar + Recharts area chart (shadcn `chart`).
- `components/multi-select.tsx` — popover multiselect (empty selection = "All").
