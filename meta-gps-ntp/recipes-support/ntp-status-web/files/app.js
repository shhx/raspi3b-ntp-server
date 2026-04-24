const byId = (id) => document.getElementById(id);
let lastMapLat = null;
let lastMapLon = null;
let leafletMap = null;
let leafletMarker = null;

function setState(id, label, level) {
  const el = byId(id);
  el.textContent = label;
  el.className = `state ${level}`;
}

function metricToNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function formatTimeValue(value) {
  if (value === null || value === undefined) return "n/a";
  const raw = String(value).trim();
  if (!raw) return "n/a";

  const num = metricToNumber(raw);
  if (num === null) return raw;

  const abs = Math.abs(num);
  if (abs >= 1) return `${num.toFixed(3)} s`;
  if (abs >= 1e-3) return `${(num * 1e3).toFixed(3)} ms`;
  if (abs >= 1e-6) return `${(num * 1e6).toFixed(3)} us`;
  if (abs >= 1e-9) return `${(num * 1e9).toFixed(3)} ns`;
  return `${(num * 1e12).toFixed(3)} ps`;
}

function formatMaybeTime(key, value) {
  if (value === null || value === undefined || value === "") return "n/a";
  if (/offset|dispersion|delay|clock|rms|interval|ept|eps|epc/i.test(key)) {
    return formatTimeValue(value);
  }
  return String(value);
}

function modeToFix(mode) {
  if (mode >= 3) return "3D Fix";
  if (mode >= 2) return "2D Fix";
  if (mode >= 1) return "Fix";
  return "No Fix";
}

function titleize(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderKvGrid(targetId, entries) {
  const root = byId(targetId);
  if (!root) return;
  root.innerHTML = "";

  entries.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "kv";
    const k = document.createElement("span");
    k.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value ?? "n/a";
    item.appendChild(k);
    item.appendChild(v);
    root.appendChild(item);
  });
}

function parseChronySources(text) {
  const rows = [];
  if (!text) return rows;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length < 2 || !"^=#".includes(trimmed[0])) continue;

    const mode = trimmed[0];
    const state = trimmed[1];
    const body = trimmed.slice(2).trim();
    const parts = body.split(/\s+/);
    const source = parts[0] || "unknown";
    const rest = parts.slice(1).join(" ");
    rows.push({ mode, state, source, details: rest });
  }
  return rows;
}

function selectionLabel(state) {
  if (state === "*") return "selected";
  if (state === "+") return "combined";
  if (state === "-") return "excluded";
  if (state === "?") return "unreachable";
  if (state === "x") return "falseticker";
  if (state === "~") return "variable";
  return "candidate";
}

function renderSources(targetId, sourcesText) {
  const root = byId(targetId);
  if (!root) return;

  const rows = parseChronySources(sourcesText);
  if (!rows.length) {
    root.textContent = "No sources reported";
    return;
  }

  root.innerHTML = "";
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "source-item";

    const title = document.createElement("strong");
    title.textContent = `${row.source} (${selectionLabel(row.state)})`;

    const details = document.createElement("div");
    details.className = "mini-meta";
    details.textContent = row.details || `mode ${row.mode}`;

    item.appendChild(title);
    item.appendChild(details);
    root.appendChild(item);
  });
}

