# MTR Monitor (multi-node)

Distributed network-path monitor. A lightweight **agent** runs `mtr` on each node and
writes per-hop loss/latency to a **central InfluxDB 3 Core** database. Data is visualized
with a purpose-built **Next.js + shadcn dashboard** (see [`dashboard/`](dashboard/)); the
official InfluxDB 3 Explorer UI is available optionally for ad-hoc SQL.

```
  node A ─┐   (mtr + writer, --net=host)
  node B ─┼──HTTP:8181 (token)──►  influxdb3-core ──►  Next.js dashboard  :3000
  node C ─┘                         [central server, one host]   (Explorer :8080 optional)
```

Every point carries a **`node`** tag, so data from all nodes lands in one database and stays
separable.

## Architecture

| Role      | Runs                                    | Where                |
|-----------|-----------------------------------------|----------------------|
| Server    | `influxdb3-core` + Next.js `dashboard`  | one central host     |
| Agent     | Alpine container: `mtr` + `agent.py`    | every monitored node |
| Dashboard | Next.js + shadcn charts (`dashboard/`)  | central host, :3000  |

### Data schema
Single measurement **`mtr`**:
- **Tags:** `node`, `destination`, `hop` (hop is `NN-host`, zero-padded so >9 hops sort right)
- **Fields:** `loss`, `snt`, `last`, `avg`, `best`, `wrst`, `stdev`

---

## 1. Set up the central server

On the central host (`server/`):

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

Then open the dashboard at **http://<server>:3000**.

Optionally start the official InfluxDB 3 Explorer UI for ad-hoc SQL:
`docker compose --profile explorer up -d explorer` → **http://<server>:8080**
(connect it to `http://influxdb3:8181` with the token + database `mtr`).

**Note on InfluxDB 3 Core:** Core has no compaction and each query is limited to a ~72h
range — ideal for recent connectivity, not long-term trend history. If you later need full
history, switch the `influxdb3` image to `influxdb:3-enterprise` (free for
at-home/non-production use); everything else stays the same.

---

## 2. Run an agent on each node

Build the image once (or push it to a registry your nodes can pull):

```bash
cd agent
docker build -t mtr-agent .
```

Run it on every node you want to monitor from:

```bash
docker run -d --name mtr-agent --restart=unless-stopped \
  --net=host --cap-add=NET_RAW \
  -e INFLUX_HOST=http://<server>:8181 \
  -e INFLUX_TOKEN=apiv3_... \
  -e INFLUX_DATABASE=mtr \
  -e NODE_NAME=$(hostname) \
  -e MTR_HOSTS=8.8.8.8,reddit.com,facebook.com \
  mtr-agent
```

- `--cap-add=NET_RAW` lets `mtr` open raw sockets.
- `--net=host` gives the container the node's real routing and identity.

### Agent configuration (env vars)

| Variable          | Default          | Meaning                                   |
|-------------------|------------------|-------------------------------------------|
| `INFLUX_HOST`     | `http://localhost:8181` | Central InfluxDB 3 URL              |
| `INFLUX_TOKEN`    | *(required)*     | Admin/write token (`apiv3_...`)           |
| `INFLUX_DATABASE` | `mtr`            | Target database                           |
| `NODE_NAME`       | container hostname | Value of the `node` tag                 |
| `MTR_HOSTS`       | `8.8.8.8`        | Comma-separated destinations to probe     |
| `MTR_CYCLES`      | `30`             | Pings per mtr report                      |
| `INTERVAL`        | `40`             | Seconds between rounds                    |

---

## 3. View the data

Open the dashboard at **http://<server>:3000**. It charts packet **loss over time** with
filters for destination, time range, node (multiselect / all), and hop — either one filled
colored line per hop, or an average/max-across-hops aggregate. See [`dashboard/`](dashboard/)
for details and local-dev instructions.

For ad-hoc queries the store is plain SQL (via the optional Explorer UI or `influxdb3 query`):

```sql
-- packet loss by node for a destination, last hour
SELECT node, hop, avg(loss) AS loss
FROM mtr
WHERE destination = '8.8.8.8' AND time > now() - INTERVAL '1 hour'
GROUP BY node, hop
ORDER BY node, hop;
```

## Requirements
- Docker on the central host and on each agent node.
- `mtr` and the Python writer are bundled in the agent image — nothing to install on nodes.
- The dashboard runs on the central host (Docker `dashboard` service, or `bun dev` locally).
