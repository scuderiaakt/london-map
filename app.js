/* Our Cities Map v1.4B
   Google Maps basemap + geographic London Underground overlay.
   v1.3D adds Rail + Tram, transport focus, richer information panels and route-building hooks,
   while preserving persistent favorites, geographic Metro and the mobile-first interface.
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

/* Persistent user data. Keep these keys stable across future releases. */
const FREQUENT_PLACES_STORAGE = "londonMap.frequentPlaces.v1";
const FAVORITE_ROUTES_STORAGE = "londonMap.favoriteRoutes.v1";

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

const DEFAULT_PLACES = [
  { id: "default-eastside", name: "Eastside Halls", lat: 51.49855, lng: -0.17435, category: "Home", color: "#64A8FF", anchor: true, note: "Home base — Prince's Gardens." },
  { id: "default-imperial", name: "Imperial College London", lat: 51.49880, lng: -0.17490, category: "University", color: "#7F77FF", anchor: true, note: "South Kensington campus." },
  { id: "default-ethos", name: "Ethos Sports Centre", lat: 51.49863, lng: -0.17619, category: "Sports", color: "#4AD3B4", note: "Imperial gym and pool." },
  { id: "default-health-centre", name: "Imperial College Health Centre", lat: 51.49913, lng: -0.17408, category: "Health", color: "#5FD780", note: "GP / NHS registration." },
  { id: "default-south-kensington", name: "South Kensington Station", lat: 51.49407, lng: -0.17392, category: "Transport", color: "#FFD25A", anchor: true, note: "District, Circle and Piccadilly connections." },
  { id: "default-boots-gloucester", name: "Boots — Gloucester Road", lat: 51.49454, lng: -0.18293, category: "Health", color: "#5FD780", note: "Pharmacy and everyday health supplies." },
  { id: "default-waitrose-gloucester", name: "Waitrose — Gloucester Road", lat: 51.49421, lng: -0.18278, category: "Food", color: "#C38BFF", note: "Groceries near halls." },
  { id: "default-argos-cromwell", name: "Argos — Cromwell Road", lat: 51.49491, lng: -0.18786, category: "Home", color: "#FFB15A", note: "Batteries, lamp, clock, mirror and room basics." },
  { id: "default-ikea-hammersmith", name: "IKEA Hammersmith", lat: 51.49212, lng: -0.22442, category: "Home", color: "#FFB15A", note: "Big room-setup shop." },
  { id: "default-tkmaxx-kensington", name: "TK Maxx — Kensington", lat: 51.50123, lng: -0.19189, category: "Shopping", color: "#FF7B95", note: "Luggage, towels, clothes and room basics." },
  { id: "default-decathlon-kensington", name: "Decathlon — Kensington", lat: 51.49908, lng: -0.19893, category: "Sports", color: "#4AD3B4", note: "Waterproof / sports equipment." },
  { id: "default-apple-brompton", name: "Apple Brompton Road", lat: 51.49937, lng: -0.16362, category: "Tech", color: "#B8C1CD", note: "Apple support and accessories." },
  { id: "default-paddington", name: "Paddington Station", lat: 51.51543, lng: -0.17541, category: "Transport", color: "#FFD25A", anchor: true, note: "Airport gateway & major rail hub." }
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

let frequentPlaces = loadFrequentPlaces();
let favoriteRoutes = loadFavoriteRoutes();
let activeFavoriteRouteId = null;
let pendingTapPlace = false;
let pendingPlaceCoordinates = null;
let routeEditorSegments = [];
let geocoder = null;

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
  geocoder = new google.maps.Geocoder();
  createPlaceMarkers();
  loadTubeNetwork();
  applyLayerState();

  map.addListener("click", event => {
    if (pendingTapPlace && event.latLng) {
      pendingTapPlace = false;
      openPlaceEditor({ lat: event.latLng.lat(), lng: event.latLng.lng() });
      return;
    }

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
      this.highlightLineIds = null;
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

    setHighlightedLines(lineIds) {
      this.highlightLineIds = lineIds ? new Set(lineIds) : null;
      this.applyVisualState();
    }

    applyVisualState() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
      const hasHighlight = !!this.highlightLineIds?.size;
      const servesSelected = !hasHighlight || this.station.lines.some(line => this.highlightLineIds.has(line.id));
      this.div.classList.toggle("line-dimmed", hasHighlight && !servesSelected);
      this.div.classList.toggle("line-selected", hasHighlight && servesSelected);
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
      this.highlightLineIds = null;
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

    setHighlightedLines(lineIds) {
      this.highlightLineIds = lineIds ? new Set(lineIds) : null;
      this.applyVisualState();
    }

    applyVisualState() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
      const hasHighlight = !!this.highlightLineIds?.size;
      this.div.classList.toggle("line-dimmed", hasHighlight && !this.highlightLineIds.has(this.line.id));
      this.div.classList.toggle("line-selected", hasHighlight && this.highlightLineIds.has(this.line.id));
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
  placeOverlays = frequentPlaces.map(place => {
    const overlay = new PlaceOverlay(place);
    overlay.setMap(map);
    overlay.setVisible(layerState.places);
    return overlay;
  });
}

async function loadTubeNetworkCore(force = false) {
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
        label.setHighlightedLines(getHighlightedMetroLineIds());
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
  activeFavoriteRouteId = null;
  updateRouteFocusChip();
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


/* ---------- Favorite route focus ---------- */
function getActiveFavoriteRoute() {
  return activeFavoriteRouteId
    ? favoriteRoutes.find(route => route.id === activeFavoriteRouteId) || null
    : null;
}

function routeMetroLineIds(route) {
  return [...new Set(
    (route?.segments || [])
      .filter(segment => segment.mode === "metro" && TUBE_LINE_BY_ID.has(segment.service))
      .map(segment => segment.service)
  )];
}

function getHighlightedMetroLineIds() {
  const activeRoute = getActiveFavoriteRoute();
  const routeLines = routeMetroLineIds(activeRoute);
  if (activeRoute && routeLines.length) return new Set(routeLines);
  if (selectedMetroLineId) return new Set([selectedMetroLineId]);
  return null;
}

function activateFavoriteRoute(routeId, options = {}) {
  const route = favoriteRoutes.find(item => item.id === routeId);
  if (!route) return;

  activeFavoriteRouteId = route.id;
  selectedMetroLineId = null;
  route.useCount = Number(route.useCount || 0) + 1;
  route.lastUsedAt = Date.now();
  saveFavoriteRoutes();

  const metroLines = routeMetroLineIds(route);
  layerState.metro = metroLines.length > 0;
  layerState.places = false;
  layerState.rail = false;

  applyLayerState();
  updateRouteFocusChip();
  if (metroLines.length) focusMetroLines(metroLines);
  if (options.showInfo !== false) showFavoriteRouteInfo(route);
  refreshSearchIfOpen();
}

function clearFavoriteRouteFocus() {
  if (!activeFavoriteRouteId) return;
  activeFavoriteRouteId = null;
  updateRouteFocusChip();
  applyLayerState();
}

function focusMetroLines(lineIds) {
  if (!map || !lineIds?.length) return;
  const bounds = new google.maps.LatLngBounds();

  for (const lineId of lineIds) {
    for (const path of (lineGeometryRegistry.get(lineId) || [])) {
      path.forEach(point => bounds.extend(point));
    }
  }

  if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
}

function updateRouteFocusChip() {
  const chip = el("route-focus-chip");
  const route = getActiveFavoriteRoute();
  if (!chip) return;
  chip.classList.toggle("hidden", !route);
  const label = chip.querySelector("[data-route-focus-name]");
  if (label) label.textContent = route ? route.name : "";
}

/* ---------- Layer architecture ---------- */
function toggleLayer(name) {
  if (activeFavoriteRouteId) {
    activeFavoriteRouteId = null;
    updateRouteFocusChip();
  }
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
  const activeRoute = getActiveFavoriteRoute();
  const routeLineIds = routeMetroLineIds(activeRoute);
  const routeFocus = !!activeRoute;
  const metroVisible = routeFocus ? routeLineIds.length > 0 : layerState.metro;
  const metroFocus = metroVisible && !routeFocus && !layerState.rail && !layerState.places;
  const metroMode = metroFocus ? "focus" : "minimal";
  const highlightedLineIds = getHighlightedMetroLineIds();
  const hasHighlight = !!highlightedLineIds?.size;

  lineRenderings.forEach(item => {
    const { polyline, line, role } = item;
    const includedInRoute = !routeFocus || highlightedLineIds?.has(line.id);
    const visible = metroVisible && includedInRoute;
    polyline.setVisible(visible);
    if (!visible) return;

    const selected = !hasHighlight || highlightedLineIds.has(line.id);

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
        strokeOpacity: selected ? (metroFocus ? 0.94 : routeFocus ? 0.80 : 0.18) : 0.03,
        strokeWeight: routeFocus ? 8 : selected && hasHighlight ? (metroFocus ? 11 : 7) : (metroFocus ? 9 : 4.6),
        zIndex: selected && hasHighlight ? 43 : (metroFocus ? 17 : 12)
      });
      return;
    }

    const baseOpacity = metroFocus ? 0.98 : routeFocus ? 0.92 : 0.20;
    const dimOpacity = metroFocus ? 0.16 : 0.05;
    const baseWeight = metroFocus ? (line.id === "northern" ? 6 : 5) : routeFocus ? 5.2 : 2.8;

    polyline.setOptions({
      strokeOpacity: hasHighlight ? (selected ? (routeFocus ? 0.96 : 1) : dimOpacity) : baseOpacity,
      strokeWeight: hasHighlight && selected ? (metroFocus ? 7 : routeFocus ? 6.2 : 4.8) : baseWeight,
      zIndex: hasHighlight && selected ? 45 : (metroFocus ? 20 : 13)
    });
  });

  stationOverlays.forEach(overlay => {
    const servesRoute = !routeFocus || overlay.station.lines.some(line => highlightedLineIds?.has(line.id));
    overlay.setVisible(metroVisible && servesRoute);
    overlay.setMode(metroMode);
    overlay.setHighlightedLines(highlightedLineIds);
  });

  lineLabelOverlays.forEach(overlay => {
    const included = !routeFocus || highlightedLineIds?.has(overlay.line.id);
    overlay.setVisible(metroVisible && included);
    overlay.setMode(metroMode);
    overlay.setHighlightedLines(highlightedLineIds);
  });

  placeOverlays.forEach(overlay => overlay.setVisible(layerState.places && !routeFocus));

  el("metro-btn").classList.toggle("active", layerState.metro && !routeFocus);
  el("metro-btn").setAttribute("aria-pressed", String(layerState.metro && !routeFocus));
  el("rail-btn").classList.toggle("active", layerState.rail && !routeFocus);
  el("rail-btn").setAttribute("aria-pressed", String(layerState.rail && !routeFocus));
  el("places-btn").classList.toggle("active", layerState.places && !routeFocus);
  el("places-btn").setAttribute("aria-pressed", String(layerState.places && !routeFocus));

  updateRouteFocusChip();
  applyBaseMapStyle();
}
function applyBaseMapStyle() {
  if (!map || activeMapType !== "roadmap") return;
  const metroFocus = layerState.metro && !getActiveFavoriteRoute() && !layerState.rail && !layerState.places;
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

  const activeRoute = getActiveFavoriteRoute();
  const metroFocus = layerState.metro && !activeRoute && !layerState.rail && !layerState.places;
  const viewName = activeRoute ? `Favorite Route · ${activeRoute.name}` : !activeLayers.length ? "Vanilla Map" : metroFocus ? "Metro Focus" : activeLayers.join(" + ");

  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">CURRENT VIEW</div>
    <h2>${escapeHtml(viewName)}</h2>
    <div class="sub">
      ${activeRoute
        ? "Favorite Route focus hides unrelated Metro services and keeps the base city normal for mixed surface + rail journeys."
        : metroFocus
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
    <div class="detail-label">${escapeHtml(String(place.category || "PLACE").toUpperCase())}</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.note || "Saved frequent place")}</div>
    <div class="detail-section">
      <div class="info-row"><span>Coordinates</span><b>${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}</b></div>
    </div>
    <div class="detail-actions">
      <button class="danger-btn" id="delete-place-btn">Delete from Frequent Places</button>
    </div>
  `;
  content.querySelector("#delete-place-btn")?.addEventListener("click", () => deleteFrequentPlace(place.id));
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

function closeDetail(updateBody = true) {
  el("detail-card").classList.add("hidden");
  if (updateBody && allOtherSheetsClosed("detail-card")) document.body.classList.remove("detail-open");
}

function openAddSheet() {
  closeDetail();
  el("add-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
}

function closeAddSheet(updateBody = true) {
  el("add-sheet").classList.add("hidden");
  if (updateBody && allOtherSheetsClosed("add-sheet")) document.body.classList.remove("detail-open");
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

  for (const place of frequentPlaces) {
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

  for (const route of favoriteRoutes) {
    const segmentText = (route.segments || []).map(segmentDisplayName).join(" ");
    const haystack = normalizeSearch(`${route.name} ${segmentText} favorite route journey`);
    const score = searchScore(q, haystack, normalizeSearch(route.name));
    if (score > 0) results.push({ type: "route", score, route });
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
    : `<div class="search-result" style="cursor:default"><div class="result-icon">–</div><div><div class="result-title">No local result yet</div><div class="result-sub">Search covers Metro, frequent places and favorite routes.</div></div></div>`;

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

  if (result.type === "route") {
    return `
      <button class="search-result" data-result-index="${index}" role="option">
        <div class="result-icon">★</div>
        <div><div class="result-title">${escapeHtml(result.route.name)}</div><div class="result-sub">${escapeHtml(routeSegmentSummary(result.route))}</div></div>
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

  if (result.type === "route") {
    activateFavoriteRoute(result.route.id);
    return;
  }

  if (result.type === "place") {
    clearFavoriteRouteFocus();
    layerState.places = true;
    applyLayerState();
    map.panTo({ lat: result.place.lat, lng: result.place.lng });
    map.setZoom(Math.max(map.getZoom() || 15, 16));
    showPlaceInfo(result.place);
    return;
  }

  if (result.type === "station") {
    clearFavoriteRouteFocus();
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
  if (result.type === "route") return result.route.name;
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

/* ---------- Persistent frequent places ---------- */
function loadFrequentPlaces() {
  try {
    const raw = localStorage.getItem(FREQUENT_PLACES_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(validSavedPlace);
    }
  } catch (err) {
    console.warn("Could not load frequent places", err);
  }

  const initial = DEFAULT_PLACES.map(place => ({ ...place }));
  try { localStorage.setItem(FREQUENT_PLACES_STORAGE, JSON.stringify(initial)); } catch {}
  return initial;
}

function saveFrequentPlaces() {
  try {
    localStorage.setItem(FREQUENT_PLACES_STORAGE, JSON.stringify(frequentPlaces));
  } catch (err) {
    console.warn("Could not save frequent places", err);
    showToast("Could not save this place on the device.");
  }
}

function validSavedPlace(place) {
  return !!(place && place.id && place.name && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)));
}

function placeColorForCategory(category) {
  const colors = {
    Home: "#64A8FF", University: "#7F77FF", Health: "#5FD780", Food: "#C38BFF",
    Shopping: "#FF7B95", Sports: "#4AD3B4", Tech: "#B8C1CD", Transport: "#FFD25A",
    Social: "#FF8EC7", Other: "#FFB15A"
  };
  return colors[category] || colors.Other;
}

function openPlaceEditor(coords, suggestedName = "", suggestedNote = "") {
  pendingPlaceCoordinates = { lat: Number(coords.lat), lng: Number(coords.lng) };
  el("place-name-input").value = suggestedName || "";
  el("place-category-input").value = "Other";
  el("place-note-input").value = suggestedNote || "";
  el("place-coordinate-readout").textContent = `${pendingPlaceCoordinates.lat.toFixed(5)}, ${pendingPlaceCoordinates.lng.toFixed(5)}`;
  closeAddSheet(false);
  closeDetail(false);
  el("place-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  setTimeout(() => el("place-name-input").focus(), 50);
}

function closePlaceEditor(updateBody = true) {
  el("place-editor-sheet").classList.add("hidden");
  pendingPlaceCoordinates = null;
  if (updateBody && allOtherSheetsClosed("place-editor-sheet")) document.body.classList.remove("detail-open");
}

function savePlaceFromEditor() {
  const name = el("place-name-input").value.trim();
  if (!name || !pendingPlaceCoordinates) {
    showToast("Give the place a name first.");
    return;
  }

  const category = el("place-category-input").value || "Other";
  const place = {
    id: `place-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    lat: pendingPlaceCoordinates.lat,
    lng: pendingPlaceCoordinates.lng,
    category,
    color: placeColorForCategory(category),
    anchor: false,
    note: el("place-note-input").value.trim(),
    createdAt: Date.now()
  };

  frequentPlaces.push(place);
  saveFrequentPlaces();
  createPlaceMarkers();
  layerState.places = true;
  applyLayerState();
  closePlaceEditor();
  map.panTo({ lat: place.lat, lng: place.lng });
  if ((map.getZoom() || 0) < 16) map.setZoom(16);
  showPlaceInfo(place);
  refreshSearchIfOpen();
  showToast(`Saved ${place.name}.`);
}

function deleteFrequentPlace(placeId) {
  const place = frequentPlaces.find(item => item.id === placeId);
  if (!place) return;
  if (!window.confirm(`Delete "${place.name}" from Frequent Places?`)) return;

  frequentPlaces = frequentPlaces.filter(item => item.id !== placeId);
  saveFrequentPlaces();
  createPlaceMarkers();
  closeDetail();
  renderFavoritesSheet();
  refreshSearchIfOpen();
  showToast(`Deleted ${place.name}.`);
}

async function handleAddMethod(method) {
  if (method === "route") {
    closeAddSheet(false);
    openRouteEditor();
    return;
  }

  if (method === "current") {
    closeAddSheet(false);
    try {
      const position = await getCurrentPositionOnce();
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      drawUserLocation(coords, position.coords.accuracy);
      lastUserPosition = { coords, accuracy: position.coords.accuracy };
      openPlaceEditor(coords);
    } catch (error) {
      showToast(locationErrorMessage(error), 3800);
    }
    return;
  }

  if (method === "search") {
    closeAddSheet(false);
    openLocationSearchSheet();
    return;
  }

  if (method === "tap") {
    closeAddSheet();
    pendingTapPlace = true;
    showToast("Tap the exact point on the map you want to save.", 3200);
    return;
  }

  if (method === "centre") {
    const center = map?.getCenter();
    if (center) {
      closeAddSheet(false);
      openPlaceEditor({ lat: center.lat(), lng: center.lng() });
    }
  }
}

function getCurrentPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 2, message: "Geolocation unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    });
  });
}

function locationErrorMessage(error) {
  const messages = {
    1: "Location permission was denied. Change it in your browser/site settings and try again.",
    2: "Your device location is currently unavailable.",
    3: "Location request timed out. Try again."
  };
  return messages[error?.code] || "Could not get your location.";
}

/* ---------- Search a location for adding ---------- */
function openLocationSearchSheet() {
  el("location-search-input").value = "";
  el("location-search-status").textContent = "Search London by place name or address.";
  el("location-search-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  setTimeout(() => el("location-search-input").focus(), 50);
}

function closeLocationSearchSheet(updateBody = true) {
  el("location-search-sheet").classList.add("hidden");
  if (updateBody && allOtherSheetsClosed("location-search-sheet")) document.body.classList.remove("detail-open");
}

async function geocodeLocationForPlace() {
  const query = el("location-search-input").value.trim();
  if (!query) return;
  const status = el("location-search-status");
  status.textContent = "Searching…";

  try {
    const response = await geocoder.geocode({
      address: query,
      region: getActiveCityConfig().geocoderRegion,
      bounds: new google.maps.LatLngBounds({ lat: 51.20, lng: -0.60 }, { lat: 51.75, lng: 0.35 })
    });
    const result = response?.results?.[0];
    if (!result) throw new Error("No location found");
    const location = result.geometry.location;
    const coords = { lat: location.lat(), lng: location.lng() };
    closeLocationSearchSheet(false);
    openPlaceEditor(coords, result.formatted_address || query, result.formatted_address || "");
    map.panTo(coords);
    if ((map.getZoom() || 0) < 16) map.setZoom(16);
  } catch (err) {
    console.warn("Geocoding failed", err);
    status.textContent = "Could not search that location. If Google says REQUEST_DENIED, enable Geocoding API for the same Cloud project, or use Tap map / Current location / Map centre.";
  }
}

/* ---------- Favorite routes ---------- */
function loadFavoriteRoutes() {
  try {
    const raw = localStorage.getItem(FAVORITE_ROUTES_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(route => route?.id && route?.name && Array.isArray(route.segments)) : [];
  } catch (err) {
    console.warn("Could not load favorite routes", err);
    return [];
  }
}

function saveFavoriteRoutes() {
  try {
    localStorage.setItem(FAVORITE_ROUTES_STORAGE, JSON.stringify(favoriteRoutes));
  } catch (err) {
    console.warn("Could not save favorite routes", err);
    showToast("Could not save this route on the device.");
  }
}

function segmentDisplayName(segment) {
  if (segment.mode === "metro") {
    const line = TUBE_LINE_BY_ID.get(segment.service);
    return line ? formatLineName(line) : `Metro · ${segment.service || "line"}`;
  }
  const labels = { rail: "Rail", tram: "Tram", bus: "Bus", walk: "Walk" };
  const mode = labels[segment.mode] || "Transit";
  return segment.service ? `${mode} · ${segment.service}` : mode;
}

function routeSegmentSummary(route) {
  const parts = (route.segments || []).map(segmentDisplayName);
  if (!parts.length) return "Favorite route";
  return parts.slice(0, 4).join(" → ") + (parts.length > 4 ? " → …" : "");
}

function openRouteEditor() {
  routeEditorSegments = [{ mode: "metro", service: "piccadilly" }];
  el("route-name-input").value = "";
  renderRouteEditorSegments();
  el("route-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  setTimeout(() => el("route-name-input").focus(), 50);
}

function closeRouteEditor(updateBody = true) {
  el("route-editor-sheet").classList.add("hidden");
  routeEditorSegments = [];
  if (updateBody && allOtherSheetsClosed("route-editor-sheet")) document.body.classList.remove("detail-open");
}

function renderRouteEditorSegments() {
  const node = el("route-segments");
  node.innerHTML = routeEditorSegments.map((segment, index) => routeSegmentEditorHtml(segment, index)).join("");

  node.querySelectorAll("[data-segment-mode]").forEach(select => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.segmentMode);
      routeEditorSegments[index].mode = select.value;
      routeEditorSegments[index].service = select.value === "metro" ? "piccadilly" : "";
      renderRouteEditorSegments();
    });
  });

  node.querySelectorAll("[data-segment-service]").forEach(control => {
    const update = () => routeEditorSegments[Number(control.dataset.segmentService)].service = control.value;
    control.addEventListener("input", update);
    control.addEventListener("change", update);
  });

  node.querySelectorAll("[data-remove-segment]").forEach(button => {
    button.addEventListener("click", () => {
      if (routeEditorSegments.length <= 1) return;
      routeEditorSegments.splice(Number(button.dataset.removeSegment), 1);
      renderRouteEditorSegments();
    });
  });
}

function routeSegmentEditorHtml(segment, index) {
  const metroOptions = TUBE_LINES.map(line =>
    `<option value="${escapeHtml(line.id)}" ${segment.service === line.id ? "selected" : ""}>${escapeHtml(formatLineName(line))}</option>`
  ).join("");

  const serviceControl = segment.mode === "metro"
    ? `<select class="form-control" data-segment-service="${index}">${metroOptions}</select>`
    : `<input class="form-control" data-segment-service="${index}" value="${escapeHtml(segment.service || "")}" placeholder="${segmentPlaceholder(segment.mode)}" />`;

  return `
    <div class="route-segment-row">
      <span class="route-step">${index + 1}</span>
      <select class="form-control route-mode" data-segment-mode="${index}">
        <option value="metro" ${segment.mode === "metro" ? "selected" : ""}>Metro</option>
        <option value="rail" ${segment.mode === "rail" ? "selected" : ""}>Rail</option>
        <option value="tram" ${segment.mode === "tram" ? "selected" : ""}>Tram</option>
        <option value="bus" ${segment.mode === "bus" ? "selected" : ""}>Bus</option>
        <option value="walk" ${segment.mode === "walk" ? "selected" : ""}>Walk</option>
      </select>
      <div class="route-service">${serviceControl}</div>
      <button class="mini-danger" data-remove-segment="${index}" title="Remove segment">×</button>
    </div>`;
}

function segmentPlaceholder(mode) {
  if (mode === "bus") return "e.g. 49";
  if (mode === "tram") return "e.g. Tramlink / route";
  if (mode === "rail") return "e.g. Elizabeth / DLR";
  if (mode === "walk") return "e.g. Walk to station";
  return "Service";
}

function addRouteEditorSegment() {
  routeEditorSegments.push({ mode: "metro", service: "piccadilly" });
  renderRouteEditorSegments();
}

function saveFavoriteRouteFromEditor() {
  const name = el("route-name-input").value.trim();
  const segments = routeEditorSegments
    .map(segment => ({ mode: segment.mode, service: String(segment.service || "").trim() }))
    .filter(segment => segment.mode === "walk" || segment.service);

  if (!name) { showToast("Give the route a name first."); return; }
  if (!segments.length) { showToast("Add at least one route segment."); return; }

  const route = {
    id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name, segments, useCount: 0, createdAt: Date.now()
  };

  favoriteRoutes.push(route);
  saveFavoriteRoutes();
  closeRouteEditor();
  renderFavoritesSheet();
  refreshSearchIfOpen();
  showToast(`Saved route: ${route.name}`);
}

function deleteFavoriteRoute(routeId) {
  const route = favoriteRoutes.find(item => item.id === routeId);
  if (!route) return;
  if (!window.confirm(`Delete favorite route "${route.name}"?`)) return;

  favoriteRoutes = favoriteRoutes.filter(item => item.id !== routeId);
  if (activeFavoriteRouteId === routeId) activeFavoriteRouteId = null;
  saveFavoriteRoutes();
  applyLayerState();
  renderFavoritesSheet();
  closeDetail();
  refreshSearchIfOpen();
  showToast(`Deleted route: ${route.name}`);
}

function showFavoriteRouteInfo(route) {
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">FAVORITE ROUTE</div>
    <h2>${escapeHtml(route.name)}</h2>
    <div class="sub">${escapeHtml(routeSegmentSummary(route))}</div>
    <div class="detail-section route-segment-list">
      ${(route.segments || []).map((segment, index) => `
        <div class="route-info-row"><span class="route-step">${index + 1}</span><b>${escapeHtml(segmentDisplayName(segment))}</b></div>
      `).join("")}
    </div>
    <div class="detail-section">
      <div class="info-row"><span>Times opened</span><b>${Number(route.useCount || 0)}</b></div>
      <div class="info-row"><span>Map focus</span><b>${routeMetroLineIds(route).length ? "Metro segments isolated" : "No mapped segment yet"}</b></div>
    </div>
    <div class="sub detail-section">Rail, Tram and Bus segments are saved now. They will become map-visible automatically as those network layers are added in later builds.</div>
    <div class="detail-actions">
      <button class="secondary-btn compact-btn" id="exit-route-focus-btn">Exit route focus</button>
      <button class="danger-btn" id="delete-route-btn">Delete favorite route</button>
    </div>
  `;

  content.querySelector("#exit-route-focus-btn")?.addEventListener("click", () => { clearFavoriteRouteFocus(); closeDetail(); });
  content.querySelector("#delete-route-btn")?.addEventListener("click", () => deleteFavoriteRoute(route.id));
  openDetail();
}

/* ---------- Favorites panel ---------- */
function openFavoritesSheet() {
  renderFavoritesSheet();
  closeAddSheet(false);
  closeDetail(false);
  el("favorites-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
}

function closeFavoritesSheet(updateBody = true) {
  el("favorites-sheet").classList.add("hidden");
  if (updateBody && allOtherSheetsClosed("favorites-sheet")) document.body.classList.remove("detail-open");
}

function renderFavoritesSheet() {
  const placesNode = el("favorite-places-list");
  const routesNode = el("favorite-routes-list");
  if (!placesNode || !routesNode) return;

  placesNode.innerHTML = frequentPlaces.length
    ? frequentPlaces.map(place => `
        <div class="favorite-row">
          <button class="favorite-main" data-open-place="${escapeHtml(place.id)}">
            <span class="favorite-symbol" style="background:${place.color}">●</span>
            <span><b>${escapeHtml(place.name)}</b><small>${escapeHtml(place.category || "Place")}</small></span>
          </button>
          <button class="favorite-delete" data-delete-place="${escapeHtml(place.id)}" title="Delete">×</button>
        </div>`).join("")
    : `<div class="empty-state">No frequent places yet.</div>`;

  const sortedRoutes = favoriteRoutes.filter(route => getRouteCityId(route) === currentCityId).slice().sort((a, b) => Number(b.useCount || 0) - Number(a.useCount || 0) || a.name.localeCompare(b.name));
  routesNode.innerHTML = sortedRoutes.length
    ? sortedRoutes.map(route => `
        <div class="favorite-row">
          <button class="favorite-main" data-open-route="${escapeHtml(route.id)}">
            <span class="favorite-symbol route-star">★</span>
            <span><b>${escapeHtml(route.name)}</b><small>${escapeHtml(routeSegmentSummary(route))} · Used ${Number(route.useCount || 0)}×</small></span>
          </button>
          <button class="favorite-delete" data-delete-route="${escapeHtml(route.id)}" title="Delete">×</button>
        </div>`).join("")
    : `<div class="empty-state">No favorite routes yet.</div>`;

  placesNode.querySelectorAll("[data-open-place]").forEach(button => {
    button.addEventListener("click", () => {
      const place = frequentPlaces.find(item => item.id === button.dataset.openPlace);
      if (!place) return;
      closeFavoritesSheet(false);
      layerState.places = true;
      applyLayerState();
      map.panTo({ lat: place.lat, lng: place.lng });
      if ((map.getZoom() || 0) < 16) map.setZoom(16);
      showPlaceInfo(place);
    });
  });
  placesNode.querySelectorAll("[data-delete-place]").forEach(button => button.addEventListener("click", () => deleteFrequentPlace(button.dataset.deletePlace)));
  routesNode.querySelectorAll("[data-open-route]").forEach(button => button.addEventListener("click", () => { closeFavoritesSheet(false); activateFavoriteRoute(button.dataset.openRoute); }));
  routesNode.querySelectorAll("[data-delete-route]").forEach(button => button.addEventListener("click", () => deleteFavoriteRoute(button.dataset.deleteRoute)));
}

function allOtherSheetsClosed(exceptId) {
  const ids = ["detail-card", "add-sheet", "favorites-sheet", "route-editor-sheet", "place-editor-sheet", "location-search-sheet"];
  return ids.filter(id => id !== exceptId).every(id => el(id)?.classList.contains("hidden"));
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

/* ---------- v1.3D: Rail + Tram + Focus ---------- */
const SURFACE_CACHE_PREFIX = "london_surface_cache_v1_";
const SURFACE_CORE_MODES = "overground,elizabeth-line,dlr,tram";
const NATIONAL_RAIL_OPERATOR_HINTS = [
  "great western", "southeastern", "south western", "southern", "thameslink",
  "greater anglia", "chiltern", "c2c", "avanti", "london north eastern", "east midlands"
];
const LONDON_RAIL_BOUNDS = { south: 51.20, north: 51.72, west: -0.62, east: 0.38 };

const SURFACE_LINE_PRESETS = [
  { key: "elizabeth", code: "R1", name: "Elizabeth", displayName: "Elizabeth line", family: "rail", kind: "elizabeth", color: "#6950A1" },
  { key: "lioness", code: "R2", name: "Lioness", displayName: "Lioness line", family: "rail", kind: "overground", color: "#FAA61A" },
  { key: "mildmay", code: "R3", name: "Mildmay", displayName: "Mildmay line", family: "rail", kind: "overground", color: "#0077AD" },
  { key: "windrush", code: "R4", name: "Windrush", displayName: "Windrush line", family: "rail", kind: "overground", color: "#ED1B00" },
  { key: "weaver", code: "R5", name: "Weaver", displayName: "Weaver line", family: "rail", kind: "overground", color: "#823A62" },
  { key: "suffragette", code: "R6", name: "Suffragette", displayName: "Suffragette line", family: "rail", kind: "overground", color: "#5BBD72" },
  { key: "liberty", code: "R7", name: "Liberty", displayName: "Liberty line", family: "rail", kind: "overground", color: "#5D6061" },
  { key: "dlr", code: "R8", name: "DLR", displayName: "DLR (Automated Rail)", family: "rail", kind: "dlr", color: "#00A4A7" },
  { key: "tram", code: "T1", name: "London Trams", displayName: "London Trams", family: "tram", kind: "tram", color: "#84B817" }
];

const TUBE_LINE_INFO = {
  piccadilly: { about: "Cross-London Underground route linking Heathrow and west London with the West End, King's Cross and north-east London.", background: "Opened in 1906 as the Great Northern, Piccadilly and Brompton Railway. Later extensions created today's Uxbridge and Heathrow branches." },
  district: { about: "A broad sub-surface network across west, central and east London, with several branches and many useful interchange stations.", background: "The District Railway opened in 1868 and became one of the foundations of today's Underground network." },
  circle: { about: "Central London line linking major rail terminals and inner-city districts in a loop-like service with a western extension to Hammersmith.", background: "Its roots are in the Metropolitan and District railways. The Circle name became a distinct line identity in the twentieth century and the service pattern changed in 2009." },
  central: { about: "Fast east-west Underground route through Oxford Circus, Tottenham Court Road, the City and Stratford.", background: "The Central London Railway opened in 1900 and was later extended far into east and west London." },
  jubilee: { about: "Modern cross-London route linking north-west London, the West End, Waterloo, Canary Wharf and Stratford.", background: "The Jubilee line opened in 1979. Its major extension through Docklands to Stratford opened in 1999." },
  northern: { about: "Large north-south Underground network with multiple branches through the West End and City.", background: "The line grew from several early deep-level railways and received the Northern line name in 1937." },
  victoria: { about: "High-frequency north-south route through major interchanges including Victoria, Oxford Circus, King's Cross St Pancras and Euston.", background: "Built largely as a new post-war Underground line, it opened in stages from 1968 to 1971." },
  bakerloo: { about: "North-west to central London route serving Paddington, Baker Street, Oxford Circus, Waterloo and Elephant & Castle.", background: "It opened in 1906 as the Baker Street and Waterloo Railway; its nickname quickly became the official Bakerloo name." },
  metropolitan: { about: "Sub-surface route from central London towards north-west London and the outer suburbs, with fast sections beyond the centre.", background: "Its predecessor opened in 1863 as the world's first underground passenger railway." },
  "hammersmith-city": { about: "Sub-surface route linking Hammersmith with Paddington, King's Cross, the City and east London.", background: "The route has nineteenth-century origins; Hammersmith & City became a separate line identity on the Tube map in 1990." },
  "waterloo-city": { about: "Very short shuttle connecting Waterloo with Bank in the City, aimed mainly at commuter flows.", background: "Opened in 1898, it remains one of the shortest and most specialised lines on the network." }
};

const SURFACE_LINE_INFO = {
  elizabeth: { about: "High-capacity east-west railway linking Reading and Heathrow with central London, Canary Wharf, Stratford and Shenfield.", background: "The central tunnels opened in 2022 as the Elizabeth line, creating a new cross-London railway named in honour of Queen Elizabeth II." },
  lioness: { about: "London Overground route between Euston and Watford Junction through north-west London and Wembley.", background: "The Lioness name honours the England women's football team and its legacy, especially its 2022 European Championship triumph at Wembley." },
  mildmay: { about: "London Overground route linking Richmond and Clapham Junction with Stratford through north and east London.", background: "The Mildmay name celebrates the charitable hospital known for caring for Londoners and for its important work during the HIV/AIDS crisis." },
  windrush: { about: "London Overground route connecting Highbury & Islington with south and south-east London branches.", background: "The Windrush name honours Caribbean communities and the Windrush generation whose contribution has shaped modern London." },
  weaver: { about: "London Overground services from Liverpool Street towards Enfield Town, Cheshunt and Chingford.", background: "The Weaver name reflects the textile and garment history of east London and the migrant communities that built those industries." },
  suffragette: { about: "London Overground route between Gospel Oak and Barking Riverside across north and east London.", background: "The Suffragette name honours the East London movement for women's voting rights and working-class women's activism." },
  liberty: { about: "Short London Overground route between Romford and Upminster in east London.", background: "The Liberty name refers to Havering's historic royal liberty and celebrates the area's tradition of local independence." },
  dlr: { about: "Automated light metro serving Docklands, the City fringe, Stratford, Greenwich and east London.", background: "The Docklands Light Railway opened in 1987 and expanded alongside the regeneration of London's former docklands." },
  tram: { about: "Street-running and segregated light-rail network centred on Croydon, linking south London communities with major rail interchanges.", background: "The modern London tram network opened in 2000, restoring tram operation to London after the original system had disappeared in the 1950s." },
  national: { about: "National Rail service entering London from the wider UK rail network.", background: "London's mainline railways were built by several historic companies, leaving the capital with multiple major terminal stations and corridors." }
};

const STATION_BACKGROUND = {
  paddington: { descriptor: "Airport gateway & major rail hub", about: "Major west London interchange for the Elizabeth line, Underground and National Rail, with direct rail access towards Heathrow and western England.", background: "The present Paddington terminus was designed by Isambard Kingdom Brunel and opened in the nineteenth century for the Great Western Railway." },
  "kingscrossstpancras": { descriptor: "International & major rail hub", about: "One of London's biggest interchange complexes, connecting multiple Underground lines with King's Cross, St Pancras International and long-distance rail.", background: "King's Cross and St Pancras opened as neighbouring nineteenth-century termini; St Pancras later became London's Eurostar gateway." },
  victoria: { descriptor: "Major rail & coach hub", about: "Central London interchange connecting National Rail, Underground and nearby coach services, useful for south London and Gatwick-bound travel.", background: "Victoria station developed in the 1860s as two adjoining termini and later became one of London's busiest transport hubs." },
  waterloo: { descriptor: "Major rail hub", about: "Large south-bank terminus with extensive National Rail service and several Underground connections.", background: "Waterloo opened in 1848 and grew into Britain's largest station by platform count." },
  euston: { descriptor: "Major intercity rail hub", about: "Central London terminus for West Coast services with nearby Underground connections.", background: "Euston opened in 1837 as London's first intercity railway terminus and has been rebuilt several times." },
  liverpoolstreet: { descriptor: "Major rail & City hub", about: "Major City of London interchange for National Rail, Elizabeth line and Underground services.", background: "Liverpool Street station opened in 1874 and became a principal gateway for routes into east London and East Anglia." },
  londonbridge: { descriptor: "Major rail & Underground hub", about: "Major interchange south of the Thames serving National Rail and the Jubilee and Northern lines.", background: "London Bridge is one of the capital's oldest railway termini, first opening in 1836." },
  southkensington: { descriptor: "Museum district transfer station", about: "Key west-central London transfer station for Piccadilly, District and Circle services, close to Imperial College and the major South Kensington museums.", background: "The station opened in the nineteenth century with the early sub-surface railways; deep-level Piccadilly services arrived in the early twentieth century." },
  heathrowterminals23: { descriptor: "Airport rail station", about: "Rail and Underground station serving Heathrow Terminals 2 and 3, with Elizabeth line and Piccadilly line connections to central London.", background: "Rail links to Heathrow expanded over several decades as the airport grew into the UK's largest international aviation hub." }
};

layerState.tram = false;

let surfaceLineById = new Map();
let surfaceGeometryRegistry = new Map();
let surfaceStationRegistry = new Map();
let surfaceRenderings = [];
let surfaceStationOverlays = [];
let surfaceLabelOverlays = [];
let SurfaceStationOverlay;
let SurfaceLineLabelOverlay;
let surfaceCoreLoaded = false;
let nationalRailLoaded = false;
let nationalRailPromise = null;
let transientTransportSelection = null;
let persistentTransportFocus = null;
let surfaceLabelRefreshTimer = null;

function surfacePresetForApiLine(apiLine) {
  const hay = normalizeSearch(`${apiLine?.id || ""} ${apiLine?.name || ""} ${apiLine?.modeName || ""}`);
  let preset = SURFACE_LINE_PRESETS.find(item => hay.includes(item.key));

  if (!preset && apiLine?.modeName === "national-rail") {
    return {
      id: `rail:nr:${apiLine.id}`,
      apiId: apiLine.id,
      code: "NR",
      name: apiLine.name || apiLine.id,
      displayName: apiLine.name || apiLine.id,
      family: "rail",
      kind: "national",
      color: "#AAB2BD",
      modeName: "national-rail"
    };
  }

  if (!preset) return null;
  return {
    ...preset,
    id: `${preset.family}:${preset.key}`,
    apiId: apiLine.id,
    modeName: apiLine.modeName
  };
}

function surfaceLineSort(a, b) {
  const rank = line => {
    if (line.code?.startsWith("R")) return Number(line.code.slice(1)) || 50;
    if (line.code?.startsWith("T")) return 100 + (Number(line.code.slice(1)) || 1);
    return 200;
  };
  return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
}

function formatSurfaceLineName(line) {
  return `${line.code} · ${line.displayName || line.name}`;
}

function shouldIncludeNationalRailOperator(apiLine) {
  const hay = normalizeSearch(`${apiLine?.id || ""} ${apiLine?.name || ""}`);
  return NATIONAL_RAIL_OPERATOR_HINTS.some(hint => hay.includes(normalizeSearch(hint)));
}

function clearSurfaceNetwork() {
  surfaceRenderings.forEach(item => item.polyline.setMap(null));
  surfaceStationOverlays.forEach(item => item.setMap(null));
  surfaceLabelOverlays.forEach(item => item.setMap(null));
  surfaceRenderings = [];
  surfaceStationOverlays = [];
  surfaceLabelOverlays = [];
  surfaceLineById = new Map();
  surfaceGeometryRegistry = new Map();
  surfaceStationRegistry = new Map();
  surfaceCoreLoaded = false;
  nationalRailLoaded = false;
  nationalRailPromise = null;
}

async function loadTubeNetwork(force = false) {
  await loadTubeNetworkCore(force);
  linkSurfaceStationsToTube();
  applyLayerState();
}

async function loadSurfaceNetworks(force = false) {
  if (force) clearSurfaceNetwork();
  if (surfaceCoreLoaded && !force) return;

  try {
    setNetworkStatus("Loading Rail + Tram network…");
    const res = await fetch(`https://api.tfl.gov.uk/Line/Mode/${SURFACE_CORE_MODES}`);
    if (!res.ok) throw new Error(`TfL surface-line request returned ${res.status}`);
    const apiLines = await res.json();
    const profiles = (Array.isArray(apiLines) ? apiLines : [])
      .map(surfacePresetForApiLine)
      .filter(Boolean)
      .sort(surfaceLineSort);

    const results = await Promise.allSettled(profiles.map(line => loadSurfaceLineData(line, force)));
    results.filter(item => item.status === "fulfilled").forEach(item => ingestSurfaceLineData(item.value));
    const failures = results.filter(item => item.status === "rejected");
    if (failures.length) console.warn("Some Rail/Tram services failed to load", failures);

    surfaceCoreLoaded = surfaceLineById.size > 0;
    renderSurfaceLines();
    buildSurfaceStationNodes();
    rebuildSurfaceLabels();
    linkSurfaceStationsToTube();
    applyLayerState();
    refreshSearchIfOpen();

    setNetworkStatus(surfaceCoreLoaded ? "Transit ready · Metro + Rail + Tram" : "Metro ready · Rail/Tram unavailable", !surfaceCoreLoaded);
  } catch (err) {
    console.warn("Rail/Tram load failed", err);
    setNetworkStatus("Metro ready · Rail/Tram unavailable", true);
  }
}

async function ensureNationalRailLoaded(force = false) {
  if (nationalRailLoaded && !force) return;
  if (nationalRailPromise && !force) return nationalRailPromise;

  nationalRailPromise = (async () => {
    try {
      const res = await fetch("https://api.tfl.gov.uk/Line/Mode/national-rail");
      if (!res.ok) throw new Error(`National Rail request returned ${res.status}`);
      const apiLines = await res.json();
      const profiles = (Array.isArray(apiLines) ? apiLines : [])
        .filter(shouldIncludeNationalRailOperator)
        .map(surfacePresetForApiLine)
        .filter(Boolean);

      const results = await Promise.allSettled(profiles.map(line => loadSurfaceLineData(line, force)));
      results.filter(item => item.status === "fulfilled").forEach(item => ingestSurfaceLineData(item.value));
      nationalRailLoaded = true;
      renderSurfaceLines();
      buildSurfaceStationNodes();
      rebuildSurfaceLabels();
      linkSurfaceStationsToTube();
      applyLayerState();
      refreshSearchIfOpen();
      showToast("National Rail corridors added.", 1800);
    } catch (err) {
      console.warn("National Rail load failed", err);
      showToast("National Rail data is temporarily unavailable.", 3200);
    } finally {
      nationalRailPromise = null;
    }
  })();

  return nationalRailPromise;
}

async function loadSurfaceLineData(line, force = false) {
  const cacheKey = `${SURFACE_CACHE_PREFIX}${line.apiId}`;
  if (!force) {
    const cached = getCache(cacheKey);
    if (cached) return { line, ...cached };
  }

  const sequenceUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.apiId)}/Route/Sequence/all?serviceTypes=Regular&excludeCrowding=true`;
  const stopsUrl = `https://api.tfl.gov.uk/Line/${encodeURIComponent(line.apiId)}/StopPoints`;
  const [sequenceRes, stopsRes] = await Promise.all([
    fetch(sequenceUrl, { headers: { Accept: "application/json" } }),
    fetch(stopsUrl, { headers: { Accept: "application/json" } })
  ]);

  if (!sequenceRes.ok || !stopsRes.ok) throw new Error(`TfL request failed for ${line.displayName}`);
  const sequence = await sequenceRes.json();
  const stops = await stopsRes.json();

  let geometries = [];
  for (const encoded of (sequence.lineStrings || [])) {
    for (const path of parseLineString(encoded)) {
      const smoothed = line.kind === "tram" ? smoothGeographicPath(path, 3) : smoothGeographicPath(path, 4);
      if (line.kind === "national") geometries.push(...clipPathToLondon(smoothed));
      else geometries.push(smoothed);
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
      modes: stop.modes || []
    })).filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
  };

  setCache(cacheKey, simplified);
  return { line, ...simplified };
}

