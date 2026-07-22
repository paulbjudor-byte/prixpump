// Vercel Serverless Function — lets a premium subscriber tell the backend
// which station ids to watch for price drops (their favorites, linked to
// their email so the cron job knows who to notify).
import { Redis } from "@upstash/redis";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, stationIds, fuelId } = req.body || {};
  if (!email || !Array.isArray(stationIds)) {
    return res.status(400).json({ error: "email et stationIds requis" });
  }

  const isSubscriber = await kv.sismember("premium_subscribers", email);
  if (!isSubscriber) {
    return res.status(403).json({ error: "Cet email n'a pas d'abonnement actif" });
  }

  await kv.set(`watch:${email}`, JSON.stringify({ stationIds, fuelId: fuelId || "gazole" }));
  res.status(200).json({ ok: true });
}
