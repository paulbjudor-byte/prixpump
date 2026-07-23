// Vercel Serverless Function — creates a Stripe Checkout session for the
// Plein Futé Premium subscription. Runs server-side only: the Stripe secret
// key never reaches the browser.
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { email } = req.body || {};

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email || undefined,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.SITE_URL}?premium=success`,
      cancel_url: `${process.env.SITE_URL}?premium=cancel`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossible de créer la session de paiement" });
  }
}
