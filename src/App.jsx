import { useState, useMemo, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import {
  MapPin,
  Fuel,
  Navigation,
  Sparkles,
  Zap,
  LocateFixed,
  Loader2,
  Search,
  Clock,
  ExternalLink,
  ChevronDown,
  TrendingUp,
  Gauge,
  Map as MapIcon,
  Smartphone,
  X,
  Star,
  Bell,
  Check,
} from "lucide-react";

// ---- Config -------------------------------------------------------
const FUELS = [
  { id: "gazole", label: "Gazole", color: "#FF4D6D" },
  { id: "sp95", label: "SP95", color: "#FFB020" },
  { id: "e10", label: "E10", color: "#8B5CF6" },
  { id: "sp98", label: "SP98", color: "#00C896" },
  { id: "e85", label: "E85", color: "#3EA6FF" },
];

// Rough average consumption assumption used only to estimate the cost of
// driving to a station further away — adjustable by the user in the UI.
const DEFAULT_CONSUMPTION_L_PER_100KM = 6;
const DEFAULT_FILL_LITERS = 40;

const CARBURANTS_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const BRANDS_API =
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/prix_des_carburants_j_7/records";
const GEOCODE_API = "https://api-adresse.data.gouv.fr/search/";

// Known brand accent colors (approximate, for the colored text badge only —
// never a reproduction of the actual trademarked logo graphics).
const BRAND_COLORS = {
  totalenergies: "#EE2E24",
  total: "#EE2E24",
  intermarche: "#E2001A",
  leclerc: "#0055A4",
  "e.leclerc": "#0055A4",
  carrefour: "#004E9F",
  esso: "#00539B",
  auchan: "#C8102E",
  avia: "#005CA9",
  bp: "#8FCB3B",
  shell: "#FBCE07",
  cora: "#E30613",
  "systeme u": "#E2001A",
  "super u": "#E2001A",
  "u express": "#E2001A",
  netto: "#004F9F",
  simply: "#00954C",
  dyneff: "#F58220",
  agip: "#004B87",
  casino: "#00A0DC",
  vito: "#F39200",
  "les mousquetaires": "#E2001A",
};

function brandColor(brand) {
  if (!brand) return "#2D1B36";
  return BRAND_COLORS[brand.trim().toLowerCase()] || "#5A3D6B";
}

// Fetch brand/enseigne names for a batch of station ids from the official
// weekly (J-7) dataset, which — unlike the live feed — includes the "brand"
// field. Best-effort: any failure here just means no brand badge is shown,
// the app keeps working with prices from the live feed regardless.
async function fetchBrandsForStations(ids) {
  if (!ids.length) return {};
  const idList = ids.map((id) => `'${id}'`).join(",");
  const url = `${BRANDS_API}?where=${encodeURIComponent(`id in (${idList})`)}&limit=${ids.length}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    (data.results || []).forEach((r) => {
      if (r.id && r.brand) map[String(r.id)] = r.brand;
    });
    return map;
  } catch {
    return {};
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeCity(query) {
  const url = `${GEOCODE_API}?q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  if (!data.features || data.features.length === 0) return null;
  const [lon, lat] = data.features[0].geometry.coordinates;
  const label = data.features[0].properties.label;
  return { lat, lon, label };
}

// Turn GPS coordinates back into a readable place name, so the user can see
// exactly what location was detected (useful when laptop Wi-Fi/IP-based
// geolocation is imprecise, unlike a phone's GPS chip).
async function reverseGeocode(lat, lon) {
  const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0]?.properties?.label || null;
  } catch {
    return null;
  }
}

