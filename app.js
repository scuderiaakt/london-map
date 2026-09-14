/* London Life Map v1.3B
   Google Maps basemap + geographic London Underground overlay.
   v1.3B completes the Metro rebuild: real geographic track geometry when available,
   one physical station node, repeated M labels, hover/click line information,
   and line selection/highlighting.
   Tube metadata: Transport for London. Geographic track geometry: OpenStreetMap contributors.
*/

const GOOGLE_KEY_STORAGE = "london_map_google_key";
const TFL_CACHE_PREFIX = "london_tube_cache_v4_";
const TFL_CACHE_TTL = 24 * 60 * 60 * 1000;
const TUBE_GEOMETRY_CACHE_KEY = "london_tube_geographic_bundle_v1";
const TUBE_GEOMETRY_URLS = [
  "https://raw.githubusercontent.com/ghcpuman902/tfl-components/main/public/data/geography/tube-geometry.json",
  "https://tfl.manglekuo.com/data/geography/tube-geometry.json"
];
const LONDON_CENTER = { lat: 51.5078, lng: -0.1277 };

/* Our learning aliases. Official TfL names and colours remain unchanged. */
const TUBE_LINES = [
  { id: "piccadilly", name: "Piccadilly", code: "M1", color: "#003688" },
  { id: "district", name: "District", code: "M2", color: "#00782A" },
  { id: "circle", name: "Circle", code: "M3", color: "#FFD300" },
  { id: "central", name: "Central", code: "M4", color: "#E32017" },
  { id: "jubilee", name: "Jubilee", code: "M5", color: "#A0A5A9" },
  { id: "northern", name: "Northern", code: "M6", color: "#111111" },
  { id: "victoria", name: "Victoria", code: "M7", color: "#0098D4" },
  { id: "bakerloo", name: "Bakerloo", code: "M8", color: "#B36305" },
  { id: "metropolitan", name: "Metropolitan", code: "M9", color: "#9B0056" },
  { id: "hammersmith-city", name: "Hammersmith & City", code: "M10", color: "#F3A9BB" },
  { id: "waterloo-city", name: "Waterloo & City", code: "M11", color: "#95CDBA" }
];

const TUBE_LINE_BY_ID = new Map(TUBE_LINES.map(line => [line.id, line]));
const TUBE_LINE_ORDER = new Map(TUBE_LINES.map((line, index) => [line.id, index]));

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
let activeMapType = "roadmap";

const layerState = {
  metro: false,
  rail: false,
  places: false
};

let lineRenderings = [];
let stationOverlays = [];
let lineLabelOverlays = [];
let placeOverlays = [];
let stationRegistry = new Map();
let lineGeometryRegistry = new Map();
let selectedMetroLineId = null;
let lineLabelRefreshTimer = null;
let tubeGeometrySource = "none";

let userLocationMarker = null;
let userAccuracyCircle = null;
let userLocationWatchId = null;
let lastUserPosition = null;
let followUserLocation = false;

let toastTimer = null;

const el = id => document.getElementById(id);

function setNetworkStatus(text, isError = false) {
  const node = el("network-status");
  node.textContent = text;
  node.classList.toggle("error-badge", isError);
  node.classList.toggle("ready", !isError && /ready|loaded/i.test(text));
}

function showModal(id) {
  el(id).classList.remove("hidden");
}

function hideModal(id) {
  el(id).classList.add("hidden");
}

