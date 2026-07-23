// Returns the current logged-in user's info (email, premium status, saved
// favorites) based on their session cookie. Returns { loggedIn: false } if
// no valid session — this is not an error, just "not logged in".
import { Redis } from "@upstash/redis";
import { parse } from "cookie";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  const cookies = parse(req.headers.cookie || "");
  const sessionId = cookies.pf_session;
  if (!sessionId) return res.status(200).json({ loggedIn: false });

  const email = await kv.get(`session:${sessionId}`);
  if (!email) return res.status(200).json({ loggedIn: false });

  const isPremium = await kv.sismember("premium_subscribers", email);
  const raw = await kv.get(`favorites:${email}`);
  const favorites = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : { stationIds: [], fuelId: "gazole" };

  res.status(200).json({ loggedIn: true, email, isPremium: !!isPremium, favorites });
}