// Fetch up to 5 city/address suggestions for the autocomplete dropdown
async function fetchCitySuggestions(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `${GEOCODE_API}?q=${encodeURIComponent(query)}&type=municipality&limit=5`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).map((f) => ({
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

// Parse the raw "horaires" field returned by the API into a simple weekly list.
// The field is itself a JSON string (sometimes malformed/absent), so this is
// defensive: it returns null if nothing usable is found.
function parseHoraires(rawHoraires, automate2424) {
  if (automate2424 === "Oui") return { alwaysOpen: true, days: [] };
  if (!rawHoraires) return null;
  try {
    const parsed = JSON.parse(rawHoraires);
    const days = parsed?.jour;
    if (!Array.isArray(days)) return null;
    const formatted = days.map((d) => {
      const name = d["@nom"];
      if (d["@ferme"] === "1" || d["@ferme"] === "") {
        const ouverture = d["@ouverture"];
        const fermeture = d["@fermeture"];
        if (ouverture && fermeture) {
          return { name, hours: `${ouverture} – ${fermeture}` };
        }
        return { name, hours: d["@ferme"] === "1" ? "Fermé" : null };
      }
      return { name, hours: null };
    });
    return { alwaysOpen: false, days: formatted };
  } catch {
    return null;
  }
}

async function fetchNearbyStations(lat, lon, radiusKm = 15, limit = 20) {
  const where = `distance(geom, geom'POINT(${lon} ${lat})', ${radiusKm}km)`;
  const url = `${CARBURANTS_API}?where=${encodeURIComponent(where)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Fuel API failed");
  const data = await res.json();
  return (data.results || [])
    .filter((r) => r.geom)
    .map((r) => ({
      id: r.id,
      address: r.adresse || "Adresse non renseignée",
      city: r.ville || "",
      lat: r.geom.lat,
      lon: r.geom.lon,
      distance: distanceKm(lat, lon, r.geom.lat, r.geom.lon),
      prices: {
        gazole: r.gazole_prix ?? null,
        sp95: r.sp95_prix ?? null,
        e10: r.e10_prix ?? null,
        sp98: r.sp98_prix ?? null,
        e85: r.e85_prix ?? null,
      },
      horaires: parseHoraires(r.horaires, r.horaires_automate_24_24),
    }));
}

function googleMapsUrl(station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`;
}

// Fetch a large sample of stations across all of France for the "national"
// map view. Capped at ~1500 stations (15 pages of 100) to keep the map and
// the browser responsive — plenty for a visual overview with clustering.
const FRANCE_MAP_CAP = 1500;
const FRANCE_PAGE_SIZE = 100;

async function fetchAllFranceStations() {
  const all = [];
  let offset = 0;
  while (all.length < FRANCE_MAP_CAP) {
    const url = `${CARBURANTS_API}?limit=${FRANCE_PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    const batch = (data.results || []).filter((r) => r.geom);
    if (batch.length === 0) break;
    all.push(
      ...batch.map((r) => ({
        id: r.id,
        address: r.adresse || "Adresse non renseignée",
        city: r.ville || "",
        lat: r.geom.lat,
        lon: r.geom.lon,
        prices: {
          gazole: r.gazole_prix ?? null,
          sp95: r.sp95_prix ?? null,
          e10: r.e10_prix ?? null,
          sp98: r.sp98_prix ?? null,
          e85: r.e85_prix ?? null,
        },
      }))
    );
    offset += FRANCE_PAGE_SIZE;
    if (batch.length < FRANCE_PAGE_SIZE) break; // reached the end
  }
  return all;
}

function PriceBadge({ value, color, big }) {
  return (
    <span
      className={`font-display font-bold tabular-nums ${big ? "text-3xl" : "text-xl"}`}
      style={{ color }}
    >
      {value.toFixed(3)}
      <span className="text-xs font-sans font-medium opacity-60 ml-0.5">€</span>
    </span>
  );
}

function StationDetails({ station, fuel }) {
  return (
    <div
      className="px-5 pb-5 pt-1 space-y-4 rounded-b-2xl"
      style={{ animation: "expand-in 0.25s ease-out both" }}
    >
      {station.brand && (
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-lg text-white"
            style={{ background: brandColor(station.brand) }}
          >
            {station.brand}
          </span>
        </div>
      )}
      {/* Full price table */}
      <div className="grid grid-cols-2 gap-2">
        {FUELS.map((f) => {
          const p = station.prices[f.id];
          return (
            <div
              key={f.id}
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/70"
            >
              <span className="text-xs font-semibold text-[#8A7B92]">{f.label}</span>
              <span
                className="text-sm font-bold font-display"
                style={{ color: p != null ? f.color : "#C4B8C9" }}
              >
                {p != null ? `${p.toFixed(3)} €` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Opening hours */}
      <div className="flex items-start gap-2 text-sm">
        <Clock size={16} className="text-[#8A7B92] mt-0.5 shrink-0" />
        {station.horaires?.alwaysOpen ? (
          <span className="text-[#2D1B36] font-medium">
            Ouvert 24h/24 (automate)
          </span>
        ) : station.horaires?.days?.length ? (
          <div className="text-[#2D1B36] leading-relaxed">
            {station.horaires.days.map((d, i) => (
              <div key={i} className="flex gap-2">
                <span className="font-medium w-20 shrink-0">{d.name}</span>
                <span className="text-[#8A7B92]">{d.hours || "Non communiqué"}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[#8A7B92]">
            Horaires non communiqués — vérifie sur Google Maps.
          </span>
        )}
      </div>

      {/* Directions link */}
      <a
        href={googleMapsUrl(station)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: `linear-gradient(135deg, ${fuel.color}, #2D1B36)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <Navigation size={15} />
        Itinéraire Google Maps
        <ExternalLink size={13} />
      </a>
    </div>
  );
}

function StationCard({ station, fuel, isBest, isBestValue, rank, expanded, onToggle, isFavorite, onToggleFavorite }) {
  const price = station.prices[fuel.id];
  return (
    <div
      className="rounded-2xl transition-all duration-300 overflow-hidden"
      style={{
        background: isBest || isBestValue
          ? `linear-gradient(135deg, ${fuel.color}18, ${fuel.color}08)`
          : "#FFFFFF",
        border: isBest || isBestValue ? `2px solid ${fuel.color}` : "2px solid #F0EAE2",
        boxShadow: isBest || isBestValue
          ? `0 8px 24px -8px ${fuel.color}55`
          : "0 2px 8px -4px rgba(45,27,54,0.08)",
        animation: `pop-in 0.4s ease-out ${Math.min(rank, 8) * 0.06}s both`,
      }}
    >
      <div className="w-full flex items-center gap-1 pr-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center justify-between gap-3 px-5 py-4 text-left min-w-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm font-display font-bold text-xs text-center leading-tight px-0.5"
              style={{ background: isBest || isBestValue ? fuel.color : brandColor(station.brand) }}
            >
              {station.brand ? station.brand.slice(0, 3).toUpperCase() : <Fuel size={18} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {station.brand && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md text-white shrink-0"
                    style={{ background: brandColor(station.brand) }}
                  >
                    {station.brand}
                  </span>
                )}
                <span className="font-semibold text-[#2D1B36] truncate">
                  {station.address}
                </span>
                {isBest && (
                  <span
                    className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white shrink-0"
                    style={{ background: fuel.color }}
                  >
                    <Sparkles size={10} /> Moins cher
                  </span>
                )}
                {isBestValue && (
                  <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white shrink-0 bg-[#2D1B36]">
                    <TrendingUp size={10} /> Le plus rentable
                  </span>
                )}
              </div>
              <p className="text-xs text-[#8A7B92] truncate flex items-center gap-1">
                <Navigation size={10} /> {station.distance.toFixed(1)} km ·{" "}
                {station.city}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {price != null ? (
              <PriceBadge value={price} color={isBest || isBestValue ? fuel.color : "#2D1B36"} big={isBest || isBestValue} />
            ) : (
              <span className="text-xs text-[#C4B8C9] font-medium">Indispo.</span>
            )}
            <ChevronDown
              size={18}
              className="text-[#C4B8C9] transition-transform duration-200"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(station.id);
          }}
          className="shrink-0 p-1.5 rounded-full hover:scale-110 transition-transform"
          aria-label="Ajouter aux favoris"
        >
          <Star
            size={20}
            fill={isFavorite ? "#FFB020" : "none"}
            color={isFavorite ? "#FFB020" : "#C4B8C9"}
          />
        </button>
      </div>
      {expanded && <StationDetails station={station} fuel={fuel} />}
    </div>
  );
}

function Logo({ size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0 rounded-2xl"
      style={{ boxShadow: "0 6px 16px -4px rgba(255,77,109,0.45)" }}
    >
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF4D6D" />
          <stop offset="55%" stopColor="#FF8A3D" />
          <stop offset="100%" stopColor="#FFB020" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#logoGrad)" />
      <path
        d="M20 46V22a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v24"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17 46h22" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M21 30h11" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M36 25l6 3.6a3 3 0 0 1 1.5 2.6V40a2.5 2.5 0 0 1-5 0v-6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M30.5 12.5l-6 9h4.6l-2.4 8.5 7.8-10.3h-4.8z" fill="#FFFFFF" />
    </svg>
  );
}

// Colored circle markers built with plain HTML/CSS — avoids the classic
// Leaflet-in-a-bundler broken default icon issue entirely.
function makeMarkerIcon(color, label, big) {
  const size = big ? 34 : 26;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};border:2.5px solid white;
      box-shadow:0 2px 8px rgba(45,27,54,0.35);
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:${big ? 13 : 11}px;
      font-family:'Plus Jakarta Sans', sans-serif;
    ">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function userMarkerIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;border-radius:9999px;
      background:#2D1B36;border:3px solid white;
      box-shadow:0 0 0 4px rgba(45,27,54,0.25);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function StationsMap({ stations, coords, fuel, fuelId, cheapestId, bestValueId, mapScope, franceStations, franceLoading }) {
  if (!coords && mapScope === "nearby") return null;
  const center = coords ? [coords.lat, coords.lon] : [46.6, 2.4];
  const zoom = mapScope === "france" ? 6 : 13;

  return (
    <div className="rounded-2xl overflow-hidden shadow-[0_4px_20px_-6px_rgba(45,27,54,0.15)] relative" style={{ height: 340 }}>
      {mapScope === "france" && franceLoading && (
        <div className="absolute inset-0 z-[1000] bg-white/80 flex items-center justify-center gap-2 text-sm font-semibold text-[#8A7B92]">
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          Chargement des stations de France…
        </div>
      )}
      <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {coords && (
          <Marker position={[coords.lat, coords.lon]} icon={userMarkerIcon()}>
            <Popup>Toi</Popup>
          </Marker>
        )}

        {mapScope === "nearby" &&
          stations.map((s) => {
            const price = s.prices[fuelId];
            const isBest = s.id === cheapestId || s.id === bestValueId;
            return (
              <Marker
                key={s.id}
                position={[s.lat, s.lon]}
                icon={makeMarkerIcon(isBest ? fuel.color : "#2D1B36", price != null ? price.toFixed(2) : "–", isBest)}
              >
                <Popup>
                  <StationPopupContent station={s} fuel={fuel} />
                </Popup>
              </Marker>
            );
          })}

        {mapScope === "france" && (
          <MarkerClusterGroup chunkedLoading maxClusterRadius={60}>
            {franceStations.map((s) => {
              const price = s.prices[fuelId];
              return (
                <Marker
                  key={s.id}
                  position={[s.lat, s.lon]}
                  icon={makeMarkerIcon("#5A3D6B", price != null ? price.toFixed(2) : "–", false)}
                >
                  <Popup>
                    <StationPopupContent station={s} fuel={fuel} />
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
}

function StationPopupContent({ station: s, fuel }) {
  const price = s.prices[fuel.id];
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", minWidth: 160 }}>
      {s.brand && (
        <div
          style={{
            display: "inline-block",
            background: brandColor(s.brand),
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: 6,
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          {s.brand}
        </div>
      )}
      <br />
      <strong>{s.address}</strong>
      <div style={{ color: "#8A7B92", fontSize: 12, marginBottom: 6 }}>
        {s.city}
        {s.distance != null ? ` · ${s.distance.toFixed(1)} km` : ""}
      </div>
      <div style={{ fontWeight: 700, color: fuel.color, marginBottom: 6 }}>
        {price != null ? `${price.toFixed(3)} € · ${fuel.label}` : "Prix indisponible"}
      </div>
      <a href={googleMapsUrl(s)} target="_blank" rel="noopener noreferrer" style={{ color: "#FF4D6D", fontWeight: 600, fontSize: 13 }}>
        Itinéraire →
      </a>
    </div>
  );
}

export default function App() {
  const [inputCity, setInputCity] = useState("");
  const [fuelId, setFuelId] = useState("gazole");
  const [pulse, setPulse] = useState(false);
  const [coords, setCoords] = useState(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [locStatus, setLocStatus] = useState("idle");
  const [stations, setStations] = useState([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [sortMode, setSortMode] = useState("value"); // "value" | "price" | "distance"
  const [fillLiters, setFillLiters] = useState(DEFAULT_FILL_LITERS);
  const [consumption, setConsumption] = useState(DEFAULT_CONSUMPTION_L_PER_100KM);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try {
      const raw = localStorage.getItem("pleinfute_favorites");
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [mapScope, setMapScope] = useState("nearby"); // "nearby" | "france"
  const [franceStations, setFranceStations] = useState([]);
  const [franceLoading, setFranceLoading] = useState(false);
  const [franceLoaded, setFranceLoaded] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumEmail, setPremiumEmail] = useState("");
  const [premiumSubmitted, setPremiumSubmitted] = useState(false);

  const toggleFavorite = useCallback((id) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("pleinfute_favorites", JSON.stringify([...next]));
      } catch {
        // storage unavailable — favorites just won't persist across visits
      }
      return next;
    });
  }, []);

  const loadFranceStations = useCallback(async () => {
    if (franceLoaded || franceLoading) return;
    setFranceLoading(true);
    try {
      const results = await fetchAllFranceStations();
      setFranceStations(results);
      setFranceLoaded(true);
    } finally {
      setFranceLoading(false);
    }
  }, [franceLoaded, franceLoading]);

  const loadStations = useCallback(async (lat, lon) => {
    setLoadingStations(true);
    setFetchError(null);
    setExpandedId(null);
    try {
      const results = await fetchNearbyStations(lat, lon);
      setStations(results);
      // Fetch brand names in the background — non-blocking, best-effort
      fetchBrandsForStations(results.map((s) => s.id)).then((brandMap) => {
        if (Object.keys(brandMap).length === 0) return;
        setStations((current) =>
          current.map((s) => ({ ...s, brand: brandMap[String(s.id)] || null }))
        );
      });
    } catch (err) {
      setFetchError("Impossible de charger les prix pour l'instant. Réessaie dans un instant.");
    } finally {
      setLoadingStations(false);
    }
  }, []);

  // Debounced autocomplete: fetch suggestions ~300ms after the user stops typing
  useEffect(() => {
    if (!inputCity || inputCity.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setSuggestLoading(true);
    const t = setTimeout(async () => {
      const results = await fetchCitySuggestions(inputCity);
      if (!cancelled) {
        setSuggestions(results);
        setSuggestLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inputCity]);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 400);
    return () => clearTimeout(t);
  }, [fuelId, coords]);

  const [locAccuracyWarning, setLocAccuracyWarning] = useState(false);

  const handleLocate = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("loading");
    setLocAccuracyWarning(false);
    try {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          // Accuracy is in meters; large values usually mean Wi-Fi/IP based
          // location on a laptop rather than a real GPS fix.
          if (pos.coords.accuracy && pos.coords.accuracy > 20000) {
            setLocAccuracyWarning(true);
          }
          setCoords({ lat, lon });
          setLocStatus("granted");
          const detected = await reverseGeocode(lat, lon);
          setPlaceLabel(detected || "ta position actuelle");
          loadStations(lat, lon);
        },
        () => setLocStatus("denied"),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch {
      setLocStatus("unsupported");
    }
  };

  const goToPlace = (lat, lon, label) => {
    setCoords({ lat, lon });
    setPlaceLabel(label);
    setInputCity(label);
    setShowSuggestions(false);
    setSuggestions([]);
    setLocStatus("idle");
    loadStations(lat, lon);
  };

  const handleCitySearch = async (e) => {
    e.preventDefault();
    setFetchError(null);
    if (!inputCity.trim()) return;
    try {
      const place = await geocodeCity(inputCity.trim());
      if (place) {
        goToPlace(place.lat, place.lon, place.label);
      } else {
        setFetchError("Ville introuvable, essaie une autre orthographe.");
      }
    } catch {
      setFetchError("Impossible de contacter le service de recherche de ville.");
    }
  };

  const fuel = FUELS.find((f) => f.id === fuelId);

  // Stations that actually have a price for the selected fuel
  const withPrice = useMemo(
    () => stations.filter((s) => s.prices[fuelId] != null),
    [stations, fuelId]
  );

  // --- "Rentability" algorithm -------------------------------------
  // total cost = (fuel needed to fill up * price at that station)
  //            + (fuel burned driving there and back * price at that station)
  // This favours cheap stations that are also close by, penalising cheap
  // stations that are far enough away that the detour cancels the savings.
  const withCost = useMemo(() => {
    return withPrice.map((s) => {
      const price = s.prices[fuelId];
      const tripLiters = (s.distance * 2 * consumption) / 100;
      const tripCost = tripLiters * price;
      const fillCost = fillLiters * price;
      return { ...s, totalCost: tripCost + fillCost, tripCost, fillCost };
    });
  }, [withPrice, fuelId, fillLiters, consumption]);

  const cheapest = useMemo(
    () => [...withPrice].sort((a, b) => a.prices[fuelId] - b.prices[fuelId])[0],
    [withPrice, fuelId]
  );
  const priciest = useMemo(
    () => [...withPrice].sort((a, b) => a.prices[fuelId] - b.prices[fuelId]).slice(-1)[0],
    [withPrice, fuelId]
  );
  const bestValue = useMemo(
    () => [...withCost].sort((a, b) => a.totalCost - b.totalCost)[0],
    [withCost]
  );
  const savingsEuros = cheapest && priciest ? priciest.prices[fuelId] - cheapest.prices[fuelId] : 0;

  const sorted = useMemo(() => {
    const base = withCost.length ? withCost : stations;
    const arr = [...base];
    if (sortMode === "distance") arr.sort((a, b) => a.distance - b.distance);
    else if (sortMode === "price") arr.sort((a, b) => a.prices[fuelId] - b.prices[fuelId]);
    else arr.sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity));
    // stations without a price for this fuel go last, sorted by distance
    const noPrice = stations.filter((s) => s.prices[fuelId] == null);
    noPrice.sort((a, b) => a.distance - b.distance);
    return [...arr, ...noPrice];
  }, [withCost, stations, sortMode, fuelId]);

  return (
    <div className="min-h-screen bg-[#FFF9F2] text-[#2D1B36] font-sans relative overflow-x-hidden">
      <style>{`
        .font-display { font-family: 'Baloo 2', sans-serif; }
        .font-sans { font-family: 'Plus Jakarta Sans', sans-serif; }
        @keyframes pop-in {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes expand-in {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes blob-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -20px) scale(1.05); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .blob { animation: blob-float 8s ease-in-out infinite; }
      `}</style>

      <div
        className="blob absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-30 blur-3xl pointer-events-none"
        style={{ background: "linear-gradient(135deg, #FF4D6D, #FFB020)" }}
      />
      <div
        className="blob absolute top-40 -left-32 w-80 h-80 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "linear-gradient(135deg, #3EA6FF, #00C896)", animationDelay: "2s" }}
      />

      <header className="relative max-w-3xl mx-auto px-6 md:px-12 pt-14 pb-8">
        <div className="inline-flex items-center gap-1.5 bg-white rounded-full px-3 py-1.5 text-xs font-semibold text-[#8A7B92] mb-5 shadow-sm">
          <Zap size={12} className="text-[#FFB020]" style={{ animation: "wiggle 1.5s ease-in-out infinite" }} />
          Données officielles, mises à jour en continu
        </div>
        <div className="flex items-center gap-4 mb-3">
          <Logo size={52} />
          <h1 className="font-display text-5xl md:text-7xl leading-[0.95]">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF4D6D] via-[#FF8A3D] to-[#FFB020]">
              Plein Futé
            </span>
          </h1>
        </div>
        <p className="text-[#8A7B92] text-lg max-w-md mb-4">
          Trouve la station la plus rentable autour de toi, en un clin d'œil ✨
        </p>
        <button
          onClick={() => setShowInstallHelp(true)}
          className="inline-flex items-center gap-1.5 bg-white rounded-full px-3.5 py-2 text-xs font-bold text-[#2D1B36] shadow-sm hover:scale-105 transition-transform"
        >
          <Smartphone size={13} className="text-[#FF4D6D]" />
          Ajouter à l'écran d'accueil
        </button>
        <button
          onClick={() => setShowPremiumModal(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:scale-105 transition-transform ml-2"
          style={{ background: "linear-gradient(135deg, #2D1B36, #5A3D6B)" }}
        >
          <Bell size={13} className="text-[#FFB020]" />
          Premium — 1,99€/mois
        </button>
      </header>

      {showPremiumModal && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 pb-4 md:pb-0"
          onClick={() => setShowPremiumModal(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowPremiumModal(false)}
              className="absolute top-4 right-4 text-[#C4B8C9] hover:text-[#2D1B36]"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2">
              <Bell size={20} className="text-[#FFB020]" />
              <h3 className="font-display text-xl">Plein Futé Premium</h3>
            </div>
            <p className="text-sm text-[#8A7B92] leading-relaxed">
              Reçois une notification dès que le prix baisse dans une de tes
              stations <Star size={12} className="inline text-[#FFB020]" fill="#FFB020" /> favorites.
              Plus besoin de vérifier toi-même.
            </p>
            <div className="bg-[#FFF4EF] rounded-xl p-4 flex items-baseline gap-1">
              <span className="font-display text-3xl text-[#2D1B36]">1,99€</span>
              <span className="text-sm text-[#8A7B92]">/ mois</span>
            </div>
            {!premiumSubmitted ? (
              <>
                <p className="text-xs text-[#8A7B92]">
                  Cette fonctionnalité n'est pas encore active. Laisse ton
                  email pour être prévenu du lancement :
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (premiumEmail.trim()) setPremiumSubmitted(true);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="email"
                    required
                    value={premiumEmail}
                    onChange={(e) => setPremiumEmail(e.target.value)}
                    placeholder="ton@email.com"
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[#F0EAE2] outline-none text-sm"
                  />
                  <button
                    type="submit"
                    className="shrink-0 text-sm font-bold text-white px-4 py-2.5 rounded-xl"
                    style={{ background: "linear-gradient(135deg, #FF4D6D, #FF8A3D)" }}
                  >
                    Prévenez-moi
                  </button>
                </form>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm font-semibold text-[#00C896]">
                <Check size={16} /> Merci, on te préviendra !
              </p>
            )}
          </div>
        </div>
      )}

      {showInstallHelp && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 pb-4 md:pb-0"
          onClick={() => setShowInstallHelp(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowInstallHelp(false)}
              className="absolute top-4 right-4 text-[#C4B8C9] hover:text-[#2D1B36]"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-3">
              <Logo size={40} />
              <h3 className="font-display text-xl">Installer Plein Futé</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-bold text-[#2D1B36] mb-1">Sur iPhone (Safari)</p>
                <p className="text-[#8A7B92] leading-relaxed">
                  Appuie sur le bouton <strong>Partager</strong> (le carré avec
                  une flèche vers le haut) en bas de l'écran, puis choisis{" "}
                  <strong>"Sur l'écran d'accueil"</strong>.
                </p>
              </div>
              <div>
                <p className="font-bold text-[#2D1B36] mb-1">Sur Android (Chrome)</p>
                <p className="text-[#8A7B92] leading-relaxed">
                  Appuie sur le menu <strong>⋮</strong> en haut à droite, puis
                  choisis <strong>"Ajouter à l'écran d'accueil"</strong> ou
                  <strong>"Installer l'application"</strong>.
                </p>
              </div>
              <div>
                <p className="font-bold text-[#2D1B36] mb-1">Sur ordinateur</p>
                <p className="text-[#8A7B92] leading-relaxed">
                  Clique sur l'icône d'installation dans la barre d'adresse de
                  ton navigateur (Chrome/Edge), ou le menu ⋮ → "Installer
                  Plein Futé".
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="relative max-w-3xl mx-auto px-6 md:px-12 pb-8 space-y-6">
        <button
          onClick={handleLocate}
          disabled={locStatus === "loading"}
          className="w-full flex items-center justify-center gap-2 text-white font-bold py-3.5 rounded-2xl transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70"
          style={{ background: "linear-gradient(135deg, #2D1B36, #5A3D6B)" }}
        >
          {locStatus === "loading" ? (
            <>
              <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
              Localisation en cours…
            </>
          ) : (
            <>
              <LocateFixed size={18} />
              Trouver les stations autour de moi
            </>
          )}
        </button>

        {locStatus === "granted" && locAccuracyWarning && (
          <p className="text-sm text-[#FFB020] bg-[#FFB020]/10 rounded-xl px-4 py-2.5">
            Position détectée avec une précision limitée (normal sur
            ordinateur, sans puce GPS). Si l'endroit affiché ne correspond pas
            à chez toi, cherche plutôt ta ville manuellement ci-dessous.
          </p>
        )}
        {locStatus === "denied" && (
          <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 rounded-xl px-4 py-2.5">
            Localisation refusée ou indisponible ici — cherche une ville
            manuellement ci-dessous à la place.
          </p>
        )}
        {locStatus === "unsupported" && (
          <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 rounded-xl px-4 py-2.5">
            La géolocalisation n'est pas disponible dans cet aperçu — elle
            fonctionnera normalement une fois le site publié en ligne.
          </p>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-[#F0EAE2]" />
          <span className="text-xs font-semibold text-[#C4B8C9] uppercase tracking-wide">
            ou
          </span>
          <div className="h-px flex-1 bg-[#F0EAE2]" />
        </div>

        <div className="relative">
          <form
            onSubmit={handleCitySearch}
            className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 shadow-[0_4px_20px_-6px_rgba(45,27,54,0.15)]"
          >
            <MapPin size={20} className="text-[#FF4D6D] shrink-0" />
            <input
              value={inputCity}
              onChange={(e) => {
                setInputCity(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Ta ville ou ton code postal"
              autoComplete="off"
              className="w-full bg-transparent outline-none placeholder:text-[#C4B8C9] text-base font-medium"
            />
            {suggestLoading && (
              <Loader2 size={16} className="text-[#C4B8C9] shrink-0" style={{ animation: "spin 1s linear infinite" }} />
            )}
            <button
              type="submit"
              className="flex items-center gap-1.5 text-sm font-bold text-white px-4 py-2 rounded-xl shrink-0 transition-transform hover:scale-105 active:scale-95"
              style={{ background: "linear-gradient(135deg, #FF4D6D, #FF8A3D)" }}
            >
              <Search size={14} /> Chercher
            </button>
          </form>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] bg-white rounded-2xl shadow-[0_8px_30px_-6px_rgba(45,27,54,0.25)] overflow-hidden z-10">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => goToPlace(s.lat, s.lon, s.label)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-[#2D1B36] hover:bg-[#FFF4EF] transition-colors"
                >
                  <MapPin size={14} className="text-[#C4B8C9] shrink-0" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {placeLabel && (
          <p className="text-xs text-[#8A7B92] font-medium -mt-3">
            Résultats autour de <span className="font-semibold">{placeLabel}</span>
          </p>
        )}

        {!placeLabel && !loadingStations && (
          <p className="text-sm text-[#8A7B92] px-1">
            Utilise la géolocalisation ou cherche une ville pour voir les
            stations autour de toi.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {FUELS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFuelId(f.id)}
              className="px-4 py-2 text-sm font-bold rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                background: f.id === fuelId ? f.color : "#FFFFFF",
                color: f.id === fuelId ? "#FFFFFF" : "#8A7B92",
                boxShadow:
                  f.id === fuelId
                    ? `0 6px 16px -4px ${f.color}88`
                    : "0 2px 8px -4px rgba(45,27,54,0.1)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort mode + trip assumptions */}
        <div className="bg-white rounded-2xl p-4 space-y-3 shadow-[0_4px_20px_-6px_rgba(45,27,54,0.1)]">
          <div className="flex items-center gap-2 text-xs font-bold text-[#8A7B92] uppercase tracking-wide">
            <Gauge size={13} /> Trier par
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "value", label: "Rentabilité (recommandé)" },
              { id: "price", label: "Prix au litre" },
              { id: "distance", label: "Distance" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSortMode(opt.id)}
                className="px-3 py-1.5 text-xs font-bold rounded-full transition-all"
                style={{
                  background: sortMode === opt.id ? "#2D1B36" : "#F5F0EA",
                  color: sortMode === opt.id ? "#FFFFFF" : "#8A7B92",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 pt-1 text-xs text-[#8A7B92]">
            <label className="flex items-center gap-1.5">
              Plein de
              <input
                type="number"
                min="1"
                max="100"
                value={fillLiters}
                onChange={(e) => setFillLiters(Number(e.target.value) || 1)}
                className="w-14 px-1.5 py-1 rounded-lg border border-[#F0EAE2] text-center font-semibold text-[#2D1B36]"
              />
              L
            </label>
            <label className="flex items-center gap-1.5">
              Conso.
              <input
                type="number"
                min="1"
                max="30"
                step="0.5"
                value={consumption}
                onChange={(e) => setConsumption(Number(e.target.value) || 1)}
                className="w-14 px-1.5 py-1 rounded-lg border border-[#F0EAE2] text-center font-semibold text-[#2D1B36]"
              />
              L/100km
            </label>
          </div>
        </div>

        {fetchError && (
          <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 rounded-xl px-4 py-2.5">
            {fetchError}
          </p>
        )}

        {loadingStations && (
          <div className="flex items-center gap-2 text-[#8A7B92] text-sm font-medium px-1">
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Chargement des prix en temps réel…
          </div>
        )}

        {!loadingStations && cheapest && savingsEuros > 0.01 && (
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-2xl text-white transition-transform ${pulse ? "scale-[1.02]" : "scale-100"}`}
            style={{ background: `linear-gradient(135deg, ${fuel.color}, #2D1B36)` }}
          >
            <Fuel size={22} />
            <span className="font-medium">
              Économise jusqu'à{" "}
              <span className="font-display text-lg">
                {savingsEuros.toFixed(3)}&nbsp;€/L
              </span>{" "}
              en choisissant bien ta station 🎉
            </span>
          </div>
        )}

        {!loadingStations && placeLabel && stations.length === 0 && !fetchError && (
          <p className="text-sm text-[#8A7B92] px-1">
            Aucune station trouvée dans ce secteur — essaie une autre ville.
          </p>
        )}

        {!loadingStations && stations.length > 0 && (
          <button
            onClick={() => setShowMap((v) => !v)}
            className="flex items-center gap-2 text-sm font-bold text-[#2D1B36] bg-white px-4 py-2.5 rounded-xl shadow-[0_2px_8px_-4px_rgba(45,27,54,0.15)] hover:scale-[1.01] transition-transform"
          >
            <MapIcon size={16} className="text-[#FF4D6D]" />
            {showMap ? "Masquer la carte" : "Voir la carte"}
          </button>
        )}

        {showMap && (
          <>
            <div className="flex gap-2">
              <button
                onClick={() => setMapScope("nearby")}
                className="px-3 py-1.5 text-xs font-bold rounded-full transition-all"
                style={{
                  background: mapScope === "nearby" ? "#2D1B36" : "#F5F0EA",
                  color: mapScope === "nearby" ? "#FFFFFF" : "#8A7B92",
                }}
              >
                Autour de moi
              </button>
              <button
                onClick={() => {
                  setMapScope("france");
                  loadFranceStations();
                }}
                className="px-3 py-1.5 text-xs font-bold rounded-full transition-all"
                style={{
                  background: mapScope === "france" ? "#2D1B36" : "#F5F0EA",
                  color: mapScope === "france" ? "#FFFFFF" : "#8A7B92",
                }}
              >
                Toute la France
              </button>
            </div>
            <StationsMap
              stations={stations}
              coords={coords}
              fuel={fuel}
              fuelId={fuelId}
              cheapestId={cheapest?.id}
              bestValueId={bestValue?.id}
              mapScope={mapScope}
              franceStations={franceStations}
              franceLoading={franceLoading}
            />
            {mapScope === "france" && (
              <p className="text-xs text-[#8A7B92] -mt-3">
                Échantillon de {FRANCE_MAP_CAP} stations affiché pour garder la carte fluide.
              </p>
            )}
          </>
        )}

        <div className="space-y-2.5">
          {sorted.map((station, i) => (
            <StationCard
              key={station.id}
              station={station}
              fuel={fuel}
              isBest={station.id === cheapest?.id}
              isBestValue={station.id === bestValue?.id && bestValue?.id !== cheapest?.id}
              rank={i}
              expanded={expandedId === station.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === station.id ? null : station.id))
              }
              isFavorite={favorites.has(station.id)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      </main>

      <footer className="relative max-w-3xl mx-auto px-6 md:px-12 py-8">
        <p className="text-xs text-[#C4B8C9] font-medium">
          Données officielles issues de data.economie.gouv.fr (DGCCRF),
          actualisées toutes les 10 min. Géocodage via l'API Adresse (Base
          Adresse Nationale). Le calcul de rentabilité est une estimation
          basée sur ta consommation et la taille de plein renseignées. ⛽
        </p>
      </footer>
    </div>
  );
}
