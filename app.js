
/* London Life Map
   Google Maps basemap + live TfL Tube geometry.
   Data attribution: Transport for London.
*/

const GOOGLE_KEY_STORAGE = "london_map_google_key";
const TFL_CACHE_PREFIX = "london_tube_cache_v3_";
const TFL_CACHE_TTL = 24 * 60 * 60 * 1000;

const LONDON_CENTER = { lat: 51.5078, lng: -0.1277 };

const TUBE_LINES = [
  { id: "bakerloo", name: "Bakerloo", color: "#B36305" },
  { id: "central", name: "Central", color: "#E32017" },
  { id: "circle", name: "Circle", color: "#FFD300" },
  { id: "district", name: "District", color: "#00782A" },
  { id: "hammersmith-city", name: "Hammersmith & City", color: "#F3A9BB" },
  { id: "jubilee", name: "Jubilee", color: "#A0A5A9" },
  { id: "metropolitan", name: "Metropolitan", color: "#9B0056" },
  { id: "northern", name: "Northern", color: "#111111" },
  { id: "piccadilly", name: "Piccadilly", color: "#003688" },
  { id: "victoria", name: "Victoria", color: "#0098D4" },
  { id: "waterloo-city", name: "Waterloo & City", color: "#95CDBA" }
];

const PLACES = [
  { name: "Eastside Halls", lat: 51.49855, lng: -0.17435, category: "Home", color: "#64A8FF", anchor: true, note: "Home base — Prince's Gardens." },
  { name: "Imperial College London", lat: 51.49880, lng: -0.17490, category: "University", color: "#7F77FF", anchor: true, note: "South Kensington campus." },
  { name: "Ethos Sports Centre", lat: 51.49863, lng: -0.17619, category: "Sports", color: "#4AD3B4", note: "Imperial gym and pool." },
  { name: "Imperial College Health Centre", lat: 51.49913, lng: -0.17408, category: "Health", color: "#5FD780", note: "GP / NHS registration." },
  { name: "South Kensington Station", lat: 51.49407, lng: -0.17392, category: "Transport", color: "#FFD25A", anchor: true, note: "District, Circle and Piccadilly connections." },
  { name: "Boots — Gloucester Road", lat: 51.49454, lng: -0.18293, category: "Health", color: "#5FD780", note: "Pharmacy and everyday health supplies." },
  { name: "Waitrose — Gloucester Road", lat: 51.49421, lng: -0.18278, category: "Food", color: "#C38BFF", note: "Groceries near halls." },
  { name: "Argos — Cromwell Road", lat: 51.49491, lng: -0.18786, category: "Home", color: "#FFB15A", note: "Batteries, lamp, clock, mirror and room basics." },
  { name: "IKEA Hammersmith", lat: 51.49212, lng: -0.22442, category: "Home", color: "#FFB15A", note: "Big room-setup shop." },
  { name: "TK Maxx — Kensington", lat: 51.50123, lng: -0.19189, category: "Shopping", color: "#FF7B95", note: "Luggage, towels, clothes and room basics." },
  { name: "Decathlon — Kensington", lat: 51.49908, lng: -0.19893, category: "Sports", color: "#4AD3B4", note: "Waterproof / sports equipment." },
  { name: "Apple Brompton Road", lat: 51.49937, lng: -0.16362, category: "Tech", color: "#B8C1CD", note: "Apple support and accessories." },
  { name: "Paddington Station", lat: 51.51543, lng: -0.17541, category: "Transport", color: "#FFD25A", anchor: true, note: "Airport and rail hub." }
];

let map;
let trafficLayer;
let undergroundMode = false;
let activeMapType = "roadmap";
let linePolylines = [];
let stationOverlays = [];
let lineLabelOverlays = [];
let placeOverlays = [];
let stationRegistry = new Map();

const el = (id) => document.getElementById(id);

function setNetworkStatus(text, isError = false) {
  const node = el("network-status");
  node.textContent = text;
  node.classList.toggle("error-badge", isError);
}

function showModal(id) {
  el(id).classList.remove("hidden");
}

