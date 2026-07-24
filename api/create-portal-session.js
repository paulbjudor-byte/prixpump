// Creates a Stripe Billing Portal session so a logged-in subscriber can
// manage or cancel their subscription themselves, without us building that
// UI ourselves — Stripe hosts it.
import Stripe from "stripe";
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

  const customerId = await kv.get(`stripe_customer:${email}`);
  if (!customerId) {
    return res.status(404).json({ error: "Aucun abonnement trouvé pour ce compte" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.SITE_URL,
    });
    res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossible d'ouvrir la gestion d'abonnement" });
  }
}
