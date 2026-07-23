// Saves a logged-in user's favorite stations (and preferred fuel) so they
// sync across devices. Identity comes from the session cookie, never from
// the request body — a user can only ever update their own favorites.
import { Redis } from "@upstash/redis";
import { parse } from "cookie";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = parse(req.headers.cookie || "");
  const sessionId = cookies.pf_session;
  if (!sessionId) return res.status(401).json({ error: "Non connecté" });

  const email = await kv.get(`session:${sessionId}`);
  if (!email) return res.status(401).json({ error: "Session expirée" });

  const { stationIds, fuelId } = req.body || {};
  if (!Array.isArray(stationIds)) {
    return res.status(400).json({ error: "stationIds requis" });
  }

  await kv.set(`favorites:${email}`, JSON.stringify({ stationIds, fuelId: fuelId || "gazole" }));
  res.status(200).json({ ok: true });
}