function showToast(message, duration = 2300) {
  const node = el("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add("hidden"), duration);
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
      if (!window.google?.maps) {
        reject(new Error("Google Maps did not initialize. Check the API key and Maps JavaScript API setup."));
      }
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
    streetViewControl: false,
    mapTypeControl: false,
    rotateControl: false,
    scaleControl: true,
    zoomControl: true,
    cameraControl: false,
    backgroundColor: "#0b1017"
  });

  trafficLayer = new google.maps.TrafficLayer();
  createPlaceMarkers();
  loadTubeNetwork();
  applyLayerState();

  map.addListener("click", () => {
    clearSelectedMetroLine();
    closeDetail();
    closeAddSheet();
    hideSearchResults();
  });

  map.addListener("zoom_changed", scheduleLineLabelRefresh);

  map.addListener("dragstart", () => {
    if (userLocationWatchId !== null) {
      followUserLocation = false;
      updateLocationButton();
    }
  });

  map.addListener("maptypeid_changed", () => {
    activeMapType = map.getMapTypeId();
    applyBaseMapStyle();
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
  };

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
      this.div.title = this.place.name;
      this.div.addEventListener("click", event => {
        event.stopPropagation();
        showPlaceInfo(this.place);
      });
    }
  };

  StationNodeOverlay = class StationNodeOverlay extends HtmlOverlay {
    constructor(station) {
      super({ lat: station.lat, lng: station.lon }, "station-node");
      this.station = station;
      this.mode = "focus";
      this.selectedLineId = null;
    }

    onAdd() {
      super.onAdd();

      const lines = (this.station.lines || []).slice().sort(compareTubeLines);
      this.div.style.background = stationNodeBackground(lines);
      this.div.classList.toggle("interchange", lines.length > 1);
      this.div.title = `${this.station.name} — ${lines.map(formatLineName).join(" · ")}`;
      this.div.innerHTML = `
        <div class="station-hover-card">
          <div class="station-hover-title">${escapeHtml(this.station.name)}</div>
          ${lines.map(line => `
            <div class="station-hover-line">
              <i class="station-hover-swatch" style="background:${line.color}"></i>
              <span>${escapeHtml(formatLineName(line))}</span>
            </div>
          `).join("")}
        </div>
      `;

      this.div.addEventListener("click", event => {
        event.stopPropagation();
        showStationInfo(this.station);
      });

      this.applyVisualState();
    }

    setMode(mode) {
      this.mode = mode;
      this.applyVisualState();
    }

    setSelectedLine(lineId) {
      this.selectedLineId = lineId;
      this.applyVisualState();
    }

    applyVisualState() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
      const servesSelected = !this.selectedLineId || this.station.lines.some(line => line.id === this.selectedLineId);
      this.div.classList.toggle("line-dimmed", !!this.selectedLineId && !servesSelected);
      this.div.classList.toggle("line-selected", !!this.selectedLineId && servesSelected);
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
  };

  LineLabelOverlay = class LineLabelOverlay extends HtmlOverlay {
    constructor(position, nextPosition, line) {
      super(position, "line-map-label");
      this.nextPosition = nextPosition || position;
      this.line = line;
      this.mode = "focus";
      this.selectedLineId = null;
    }

    onAdd() {
      super.onAdd();
      this.div.textContent = this.line.code;
      this.div.style.background = this.line.color;
      this.div.style.color = idealTextColor(this.line.color);
      if (this.line.id === "northern") this.div.style.borderColor = "rgba(255,255,255,.85)";
      this.applyVisualState();
    }

    setMode(mode) {
      this.mode = mode;
      this.applyVisualState();
    }

    setSelectedLine(lineId) {
      this.selectedLineId = lineId;
      this.applyVisualState();
    }

    applyVisualState() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
      this.div.classList.toggle("line-dimmed", !!this.selectedLineId && this.line.id !== this.selectedLineId);
      this.div.classList.toggle("line-selected", !!this.selectedLineId && this.line.id === this.selectedLineId);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position));
      const next = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.nextPosition));
      if (!point) return;

      let angle = 0;
      if (next) {
        angle = Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
      }

      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
      this.div.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(1)}deg)`;
      this.div.style.display = this.visible ? "" : "none";
    }
  };
}

function createPlaceMarkers() {
  placeOverlays.forEach(overlay => overlay.setMap(null));
  placeOverlays = PLACES.map(place => {
    const overlay = new PlaceOverlay(place);
    overlay.setMap(map);
    overlay.setVisible(layerState.places);
    return overlay;
  });
}

async function loadTubeNetwork(force = false) {
  clearTubeNetwork();
  stationRegistry = new Map();
  lineGeometryRegistry = new Map();
  selectedMetroLineId = null;
  tubeGeometrySource = "none";
  setNetworkStatus("Loading geographic Tube network…");

  try {
    const bundle = await loadGeographicTubeBundle(force);
    ingestGeographicTubeBundle(bundle);
    tubeGeometrySource = "osm";
  } catch (err) {
    console.warn("Geographic track bundle unavailable; falling back to TfL route geometry.", err);
    setNetworkStatus("Geographic track unavailable · loading TfL fallback…");

    const results = await Promise.allSettled(
      TUBE_LINES.map(line => loadFallbackLine(line, force))
    );

    const good = results.filter(result => result.status === "fulfilled").map(result => result.value);
    const bad = results.length - good.length;

    good.forEach(data => ingestFallbackLineData(data));
    tubeGeometrySource = good.length ? "tfl-fallback" : "none";

    if (!good.length) {
      setNetworkStatus("Tube data unavailable — tap ⚙ to retry", true);
      return;
    }

    if (bad) console.warn(`${bad} fallback Tube line request(s) failed.`);
  }

  renderTubeLines();
  buildStationNodes();
  rebuildLineLabels();
  applyLayerState();
  refreshSearchIfOpen();

  if (tubeGeometrySource === "osm") {
    setNetworkStatus("Tube network ready · geographic track");
  } else {
    setNetworkStatus("Tube network ready · smoothed fallback");
  }
}

async function loadGeographicTubeBundle(force = false) {
  if (!force) {
    const cached = getCache(TUBE_GEOMETRY_CACHE_KEY);
    if (isValidGeographicBundle(cached)) return cached;
  }

  let lastError = null;

  for (const url of TUBE_GEOMETRY_URLS) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: force ? "reload" : "default" });
      if (!response.ok) throw new Error(`Geometry request returned ${response.status}`);
      const bundle = await response.json();
      if (!isValidGeographicBundle(bundle)) throw new Error("Unexpected geographic Tube data format");
      setCache(TUBE_GEOMETRY_CACHE_KEY, bundle);
      return bundle;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Could not load geographic Tube geometry");
}

function isValidGeographicBundle(bundle) {
  return !!(
    bundle &&
    bundle.lines &&
    Array.isArray(bundle.lines.features) &&
    bundle.stations &&
    Array.isArray(bundle.stations.features)
  );
}

function ingestGeographicTubeBundle(bundle) {
  for (const feature of bundle.lines.features) {
    const properties = feature?.properties || {};
    const line = resolveTubeLine(properties.lineId || properties.lineName || properties.name);
    if (!line) continue;

    const paths = geoJsonGeometryToPaths(feature.geometry);
    if (!paths.length) continue;

    const existing = lineGeometryRegistry.get(line.id) || [];
    existing.push(...paths);
    lineGeometryRegistry.set(line.id, existing);
  }

  for (const feature of bundle.stations.features) {
    if (feature?.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) continue;

    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const properties = feature.properties || {};
    const lines = (properties.lineIds || [])
      .map(resolveTubeLine)
      .filter(Boolean)
      .sort(compareTubeLines);

    if (!lines.length) continue;

    const name = cleanStationName(properties.label || properties.name || "Station");
    const id = properties.featureId || properties.id || `${normalizeStationName(name)}-${lat.toFixed(5)}-${lon.toFixed(5)}`;

    const existing = stationRegistry.get(id) || {
      id,
      name,
      lat,
      lon,
      modes: new Set(["tube"]),
      lines: []
    };

    lines.forEach(line => addStationLine(existing, line));
    stationRegistry.set(id, existing);
  }
}

function geoJsonGeometryToPaths(geometry) {
  if (!geometry) return [];

  if (geometry.type === "LineString") {
    const path = normalizeCoordinatePath(geometry.coordinates);
    return path.length >= 2 ? [path] : [];
  }

  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates || [])
      .map(normalizeCoordinatePath)
      .filter(path => path.length >= 2);
  }

  return [];
}

function normalizeCoordinatePath(coordinates = []) {
  return coordinates
    .map(pair => Array.isArray(pair) ? ({ lat: Number(pair[1]), lng: Number(pair[0]) }) : null)
    .filter(point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function resolveTubeLine(value) {
  if (!value) return null;
  if (typeof value === "object" && value.id) return TUBE_LINE_BY_ID.get(value.id) || null;

  const raw = String(value).trim().toLowerCase();
  if (TUBE_LINE_BY_ID.has(raw)) return TUBE_LINE_BY_ID.get(raw);

  const normalized = normalizeSearch(raw)
    .replace(/\b(london underground|underground|tube|line)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return TUBE_LINES.find(line => {
    const candidates = [line.id, line.name, line.code]
      .map(item => normalizeSearch(item).replace(/\s+/g, " ").trim());
    return candidates.includes(normalized) || candidates.some(candidate => normalized.includes(candidate));
  }) || null;
}

async function loadFallbackLine(line, force = false) {
  const cacheKey = TFL_CACHE_PREFIX + line.id;
  if (!force) {
    const cached = getCache(cacheKey);
    if (cached) return { line, ...cached };
  }

  const seqUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.id)}/Route/Sequence/all?serviceTypes=Regular&excludeCrowding=true`;
  const stopsUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.id)}/StopPoints`;

  const [sequenceRes, stopsRes] = await Promise.all([
    fetch(seqUrl, { headers: { Accept: "application/json" } }),
    fetch(stopsUrl, { headers: { Accept: "application/json" } })
  ]);

  if (!sequenceRes.ok || !stopsRes.ok) {
    throw new Error(`TfL request failed for ${line.name}`);
  }

  const sequence = await sequenceRes.json();
  const stops = await stopsRes.json();

  const geometries = [];
  for (const encoded of (sequence.lineStrings || [])) {
    for (const path of parseLineString(encoded)) {
      geometries.push(smoothGeographicPath(path, 6));
    }
  }

  const simplified = {
    geometries,
    stops: (Array.isArray(stops) ? stops : []).map(stop => ({
      id: stop.id,
      stationNaptan: stop.stationNaptan,
      hubNaptanCode: stop.hubNaptanCode,
      name: stop.commonName || stop.name || "Station",
      lat: stop.lat,
      lon: stop.lon,
      modes: stop.modes || [],
      lines: (stop.lines || []).map(item => ({ id: item.id, name: item.name }))
    })).filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
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
      const path = node
        .map(pair => ({ lat: pair[1], lng: pair[0] }))
        .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
      if (path.length >= 2) lines.push(path);
    } else {
      node.forEach(walk);
    }
  }

  walk(parsed);
  return lines;
}

function smoothGeographicPath(path, subdivisions = 5) {
  if (!Array.isArray(path) || path.length < 3) return path || [];

  const result = [];

  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[Math.max(0, i - 1)];
    const p1 = path[i];
    const p2 = path[i + 1];
    const p3 = path[Math.min(path.length - 1, i + 2)];

    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      const lat = 0.5 * (
        2 * p1.lat +
        (-p0.lat + p2.lat) * t +
        (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
        (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
      );

      const lng = 0.5 * (
        2 * p1.lng +
        (-p0.lng + p2.lng) * t +
        (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 +
        (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3
      );

      result.push({ lat, lng });
    }
  }

  result.push(path[path.length - 1]);
  return result;
}

function ingestFallbackLineData(data) {
  const { line, geometries, stops } = data;
  const existingGeometry = lineGeometryRegistry.get(line.id) || [];
  existingGeometry.push(...geometries);
  lineGeometryRegistry.set(line.id, existingGeometry);

  for (const stop of stops) {
    const key = stop.hubNaptanCode || stop.stationNaptan || stop.id || `${stop.lat.toFixed(5)},${stop.lon.toFixed(5)},${normalizeStationName(stop.name)}`;
    const existing = stationRegistry.get(key) || {
      id: key,
      name: cleanStationName(stop.name),
      lat: stop.lat,
      lon: stop.lon,
      modes: new Set(stop.modes || []),
      lines: []
    };

    addStationLine(existing, line);

    for (const listedLine of (stop.lines || [])) {
      const knownLine = resolveTubeLine(listedLine.id || listedLine.name);
      if (knownLine) addStationLine(existing, knownLine);
    }

    (stop.modes || []).forEach(mode => existing.modes.add(mode));
    stationRegistry.set(key, existing);
  }
}

function addStationLine(station, line) {
  if (!line) return;
  if (!station.lines.some(existing => existing.id === line.id)) {
    station.lines.push(line);
  }
}

function renderTubeLines() {
  lineRenderings.forEach(item => item.polyline.setMap(null));
  lineRenderings = [];

  for (const line of TUBE_LINES) {
    const geometries = lineGeometryRegistry.get(line.id) || [];

    for (const path of geometries) {
      if (!Array.isArray(path) || path.length < 2) continue;

      if (line.id === "northern") {
        const casing = new google.maps.Polyline({
          map,
          path,
          geodesic: false,
          strokeColor: "#FFFFFF",
          strokeOpacity: 0,
          strokeWeight: 8,
          zIndex: 17,
          clickable: false,
          visible: layerState.metro
        });
        lineRenderings.push({ polyline: casing, line, role: "casing" });
      }

      const main = new google.maps.Polyline({
        map,
        path,
        geodesic: false,
        strokeColor: line.color,
        strokeOpacity: 0,
        strokeWeight: 5,
        zIndex: 20,
        clickable: false,
        visible: layerState.metro
      });
      lineRenderings.push({ polyline: main, line, role: "main" });

      const hit = new google.maps.Polyline({
        map,
        path,
        geodesic: false,
        strokeColor: line.color,
        strokeOpacity: 0.001,
        strokeWeight: 20,
        zIndex: 55,
        clickable: true,
        visible: layerState.metro
      });
      hit.addListener("click", () => selectMetroLine(line.id, { showInfo: true }));
      lineRenderings.push({ polyline: hit, line, role: "hit" });
    }
  }
}

function buildStationNodes() {
  stationOverlays.forEach(overlay => overlay.setMap(null));
  stationOverlays = [];

  const stations = [...stationRegistry.values()]
    .map(station => ({ ...station, lines: station.lines.slice().sort(compareTubeLines) }))
    .filter(station => station.lines.length);

  for (const station of stations) {
    stationRegistry.set(station.id, station);
    const overlay = new StationNodeOverlay(station);
    overlay.setMap(map);
    overlay.setVisible(layerState.metro);
    stationOverlays.push(overlay);
  }
}

function stationNodeBackground(lines) {
  if (!lines?.length) return "#FFFFFF";
  if (lines.length === 1) return lines[0].color;

  const step = 100 / lines.length;
  const stops = lines.flatMap((line, index) => {
    const start = (index * step).toFixed(3);
    const end = ((index + 1) * step).toFixed(3);
    return [`${line.color} ${start}%`, `${line.color} ${end}%`];
  });

  return `conic-gradient(${stops.join(", ")})`;
}

function rebuildLineLabels() {
  lineLabelOverlays.forEach(overlay => overlay.setMap(null));
  lineLabelOverlays = [];
  if (!map) return;

  const zoom = map.getZoom() || 12;
  const spacingKm = lineLabelSpacingKm(zoom);

  for (const line of TUBE_LINES) {
    const geometries = lineGeometryRegistry.get(line.id) || [];
    const seen = new Set();
    let labelCount = 0;

    for (const path of geometries) {
      const samples = samplePathForLabels(path, spacingKm);

      for (const sample of samples) {
        const key = `${Math.round(sample.position.lat / 0.006)}:${Math.round(sample.position.lng / 0.009)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const label = new LineLabelOverlay(sample.position, sample.nextPosition, line);
        label.setMap(map);
        label.setVisible(layerState.metro);
        label.setMode(layerState.metro && !layerState.rail && !layerState.places ? "focus" : "minimal");
        label.setSelectedLine(selectedMetroLineId);
        lineLabelOverlays.push(label);

        labelCount += 1;
        if (labelCount >= 42) break;
      }

      if (labelCount >= 42) break;
    }
  }
}