function clipPathToLondon(path) {
  const result = [];
  let current = [];
  const inside = point => point.lat >= LONDON_RAIL_BOUNDS.south && point.lat <= LONDON_RAIL_BOUNDS.north && point.lng >= LONDON_RAIL_BOUNDS.west && point.lng <= LONDON_RAIL_BOUNDS.east;

  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (inside(point)) {
      if (!current.length && i > 0) current.push(path[i - 1]);
      current.push(point);
    } else if (current.length) {
      current.push(point);
      if (current.length >= 2) result.push(current);
      current = [];
    }
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function ingestSurfaceLineData(data) {
  const { line, geometries, stops } = data;
  surfaceLineById.set(line.id, line);
  const existingGeometry = surfaceGeometryRegistry.get(line.id) || [];
  existingGeometry.push(...(geometries || []));
  surfaceGeometryRegistry.set(line.id, existingGeometry);

  for (const stop of (stops || [])) {
    if (line.kind === "national" && !pointInsideLondon(stop)) continue;
    const key = stop.hubNaptanCode || stop.stationNaptan || stop.id || `${normalizeStationName(stop.name)}-${stop.lat.toFixed(4)}-${stop.lon.toFixed(4)}`;
    const existing = surfaceStationRegistry.get(key) || {
      id: key,
      name: cleanStationName(stop.name),
      lat: stop.lat,
      lon: stop.lon,
      modes: new Set(stop.modes || []),
      services: []
    };
    if (!existing.services.some(service => service.id === line.id)) existing.services.push(line);
    (stop.modes || []).forEach(mode => existing.modes.add(mode));
    surfaceStationRegistry.set(key, existing);
  }
}

function pointInsideLondon(point) {
  return Number(point.lat) >= LONDON_RAIL_BOUNDS.south && Number(point.lat) <= LONDON_RAIL_BOUNDS.north && Number(point.lon ?? point.lng) >= LONDON_RAIL_BOUNDS.west && Number(point.lon ?? point.lng) <= LONDON_RAIL_BOUNDS.east;
}

function initSurfaceOverlayClasses() {
  if (SurfaceStationOverlay) return;

  SurfaceStationOverlay = class SurfaceStationOverlay extends HtmlOverlay {
    constructor(station) {
      const primaryFamily = station.services.some(service => service.family === "tram") && !station.services.some(service => service.family === "rail") ? "tram" : "rail";
      super({ lat: station.lat, lng: station.lon }, `surface-station-node ${primaryFamily}-station-node`);
      this.station = station;
    }

    onAdd() {
      super.onAdd();
      const services = this.station.services.slice().sort(surfaceLineSort);
      this.div.style.setProperty("--station-color", surfaceStationNodeBackground(services));
      this.div.style.background = surfaceStationNodeBackground(services);
      this.div.classList.toggle("multi-service", services.length > 1);
      this.div.title = `${this.station.name} — ${services.map(formatSurfaceLineName).join(" · ")}`;
      this.div.innerHTML = `
        <div class="station-hover-card">
          <div class="station-hover-title">${escapeHtml(this.station.name)}</div>
          ${services.map(line => `<div class="station-hover-line"><i class="station-hover-swatch" style="background:${line.color}"></i><span>${escapeHtml(formatSurfaceLineName(line))}</span></div>`).join("")}
        </div>`;
      this.div.addEventListener("click", event => {
        event.stopPropagation();
        selectSurfaceStation(this.station, { showInfo: true });
      });
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
  };

  SurfaceLineLabelOverlay = class SurfaceLineLabelOverlay extends LineLabelOverlay {
    onAdd() {
      super.onAdd();
      this.div.classList.add("surface-line-label");
      this.div.classList.add(this.line.family === "tram" ? "tram-line-label" : "rail-line-label");
    }
  };
}

function surfaceStationNodeBackground(services) {
  if (!services?.length) return "#D7DCE3";
  if (services.length === 1) return services[0].color;
  const step = 100 / services.length;
  const stops = services.flatMap((service, index) => [`${service.color} ${(index * step).toFixed(2)}%`, `${service.color} ${((index + 1) * step).toFixed(2)}%`]);
  return `conic-gradient(${stops.join(",")})`;
}

function renderSurfaceLines() {
  surfaceRenderings.forEach(item => item.polyline.setMap(null));
  surfaceRenderings = [];

  for (const line of [...surfaceLineById.values()].sort(surfaceLineSort)) {
    const geometries = surfaceGeometryRegistry.get(line.id) || [];
    for (const path of geometries) {
      if (!Array.isArray(path) || path.length < 2) continue;
      renderSurfacePath(line, path);
    }
  }
}

function renderSurfacePath(line, path) {
  if (line.kind === "tram") {
    const band = new google.maps.Polyline({ map, path, strokeColor: line.color, strokeOpacity: 0, strokeWeight: 9, zIndex: 24, clickable: false, visible: false });
    const main = new google.maps.Polyline({ map, path, strokeColor: line.color, strokeOpacity: 0, strokeWeight: 2.8, zIndex: 25, clickable: false, visible: false });
    surfaceRenderings.push({ polyline: band, line, role: "tram-band" }, { polyline: main, line, role: "main" });
  } else if (line.kind === "dlr") {
    const dashed = new google.maps.Polyline({
      map, path, strokeOpacity: 0, strokeWeight: 0, zIndex: 26, clickable: false, visible: false,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeColor: line.color, strokeOpacity: 1, strokeWeight: 3.2, scale: 3 }, offset: "0", repeat: "14px" }]
    });
    surfaceRenderings.push({ polyline: dashed, line, role: "dlr-dash" });
  } else {
    const outer = new google.maps.Polyline({ map, path, strokeColor: line.color, strokeOpacity: 0, strokeWeight: line.kind === "national" ? 5 : 7, zIndex: 24, clickable: false, visible: false });
    const inner = new google.maps.Polyline({ map, path, strokeColor: "#0B1017", strokeOpacity: 0, strokeWeight: line.kind === "national" ? 2 : 2.8, zIndex: 25, clickable: false, visible: false });
    surfaceRenderings.push({ polyline: outer, line, role: "rail-outer" }, { polyline: inner, line, role: "rail-inner" });
  }

  const hit = new google.maps.Polyline({ map, path, strokeColor: line.color, strokeOpacity: 0.001, strokeWeight: 20, zIndex: 60, clickable: true, visible: false });
  hit.addListener("click", () => selectSurfaceLine(line.id, { showInfo: true }));
  surfaceRenderings.push({ polyline: hit, line, role: "hit" });
}

function buildSurfaceStationNodes() {
  surfaceStationOverlays.forEach(item => item.setMap(null));
  surfaceStationOverlays = [];
  for (const station of surfaceStationRegistry.values()) {
    station.services.sort(surfaceLineSort);
    const overlay = new SurfaceStationOverlay(station);
    overlay.setMap(map);
    overlay.setVisible(false);
    surfaceStationOverlays.push(overlay);
  }
}