function hideModal(id) {
  el(id).classList.add("hidden");
}

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    window.__googleMapsReady = () => resolve();

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__googleMapsReady&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(script);

    setTimeout(() => {
      if (!window.google?.maps) reject(new Error("Google Maps did not initialize. Check the API key and Maps JavaScript API setup."));
    }, 15000);
  });
}

async function bootWithKey(key) {
  try {
    hideModal("key-modal");
    setNetworkStatus("Loading Google Maps…");
    await loadGoogleMaps(key);
    initOverlayClasses();
    initMap();
  } catch (err) {
    console.error(err);
    setNetworkStatus(err.message, true);
    showModal("key-modal");
  }
}

function initMap() {
  map = new google.maps.Map(el("map"), {
    center: LONDON_CENTER,
    zoom: 12.4,
    minZoom: 9,
    maxZoom: 21,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
    colorScheme: "DARK",
    renderingType: google.maps.RenderingType?.VECTOR,
    clickableIcons: false,
    gestureHandling: "greedy",
    fullscreenControl: false,
    streetViewControl: true,
    mapTypeControl: false,
    rotateControl: false,
    scaleControl: true,
    zoomControl: true,
    cameraControl: false,
    backgroundColor: "#0b1017"
  });

  trafficLayer = new google.maps.TrafficLayer();
  createPlaceMarkers();
  buildLegend();
  loadTubeNetwork();

  map.addListener("click", () => closeDetail());
  map.addListener("maptypeid_changed", () => {
    activeMapType = map.getMapTypeId();
  });

  setNetworkStatus("Loading Tube network…");
}

let HtmlOverlay;
let PlaceOverlay;
let StationNodeOverlay;
let LineLabelOverlay;