function lineLabelSpacingKm(zoom) {
  if (zoom <= 10) return 7.5;
  if (zoom <= 11) return 5.5;
  if (zoom <= 12) return 4.0;
  if (zoom <= 13) return 2.8;
  if (zoom <= 14) return 1.9;
  return 1.2;
}

function samplePathForLabels(path, spacingKm) {
  if (!Array.isArray(path) || path.length < 2) return [];

  const segmentLengths = [];
  let total = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const length = haversineKm(path[i], path[i + 1]);
    segmentLengths.push(length);
    total += length;
  }

  if (total < spacingKm * 0.55) return [];

  const samples = [];
  for (let target = spacingKm * 0.55; target < total; target += spacingKm) {
    let walked = 0;

    for (let i = 0; i < segmentLengths.length; i++) {
      const segment = segmentLengths[i];
      if (walked + segment < target) {
        walked += segment;
        continue;
      }

      const ratio = segment > 0 ? Math.max(0, Math.min(1, (target - walked) / segment)) : 0;
      const a = path[i];
      const b = path[i + 1];
      const position = {
        lat: a.lat + (b.lat - a.lat) * ratio,
        lng: a.lng + (b.lng - a.lng) * ratio
      };

      const aheadRatio = Math.min(1, ratio + 0.08);
      const nextPosition = {
        lat: a.lat + (b.lat - a.lat) * aheadRatio,
        lng: a.lng + (b.lng - a.lng) * aheadRatio
      };

      samples.push({ position, nextPosition });
      break;
    }
  }

  return samples;
}