function rebuildSurfaceLabels() {
  surfaceLabelOverlays.forEach(item => item.setMap(null));
  surfaceLabelOverlays = [];
  if (!map) return;
  const zoom = map.getZoom() || 12;
  const spacing = Math.max(1.6, lineLabelSpacingKm(zoom) * 1.2);

  for (const line of surfaceLineById.values()) {
    let count = 0;
    const seen = new Set();
    for (const path of (surfaceGeometryRegistry.get(line.id) || [])) {
      for (const sample of samplePathForLabels(path, spacing)) {
        const key = `${Math.round(sample.position.lat / 0.007)}:${Math.round(sample.position.lng / 0.010)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = new SurfaceLineLabelOverlay(sample.position, sample.nextPosition, line);
        label.setMap(map);
        label.setVisible(false);
        surfaceLabelOverlays.push(label);
        count += 1;
        if (count >= (line.kind === "national" ? 10 : 24)) break;
      }
      if (count >= (line.kind === "national" ? 10 : 24)) break;
    }
  }
}

function scheduleLineLabelRefresh() {
  clearTimeout(lineLabelRefreshTimer);
  clearTimeout(surfaceLabelRefreshTimer);
  lineLabelRefreshTimer = setTimeout(() => { if (lineGeometryRegistry.size) rebuildLineLabels(); }, 180);
  surfaceLabelRefreshTimer = setTimeout(() => { if (surfaceGeometryRegistry.size) { rebuildSurfaceLabels(); applyLayerState(); } }, 220);
}

function linkSurfaceStationsToTube() {
  for (const station of stationRegistry.values()) station.surfaceServices = [];
  stationOverlays.forEach(overlay => { overlay.station.surfaceServices = []; });

  const tubeStations = [...stationRegistry.values()];
  for (const station of surfaceStationRegistry.values()) {
    station.tubeStationId = null;
    let best = null;
    let bestDistance = Infinity;
    const surfaceName = looseStationKey(station.name);

    for (const tube of tubeStations) {
      const tubeName = looseStationKey(tube.name);
      const nameCompatible = surfaceName === tubeName || surfaceName.includes(tubeName) || tubeName.includes(surfaceName);
      if (!nameCompatible) continue;
      const distance = haversineKm({ lat: station.lat, lng: station.lon }, { lat: tube.lat, lng: tube.lon });
      if (distance < bestDistance && distance <= 0.42) {
        bestDistance = distance;
        best = tube;
      }
    }

    if (!best) continue;
    station.tubeStationId = best.id;
    for (const service of station.services) {
      if (!best.surfaceServices.some(item => item.id === service.id)) best.surfaceServices.push(service);
    }
    const overlay = stationOverlays.find(item => item.station.id === best.id);
    if (overlay) {
      overlay.station.surfaceServices = best.surfaceServices.slice();
      overlay.div?.classList.toggle("surface-transfer", best.surfaceServices.length > 0);
    }
  }
}

function looseStationKey(name) {
  return normalizeStationName(name).replace(/^london/, "").replace(/international$/, "");
}

function getTransportSelection() {
  return persistentTransportFocus || transientTransportSelection;
}

function clearTransientTransportSelection() {
  if (!transientTransportSelection) return;
  transientTransportSelection = null;
  applyLayerState();
}

function clearPersistentTransportFocus() {
  if (!persistentTransportFocus) return;
  persistentTransportFocus = null;
  updateItemFocusChip();
  applyLayerState();
}

function setPersistentTransportFocus(selection) {
  persistentTransportFocus = { ...selection };
  transientTransportSelection = null;
  activeFavoriteRouteId = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  applyLayerState();
}

function updateItemFocusChip() {
  const chip = el("item-focus-chip");
  if (!chip) return;
  const selection = persistentTransportFocus;
  chip.classList.toggle("hidden", !selection);
  const name = chip.querySelector("[data-item-focus-name]");
  if (name) name.textContent = selection ? selection.label : "";
}

function selectMetroLine(lineId, options = {}) {
  const line = TUBE_LINE_BY_ID.get(lineId);
  if (!line) return;
  activeFavoriteRouteId = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  transientTransportSelection = { type: "line", family: "metro", id: lineId, label: formatLineName(line) };
  applyLayerState();
  if (options.fit) focusTubeLine(lineId);
  if (options.showInfo !== false) showLineInfo(line);
}

function selectSurfaceLine(lineId, options = {}) {
  const line = surfaceLineById.get(lineId);
  if (!line) return;
  activeFavoriteRouteId = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  transientTransportSelection = { type: "line", family: line.family, id: lineId, label: formatSurfaceLineName(line) };
  applyLayerState();
  if (options.fit) focusSurfaceLine(lineId);
  if (options.showInfo !== false) showSurfaceLineInfo(line);
}

function selectTubeStation(station, options = {}) {
  activeFavoriteRouteId = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  transientTransportSelection = { type: "station", family: "metro", id: station.id, label: station.name, station };
  applyLayerState();
  if (options.showInfo !== false) showStationInfo(station);
}

function selectSurfaceStation(station, options = {}) {
  activeFavoriteRouteId = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  transientTransportSelection = { type: "station", family: station.services.some(item => item.family === "rail") ? "rail" : "tram", id: station.id, label: station.name, station };
  applyLayerState();
  if (options.showInfo !== false) showSurfaceStationInfo(station);
}

function focusSurfaceLine(lineId) {
  const geometries = surfaceGeometryRegistry.get(lineId) || [];
  if (!geometries.length) return;
  const bounds = new google.maps.LatLngBounds();
  geometries.flat().forEach(point => bounds.extend(point));
  if (!bounds.isEmpty()) map.fitBounds(bounds, 44);
}

function transportSelectionMatchesMetroLine(selection, lineId) {
  return selection?.type === "line" && selection.family === "metro" && selection.id === lineId;
}

function transportSelectionMatchesSurfaceLine(selection, lineId) {
  return selection?.type === "line" && (selection.family === "rail" || selection.family === "tram") && selection.id === lineId;
}

function routeSurfaceLineIds(route) {
  const ids = [];
  for (const segment of (route?.segments || [])) {
    if (!["rail", "tram"].includes(segment.mode) || segment.kind === "station") continue;
    if (surfaceLineById.has(segment.service)) {
      ids.push(segment.service);
      continue;
    }
    const q = normalizeSearch(segment.service || segment.label || "");
    const match = [...surfaceLineById.values()].find(line => normalizeSearch(`${line.code} ${line.name} ${line.displayName} ${line.apiId}`).includes(q) || q.includes(normalizeSearch(line.name)));
    if (match) ids.push(match.id);
  }
  return [...new Set(ids)];
}

function routeStationSegments(route) {
  return (route?.segments || []).filter(segment => segment.kind === "station" && Number.isFinite(Number(segment.lat)) && Number.isFinite(Number(segment.lng)));
}

function activateFavoriteRoute(routeId, options = {}) {
  const route = favoriteRoutes.find(item => item.id === routeId);
  if (!route) return;
  activeFavoriteRouteId = route.id;
  transientTransportSelection = null;
  persistentTransportFocus = null;
  selectedMetroLineId = null;
  route.useCount = Number(route.useCount || 0) + 1;
  route.lastUsedAt = Date.now();
  saveFavoriteRoutes();

  const metroLines = routeMetroLineIds(route);
  const surfaceLines = routeSurfaceLineIds(route);
  layerState.metro = metroLines.length > 0;
  layerState.rail = surfaceLines.some(id => surfaceLineById.get(id)?.family === "rail");
  layerState.tram = surfaceLines.some(id => surfaceLineById.get(id)?.family === "tram");
  layerState.places = false;

  applyLayerState();
  updateRouteFocusChip();
  updateItemFocusChip();
  focusFavoriteRoute(route);
  if (options.showInfo !== false) showFavoriteRouteInfo(route);
  refreshSearchIfOpen();
}

function focusFavoriteRoute(route) {
  const bounds = new google.maps.LatLngBounds();
  routeMetroLineIds(route).forEach(id => (lineGeometryRegistry.get(id) || []).flat().forEach(point => bounds.extend(point)));
  routeSurfaceLineIds(route).forEach(id => (surfaceGeometryRegistry.get(id) || []).flat().forEach(point => bounds.extend(point)));
  routeStationSegments(route).forEach(segment => bounds.extend({ lat: Number(segment.lat), lng: Number(segment.lng) }));
  if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
}

function clearFavoriteRouteFocus() {
  if (!activeFavoriteRouteId) return;
  activeFavoriteRouteId = null;
  updateRouteFocusChip();
  applyLayerState();
}

function toggleLayer(name) {
  activeFavoriteRouteId = null;
  transientTransportSelection = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  layerState[name] = !layerState[name];
  applyLayerState();

  if (name === "rail" && layerState.rail && !nationalRailLoaded) {
    showToast("Loading major National Rail corridors in the background…", 2200);
    ensureNationalRailLoaded();
  }
}

function applyLayerState() {
  const route = getActiveFavoriteRoute();
  const selection = getTransportSelection();
  const routeMetro = new Set(routeMetroLineIds(route));
  const routeSurface = new Set(routeSurfaceLineIds(route));
  const routeStations = new Set(routeStationSegments(route).map(segment => segment.stationId));
  const hasRoute = !!route;
  const hasSelection = !!selection;

  const normalMetroVisible = layerState.metro && !hasRoute && !hasSelection;
  const metroFocus = normalMetroVisible && !layerState.rail && !layerState.tram && !layerState.places;
  const metroMode = metroFocus ? "focus" : "minimal";

  lineRenderings.forEach(item => {
    const { polyline, line, role } = item;
    let visible = false;
    let strong = false;

    if (hasSelection) {
      visible = transportSelectionMatchesMetroLine(selection, line.id);
      strong = visible;
    } else if (hasRoute) {
      visible = routeMetro.has(line.id);
      strong = visible;
    } else {
      visible = layerState.metro;
      strong = metroFocus;
    }

    polyline.setVisible(visible);
    if (!visible) return;
    if (role === "hit") {
      polyline.setOptions({ strokeOpacity: 0.001, strokeWeight: 20, zIndex: 72 });
    } else if (role === "casing") {
      polyline.setOptions({ strokeOpacity: strong ? 0.92 : 0.18, strokeWeight: strong ? 9 : 4.6, zIndex: strong ? 43 : 12 });
    } else {
      polyline.setOptions({ strokeOpacity: strong ? 0.98 : 0.20, strokeWeight: strong ? 6.4 : 2.8, zIndex: strong ? 45 : 13 });
    }
  });

  stationOverlays.forEach(overlay => {
    let visible = false;
    if (hasSelection) {
      if (selection.type === "line" && selection.family === "metro") visible = overlay.station.lines.some(line => line.id === selection.id);
      if (selection.type === "station" && selection.family === "metro") visible = overlay.station.id === selection.id;
    } else if (hasRoute) {
      visible = overlay.station.lines.some(line => routeMetro.has(line.id)) || routeStations.has(overlay.station.id);
    } else {
      visible = layerState.metro;
    }
    overlay.setVisible(visible);
    overlay.setMode(hasSelection || hasRoute || metroFocus ? "focus" : metroMode);
    overlay.setHighlightedLines(null);
  });

  lineLabelOverlays.forEach(overlay => {
    let visible = false;
    if (hasSelection) visible = selection.type === "line" && selection.family === "metro" && selection.id === overlay.line.id;
    else if (hasRoute) visible = routeMetro.has(overlay.line.id);
    else visible = layerState.metro;
    overlay.setVisible(visible);
    overlay.setMode(hasSelection || hasRoute || metroFocus ? "focus" : metroMode);
    overlay.setHighlightedLines(null);
  });

  surfaceRenderings.forEach(item => {
    const { polyline, line, role } = item;
    let visible = false;
    let strong = false;
    if (hasSelection) {
      visible = transportSelectionMatchesSurfaceLine(selection, line.id);
      strong = visible;
    } else if (hasRoute) {
      visible = routeSurface.has(line.id);
      strong = visible;
    } else {
      visible = line.family === "rail" ? layerState.rail : layerState.tram;
      strong = visible;
    }
    polyline.setVisible(visible);
    if (!visible) return;
    applySurfacePolylineStyle(item, strong, hasSelection || hasRoute);
  });

  surfaceStationOverlays.forEach(overlay => {
    const station = overlay.station;
    let visible = false;
    if (hasSelection) {
      if (selection.type === "line" && ["rail", "tram"].includes(selection.family)) visible = station.services.some(service => service.id === selection.id);
      if (selection.type === "station" && ["rail", "tram"].includes(selection.family)) visible = station.id === selection.id;
    } else if (hasRoute) {
      visible = station.services.some(service => routeSurface.has(service.id)) || routeStations.has(station.id);
    } else {
      visible = station.services.some(service => service.family === "rail" ? layerState.rail : layerState.tram);
      if (visible && station.tubeStationId && layerState.metro) visible = false;
    }
    overlay.setVisible(visible);
  });

  surfaceLabelOverlays.forEach(overlay => {
    const line = overlay.line;
    let visible = false;
    if (hasSelection) visible = selection.type === "line" && selection.id === line.id;
    else if (hasRoute) visible = routeSurface.has(line.id);
    else visible = line.family === "rail" ? layerState.rail : layerState.tram;
    overlay.setVisible(visible);
    overlay.setMode("focus");
    overlay.setHighlightedLines(null);
  });

  placeOverlays.forEach(overlay => overlay.setVisible(layerState.places && !hasRoute && !hasSelection));

  setLayerButtonState("metro", layerState.metro && !hasRoute && !hasSelection);
  setLayerButtonState("rail", layerState.rail && !hasRoute && !hasSelection);
  setLayerButtonState("tram", layerState.tram && !hasRoute && !hasSelection);
  setLayerButtonState("places", layerState.places && !hasRoute && !hasSelection);

  updateRouteFocusChip();
  updateItemFocusChip();
  applyBaseMapStyle();
}

function applySurfacePolylineStyle(item, strong = true, focused = false) {
  const { polyline, line, role } = item;
  const opacity = focused ? 1 : 0.88;
  if (role === "hit") {
    polyline.setOptions({ strokeOpacity: 0.001, strokeWeight: 20, zIndex: 72 });
    return;
  }
  if (role === "tram-band") {
    polyline.setOptions({ strokeOpacity: focused ? 0.44 : 0.30, strokeWeight: focused ? 11 : 8, zIndex: 24 });
    return;
  }
  if (role === "main") {
    polyline.setOptions({ strokeOpacity: opacity, strokeWeight: focused ? 3.5 : 2.8, zIndex: 26 });
    return;
  }
  if (role === "dlr-dash") {
    polyline.setOptions({ zIndex: focused ? 47 : 27 });
    return;
  }
  if (role === "rail-outer") {
    polyline.setOptions({ strokeOpacity: opacity, strokeWeight: line.kind === "national" ? (focused ? 6 : 5) : (focused ? 9 : 7), zIndex: focused ? 46 : 24 });
    return;
  }
  if (role === "rail-inner") {
    polyline.setOptions({ strokeOpacity: focused ? 0.96 : 0.86, strokeWeight: line.kind === "national" ? 2 : 2.8, zIndex: focused ? 47 : 25 });
  }
}

function setLayerButtonState(name, active) {
  const button = el(`${name}-btn`);
  if (!button) return;
  button.classList.toggle("active", !!active);
  button.setAttribute("aria-pressed", String(!!active));
}

function applyBaseMapStyle() {
  if (!map || activeMapType !== "roadmap") return;
  const selection = getTransportSelection();
  const metroFocus = !selection && !getActiveFavoriteRoute() && layerState.metro && !layerState.rail && !layerState.tram && !layerState.places;
  map.setOptions({ styles: metroFocus ? METRO_FOCUS_MAP_STYLES : [] });
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
  geocoder = new google.maps.Geocoder();
  initSurfaceOverlayClasses();
  createPlaceMarkers();
  loadTubeNetwork();
  /* v1.3F: Rail/Tram load lazily when toggled to reduce startup lag. */
  applyLayerState();

  map.addListener("click", event => {
    if (pendingTapPlace && event.latLng) {
      pendingTapPlace = false;
      openPlaceEditor({ lat: event.latLng.lat(), lng: event.latLng.lng() });
      return;
    }
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
  setNetworkStatus("Loading London transport…");
}

function showMapInfo() {
  const active = [];
  if (layerState.metro) active.push("Metro");
  if (layerState.rail) active.push("Rail");
  if (layerState.tram) active.push("Tram");
  if (layerState.places) active.push("Places");
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">MAP INFORMATION</div>
    <h2>${active.length ? escapeHtml(active.join(" + ")) : "Vanilla Google Maps"}</h2>
    <div class="sub">v1.3D adds London rail and tram overlays plus temporary and persistent transport focus.</div>
    <div class="detail-section">
      <div class="info-row"><span>Metro</span><b>${layerState.metro ? "On" : "Off"}</b></div>
      <div class="info-row"><span>Rail</span><b>${layerState.rail ? "On" : "Off"}</b></div>
      <div class="info-row"><span>Tram</span><b>${layerState.tram ? "On" : "Off"}</b></div>
      <div class="info-row"><span>Frequent Places</span><b>${layerState.places ? "On" : "Off"}</b></div>
      <div class="info-row"><span>Loaded Rail/Tram services</span><b>${surfaceLineById.size}</b></div>
    </div>
    <div class="detail-section sub">M = Underground learning aliases. R = London urban rail. NR = National Rail. T = Tram.</div>`;
  openDetail();
}

function showLineInfo(line) {
  const profile = TUBE_LINE_INFO[line.id] || {};
  const stationCount = [...stationRegistry.values()].filter(station => station.lines.some(item => item.id === line.id)).length;
  const content = el("detail-content");
  content.innerHTML = transportInfoHtml({
    label: "METRO LINE",
    title: formatLineName(line),
    subtitle: "London Underground",
    about: profile.about || `${line.name} is part of the London Underground network.`,
    background: profile.background || "This line developed as part of London's expanding Underground network.",
    facts: [
      ["Learning alias", line.code], ["Official name", line.name], ["Stations on map", stationCount || "—"]
    ],
    focusLabel: "Focus line",
    routeLabel: "Add line to Route"
  });
  bindTransportInfoActions(
    () => setPersistentTransportFocus({ type: "line", family: "metro", id: line.id, label: formatLineName(line) }),
    () => startRouteWithSegment({ mode: "metro", service: line.id, kind: "line", label: formatLineName(line) })
  );
  openDetail();
}

function showSurfaceLineInfo(line) {
  const profile = surfaceInfoForLine(line);
  const stationCount = [...surfaceStationRegistry.values()].filter(station => station.services.some(item => item.id === line.id)).length;
  const content = el("detail-content");
  const type = line.kind === "tram" ? "TRAM LINE" : line.kind === "national" ? "NATIONAL RAIL" : "RAIL LINE";
  content.innerHTML = transportInfoHtml({
    label: type,
    title: formatSurfaceLineName(line),
    subtitle: line.kind === "dlr" ? "Docklands Light Railway · Automated Rail" : line.kind === "overground" ? "London Overground" : line.kind === "national" ? "National Rail operator" : line.kind === "elizabeth" ? "Cross-London railway" : "London Trams",
    about: profile.about,
    background: profile.background,
    facts: [["Map code", line.code], ["Official name", line.displayName || line.name], ["Stations on map", stationCount || "—"]],
    focusLabel: "Focus line",
    routeLabel: "Add line to Route"
  });
  bindTransportInfoActions(
    () => setPersistentTransportFocus({ type: "line", family: line.family, id: line.id, label: formatSurfaceLineName(line) }),
    () => startRouteWithSegment({ mode: line.family === "tram" ? "tram" : "rail", service: line.id, kind: "line", label: formatSurfaceLineName(line) })
  );
  openDetail();
}

function surfaceInfoForLine(line) {
  if (line.kind === "national") return SURFACE_LINE_INFO.national;
  return SURFACE_LINE_INFO[line.key] || SURFACE_LINE_INFO[line.kind] || SURFACE_LINE_INFO[line.name?.toLowerCase()] || { about: `${line.displayName || line.name} is part of London's surface transport network.`, background: "This service forms part of London's modern rail network." };
}

function transportInfoHtml({ label, title, subtitle, about, background, facts = [], focusLabel, routeLabel }) {
  return `
    <div class="detail-label">${escapeHtml(label)}</div>
    <h2>${escapeHtml(title)}</h2>
    <div class="sub">${escapeHtml(subtitle)}</div>
    <div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(about)}</p></div>
    <div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(background)}</p></div>
    <div class="detail-section">${facts.map(([name, value]) => `<div class="info-row"><span>${escapeHtml(name)}</span><b>${escapeHtml(String(value))}</b></div>`).join("")}</div>
    <div class="detail-actions compact-action-row">
      <button class="secondary-btn compact-btn" id="focus-transport-btn">${escapeHtml(focusLabel)}</button>
      <button class="primary-btn compact-btn" id="route-add-transport-btn">${escapeHtml(routeLabel)}</button>
    </div>`;
}

function bindTransportInfoActions(focusAction, routeAction) {
  el("detail-content").querySelector("#focus-transport-btn")?.addEventListener("click", () => { focusAction(); showToast("Focus stays active until you tap Exit focus."); });
  el("detail-content").querySelector("#route-add-transport-btn")?.addEventListener("click", routeAction);
}

async function showStationInfo(station) {
  selectTubeStationSilentlyIfNeeded(station);
  const lines = (station.lines || []).slice().sort(compareTubeLines);
  const surface = (station.surfaceServices || []).slice().sort(surfaceLineSort);
  const profile = stationProfile(station.name, [...lines, ...surface]);
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">${lines.length > 1 || surface.length ? "TRANSFER STATION" : "METRO STATION"}</div>
    <h2>${escapeHtml(station.name)}</h2>
    <div class="sub">${escapeHtml(profile.descriptor)}</div>
    <div class="chips">
      ${lines.map(line => `<button class="line-chip line-chip-button" data-metro-line-id="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(formatLineName(line))}</button>`).join("")}
      ${surface.map(line => `<button class="line-chip line-chip-button" data-surface-line-id="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(formatSurfaceLineName(line))}</button>`).join("")}
    </div>
    <div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div>
    <div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div>
    <div class="detail-section"><div class="detail-label">BUS INTEGRATION</div><div id="bus-info" class="sub">Checking nearby bus stops…</div></div>
    <div class="detail-actions compact-action-row">
      <button class="secondary-btn compact-btn" id="focus-station-btn">Focus station</button>
      <button class="primary-btn compact-btn" id="route-add-station-btn">Add station to Route</button>
    </div>`;
  openDetail();

  content.querySelectorAll("[data-metro-line-id]").forEach(button => button.addEventListener("click", () => selectMetroLine(button.dataset.metroLineId, { showInfo: true })));
  content.querySelectorAll("[data-surface-line-id]").forEach(button => button.addEventListener("click", () => selectSurfaceLine(button.dataset.surfaceLineId, { showInfo: true })));
  content.querySelector("#focus-station-btn")?.addEventListener("click", () => setPersistentTransportFocus({ type: "station", family: "metro", id: station.id, label: station.name, station }));
  content.querySelector("#route-add-station-btn")?.addEventListener("click", () => startRouteWithSegment({ mode: "metro", service: `station:${station.id}`, kind: "station", stationId: station.id, label: `${station.name} station`, lat: station.lat, lng: station.lon }));
  updateBusIntegration(station.lat, station.lon);
}

function selectTubeStationSilentlyIfNeeded(station) {
  if (!transientTransportSelection && !persistentTransportFocus) transientTransportSelection = { type: "station", family: "metro", id: station.id, label: station.name, station };
  applyLayerState();
}

async function showSurfaceStationInfo(station) {
  const services = station.services.slice().sort(surfaceLineSort);
  const tube = station.tubeStationId ? stationRegistry.get(station.tubeStationId) : null;
  const tubeLines = tube?.lines?.slice().sort(compareTubeLines) || [];
  const profile = stationProfile(station.name, [...tubeLines, ...services]);
  const primaryFamily = services.some(item => item.family === "rail") ? "rail" : "tram";
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">${services.some(item => item.kind === "national") ? "RAIL STATION" : primaryFamily === "tram" ? "TRAM STOP" : "TRANSPORT STATION"}</div>
    <h2>${escapeHtml(station.name)}</h2>
    <div class="sub">${escapeHtml(profile.descriptor)}</div>
    <div class="chips">
      ${tubeLines.map(line => `<button class="line-chip line-chip-button" data-metro-line-id="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(formatLineName(line))}</button>`).join("")}
      ${services.map(line => `<button class="line-chip line-chip-button" data-surface-line-id="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(formatSurfaceLineName(line))}</button>`).join("")}
    </div>
    <div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div>
    <div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div>
    <div class="detail-section"><div class="detail-label">BUS INTEGRATION</div><div id="bus-info" class="sub">Checking nearby bus stops…</div></div>
    <div class="detail-actions compact-action-row">
      <button class="secondary-btn compact-btn" id="focus-station-btn">Focus station</button>
      <button class="primary-btn compact-btn" id="route-add-station-btn">Add station to Route</button>
    </div>`;
  openDetail();
  content.querySelectorAll("[data-metro-line-id]").forEach(button => button.addEventListener("click", () => selectMetroLine(button.dataset.metroLineId, { showInfo: true })));
  content.querySelectorAll("[data-surface-line-id]").forEach(button => button.addEventListener("click", () => selectSurfaceLine(button.dataset.surfaceLineId, { showInfo: true })));
  content.querySelector("#focus-station-btn")?.addEventListener("click", () => setPersistentTransportFocus({ type: "station", family: primaryFamily, id: station.id, label: station.name, station }));
  content.querySelector("#route-add-station-btn")?.addEventListener("click", () => startRouteWithSegment({ mode: primaryFamily, service: `station:${station.id}`, kind: "station", stationId: station.id, label: `${station.name} station`, lat: station.lat, lng: station.lon }));
  updateBusIntegration(station.lat, station.lon);
}

function stationProfile(name, services = []) {
  const key = looseStationKey(name);
  const curated = Object.entries(STATION_BACKGROUND).find(([profileKey]) => key.includes(profileKey) || profileKey.includes(key))?.[1];
  if (curated) return curated;
  const hasTram = services.some(service => service.family === "tram" || service.kind === "tram");
  const hasNational = services.some(service => service.kind === "national");
  const hasRail = services.some(service => service.family === "rail");
  const descriptor = hasNational ? "Rail interchange" : hasRail ? "Urban rail station" : hasTram ? "London tram stop" : "London Underground station";
  const serviceNames = services.slice(0, 4).map(service => service.code ? `${service.code} ${service.name || service.displayName}` : service.name).filter(Boolean);
  return {
    descriptor,
    about: `${name} serves ${serviceNames.length ? serviceNames.join(", ") : "London's public transport network"}${services.length > 4 ? " and other services" : ""}. It can be used as a transfer point where the mapped services meet.`,
    background: `${name} forms part of London's layered transport history, where Underground, suburban rail, light rail and mainline routes have developed over different periods.`
  };
}

async function updateBusIntegration(lat, lon) {
  try {
    const busStops = await fetchNearbyBusStops(lat, lon);
    const info = el("bus-info");
    if (!info) return;
    if (!busStops.length) { info.textContent = "No nearby TfL bus stops found within 250 m."; return; }
    const routes = [...new Set(busStops.flatMap(stop => (stop.lines || []).map(line => line.name || line.id)).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    info.innerHTML = `<strong>${busStops.length}</strong> nearby bus stop${busStops.length === 1 ? "" : "s"} within 250 m.${routes.length ? `<div class="bus-row">Routes: ${escapeHtml(routes.slice(0, 18).join(", "))}${routes.length > 18 ? "…" : ""}</div>` : ""}`;
  } catch (err) {
    const info = el("bus-info");
    if (info) info.textContent = "Bus-stop information is temporarily unavailable.";
  }
}

function showPlaceInfo(place) {
  const content = el("detail-content");
  const isTransport = normalizeSearch(place.category || "") === "transport";
  const profile = isTransport ? stationProfile(place.name, []) : null;
  content.innerHTML = `
    <div class="detail-label">${escapeHtml(String(place.category || "PLACE").toUpperCase())}</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.note || "Saved frequent place")}</div>
    ${profile ? `<div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div><div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div>` : ""}
    <div class="detail-section"><div class="info-row"><span>Coordinates</span><b>${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}</b></div></div>
    <div class="detail-actions compact-action-row"><button class="mini-edit-btn" id="delete-place-btn">Delete</button></div>`;
  content.querySelector("#delete-place-btn")?.addEventListener("click", () => deleteFrequentPlace(place.id));
  openDetail();
}

function closeDetail(updateBody = true) {
  el("detail-card").classList.add("hidden");
  if (transientTransportSelection) {
    transientTransportSelection = null;
    applyLayerState();
  }
  if (updateBody && allOtherSheetsClosed("detail-card")) document.body.classList.remove("detail-open");
}

function startRouteWithSegment(segment) {
  transientTransportSelection = null;
  persistentTransportFocus = null;
  updateItemFocusChip();
  closeDetail(false);
  routeEditorSegments = [normalizeRouteSegment(segment)];
  el("route-name-input").value = "";
  renderRouteEditorSegments();
  el("route-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  showToast("Added as the first route item. Add more segments in the route editor.", 2600);
}

function normalizeRouteSegment(segment) {
  return {
    mode: segment.mode || "walk",
    service: String(segment.service || ""),
    kind: segment.kind || "line",
    label: segment.label || "",
    stationId: segment.stationId || "",
    lat: Number.isFinite(Number(segment.lat)) ? Number(segment.lat) : undefined,
    lng: Number.isFinite(Number(segment.lng)) ? Number(segment.lng) : undefined
  };
}

function routeSegmentEditorHtml(segment, index) {
  if (segment.kind === "station") {
    return `<div class="route-segment-row station-route-segment"><span class="route-step">${index + 1}</span><div class="station-segment-mode">${escapeHtml(segment.mode.toUpperCase())}</div><div class="station-segment-label">${escapeHtml(segment.label || "Station")}</div><button class="mini-danger" data-remove-segment="${index}" title="Remove segment">×</button></div>`;
  }

  let serviceControl;
  if (segment.mode === "metro") {
    serviceControl = `<select class="form-control" data-segment-service="${index}">${TUBE_LINES.map(line => `<option value="${line.id}" ${line.id === segment.service ? "selected" : ""}>${escapeHtml(formatLineName(line))}</option>`).join("")}</select>`;
  } else if (segment.mode === "rail" || segment.mode === "tram") {
    const lines = [...surfaceLineById.values()].filter(line => line.family === segment.mode).sort(surfaceLineSort);
    const options = lines.map(line => `<option value="${line.id}" ${line.id === segment.service ? "selected" : ""}>${escapeHtml(formatSurfaceLineName(line))}</option>`).join("");
    serviceControl = lines.length ? `<select class="form-control" data-segment-service="${index}">${options}</select>` : `<input class="form-control" data-segment-service="${index}" value="${escapeHtml(segment.service || "")}" placeholder="${segmentPlaceholder(segment.mode)}" />`;
  } else {
    serviceControl = `<input class="form-control" data-segment-service="${index}" value="${escapeHtml(segment.service || "")}" placeholder="${segmentPlaceholder(segment.mode)}" />`;
  }

  return `<div class="route-segment-row"><span class="route-step">${index + 1}</span><select class="form-control route-mode" data-segment-mode="${index}"><option value="metro" ${segment.mode === "metro" ? "selected" : ""}>Metro</option><option value="rail" ${segment.mode === "rail" ? "selected" : ""}>Rail</option><option value="tram" ${segment.mode === "tram" ? "selected" : ""}>Tram</option><option value="bus" ${segment.mode === "bus" ? "selected" : ""}>Bus</option><option value="walk" ${segment.mode === "walk" ? "selected" : ""}>Walk</option></select><div class="route-service">${serviceControl}</div><button class="mini-danger" data-remove-segment="${index}" title="Remove segment">×</button></div>`;
}

function saveFavoriteRouteFromEditor() {
  const name = el("route-name-input").value.trim();
  const segments = routeEditorSegments.map(normalizeRouteSegment).filter(segment => segment.kind === "station" || segment.mode === "walk" || segment.service);
  if (!name) { showToast("Give the route a name first."); return; }
  if (!segments.length) { showToast("Add at least one route segment."); return; }
  const route = { id: `route-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name, segments, useCount: 0, createdAt: Date.now() };
  favoriteRoutes.push(route);
  saveFavoriteRoutes();
  closeRouteEditor();
  renderFavoritesSheet();
  refreshSearchIfOpen();
  showToast(`Saved route: ${route.name}`);
}

function segmentDisplayName(segment) {
  if (segment.kind === "station") return segment.label || "Station";
  if (segment.mode === "metro") {
    const line = TUBE_LINE_BY_ID.get(segment.service);
    return line ? formatLineName(line) : segment.service || "Metro";
  }
  if (segment.mode === "rail" || segment.mode === "tram") {
    const line = surfaceLineById.get(segment.service);
    return line ? formatSurfaceLineName(line) : segment.service || (segment.mode === "tram" ? "Tram" : "Rail");
  }
  if (segment.mode === "bus") return `Bus ${segment.service}`;
  if (segment.mode === "walk") return segment.service || "Walk";
  return segment.service || segment.mode;
}

function showFavoriteRouteInfo(route) {
  const mapped = routeMetroLineIds(route).length + routeSurfaceLineIds(route).length + routeStationSegments(route).length;
  const content = el("detail-content");
  content.innerHTML = `<div class="detail-label">FAVORITE ROUTE</div><h2>${escapeHtml(route.name)}</h2><div class="sub">${escapeHtml(routeSegmentSummary(route))}</div><div class="detail-section route-segment-list">${(route.segments || []).map((segment,index) => `<div class="route-info-row"><span class="route-step">${index+1}</span><b>${escapeHtml(segmentDisplayName(segment))}</b></div>`).join("")}</div><div class="detail-section"><div class="info-row"><span>Times opened</span><b>${Number(route.useCount || 0)}</b></div><div class="info-row"><span>Mapped items</span><b>${mapped}</b></div></div><div class="detail-actions compact-action-row"><button class="secondary-btn compact-btn" id="exit-route-focus-btn">Exit route focus</button><button class="mini-edit-btn danger-text" id="delete-route-btn">Delete</button></div>`;
  content.querySelector("#exit-route-focus-btn")?.addEventListener("click", () => { clearFavoriteRouteFocus(); closeDetail(); });
  content.querySelector("#delete-route-btn")?.addEventListener("click", () => deleteFavoriteRoute(route.id));
  openDetail();
}

function buildSearchResults(query) {
  const q = normalizeSearch(query);
  if (!q) return [];
  const results = [];

  for (const line of TUBE_LINES) {
    const hay = normalizeSearch(`${line.code} ${line.name} ${line.id} underground metro`);
    const score = searchScore(q, hay, normalizeSearch(line.code), normalizeSearch(line.name));
    if (score > 0) results.push({ type: "line", score, line });
  }
  for (const line of surfaceLineById.values()) {
    const hay = normalizeSearch(`${line.code} ${line.name} ${line.displayName} ${line.apiId} ${line.family} ${line.kind}`);
    const score = searchScore(q, hay, normalizeSearch(line.code), normalizeSearch(line.name), normalizeSearch(line.displayName));
    if (score > 0) results.push({ type: "surface-line", score, line });
  }
  for (const place of frequentPlaces) {
    const hay = normalizeSearch(`${place.name} ${place.category} ${place.note || ""}`);
    const score = searchScore(q, hay, normalizeSearch(place.name));
    if (score > 0) results.push({ type: "place", score, place });
  }
  for (const station of getSearchStations()) {
    const metroText = (station.lines || []).map(formatLineName).join(" ");
    const surfaceText = (station.surfaceServices || station.services || []).map(formatSurfaceLineName).join(" ");
    const hay = normalizeSearch(`${station.name} ${metroText} ${surfaceText} station rail tram metro underground`);
    const score = searchScore(q, hay, normalizeSearch(station.name));
    if (score > 0) results.push({ type: station.stationFamily === "surface" ? "surface-station" : "station", score, station });
  }
  for (const route of favoriteRoutes) {
    const segmentText = (route.segments || []).map(segmentDisplayName).join(" ");
    const hay = normalizeSearch(`${route.name} ${segmentText} favorite route journey`);
    const score = searchScore(q, hay, normalizeSearch(route.name));
    if (score > 0) results.push({ type: "route", score, route });
  }
  return results.sort((a,b) => b.score - a.score || resultTitle(a).localeCompare(resultTitle(b))).slice(0, 11);
}

function getSearchStations() {
  const combined = [...stationRegistry.values()].map(station => ({ ...station, lines: station.lines.slice().sort(compareTubeLines), stationFamily: "metro" }));
  const matchedTubeIds = new Set([...surfaceStationRegistry.values()].map(station => station.tubeStationId).filter(Boolean));
  for (const station of surfaceStationRegistry.values()) {
    if (station.tubeStationId && matchedTubeIds.has(station.tubeStationId)) continue;
    combined.push({ ...station, services: station.services.slice().sort(surfaceLineSort), stationFamily: "surface" });
  }
  return combined.sort((a,b) => a.name.localeCompare(b.name));
}

function searchResultHtml(result, index) {
  if (result.type === "line") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div><div><div class="result-title">${escapeHtml(formatLineName(result.line))}</div><div class="result-sub">Metro line</div></div></button>`;
  if (result.type === "surface-line") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div><div><div class="result-title">${escapeHtml(formatSurfaceLineName(result.line))}</div><div class="result-sub">${escapeHtml(result.line.family === "tram" ? "Tram" : result.line.kind === "national" ? "National Rail" : "Rail")}</div></div></button>`;
  if (result.type === "station" || result.type === "surface-station") {
    const station = result.station;
    const metro = (station.lines || []).map(formatLineName);
    const surface = (station.surfaceServices || station.services || []).map(formatSurfaceLineName);
    return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">${result.type === "surface-station" ? "R" : "M"}</div><div><div class="result-title">${escapeHtml(station.name)}</div><div class="result-sub">${escapeHtml([...metro, ...surface].join(" · ") || "Transport station")}</div></div></button>`;
  }
  if (result.type === "route") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">★</div><div><div class="result-title">${escapeHtml(result.route.name)}</div><div class="result-sub">${escapeHtml(routeSegmentSummary(result.route))}</div></div></button>`;
  return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">●</div><div><div class="result-title">${escapeHtml(result.place.name)}</div><div class="result-sub">${escapeHtml(result.place.category)} · Frequent place</div></div></button>`;
}

function selectSearchResult(result) {
  if (!result) return;
  hideSearchResults();
  el("search-input").blur();
  if (result.type === "route") { activateFavoriteRoute(result.route.id); return; }
  if (result.type === "place") {
    clearFavoriteRouteFocus(); transientTransportSelection = null; persistentTransportFocus = null; layerState.places = true; applyLayerState();
    map.panTo({ lat: result.place.lat, lng: result.place.lng }); map.setZoom(Math.max(map.getZoom() || 15, 16)); showPlaceInfo(result.place); return;
  }
  if (result.type === "station") {
    map.panTo({ lat: result.station.lat, lng: result.station.lon }); map.setZoom(16); selectTubeStation(result.station, { showInfo: true }); return;
  }
  if (result.type === "surface-station") {
    map.panTo({ lat: result.station.lat, lng: result.station.lon }); map.setZoom(16); selectSurfaceStation(result.station, { showInfo: true }); return;
  }
  if (result.type === "surface-line") { selectSurfaceLine(result.line.id, { fit: true, showInfo: true }); return; }
  if (result.type === "line") selectMetroLine(result.line.id, { fit: true, showInfo: true });
}

function resultTitle(result) {
  if (result.type === "line") return formatLineName(result.line);
  if (result.type === "surface-line") return formatSurfaceLineName(result.line);
  if (result.type === "station" || result.type === "surface-station") return result.station.name;
  if (result.type === "route") return result.route.name;
  return result.place.name;
}

function clearTfLCache() {
  Object.keys(localStorage).filter(key => key.startsWith(TFL_CACHE_PREFIX) || key.startsWith(SURFACE_CACHE_PREFIX)).forEach(key => localStorage.removeItem(key));
  localStorage.removeItem(TUBE_GEOMETRY_CACHE_KEY);
}


/* ---------- v1.3E: Layers panel + Favorites categories + universal search ---------- */
const V13E_LAYER_PREFS_STORAGE = "londonMap.layerPrefs.v1";
const V13E_FAVORITE_FILTERS_STORAGE = "londonMap.favoriteFilters.v1";
const V13E_RECENT_SEARCHES_STORAGE = "londonMap.recentSearches.v1";

const FAVORITE_CATEGORY_META = [
  { id: "School", icon: "🎓", color: "#7F77FF" },
  { id: "Food", icon: "🍴", color: "#C38BFF" },
  { id: "Market", icon: "🛒", color: "#F4B544" },
  { id: "Health", icon: "♥", color: "#5FD780" },
  { id: "Home", icon: "⌂", color: "#64A8FF" },
  { id: "Shopping", icon: "🛍", color: "#FF7B95" },
  { id: "Sport", icon: "🏃", color: "#4AD3B4" },
  { id: "Social", icon: "☻", color: "#FF8EC7" },
  { id: "Transport", icon: "◆", color: "#FFD25A" },
  { id: "Tech", icon: "⌘", color: "#B8C1CD" },
  { id: "Admin", icon: "▤", color: "#9AB4CE" },
  { id: "Other", icon: "●", color: "#FFB15A" }
];

let selectedFavoriteCategories = loadV13EFavoriteFilters();
let editingFrequentPlaceId = null;
let universalSearchState = { query: "", loading: false, results: [], error: "" };
let recentSearches = loadV13ERecentSearches();
let savedLayerPrefs = loadV13ELayerPrefs();
let externalPlacePulse = null;

function canonicalFavoriteCategory(category = "Other", placeName = "") {
  const raw = String(category || "Other").trim();
  const aliases = {
    University: "School", Education: "School", College: "School",
    Sports: "Sport", Gym: "Sport", Grocery: "Market", Supermarket: "Market",
    Pharmacy: "Health", Medical: "Health"
  };
  let resolved = aliases[raw] || raw;
  const marketName = normalizeSearch(placeName);
  if (resolved === "Food" && /\b(waitrose|tesco|sainsbury|aldi|lidl|morrisons|whole foods|supermarket|grocery|market)\b/.test(marketName)) resolved = "Market";
  return FAVORITE_CATEGORY_META.some(item => item.id === resolved) ? resolved : "Other";
}

function migrateV13EFavorites() {
  let changed = false;
  frequentPlaces = frequentPlaces.map(place => {
    const category = canonicalFavoriteCategory(place.category, place.name);
    const color = placeColorForCategory(category);
    if (category !== place.category || color !== place.color) changed = true;
    return { ...place, category, color };
  });
  if (changed) saveFrequentPlaces();
}

function placeColorForCategory(category) {
  const canonical = canonicalFavoriteCategory(category);
  return FAVORITE_CATEGORY_META.find(item => item.id === canonical)?.color || "#FFB15A";
}

function loadV13ELayerPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V13E_LAYER_PREFS_STORAGE) || "null");
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return { metro: false, rail: false, tram: false, places: false, traffic: false };
}

function saveV13ELayerPrefs() {
  try {
    localStorage.setItem(V13E_LAYER_PREFS_STORAGE, JSON.stringify({
      metro: !!layerState.metro,
      rail: !!layerState.rail,
      tram: !!layerState.tram,
      places: !!layerState.places,
      traffic: !!trafficLayer?.getMap?.()
    }));
  } catch {}
}

function restoreV13ELayerPrefs() {
  layerState.metro = !!savedLayerPrefs.metro;
  layerState.rail = !!savedLayerPrefs.rail;
  layerState.tram = !!savedLayerPrefs.tram;
  layerState.places = !!savedLayerPrefs.places;
}

function loadV13EFavoriteFilters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V13E_FAVORITE_FILTERS_STORAGE) || "null");
    if (Array.isArray(parsed) && parsed.length) return new Set(parsed);
  } catch {}
  return new Set(["all"]);
}

