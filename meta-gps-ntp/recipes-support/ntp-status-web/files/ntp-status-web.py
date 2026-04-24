#!/usr/bin/env python3

import copy
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse

STATIC_ROOT = "/usr/share/ntp-status-web"
SAMPLE_INTERVAL_SECONDS = float(os.environ.get("NTP_STATUS_SAMPLE_INTERVAL", "1.0"))

STATUS_LOCK = threading.Lock()
STATUS_CACHE = {}


def load_static_file(name):
    path = os.path.join(STATIC_ROOT, name)
    with open(path, "rb") as f:
        return f.read()


def run_cmd(cmd, timeout=3):
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            check=False,
        )
        return (result.returncode == 0, (result.stdout or "").strip())
    except (OSError, subprocess.TimeoutExpired) as exc:
        return (False, str(exc))


def is_process_running(name):
    ok, _ = run_cmd(["pidof", name], timeout=1)
    return ok


def is_udp_port_open(port):
    needle = f":{port:04X}"
    for path in ("/proc/net/udp", "/proc/net/udp6"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()[1:]
        except OSError:
            continue

        for line in lines:
            parts = line.split()
            if len(parts) < 4:
                continue
            local = parts[1]
            state = parts[3]
            if local.endswith(needle) and state == "07":
                return True
    return False


def parse_chrony_kv(text):
    metrics = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        norm_key = key.strip().lower().replace(" ", "_")
        metrics[norm_key] = value.strip()
    return metrics


def parse_chrony_sources_status(sources_text):
    selected_source = None
    pps_seen = False
    pps_selected = False

    for raw_line in sources_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if len(line) < 2 or line[0] not in "^=#":
            continue

        mode = line[0]
        sel = line[1]
        body = line[2:].strip()
        source_name = body.split()[0] if body else "unknown"

        is_pps = "PPS" in source_name.upper() or " PPS" in line.upper()
        if is_pps:
            pps_seen = True

        if sel == "*":
            selected_source = source_name
            if is_pps:
                pps_selected = True

    return {
        "selected_source": selected_source,
        "pps_seen": pps_seen,
        "pps_selected": pps_selected,
    }


def gps_snapshot():
    ok, output = run_cmd(["gpspipe", "-w", "-n", "10"], timeout=5)
    if not ok:
        return {
            "tpv": None,
            "sky": None,
            "summary": None,
            "satellites": [],
        }

    latest_tpv = None
    latest_sky = None

    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        cls = obj.get("class")
        if cls == "TPV":
            latest_tpv = obj
        elif cls == "SKY":
            latest_sky = obj

    satellites = []
    summary = None
    if latest_sky:
        sky_sats = latest_sky.get("satellites") or []
        used = 0
        signal_values = []
        for sat in sky_sats:
            if sat.get("used"):
                used += 1
            ss = sat.get("ss")
            if isinstance(ss, (int, float)):
                signal_values.append(float(ss))

            satellites.append(
                {
                    "prn": sat.get("PRN"),
                    "gnssid": sat.get("gnssid"),
                    "svid": sat.get("svid"),
                    "used": bool(sat.get("used")),
                    "ss": ss,
                    "el": sat.get("el"),
                    "az": sat.get("az"),
                }
            )

        satellites.sort(key=lambda s: (not s["used"], -(s["ss"] or -1)))

        summary = {
            "satellites_total": len(sky_sats) if sky_sats else latest_sky.get("nSat"),
            "satellites_used": used if sky_sats else latest_sky.get("uSat"),
            "avg_signal": round(sum(signal_values) / len(signal_values), 2) if signal_values else None,
            "max_signal": max(signal_values) if signal_values else None,
            "min_signal": min(signal_values) if signal_values else None,
            "gdop": latest_sky.get("gdop"),
            "pdop": latest_sky.get("pdop"),
            "hdop": latest_sky.get("hdop"),
            "vdop": latest_sky.get("vdop"),
            "tdop": latest_sky.get("tdop"),
            "xdop": latest_sky.get("xdop"),
            "ydop": latest_sky.get("ydop"),
            "nSat": latest_sky.get("nSat"),
            "uSat": latest_sky.get("uSat"),
        }

    return {
        "tpv": latest_tpv,
        "sky": latest_sky,
        "summary": summary,
        "satellites": satellites,
    }


def collect_status_payload():
    chrony_running = is_process_running("chronyd")
    gpsd_running = is_process_running("gpsd")

    _, tracking = run_cmd(["chronyc", "-n", "tracking"], timeout=2)
    _, sources = run_cmd(["chronyc", "-n", "sources", "-v"], timeout=2)
    _, sourcestats = run_cmd(["chronyc", "-n", "sourcestats", "-v"], timeout=2)
    _, serverstats = run_cmd(["chronyc", "-n", "serverstats"], timeout=2)
    source_status = parse_chrony_sources_status(sources)
    tracking_metrics = parse_chrony_kv(tracking)

    gps = gps_snapshot() if gpsd_running else {"tpv": None, "sky": None, "summary": None, "satellites": []}

    payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "chrony": {
            "running": chrony_running,
            "tracking": tracking,
            "tracking_metrics": tracking_metrics,
            "sources": sources,
            "sourcestats": sourcestats,
            "serverstats": serverstats,
            "server_metrics": parse_chrony_kv(serverstats),
            "source_status": {
                **source_status,
                "pps_locked": bool(source_status["pps_selected"] or "PPS" in str(tracking_metrics.get("reference_id", "")).upper()),
            },
        },
        "ntp_server": {
            "udp_123_open": is_udp_port_open(123),
        },
        "gpsd": {
            "running": gpsd_running,
            "socket_present": os.path.exists("/var/run/gpsd.sock"),
            "tpv": gps["tpv"],
            "sky": gps["sky"],
            "summary": gps["summary"],
            "satellites": gps["satellites"],
        },
    }
    return payload


