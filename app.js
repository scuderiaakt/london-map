/* London Life Map v1.3A
   Google Maps basemap + TfL Tube geometry.
   v1.3A adds: layer architecture, Metro focus/minimal modes,
   phone-first controls, local search, information panel and live location.
   Data attribution: Transport for London.
*/

const GOOGLE_KEY_STORAGE = "london_map_google_key";
const TFL_CACHE_PREFIX = "london_tube_cache_v3_";
const TFL_CACHE_TTL = 24 * 60 * 60 * 1000;
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
    closeDetail();
    closeAddSheet();
    hideSearchResults();
  });

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
    constructor(station, line, index, total) {
      super({ lat: station.lat, lng: station.lon }, "station-node");
      this.station = station;
      this.line = line;
      this.index = index;
      this.total = total;
      this.mode = "focus";
    }

    onAdd() {
      super.onAdd();
      this.div.style.background = this.line.color;
      if (this.total > 1) this.div.classList.add("interchange");
      this.div.title = `${this.station.name} — ${formatLineName(this.line)}`;
      this.div.addEventListener("click", event => {
        event.stopPropagation();
        showStationInfo(this.station);
      });
      this.applyMode();
    }

    setMode(mode) {
      this.mode = mode;
      this.applyMode();
    }

    applyMode() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
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
  };

  LineLabelOverlay = class LineLabelOverlay extends HtmlOverlay {
    constructor(position, line) {
      super(position, "line-map-label");
      this.line = line;
      this.mode = "focus";
    }

    onAdd() {
      super.onAdd();
      this.div.textContent = this.line.code;
      this.div.style.background = this.line.color;
      this.div.style.color = idealTextColor(this.line.color);
      if (this.line.id === "northern") this.div.style.borderColor = "#fff";
      this.applyMode();
    }

    setMode(mode) {
      this.mode = mode;
      this.applyMode();
    }

    applyMode() {
      if (!this.div) return;
      this.div.classList.toggle("metro-minimal", this.mode === "minimal");
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
  setNetworkStatus("Loading Tube geometry…");

  const results = await Promise.allSettled(
    TUBE_LINES.map(line => loadLine(line, force))
  );

  const good = results.filter(result => result.status === "fulfilled").map(result => result.value);
  const bad = results.length - good.length;

  good.forEach(data => ingestLineData(data));
  buildStationNodes();
  applyLayerState();
  refreshSearchIfOpen();

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

function ingestLineData(data) {
  const { line, geometries, stops } = data;
  lineGeometryRegistry.set(line.id, geometries);

  let longestPath = null;

  for (const path of geometries) {
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

    const polyline = new google.maps.Polyline({
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

    lineRenderings.push({ polyline, line, role: "main" });
    if (!longestPath || path.length > longestPath.length) longestPath = path;
  }

  if (longestPath?.length) {
    const labelPos = longestPath[Math.floor(longestPath.length * 0.52)];
    const label = new LineLabelOverlay(labelPos, line);
    label.setMap(map);
    label.setVisible(layerState.metro);
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

    addStationLine(existing, line);

    for (const listedLine of (stop.lines || [])) {
      const knownLine = TUBE_LINE_BY_ID.get(listedLine.id);
      if (knownLine) addStationLine(existing, knownLine);
    }

    (stop.modes || []).forEach(mode => existing.modes.add(mode));
    stationRegistry.set(key, existing);
  }
}

function addStationLine(station, line) {
  if (!station.lines.some(existing => existing.id === line.id)) {
    station.lines.push(line);
  }
}

function buildStationNodes() {
  stationOverlays.forEach(overlay => overlay.setMap(null));
  stationOverlays = [];

  for (const station of stationRegistry.values()) {
    const lines = station.lines.slice().sort(compareTubeLines);
    lines.forEach((line, index) => {
      const overlay = new StationNodeOverlay(station, line, index, lines.length);
      overlay.setMap(map);
      overlay.setVisible(layerState.metro);
      stationOverlays.push(overlay);
    });
  }
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
  applyLayerState();

  if (name === "rail" && layerState.rail) {
    showToast("Rail controls are ready; Elizabeth, Overground, DLR and National Rail data come in the Rail build.", 3400);
  }
}

function applyLayerState() {
  const metroVisible = layerState.metro;
  const metroFocus = metroVisible && !layerState.rail && !layerState.places;
  const metroMode = metroFocus ? "focus" : "minimal";

  lineRenderings.forEach(item => {
    const { polyline, line, role } = item;
    polyline.setVisible(metroVisible);

    if (!metroVisible) return;

    if (role === "casing") {
      polyline.setOptions({
        strokeOpacity: metroFocus ? 0.90 : 0.43,
        strokeWeight: metroFocus ? 9 : 5.4,
        zIndex: metroFocus ? 17 : 12
      });
      return;
    }

    polyline.setOptions({
      strokeOpacity: metroFocus ? 0.97 : 0.56,
      strokeWeight: metroFocus ? (line.id === "northern" ? 6 : 5) : 3.2,
      zIndex: metroFocus ? 20 : 13
    });
  });

  stationOverlays.forEach(overlay => {
    overlay.setVisible(metroVisible);
    overlay.setMode(metroMode);
  });

  lineLabelOverlays.forEach(overlay => {
    overlay.setVisible(metroVisible);
    overlay.setMode(metroMode);
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
  const content = el("detail-content");
  content.innerHTML = `
    <div class="detail-label">METRO LINE</div>
    <h2>${escapeHtml(formatLineName(line))}</h2>
    <div class="sub">London Underground · official TfL colour retained.</div>
    <div class="detail-section">
      <div class="info-row"><span>Learning alias</span><b>${escapeHtml(line.code)}</b></div>
      <div class="info-row"><span>Official name</span><b>${escapeHtml(line.name)}</b></div>
    </div>
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
        <span class="line-chip" style="background:${line.color};color:${idealTextColor(line.color)}">
          ${escapeHtml(formatLineName(line))}
        </span>
      `).join("")}
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
  const groups = new Map();

  for (const station of stationRegistry.values()) {
    /* Approximate physical grouping for search display only.
       The real interchange/hub model is rebuilt in v1.3B. */
    const key = [
      normalizeStationName(station.name),
      Number(station.lat).toFixed(3),
      Number(station.lon).toFixed(3)
    ].join("|");

    const existing = groups.get(key) || {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      modes: new Set(),
      lines: []
    };

    station.lines.forEach(line => addStationLine(existing, line));
    station.modes?.forEach?.(mode => existing.modes.add(mode));
    groups.set(key, existing);
  }

  return [...groups.values()].map(station => ({
    ...station,
    lines: station.lines.slice().sort(compareTubeLines)
  }));
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
    applyLayerState();
    map.panTo({ lat: result.station.lat, lng: result.station.lon });
    map.setZoom(16);
    showStationInfo(result.station);
    return;
  }

  if (result.type === "line") {
    layerState.metro = true;
    applyLayerState();
    focusTubeLine(result.line.id);
    showLineInfo(result.line);
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