function saveV13EFavoriteFilters() {
  try { localStorage.setItem(V13E_FAVORITE_FILTERS_STORAGE, JSON.stringify([...selectedFavoriteCategories])); } catch {}
}

function loadV13ERecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V13E_RECENT_SEARCHES_STORAGE) || "[]");
    if (Array.isArray(parsed)) return parsed.filter(Boolean).slice(0, 8);
  } catch {}
  return [];
}

function rememberV13ESearch(text) {
  const value = String(text || "").trim();
  if (!value) return;
  recentSearches = [value, ...recentSearches.filter(item => normalizeSearch(item) !== normalizeSearch(value))].slice(0, 8);
  try { localStorage.setItem(V13E_RECENT_SEARCHES_STORAGE, JSON.stringify(recentSearches)); } catch {}
}

function favoriteCategoryVisible(place) {
  if (getPlaceCityId(place) !== currentCityId) return false;
  if (selectedFavoriteCategories.has("all")) return true;
  return selectedFavoriteCategories.has(canonicalFavoriteCategory(place.category, place.name));
}

function applyFavoriteCategoryVisibility() {
  const route = getActiveFavoriteRoute();
  const selection = getTransportSelection();
  const canShow = layerState.places && !route && !selection;
  placeOverlays.forEach(overlay => overlay.setVisible(canShow && favoriteCategoryVisible(overlay.place)));
}

function syncV13EPanelUI() {
  const layerButtons = {
    metro: el("panel-metro-toggle"), rail: el("panel-rail-toggle"), tram: el("panel-tram-toggle")
  };
  Object.entries(layerButtons).forEach(([name, button]) => {
    if (!button) return;
    button.classList.toggle("active", !!layerState[name]);
    button.setAttribute("aria-pressed", String(!!layerState[name]));
  });

  document.querySelectorAll("[data-favorite-category]").forEach(button => {
    const category = button.dataset.favoriteCategory;
    const active = !!layerState.places && selectedFavoriteCategories.has(category);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const trafficButton = el("panel-traffic-toggle");
  const trafficActive = !!trafficLayer?.getMap?.();
  if (trafficButton) {
    trafficButton.classList.toggle("active", trafficActive);
    trafficButton.setAttribute("aria-pressed", String(trafficActive));
  }
}

function toggleLayersPanel(force) {
  const panel = el("layers-panel");
  const button = el("layers-menu-btn");
  if (!panel || !button) return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("layers-panel-open", open);
  if (open) syncV13EPanelUI();
}

function toggleFavoriteCategory(category) {
  if (category === "all") {
    if (layerState.places && selectedFavoriteCategories.has("all")) {
      layerState.places = false;
    } else {
      selectedFavoriteCategories = new Set(["all"]);
      layerState.places = true;
    }
  } else {
    if (!layerState.places || selectedFavoriteCategories.has("all")) {
      selectedFavoriteCategories = new Set();
      layerState.places = true;
    }
    if (selectedFavoriteCategories.has(category)) selectedFavoriteCategories.delete(category);
    else selectedFavoriteCategories.add(category);
    if (!selectedFavoriteCategories.size) layerState.places = false;
  }
  saveV13EFavoriteFilters();
  activeFavoriteRouteId = null;
  transientTransportSelection = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  applyLayerState();
}

function toggleV13ETraffic() {
  if (!map || !trafficLayer) return;
  const active = !!trafficLayer.getMap();
  trafficLayer.setMap(active ? null : map);
  syncV13EPanelUI();
  saveV13ELayerPrefs();
}

function categoryFromGooglePlace(type = "", name = "", address = "") {
  const text = normalizeSearch(`${type} ${name} ${address}`);
  if (/university|school|college|education|library/.test(text)) return "School";
  if (/supermarket|grocery|market|convenience store|food store/.test(text)) return "Market";
  if (/restaurant|cafe|coffee|bakery|meal|food|bar/.test(text)) return "Food";
  if (/hospital|doctor|pharmacy|dentist|health|medical|physio/.test(text)) return "Health";
  if (/gym|fitness|stadium|sports|swimming/.test(text)) return "Sport";
  if (/train|station|transit|subway|tram|airport|bus/.test(text)) return "Transport";
  if (/electronics|computer|mobile phone/.test(text)) return "Tech";
  if (/shopping|store|shop|clothing|department store|home goods/.test(text)) return "Shopping";
  if (/city hall|embassy|government|post office|administrative/.test(text)) return "Admin";
  return "Other";
}

function latLngLiteral(location) {
  if (!location) return null;
  const lat = typeof location.lat === "function" ? location.lat() : Number(location.lat);
  const lng = typeof location.lng === "function" ? location.lng() : Number(location.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function searchAllLondon(query) {
  const cleaned = String(query || "").trim();
  if (!cleaned || !map) return;
  rememberV13ESearch(cleaned);
  universalSearchState = { query: cleaned, loading: true, results: [], error: "" };
  renderSearchResults();

  let results = [];
  let placesError = null;
  try {
    const { Place } = await google.maps.importLibrary("places");
    const request = {
      textQuery: cleaned,
      fields: ["id", "displayName", "formattedAddress", "location", "primaryType", "primaryTypeDisplayName"],
      locationBias: map.getBounds() || undefined,
      maxResultCount: 7,
      language: getActiveCityConfig().language,
      region: getActiveCityConfig().region
    };
    const response = await Place.searchByText(request);
    results = (response.places || []).map(place => {
      const coords = latLngLiteral(place.location);
      if (!coords) return null;
      const typeLabel = typeof place.primaryTypeDisplayName === "string" ? place.primaryTypeDisplayName : (place.primaryTypeDisplayName?.text || place.primaryType || "Place");
      return {
        type: "external-place",
        id: place.id || `google-${coords.lat}-${coords.lng}`,
        name: place.displayName || "Place",
        address: place.formattedAddress || "",
        primaryType: place.primaryType || "",
        typeLabel,
        category: categoryFromGooglePlace(place.primaryType || typeLabel, place.displayName || "", place.formattedAddress || ""),
        ...coords
      };
    }).filter(Boolean);
  } catch (err) {
    placesError = err;
    console.warn("Places API (New) search unavailable; using Geocoder fallback.", err);
  }

  if (!results.length && geocoder) {
    try {
      const response = await geocoder.geocode({
        address: cleaned,
        bounds: map.getBounds() || undefined,
        region: getActiveCityConfig().geocoderRegion
      });
      results = (response.results || []).slice(0, 7).map(result => {
        const coords = latLngLiteral(result.geometry?.location);
        if (!coords) return null;
        const type = result.types?.[0] || "place";
        return {
          type: "external-place",
          id: result.place_id || `geocode-${coords.lat}-${coords.lng}`,
          name: result.address_components?.[0]?.long_name || cleaned,
          address: result.formatted_address || cleaned,
          primaryType: type,
          typeLabel: type.replaceAll("_", " "),
          category: categoryFromGooglePlace(type, result.formatted_address || cleaned, result.formatted_address || ""),
          ...coords,
          fallback: true
        };
      }).filter(Boolean);
    } catch (err) {
      console.warn("Geocoder fallback also failed.", err);
      placesError = placesError || err;
    }
  }

  if (normalizeSearch(el("search-input")?.value || "") !== normalizeSearch(cleaned)) return;
  universalSearchState = {
    query: cleaned,
    loading: false,
    results,
    error: results.length ? "" : (placesError ? "Google place search is not enabled for this API key yet." : `No ${getActiveCityConfig().name} place found.`)
  };
  renderSearchResults();
}

function buildV13ESearchResults(query) {
  return buildSearchResults(query).filter(result => {
    if (result.type === "place") return getPlaceCityId(result.place) === currentCityId;
    if (result.type === "route") return getRouteCityId(result.route) === currentCityId;
    return currentCityId === "london";
  });
}

function renderSearchResults() {
  const input = el("search-input");
  const resultsNode = el("search-results");
  const clearButton = el("search-clear");
  if (!input || !resultsNode) return;
  const query = input.value.trim();
  clearButton?.classList.toggle("hidden", !query);

  if (!query) {
    universalSearchState = { query: "", loading: false, results: [], error: "" };
    if (!recentSearches.length) { hideSearchResults(); return; }
    resultsNode.innerHTML = `<div class="recent-search-label">RECENT SEARCHES</div>` + recentSearches.map((item, index) => `
      <button class="search-result recent-search-result" data-recent-index="${index}" role="option">
        <div class="result-icon">↺</div><div><div class="result-title">${escapeHtml(item)}</div><div class="result-sub">Search again</div></div>
      </button>`).join("");
    resultsNode.classList.remove("hidden");
    resultsNode.querySelectorAll("[data-recent-index]").forEach(button => button.addEventListener("click", () => {
      input.value = recentSearches[Number(button.dataset.recentIndex)] || "";
      renderSearchResults();
    }));
    return;
  }

  const local = buildV13ESearchResults(query).slice(0, 8);
  let html = local.map((result, index) => searchResultHtml(result, index)).join("");

  const externalMatchesQuery = normalizeSearch(universalSearchState.query) === normalizeSearch(query);
  if (externalMatchesQuery && universalSearchState.loading) {
    html += `<div class="search-status-row">Searching the rest of ${escapeHtml(getActiveCityConfig().name)}…</div>`;
  } else if (externalMatchesQuery && universalSearchState.results.length) {
    html += universalSearchState.results.map((result, index) => `
      <button class="search-result external-place-result" data-external-index="${index}" role="option">
        <div class="result-icon">＋</div>
        <div><div class="result-title">${escapeHtml(result.name)}</div><div class="result-sub">${escapeHtml(result.typeLabel || result.category)}${result.address ? ` · ${escapeHtml(result.address)}` : ""}</div></div>
      </button>`).join("");
  } else if (externalMatchesQuery && universalSearchState.error) {
    html += `<div class="search-status-row">${escapeHtml(universalSearchState.error)} You can still search the transport map and your saved places.</div>`;
  } else {
    html += `<button class="search-result search-all-result" data-search-all="true" role="option">
      <div class="result-icon">⌕</div><div><div class="result-title">Search all ${escapeHtml(getActiveCityConfig().name)} for “${escapeHtml(query)}”</div><div class="result-sub">Businesses, cafés, markets, addresses and other real-world places</div></div>
    </button>`;
  }

  if (!html) html = `<div class="search-status-row">No result yet.</div>`;
  resultsNode.innerHTML = html;
  resultsNode.classList.remove("hidden");

  resultsNode.querySelectorAll("[data-result-index]").forEach(button => button.addEventListener("click", () => {
    const result = local[Number(button.dataset.resultIndex)];
    if (result) { rememberV13ESearch(resultTitle(result)); selectSearchResult(result); }
  }));
  resultsNode.querySelector("[data-search-all]")?.addEventListener("click", () => searchAllLondon(query));
  resultsNode.querySelectorAll("[data-external-index]").forEach(button => button.addEventListener("click", () => {
    const result = universalSearchState.results[Number(button.dataset.externalIndex)];
    if (result) { rememberV13ESearch(result.name); selectSearchResult(result); }
  }));
}

function searchResultHtml(result, index) {
  if (result.type === "line") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div><div><div class="result-title">${escapeHtml(formatLineName(result.line))}</div><div class="result-sub">Metro line</div></div></button>`;
  if (result.type === "surface-line") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div><div><div class="result-title">${escapeHtml(formatSurfaceLineName(result.line))}</div><div class="result-sub">${escapeHtml(result.line.family === "tram" ? "Tram" : result.line.kind === "national" ? "National Rail" : "Rail")}</div></div></button>`;
  if (result.type === "station" || result.type === "surface-station") {
    const station = result.station;
    const metro = (station.lines || []).map(formatLineName);
    const surface = (station.surfaceServices || station.services || []).map(formatSurfaceLineName);
    return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">${result.type === "surface-station" ? "R" : "M"}</div><div><div class="result-title">${escapeHtml(station.name)}</div><div class="result-sub">${escapeHtml([...metro, ...surface].join(" · ") || "Transport station")}</div></div></button>`;
  }
  if (result.type === "route") return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">★</div><div><div class="result-title">${escapeHtml(result.route.name)}</div><div class="result-sub">${escapeHtml(routeSegmentSummary(result.route))}</div></div></button>`;
  const cat = canonicalFavoriteCategory(result.place.category, result.place.name);
  const meta = FAVORITE_CATEGORY_META.find(item => item.id === cat);
  return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="color:${meta?.color || "#fff"}">${meta?.icon || "●"}</div><div><div class="result-title">${escapeHtml(result.place.name)}</div><div class="result-sub">${escapeHtml(cat)} · Favorite place</div></div></button>`;
}

function selectSearchResult(result) {
  if (!result) return;
  hideSearchResults();
  toggleLayersPanel(false);
  el("search-input")?.blur();
  if (result.type === "external-place") { showExternalPlaceInfo(result); return; }
  if (result.type === "route") { activateFavoriteRoute(result.route.id); return; }
  if (result.type === "place") {
    clearFavoriteRouteFocus(); transientTransportSelection = null; persistentTransportFocus = null;
    layerState.places = true;
    const cat = canonicalFavoriteCategory(result.place.category, result.place.name);
    if (!selectedFavoriteCategories.has("all") && !selectedFavoriteCategories.has(cat)) selectedFavoriteCategories.add(cat);
    applyLayerState();
    map.panTo({ lat: result.place.lat, lng: result.place.lng }); map.setZoom(Math.max(map.getZoom() || 15, 16)); showPlaceInfo(result.place); return;
  }
  if (result.type === "station") { map.panTo({ lat: result.station.lat, lng: result.station.lon }); map.setZoom(16); selectTubeStation(result.station, { showInfo: true }); return; }
  if (result.type === "surface-station") { map.panTo({ lat: result.station.lat, lng: result.station.lon }); map.setZoom(16); selectSurfaceStation(result.station, { showInfo: true }); return; }
  if (result.type === "surface-line") { selectSurfaceLine(result.line.id, { fit: true, showInfo: true }); return; }
  if (result.type === "line") selectMetroLine(result.line.id, { fit: true, showInfo: true });
}

function pulseExternalPlace(coords) {
  if (externalPlacePulse) externalPlacePulse.setMap(null);
  externalPlacePulse = new google.maps.Circle({
    map,
    center: coords,
    radius: 18,
    clickable: false,
    strokeColor: "#79B6FF",
    strokeOpacity: .95,
    strokeWeight: 3,
    fillColor: "#79B6FF",
    fillOpacity: .20,
    zIndex: 90
  });
  setTimeout(() => { externalPlacePulse?.setMap(null); externalPlacePulse = null; }, 9000);
}

function showExternalPlaceInfo(place) {
  const coords = { lat: Number(place.lat), lng: Number(place.lng) };
  map.panTo(coords);
  if ((map.getZoom() || 0) < 17) map.setZoom(17);
  pulseExternalPlace(coords);
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">LONDON SEARCH</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.typeLabel || "Place")}${place.address ? ` · ${escapeHtml(place.address)}` : ""}</div>
    <div class="detail-section"><div class="info-row"><span>Suggested category</span><b>${escapeHtml(place.category || "Other")}</b></div><div class="info-row"><span>Coordinates</span><b>${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}</b></div></div>
    <div class="detail-actions compact-action-row"><button class="primary-btn compact-btn" id="external-save-place-btn">＋ Add to Favorites</button></div>`;
  content.querySelector("#external-save-place-btn")?.addEventListener("click", () => {
    closeDetail(false);
    openPlaceEditor(coords, place.name, place.address || "", place.category || "Other");
  });
  openDetail();
}

function openPlaceEditor(coords, suggestedName = "", suggestedNote = "", suggestedCategory = "Other", existingId = null) {
  editingFrequentPlaceId = existingId || null;
  pendingPlaceCoordinates = { lat: Number(coords.lat), lng: Number(coords.lng) };
  el("place-name-input").value = suggestedName || "";
  const category = canonicalFavoriteCategory(suggestedCategory, suggestedName);
  el("place-category-input").value = category;
  el("place-note-input").value = suggestedNote || "";
  el("place-coordinate-readout").textContent = `${pendingPlaceCoordinates.lat.toFixed(5)}, ${pendingPlaceCoordinates.lng.toFixed(5)}`;
  const heading = el("place-editor-sheet")?.querySelector("h2");
  if (heading) heading.textContent = editingFrequentPlaceId ? "Edit favorite place" : "Save this place";
  const saveButton = el("save-place-btn");
  if (saveButton) saveButton.textContent = editingFrequentPlaceId ? "Save changes" : "Save favorite place";
  closeAddSheet(false);
  closeDetail(false);
  el("place-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  setTimeout(() => el("place-name-input").focus(), 50);
}

function openPlaceEditorForEdit(place) {
  openPlaceEditor({ lat: place.lat, lng: place.lng }, place.name, place.note || "", place.category || "Other", place.id);
}

function closePlaceEditor(updateBody = true) {
  el("place-editor-sheet").classList.add("hidden");
  pendingPlaceCoordinates = null;
  editingFrequentPlaceId = null;
  if (updateBody && allOtherSheetsClosed("place-editor-sheet")) document.body.classList.remove("detail-open");
}

function savePlaceFromEditor() {
  const name = el("place-name-input").value.trim();
  if (!name || !pendingPlaceCoordinates) { showToast("Give the place a name first."); return; }
  const category = canonicalFavoriteCategory(el("place-category-input").value || "Other", name);
  const note = el("place-note-input").value.trim();
  let place;
  if (editingFrequentPlaceId) {
    const index = frequentPlaces.findIndex(item => item.id === editingFrequentPlaceId);
    if (index >= 0) {
      place = { ...frequentPlaces[index], city: frequentPlaces[index].city || currentCityId, name, lat: pendingPlaceCoordinates.lat, lng: pendingPlaceCoordinates.lng, category, color: placeColorForCategory(category), note, updatedAt: Date.now() };
      frequentPlaces[index] = place;
    }
  }
  if (!place) {
    place = { id: `place-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, city: currentCityId, name, lat: pendingPlaceCoordinates.lat, lng: pendingPlaceCoordinates.lng, category, color: placeColorForCategory(category), anchor: false, note, createdAt: Date.now() };
    frequentPlaces.push(place);
  }
  saveFrequentPlaces();
  createPlaceMarkers();
  layerState.places = true;
  selectedFavoriteCategories = new Set(["all"]);
  saveV13EFavoriteFilters();
  applyLayerState();
  closePlaceEditor();
  map.panTo({ lat: place.lat, lng: place.lng });
  if ((map.getZoom() || 0) < 16) map.setZoom(16);
  showPlaceInfo(place);
  renderFavoritesSheet();
  refreshSearchIfOpen();
  showToast(`${place.name} saved.`);
}

function showPlaceInfo(place) {
  const content = el("detail-content");
  const category = canonicalFavoriteCategory(place.category, place.name);
  const isTransport = category === "Transport";
  const profile = isTransport ? stationProfile(place.name, []) : null;
  content.innerHTML = `
    <div class="detail-label">${escapeHtml(category.toUpperCase())}</div>
    <h2>${escapeHtml(place.name)}</h2>
    <div class="sub">${escapeHtml(place.note || "Favorite place")}</div>
    ${profile ? `<div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div><div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div>` : ""}
    <div class="detail-section"><div class="info-row"><span>Category</span><b>${escapeHtml(category)}</b></div><div class="info-row"><span>Coordinates</span><b>${Number(place.lat).toFixed(5)}, ${Number(place.lng).toFixed(5)}</b></div></div>
    <div class="detail-actions place-action-row"><button class="mini-edit-btn" id="edit-place-btn">Edit</button><button class="mini-danger-soft" id="delete-place-btn">Delete</button></div>`;
  content.querySelector("#edit-place-btn")?.addEventListener("click", () => openPlaceEditorForEdit(place));
  content.querySelector("#delete-place-btn")?.addEventListener("click", () => deleteFrequentPlace(place.id));
  openDetail();
}

function renderFavoritesSheet() {
  const placesNode = el("favorite-places-list");
  const routesNode = el("favorite-routes-list");
  if (!placesNode || !routesNode) return;
  const sortedPlaces = frequentPlaces.filter(place => getPlaceCityId(place) === currentCityId).slice().sort((a,b) => canonicalFavoriteCategory(a.category,a.name).localeCompare(canonicalFavoriteCategory(b.category,b.name)) || a.name.localeCompare(b.name));
  placesNode.innerHTML = sortedPlaces.length ? sortedPlaces.map(place => {
    const cat = canonicalFavoriteCategory(place.category, place.name);
    const meta = FAVORITE_CATEGORY_META.find(item => item.id === cat);
    return `<div class="favorite-row"><button class="favorite-main" data-open-place="${escapeHtml(place.id)}"><span class="favorite-symbol" style="background:${meta?.color || place.color}">${meta?.icon || "●"}</span><span><b>${escapeHtml(place.name)}</b><small>${escapeHtml(cat)}${place.note ? ` · ${escapeHtml(place.note)}` : ""}</small></span></button><button class="favorite-delete" data-delete-place="${escapeHtml(place.id)}" title="Delete">×</button></div>`;
  }).join("") : `<div class="empty-state">No favorite places yet.</div>`;
  const sortedRoutes = favoriteRoutes.slice().sort((a,b) => Number(b.useCount || 0) - Number(a.useCount || 0) || a.name.localeCompare(b.name));
  routesNode.innerHTML = sortedRoutes.length ? sortedRoutes.map(route => `<div class="favorite-row"><button class="favorite-main" data-open-route="${escapeHtml(route.id)}"><span class="favorite-symbol route-star">★</span><span><b>${escapeHtml(route.name)}</b><small>${escapeHtml(routeSegmentSummary(route))}</small></span></button><button class="favorite-delete" data-delete-route="${escapeHtml(route.id)}" title="Delete">×</button></div>`).join("") : `<div class="empty-state">No favorite routes yet.</div>`;
  placesNode.querySelectorAll("[data-open-place]").forEach(button => button.addEventListener("click", () => { const place = frequentPlaces.find(item => item.id === button.dataset.openPlace); if (!place) return; closeFavoritesSheet(false); layerState.places = true; applyLayerState(); map.panTo({lat:place.lat,lng:place.lng}); if ((map.getZoom()||0)<16) map.setZoom(16); showPlaceInfo(place); }));
  placesNode.querySelectorAll("[data-delete-place]").forEach(button => button.addEventListener("click", () => deleteFrequentPlace(button.dataset.deletePlace)));
  routesNode.querySelectorAll("[data-open-route]").forEach(button => button.addEventListener("click", () => { closeFavoritesSheet(false); activateFavoriteRoute(button.dataset.openRoute); }));
  routesNode.querySelectorAll("[data-delete-route]").forEach(button => button.addEventListener("click", () => deleteFavoriteRoute(button.dataset.deleteRoute)));
}

/* Wrap the v1.3D render state instead of replacing the transport engine. */
const applyLayerStateV13D = applyLayerState;
applyLayerState = function() {
  applyLayerStateV13D();
  applyFavoriteCategoryVisibility();
  syncV13EPanelUI();
  saveV13ELayerPrefs();
};

const createPlaceMarkersV13D = createPlaceMarkers;
createPlaceMarkers = function() {
  createPlaceMarkersV13D();
  if (map) applyFavoriteCategoryVisibility();
};

const initMapV13D = initMap;
initMap = function() {
  restoreV13ELayerPrefs();
  initMapV13D();
  if (savedLayerPrefs.traffic) trafficLayer.setMap(map);
  syncV13EPanelUI();
  applyLayerState();
  map.addListener("click", () => toggleLayersPanel(false));
};

migrateV13EFavorites();
restoreV13ELayerPrefs();

/* v1.3E panel controls */
el("layers-menu-btn")?.addEventListener("click", () => toggleLayersPanel());
el("layers-panel-close")?.addEventListener("click", () => toggleLayersPanel(false));
el("favorites-manage-btn")?.addEventListener("click", () => { toggleLayersPanel(false); openFavoritesSheet(); });

document.querySelectorAll("[data-layer]").forEach(button => button.addEventListener("click", () => toggleLayer(button.dataset.layer)));
document.querySelectorAll("[data-favorite-category]").forEach(button => button.addEventListener("click", () => toggleFavoriteCategory(button.dataset.favoriteCategory)));
document.querySelectorAll("[data-layer-coming]").forEach(button => button.addEventListener("click", () => showToast(`${button.dataset.layerComing[0].toUpperCase()}${button.dataset.layerComing.slice(1)} arrives in the next map-data build.`)));
el("panel-traffic-toggle")?.addEventListener("click", toggleV13ETraffic);

el("search-input")?.addEventListener("focus", () => { if (!el("search-input").value.trim()) renderSearchResults(); });
el("search-input")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    const query = el("search-input").value.trim();
    if (query) searchAllLondon(query);
  }
});


/* ---------- v1.3F: city information, route precision, panel workspace, performance ---------- */
const V13F_CITY_PREFS_STORAGE = "londonMap.cityInfoPrefs.v1";
const V13F_PANEL_POSITIONS_STORAGE = "londonMap.panelPositions.v1";
const V13F_WEATHER_CACHE_STORAGE = "londonMap.boroughWeather.v1";
const V13F_BOROUGH_GEOJSON_URL = "https://raw.githubusercontent.com/radoi90/housequest-data/master/london_boroughs.geojson";
const V13F_WEATHER_CACHE_MS = 10 * 60 * 1000;

let cityInfoState = loadV13FCityPrefs();
let boroughDataLayer = null;
let boroughFeaturesReady = false;
let boroughCentroids = [];
let boroughLabelOverlays = [];
let boroughWeatherByName = new Map();
let boroughWeatherLoading = null;
let windOverlays = [];
let windLoading = null;
let routeHighlightPolylines = [];
let routeGraphCache = new Map();
let panelZCounter = 90;
let v13fSurfaceLoadTimer = null;

const V13F_WIND_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#111820" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#596672" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111820" }, { weight: 3 }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a232d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#485563" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b2230" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3e6174" }] }
];

function loadV13FCityPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V13F_CITY_PREFS_STORAGE) || "null");
    if (parsed && typeof parsed === "object") return { districts: !!parsed.districts, weather: !!parsed.weather, wind: !!parsed.wind };
  } catch {}
  return { districts: false, weather: false, wind: false };
}

function saveV13FCityPrefs() {
  try { localStorage.setItem(V13F_CITY_PREFS_STORAGE, JSON.stringify(cityInfoState)); } catch {}
}