function initOverlayClasses() {
  HtmlOverlay = class HtmlOverlay extends google.maps.OverlayView {
    constructor(position, className) {
      super();
      this.position = position;
      this.className = className;
      this.div = null;
      this.visible = true;
    }

    onAdd() {
      this.div = document.createElement("div");
      this.div.className = this.className;
      this.getPanes().overlayMouseTarget.appendChild(this.div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
      this.div.style.display = this.visible ? "" : "none";
    }

    onRemove() {
      this.div?.remove();
      this.div = null;
    }

    setVisible(visible) {
      this.visible = visible;
      if (this.div) this.div.style.display = visible ? "" : "none";
    }
  }

  PlaceOverlay = class PlaceOverlay extends HtmlOverlay {
    constructor(place) {
      super({ lat: place.lat, lng: place.lng }, `place-marker ${place.anchor ? "anchor" : ""}`);
      this.place = place;
    }

    onAdd() {
      super.onAdd();
      this.div.innerHTML = `
        <div class="place-pin" style="background:${this.place.color}"></div>
        ${this.place.anchor ? `<div class="place-label">${escapeHtml(this.place.name)}</div>` : ""}
      `;
      this.div.addEventListener("click", (event) => {
        event.stopPropagation();
        showPlaceInfo(this.place);
      });
    }
  }

  StationNodeOverlay = class StationNodeOverlay extends HtmlOverlay {
    constructor(station, line, index, total) {
      super({ lat: station.lat, lng: station.lon }, "station-node");
      this.station = station;
      this.line = line;
      this.index = index;
      this.total = total;
    }

    onAdd() {
      super.onAdd();
      this.div.style.background = this.line.color;
      if (this.total > 1) this.div.classList.add("interchange");
      this.div.title = `${this.station.name} — ${this.line.name}`;
      this.div.addEventListener("click", (event) => {
        event.stopPropagation();
        showStationInfo(this.station);
      });
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;

      const spread = this.total > 1 ? Math.min(9, 4 + this.total * 0.75) : 0;
      const angle = this.total > 1 ? (Math.PI * 2 * this.index / this.total) - Math.PI / 2 : 0;
      const dx = Math.cos(angle) * spread;
      const dy = Math.sin(angle) * spread;
      this.div.style.left = `${point.x + dx}px`;
      this.div.style.top = `${point.y + dy}px`;
      this.div.style.transform = "translate(-50%, -50%)";
      this.div.style.display = this.visible ? "" : "none";
    }
  }

  LineLabelOverlay = class LineLabelOverlay extends HtmlOverlay {
    constructor(position, line) {
      super(position, "line-map-label");
      this.line = line;
    }

    onAdd() {
      super.onAdd();
      this.div.textContent = this.line.name;
      this.div.style.background = this.line.color;
      this.div.style.color = idealTextColor(this.line.color);
      if (this.line.id === "northern") this.div.style.borderColor = "#fff";
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
      this.div.style.transform = "translate(-50%, -50%)";
      this.div.style.display = this.visible ? "" : "none";
    }
  }

}

function createPlaceMarkers() {
  placeOverlays.forEach(o => o.setMap(null));
  placeOverlays = PLACES.map(place => {
    const overlay = new PlaceOverlay(place);
    overlay.setMap(map);
    return overlay;
  });
}

function buildLegend() {
  const legend = el("line-legend");
  legend.innerHTML = `<div class="legend-title">UNDERGROUND LINES</div>` +
    TUBE_LINES.map(line => `
      <div class="legend-row">
        <span class="legend-line" style="background:${line.color}; ${line.id === "northern" ? "border:1px solid #fff;" : ""}"></span>
        <span>${escapeHtml(line.name)}</span>
      </div>
    `).join("");
}

async function loadTubeNetwork(force = false) {
  clearTubeNetwork();
  stationRegistry = new Map();
  setNetworkStatus("Loading Tube geometry…");

  const results = await Promise.allSettled(
    TUBE_LINES.map(line => loadLine(line, force))
  );

  const good = results.filter(r => r.status === "fulfilled").map(r => r.value);
  const bad = results.length - good.length;

  good.forEach(data => ingestLineData(data));
  buildStationNodes();

  setUndergroundVisibility(undergroundMode);

  if (!good.length) {
    setNetworkStatus("Tube data unavailable — tap ⚙ to retry", true);
  } else if (bad) {
    setNetworkStatus(`Tube network loaded (${good.length}/${TUBE_LINES.length} lines)`);
  } else {
    setNetworkStatus("Tube network ready");
  }
}

async function loadLine(line, force = false) {
  const cacheKey = TFL_CACHE_PREFIX + line.id;
  if (!force) {
    const cached = getCache(cacheKey);
    if (cached) return { line, ...cached };
  }

  const seqUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.id)}/Route/Sequence/outbound?serviceTypes=Regular`;
  const stopsUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.id)}/StopPoints`;

  const [sequenceRes, stopsRes] = await Promise.all([
    fetch(seqUrl, { headers: { "Accept": "application/json" } }),
    fetch(stopsUrl, { headers: { "Accept": "application/json" } })
  ]);

  if (!sequenceRes.ok || !stopsRes.ok) {
    throw new Error(`TfL request failed for ${line.name}`);
  }

  const sequence = await sequenceRes.json();
  const stops = await stopsRes.json();

  const geometries = [];
  for (const encoded of (sequence.lineStrings || [])) {
    geometries.push(...parseLineString(encoded));
  }

  const simplified = {
    geometries,
    stops: (Array.isArray(stops) ? stops : []).map(stop => ({
      id: stop.id,
      name: stop.commonName || stop.name || "Station",
      lat: stop.lat,
      lon: stop.lon,
      modes: stop.modes || [],
      lines: (stop.lines || []).map(l => ({ id: l.id, name: l.name }))
    })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon))
  };

  setCache(cacheKey, simplified);
  return { line, ...simplified };
}