function haversineKm(a, b) {
  const toRad = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function scheduleLineLabelRefresh() {
  clearTimeout(lineLabelRefreshTimer);
  lineLabelRefreshTimer = setTimeout(() => {
    if (lineGeometryRegistry.size) rebuildLineLabels();
  }, 180);
}

function selectMetroLine(lineId, options = {}) {
  if (!TUBE_LINE_BY_ID.has(lineId)) return;
  layerState.metro = true;
  selectedMetroLineId = lineId;
  applyLayerState();

  const line = TUBE_LINE_BY_ID.get(lineId);
  if (options.fit) focusTubeLine(lineId);
  if (options.showInfo !== false) showLineInfo(line);
}

function clearSelectedMetroLine() {
  if (!selectedMetroLineId) return;
  selectedMetroLineId = null;
  applyLayerState();
}

function clearTubeNetwork() {
  lineRenderings.forEach(item => item.polyline.setMap(null));
  stationOverlays.forEach(overlay => overlay.setMap(null));
  lineLabelOverlays.forEach(overlay => overlay.setMap(null));
  lineRenderings = [];
  stationOverlays = [];
  lineLabelOverlays = [];
}

/* ---------- Layer architecture ---------- */
function toggleLayer(name) {
  layerState[name] = !layerState[name];

  if (name === "metro" && !layerState.metro) {
    selectedMetroLineId = null;
  }

  applyLayerState();

  if (name === "rail" && layerState.rail) {
    showToast("Rail controls are ready; Elizabeth, Overground, DLR and National Rail data come in the Rail build.", 3400);
  }
}

function applyLayerState() {
  const metroVisible = layerState.metro;
  const metroFocus = metroVisible && !layerState.rail && !layerState.places;
  const metroMode = metroFocus ? "focus" : "minimal";
  const hasSelection = !!selectedMetroLineId;

  lineRenderings.forEach(item => {
    const { polyline, line, role } = item;
    polyline.setVisible(metroVisible);
    if (!metroVisible) return;

    const selected = !hasSelection || line.id === selectedMetroLineId;

    if (role === "hit") {
      polyline.setOptions({
        strokeOpacity: 0.001,
        strokeWeight: 20,
        zIndex: selected ? 70 : 54
      });
      return;
    }

    if (role === "casing") {
      polyline.setOptions({
        strokeOpacity: selected ? (metroFocus ? 0.94 : 0.52) : 0.05,
        strokeWeight: selected && hasSelection ? (metroFocus ? 11 : 8) : (metroFocus ? 9 : 5.4),
        zIndex: selected && hasSelection ? 43 : (metroFocus ? 17 : 12)
      });
      return;
    }

    const baseOpacity = metroFocus ? 0.98 : 0.60;
    const dimOpacity = metroFocus ? 0.16 : 0.11;
    const baseWeight = metroFocus ? (line.id === "northern" ? 6 : 5) : 3.2;

    polyline.setOptions({
      strokeOpacity: hasSelection ? (selected ? 1 : dimOpacity) : baseOpacity,
      strokeWeight: hasSelection && selected ? (metroFocus ? 7 : 5.2) : baseWeight,
      zIndex: hasSelection && selected ? 45 : (metroFocus ? 20 : 13)
    });
  });

  stationOverlays.forEach(overlay => {
    overlay.setVisible(metroVisible);
    overlay.setMode(metroMode);
    overlay.setSelectedLine(selectedMetroLineId);
  });

  lineLabelOverlays.forEach(overlay => {
    overlay.setVisible(metroVisible);
    overlay.setMode(metroMode);
    overlay.setSelectedLine(selectedMetroLineId);
  });

  placeOverlays.forEach(overlay => overlay.setVisible(layerState.places));

  el("metro-btn").classList.toggle("active", layerState.metro);
  el("metro-btn").setAttribute("aria-pressed", String(layerState.metro));
  el("rail-btn").classList.toggle("active", layerState.rail);
  el("rail-btn").setAttribute("aria-pressed", String(layerState.rail));
  el("places-btn").classList.toggle("active", layerState.places);
  el("places-btn").setAttribute("aria-pressed", String(layerState.places));

  applyBaseMapStyle();
}

function applyBaseMapStyle() {
  if (!map || activeMapType !== "roadmap") return;
  const metroFocus = layerState.metro && !layerState.rail && !layerState.places;
  map.setOptions({ styles: metroFocus ? METRO_FOCUS_MAP_STYLES : [] });
}

const METRO_FOCUS_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#0c1117" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4e5a67" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0c1117" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#242d37" }] },
  { featureType: "administrative.locality", elementType: "labels", stylers: [{ visibility: "simplified" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#0e151c" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#171f28" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#46525f" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#202a35" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#071925" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#395164" }] }
];

/* ---------- Information ---------- */
function showMapInfo() {
  const activeLayers = [];
  if (layerState.metro) activeLayers.push("Metro");
  if (layerState.rail) activeLayers.push("Rail");
  if (layerState.places) activeLayers.push("Frequent Places");

  const metroFocus = layerState.metro && !layerState.rail && !layerState.places;
  const viewName = !activeLayers.length ? "Vanilla Map" : metroFocus ? "Metro Focus" : activeLayers.join(" + ");

  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">CURRENT VIEW</div>
    <h2>${escapeHtml(viewName)}</h2>
    <div class="sub">
      ${metroFocus
        ? "Metro is the only active layer, so the city is dimmed and the Tube becomes the visual focus."
        : !activeLayers.length
          ? "No custom layers are active. This is the clean Google Maps base map."
          : "The base city stays normal while active layers are drawn as overlays."}
    </div>
    <div class="detail-section">
      <div class="info-row"><span>Metro</span><b>${layerState.metro ? (metroFocus ? "Focus" : "Minimal overlay") : "Off"}</b></div>
      <div class="info-row"><span>Rail</span><b>${layerState.rail ? "Selected · data next" : "Off"}</b></div>
      <div class="info-row"><span>Frequent Places</span><b>${layerState.places ? "On" : "Off"}</b></div>
      <div class="info-row"><span>Base map</span><b>${activeMapType === "satellite" ? "Satellite" : "Map"}</b></div>
    </div>
    <div class="detail-section sub">M1–M11 are learning aliases used by this map. Official TfL line names and colours stay unchanged.</div>
  `;
  openDetail();
}

function showPlaceInfo(place) {
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">${escapeHtml(place.category.toUpperCase())}</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.note || "")}</div>
  `;
  openDetail();
}

function showLineInfo(line) {
  const stationCount = [...stationRegistry.values()].filter(station => station.lines.some(item => item.id === line.id)).length;
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">METRO LINE</div>
    <h2>${escapeHtml(formatLineName(line))}</h2>
    <div class="sub">London Underground · official TfL name and colour retained.</div>
    <div class="detail-section">
      <div class="info-row"><span>Learning alias</span><b>${escapeHtml(line.code)}</b></div>
      <div class="info-row"><span>Official name</span><b>${escapeHtml(line.name)}</b></div>
      <div class="info-row"><span>Stations on map</span><b>${stationCount || "—"}</b></div>
      <div class="info-row"><span>Track view</span><b>${tubeGeometrySource === "osm" ? "Geographic" : "Smoothed fallback"}</b></div>
    </div>
    <div class="detail-section sub">This line is highlighted. Tap empty map space to clear the highlight.</div>
  `;
  openDetail();
}

async function showStationInfo(station) {
  const content = el("detail-content");
  const lines = (station.lines || []).slice().sort(compareTubeLines);
  const transferLabel = lines.length > 1 ? "TRANSFER STATION" : "METRO STATION";

  content.innerHTML = `
    <div class="detail-label">${transferLabel}</div>
    <h2>${escapeHtml(station.name)}</h2>
    <div class="chips">
      ${lines.map(line => `
        <button class="line-chip line-chip-button" data-line-id="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">
          ${escapeHtml(formatLineName(line))}
        </button>
      `).join("")}
    </div>
    <div class="detail-section">
      <div class="detail-label">BUS INTEGRATION</div>
      <div id="bus-info" class="sub">Checking nearby bus stops…</div>
    </div>
  `;
  openDetail();

  content.querySelectorAll("[data-line-id]").forEach(button => {
    button.addEventListener("click", () => {
      selectMetroLine(button.dataset.lineId, { showInfo: true });
    });
  });

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
  closeAddSheet(false);
  el("detail-card").classList.remove("hidden");
  document.body.classList.add("detail-open");
}

function closeDetail() {
  el("detail-card").classList.add("hidden");
  if (el("add-sheet").classList.contains("hidden")) {
    document.body.classList.remove("detail-open");
  }
}

function openAddSheet() {
  closeDetail();
  el("add-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
}

function closeAddSheet(updateBody = true) {
  el("add-sheet").classList.add("hidden");
  if (updateBody && el("detail-card").classList.contains("hidden")) {
    document.body.classList.remove("detail-open");
  }
}

/* ---------- Search ---------- */
function buildSearchResults(query) {
  const q = normalizeSearch(query);
  if (!q) return [];

  const results = [];

  for (const line of TUBE_LINES) {
    const haystack = normalizeSearch(`${line.code} ${line.name} ${line.id} underground metro`);
    const score = searchScore(q, haystack, normalizeSearch(line.code), normalizeSearch(line.name));
    if (score > 0) results.push({ type: "line", score, line });
  }

  for (const place of PLACES) {
    const haystack = normalizeSearch(`${place.name} ${place.category} ${place.note || ""}`);
    const score = searchScore(q, haystack, normalizeSearch(place.name));
    if (score > 0) results.push({ type: "place", score, place });
  }

  for (const station of getSearchStations()) {
    const lineText = station.lines.map(formatLineName).join(" ");
    const haystack = normalizeSearch(`${station.name} ${lineText} station metro underground`);
    const score = searchScore(q, haystack, normalizeSearch(station.name));
    if (score > 0) results.push({ type: "station", score, station });
  }

  return results
    .sort((a, b) => b.score - a.score || resultTitle(a).localeCompare(resultTitle(b)))
    .slice(0, 9);
}

function getSearchStations() {
  return [...stationRegistry.values()]
    .map(station => ({
      ...station,
      lines: station.lines.slice().sort(compareTubeLines)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function searchScore(q, haystack, ...preferredFields) {
  if (!haystack.includes(q)) return 0;
  if (preferredFields.some(field => field === q)) return 100;
  if (preferredFields.some(field => field.startsWith(q))) return 80;
  if (haystack.startsWith(q)) return 70;
  return 45;
}

function renderSearchResults() {
  const query = el("search-input").value.trim();
  const resultsNode = el("search-results");
  const clearButton = el("search-clear");

  clearButton.classList.toggle("hidden", !query);

  if (!query) {
    hideSearchResults();
    return;
  }

  const results = buildSearchResults(query);
  resultsNode.innerHTML = results.length
    ? results.map((result, index) => searchResultHtml(result, index)).join("")
    : `<div class="search-result" style="cursor:default"><div class="result-icon">–</div><div><div class="result-title">No local result yet</div><div class="result-sub">Search currently covers Metro and frequent places.</div></div></div>`;

  resultsNode.classList.remove("hidden");

  resultsNode.querySelectorAll("[data-result-index]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.resultIndex);
      selectSearchResult(results[index]);
    });
  });
}

function searchResultHtml(result, index) {
  if (result.type === "line") {
    return `
      <button class="search-result" data-result-index="${index}" role="option">
        <div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div>
        <div><div class="result-title">${escapeHtml(formatLineName(result.line))}</div><div class="result-sub">Metro line</div></div>
      </button>`;
  }

  if (result.type === "station") {
    const lineNames = result.station.lines.map(formatLineName).join(" · ");
    return `
      <button class="search-result" data-result-index="${index}" role="option">
        <div class="result-icon">M</div>
        <div><div class="result-title">${escapeHtml(result.station.name)}</div><div class="result-sub">${escapeHtml(lineNames || "Metro station")}</div></div>
      </button>`;
  }

  return `
    <button class="search-result" data-result-index="${index}" role="option">
      <div class="result-icon">●</div>
      <div><div class="result-title">${escapeHtml(result.place.name)}</div><div class="result-sub">${escapeHtml(result.place.category)} · Frequent place</div></div>
    </button>`;
}

function selectSearchResult(result) {
  if (!result) return;
  hideSearchResults();
  el("search-input").blur();

  if (result.type === "place") {
    layerState.places = true;
    applyLayerState();
    map.panTo({ lat: result.place.lat, lng: result.place.lng });
    map.setZoom(Math.max(map.getZoom() || 15, 16));
    showPlaceInfo(result.place);
    return;
  }

  if (result.type === "station") {
    layerState.metro = true;
    selectedMetroLineId = null;
    applyLayerState();
    map.panTo({ lat: result.station.lat, lng: result.station.lon });
    map.setZoom(16);
    showStationInfo(result.station);
    return;
  }

  if (result.type === "line") {
    selectMetroLine(result.line.id, { fit: true, showInfo: true });
  }
}

function focusTubeLine(lineId) {
  const geometries = lineGeometryRegistry.get(lineId) || [];
  if (!geometries.length) return;

  const bounds = new google.maps.LatLngBounds();
  geometries.flat().forEach(point => bounds.extend(point));
  if (!bounds.isEmpty()) map.fitBounds(bounds, 44);
}

function hideSearchResults() {
  el("search-results").classList.add("hidden");
}

function refreshSearchIfOpen() {
  if (el("search-input").value.trim()) renderSearchResults();
}

function resultTitle(result) {
  if (result.type === "line") return formatLineName(result.line);
  if (result.type === "station") return result.station.name;
  return result.place.name;
}

/* ---------- Live device location ---------- */
function requestOrRecenterLocation() {
  if (!navigator.geolocation) {
    showToast("This browser does not provide device location.");
    return;
  }

  if (userLocationWatchId !== null && lastUserPosition) {
    followUserLocation = true;
    centerOnUser();
    updateLocationButton();
    return;
  }

  followUserLocation = true;
  updateLocationButton();
  showToast("Your browser may ask for location permission.", 2600);

  userLocationWatchId = navigator.geolocation.watchPosition(
    position => {
      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      lastUserPosition = {
        coords,
        accuracy: position.coords.accuracy
      };

      drawUserLocation(coords, position.coords.accuracy);

      if (followUserLocation) {
        map.panTo(coords);
        if ((map.getZoom() || 0) < 16) map.setZoom(16);
      }

      updateLocationButton();
    },
    error => {
      console.warn("Location error", error);
      userLocationWatchId = null;
      followUserLocation = false;
      updateLocationButton();

      const messages = {
        1: "Location permission was denied. You can change it in your browser/site settings.",
        2: "Your device location is currently unavailable.",
        3: "Location request timed out. Try again."
      };
      showToast(messages[error.code] || "Could not get your location.", 3800);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function drawUserLocation(coords, accuracy) {
  if (!userLocationMarker) {
    userLocationMarker = new google.maps.Marker({
      map,
      position: coords,
      zIndex: 999,
      title: "Your location",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#4285F4",
        fillOpacity: 1,
        strokeColor: "#FFFFFF",
        strokeOpacity: 1,
        strokeWeight: 3,
        scale: 8
      }
    });
  } else {
    userLocationMarker.setPosition(coords);
  }

  if (!userAccuracyCircle) {
    userAccuracyCircle = new google.maps.Circle({
      map,
      center: coords,
      radius: accuracy,
      clickable: false,
      strokeColor: "#4285F4",
      strokeOpacity: 0.48,
      strokeWeight: 1,
      fillColor: "#4285F4",
      fillOpacity: 0.12,
      zIndex: 2
    });
  } else {
    userAccuracyCircle.setCenter(coords);
    userAccuracyCircle.setRadius(accuracy);
  }
}

function centerOnUser() {
  if (!lastUserPosition || !map) return;
  map.panTo(lastUserPosition.coords);
  if ((map.getZoom() || 0) < 16) map.setZoom(16);
}

function updateLocationButton() {
  const button = el("location-btn");
  const tracking = userLocationWatchId !== null;
  button.classList.toggle("active", tracking && followUserLocation);
  button.classList.toggle("paused", tracking && !followUserLocation);
  button.textContent = tracking ? (followUserLocation ? "◉" : "◎") : "◎";
  button.title = tracking && !followUserLocation ? "Re-centre on my location" : "Use my location";
}

/* ---------- Add sheet placeholder ---------- */
function handleAddMethod(method) {
  if (method === "current") {
    closeAddSheet();
    requestOrRecenterLocation();
    showToast("Live location is ready. Saving it as a frequent place comes in the Places build.", 3300);
    return;
  }

  if (method === "search") {
    closeAddSheet();
    el("search-input").focus();
    showToast("Local search is live. Adding arbitrary Google places is next.", 3000);
    return;
  }

  if (method === "tap") {
    showToast("Tap-to-add will be activated when frequent-place saving lands.");
    return;
  }

  if (method === "centre") {
    const center = map?.getCenter();
    if (center) {
      showToast(`Map centre ready: ${center.lat().toFixed(5)}, ${center.lng().toFixed(5)}. Saving comes next.`, 3400);
    }
  }
}

/* ---------- Utilities ---------- */
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
  localStorage.removeItem(TUBE_GEOMETRY_CACHE_KEY);
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

function normalizeSearch(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function compareTubeLines(a, b) {
  return (TUBE_LINE_ORDER.get(a.id) ?? 999) - (TUBE_LINE_ORDER.get(b.id) ?? 999);
}

function formatLineName(line) {
  return `${line.code} · ${line.name}`;
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

/* ---------- Controls ---------- */
el("metro-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("metro");
});

el("rail-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("rail");
});

el("places-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("places");
});

el("roadmap-btn").addEventListener("click", () => {
  if (!map) return;
  map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
  activeMapType = "roadmap";
  el("roadmap-btn").classList.add("active");
  el("satellite-btn").classList.remove("active");
  applyBaseMapStyle();
});

el("satellite-btn").addEventListener("click", () => {
  if (!map) return;
  map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
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

el("info-btn").addEventListener("click", showMapInfo);
el("detail-close").addEventListener("click", closeDetail);

el("add-btn").addEventListener("click", openAddSheet);
el("add-close").addEventListener("click", () => closeAddSheet());
el("add-sheet").querySelectorAll("[data-add-method]").forEach(button => {
  button.addEventListener("click", () => handleAddMethod(button.dataset.addMethod));
});

el("location-btn").addEventListener("click", requestOrRecenterLocation);

el("search-input").addEventListener("input", renderSearchResults);
el("search-input").addEventListener("focus", () => {
  if (el("search-input").value.trim()) renderSearchResults();
});
el("search-input").addEventListener("keydown", event => {
  if (event.key === "Escape") {
    hideSearchResults();
    el("search-input").blur();
  }
});
el("search-clear").addEventListener("click", () => {
  el("search-input").value = "";
  el("search-clear").classList.add("hidden");
  hideSearchResults();
  el("search-input").focus();
});

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

  const button = el("save-key-btn");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Loading…";

  try {
    localStorage.setItem(GOOGLE_KEY_STORAGE, key);
    await bootWithKey(key);
  } catch (err) {
    console.error(err);
    localStorage.removeItem(GOOGLE_KEY_STORAGE);
    showModal("key-modal");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

/* PWA registration stays disabled in this development build.
   We will re-enable it deliberately after the dev/stable service-worker scopes are cleaned up. */

/* ---------- Boot ---------- */
const storedKey = localStorage.getItem(GOOGLE_KEY_STORAGE);
if (storedKey) {
  bootWithKey(storedKey);
} else {
  showModal("key-modal");
}