function syncV13FCityButtons() {
  ["districts", "weather", "wind"].forEach(name => {
    const button = el(`panel-${name}-toggle`);
    if (!button) return;
    const active = !!cityInfoState[name];
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function boroughNameFromFeature(feature) {
  const props = {};
  feature.forEachProperty((value, key) => props[key] = value);
  const preferred = ["name", "NAME", "borough", "BOROUGH", "Borough", "NAME_2", "LAD23NM", "LAD24NM", "GSS_NAME"];
  for (const key of preferred) if (props[key]) return String(props[key]).trim();
  const fuzzyKey = Object.keys(props).find(key => /name|borough|lad.*nm/i.test(key) && props[key]);
  return fuzzyKey ? String(props[fuzzyKey]).trim() : "London borough";
}

function featureAverageLatLng(feature) {
  let lat = 0, lng = 0, count = 0;
  feature.getGeometry()?.forEachLatLng(point => { lat += point.lat(); lng += point.lng(); count += 1; });
  return count ? { lat: lat / count, lng: lng / count } : null;
}

function boroughShade(index) {
  const hue = Math.round((index * 137.508 + 205) % 360);
  return `hsl(${hue} 34% 40%)`;
}

function ensureBoroughOverlayClass() {
  if (window.__V13FBoroughLabelOverlay) return;
  window.__V13FBoroughLabelOverlay = class extends HtmlOverlay {
    constructor(item) {
      super(item.position, "borough-label-overlay");
      this.item = item;
    }
    onAdd() {
      super.onAdd();
      this.updateContent();
    }
    updateContent() {
      if (!this.div) return;
      const weather = boroughWeatherByName.get(this.item.name);
      const showWeather = cityInfoState.weather && weather;
      this.div.innerHTML = `<div class="borough-label-name">${escapeHtml(this.item.name)}</div>${showWeather ? `<div class="borough-label-weather"><span>${weather.emoji}</span><b>${Math.round(weather.temperature)}°C</b><small>${escapeHtml(weather.label)}</small></div>` : ""}`;
      this.div.classList.toggle("weather-on", !!showWeather);
    }
  };
}

async function ensureBoroughData() {
  if (boroughFeaturesReady && boroughDataLayer) return;
  if (!map) return;
  boroughDataLayer = boroughDataLayer || new google.maps.Data();
  boroughDataLayer.setStyle(feature => ({
    fillColor: feature.getProperty("__v13fColor") || "#56718a",
    fillOpacity: cityInfoState.districts ? 0.23 : 0,
    strokeColor: "#d8e4ef",
    strokeOpacity: cityInfoState.districts ? 0.48 : 0,
    strokeWeight: cityInfoState.districts ? 1.05 : 0,
    clickable: false,
    zIndex: 2
  }));

  await new Promise((resolve, reject) => {
    let settled = false;
    try {
      boroughDataLayer.loadGeoJson(V13F_BOROUGH_GEOJSON_URL, null, features => {
        if (settled) return;
        settled = true;
        if (!features?.length) { reject(new Error("No borough boundaries returned.")); return; }
        const items = features.map(feature => ({ feature, name: boroughNameFromFeature(feature), position: featureAverageLatLng(feature) })).filter(item => item.position).sort((a,b) => a.name.localeCompare(b.name));
        items.forEach((item, index) => item.feature.setProperty("__v13fColor", boroughShade(index)));
        boroughCentroids = items.map(item => ({ name: item.name, position: item.position }));
        boroughFeaturesReady = true;
        rebuildBoroughLabels();
        resolve();
      });
      setTimeout(() => { if (!settled) { settled = true; reject(new Error("Borough boundary request timed out.")); } }, 15000);
    } catch (err) { reject(err); }
  });
}

function rebuildBoroughLabels() {
  boroughLabelOverlays.forEach(item => item.setMap(null));
  boroughLabelOverlays = [];
  if (!map || !boroughFeaturesReady) return;
  ensureBoroughOverlayClass();
  for (const item of boroughCentroids) {
    const overlay = new window.__V13FBoroughLabelOverlay(item);
    overlay.setMap(map);
    overlay.setVisible(cityInfoState.districts || cityInfoState.weather);
    boroughLabelOverlays.push(overlay);
  }
  refreshBoroughLabelVisibility();
}

function refreshBoroughLabelVisibility() {
  const zoom = map?.getZoom?.() || 12;
  const visible = (cityInfoState.districts || cityInfoState.weather) && zoom >= 9;
  boroughLabelOverlays.forEach(overlay => {
    overlay.setVisible(visible);
    overlay.updateContent?.();
    if (overlay.div) {
      overlay.div.classList.toggle("borough-label-compact", zoom <= 10);
      overlay.div.style.opacity = zoom <= 9 ? ".68" : zoom <= 10 ? ".80" : ".96";
    }
  });
}

function weatherCodeInfo(code) {
  const value = Number(code);
  if (value === 0) return { label: "Clear", emoji: "☀" };
  if ([1,2].includes(value)) return { label: "Partly cloudy", emoji: "⛅" };
  if (value === 3) return { label: "Cloudy", emoji: "☁" };
  if ([45,48].includes(value)) return { label: "Fog", emoji: "≋" };
  if ([51,53,55,56,57].includes(value)) return { label: "Drizzle", emoji: "🌦" };
  if ([61,63,65,66,67,80,81,82].includes(value)) return { label: "Rain", emoji: "🌧" };
  if ([71,73,75,77,85,86].includes(value)) return { label: "Snow", emoji: "❄" };
  if ([95,96,99].includes(value)) return { label: "Thunderstorm", emoji: "⚡" };
  return { label: "Weather", emoji: "◌" };
}

function loadWeatherCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V13F_WEATHER_CACHE_STORAGE) || "null");
    if (!parsed?.time || Date.now() - parsed.time > V13F_WEATHER_CACHE_MS || !Array.isArray(parsed.items)) return false;
    boroughWeatherByName = new Map(parsed.items.map(item => [item.name, item.weather]));
    return true;
  } catch { return false; }
}

async function ensureBoroughWeather(force = false) {
  if (!boroughFeaturesReady) await ensureBoroughData();
  if (!force && boroughWeatherByName.size) return;
  if (!force && loadWeatherCache()) { refreshBoroughLabelVisibility(); return; }
  if (boroughWeatherLoading) return boroughWeatherLoading;
  boroughWeatherLoading = (async () => {
    const coords = boroughCentroids;
    if (!coords.length) return;
    const latitudes = coords.map(item => item.position.lat.toFixed(5)).join(",");
    const longitudes = coords.map(item => item.position.lng.toFixed(5)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitudes)}&longitude=${encodeURIComponent(longitudes)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=celsius&wind_speed_unit=kmh&timezone=Europe%2FLondon`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather request returned ${res.status}`);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];
    boroughWeatherByName = new Map();
    coords.forEach((item, index) => {
      const current = data[index]?.current || {};
      const info = weatherCodeInfo(current.weather_code);
      boroughWeatherByName.set(item.name, {
        temperature: Number(current.temperature_2m),
        code: Number(current.weather_code),
        windSpeed: Number(current.wind_speed_10m),
        windDirection: Number(current.wind_direction_10m),
        ...info
      });
    });
    try { localStorage.setItem(V13F_WEATHER_CACHE_STORAGE, JSON.stringify({ time: Date.now(), items: [...boroughWeatherByName.entries()].map(([name, weather]) => ({ name, weather })) })); } catch {}
    refreshBoroughLabelVisibility();
  })().catch(err => {
    console.warn("Borough weather unavailable", err);
    showToast("London weather data is temporarily unavailable.", 3200);
  }).finally(() => { boroughWeatherLoading = null; });
  return boroughWeatherLoading;
}

function makeWindGrid() {
  const points = [];
  const rows = 5, cols = 7;
  const south = 51.30, north = 51.68, west = -0.50, east = 0.28;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    points.push({ lat: south + (north - south) * (r + 0.5) / rows, lng: west + (east - west) * (c + 0.5) / cols });
  }
  return points;
}

function clearWindOverlays() {
  windOverlays.forEach(item => item.setMap(null));
  windOverlays = [];
}

async function ensureWindOverlay(force = false) {
  if (!map || (!cityInfoState.wind && !force)) return;
  if (windLoading) return windLoading;
  clearWindOverlays();
  windLoading = (async () => {
    const points = makeWindGrid();
    const lats = points.map(item => item.lat.toFixed(4)).join(",");
    const lngs = points.map(item => item.lng.toFixed(4)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=Europe%2FLondon`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wind request returned ${res.status}`);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];
    ensureWindArrowOverlayClass();
    points.forEach((position, index) => {
      const current = data[index]?.current || {};
      const speed = Number(current.wind_speed_10m) || 0;
      const fromDirection = Number(current.wind_direction_10m) || 0;
      const overlay = new window.__V13FWindArrowOverlay(position, speed, fromDirection);
      overlay.setMap(map);
      overlay.setVisible(cityInfoState.wind);
      windOverlays.push(overlay);
    });
  })().catch(err => {
    console.warn("Wind overlay unavailable", err);
    showToast("Wind data is temporarily unavailable.", 3000);
  }).finally(() => { windLoading = null; });
  return windLoading;
}

function ensureWindArrowOverlayClass() {
  if (window.__V13FWindArrowOverlay) return;
  window.__V13FWindArrowOverlay = class extends HtmlOverlay {
    constructor(position, speed, direction) {
      super(position, "wind-arrow-overlay");
      this.speed = speed;
      this.direction = direction;
    }
    onAdd() {
      super.onAdd();
      const rotation = (this.direction + 90) % 360;
      const scale = Math.max(.78, Math.min(1.55, .78 + this.speed / 55));
      this.div.innerHTML = `<span class="wind-arrow-glyph" style="transform:rotate(${rotation}deg) scale(${scale})">➤</span><small>${Math.round(this.speed)} km/h</small>`;
    }
  };
}

async function toggleCityInfoLayer(name) {
  cityInfoState[name] = !cityInfoState[name];
  saveV13FCityPrefs();
  syncV13FCityButtons();
  try {
    if (name === "districts" || name === "weather") await ensureBoroughData();
    if (name === "weather" && cityInfoState.weather) await ensureBoroughWeather();
    if (name === "wind" && cityInfoState.wind) await ensureWindOverlay();
  } catch (err) {
    console.warn(`Could not load ${name}`, err);
    cityInfoState[name] = false;
    saveV13FCityPrefs();
    syncV13FCityButtons();
    showToast(`${name[0].toUpperCase()}${name.slice(1)} layer could not load.`, 3000);
  }
  applyV13FCityInfoState();
}

function applyV13FCityInfoState() {
  if (boroughDataLayer) boroughDataLayer.setMap(cityInfoState.districts ? map : null);
  if (boroughDataLayer) boroughDataLayer.setStyle(feature => ({
    fillColor: feature.getProperty("__v13fColor") || "#56718a",
    fillOpacity: cityInfoState.districts ? 0.23 : 0,
    strokeColor: "#d8e4ef",
    strokeOpacity: cityInfoState.districts ? 0.48 : 0,
    strokeWeight: cityInfoState.districts ? 1.05 : 0,
    clickable: false,
    zIndex: 2
  }));
  refreshBoroughLabelVisibility();
  windOverlays.forEach(item => item.setVisible(cityInfoState.wind));
  syncV13FCityButtons();
  applyBaseMapStyle();
}

/* --- Surface performance: lazy load + simplified display geometry --- */
function v13fThinPath(path, maxPoints) {
  if (!Array.isArray(path) || path.length <= maxPoints) return path || [];
  const step = Math.ceil(path.length / maxPoints);
  const out = [];
  for (let i = 0; i < path.length; i += step) out.push(path[i]);
  if (out[out.length - 1] !== path[path.length - 1]) out.push(path[path.length - 1]);
  return out;
}

renderSurfaceLines = function() {
  surfaceRenderings.forEach(item => item.polyline.setMap(null));
  surfaceRenderings = [];
  for (const line of [...surfaceLineById.values()].sort(surfaceLineSort)) {
    const geometries = surfaceGeometryRegistry.get(line.id) || [];
    for (const rawPath of geometries) {
      if (!Array.isArray(rawPath) || rawPath.length < 2) continue;
      const limit = line.kind === "national" ? 170 : line.kind === "overground" ? 240 : 300;
      renderSurfacePath(line, v13fThinPath(rawPath, limit));
    }
  }
};

const buildSurfaceStationNodesV13D = buildSurfaceStationNodes;
buildSurfaceStationNodes = function() {
  surfaceStationOverlays.forEach(item => item.setMap(null));
  surfaceStationOverlays = [];
  const all = [...surfaceStationRegistry.values()];
  const curatedKeys = new Set(Object.keys(STATION_BACKGROUND));
  const selected = all.filter(station => {
    const onlyNational = station.services.length && station.services.every(service => service.kind === "national");
    if (!onlyNational) return true;
    const key = looseStationKey(station.name);
    const curated = [...curatedKeys].some(item => key.includes(item) || item.includes(key));
    const central = station.lat >= 51.42 && station.lat <= 51.60 && station.lon >= -0.34 && station.lon <= 0.16;
    return curated || central;
  }).slice(0, 260);
  for (const station of selected) {
    station.services.sort(surfaceLineSort);
    const overlay = new SurfaceStationOverlay(station);
    overlay.setMap(map);
    overlay.setVisible(false);
    surfaceStationOverlays.push(overlay);
  }
};

toggleLayer = function(name) {
  activeFavoriteRouteId = null;
  transientTransportSelection = null;
  persistentTransportFocus = null;
  updateRouteFocusChip();
  updateItemFocusChip();
  layerState[name] = !layerState[name];
  applyLayerState();

  if ((name === "rail" || name === "tram") && layerState[name] && !surfaceCoreLoaded) {
    showToast("Loading London Rail + Tram only when needed…", 1800);
    loadSurfaceNetworks().then(() => { routeGraphCache.clear(); applyLayerState(); });
  }
  if (name === "rail" && layerState.rail && !nationalRailLoaded) {
    clearTimeout(v13fSurfaceLoadTimer);
    v13fSurfaceLoadTimer = setTimeout(() => {
      if (layerState.rail && !nationalRailLoaded) {
        const load = () => ensureNationalRailLoaded().then(() => { routeGraphCache.clear(); applyLayerState(); });
        if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 1800 }); else load();
      }
    }, 900);
  }
};


/* Rebuild expensive labels only for layers that are actually visible. */
scheduleLineLabelRefresh = function() {
  clearTimeout(lineLabelRefreshTimer);
  clearTimeout(surfaceLabelRefreshTimer);
  if (layerState.metro) {
    lineLabelRefreshTimer = setTimeout(() => { if (lineGeometryRegistry.size) { rebuildLineLabels(); applyLayerState(); } }, 240);
  }
  if (layerState.rail || layerState.tram) {
    surfaceLabelRefreshTimer = setTimeout(() => { if (surfaceGeometryRegistry.size) { rebuildSurfaceLabels(); applyLayerState(); } }, 480);
  }
};

/* --- 30% secondary Metro visibility --- */
const applyLayerStateV13EFinal = applyLayerState;
applyLayerState = function() {
  applyLayerStateV13EFinal();
  const route = getActiveFavoriteRoute();
  const selection = getTransportSelection();
  const secondaryMetro = layerState.metro && !route && !selection && (layerState.rail || layerState.tram || layerState.places || cityInfoState.districts || cityInfoState.weather || cityInfoState.wind);
  if (secondaryMetro) {
    lineRenderings.forEach(item => {
      if (!item.polyline.getVisible()) return;
      if (item.role === "hit") item.polyline.setOptions({ strokeOpacity: 0.001, strokeWeight: 18 });
      else if (item.role === "casing") item.polyline.setOptions({ strokeOpacity: 0.22, strokeWeight: 4.8, zIndex: 15 });
      else item.polyline.setOptions({ strokeOpacity: 0.30, strokeWeight: 3.1, zIndex: 16 });
    });
    stationOverlays.forEach(overlay => { if (overlay.div) overlay.div.style.opacity = ".52"; });
    lineLabelOverlays.forEach(overlay => { if (overlay.div) overlay.div.style.opacity = ".58"; });
  } else {
    stationOverlays.forEach(overlay => { if (overlay.div) overlay.div.style.opacity = ""; });
    lineLabelOverlays.forEach(overlay => { if (overlay.div) overlay.div.style.opacity = ""; });
  }
  applyV13FCityInfoState();
  refreshPreciseRouteHighlights();
};

const applyBaseMapStyleV13EFinal = applyBaseMapStyle;
applyBaseMapStyle = function() {
  if (!map || activeMapType !== "roadmap") return;
  if (cityInfoState.wind) {
    map.setOptions({ styles: V13F_WIND_MAP_STYLES });
    return;
  }
  applyBaseMapStyleV13EFinal();
};

/* --- Precise route segments: line + start station + end station --- */
function routeStationsForService(mode, service) {
  if (mode === "metro") {
    return [...stationRegistry.values()].filter(station => station.lines?.some(line => line.id === service)).sort((a,b) => a.name.localeCompare(b.name));
  }
  if (mode === "rail" || mode === "tram") {
    return [...surfaceStationRegistry.values()].filter(station => station.services?.some(line => line.id === service)).sort((a,b) => a.name.localeCompare(b.name));
  }
  return [];
}

function getStationForSegment(mode, id) {
  if (!id) return null;
  return mode === "metro" ? stationRegistry.get(id) : surfaceStationRegistry.get(id);
}

function defaultServiceForStation(mode, stationId) {
  if (mode === "metro") return stationRegistry.get(stationId)?.lines?.[0]?.id || "piccadilly";
  const station = surfaceStationRegistry.get(stationId);
  return station?.services?.find(line => line.family === mode)?.id || station?.services?.[0]?.id || "";
}

normalizeRouteSegment = function(segment) {
  const normalized = {
    mode: segment.mode || "walk",
    service: String(segment.service || ""),
    kind: segment.kind === "station" ? "station" : "line",
    label: segment.label || "",
    stationId: segment.stationId || "",
    lat: Number.isFinite(Number(segment.lat)) ? Number(segment.lat) : undefined,
    lng: Number.isFinite(Number(segment.lng)) ? Number(segment.lng) : undefined,
    startStationId: segment.startStationId || "",
    endStationId: segment.endStationId || "",
    startStationName: segment.startStationName || "",
    endStationName: segment.endStationName || ""
  };
  if (normalized.kind === "station" && normalized.stationId && ["metro", "rail", "tram"].includes(normalized.mode)) {
    normalized.kind = "line";
    normalized.service = normalized.service.startsWith("station:") ? defaultServiceForStation(normalized.mode, normalized.stationId) : normalized.service || defaultServiceForStation(normalized.mode, normalized.stationId);
    normalized.startStationId = normalized.stationId;
    normalized.startStationName = normalized.label.replace(/ station$/i, "") || getStationForSegment(normalized.mode, normalized.stationId)?.name || "Start";
    normalized.stationId = "";
  }
  return normalized;
};

function v13fServiceOptions(segment) {
  if (segment.mode === "metro") {
    return TUBE_LINES.map(line => `<option value="${escapeHtml(line.id)}" ${line.id === segment.service ? "selected" : ""}>${escapeHtml(formatLineName(line))}</option>`).join("");
  }
  if (segment.mode === "rail" || segment.mode === "tram") {
    const lines = [...surfaceLineById.values()].filter(line => line.family === segment.mode).sort(surfaceLineSort);
    return lines.map(line => `<option value="${escapeHtml(line.id)}" ${line.id === segment.service ? "selected" : ""}>${escapeHtml(formatSurfaceLineName(line))}</option>`).join("");
  }
  return "";
}

function v13fStationOptions(segment, selectedId, placeholder) {
  const stations = routeStationsForService(segment.mode, segment.service);
  const options = stations.map(station => `<option value="${escapeHtml(station.id)}" ${station.id === selectedId ? "selected" : ""}>${escapeHtml(station.name)}</option>`).join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${options}`;
}

routeSegmentEditorHtml = function(rawSegment, index) {
  const segment = normalizeRouteSegment(rawSegment);
  if (["metro", "rail", "tram"].includes(segment.mode)) {
    const services = v13fServiceOptions(segment);
    const waiting = !services;
    return `<div class="route-segment-card" data-route-card="${index}">
      <div class="route-segment-card-head"><span class="route-step">${index + 1}</span><select class="form-control route-mode" data-segment-mode="${index}"><option value="metro" ${segment.mode === "metro" ? "selected" : ""}>Metro</option><option value="rail" ${segment.mode === "rail" ? "selected" : ""}>Rail</option><option value="tram" ${segment.mode === "tram" ? "selected" : ""}>Tram</option><option value="bus">Bus</option><option value="walk">Walk</option></select><button class="mini-danger" data-remove-segment="${index}" title="Remove segment">×</button></div>
      <select class="form-control route-line-select" data-segment-service="${index}" ${waiting ? "disabled" : ""}>${services || `<option>Load ${segment.mode} layer first</option>`}</select>
      <div class="route-endpoints">
        <select class="form-control" data-segment-start="${index}">${v13fStationOptions(segment, segment.startStationId, "Start station")}</select>
        <span class="route-endpoint-arrow">→</span>
        <select class="form-control" data-segment-end="${index}">${v13fStationOptions(segment, segment.endStationId, "End station")}</select>
      </div>
      <div class="route-segment-status">${segment.startStationId && segment.endStationId ? `Glow: ${escapeHtml(segment.startStationName || getStationForSegment(segment.mode, segment.startStationId)?.name || "Start")} → ${escapeHtml(segment.endStationName || getStationForSegment(segment.mode, segment.endStationId)?.name || "End")}` : "Choose both stations — or tap stations on the map while this panel stays open."}</div>
    </div>`;
  }
  const placeholder = segmentPlaceholder(segment.mode);
  return `<div class="route-segment-card"><div class="route-segment-card-head"><span class="route-step">${index + 1}</span><select class="form-control route-mode" data-segment-mode="${index}"><option value="metro">Metro</option><option value="rail">Rail</option><option value="tram">Tram</option><option value="bus" ${segment.mode === "bus" ? "selected" : ""}>Bus</option><option value="walk" ${segment.mode === "walk" ? "selected" : ""}>Walk</option></select><button class="mini-danger" data-remove-segment="${index}" title="Remove segment">×</button></div><input class="form-control" data-segment-service="${index}" value="${escapeHtml(segment.service || "")}" placeholder="${escapeHtml(placeholder)}" /></div>`;
};

renderRouteEditorSegments = function() {
  const node = el("route-segments");
  if (!node) return;
  routeEditorSegments = routeEditorSegments.map(normalizeRouteSegment);
  node.innerHTML = routeEditorSegments.map((segment, index) => routeSegmentEditorHtml(segment, index)).join("");

  node.querySelectorAll("[data-segment-mode]").forEach(select => select.addEventListener("change", async () => {
    const index = Number(select.dataset.segmentMode);
    const mode = select.value;
    if ((mode === "rail" || mode === "tram") && !surfaceCoreLoaded) await loadSurfaceNetworks();
    routeEditorSegments[index] = normalizeRouteSegment({ mode, service: mode === "metro" ? "piccadilly" : (mode === "rail" ? [...surfaceLineById.values()].find(line => line.family === "rail")?.id || "" : mode === "tram" ? [...surfaceLineById.values()].find(line => line.family === "tram")?.id || "" : "") });
    renderRouteEditorSegments();
  }));

  node.querySelectorAll("[data-segment-service]").forEach(control => {
    if (control.tagName === "SELECT") {
      control.addEventListener("change", () => {
        const index = Number(control.dataset.segmentService);
        routeEditorSegments[index].service = control.value;
        routeEditorSegments[index].startStationId = "";
        routeEditorSegments[index].endStationId = "";
        routeEditorSegments[index].startStationName = "";
        routeEditorSegments[index].endStationName = "";
        renderRouteEditorSegments();
      });
    } else {
      control.addEventListener("input", () => {
        routeEditorSegments[Number(control.dataset.segmentService)].service = control.value;
      });
    }
  });

  node.querySelectorAll("[data-segment-start]").forEach(control => control.addEventListener("change", () => {
    const index = Number(control.dataset.segmentStart);
    const segment = routeEditorSegments[index];
    segment.startStationId = control.value;
    segment.startStationName = getStationForSegment(segment.mode, control.value)?.name || "";
    if (segment.endStationId === segment.startStationId) { segment.endStationId = ""; segment.endStationName = ""; }
    renderRouteEditorSegments();
  }));

  node.querySelectorAll("[data-segment-end]").forEach(control => control.addEventListener("change", () => {
    const index = Number(control.dataset.segmentEnd);
    const segment = routeEditorSegments[index];
    segment.endStationId = control.value;
    segment.endStationName = getStationForSegment(segment.mode, control.value)?.name || "";
    if (segment.endStationId === segment.startStationId) { segment.endStationId = ""; segment.endStationName = ""; showToast("Start and end stations need to be different."); }
    renderRouteEditorSegments();
  }));

  node.querySelectorAll("[data-remove-segment]").forEach(button => button.addEventListener("click", () => {
    routeEditorSegments.splice(Number(button.dataset.removeSegment), 1);
    if (!routeEditorSegments.length) routeEditorSegments.push(normalizeRouteSegment({ mode: "metro", service: "piccadilly" }));
    renderRouteEditorSegments();
  }));

  renderRouteHighlights(routeEditorSegments, { preview: true });
};

openRouteEditor = function() {
  routeEditorSegments = [normalizeRouteSegment({ mode: "metro", service: "piccadilly" })];
  el("route-name-input").value = "";
  renderRouteEditorSegments();
  el("route-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  restorePanelPosition(el("route-editor-sheet"));
  bringPanelToFront(el("route-editor-sheet"));
};

closeRouteEditor = function(updateBody = true) {
  el("route-editor-sheet").classList.add("hidden");
  routeEditorSegments = [];
  clearRouteHighlights();
  if (updateBody && allOtherSheetsClosed("route-editor-sheet")) document.body.classList.remove("detail-open");
};

addRouteEditorSegment = function() {
  routeEditorSegments.push(normalizeRouteSegment({ mode: "metro", service: "piccadilly" }));
  renderRouteEditorSegments();
};

startRouteWithSegment = async function(segment) {
  transientTransportSelection = null;
  persistentTransportFocus = null;
  updateItemFocusChip();
  const normalized = normalizeRouteSegment(segment);
  if ((normalized.mode === "rail" || normalized.mode === "tram") && !surfaceCoreLoaded) await loadSurfaceNetworks();
  closeDetail(false);
  routeEditorSegments = [normalized];
  el("route-name-input").value = "";
  renderRouteEditorSegments();
  el("route-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  restorePanelPosition(el("route-editor-sheet"));
  bringPanelToFront(el("route-editor-sheet"));
  showToast(normalized.startStationId ? "Route started here. Choose the other station on the map or in the route panel." : "Route started. Choose start and end stations.", 2800);
};

function routeSegmentValid(segment) {
  if (segment.mode === "walk") return !!segment.service;
  if (segment.mode === "bus") return !!segment.service;
  if (["metro", "rail", "tram"].includes(segment.mode)) return !!segment.service && !!segment.startStationId && !!segment.endStationId;
  return false;
}

saveFavoriteRouteFromEditor = function() {
  const name = el("route-name-input").value.trim();
  const segments = routeEditorSegments.map(normalizeRouteSegment).filter(segment => segment.mode === "walk" || segment.mode === "bus" || segment.service);
  if (!name) { showToast("Give the route a name first."); return; }
  const incomplete = segments.find(segment => ["metro", "rail", "tram"].includes(segment.mode) && !routeSegmentValid(segment));
  if (incomplete) { showToast("Choose both start and end stations for every transport segment.", 3000); return; }
  if (!segments.length) { showToast("Add at least one route segment."); return; }
  const route = { id: `route-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name, segments, useCount: 0, createdAt: Date.now() };
  favoriteRoutes.push(route);
  saveFavoriteRoutes();
  closeRouteEditor();
  renderFavoritesSheet();
  refreshSearchIfOpen();
  showToast(`Saved route: ${route.name}`);
};

segmentDisplayName = function(rawSegment) {
  const segment = normalizeRouteSegment(rawSegment);
  if (segment.mode === "metro") {
    const line = TUBE_LINE_BY_ID.get(segment.service);
    const base = line ? formatLineName(line) : segment.service || "Metro";
    return segment.startStationId && segment.endStationId ? `${base} · ${segment.startStationName || getStationForSegment("metro", segment.startStationId)?.name || "Start"} → ${segment.endStationName || getStationForSegment("metro", segment.endStationId)?.name || "End"}` : base;
  }
  if (segment.mode === "rail" || segment.mode === "tram") {
    const line = surfaceLineById.get(segment.service);
    const base = line ? formatSurfaceLineName(line) : segment.service || (segment.mode === "tram" ? "Tram" : "Rail");
    return segment.startStationId && segment.endStationId ? `${base} · ${segment.startStationName || getStationForSegment(segment.mode, segment.startStationId)?.name || "Start"} → ${segment.endStationName || getStationForSegment(segment.mode, segment.endStationId)?.name || "End"}` : base;
  }
  if (segment.mode === "bus") return `Bus ${segment.service}`;
  if (segment.mode === "walk") return segment.service || "Walk";
  return segment.service || segment.mode;
};

routeSegmentSummary = function(route) {
  const parts = (route?.segments || []).map(segmentDisplayName);
  return parts.length ? parts.slice(0, 3).join(" • ") + (parts.length > 3 ? " • …" : "") : "Favorite route";
};

function useStationInOpenRoute(station, family) {
  if (el("route-editor-sheet")?.classList.contains("hidden")) return false;
  const services = family === "metro" ? (station.lines || []).map(line => line.id) : (station.services || []).filter(line => line.family === family).map(line => line.id);
  for (let index = routeEditorSegments.length - 1; index >= 0; index--) {
    const segment = routeEditorSegments[index];
    if (segment.mode !== family || !services.includes(segment.service)) continue;
    if (!segment.startStationId) {
      segment.startStationId = station.id; segment.startStationName = station.name;
      renderRouteEditorSegments(); closeDetail(); showToast(`${station.name} set as the segment start.`); return true;
    }
    if (!segment.endStationId && segment.startStationId !== station.id) {
      segment.endStationId = station.id; segment.endStationName = station.name;
      renderRouteEditorSegments(); closeDetail(); showToast(`${station.name} set as the segment end.`); return true;
    }
  }
  const service = services[0];
  if (!service) { showToast("This station has no matching service for the open route segment."); return true; }
  routeEditorSegments.push(normalizeRouteSegment({ mode: family, service, startStationId: station.id, startStationName: station.name }));
  renderRouteEditorSegments();
  closeDetail();
  showToast(`New ${family} segment started at ${station.name}.`);
  return true;
}

function patchStationRouteAction(family, station) {
  const button = el("detail-content")?.querySelector("#route-add-station-btn");
  if (!button) return;
  const replacement = button.cloneNode(true);
  button.replaceWith(replacement);
  const routeOpen = !el("route-editor-sheet")?.classList.contains("hidden");
  replacement.textContent = routeOpen ? "Use as route endpoint" : "Start route here";
  replacement.addEventListener("click", () => {
    if (routeOpen && useStationInOpenRoute(station, family)) return;
    const service = family === "metro" ? station.lines?.[0]?.id : station.services?.find(line => line.family === family)?.id;
    startRouteWithSegment({ mode: family, service: service || "", kind: "line", startStationId: station.id, startStationName: station.name });
  });
}