def warmup_payload():
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "chrony": {
            "running": False,
            "tracking": "",
            "tracking_metrics": {},
            "sources": "",
            "sourcestats": "",
            "serverstats": "",
            "server_metrics": {},
            "source_status": {
                "selected_source": None,
                "pps_seen": False,
                "pps_selected": False,
                "pps_locked": False,
            },
        },
        "ntp_server": {
            "udp_123_open": False,
        },
        "gpsd": {
            "running": False,
            "socket_present": False,
            "tpv": None,
            "sky": None,
            "summary": None,
            "satellites": [],
        },
        "sampler_error": "warming up",
    }


def update_cached_status(payload):
    with STATUS_LOCK:
        STATUS_CACHE.clear()
        STATUS_CACHE.update(payload)


def sampler_loop():
    interval = max(0.2, SAMPLE_INTERVAL_SECONDS)
    while True:
        try:
            payload = collect_status_payload()
            update_cached_status(payload)
        except Exception as exc:
            with STATUS_LOCK:
                if not STATUS_CACHE:
                    STATUS_CACHE.update(warmup_payload())
                STATUS_CACHE["timestamp_utc"] = datetime.now(timezone.utc).isoformat()
                STATUS_CACHE["sampler_error"] = str(exc)
        time.sleep(interval)


def get_status_payload():
    with STATUS_LOCK:
        if STATUS_CACHE:
            return copy.deepcopy(STATUS_CACHE)
    return warmup_payload()


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/", "/index.html"):
            try:
                body = load_static_file("index.html")
            except OSError:
                self.send_error(500, "index.html not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/styles.css":
            try:
                body = load_static_file("styles.css")
            except OSError:
                self.send_error(404, "styles.css not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/css; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/app.js":
            try:
                body = load_static_file("app.js")
            except OSError:
                self.send_error(404, "app.js not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/status":
            body = json.dumps(get_status_payload(), indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(404)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"not found\n")

    def log_message(self, fmt, *args):
        return


def main():
    host = os.environ.get("NTP_STATUS_WEB_HOST", "0.0.0.0")
    port = int(os.environ.get("NTP_STATUS_WEB_PORT", "80"))

    # Prime cache once before handling requests.
    try:
        update_cached_status(collect_status_payload())
    except Exception:
        with STATUS_LOCK:
            STATUS_CACHE.clear()
            STATUS_CACHE.update(warmup_payload())

    sampler = threading.Thread(target=sampler_loop, name="ntp-status-sampler", daemon=True)
    sampler.start()

    server = ThreadedHTTPServer((host, port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