function parseLineString(encoded) {
  let parsed;
  try {
    parsed = typeof encoded === "string" ? JSON.parse(encoded) : encoded;
  } catch {
    return [];
  }

  const lines = [];

  function walk(node) {
    if (!Array.isArray(node) || !node.length) return;
    const looksLikePath =
      Array.isArray(node[0]) &&
      node[0].length >= 2 &&
      typeof node[0][0] === "number" &&
      typeof node[0][1] === "number";

    if (looksLikePath) {
      const path = node.map(pair => ({ lat: pair[1], lng: pair[0] }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (path.length >= 2) lines.push(path);
    } else {
      node.forEach(walk);
    }
  }

  walk(parsed);
  return lines;
}

function ingestLineData(data) {
  const { line, geometries, stops } = data;

  let longestPath = null;
  for (const path of geometries) {
    const polyline = new google.maps.Polyline({
      map,
      path,
      geodesic: false,
      strokeColor: line.color,
      strokeOpacity: 0.95,
      strokeWeight: line.id === "northern" ? 6 : 5,
      zIndex: line.id === "northern" ? 18 : 20,
      clickable: false,
      visible: undergroundMode
    });

    // White casing keeps the Northern line visible on the dark basemap.
    if (line.id === "northern") {
      const casing = new google.maps.Polyline({
        map,
        path,
        strokeColor: "#FFFFFF",
        strokeOpacity: 0.90,
        strokeWeight: 9,
        zIndex: 17,
        clickable: false,
        visible: undergroundMode
      });
      linePolylines.push(casing);
    }

    linePolylines.push(polyline);
    if (!longestPath || path.length > longestPath.length) longestPath = path;
  }

  if (longestPath?.length) {
    const labelPos = longestPath[Math.floor(longestPath.length * 0.52)];
    const label = new LineLabelOverlay(labelPos, line);
    label.setMap(map);
    label.setVisible(undergroundMode);
    lineLabelOverlays.push(label);
  }

  for (const stop of stops) {
    const key = stop.id || `${stop.lat.toFixed(5)},${stop.lon.toFixed(5)},${normalizeStationName(stop.name)}`;
    const existing = stationRegistry.get(key) || {
      id: stop.id,
      name: cleanStationName(stop.name),
      lat: stop.lat,
      lon: stop.lon,
      modes: new Set(stop.modes || []),
      lines: []
    };

    if (!existing.lines.some(l => l.id === line.id)) existing.lines.push(line);
    (stop.modes || []).forEach(m => existing.modes.add(m));
    stationRegistry.set(key, existing);
  }
}

function buildStationNodes() {
  stationOverlays.forEach(o => o.setMap(null));
  stationOverlays = [];

  for (const station of stationRegistry.values()) {
    const lines = station.lines.sort((a, b) => a.name.localeCompare(b.name));
    lines.forEach((line, index) => {
      const overlay = new StationNodeOverlay(station, line, index, lines.length);
      overlay.setMap(map);
      overlay.setVisible(undergroundMode);
      stationOverlays.push(overlay);
    });
  }
}

function clearTubeNetwork() {
  linePolylines.forEach(p => p.setMap(null));
  stationOverlays.forEach(o => o.setMap(null));
  lineLabelOverlays.forEach(o => o.setMap(null));
  linePolylines = [];
  stationOverlays = [];
  lineLabelOverlays = [];
}

function setUndergroundVisibility(visible) {
  undergroundMode = visible;
  linePolylines.forEach(p => p.setVisible(visible));
  stationOverlays.forEach(o => o.setVisible(visible));
  lineLabelOverlays.forEach(o => o.setVisible(visible));
  el("line-legend").classList.toggle("hidden", !visible);
  el("underground-btn").classList.toggle("active", visible);

  if (activeMapType === "roadmap") {
    map.setOptions({
      styles: visible ? UNDERGROUND_MAP_STYLES : []
    });
  }
}

const UNDERGROUND_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#0f151d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#687789" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f151d" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#29323d" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#10171f" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1d2631" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "simplified" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#26313e" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#071927" }] }
];

function showPlaceInfo(place) {
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">${escapeHtml(place.category.toUpperCase())}</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.note || "")}</div>
  `;
  openDetail();
}

async function showStationInfo(station) {
  const content = el("detail-content");
  const lines = station.lines || [];
  content.innerHTML = `
    <div class="detail-label">UNDERGROUND STATION</div>
    <h2>${escapeHtml(station.name)}</h2>
    <div class="chips">
      ${lines.map(line => `<span class="line-chip" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(line.name)}</span>`).join("")}
    </div>
    <div class="detail-section">
      <div class="detail-label">BUS INTEGRATION</div>
      <div id="bus-info" class="sub">Checking nearby bus stops…</div>
    </div>
  `;
  openDetail();

  try {
    const busStops = await fetchNearbyBusStops(station.lat, station.lon);
    const info = el("bus-info");
    if (!info) return;

    if (!busStops.length) {
      info.textContent = "No nearby TfL bus stops found within 250 m.";
      return;
    }

    const routes = [...new Set(
      busStops.flatMap(stop => (stop.lines || []).map(line => line.name || line.id)).filter(Boolean)
    )].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

    info.innerHTML = `
      <strong>${busStops.length}</strong> nearby bus stop${busStops.length === 1 ? "" : "s"} within 250 m.
      ${routes.length ? `<div class="bus-row">Routes: ${escapeHtml(routes.slice(0, 18).join(", "))}${routes.length > 18 ? "…" : ""}</div>` : ""}
    `;
  } catch (err) {
    console.warn(err);
    const info = el("bus-info");
    if (info) info.textContent = "Bus-stop information is temporarily unavailable.";
  }
}

async function fetchNearbyBusStops(lat, lon) {
  const url = new URL("https://api.tfl.gov.uk/StopPoint");
  url.searchParams.set("stopTypes", "NaptanPublicBusCoachTram");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("radius", "250");

  const res = await fetch(url);
  if (!res.ok) throw new Error("TfL bus stop request failed");
  const data = await res.json();
  const stops = Array.isArray(data) ? data : (data.stopPoints || []);
  return stops.filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
}

function openDetail() {
  el("detail-card").classList.remove("hidden");
  document.body.classList.add("detail-open");
}

function closeDetail() {
  el("detail-card").classList.add("hidden");
  document.body.classList.remove("detail-open");
}

function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.time || Date.now() - parsed.time > TFL_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  } catch (err) {
    console.warn("Tube cache unavailable", err);
  }
}

function clearTfLCache() {
  Object.keys(localStorage)
    .filter(key => key.startsWith(TFL_CACHE_PREFIX))
    .forEach(key => localStorage.removeItem(key));
}

function cleanStationName(name = "") {
  return name
    .replace(/\s+(Underground|DLR|Rail|Overground)\s+Station$/i, "")
    .replace(/\s+Station$/i, "")
    .trim();
}

function normalizeStationName(name = "") {
  return cleanStationName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function idealTextColor(hex) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 155 ? "#091018" : "#ffffff";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Controls */
el("roadmap-btn").addEventListener("click", () => {
  map?.setMapTypeId(google.maps.MapTypeId.ROADMAP);
  activeMapType = "roadmap";
  el("roadmap-btn").classList.add("active");
  el("satellite-btn").classList.remove("active");
  if (undergroundMode) map.setOptions({ styles: UNDERGROUND_MAP_STYLES });
});

el("satellite-btn").addEventListener("click", () => {
  map?.setMapTypeId(google.maps.MapTypeId.SATELLITE);
  activeMapType = "satellite";
  el("satellite-btn").classList.add("active");
  el("roadmap-btn").classList.remove("active");
});

el("traffic-btn").addEventListener("click", () => {
  if (!map) return;
  const active = !!trafficLayer.getMap();
  trafficLayer.setMap(active ? null : map);
  el("traffic-btn").classList.toggle("active", !active);
});

el("underground-btn").addEventListener("click", () => {
  if (!map) return;
  setUndergroundVisibility(!undergroundMode);
});

el("detail-close").addEventListener("click", closeDetail);

el("settings-btn").addEventListener("click", () => showModal("settings-modal"));
el("settings-close").addEventListener("click", () => hideModal("settings-modal"));

el("replace-key-btn").addEventListener("click", () => {
  localStorage.removeItem(GOOGLE_KEY_STORAGE);
  location.reload();
});

el("refresh-tfl-btn").addEventListener("click", async () => {
  if (!map) return;
  hideModal("settings-modal");
  clearTfLCache();
  await loadTubeNetwork(true);
});

el("save-key-btn").addEventListener("click", async () => {
  const key = el("api-key-input").value.trim();
  if (!key) {
    setNetworkStatus("Paste a Google Maps API key first.", true);
    return;
  }

  const btn = el("save-key-btn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Loading…";

  try {
    localStorage.setItem(GOOGLE_KEY_STORAGE, key);
    await bootWithKey(key);
  } catch (err) {
    console.error(err);
    localStorage.removeItem(GOOGLE_KEY_STORAGE);
    showModal("key-modal");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

/* PWA registration disabled on localhost development build. */

/* Boot */
const storedKey = localStorage.getItem(GOOGLE_KEY_STORAGE);
if (storedKey) {
  bootWithKey(storedKey);
} else {
  showModal("key-modal");
}