const showStationInfoV13EFinal = showStationInfo;
showStationInfo = async function(station) {
  await showStationInfoV13EFinal(station);
  patchStationRouteAction("metro", station);
  bringPanelToFront(el("detail-card"));
};

const showSurfaceStationInfoV13EFinal = showSurfaceStationInfo;
showSurfaceStationInfo = async function(station) {
  await showSurfaceStationInfoV13EFinal(station);
  const family = station.services?.some(line => line.family === "rail") ? "rail" : "tram";
  patchStationRouteAction(family, station);
  bringPanelToFront(el("detail-card"));
};

/* --- Route graph + glow overlays --- */
function clearRouteHighlights() {
  routeHighlightPolylines.forEach(polyline => polyline.setMap(null));
  routeHighlightPolylines = [];
}

function transportGeometryForSegment(segment) {
  return segment.mode === "metro" ? lineGeometryRegistry.get(segment.service) || [] : surfaceGeometryRegistry.get(segment.service) || [];
}

function routeGraphKey(point) {
  return `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`;
}

function getRouteGraph(segment) {
  const cacheKey = `${segment.mode}:${segment.service}`;
  if (routeGraphCache.has(cacheKey)) return routeGraphCache.get(cacheKey);
  const paths = transportGeometryForSegment(segment);
  const nodes = new Map();
  const adjacency = new Map();
  const ensure = point => {
    const key = routeGraphKey(point);
    if (!nodes.has(key)) nodes.set(key, { key, lat: Number(point.lat), lng: Number(point.lng) });
    if (!adjacency.has(key)) adjacency.set(key, []);
    return key;
  };
  const endpointKeys = [];
  for (const rawPath of paths) {
    const path = v13fThinPath(rawPath, 850);
    if (path.length < 2) continue;
    const pathKeys = path.map(ensure);
    endpointKeys.push(pathKeys[0], pathKeys[pathKeys.length - 1]);
    for (let i = 0; i < pathKeys.length - 1; i++) {
      const a = pathKeys[i], b = pathKeys[i+1];
      const weight = haversineKm(nodes.get(a), nodes.get(b));
      adjacency.get(a).push([b, weight]);
      adjacency.get(b).push([a, weight]);
    }
  }
  const endpoints = [...new Set(endpointKeys)];
  for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
    const a = nodes.get(endpoints[i]), b = nodes.get(endpoints[j]);
    const distance = haversineKm(a, b);
    if (distance <= 0.055) {
      adjacency.get(a.key).push([b.key, distance]);
      adjacency.get(b.key).push([a.key, distance]);
    }
  }
  const graph = { nodes, adjacency };
  routeGraphCache.set(cacheKey, graph);
  return graph;
}

function nearestGraphNode(graph, position) {
  let best = null, bestDistance = Infinity;
  for (const node of graph.nodes.values()) {
    const distance = haversineKm(position, node);
    if (distance < bestDistance) { bestDistance = distance; best = node.key; }
  }
  return best;
}

function shortestGraphPath(graph, startKey, endKey) {
  if (!startKey || !endKey) return [];
  const dist = new Map([[startKey, 0]]), previous = new Map(), visited = new Set();
  const queue = [[0, startKey]];
  while (queue.length) {
    queue.sort((a,b) => a[0] - b[0]);
    const [currentDistance, current] = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === endKey) break;
    for (const [next, weight] of graph.adjacency.get(current) || []) {
      if (visited.has(next)) continue;
      const candidate = currentDistance + weight;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate); previous.set(next, current); queue.push([candidate, next]);
      }
    }
  }
  if (!dist.has(endKey)) return [];
  const keys = [];
  let cursor = endKey;
  while (cursor) { keys.push(cursor); if (cursor === startKey) break; cursor = previous.get(cursor); }
  keys.reverse();
  return keys[0] === startKey ? keys.map(key => graph.nodes.get(key)).filter(Boolean).map(node => ({ lat: node.lat, lng: node.lng })) : [];
}

function precisePathForSegment(rawSegment) {
  const segment = normalizeRouteSegment(rawSegment);
  if (!["metro", "rail", "tram"].includes(segment.mode) || !segment.service || !segment.startStationId || !segment.endStationId) return [];
  const start = getStationForSegment(segment.mode, segment.startStationId);
  const end = getStationForSegment(segment.mode, segment.endStationId);
  if (!start || !end) return [];
  const startPos = { lat: Number(start.lat), lng: Number(start.lon ?? start.lng) };
  const endPos = { lat: Number(end.lat), lng: Number(end.lon ?? end.lng) };
  const graph = getRouteGraph(segment);
  const path = shortestGraphPath(graph, nearestGraphNode(graph, startPos), nearestGraphNode(graph, endPos));
  return path.length ? [startPos, ...path, endPos] : [startPos, endPos];
}

function segmentColor(segment) {
  if (segment.mode === "metro") return TUBE_LINE_BY_ID.get(segment.service)?.color || "#79B6FF";
  return surfaceLineById.get(segment.service)?.color || "#79B6FF";
}

function renderRouteHighlights(segments, options = {}) {
  clearRouteHighlights();
  if (!map) return;
  for (const raw of segments || []) {
    const segment = normalizeRouteSegment(raw);
    const path = precisePathForSegment(segment);
    if (path.length < 2) continue;
    const color = segmentColor(segment);
    const halo = new google.maps.Polyline({ map, path, strokeColor: "#FFFFFF", strokeOpacity: options.preview ? .82 : .92, strokeWeight: 11, zIndex: 88, clickable: false });
    const glow = new google.maps.Polyline({ map, path, strokeColor: color, strokeOpacity: 1, strokeWeight: 6, zIndex: 89, clickable: false });
    routeHighlightPolylines.push(halo, glow);
  }
}

function refreshPreciseRouteHighlights() {
  const routeEditorOpen = !el("route-editor-sheet")?.classList.contains("hidden");
  if (routeEditorOpen) { renderRouteHighlights(routeEditorSegments, { preview: true }); return; }
  const route = getActiveFavoriteRoute();
  if (route) { renderRouteHighlights(route.segments || [], { preview: false }); return; }
  clearRouteHighlights();
}

const activateFavoriteRouteV13EFinal = activateFavoriteRoute;
activateFavoriteRoute = function(routeId, options = {}) {
  activateFavoriteRouteV13EFinal(routeId, options);
  const route = favoriteRoutes.find(item => item.id === routeId);
  if (route) renderRouteHighlights(route.segments || [], { preview: false });
};

const clearFavoriteRouteFocusV13EFinal = clearFavoriteRouteFocus;
clearFavoriteRouteFocus = function() {
  clearFavoriteRouteFocusV13EFinal();
  clearRouteHighlights();
};

/* --- Desktop movable panels; mobile remains stacked bottom-sheet UI --- */
function loadPanelPositions() {
  try { return JSON.parse(localStorage.getItem(V13F_PANEL_POSITIONS_STORAGE) || "{}") || {}; } catch { return {}; }
}

function savePanelPosition(panel) {
  if (!panel?.id || window.innerWidth <= 720) return;
  const rect = panel.getBoundingClientRect();
  const positions = loadPanelPositions();
  positions[panel.id] = { left: rect.left, top: rect.top };
  try { localStorage.setItem(V13F_PANEL_POSITIONS_STORAGE, JSON.stringify(positions)); } catch {}
}

function restorePanelPosition(panel) {
  if (!panel?.id || window.innerWidth <= 720) return;
  const position = loadPanelPositions()[panel.id];
  if (!position) return;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, position.left))}px`;
  panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 100, position.top))}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function bringPanelToFront(panel) {
  if (!panel) return;
  panelZCounter += 1;
  panel.style.zIndex = String(panelZCounter);
}

function enablePanelDrag(panel) {
  if (!panel || panel.dataset.dragReady === "true") return;
  panel.dataset.dragReady = "true";
  panel.addEventListener("pointerdown", () => bringPanelToFront(panel));
  const handle = panel.querySelector(".sheet-handle");
  if (!handle) return;
  handle.addEventListener("pointerdown", event => {
    if (window.innerWidth <= 720) return;
    event.preventDefault();
    bringPanelToFront(panel);
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY;
    const originLeft = rect.left, originTop = rect.top;
    handle.setPointerCapture?.(event.pointerId);
    const move = moveEvent => {
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, originLeft + moveEvent.clientX - startX));
      const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, originTop + moveEvent.clientY - startY));
      panel.style.left = `${left}px`; panel.style.top = `${top}px`; panel.style.right = "auto"; panel.style.bottom = "auto";
    };
    const end = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); savePanelPosition(panel); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
  });
  restorePanelPosition(panel);
}

function initV13FPanelWorkspace() {
  ["detail-card", "route-editor-sheet", "favorites-sheet", "add-sheet", "place-editor-sheet", "location-search-sheet"].map(el).filter(Boolean).forEach(enablePanelDrag);
}

const openDetailV13EFinal = openDetail;
openDetail = function() {
  openDetailV13EFinal();
  restorePanelPosition(el("detail-card"));
  bringPanelToFront(el("detail-card"));
};

/* --- v1.3F init and UI wiring --- */
const initMapV13EFinal = initMap;
initMap = function() {
  initMapV13EFinal();
  initV13FPanelWorkspace();
  syncV13FCityButtons();
  map.addListener("zoom_changed", refreshBoroughLabelVisibility);
  if (cityInfoState.districts || cityInfoState.weather) ensureBoroughData().then(async () => {
    if (cityInfoState.weather) await ensureBoroughWeather();
    applyV13FCityInfoState();
  }).catch(console.warn);
  if (cityInfoState.wind) ensureWindOverlay().then(applyV13FCityInfoState).catch(console.warn);
  if ((layerState.rail || layerState.tram) && !surfaceCoreLoaded) {
    loadSurfaceNetworks().then(() => {
      routeGraphCache.clear();
      applyLayerState();
      if (layerState.rail && !nationalRailLoaded) {
        const load = () => ensureNationalRailLoaded().then(() => { routeGraphCache.clear(); applyLayerState(); });
        if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 1800 }); else setTimeout(load, 900);
      }
    });
  }
};

document.querySelectorAll("[data-city-layer]").forEach(button => button.addEventListener("click", () => toggleCityInfoLayer(button.dataset.cityLayer)));
syncV13FCityButtons();


/* ---------- Controls ---------- */
el("metro-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("metro");
});

el("rail-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("rail");
});

el("tram-btn").addEventListener("click", () => {
  if (!map) return;
  toggleLayer("tram");
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

el("favorites-btn").addEventListener("click", openFavoritesSheet);
el("favorites-close").addEventListener("click", () => closeFavoritesSheet());

el("route-focus-chip").addEventListener("click", () => {
  const route = getActiveFavoriteRoute();
  if (route) showFavoriteRouteInfo(route);
});

el("item-focus-chip").addEventListener("click", () => {
  clearPersistentTransportFocus();
  closeDetail();
  showToast("Focus cleared.");
});

el("save-place-btn").addEventListener("click", savePlaceFromEditor);
el("place-editor-close").addEventListener("click", () => closePlaceEditor());

el("location-search-close").addEventListener("click", () => closeLocationSearchSheet());
el("location-search-btn").addEventListener("click", geocodeLocationForPlace);
el("location-search-input").addEventListener("keydown", event => {
  if (event.key === "Enter") geocodeLocationForPlace();
});

el("route-editor-close").addEventListener("click", () => closeRouteEditor());
el("add-route-segment-btn").addEventListener("click", addRouteEditorSegment);
el("save-route-btn").addEventListener("click", saveFavoriteRouteFromEditor);

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
  clearSurfaceNetwork();
  await Promise.allSettled([loadTubeNetwork(true), loadSurfaceNetworks(true)]);
  if (layerState.rail) ensureNationalRailLoaded(true);
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


/* ---------- v1.4A: multi-city engine + cinematic city travel ---------- */
const V14_ACTIVE_CITY_STORAGE = "cityLife.activeCity.v1";
const V14_CITY_LAYER_STATE_STORAGE = "cityLife.cityLayerState.v1";
const V14_FAVORITE_MIGRATION_STORAGE = "cityLife.favoriteCityMigration.v1";

const CITY_CONFIG = {
  london: {
    id: "london", name: "London", selector: "London", center: { lat: 51.5078, lng: -0.1277 }, zoom: 12.4,
    region: "gb", geocoderRegion: "GB", language: "en-GB", gesture: "",
    status: "London is the reference city · full v1.3 transport + city layers available."
  },
  rome: {
    id: "rome", name: "Rome", selector: "Rome (Ela ❤️)", center: { lat: 41.9028, lng: 12.4964 }, zoom: 12.25,
    region: "it", geocoderRegion: "IT", language: "en", gesture: "Ela ❤️",
    status: "Rome city shell is ready · full transit data comes in v1.4B."
  },
  istanbul: {
    id: "istanbul", name: "İstanbul", selector: "İstanbul", center: { lat: 41.0082, lng: 28.9784 }, zoom: 11.6,
    region: "tr", geocoderRegion: "TR", language: "tr", gesture: "",
    status: "İstanbul city shell is ready · full transit data comes in v1.4C."
  },
  izmir: {
    id: "izmir", name: "İzmir", selector: "İzmir", center: { lat: 38.4237, lng: 27.1428 }, zoom: 12.0,
    region: "tr", geocoderRegion: "TR", language: "tr", gesture: "",
    status: "İzmir city shell is ready · full transit data comes in v1.4D."
  }
};

let currentCityId = loadActiveCityId();
let cityFlightRunning = false;
let cityArrivalTimer = null;
let cityLayerMemory = loadCityLayerMemory();

function loadActiveCityId() {
  const stored = localStorage.getItem(V14_ACTIVE_CITY_STORAGE);
  return CITY_CONFIG[stored] ? stored : "london";
}

function getActiveCityConfig() {
  return CITY_CONFIG[currentCityId] || CITY_CONFIG.london;
}

function loadCityLayerMemory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(V14_CITY_LAYER_STATE_STORAGE) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveCurrentCityLayerMemory() {
  cityLayerMemory[currentCityId] = {
    metro: !!layerState.metro, rail: !!layerState.rail, tram: !!layerState.tram,
    places: !!layerState.places,
    districts: !!cityInfoState?.districts, weather: !!cityInfoState?.weather, wind: !!cityInfoState?.wind
  };
  try { localStorage.setItem(V14_CITY_LAYER_STATE_STORAGE, JSON.stringify(cityLayerMemory)); } catch {}
}

function restoreCityLayerMemory(cityId) {
  const saved = cityLayerMemory[cityId];
  if (cityId === "london") {
    layerState.metro = saved ? !!saved.metro : !!savedLayerPrefs.metro;
    layerState.rail = saved ? !!saved.rail : !!savedLayerPrefs.rail;
    layerState.tram = saved ? !!saved.tram : !!savedLayerPrefs.tram;
    cityInfoState.districts = saved ? !!saved.districts : !!cityInfoState.districts;
    cityInfoState.weather = saved ? !!saved.weather : !!cityInfoState.weather;
    cityInfoState.wind = saved ? !!saved.wind : !!cityInfoState.wind;
  } else {
    // v1.4A establishes the city shell. City-specific transit arrives in B/C/D.
    layerState.metro = false;
    layerState.rail = false;
    layerState.tram = false;
    cityInfoState.districts = false;
    cityInfoState.weather = false;
    cityInfoState.wind = false;
  }
  layerState.places = saved ? !!saved.places : false;
}

function inferCityIdFromCoords(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  let best = "london", score = Infinity;
  for (const config of Object.values(CITY_CONFIG)) {
    const dx = (point.lng - config.center.lng) * Math.cos(((point.lat + config.center.lat) / 2) * Math.PI / 180);
    const dy = point.lat - config.center.lat;
    const d = dx * dx + dy * dy;
    if (d < score) { score = d; best = config.id; }
  }
  return best;
}

function getPlaceCityId(place) {
  return place?.city && CITY_CONFIG[place.city] ? place.city : inferCityIdFromCoords(place?.lat, place?.lng);
}

function getRouteCityId(route) {
  return route?.city && CITY_CONFIG[route.city] ? route.city : "london";
}

function migrateV14FavoriteCities() {
  let changedPlaces = false, changedRoutes = false;
  frequentPlaces = frequentPlaces.map(place => {
    if (place.city && CITY_CONFIG[place.city]) return place;
    changedPlaces = true;
    return { ...place, city: inferCityIdFromCoords(place.lat, place.lng) };
  });
  favoriteRoutes = favoriteRoutes.map(route => {
    if (route.city && CITY_CONFIG[route.city]) return route;
    changedRoutes = true;
    return { ...route, city: "london" };
  });
  if (changedPlaces) saveFrequentPlaces();
  if (changedRoutes) saveFavoriteRoutes();
  try { localStorage.setItem(V14_FAVORITE_MIGRATION_STORAGE, "1"); } catch {}
}

function updateV14CityUI() {
  const config = getActiveCityConfig();
  document.querySelectorAll("[data-city]").forEach(button => {
    const active = button.dataset.city === currentCityId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const input = el("search-input");
  if (input) {
    input.placeholder = `Search ${config.name}…`;
    input.setAttribute("aria-label", `Search ${config.name}`);
  }
  const title = el("favorites-city-title");
  if (title) title.textContent = `Your ${config.name}`;
  const locationTitle = el("location-search-title");
  if (locationTitle) locationTitle.textContent = `Find a place in ${config.name}`;
  const locationStatus = el("location-search-status");
  if (locationStatus && !locationStatus.dataset.userStatus) locationStatus.textContent = `Search ${config.name} by place name or address.`;
  const status = el("city-data-status");
  if (status) status.textContent = config.status;
  document.title = `${config.name} · Our Cities Map`;
  syncV13EPanelUI();
  syncV13FCityButtons();
}

function showCityArrival(config) {
  const node = el("city-arrival");
  if (!node) return;
  const nameNode = node.querySelector(".city-arrival-name");
  const gestureNode = node.querySelector(".city-arrival-gesture");
  nameNode.textContent = config.name;
  gestureNode.textContent = config.gesture || "";
  node.classList.remove("show");
  void node.offsetWidth;
  node.classList.add("show");
  clearTimeout(cityArrivalTimer);
  cityArrivalTimer = setTimeout(() => node.classList.remove("show"), config.gesture ? 1750 : 1350);
}

function easeInOutCubic(t) {
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function interpolateLng(a, b, t) {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  let value = a + diff * t;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

function animateCityFlight(targetConfig) {
  if (!map) return Promise.resolve();
  const startCenterRaw = map.getCenter();
  const start = startCenterRaw ? { lat: startCenterRaw.lat(), lng: startCenterRaw.lng() } : getActiveCityConfig().center;
  const startZoom = Number(map.getZoom() || 11);
  const target = targetConfig.center;
  const duration = 2350;
  const cruiseZoom = Math.min(5.15, startZoom, targetConfig.zoom);
  const started = performance.now();
  cityFlightRunning = true;
  document.body.classList.add("city-flight-active");

  return new Promise(resolve => {
    function frame(now) {
      const raw = Math.min(1, (now - started) / duration);
      const t = easeInOutCubic(raw);
      const centerProgress = easeInOutCubic(Math.min(1, Math.max(0, (raw - .08) / .84)));
      const lat = start.lat + (target.lat - start.lat) * centerProgress;
      const lng = interpolateLng(start.lng, target.lng, centerProgress);
      let zoom;
      if (raw < .42) zoom = startZoom + (cruiseZoom - startZoom) * easeInOutCubic(raw / .42);
      else zoom = cruiseZoom + (targetConfig.zoom - cruiseZoom) * easeInOutCubic((raw - .42) / .58);
      map.moveCamera({ center: { lat, lng }, zoom });
      if (raw < 1) requestAnimationFrame(frame);
      else {
        map.moveCamera({ center: target, zoom: targetConfig.zoom });
        cityFlightRunning = false;
        document.body.classList.remove("city-flight-active");
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

async function switchCity(nextCityId, options = {}) {
  if (!CITY_CONFIG[nextCityId] || cityFlightRunning) return;
  if (nextCityId === currentCityId) {
    if (options.recenter && map) await animateCityFlight(CITY_CONFIG[nextCityId]);
    return;
  }
  saveCurrentCityLayerMemory();
  clearFavoriteRouteFocus?.();
  transientTransportSelection = null;
  persistentTransportFocus = null;
  closeDetail?.();
  closeFavoritesSheet?.(false);
  currentCityId = nextCityId;
  localStorage.setItem(V14_ACTIVE_CITY_STORAGE, currentCityId);
  restoreCityLayerMemory(currentCityId);
  applyLayerState();
  applyFavoriteCategoryVisibility();
  updateV14CityUI();
  hideSearchResults?.();
  if (el("search-input")) el("search-input").value = "";
  toggleLayersPanel(false);
  await animateCityFlight(getActiveCityConfig());
  showCityArrival(getActiveCityConfig());
}

function cityTransportAvailable() { return currentCityId === "london"; }

const toggleLayerV13FForV14 = toggleLayer;
toggleLayer = function(name) {
  if (["metro", "rail", "tram"].includes(name) && !cityTransportAvailable()) {
    const config = getActiveCityConfig();
    const phase = currentCityId === "rome" ? "v1.4B" : currentCityId === "istanbul" ? "v1.4C" : "v1.4D";
    showToast(`${config.name} transport arrives in ${phase}.`);
    return;
  }
  return toggleLayerV13FForV14(name);
};

const toggleCityInfoLayerV13FForV14 = toggleCityInfoLayer;
toggleCityInfoLayer = async function(name) {
  if (currentCityId !== "london") {
    showToast(`${getActiveCityConfig().name} districts + weather arrive with its city-data build.`);
    return;
  }
  return toggleCityInfoLayerV13FForV14(name);
};

const applyLayerStateV13FForV14 = applyLayerState;
applyLayerState = function() {
  applyLayerStateV13FForV14();
  // Never leak London-only network artwork into another city's view if the user has stale saved state.
  if (currentCityId !== "london") {
    lineRenderings.forEach(item => item.polyline.setVisible(false));
    stationOverlays.forEach(item => item.setVisible(false));
    lineLabelOverlays.forEach(item => item.setVisible(false));
    surfaceRenderings.forEach(item => item.polyline.setVisible(false));
    surfaceStationOverlays.forEach(item => item.setVisible(false));
    surfaceLabelOverlays.forEach(item => item.setVisible(false));
  }
  applyFavoriteCategoryVisibility();
};

const savePlaceFromEditorV13FForV14 = savePlaceFromEditor;
savePlaceFromEditor = function() {
  const editingId = editingFrequentPlaceId;
  const beforeIds = new Set(frequentPlaces.map(item => item.id));
  savePlaceFromEditorV13FForV14();
  let changed = false;
  if (editingId) {
    const place = frequentPlaces.find(item => item.id === editingId);
    if (place && !place.city) { place.city = currentCityId; changed = true; }
  } else {
    for (const place of frequentPlaces) {
      if (!beforeIds.has(place.id) && !place.city) { place.city = currentCityId; changed = true; }
    }
  }
  if (changed) { saveFrequentPlaces(); createPlaceMarkers(); applyLayerState(); }
};

const saveFavoriteRouteFromEditorV13FForV14 = saveFavoriteRouteFromEditor;
saveFavoriteRouteFromEditor = function() {
  const beforeIds = new Set(favoriteRoutes.map(item => item.id));
  saveFavoriteRouteFromEditorV13FForV14();
  let changed = false;
  for (const route of favoriteRoutes) {
    if (!beforeIds.has(route.id) && !route.city) { route.city = currentCityId; changed = true; }
  }
  if (changed) saveFavoriteRoutes();
};

const initMapV13FForV14 = initMap;
initMap = function() {
  initMapV13FForV14();
  migrateV14FavoriteCities();
  restoreCityLayerMemory(currentCityId);
  const config = getActiveCityConfig();
  map.moveCamera({ center: config.center, zoom: config.zoom });
  applyLayerState();
  updateV14CityUI();
  createPlaceMarkers();
};

// Add city to newly saved records that were created by earlier handlers before v1.4A migration.
migrateV14FavoriteCities();

document.querySelectorAll("[data-city]").forEach(button => button.addEventListener("click", () => switchCity(button.dataset.city)));
updateV14CityUI();



/* ---------- v1.4B: Rome transport + city information ---------- */
const ROME_CACHE_PREFIX = "ourCities.rome.v14b.";
const ROME_ARCGIS = {
  metroRailLines: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/MappaDiBaseWgs84_2024_new/MapServer/26",
  metroStations: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/MappaDiBaseWgs84_2024_new/MapServer/24",
  railStations: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/MappaDiBaseWgs84_2024_new/MapServer/13",
  surfaceRoutes: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/IdentfyReteWgs84/MapServer/0",
  surfaceStops: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/IdentifyFermateSuperficie1/MapServer/0",
  municipi: "https://viaggiacon.atac.roma.it/server/rest/services/Viaggiacon/IdentifyMunicipiWgs84/MapServer/0"
};

const ROME_METRO_LINES = [
  { id: "rome-metro-a", apiNames: ["METROA", "METRO A"], code: "A", name: "Metro A", displayName: "Metro A", color: "#F36C21", family: "metro", kind: "metro", about: "Rome's orange east–west metro line links Battistini with Anagnina through the historic centre, including stops near the Vatican, Piazza di Spagna and Termini.", background: "Line A opened in 1980 and became Rome's second metro line. It remains one of the city's main cross-centre rapid-transit corridors." },
  { id: "rome-metro-b", apiNames: ["METROB", "METRO B"], code: "B", name: "Metro B", displayName: "Metro B", color: "#0071BB", family: "metro", kind: "metro", about: "Rome's blue north-east/south metro corridor connects Rebibbia with Laurentina through Termini, Colosseo and EUR.", background: "The first section opened in 1955, making Line B the oldest part of Rome's metro network. Its northern branch later gained the B1 designation." },
  { id: "rome-metro-b1", apiNames: ["METROB1", "METRO B1"], code: "B1", name: "Metro B1", displayName: "Metro B1", color: "#0071BB", family: "metro", kind: "metro", about: "B1 is the northern branch of the blue Line B family, running from the shared southern trunk toward Jonio.", background: "The B1 branch opened in stages from 2012, extending rapid transit into neighbourhoods north of the original Line B corridor." },
  { id: "rome-metro-c", apiNames: ["METROC", "METRO C"], code: "C", name: "Metro C", displayName: "Metro C", color: "#008751", family: "metro", kind: "metro", about: "Rome's green automated metro line runs from the eastern suburbs at Pantano into the historic centre at Colosseo, with interchange to Lines A and B.", background: "Line C is Rome's newest metro line and uses fully automated trains. Its extension into the centre created new interchanges at San Giovanni and Colosseo." }
];
const ROME_METRO_BY_ID = new Map(ROME_METRO_LINES.map(line => [line.id, line]));

const ROME_RAIL_PROFILES = [
  { match: ["ROMA - LIDO", "ROMA-LIDO", "ROMA LIDO", "METROMARE"], id: "rome-rail-metromare", code: "R1", name: "Metromare", displayName: "R1 · Metromare", color: "#2C9AB7", family: "rail", kind: "urban-rail", about: "Metromare links the city at Porta San Paolo/Piramide with EUR and the coastal districts around Ostia.", background: "The railway has served Rome's route to the sea for more than a century. Today it functions as a high-capacity urban and suburban rail corridor." },
  { match: ["ROMA - VITERBO", "ROMA-VITERBO", "ROMA VITERBO", "ROMA NORD", "FLAMINIO"], id: "rome-rail-viterbo", code: "R2", name: "Roma–Viterbo", displayName: "R2 · Roma–Viterbo", color: "#9E5BB5", family: "rail", kind: "urban-rail", about: "The Roma–Viterbo railway leaves the city from Flaminio and serves northern Rome before continuing toward the metropolitan area.", background: "Its urban section is one of Rome's long-established suburban rail corridors and provides an important interchange with Metro A at Flaminio." },
  { match: ["FL1"], id: "rome-rail-fl1", code: "FL1", name: "FL1", displayName: "FL1 · Regional Rail", color: "#3F8EDB", family: "rail", kind: "regional" },
  { match: ["FL2"], id: "rome-rail-fl2", code: "FL2", name: "FL2", displayName: "FL2 · Regional Rail", color: "#5D9E55", family: "rail", kind: "regional" },
  { match: ["FL3"], id: "rome-rail-fl3", code: "FL3", name: "FL3", displayName: "FL3 · Regional Rail", color: "#C88437", family: "rail", kind: "regional" },
  { match: ["FL4"], id: "rome-rail-fl4", code: "FL4", name: "FL4", displayName: "FL4 · Regional Rail", color: "#B75562", family: "rail", kind: "regional" },
  { match: ["FL5"], id: "rome-rail-fl5", code: "FL5", name: "FL5", displayName: "FL5 · Regional Rail", color: "#8B6CC2", family: "rail", kind: "regional" },
  { match: ["FL6"], id: "rome-rail-fl6", code: "FL6", name: "FL6", displayName: "FL6 · Regional Rail", color: "#4FA3A5", family: "rail", kind: "regional" },
  { match: ["FL7"], id: "rome-rail-fl7", code: "FL7", name: "FL7", displayName: "FL7 · Regional Rail", color: "#AE7F4B", family: "rail", kind: "regional" },
  { match: ["FL8"], id: "rome-rail-fl8", code: "FL8", name: "FL8", displayName: "FL8 · Regional Rail", color: "#C05B9F", family: "rail", kind: "regional" }
];

const ROME_TRAM_NUMBERS = ["2", "3", "5", "8", "14", "19"];
const ROME_TRAM_COLORS = { "2": "#D89A37", "3": "#C87A44", "5": "#E3AA35", "8": "#D47E54", "14": "#C99E3C", "19": "#B98745" };
const ROME_TRAM_LINES = ROME_TRAM_NUMBERS.map(number => ({
  id: `rome-tram-${number}`,
  apiNames: [number],
  code: number,
  name: `Tram ${number}`,
  displayName: `Tram ${number}`,
  color: ROME_TRAM_COLORS[number],
  family: "tram",
  kind: "tram",
  about: `Tram ${number} is part of Rome's street-running tram network. The map shows the mapped tram corridor; temporary construction or replacement-bus arrangements can change day-to-day operation.`,
  background: "Rome's modern tram network descends from a much larger system that shaped travel across the city from the late nineteenth century onward."
}));
const ROME_TRAM_BY_ID = new Map(ROME_TRAM_LINES.map(line => [line.id, line]));

let romeLineById = new Map();
let romeMetroGeometryRegistry = new Map();
let romeSurfaceGeometryRegistry = new Map();
let romeMetroStationRegistry = new Map();
let romeSurfaceStationRegistry = new Map();
let romeMetroRenderings = [];
let romeSurfaceRenderings = [];
let romeMetroStationOverlays = [];
let romeSurfaceStationOverlays = [];
let romeLineLabelOverlays = [];
let romeCoreLoaded = false;
let romeCorePromise = null;
let romeTramLoaded = false;
let romeTramPromise = null;
let romeTramStopsLoaded = false;
let romeTramStopsPromise = null;
let romeLabelRefreshTimer = null;

