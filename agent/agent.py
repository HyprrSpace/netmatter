#!/usr/bin/env python3
"""Multi-node MTR agent.

Runs `mtr` against a set of destinations on a loop and writes per-hop
loss/latency stats to a central InfluxDB 3 database, tagged with this node's
name so data from multiple nodes stays separable.

Configuration is entirely via environment variables (see get_config)."""
import datetime as dt
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time

from influxdb_client_3 import InfluxDBClient3, Point

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("mtr-agent")

MEASUREMENT = "mtr"


def get_config():
    hosts = [h.strip() for h in os.environ.get("MTR_HOSTS", "8.8.8.8").split(",") if h.strip()]
    return {
        "influx_host": os.environ.get("INFLUX_HOST", "http://localhost:8181"),
        "influx_token": os.environ.get("INFLUX_TOKEN", ""),
        "influx_database": os.environ.get("INFLUX_DATABASE", "mtr"),
        "node": os.environ.get("NODE_NAME") or socket.gethostname(),
        "hosts": hosts,
        "cycles": int(os.environ.get("MTR_CYCLES", "30")),
        "interval": int(os.environ.get("INTERVAL", "40")),
    }


def run_mtr(destination, cycles):
    """Run mtr against a destination and return the parsed JSON report."""
    result = subprocess.run(
        ["mtr", "--report", "--json", "--report-cycles", str(cycles), destination],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def hop_label(hub):
    """Zero-pad the hop count so >9 hops sort lexically (matches legacy format).

    mtr's JSON reports `count` as an int in newer versions and a string in
    older ones, so normalise to int before formatting.
    """
    return f"{int(hub['count']):02d}-{hub['host']}"


def build_points(node, report, report_time):
    """Turn one mtr JSON report into a list of InfluxDB points."""
    destination = report["report"]["mtr"]["dst"]
    points = []
    for hub in report["report"]["hubs"]:
        point = (
            Point(MEASUREMENT)
            .tag("node", node)
            .tag("destination", destination)
            .tag("hop", hop_label(hub))
            .field("loss", float(hub["Loss%"]))
            .field("snt", int(hub["Snt"]))
            .field("last", float(hub["Last"]))
            .field("avg", float(hub["Avg"]))
            .field("best", float(hub["Best"]))
            .field("wrst", float(hub["Wrst"]))
            .field("stdev", float(hub["StDev"]))
            .time(report_time)
        )
        points.append(point)
    return points


def probe_destination(client, node, destination, cycles):
    """Probe one destination and write its report. Runs in its own thread."""
    try:
        report_time = dt.datetime.now(dt.timezone.utc)
        report = run_mtr(destination, cycles)
        points = build_points(node, report, report_time)
        client.write(record=points)
        log.info("wrote %d hops for %s", len(points), destination)
    except subprocess.CalledProcessError as exc:
        log.error("mtr failed for %s: %s", destination, exc.stderr.strip())
    except Exception as exc:  # noqa: BLE001 - keep the loop alive on any single failure
        log.error("failed to probe %s: %s", destination, exc)


def main():
    cfg = get_config()
    if not cfg["influx_token"]:
        log.error("INFLUX_TOKEN is required")
        sys.exit(1)

    log.info(
        "starting mtr-agent node=%s hosts=%s -> %s db=%s interval=%ss cycles=%s",
        cfg["node"], cfg["hosts"], cfg["influx_host"],
        cfg["influx_database"], cfg["interval"], cfg["cycles"],
    )

    client = InfluxDBClient3(
        host=cfg["influx_host"],
        token=cfg["influx_token"],
        database=cfg["influx_database"],
    )

    try:
        while True:
            threads = [
                threading.Thread(
                    target=probe_destination,
                    args=(client, cfg["node"], destination, cfg["cycles"]),
                    daemon=True,
                )
                for destination in cfg["hosts"]
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            time.sleep(cfg["interval"])
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        client.close()


if __name__ == "__main__":
    main()
