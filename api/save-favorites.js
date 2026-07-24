// Saves a logged-in user's favorite stations, their optional custom price
// alert threshold per station, and their fill size (used to estimate
// savings). Identity comes from the session cookie, never the request body.
import { Redis } from "@upstash/redis";
import { parse } from "cookie";

const kv = Redis.fromEnv();
const FREE_FAVORITES_LIMIT = 3;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = parse(req.headers.cookie || "");
  const sessionId = cookies.pf_session;
  if (!sessionId) return res.status(401).json({ error: "Non connecté" });

  const email = await kv.get(`session:${sessionId}`);
  if (!email) return res.status(401).json({ error: "Session expirée" });

  const { stations, fuelId, fillLiters } = req.body || {};
  if (!Array.isArray(stations)) {
    return res.status(400).json({ error: "stations requis" });
  }

  const isPremium = await kv.sismember("premium_subscribers", email);
  if (!isPremium && stations.length > FREE_FAVORITES_LIMIT) {
    return res.status(403).json({
      error: `Limite de ${FREE_FAVORITES_LIMIT} favoris atteinte en compte gratuit`,
      limit: FREE_FAVORITES_LIMIT,
    });
  }

  // Non-premium accounts can't have per-station price thresholds
  const cleanStations = stations.map((s) => ({
    id: s.id,
    threshold: isPremium ? (s.threshold ?? null) : null,
  }));

  await kv.set(
    `favorites:${email}`,
    JSON.stringify({ stations: cleanStations, fuelId: fuelId || "gazole", fillLiters: fillLiters || 40 })
  );
  res.status(200).json({ ok: true });
}