let romeMunicipiLayer = null;
let romeMunicipiReady = false;
let romeMunicipiCentroids = [];
let romeMunicipiLabels = [];
let romeMunicipiWeather = new Map();
let romeWeatherPromise = null;
let romeWindOverlays = [];
let romeWindPromise = null;

function romeNormalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function romeSlug(value) {
  return romeNormalize(value).toLowerCase().replace(/\s+/g, "-").replace(/^-|-$/g, "") || `item-${Math.random().toString(36).slice(2,8)}`;
}

function formatRomeLineName(line) {
  if (!line) return "Transport line";
  return line.displayName || (line.family === "metro" ? `Metro ${line.code}` : line.family === "tram" ? `Tram ${line.code}` : `${line.code} · ${line.name}`);
}

function romeLineFamilyLabel(line) {
  if (line.family === "metro") return "METRO LINE";
  if (line.family === "tram") return "TRAM LINE";
  if (line.kind === "regional") return "REGIONAL RAIL";
  return "URBAN RAIL";
}

function classifyRomeMetro(raw) {
  const n = romeNormalize(raw).replace(/\s/g, "");
  if (n.includes("METROB1")) return ROME_METRO_BY_ID.get("rome-metro-b1");
  if (n.includes("METROA")) return ROME_METRO_BY_ID.get("rome-metro-a");
  if (n.includes("METROB")) return ROME_METRO_BY_ID.get("rome-metro-b");
  if (n.includes("METROC")) return ROME_METRO_BY_ID.get("rome-metro-c");
  return null;
}

function classifyRomeRail(raw) {
  const n = romeNormalize(raw);
  if (!n || n.includes("CENTOCELLE") || n === "FS") return null;
  return ROME_RAIL_PROFILES.find(profile => profile.match.some(token => n.includes(romeNormalize(token)))) || null;
}

