// Returns the recorded price history for a station/fuel combo. History
// accumulates day by day (see check-price-drops.js) — it starts empty and
// grows over time, since no provider offers real historical fuel prices for
// free. Public endpoint, read-only.
import { Redis } from "@upstash/redis";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  const { stationId, fuelId } = req.query;
  if (!stationId || !fuelId) {
    return res.status(400).json({ error: "stationId et fuelId requis" });
  }

  const raw = await kv.lrange(`history:${stationId}:${fuelId}`, 0, -1);
  // stored newest-first (lpush) — reverse for chronological order
  const points = (raw || [])
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
    .reverse();

  res.status(200).json({ points });
}
