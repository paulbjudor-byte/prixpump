// Vercel Serverless Function — receives events from Stripe (payment
// succeeded, subscription cancelled, etc.) and stores subscriber info in
// Vercel KV so the notification cron job knows who to notify.
import Stripe from "stripe";
import { Redis } from "@upstash/redis";

const kv = Redis.fromEnv();

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    if (email) {
      await kv.sadd("premium_subscribers", email);
      // Each subscriber gets their own favorites list, keyed by email —
      // starts empty until the site pushes their favorite station ids here.
      await kv.sadd(`subscriber:${email}:status`, "active");
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customer = await stripe.customers.retrieve(subscription.customer);
    if (customer?.email) {
      await kv.srem("premium_subscribers", customer.email);
    }
  }

  res.status(200).json({ received: true });
}
