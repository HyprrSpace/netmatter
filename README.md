# netmatter — multi-node MTR monitor

Distributed network-path monitor. A lightweight **agent** runs [`mtr`](https://github.com/traviscross/mtr)
on each of your nodes and writes per-hop packet-loss/latency to a **central InfluxDB 3 Core**
database. A purpose-built **Next.js + shadcn dashboard** visualizes packet loss over time,
per node and per hop. The official InfluxDB 3 Explorer UI is available optionally for ad-hoc SQL.

```
  node A ─┐   (mtr + writer, --net=host)
  node B ─┼──HTTP:8181 (token)──►  influxdb3-core ──►  Next.js dashboard  :3000
  node C ─┘                         [central server, one host]   (Explorer :8080 optional)
```

Every point carries a **`node`** tag, so data from all nodes lands in one database and stays
separable.

![netmatter dashboard](.github/img/screenshot1.png)

## Architecture

| Role      | Runs                                    | Where                | Image |
|-----------|-----------------------------------------|----------------------|-------|
| Server    | InfluxDB 3 Core (`influxdb:3-core`)     | one central host     | official |
| Agent     | Alpine: `mtr` + `agent.py` writer       | every monitored node | `ghcr.io/hyprrspace/netmatter-agent` |
| Dashboard | Next.js + shadcn charts                 | central host, :3000  | `ghcr.io/hyprrspace/netmatter-dashboard` |

### Data schema
Single measurement **`mtr`**:
- **Tags:** `node`, `destination`, `hop` (hop is `NN-host`, zero-padded so >9 hops sort right)
- **Fields:** `loss`, `snt`, `last`, `avg`, `best`, `wrst`, `stdev`

Prebuilt agent and dashboard images are published to GHCR by CI on every push to `main`
(and on version tags) — see [`.github/workflows/build-images.yml`](.github/workflows/build-images.yml).
The agent image is multi-arch (`amd64` + `arm64`).

---

## 1. Set up the central server

On the central host (in `server/`):

```bash
cd server
docker compose up -d influxdb3

# Create an admin token — it is shown ONCE, save it somewhere safe:
docker compose exec influxdb3 influxdb3 create token --admin

# Create the database (or let the first agent write auto-create it):
docker compose exec influxdb3 influxdb3 create database mtr --token <apiv3_...>

# Point the dashboard at the token and start it:
echo "INFLUX_TOKEN=<apiv3_...>" > .env
docker compose up -d dashboard
```

Then open the dashboard at **http://&lt;server&gt;:3000**.

Optionally start the InfluxDB 3 Explorer UI for ad-hoc SQL:
`docker compose --profile explorer up -d explorer` → **http://&lt;server&gt;:8080**
(connect it to `http://influxdb3:8181` with the token + database `mtr`).

> **InfluxDB 3 Core note:** Core has no compaction and limits each query to a ~72h range —
> ideal for recent connectivity, not long-term trend history. For full history switch the
> `influxdb3` image to `influxdb:3-enterprise` (free for at-home/non-production use);
> nothing else changes.

---

## 2. Run an agent on each node

Use the published image (or build locally from `agent/`):

```bash
docker run -d --name mtr-agent --restart=unless-stopped \
  --net=host --cap-add=NET_RAW \
  -e INFLUX_HOST=http://<server>:8181 \
  -e INFLUX_TOKEN=apiv3_... \
  -e INFLUX_DATABASE=mtr \
  -e NODE_NAME=$(hostname) \
  -e MTR_HOSTS=8.8.8.8,reddit.com,facebook.com \
  ghcr.io/hyprrspace/netmatter-agent:latest
```

- `--cap-add=NET_RAW` lets `mtr` open raw sockets.
- `--net=host` gives the container the node's real routing and identity.
- To build locally instead: `docker build -t mtr-agent ./agent`.

### Agent configuration (env vars)

| Variable          | Default            | Meaning                               |
|-------------------|--------------------|---------------------------------------|
| `INFLUX_HOST`     | `http://localhost:8181` | Central InfluxDB 3 URL           |
| `INFLUX_TOKEN`    | *(required)*       | Admin/write token (`apiv3_...`)       |
| `INFLUX_DATABASE` | `mtr`              | Target database                       |
| `NODE_NAME`       | container hostname | Value of the `node` tag               |
| `MTR_HOSTS`       | `8.8.8.8`          | Comma-separated destinations to probe |
| `MTR_CYCLES`      | `30`               | Pings per mtr report                  |
| `INTERVAL`        | `40`               | Seconds between rounds                |

---

## 3. The dashboard

Charts packet **loss over time** — `y(x) = loss(time)` — as filled, colored area lines.
The InfluxDB token stays server-side in the `/api/*` route handlers; the browser never sees it.

**Filters**
- **Destination** — single-select (loss/hop paths are only coherent within one destination).
- **Time range** — 15m / 1h / 3h / 6h / 24h / 72h.
- **Node** — multiselect, or **All**.
- **Hop mode** — **Per hop** (one filled line per hop; pick which via the **Hops** multiselect,
  or **All**; a single hop for a single-hop view), **Average all hops**, or **Max all hops**.
- With >1 node selected, series split and are labelled `node · hop`. Auto-refreshes every 30s.

### Run the dashboard locally (bun)

```bash
cd dashboard
bun install
cp .env.example .env.local      # set INFLUX_TOKEN (and INFLUX_HOST if not localhost)
bun dev                         # http://localhost:3000
```

Server-side env vars: `INFLUX_HOST` (default `http://localhost:8181`), `INFLUX_TOKEN`
(required), `INFLUX_DATABASE` (default `mtr`).

### Ad-hoc SQL

The store is plain SQL (Explorer UI or `influxdb3 query`):

```sql
-- packet loss by node for a destination, last hour
SELECT node, hop, avg(loss) AS loss
FROM mtr
WHERE destination = '8.8.8.8' AND time > now() - INTERVAL '1 hour'
GROUP BY node, hop
ORDER BY node, hop;
```

---

## Repository layout

| Path        | What                                                                 |
|-------------|---------------------------------------------------------------------|
| `agent/`    | `mtr` probe + InfluxDB 3 writer (`agent.py`), Alpine `Dockerfile`.   |
| `server/`   | `docker-compose.yml` — InfluxDB 3 + dashboard (+ optional Explorer). |
| `dashboard/`| Next.js + shadcn UI; `app/api/*` query InfluxDB, `components/*` chart. |
| `.github/`  | CI that builds & pushes the agent and dashboard images to GHCR.     |

## Requirements
- Docker on the central host and on each agent node.
- `mtr` and the Python writer are bundled in the agent image — nothing to install on nodes.
- The dashboard runs on the central host (Docker `dashboard` service, or `bun dev` locally).
