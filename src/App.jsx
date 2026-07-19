import { useState, useMemo, useEffect } from "react";
import { MapPin, Fuel, Navigation, Sparkles, Zap, LocateFixed, Loader2 } from "lucide-react";

// ---- Mock data --------------------------------------------------------
const FUELS = [
  { id: "gazole", label: "Gazole", color: "#FF4D6D", base: 1.72 },
  { id: "sp95", label: "SP95", color: "#FFB020", base: 1.79 },
  { id: "sp98", label: "SP98", color: "#00C896", base: 1.85 },
  { id: "e85", label: "E85", color: "#3EA6FF", base: 0.99 },
];

const BRANDS = [
  { name: "TotalEnergies", initials: "TE", color: "#EE2E24" },
  { name: "Intermarché", initials: "IM", color: "#E2001A" },
  { name: "Leclerc", initials: "LC", color: "#0055A4" },
  { name: "Carrefour", initials: "CA", color: "#004E9F" },
  { name: "Esso", initials: "ES", color: "#00539B" },
  { name: "Auchan", initials: "AU", color: "#C8102E" },
];

function seededOffset(seed, spread) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * spread;
}

// Haversine distance in km between two lat/lon points
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

// Build stations either around a real coordinate (geolocation) or a mock city seed
function buildStations({ city, coords }) {
  const seedBase = coords ? `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}` : city;

  return BRANDS.map((b, i) => {
    const seed = seedBase + b.name;
    const prices = {};
    FUELS.forEach((f) => {
      prices[f.id] = Math.max(1.2, f.base + seededOffset(seed + f.id, 0.16));
    });

    let distance, stationCoords;
    if (coords) {
      // scatter stations within ~4km of the real user position
      const dLat = seededOffset(seed + "lat", 0.035);
      const dLon = seededOffset(seed + "lon", 0.035);
      stationCoords = { lat: coords.lat + dLat, lon: coords.lon + dLon };
      distance = distanceKm(coords.lat, coords.lon, stationCoords.lat, stationCoords.lon);
    } else {
      distance = Math.max(0.3, 1.5 + seededOffset(seed, 6));
    }

    return {
      id: b.name,
      brand: b.name,
      initials: b.initials,
      brandColor: b.color,
      address: `${2 + i} rue ${
        ["de la Gare", "Principale", "du Marché", "de la République", "des Écoles", "de la Poste"][i]
      }, ${city || "près de toi"}`,
      distance,
      prices,
    };
  });
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
        animation: `pop-in 0.4s ease-out ${rank * 0.06}s both`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white font-display font-bold text-sm shadow-sm"
          style={{ background: station.brandColor }}
        >
          {station.initials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#2D1B36] truncate">
              {station.brand}
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
            {station.address}
          </p>
        </div>
      </div>
      <PriceBadge value={price} color={isBest ? fuel.color : "#2D1B36"} big={isBest} />
    </div>
  );
}

export default function App() {
  const [city, setCity] = useState("Lyon");
  const [inputCity, setInputCity] = useState("Lyon");
  const [fuelId, setFuelId] = useState("gazole");
  const [pulse, setPulse] = useState(false);
  const [coords, setCoords] = useState(null);
  const [locStatus, setLocStatus] = useState("idle"); // idle | loading | granted | denied | unsupported

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 400);
    return () => clearTimeout(t);
  }, [fuelId, city, coords]);

  const handleLocate = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("loading");
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          setLocStatus("granted");
        },
        () => {
          setLocStatus("denied");
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } catch (err) {
      setLocStatus("unsupported");
    }
  };

  const fuel = FUELS.find((f) => f.id === fuelId);
  const stations = useMemo(
    () => buildStations({ city, coords }),
    [city, coords]
  );

  // sort by distance when we have real geolocation, otherwise by price
  const sorted = useMemo(() => {
    const arr = [...stations];
    if (coords) arr.sort((a, b) => a.distance - b.distance);
    else arr.sort((a, b) => a.prices[fuelId] - b.prices[fuelId]);
    return arr;
  }, [stations, coords, fuelId]);

  const byPrice = [...stations].sort((a, b) => a.prices[fuelId] - b.prices[fuelId]);
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

      {/* Decorative gradient blobs */}
      <div
        className="blob absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-30 blur-3xl pointer-events-none"
        style={{ background: "linear-gradient(135deg, #FF4D6D, #FFB020)" }}
      />
      <div
        className="blob absolute top-40 -left-32 w-80 h-80 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "linear-gradient(135deg, #3EA6FF, #00C896)", animationDelay: "2s" }}
      />

      {/* Hero */}
      <header className="relative max-w-3xl mx-auto px-6 md:px-12 pt-14 pb-8">
        <div className="inline-flex items-center gap-1.5 bg-white rounded-full px-3 py-1.5 text-xs font-semibold text-[#8A7B92] mb-5 shadow-sm">
          <Zap size={12} className="text-[#FFB020]" style={{ animation: "wiggle 1.5s ease-in-out infinite" }} />
          Prix mis à jour en continu
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
        {/* Geolocation button */}
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
            Localisation refusée ou indisponible ici — tu peux chercher une
            ville manuellement ci-dessous à la place.
          </p>
        )}
        {locStatus === "unsupported" && (
          <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 rounded-xl px-4 py-2.5">
            La géolocalisation n'est pas disponible dans cet aperçu — elle
            fonctionnera normalement une fois le site publié en ligne.
          </p>
        )}
        {locStatus === "granted" && (
          <p className="text-sm text-[#00C896] bg-[#00C896]/10 rounded-xl px-4 py-2.5 flex items-center gap-1.5">
            <MapPin size={14} /> Position trouvée — stations triées par
            distance.
          </p>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-[#F0EAE2]" />
          <span className="text-xs font-semibold text-[#C4B8C9] uppercase tracking-wide">
            ou
          </span>
          <div className="h-px flex-1 bg-[#F0EAE2]" />
        </div>

        {/* Location input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCoords(null);
            setLocStatus("idle");
            setCity(inputCity.trim() || "Lyon");
          }}
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
            className="text-sm font-bold text-white px-4 py-2 rounded-xl shrink-0 transition-transform hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(135deg, #FF4D6D, #FF8A3D)" }}
          >
            C'est parti
          </button>
        </form>

        {/* Fuel selector */}
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

        {/* Savings banner */}
        {cheapest && savingsEuros > 0.01 && (
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
              en choisissant bien ta station {coords ? "autour de toi" : `à ${city}`} 🎉
            </span>
          </div>
        )}

        {/* Station list */}
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
          Prix simulés pour la démo — version réelle branchée sur les données
          ouvertes du gouvernement français, actualisées toutes les 10 min. ⛽
        </p>
      </footer>
    </div>
  );
}