function arcGisFeaturePaths(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  const convert = coords => coords.map(pair => ({ lat: Number(pair[1]), lng: Number(pair[0]) })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (geometry.type === "LineString") return [convert(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map(convert).filter(path => path.length > 1);
  return [];
}

function arcGisFeaturePoint(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [lng, lat] = geometry.coordinates.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function fetchRomeArcGisGeoJson(layerUrl, options = {}) {
  const params = new URLSearchParams({
    where: options.where || "1=1",
    outFields: options.outFields || "*",
    returnGeometry: options.returnGeometry === false ? "false" : "true",
    outSR: "4326",
    f: "geojson"
  });
  if (options.geometry) {
    params.set("geometry", options.geometry);
    params.set("geometryType", options.geometryType || "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }
  if (Number.isFinite(options.resultOffset)) params.set("resultOffset", String(options.resultOffset));
  if (Number.isFinite(options.resultRecordCount)) params.set("resultRecordCount", String(options.resultRecordCount));
  const url = `${layerUrl}/query?${params.toString()}`;
  const response = await fetch(url, { headers: { Accept: "application/geo+json,application/json" } });
  if (!response.ok) throw new Error(`Rome open-data request returned ${response.status}`);
  return response.json();
}

async function fetchRomePagedStops(envelope) {
  const all = [];
  for (let offset = 0; offset < 7000; offset += 1000) {
    const data = await fetchRomeArcGisGeoJson(ROME_ARCGIS.surfaceStops, {
      where: "SOPPRESSA <> 'T'",
      geometry: envelope,
      resultOffset: offset,
      resultRecordCount: 1000
    });
    const features = data?.features || [];
    all.push(...features);
    if (features.length < 1000) break;
  }
  return all;
}

function romeStationCanonicalName(raw) {
  let name = String(raw || "Station").replace(/\s+/g, " ").trim();
  name = name.replace(/^STAZIONE\s+/i, "").replace(/\s+METRO$/i, "");
  const n = romeNormalize(name);
  if (n.includes("TERMINI")) return "Termini";
  if (n.includes("COLOSSEO")) return "Colosseo / Fori Imperiali";
  if (n.includes("SAN GIOVANNI") || n === "S GIOVANNI") return "San Giovanni";
  if (n.includes("PIRAMIDE")) return "Piramide";
  if (n.includes("FLAMINIO")) return "Flaminio";
  if (n.includes("TIBURTINA")) return "Tiburtina";
  return name.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function romeStationKey(name, point, prefix = "metro") {
  const canonical = romeStationCanonicalName(name);
  const base = romeSlug(canonical);
  return `rome:${prefix}:${base}`;
}

function addUniqueRomeService(station, line, property = "services") {
  if (!line) return;
  station[property] = station[property] || [];
  if (!station[property].some(item => item.id === line.id)) station[property].push(line);
}

function ingestRomeCoreData(linesGeo, metroStationsGeo, railStationsGeo) {
  romeLineById = new Map();
  romeMetroGeometryRegistry = new Map();
  romeSurfaceGeometryRegistry = new Map();
  romeMetroStationRegistry = new Map();
  romeSurfaceStationRegistry = new Map();
  ROME_METRO_LINES.forEach(line => romeLineById.set(line.id, { ...line }));

  for (const feature of linesGeo?.features || []) {
    const props = feature.properties || {};
    const raw = `${props.NOMELINEA || ""} ${props.DESCR || ""} ${props.PERCORSO || ""}`;
    const paths = arcGisFeaturePaths(feature).filter(path => path.length > 1);
    if (!paths.length) continue;
    const metro = classifyRomeMetro(raw);
    if (metro) {
      const existing = romeMetroGeometryRegistry.get(metro.id) || [];
      existing.push(...paths);
      romeMetroGeometryRegistry.set(metro.id, existing);
      continue;
    }
    const railProfile = classifyRomeRail(raw);
    if (!railProfile) continue;
    const line = romeLineById.get(railProfile.id) || { ...railProfile };
    romeLineById.set(line.id, line);
    const existing = romeSurfaceGeometryRegistry.get(line.id) || [];
    existing.push(...paths);
    romeSurfaceGeometryRegistry.set(line.id, existing);
  }

  for (const feature of metroStationsGeo?.features || []) {
    const point = arcGisFeaturePoint(feature);
    if (!point) continue;
    const props = feature.properties || {};
    const line = classifyRomeMetro(`${props.NOMELINEA || ""} ${props.PERCORSI || ""}`);
    if (!line) continue;
    const name = romeStationCanonicalName(props.NOME || props.IMPIANTO || "Metro station");
    const id = romeStationKey(name, point, "metro");
    const station = romeMetroStationRegistry.get(id) || { id, name, lat: point.lat, lon: point.lng, lines: [], surfaceServices: [], city: "rome" };
    station.lat = (station.lat + point.lat) / 2;
    station.lon = (station.lon + point.lng) / 2;
    addUniqueRomeService(station, line, "lines");
    romeMetroStationRegistry.set(id, station);
  }

  for (const feature of railStationsGeo?.features || []) {
    const point = arcGisFeaturePoint(feature);
    if (!point) continue;
    const props = feature.properties || {};
    const line = classifyRomeRail(`${props.NOMELINEA || ""} ${props.PERCORSI || ""}`);
    if (!line) continue;
    const registeredLine = romeLineById.get(line.id) || { ...line };
    romeLineById.set(registeredLine.id, registeredLine);
    const name = romeStationCanonicalName(props.NOME || props.IMPIANTO || props.NOMESTAZ || "Rail station");
    const id = romeStationKey(name, point, "surface");
    const station = romeSurfaceStationRegistry.get(id) || { id, name, lat: point.lat, lon: point.lng, services: [], city: "rome" };
    station.lat = (station.lat + point.lat) / 2;
    station.lon = (station.lon + point.lng) / 2;
    addUniqueRomeService(station, registeredLine, "services");
    romeSurfaceStationRegistry.set(id, station);
  }
  linkRomeStationComplexes();
}

function linkRomeStationComplexes() {
  for (const surface of romeSurfaceStationRegistry.values()) {
    let best = null, bestDistance = Infinity;
    for (const metro of romeMetroStationRegistry.values()) {
      const a = romeNormalize(surface.name), b = romeNormalize(metro.name);
      const compatible = a === b || a.includes(b) || b.includes(a) || (a.includes("TERMINI") && b.includes("TERMINI")) || (a.includes("PIRAMIDE") && b.includes("PIRAMIDE"));
      if (!compatible) continue;
      const distance = haversineKm({ lat: surface.lat, lng: surface.lon }, { lat: metro.lat, lng: metro.lon });
      if (distance < bestDistance && distance <= 0.38) { best = metro; bestDistance = distance; }
    }
    if (!best) continue;
    surface.metroStationId = best.id;
    for (const service of surface.services) addUniqueRomeService(best, service, "surfaceServices");
  }
}

async function ensureRomeCore(force = false) {
  if (romeCoreLoaded && !force) return;
  if (romeCorePromise && !force) return romeCorePromise;
  romeCorePromise = (async () => {
    setNetworkStatus("Loading Rome Metro + Rail…");
    const cacheKey = `${ROME_CACHE_PREFIX}core`;
    let bundle = !force ? getCache(cacheKey) : null;
    if (!bundle) {
      const [linesGeo, metroStationsGeo, railStationsGeo] = await Promise.all([
        fetchRomeArcGisGeoJson(ROME_ARCGIS.metroRailLines),
        fetchRomeArcGisGeoJson(ROME_ARCGIS.metroStations),
        fetchRomeArcGisGeoJson(ROME_ARCGIS.railStations)
      ]);
      bundle = { linesGeo, metroStationsGeo, railStationsGeo };
      setCache(cacheKey, bundle);
    }
    ingestRomeCoreData(bundle.linesGeo, bundle.metroStationsGeo, bundle.railStationsGeo);
    romeCoreLoaded = true;
    renderRomeTransport();
    rebuildRomeLineLabels();
    setNetworkStatus("Rome transport ready");
    refreshSearchIfOpen();
  })().catch(err => {
    console.error("Rome core load failed", err);
    setNetworkStatus("Rome transport data unavailable", true);
    showToast("Rome Metro/Rail open data could not load. Try Refresh transport data.", 4200);
    throw err;
  }).finally(() => { romeCorePromise = null; });
  return romeCorePromise;
}

async function ensureRomeTrams(force = false) {
  if (romeTramLoaded && !force) return;
  if (romeTramPromise && !force) return romeTramPromise;
  romeTramPromise = (async () => {
    const cacheKey = `${ROME_CACHE_PREFIX}trams`;
    let data = !force ? getCache(cacheKey) : null;
    if (!data) {
      const where = `NOMELINEA IN (${ROME_TRAM_NUMBERS.map(number => `'${number}'`).join(",")})`;
      data = await fetchRomeArcGisGeoJson(ROME_ARCGIS.surfaceRoutes, { where });
      setCache(cacheKey, data);
    }
    ROME_TRAM_LINES.forEach(line => romeLineById.set(line.id, { ...line }));
    for (const feature of data?.features || []) {
      const props = feature.properties || {};
      const number = String(props.NOMELINEA || "").trim();
      const line = ROME_TRAM_LINES.find(item => item.code === number);
      if (!line) continue;
      const paths = arcGisFeaturePaths(feature).filter(path => path.length > 1);
      const existing = romeSurfaceGeometryRegistry.get(line.id) || [];
      existing.push(...paths);
      romeSurfaceGeometryRegistry.set(line.id, existing);
    }
    romeTramLoaded = true;
    renderRomeTransport();
    rebuildRomeLineLabels();
    if (layerState.tram) ensureRomeTramStops().catch(() => {});
  })().catch(err => {
    console.warn("Rome tram load failed", err);
    showToast("Rome tram geometry is temporarily unavailable.", 3400);
  }).finally(() => { romeTramPromise = null; });
  return romeTramPromise;
}

function pathBounds(paths) {
  let south = 90, north = -90, west = 180, east = -180;
  for (const path of paths || []) for (const point of path || []) {
    south = Math.min(south, point.lat); north = Math.max(north, point.lat); west = Math.min(west, point.lng); east = Math.max(east, point.lng);
  }
  return Number.isFinite(south) ? { south, north, west, east } : null;
}

function pointSegmentDistanceKm(point, a, b) {
  const lat0 = point.lat * Math.PI / 180;
  const kx = 111.32 * Math.cos(lat0), ky = 110.57;
  const px = point.lng * kx, py = point.lat * ky;
  const ax = a.lng * kx, ay = a.lat * ky, bx = b.lng * kx, by = b.lat * ky;
  const dx = bx - ax, dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPathsKm(point, paths, maxKm = .06) {
  let best = Infinity;
  for (const rawPath of paths || []) {
    const path = v13fThinPath(rawPath, 240);
    for (let i = 1; i < path.length; i++) {
      const d = pointSegmentDistanceKm(point, path[i-1], path[i]);
      if (d < best) best = d;
      if (best <= maxKm * .55) return best;
    }
  }
  return best;
}

async function ensureRomeTramStops(force = false) {
  if (romeTramStopsLoaded && !force) return;
  if (romeTramStopsPromise && !force) return romeTramStopsPromise;
  romeTramStopsPromise = (async () => {
    if (!romeTramLoaded) await ensureRomeTrams();
    const allPaths = ROME_TRAM_LINES.flatMap(line => romeSurfaceGeometryRegistry.get(line.id) || []);
    const bounds = pathBounds(allPaths);
    if (!bounds) return;
    const pad = .015;
    const envelope = `${bounds.west-pad},${bounds.south-pad},${bounds.east+pad},${bounds.north+pad}`;
    const features = await fetchRomePagedStops(envelope);
    for (const feature of features) {
      const point = arcGisFeaturePoint(feature);
      if (!point) continue;
      const props = feature.properties || {};
      const matched = [];
      for (const line of ROME_TRAM_LINES) {
        const paths = romeSurfaceGeometryRegistry.get(line.id) || [];
        const b = pathBounds(paths);
        if (!b || point.lat < b.south-.002 || point.lat > b.north+.002 || point.lng < b.west-.003 || point.lng > b.east+.003) continue;
        if (distanceToPathsKm(point, paths, .055) <= .055) matched.push(romeLineById.get(line.id) || line);
      }
      if (!matched.length) continue;
      const name = romeStationCanonicalName(props.NOMEFERM || props.LOCALITA || props.UBICAZIONE || `Stop ${props.IMPIANTO || ""}`);
      const id = `rome:tram:${props.IMPIANTO || romeSlug(`${name}-${point.lat.toFixed(5)}-${point.lng.toFixed(5)}`)}`;
      const station = romeSurfaceStationRegistry.get(id) || { id, name, lat: point.lat, lon: point.lng, services: [], city: "rome", tramApproximation: true };
      matched.forEach(line => addUniqueRomeService(station, line, "services"));
      romeSurfaceStationRegistry.set(id, station);
    }
    romeTramStopsLoaded = true;
    buildRomeStationOverlays();
    applyLayerState();
    refreshSearchIfOpen();
  })().catch(err => {
    console.warn("Rome tram stops unavailable", err);
  }).finally(() => { romeTramStopsPromise = null; });
  return romeTramStopsPromise;
}

let RomeStationOverlay;
let RomeSurfaceStationOverlay;
let RomeLineLabelOverlay;
function ensureRomeOverlayClasses() {
  if (RomeStationOverlay) return;
  RomeStationOverlay = class extends HtmlOverlay {
    constructor(station) { super({ lat: station.lat, lng: station.lon }, "station-node rome-station-node"); this.station = station; }
    onAdd() {
      super.onAdd();
      const lines = [...(this.station.lines || []), ...(this.station.surfaceServices || [])];
      this.div.style.background = stationNodeBackground(lines.length ? lines : [{ color: "#fff" }]);
      this.div.classList.toggle("interchange", lines.length > 1);
      this.div.title = `${this.station.name} — ${lines.map(formatRomeLineName).join(" · ")}`;
      this.div.innerHTML = `<div class="station-hover-card"><div class="station-hover-title">${escapeHtml(this.station.name)}</div>${lines.map(line => `<div class="station-hover-line"><i class="station-hover-swatch" style="background:${line.color}"></i><span>${escapeHtml(formatRomeLineName(line))}</span></div>`).join("")}</div>`;
      this.div.addEventListener("click", event => { event.stopPropagation(); selectRomeStation(this.station, "metro", { showInfo: true }); });
    }
    draw() { if (!this.div) return; const p = this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(this.position)); if (!p) return; this.div.style.left=`${p.x}px`; this.div.style.top=`${p.y}px`; this.div.style.transform="translate(-50%,-50%)"; this.div.style.display=this.visible?"":"none"; }
  };
  RomeSurfaceStationOverlay = class extends HtmlOverlay {
    constructor(station) { const family = station.services?.some(line => line.family === "tram") && !station.services?.some(line => line.family === "rail") ? "tram" : "rail"; super({ lat: station.lat, lng: station.lon }, `surface-station-node ${family}-station-node rome-surface-station-node`); this.station=station; this.family=family; }
    onAdd() {
      super.onAdd();
      const services = this.station.services || [];
      this.div.style.background = surfaceStationNodeBackground(services);
      this.div.title = `${this.station.name} — ${services.map(formatRomeLineName).join(" · ")}`;
      this.div.innerHTML = `<div class="station-hover-card"><div class="station-hover-title">${escapeHtml(this.station.name)}</div>${services.map(line => `<div class="station-hover-line"><i class="station-hover-swatch" style="background:${line.color}"></i><span>${escapeHtml(formatRomeLineName(line))}</span></div>`).join("")}</div>`;
      this.div.addEventListener("click", event => { event.stopPropagation(); selectRomeStation(this.station, this.family, { showInfo: true }); });
    }
  };
  RomeLineLabelOverlay = class extends LineLabelOverlay {
    onAdd() { super.onAdd(); this.div.classList.add("rome-line-label"); if (this.line.family !== "metro") this.div.classList.add("surface-line-label", this.line.family === "tram" ? "tram-line-label" : "rail-line-label"); }
  };
}

function clearRomeTransportRenderings() {
  romeMetroRenderings.forEach(item => item.polyline.setMap(null));
  romeSurfaceRenderings.forEach(item => item.polyline.setMap(null));
  romeMetroStationOverlays.forEach(item => item.setMap(null));
  romeSurfaceStationOverlays.forEach(item => item.setMap(null));
  romeLineLabelOverlays.forEach(item => item.setMap(null));
  romeMetroRenderings=[]; romeSurfaceRenderings=[]; romeMetroStationOverlays=[]; romeSurfaceStationOverlays=[]; romeLineLabelOverlays=[];
}

function renderRomeTransport() {
  if (!map) return;
  ensureRomeOverlayClasses();
  romeMetroRenderings.forEach(item => item.polyline.setMap(null)); romeMetroRenderings=[];
  romeSurfaceRenderings.forEach(item => item.polyline.setMap(null)); romeSurfaceRenderings=[];
  for (const line of ROME_METRO_LINES) {
    const registered = romeLineById.get(line.id) || line;
    for (const raw of romeMetroGeometryRegistry.get(line.id) || []) {
      const path = v13fThinPath(raw, 400);
      const main = new google.maps.Polyline({ map, path, geodesic:false, strokeColor:registered.color, strokeOpacity:0, strokeWeight:5.4, zIndex:20, clickable:false, visible:false });
      const hit = new google.maps.Polyline({ map, path, strokeColor:registered.color, strokeOpacity:.001, strokeWeight:20, zIndex:65, clickable:true, visible:false });
      hit.addListener("click", () => selectRomeLine(registered, { showInfo:true }));
      romeMetroRenderings.push({ polyline:main, line:registered, role:"main" }, { polyline:hit, line:registered, role:"hit" });
    }
  }
  for (const line of [...romeLineById.values()].filter(line => line.family === "rail" || line.family === "tram")) {
    for (const raw of romeSurfaceGeometryRegistry.get(line.id) || []) {
      const path = v13fThinPath(raw, line.kind === "regional" ? 190 : 320);
      if (line.family === "tram") {
        const band = new google.maps.Polyline({ map, path, strokeColor:line.color, strokeOpacity:0, strokeWeight:9, zIndex:24, clickable:false, visible:false });
        const main = new google.maps.Polyline({ map, path, strokeColor:line.color, strokeOpacity:0, strokeWeight:2.8, zIndex:25, clickable:false, visible:false });
        romeSurfaceRenderings.push({polyline:band,line,role:"tram-band"},{polyline:main,line,role:"main"});
      } else {
        const outer = new google.maps.Polyline({ map, path, strokeColor:line.color, strokeOpacity:0, strokeWeight:line.kind === "regional" ? 5 : 7, zIndex:24, clickable:false, visible:false });
        const inner = new google.maps.Polyline({ map, path, strokeColor:"#0B1017", strokeOpacity:0, strokeWeight:line.kind === "regional" ? 2 : 2.8, zIndex:25, clickable:false, visible:false });
        romeSurfaceRenderings.push({polyline:outer,line,role:"outer"},{polyline:inner,line,role:"inner"});
      }
      const hit = new google.maps.Polyline({ map, path, strokeColor:line.color, strokeOpacity:.001, strokeWeight:20, zIndex:66, clickable:true, visible:false });
      hit.addListener("click", () => selectRomeLine(line,{showInfo:true}));
      romeSurfaceRenderings.push({polyline:hit,line,role:"hit"});
    }
  }
  buildRomeStationOverlays();
  applyLayerState();
}

function buildRomeStationOverlays() {
  if (!map) return;
  ensureRomeOverlayClasses();
  romeMetroStationOverlays.forEach(item => item.setMap(null)); romeMetroStationOverlays=[];
  romeSurfaceStationOverlays.forEach(item => item.setMap(null)); romeSurfaceStationOverlays=[];
  for (const station of romeMetroStationRegistry.values()) {
    if (!station.lines?.length) continue;
    const overlay = new RomeStationOverlay(station); overlay.setMap(map); overlay.setVisible(false); romeMetroStationOverlays.push(overlay);
  }
  for (const station of romeSurfaceStationRegistry.values()) {
    if (!station.services?.length) continue;
    const overlay = new RomeSurfaceStationOverlay(station); overlay.setMap(map); overlay.setVisible(false); romeSurfaceStationOverlays.push(overlay);
  }
}

function rebuildRomeLineLabels() {
  romeLineLabelOverlays.forEach(item => item.setMap(null)); romeLineLabelOverlays=[];
  if (!map) return;
  ensureRomeOverlayClasses();
  const zoom = map.getZoom() || 12;
  const spacing = zoom >= 14 ? 1.0 : zoom >= 12 ? 1.7 : 2.8;
  for (const line of romeLineById.values()) {
    const paths = line.family === "metro" ? romeMetroGeometryRegistry.get(line.id) || [] : romeSurfaceGeometryRegistry.get(line.id) || [];
    let count=0;
    for (const path of paths) {
      for (const sample of samplePathForLabels(path, spacing)) {
        const overlay = new RomeLineLabelOverlay(sample.position, sample.nextPosition, line);
        overlay.setMap(map); overlay.setVisible(false); romeLineLabelOverlays.push(overlay);
        count++; if (count >= (line.family === "metro" ? 22 : 12)) break;
      }
      if (count >= (line.family === "metro" ? 22 : 12)) break;
    }
  }
}

function romeRouteServiceIds(route) {
  return new Set((route?.segments || []).filter(segment => ["metro","rail","tram"].includes(segment.mode)).map(segment => segment.service).filter(id => romeLineById.has(id)));
}

function romeSelectionMatches(selection, line) {
  return selection?.city === "rome" && selection.type === "line" && selection.id === line.id;
}

function applyRomeLayerState() {
  const inRome = currentCityId === "rome";
  const route = getActiveFavoriteRoute();
  const romeRoute = route && getRouteCityId(route) === "rome" ? route : null;
  const routeServices = romeRouteServiceIds(romeRoute);
  const selection = getTransportSelection();
  const romeSelection = selection?.city === "rome" ? selection : null;
  const hasSelection = !!romeSelection;
  const hasRoute = !!romeRoute;
  const metroFocus = inRome && layerState.metro && !layerState.rail && !layerState.tram && !layerState.places && !cityInfoState.districts && !cityInfoState.weather && !cityInfoState.wind && !hasSelection && !hasRoute;
  const secondaryMetro = inRome && layerState.metro && !metroFocus && !hasSelection && !hasRoute;

  for (const item of romeMetroRenderings) {
    let visible = false, strong = false;
    if (inRome) {
      if (hasSelection) { visible = romeSelection.type === "line" ? romeSelection.id === item.line.id : romeSelection.family === "metro" && romeSelection.station?.lines?.some(line => line.id === item.line.id); strong=visible; }
      else if (hasRoute) { visible = routeServices.has(item.line.id); strong=visible; }
      else { visible=layerState.metro; strong=metroFocus; }
    }
    item.polyline.setVisible(visible);
    if (!visible) continue;
    if (item.role === "hit") item.polyline.setOptions({strokeOpacity:.001,strokeWeight:20,zIndex:72});
    else item.polyline.setOptions({strokeOpacity:strong?.98:secondaryMetro?.30:.84,strokeWeight:strong?6.6:secondaryMetro?3.1:5.2,zIndex:strong?46:secondaryMetro?16:24});
  }

  for (const item of romeSurfaceRenderings) {
    let visible=false,strong=false;
    if (inRome) {
      if (hasSelection) { visible=romeSelection.type === "line" ? romeSelection.id === item.line.id : romeSelection.family === item.line.family && romeSelection.station?.services?.some(line => line.id === item.line.id); strong=visible; }
      else if (hasRoute) { visible=routeServices.has(item.line.id); strong=visible; }
      else { visible=item.line.family === "rail" ? layerState.rail : layerState.tram; strong=visible; }
    }
    item.polyline.setVisible(visible);
    if (!visible) continue;
    if (item.role === "hit") item.polyline.setOptions({strokeOpacity:.001,strokeWeight:20});
    else if (item.role === "tram-band") item.polyline.setOptions({strokeOpacity:strong?.28:.16,strokeWeight:strong?10:8});
    else if (item.role === "outer") item.polyline.setOptions({strokeOpacity:strong?.92:.56,strokeWeight:item.line.kind === "regional" ? 5 : 7});
    else if (item.role === "inner") item.polyline.setOptions({strokeOpacity:strong?.82:.48});
    else item.polyline.setOptions({strokeOpacity:strong?.95:.65,strokeWeight:strong?3.2:2.6});
  }

  for (const overlay of romeMetroStationOverlays) {
    let visible=false;
    if (inRome) {
      if (hasSelection) visible=romeSelection.type === "station" ? romeSelection.id === overlay.station.id : romeSelection.type === "line" && overlay.station.lines?.some(line => line.id === romeSelection.id);
      else if (hasRoute) visible=overlay.station.lines?.some(line => routeServices.has(line.id));
      else visible=layerState.metro;
    }
    overlay.setVisible(visible);
    if (overlay.div) overlay.div.style.opacity = secondaryMetro ? ".58" : "";
  }

  for (const overlay of romeSurfaceStationOverlays) {
    let visible=false;
    if (inRome) {
      if (hasSelection) visible=romeSelection.type === "station" ? romeSelection.id === overlay.station.id : romeSelection.type === "line" && overlay.station.services?.some(line => line.id === romeSelection.id);
      else if (hasRoute) visible=overlay.station.services?.some(line => routeServices.has(line.id));
      else {
        visible=overlay.station.services?.some(line => line.family === "rail" ? layerState.rail : layerState.tram);
        if (overlay.station.metroStationId && layerState.metro && romeMetroStationRegistry.has(overlay.station.metroStationId)) visible=false;
      }
    }
    overlay.setVisible(visible);
  }

  for (const overlay of romeLineLabelOverlays) {
    const line=overlay.line;
    let visible=false;
    if (inRome) {
      if (hasSelection) visible=romeSelection.type === "line" && romeSelection.id === line.id;
      else if (hasRoute) visible=routeServices.has(line.id);
      else visible=line.family === "metro" ? layerState.metro : line.family === "rail" ? layerState.rail : layerState.tram;
    }
    overlay.setVisible(visible);
    if (overlay.div) overlay.div.style.opacity = line.family === "metro" && secondaryMetro ? ".62" : "";
  }
}

function focusRomeLine(line) {
  const paths = line.family === "metro" ? romeMetroGeometryRegistry.get(line.id) || [] : romeSurfaceGeometryRegistry.get(line.id) || [];
  const bounds = new google.maps.LatLngBounds(); paths.flat().forEach(point => bounds.extend(point)); if (!bounds.isEmpty()) map.fitBounds(bounds, 44);
}

function selectRomeLine(line, options = {}) {
  activeFavoriteRouteId=null; persistentTransportFocus=null; updateRouteFocusChip(); updateItemFocusChip();
  transientTransportSelection={type:"line",family:line.family,id:line.id,label:formatRomeLineName(line),city:"rome",line};
  applyLayerState(); if (options.fit) focusRomeLine(line); if (options.showInfo !== false) showRomeLineInfo(line);
}

function selectRomeStation(station, family, options = {}) {
  activeFavoriteRouteId=null; persistentTransportFocus=null; updateRouteFocusChip(); updateItemFocusChip();
  transientTransportSelection={type:"station",family,id:station.id,label:station.name,station,city:"rome"};
  applyLayerState(); if (options.showInfo !== false) showRomeStationInfo(station,family);
}

function romeLineProfile(line) {
  if (line.about || line.background) return { about:line.about || `${formatRomeLineName(line)} is part of Rome's public-transport network.`, background:line.background || "This corridor forms part of Rome's layered metro, rail and tram system." };
  if (line.kind === "regional") return { about:`${line.code} is a regional railway corridor crossing the Rome area and linking city stations with destinations beyond the centre.`, background:"Rome's FL regional lines use the national railway infrastructure and provide an important layer between urban transit and longer-distance rail." };
  return { about:`${formatRomeLineName(line)} is part of Rome's public-transport network.`, background:"Rome combines metro, urban railway, regional railway and tram routes built across different eras." };
}

const ROME_STATION_PROFILES = {
  "TERMINI": { descriptor:"Central rail terminal & Metro A/B interchange", about:"Roma Termini is the city's principal mainline railway station and one of its most important public-transport interchanges, connecting national rail with Metro A and B.", background:"The station's origins date to the nineteenth century; today's complex was largely rebuilt in the twentieth century and remains Rome's primary rail gateway." },
  "COLOSSEO FORI IMPERIALI": { descriptor:"Metro B/C interchange by the Colosseum", about:"Colosseo / Fori Imperiali connects Metro B and C beside one of Rome's most important archaeological areas.", background:"The newer Line C station brought the automated metro into the historic centre and created a direct interchange with Line B." },
  "SAN GIOVANNI": { descriptor:"Metro A/C interchange", about:"San Giovanni links Metro A with the automated Metro C east of the historic centre.", background:"Its Line C interchange was one of the network's major expansion milestones, connecting the newer line with Rome's older Line A." },
  "PIRAMIDE": { descriptor:"Metro + Metromare transfer point", about:"Piramide is a major south-central transfer point, connecting Metro B with the Porta San Paolo terminus of Metromare and nearby Roma Ostiense railway station.", background:"The area developed into an important rail interchange around the historic Porta San Paolo and Pyramid of Cestius." },
  "FLAMINIO": { descriptor:"Metro + northern urban rail gateway", about:"Flaminio combines Metro A with the city terminus of the Roma–Viterbo railway near Piazza del Popolo.", background:"The interchange has long served as a northern gateway between central Rome and suburban rail services." },
  "TIBURTINA": { descriptor:"Metro + major railway hub", about:"Roma Tiburtina combines Metro B with one of Rome's largest national and regional railway stations.", background:"The modern station was substantially rebuilt in the early twenty-first century and is a major high-speed and regional rail hub." }
};

function romeStationProfile(station) {
  const key=romeNormalize(station.name);
  const curated=Object.entries(ROME_STATION_PROFILES).find(([k]) => key.includes(k) || k.includes(key))?.[1];
  if (curated) return curated;
  const services=[...(station.lines||[]),...(station.surfaceServices||station.services||[])];
  return { descriptor:services.some(line=>line.family==="rail")?"Rome rail / transit station":services.some(line=>line.family==="tram")?"Rome tram stop":"Rome metro station", about:`${station.name} is served by ${services.map(formatRomeLineName).join(", ") || "Rome's public-transport network"}.`, background:"This stop forms part of Rome's layered transport system, which combines metro, urban and regional railways, and street-running trams." };
}

function showRomeLineInfo(line) {
  const profile=romeLineProfile(line);
  const registry=line.family==="metro"?romeMetroStationRegistry:romeSurfaceStationRegistry;
  const count=[...registry.values()].filter(station => line.family==="metro" ? station.lines?.some(item=>item.id===line.id) : station.services?.some(item=>item.id===line.id)).length;
  const content=el("detail-content");
  content.innerHTML=`<div class="detail-label">${romeLineFamilyLabel(line)}</div><h2>${escapeHtml(formatRomeLineName(line))}</h2><div class="sub">Rome · ${line.family === "metro" ? "rapid transit" : line.family === "tram" ? "street tram" : "rail"}</div><div class="detail-section"><div class="info-row"><span>Mapped stops/stations</span><b>${count || "—"}</b></div><div class="info-row"><span>Map colour</span><b><i class="station-hover-swatch" style="background:${line.color}"></i> ${escapeHtml(line.code)}</b></div></div><div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div><div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div><div class="detail-section sub">Operational changes and replacement buses can occur during works; this layer is designed as a network/infrastructure view.</div><div class="detail-actions compact-action-row"><button class="secondary-btn compact-btn" id="rome-focus-line-btn">Focus line</button><button class="primary-btn compact-btn" id="rome-route-line-btn">Add line to Route</button></div>`;
  openDetail(); bringPanelToFront(el("detail-card"));
  content.querySelector("#rome-focus-line-btn")?.addEventListener("click",()=>{setPersistentTransportFocus({type:"line",family:line.family,id:line.id,label:formatRomeLineName(line),city:"rome",line});applyLayerState();});
  content.querySelector("#rome-route-line-btn")?.addEventListener("click",()=>startRouteWithSegment({mode:line.family,service:line.id,kind:"line"}));
}

function showRomeStationInfo(station, family) {
  const profile=romeStationProfile(station);
  const lines=[...(station.lines||[]),...(station.surfaceServices||station.services||[])];
  const content=el("detail-content");
  content.innerHTML=`<div class="detail-label">${lines.length>1?"TRANSFER STATION":family==="tram"?"TRAM STOP":family==="rail"?"RAIL STATION":"METRO STATION"}</div><h2>${escapeHtml(station.name)}</h2><div class="sub">${escapeHtml(profile.descriptor)}</div><div class="chips">${lines.map(line=>`<button class="line-chip line-chip-button" data-rome-line="${escapeHtml(line.id)}" style="background:${line.color};color:${idealTextColor(line.color)}">${escapeHtml(formatRomeLineName(line))}</button>`).join("")}</div><div class="detail-section info-copy-section"><div class="info-section-title">ABOUT</div><p>${escapeHtml(profile.about)}</p></div><div class="detail-section info-copy-section"><div class="info-section-title">BACKGROUND</div><p>${escapeHtml(profile.background)}</p></div><div class="detail-section"><div class="info-row"><span>Coordinates</span><b>${Number(station.lat).toFixed(5)}, ${Number(station.lon).toFixed(5)}</b></div></div><div class="detail-actions compact-action-row"><button class="secondary-btn compact-btn" id="rome-focus-station-btn">Focus station</button><button class="primary-btn compact-btn" id="rome-route-station-btn">${!el("route-editor-sheet")?.classList.contains("hidden")?"Use as route endpoint":"Start route here"}</button></div>`;
  openDetail(); bringPanelToFront(el("detail-card"));
  content.querySelectorAll("[data-rome-line]").forEach(button=>button.addEventListener("click",()=>{const line=romeLineById.get(button.dataset.romeLine);if(line)selectRomeLine(line,{showInfo:true});}));
  content.querySelector("#rome-focus-station-btn")?.addEventListener("click",()=>{setPersistentTransportFocus({type:"station",family,id:station.id,label:station.name,station,city:"rome"});applyLayerState();});
  content.querySelector("#rome-route-station-btn")?.addEventListener("click",()=>{
    if (!el("route-editor-sheet")?.classList.contains("hidden") && useStationInOpenRoute(station,family)) return;
    const service=family==="metro"?station.lines?.[0]?.id:station.services?.find(line=>line.family===family)?.id;
    startRouteWithSegment({mode:family,service:service||"",kind:"line",startStationId:station.id,startStationName:station.name});
  });
}

function clearRomeCache() {
  Object.keys(localStorage).filter(key=>key.startsWith(ROME_CACHE_PREFIX)).forEach(key=>localStorage.removeItem(key));
}

async function refreshRomeData() {
  clearRomeCache(); romeCoreLoaded=false; romeTramLoaded=false; romeTramStopsLoaded=false;
  clearRomeTransportRenderings();
  await ensureRomeCore(true);
  if (layerState.tram) await ensureRomeTrams(true);
  if (layerState.tram) ensureRomeTramStops(true).catch(()=>{});
  if (cityInfoState.districts || cityInfoState.weather) await ensureRomeMunicipi(true);
  if (cityInfoState.weather) await ensureRomeWeather(true);
  if (cityInfoState.wind) await ensureRomeWind(true);
  applyLayerState();
}

/* Rome Municipi + weather + wind */
function romeMunicipioName(props={}) {
  const raw=props.MUNICIPIO || props.C_ROMAN || props.OLD_CROMAN || props.OBJECTID;
  const text=String(raw || "").trim();
  return /^MUNICIPIO/i.test(text)?text:`Municipio ${text}`;
}
function romeMunicipioShade(index){const hue=Math.round((index*137.508+18)%360);return `hsl(${hue} 36% 40%)`;}
function ensureRomeMunicipioLabelClass(){if(window.__RomeMunicipioLabel)return;window.__RomeMunicipioLabel=class extends HtmlOverlay{constructor(item){super(item.position,"borough-label-overlay rome-municipio-label");this.item=item;}onAdd(){super.onAdd();this.updateContent();}updateContent(){if(!this.div)return;const weather=romeMunicipiWeather.get(this.item.name);const show=cityInfoState.weather&&weather;this.div.innerHTML=`<div class="borough-label-name">${escapeHtml(this.item.name)}</div>${show?`<div class="borough-label-weather"><span>${weather.emoji}</span><b>${Math.round(weather.temperature)}°C</b><small>${escapeHtml(weather.label)}</small></div>`:""}`;this.div.classList.toggle("weather-on",!!show);}};}

async function ensureRomeMunicipi(force=false){
  if(romeMunicipiReady&&!force)return;
  if(!map)return;
  if(force&&romeMunicipiLayer){romeMunicipiLayer.setMap(null);romeMunicipiLayer=null;romeMunicipiReady=false;}
  const cacheKey=`${ROME_CACHE_PREFIX}municipi`;let geo=!force?getCache(cacheKey):null;if(!geo){geo=await fetchRomeArcGisGeoJson(ROME_ARCGIS.municipi);setCache(cacheKey,geo);}
  romeMunicipiLayer=new google.maps.Data();const features=romeMunicipiLayer.addGeoJson(geo||{});const items=[];
  features.forEach((feature,index)=>{const props={};feature.forEachProperty((value,key)=>props[key]=value);const name=romeMunicipioName(props);const position=featureAverageLatLng(feature);if(position)items.push({feature,name,position});feature.setProperty("__romeColor",romeMunicipioShade(index));});
  romeMunicipiCentroids=items.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));romeMunicipiReady=true;rebuildRomeMunicipioLabels();applyRomeCityInfoState();
}
function rebuildRomeMunicipioLabels(){romeMunicipiLabels.forEach(item=>item.setMap(null));romeMunicipiLabels=[];if(!romeMunicipiReady||!map)return;ensureRomeMunicipioLabelClass();for(const item of romeMunicipiCentroids){const overlay=new window.__RomeMunicipioLabel(item);overlay.setMap(map);overlay.setVisible(false);romeMunicipiLabels.push(overlay);}refreshRomeMunicipioLabels();}
function refreshRomeMunicipioLabels(){const zoom=map?.getZoom?.()||12;const visible=currentCityId==="rome"&&(cityInfoState.districts||cityInfoState.weather)&&zoom>=10;romeMunicipiLabels.forEach(overlay=>{overlay.setVisible(visible);overlay.updateContent?.();if(overlay.div){overlay.div.classList.toggle("borough-label-compact",zoom<=11);overlay.div.style.opacity=zoom<=10?".72":zoom<=11?".84":".96";}});}
async function ensureRomeWeather(force=false){if(!romeMunicipiReady)await ensureRomeMunicipi();if(!force&&romeMunicipiWeather.size)return;if(romeWeatherPromise&&!force)return romeWeatherPromise;romeWeatherPromise=(async()=>{const coords=romeMunicipiCentroids;if(!coords.length)return;const lats=coords.map(i=>i.position.lat.toFixed(5)).join(","),lngs=coords.map(i=>i.position.lng.toFixed(5)).join(",");const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=celsius&wind_speed_unit=kmh&timezone=Europe%2FRome`;const res=await fetch(url);if(!res.ok)throw new Error(`Weather request returned ${res.status}`);let data=await res.json();if(!Array.isArray(data))data=[data];romeMunicipiWeather=new Map();coords.forEach((item,index)=>{const current=data[index]?.current||{};romeMunicipiWeather.set(item.name,{temperature:Number(current.temperature_2m),windSpeed:Number(current.wind_speed_10m),windDirection:Number(current.wind_direction_10m),...weatherCodeInfo(current.weather_code)});});refreshRomeMunicipioLabels();})().catch(err=>{console.warn("Rome weather unavailable",err);showToast("Rome weather is temporarily unavailable.",3000);}).finally(()=>romeWeatherPromise=null);return romeWeatherPromise;}
function romeWindGrid(){const points=[];const rows=5,cols=7,south=41.73,north=42.08,west=12.25,east=12.73;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)points.push({lat:south+(north-south)*(r+.5)/rows,lng:west+(east-west)*(c+.5)/cols});return points;}
function clearRomeWind(){romeWindOverlays.forEach(item=>item.setMap(null));romeWindOverlays=[];}
async function ensureRomeWind(force=false){if(romeWindPromise&&!force)return romeWindPromise;if(force)clearRomeWind();romeWindPromise=(async()=>{const points=romeWindGrid(),lats=points.map(p=>p.lat.toFixed(4)).join(","),lngs=points.map(p=>p.lng.toFixed(4)).join(",");const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=Europe%2FRome`;const res=await fetch(url);if(!res.ok)throw new Error(`Wind request returned ${res.status}`);let data=await res.json();if(!Array.isArray(data))data=[data];ensureWindArrowOverlayClass();points.forEach((position,index)=>{const current=data[index]?.current||{};const overlay=new window.__V13FWindArrowOverlay(position,Number(current.wind_speed_10m)||0,Number(current.wind_direction_10m)||0);overlay.setMap(map);overlay.setVisible(currentCityId==="rome"&&cityInfoState.wind);romeWindOverlays.push(overlay);});})().catch(err=>{console.warn("Rome wind unavailable",err);showToast("Rome wind is temporarily unavailable.",3000);}).finally(()=>romeWindPromise=null);return romeWindPromise;}
function applyRomeCityInfoState(){const inRome=currentCityId==="rome";if(romeMunicipiLayer){romeMunicipiLayer.setMap(inRome&&cityInfoState.districts?map:null);romeMunicipiLayer.setStyle(feature=>({fillColor:feature.getProperty("__romeColor")||"#765c55",fillOpacity:cityInfoState.districts?.23:0,strokeColor:"#e5d8cc",strokeOpacity:cityInfoState.districts?.48:0,strokeWeight:cityInfoState.districts?1.05:0,clickable:false,zIndex:2}));}refreshRomeMunicipioLabels();romeWindOverlays.forEach(item=>item.setVisible(inRome&&cityInfoState.wind));}

/* --- v1.4B overrides: city availability, layers, search, route builder --- */
CITY_CONFIG.rome.status="Rome ready · Metro A/B/B1/C + rail + tram + Municipi/weather/wind.";

const restoreCityLayerMemoryV14AForB=restoreCityLayerMemory;
restoreCityLayerMemory=function(cityId){if(cityId!=="rome")return restoreCityLayerMemoryV14AForB(cityId);const saved=cityLayerMemory[cityId]||{};layerState.metro=!!saved.metro;layerState.rail=!!saved.rail;layerState.tram=!!saved.tram;layerState.places=!!saved.places;cityInfoState.districts=!!saved.districts;cityInfoState.weather=!!saved.weather;cityInfoState.wind=!!saved.wind;};

cityTransportAvailable=function(){return currentCityId==="london"||currentCityId==="rome";};

const toggleLayerV14AForB=toggleLayer;
toggleLayer=function(name){
  if(currentCityId!=="rome")return toggleLayerV14AForB(name);
  if(!["metro","rail","tram","places"].includes(name))return;
  activeFavoriteRouteId=null;transientTransportSelection=null;persistentTransportFocus=null;updateRouteFocusChip();updateItemFocusChip();layerState[name]=!layerState[name];saveCurrentCityLayerMemory();
  if(name==="metro"&&layerState.metro)ensureRomeCore().then(()=>applyLayerState());
  if(name==="rail"&&layerState.rail)ensureRomeCore().then(()=>applyLayerState());
  if(name==="tram"&&layerState.tram)ensureRomeTrams().then(()=>{applyLayerState();ensureRomeTramStops().catch(()=>{});});
  applyLayerState();syncV13EPanelUI();
};

const toggleCityInfoLayerV14AForB=toggleCityInfoLayer;
toggleCityInfoLayer=async function(name){
  if(currentCityId!=="rome")return toggleCityInfoLayerV14AForB(name);
  cityInfoState[name]=!cityInfoState[name];saveCurrentCityLayerMemory();syncV13FCityButtons();
  try{if((name==="districts"||name==="weather")&&(cityInfoState.districts||cityInfoState.weather))await ensureRomeMunicipi();if(name==="weather"&&cityInfoState.weather)await ensureRomeWeather();if(name==="wind"&&cityInfoState.wind)await ensureRomeWind();}catch(err){console.warn(err);cityInfoState[name]=false;syncV13FCityButtons();showToast(`${name} layer could not load.`,3000);}applyLayerState();applyBaseMapStyle();
};

const applyLayerStateV14AForB=applyLayerState;
applyLayerState=function(){applyLayerStateV14AForB();if(currentCityId==="rome"){
  if(boroughDataLayer)boroughDataLayer.setMap(null);boroughLabelOverlays.forEach(item=>item.setVisible(false));windOverlays.forEach(item=>item.setVisible(false));
}
applyRomeLayerState();applyRomeCityInfoState();refreshPreciseRouteHighlights();};

const scheduleLineLabelRefreshV14AForB=scheduleLineLabelRefresh;
scheduleLineLabelRefresh=function(){scheduleLineLabelRefreshV14AForB();clearTimeout(romeLabelRefreshTimer);if(currentCityId==="rome"&&(layerState.metro||layerState.rail||layerState.tram))romeLabelRefreshTimer=setTimeout(()=>{rebuildRomeLineLabels();applyLayerState();},300);};

const switchCityV14AForB=switchCity;
switchCity=async function(nextCityId,options={}){await switchCityV14AForB(nextCityId,options);if(currentCityId==="rome"){await ensureRomeCore().catch(()=>{});if(layerState.tram)await ensureRomeTrams().catch(()=>{});if(cityInfoState.districts||cityInfoState.weather)await ensureRomeMunicipi().catch(()=>{});if(cityInfoState.weather)await ensureRomeWeather().catch(()=>{});if(cityInfoState.wind)await ensureRomeWind().catch(()=>{});}applyLayerState();updateV14CityUI();updateDataAttributionV14B();};

const updateV14CityUIV14AForB=updateV14CityUI;
updateV14CityUI=function(){updateV14CityUIV14AForB();updateDataAttributionV14B();};
function updateDataAttributionV14B(){const node=el("data-attribution");if(!node)return;node.textContent=currentCityId==="rome"?"Rome transport + Municipi © Roma Servizi per la Mobilità / ATAC · Weather © Open-Meteo":"Transport data © TfL · Tube track geometry © OpenStreetMap contributors · Weather © Open-Meteo";}

/* Search */
const buildV13ESearchResultsV14AForB=buildV13ESearchResults;
buildV13ESearchResults=function(query){const base=buildV13ESearchResultsV14AForB(query);if(currentCityId!=="rome")return base;const q=normalizeSearch(query);const out=[...base];for(const line of romeLineById.values()){if(normalizeSearch(`${line.code} ${line.name} ${line.displayName}`).includes(q))out.push({type:"rome-line",line});}for(const station of romeMetroStationRegistry.values()){if(normalizeSearch(`${station.name} ${(station.lines||[]).map(formatRomeLineName).join(" ")}`).includes(q))out.push({type:"rome-station",station,family:"metro"});}for(const station of romeSurfaceStationRegistry.values()){if(normalizeSearch(`${station.name} ${(station.services||[]).map(formatRomeLineName).join(" ")}`).includes(q))out.push({type:"rome-station",station,family:station.services?.some(line=>line.family==="rail")?"rail":"tram"});}return out.slice(0,18);};
const searchResultHtmlV14AForB=searchResultHtml;
searchResultHtml=function(result,index){if(result.type==="rome-line")return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon" style="background:${result.line.color};color:${idealTextColor(result.line.color)}">${escapeHtml(result.line.code)}</div><div><div class="result-title">${escapeHtml(formatRomeLineName(result.line))}</div><div class="result-sub">Rome ${escapeHtml(result.line.family)}</div></div></button>`;if(result.type==="rome-station"){const services=[...(result.station.lines||[]),...(result.station.surfaceServices||result.station.services||[])];return `<button class="search-result" data-result-index="${index}" role="option"><div class="result-icon">${result.family==="metro"?"M":result.family==="tram"?"T":"R"}</div><div><div class="result-title">${escapeHtml(result.station.name)}</div><div class="result-sub">${escapeHtml(services.map(formatRomeLineName).join(" · ")||"Rome transport")}</div></div></button>`;}return searchResultHtmlV14AForB(result,index);};
const selectSearchResultV14AForB=selectSearchResult;
selectSearchResult=function(result){if(result?.type==="rome-line"){hideSearchResults();toggleLayersPanel(false);selectRomeLine(result.line,{fit:true,showInfo:true});return;}if(result?.type==="rome-station"){hideSearchResults();toggleLayersPanel(false);map.panTo({lat:result.station.lat,lng:result.station.lon});map.setZoom(16);selectRomeStation(result.station,result.family,{showInfo:true});return;}return selectSearchResultV14AForB(result);};
const resultTitleV14AForB=resultTitle;
resultTitle=function(result){if(result?.type==="rome-line")return formatRomeLineName(result.line);if(result?.type==="rome-station")return result.station.name;return resultTitleV14AForB(result);};

/* Route builder */
const routeStationsForServiceV14AForB=routeStationsForService;
routeStationsForService=function(mode,service){if(String(service).startsWith("rome-")){return mode==="metro"?[...romeMetroStationRegistry.values()].filter(s=>s.lines?.some(l=>l.id===service)).sort((a,b)=>a.name.localeCompare(b.name)):[...romeSurfaceStationRegistry.values()].filter(s=>s.services?.some(l=>l.id===service)).sort((a,b)=>a.name.localeCompare(b.name));}return routeStationsForServiceV14AForB(mode,service);};
const getStationForSegmentV14AForB=getStationForSegment;
getStationForSegment=function(mode,id){if(String(id).startsWith("rome:"))return mode==="metro"?romeMetroStationRegistry.get(id):romeSurfaceStationRegistry.get(id);return getStationForSegmentV14AForB(mode,id);};
const defaultServiceForStationV14AForB=defaultServiceForStation;
defaultServiceForStation=function(mode,stationId){if(String(stationId).startsWith("rome:")){if(mode==="metro")return romeMetroStationRegistry.get(stationId)?.lines?.[0]?.id||"rome-metro-a";const station=romeSurfaceStationRegistry.get(stationId);return station?.services?.find(l=>l.family===mode)?.id||station?.services?.[0]?.id||"";}return defaultServiceForStationV14AForB(mode,stationId);};
const v13fServiceOptionsV14AForB=v13fServiceOptions;
v13fServiceOptions=function(segment){if(currentCityId!=="rome"&&!String(segment.service).startsWith("rome-"))return v13fServiceOptionsV14AForB(segment);const lines=[...romeLineById.values()].filter(line=>line.family===segment.mode).sort((a,b)=>formatRomeLineName(a).localeCompare(formatRomeLineName(b),undefined,{numeric:true}));return lines.map(line=>`<option value="${escapeHtml(line.id)}" ${line.id===segment.service?"selected":""}>${escapeHtml(formatRomeLineName(line))}</option>`).join("");};
const transportGeometryForSegmentV14AForB=transportGeometryForSegment;
transportGeometryForSegment=function(segment){if(String(segment.service).startsWith("rome-"))return segment.mode==="metro"?romeMetroGeometryRegistry.get(segment.service)||[]:romeSurfaceGeometryRegistry.get(segment.service)||[];return transportGeometryForSegmentV14AForB(segment);};
const segmentColorV14AForB=segmentColor;
segmentColor=function(segment){if(String(segment.service).startsWith("rome-"))return romeLineById.get(segment.service)?.color||"#79B6FF";return segmentColorV14AForB(segment);};
const segmentDisplayNameV14AForB=segmentDisplayName;
segmentDisplayName=function(raw){const segment=normalizeRouteSegment(raw);if(String(segment.service).startsWith("rome-")){const line=romeLineById.get(segment.service);const base=line?formatRomeLineName(line):segment.service;return segment.startStationId&&segment.endStationId?`${base} · ${segment.startStationName||getStationForSegment(segment.mode,segment.startStationId)?.name||"Start"} → ${segment.endStationName||getStationForSegment(segment.mode,segment.endStationId)?.name||"End"}`:base;}return segmentDisplayNameV14AForB(raw);};

function romeDefaultService(mode){if(mode==="metro")return "rome-metro-a";return [...romeLineById.values()].find(line=>line.family===mode)?.id||"";}
const openRouteEditorV14AForB=openRouteEditor;
openRouteEditor=function(){if(currentCityId!=="rome")return openRouteEditorV14AForB();routeEditorSegments=[normalizeRouteSegment({mode:"metro",service:"rome-metro-a"})];el("route-name-input").value="";renderRouteEditorSegments();el("route-editor-sheet").classList.remove("hidden");document.body.classList.add("detail-open");restorePanelPosition(el("route-editor-sheet"));bringPanelToFront(el("route-editor-sheet"));};
const addRouteEditorSegmentV14AForB=addRouteEditorSegment;
addRouteEditorSegment=function(){if(currentCityId!=="rome")return addRouteEditorSegmentV14AForB();routeEditorSegments.push(normalizeRouteSegment({mode:"metro",service:"rome-metro-a"}));renderRouteEditorSegments();};

/* Patch the mode-change defaults in route editor without changing the visible UI. */
const renderRouteEditorSegmentsV14AForB=renderRouteEditorSegments;
renderRouteEditorSegments=function(){renderRouteEditorSegmentsV14AForB();if(currentCityId!=="rome")return;const node=el("route-segments");if(!node)return;node.querySelectorAll("[data-segment-mode]").forEach(select=>{const clone=select.cloneNode(true);select.replaceWith(clone);clone.addEventListener("change",async()=>{const index=Number(clone.dataset.segmentMode),mode=clone.value;if(mode==="rail")await ensureRomeCore();if(mode==="tram")await ensureRomeTrams();routeEditorSegments[index]=normalizeRouteSegment({mode,service:["metro","rail","tram"].includes(mode)?romeDefaultService(mode):""});renderRouteEditorSegments();});});};

const activateFavoriteRouteV14AForB=activateFavoriteRoute;
activateFavoriteRoute=function(routeId,options={}){const route=favoriteRoutes.find(item=>item.id===routeId);if(!route||getRouteCityId(route)!=="rome")return activateFavoriteRouteV14AForB(routeId,options);activeFavoriteRouteId=route.id;transientTransportSelection=null;persistentTransportFocus=null;route.useCount=Number(route.useCount||0)+1;route.lastUsedAt=Date.now();saveFavoriteRoutes();layerState.metro=route.segments?.some(s=>s.mode==="metro")||false;layerState.rail=route.segments?.some(s=>s.mode==="rail")||false;layerState.tram=route.segments?.some(s=>s.mode==="tram")||false;layerState.places=false;applyLayerState();updateRouteFocusChip();updateItemFocusChip();focusFavoriteRoute(route);if(options.showInfo!==false)showFavoriteRouteInfo(route);refreshPreciseRouteHighlights();};
const focusFavoriteRouteV14AForB=focusFavoriteRoute;
focusFavoriteRoute=function(route){if(getRouteCityId(route)!=="rome")return focusFavoriteRouteV14AForB(route);const bounds=new google.maps.LatLngBounds();for(const segment of route.segments||[]){const path=precisePathForSegment(segment);if(path.length)path.forEach(point=>bounds.extend(point));else{const paths=transportGeometryForSegment(segment);paths.flat().forEach(point=>bounds.extend(point));}}if(!bounds.isEmpty())map.fitBounds(bounds,48);};

/* Boot/runtime integration */
const initMapV14AForB=initMap;
initMap=function(){initMapV14AForB();if(currentCityId==="rome"){ensureRomeCore().then(()=>applyLayerState()).catch(()=>{});if(layerState.tram)ensureRomeTrams().catch(()=>{});}updateDataAttributionV14B();};

mapRomeZoomListenerInstalled=false;
function installRomeZoomListener(){if(mapRomeZoomListenerInstalled||!map)return;mapRomeZoomListenerInstalled=true;map.addListener("zoom_changed",()=>{if(currentCityId==="rome"){refreshRomeMunicipioLabels();scheduleLineLabelRefresh();}});}
const initMapV14BPrevious=initMap;
initMap=function(){initMapV14BPrevious();installRomeZoomListener();};

/* Refresh data button gets a Rome-aware path. The original London listener still exists, so a Rome click is intercepted here first. */
el("refresh-tfl-btn")?.addEventListener("click",async event=>{if(currentCityId!=="rome")return;event.stopImmediatePropagation();hideModal("settings-modal");showToast("Refreshing Rome transport + city data…",2000);await refreshRomeData();showToast("Rome data refreshed.",1800);},true);

updateV14CityUI();



/* v1.4B route-editor safety patches for Rome */
const renderRouteEditorSegmentsRomeBase = renderRouteEditorSegments;
renderRouteEditorSegments = function() {
  if (currentCityId === "rome") {
    routeEditorSegments = routeEditorSegments.map(segment => {
      const normalized = normalizeRouteSegment(segment);
      if (["metro","rail","tram"].includes(normalized.mode) && !romeLineById.has(normalized.service)) {
        normalized.service = romeDefaultService(normalized.mode);
        normalized.startStationId = ""; normalized.endStationId = ""; normalized.startStationName = ""; normalized.endStationName = "";
      }
      return normalized;
    });
  }
  renderRouteEditorSegmentsRomeBase();
  if (currentCityId !== "rome") return;
  const node = el("route-segments");
  if (!node) return;
  node.querySelectorAll("[data-segment-mode]").forEach(select => {
    const clone = select.cloneNode(true); select.replaceWith(clone);
    clone.addEventListener("change", async () => {
      const index = Number(clone.dataset.segmentMode), mode = clone.value;
      if (mode === "rail") await ensureRomeCore();
      if (mode === "tram") await ensureRomeTrams();
      routeEditorSegments[index] = normalizeRouteSegment({ mode, service: ["metro","rail","tram"].includes(mode) ? romeDefaultService(mode) : "" });
      renderRouteEditorSegments();
    });
  });
  node.querySelectorAll("[data-remove-segment]").forEach(button => {
    const clone = button.cloneNode(true); button.replaceWith(clone);
    clone.addEventListener("click", () => {
      routeEditorSegments.splice(Number(clone.dataset.removeSegment), 1);
      if (!routeEditorSegments.length) routeEditorSegments.push(normalizeRouteSegment({ mode:"metro", service:"rome-metro-a" }));
      renderRouteEditorSegments();
    });
  });
};

const startRouteWithSegmentV14BBase = startRouteWithSegment;
startRouteWithSegment = async function(segment) {
  const normalized = normalizeRouteSegment(segment);
  if (currentCityId !== "rome" && !String(normalized.service).startsWith("rome-")) return startRouteWithSegmentV14BBase(segment);
  transientTransportSelection = null; persistentTransportFocus = null; updateItemFocusChip();
  if (normalized.mode === "rail") await ensureRomeCore();
  if (normalized.mode === "tram") { await ensureRomeTrams(); await ensureRomeTramStops().catch(()=>{}); }
  closeDetail(false);
  routeEditorSegments = [normalized];
  el("route-name-input").value = "";
  renderRouteEditorSegments();
  el("route-editor-sheet").classList.remove("hidden");
  document.body.classList.add("detail-open");
  restorePanelPosition(el("route-editor-sheet")); bringPanelToFront(el("route-editor-sheet"));
  showToast(normalized.startStationId ? "Route started here. Choose the other station on the map or in the route panel." : "Route started. Choose start and end stations.", 2800);
};

const applyBaseMapStyleV14BBase = applyBaseMapStyle;
applyBaseMapStyle = function() {
  if (!map || activeMapType !== "roadmap") return;
  if (currentCityId === "rome") {
    if (cityInfoState.wind) { map.setOptions({ styles: V13F_WIND_MAP_STYLES }); return; }
    const focus = !getTransportSelection() && !getActiveFavoriteRoute() && layerState.metro && !layerState.rail && !layerState.tram && !layerState.places && !cityInfoState.districts && !cityInfoState.weather;
    map.setOptions({ styles: focus ? METRO_FOCUS_MAP_STYLES : [] });
    return;
  }
  applyBaseMapStyleV14BBase();
};


/* PWA registration stays disabled in this development build.
   We will re-enable it deliberately after the dev/stable service-worker scopes are cleaned up. */

/* ---------- Boot ---------- */
const storedKey = localStorage.getItem(GOOGLE_KEY_STORAGE);
if (storedKey) {
  bootWithKey(storedKey);
} else {
  showModal("key-modal");
}
