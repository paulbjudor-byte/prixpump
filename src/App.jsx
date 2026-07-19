import { useState, useMemo, useEffect, useCallback } from "react";
import { MapPin, Fuel, Navigation, Sparkles, Zap, LocateFixed, Loader2, Search } from "lucide-react";

// ---- Config -------------------------------------------------------
const FUELS = [
  { id: "gazole", label: "Gazole", color: "#FF4D6D" },
  { id: "sp95", label: "SP95", color: "#FFB020" },
  { id: "e10", label: "E10", color: "#8B5CF6" },
  { id: "sp98", label: "SP98", color: "#00C896" },
  { id: "e85", label: "E85", color: "#3EA6FF" },
];

const CARBURANTS_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const GEOCODE_API = "https://api-adresse.data.gouv.fr/search/";

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
      distance: distanceKm(lat, lon, r.geom.lat, r.geom.lon),
      prices: {
        gazole: r.gazole_prix ?? null,
        sp95: r.sp95_prix ?? null,
        e10: r.e10_prix ?? null,
        sp98: r.sp98_prix ?? null,
        e85: r.e85_prix ?? null,
      },
    }));
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

function StationCard({ station, fuel, isBest, rank }) {
  const price = station.prices[fuel.id];
  return (
    <div
      className="group relative flex items-center justify-between gap-3 px-5 py-4 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
      style={{
        background: isBest
          ? `linear-gradient(135deg, ${fuel.color}18, ${fuel.color}08)`
          : "#FFFFFF",
        border: isBest ? `2px solid ${fuel.color}` : "2px solid #F0EAE2",
        boxShadow: isBest
          ? `0 8px 24px -8px ${fuel.color}55`
          : "0 2px 8px -4px rgba(45,27,54,0.08)",
        animation: `pop-in 0.4s ease-out ${Math.min(rank, 8) * 0.06}s both`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm"
          style={{ background: isBest ? fuel.color : "#2D1B36" }}
        >
          <Fuel size={18} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#2D1B36] truncate">
              {station.address}
            </span>
            {isBest && (
              <span
                className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white shrink-0"
                style={{ background: fuel.color }}
              >
                <Sparkles size={10} /> Top prix
              </span>
            )}
          </div>
          <p className="text-xs text-[#8A7B92] truncate flex items-center gap-1">
            <Navigation size={10} /> {station.distance.toFixed(1)} km ·{" "}
            {station.city}
          </p>
        </div>
      </div>
      {price != null ? (
        <PriceBadge value={price} color={isBest ? fuel.color : "#2D1B36"} big={isBest} />
      ) : (
        <span className="text-xs text-[#C4B8C9] font-medium">Indispo.</span>
      )}
    </div>
  );
}

export default function App() {
  const [inputCity, setInputCity] = useState("Lyon");
  const [fuelId, setFuelId] = useState("gazole");
  const [pulse, setPulse] = useState(false);
  const [coords, setCoords] = useState(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [locStatus, setLocStatus] = useState("idle");
  const [stations, setStations] = useState([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const loadStations = useCallback(async (lat, lon) => {
    setLoadingStations(true);
    setFetchError(null);
    try {
      const results = await fetchNearbyStations(lat, lon);
      setStations(results);
    } catch (err) {
      setFetchError("Impossible de charger les prix pour l'instant. Réessaie dans un instant.");
    } finally {
      setLoadingStations(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const place = await geocodeCity("Lyon");
        if (place) {
          setCoords({ lat: place.lat, lon: place.lon });
          setPlaceLabel(place.label);
          loadStations(place.lat, place.lon);
        }
      } catch {
        setFetchError("Impossible de contacter les services de données pour l'instant.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 400);
    return () => clearTimeout(t);
  }, [fuelId, coords]);

  const handleLocate = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("loading");
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCoords({ lat, lon });
          setPlaceLabel("ta position actuelle");
          setLocStatus("granted");
          loadStations(lat, lon);
        },
        () => setLocStatus("denied"),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch {
      setLocStatus("unsupported");
    }
  };

  const handleCitySearch = async (e) => {
    e.preventDefault();
    setLocStatus("idle");
    setFetchError(null);
    try {
      const place = await geocodeCity(inputCity.trim() || "Lyon");
      if (place) {
        setCoords({ lat: place.lat, lon: place.lon });
        setPlaceLabel(place.label);
        loadStations(place.lat, place.lon);
      } else {
        setFetchError("Ville introuvable, essaie une autre orthographe.");
      }
    } catch {
      setFetchError("Impossible de contacter le service de recherche de ville.");
    }
  };

  const fuel = FUELS.find((f) => f.id === fuelId);

  const sorted = useMemo(() => {
    return [...stations].sort((a, b) => a.distance - b.distance);
  }, [stations]);

  const byPrice = useMemo(
    () =>
      [...stations]
        .filter((s) => s.prices[fuelId] != null)
        .sort((a, b) => a.prices[fuelId] - b.prices[fuelId]),
    [stations, fuelId]
  );
  const cheapest = byPrice[0];
  const priciest = byPrice[byPrice.length - 1];
  const savingsEuros = cheapest ? priciest.prices[fuelId] - cheapest.prices[fuelId] : 0;

  return (
    <div className="min-h-screen bg-[#FFF9F2] text-[#2D1B36] font-sans relative overflow-x-hidden">
      <style>{`
        .font-display { font-family: 'Baloo 2', sans-serif; }
        .font-sans { font-family: 'Plus Jakarta Sans', sans-serif; }
        @keyframes pop-in {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
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
        <h1 className="font-display text-5xl md:text-7xl leading-[0.95] mb-3">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF4D6D] via-[#FF8A3D] to-[#FFB020]">
            Fais le plein
          </span>
          <br />
          au meilleur prix
        </h1>
        <p className="text-[#8A7B92] text-lg max-w-md">
          Trouve la station la moins chère autour de toi, en un clin d'œil ✨
        </p>
      </header>

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

        <form
          onSubmit={handleCitySearch}
          className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 shadow-[0_4px_20px_-6px_rgba(45,27,54,0.15)]"
        >
          <MapPin size={20} className="text-[#FF4D6D] shrink-0" />
          <input
            value={inputCity}
            onChange={(e) => setInputCity(e.target.value)}
            placeholder="Ta ville ou ton code postal"
            className="w-full bg-transparent outline-none placeholder:text-[#C4B8C9] text-base font-medium"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 text-sm font-bold text-white px-4 py-2 rounded-xl shrink-0 transition-transform hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(135deg, #FF4D6D, #FF8A3D)" }}
          >
            <Search size={14} /> Chercher
          </button>
        </form>

        {placeLabel && (
          <p className="text-xs text-[#8A7B92] font-medium -mt-3">
            Résultats autour de <span className="font-semibold">{placeLabel}</span>
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

        {!loadingStations && stations.length === 0 && !fetchError && (
          <p className="text-sm text-[#8A7B92] px-1">
            Aucune station trouvée dans ce secteur — essaie une autre ville.
          </p>
        )}

        <div className="space-y-2.5">
          {sorted.map((station, i) => (
            <StationCard
              key={station.id}
              station={station}
              fuel={fuel}
              isBest={station.id === cheapest?.id}
              rank={i}
            />
          ))}
        </div>
      </main>

      <footer className="relative max-w-3xl mx-auto px-6 md:px-12 py-8">
        <p className="text-xs text-[#C4B8C9] font-medium">
          Données officielles issues de data.economie.gouv.fr (DGCCRF),
          actualisées toutes les 10 min. Géocodage via l'API Adresse (Base
          Adresse Nationale). ⛽
        </p>
      </footer>
    </div>
  );
}