function renderSatellites(targetId, gps) {
  const root = byId(targetId);
  if (!root) return;

  const sats = gps.satellites || (gps.sky && gps.sky.satellites) || [];
  if (!sats.length) {
    const total = gps.summary?.satellites_total ?? gps.sky?.nSat ?? "n/a";
    const used = gps.summary?.satellites_used ?? gps.sky?.uSat ?? "n/a";
    root.innerHTML = `<div class="mini-meta">No per-satellite list. Total: ${total}, Used: ${used}</div>`;
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Used</th>
        <th>PRN/SVID</th>
        <th>Signal (C/N0)</th>
        <th>Elevation</th>
        <th>Azimuth</th>
        <th>GNSS</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  sats.slice(0, 32).forEach((s) => {
    const used = Boolean(s.used);
    const id = s.prn ?? s.PRN ?? s.svid ?? "?";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="pill ${used ? "ok" : "off"}">${used ? "Yes" : "No"}</span></td>
      <td>${id}</td>
      <td>${s.ss ?? "-"}</td>
      <td>${s.el ?? "-"}</td>
      <td>${s.az ?? "-"}</td>
      <td>${s.gnssid ?? "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  root.innerHTML = "";
  root.appendChild(table);
}

function updateBadge(id, label, level = "ok") {
  setState(id, label ?? "n/a", level);
}

function renderNtpMetrics(tracking) {
  const entries = [
    ["Reference ID", tracking.reference_id || "n/a"],
    ["Stratum", tracking.stratum || "n/a"],
    ["Last Offset", formatMaybeTime("last_offset", tracking.last_offset)],
    ["RMS Offset", formatMaybeTime("rms_offset", tracking.rms_offset)],
    ["Root Delay", formatMaybeTime("root_delay", tracking.root_delay)],
    ["Root Dispersion", formatMaybeTime("root_dispersion", tracking.root_dispersion)],
    ["Update Interval", formatMaybeTime("update_interval", tracking.update_interval)],
    ["Frequency", tracking.frequency || "n/a"],
    ["Skew", tracking.skew || "n/a"],
    ["Leap Status", tracking.leap_status || "n/a"],
  ];
  renderKvGrid("ntp-metrics-grid", entries);
}

function renderServerStats(metrics) {
  const keys = Object.keys(metrics || {});
  if (!keys.length) {
    renderKvGrid("ntp-serverstats-grid", [["Status", "No server counters available"]]);
    return;
  }

  const entries = keys.slice(0, 18).map((key) => [titleize(key), formatMaybeTime(key, metrics[key])]);
  renderKvGrid("ntp-serverstats-grid", entries);
}

function renderGpsSummary(gps) {
  const summary = gps.summary || {};
  const tpv = gps.tpv || {};
  const mode = typeof tpv.mode === "number" ? tpv.mode : 0;

  const entries = [
    ["Fix", `${modeToFix(mode)} (mode=${mode})`],
    ["Satellites", `${summary.satellites_used ?? "n/a"} used / ${summary.satellites_total ?? "n/a"} total`],
    ["PDOP", summary.pdop ?? "n/a"],
    ["HDOP", summary.hdop ?? "n/a"],
    ["VDOP", summary.vdop ?? "n/a"],
    ["GDOP", summary.gdop ?? "n/a"],
  ];
  renderKvGrid("gps-summary-grid", entries);
}

function renderGpsPosition(tpv) {
  const entries = [
    ["Latitude", tpv?.lat ?? "n/a"],
    ["Longitude", tpv?.lon ?? "n/a"],
    ["Altitude (MSL)", tpv?.altMSL !== undefined ? `${tpv.altMSL} m` : tpv?.alt !== undefined ? `${tpv.alt} m` : "n/a"],
    ["Speed", tpv?.speed !== undefined ? `${tpv.speed} m/s` : "n/a"],
    ["Track", tpv?.track !== undefined ? `${tpv.track} deg` : "n/a"],
    ["Climb", tpv?.climb !== undefined ? `${tpv.climb} m/s` : "n/a"],
    ["Horizontal Error", tpv?.eph !== undefined ? `${tpv.eph} m` : "n/a"],
    ["Vertical Error", tpv?.epv !== undefined ? `${tpv.epv} m` : "n/a"],
    ["Time Error", formatMaybeTime("ept", tpv?.ept)],
  ];
  renderKvGrid("gps-position-grid", entries);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function ensureMap(lat, lon) {
  if (leafletMap) return true;
  if (typeof window.L === "undefined") return false;

  const mapNode = byId("gps-map");
  if (!mapNode) return false;

  leafletMap = window.L.map(mapNode, {
    zoomControl: true,
    attributionControl: true,
  }).setView([lat, lon], 15);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  leafletMarker = window.L.marker([lat, lon]).addTo(leafletMap);
  return true;
}

function updateMap(tpv) {
  const map = byId("gps-map");
  const meta = byId("gps-map-meta");
  if (!map || !meta) return;

  const lat = typeof tpv?.lat === "number" ? tpv.lat : null;
  const lon = typeof tpv?.lon === "number" ? tpv.lon : null;
  if (lat === null || lon === null) {
    meta.textContent = "Waiting for valid GPS coordinates...";
    return;
  }

  if (!ensureMap(lat, lon)) {
    meta.textContent = `Map engine unavailable. Position: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    return;
  }

  if (leafletMarker) {
    leafletMarker.setLatLng([lat, lon]);
  }

  const center = leafletMap.getCenter();
  const distFromCenter = distanceMeters(center.lat, center.lng, lat, lon);
  const recenterThresholdMeters = 250;
  if (distFromCenter > recenterThresholdMeters) {
    leafletMap.panTo([lat, lon], { animate: false });
  }

  let movedMeters = null;
  if (lastMapLat !== null && lastMapLon !== null) {
    movedMeters = distanceMeters(lastMapLat, lastMapLon, lat, lon);
  }

  lastMapLat = lat;
  lastMapLon = lon;

  if (movedMeters === null) {
    meta.textContent = `Position: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  } else {
    meta.textContent = `Position: ${lat.toFixed(6)}, ${lon.toFixed(6)} | movement: ${movedMeters.toFixed(1)} m`;
  }
}

async function refresh() {
  try {
    const res = await fetch("/status", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    setState("chrony-daemon", data.chrony.running ? "Running" : "Not Running", data.chrony.running ? "ok" : "bad");
    setState("ntp-server", data.ntp_server.udp_123_open ? "Listening" : "Not Listening", data.ntp_server.udp_123_open ? "ok" : "warn");
    setState("gpsd-daemon", data.gpsd.running ? "Running" : "Not Running", data.gpsd.running ? "ok" : "bad");

    const mode = data.gpsd.tpv && typeof data.gpsd.tpv.mode === "number" ? data.gpsd.tpv.mode : 0;
    setState("gps-fix", modeToFix(mode), mode >= 2 ? "ok" : "warn");

    const tracking = data.chrony.tracking_metrics || {};
    const sourceStatus = data.chrony.source_status || {};
    const offset = tracking.last_offset;
    const dispersion = tracking.root_dispersion;
    const rms = tracking.rms_offset;

    const absOffset = Math.abs(metricToNumber(offset) ?? 0);
    const absDispersion = Math.abs(metricToNumber(dispersion) ?? 0);
    const offsetLevel = absOffset > 0.1 ? "bad" : absOffset > 0.01 ? "warn" : "ok";
    const dispersionLevel = absDispersion > 1.0 ? "bad" : absDispersion > 0.1 ? "warn" : "ok";

    updateBadge("badge-offset", formatTimeValue(offset), offsetLevel);
    updateBadge("badge-dispersion", formatTimeValue(dispersion), dispersionLevel);
    updateBadge("badge-rms", formatTimeValue(rms), "ok");
    updateBadge("badge-pps", sourceStatus.pps_locked ? "Locked" : (sourceStatus.pps_seen ? "Visible, Not Selected" : "Not Seen"), sourceStatus.pps_locked ? "ok" : "warn");
    updateBadge("badge-source", sourceStatus.selected_source || "n/a", sourceStatus.selected_source ? "ok" : "warn");

    renderNtpMetrics(tracking);
    renderServerStats(data.chrony.server_metrics || {});
    renderGpsSummary(data.gpsd || {});
    renderSatellites("gps-satellites-table", data.gpsd || {});
    renderSources("chrony-sources-list", data.chrony.sources || "");
    renderGpsPosition(data.gpsd.tpv || {});
    updateMap(data.gpsd.tpv || {});
    byId("last-refresh").textContent = data.timestamp_utc || "n/a";
  } catch (err) {
    setState("chrony-daemon", "Unavailable", "bad");
    setState("ntp-server", "Unavailable", "bad");
    setState("gpsd-daemon", "Unavailable", "bad");
    setState("gps-fix", "Unavailable", "bad");
    updateBadge("badge-offset", "n/a", "bad");
    updateBadge("badge-dispersion", "n/a", "bad");
    updateBadge("badge-rms", "n/a", "bad");
    updateBadge("badge-pps", "n/a", "bad");
    updateBadge("badge-source", "n/a", "bad");
    renderKvGrid("ntp-metrics-grid", [["Error", String(err)]]);
    renderKvGrid("ntp-serverstats-grid", [["Status", "n/a"]]);
    renderKvGrid("gps-summary-grid", [["Status", "n/a"]]);
    renderKvGrid("gps-position-grid", [["Status", "n/a"]]);
    const sats = byId("gps-satellites-table");
    if (sats) sats.textContent = "n/a";
    const src = byId("chrony-sources-list");
    if (src) src.textContent = "n/a";
    const mapMeta = byId("gps-map-meta");
    if (mapMeta) mapMeta.textContent = "Map unavailable";
    byId("last-refresh").textContent = "n/a";
  }
}

refresh();
setInterval(refresh, 2000);
