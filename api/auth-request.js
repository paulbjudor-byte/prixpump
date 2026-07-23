// Sends a "magic link" sign-in email — no password to manage. The link is
// valid for 15 minutes and can only be used once.
import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { randomBytes } from "crypto";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body || {};
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Email invalide" });
  }

  const token = randomBytes(24).toString("hex");
  await kv.set(`magic:${token}`, email.toLowerCase().trim(), { ex: 900 }); // 15 min

  const link = `${process.env.SITE_URL}/api/auth-verify?token=${token}`;
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    await resend.emails.send({
      from: "Plein Futé <connexion@pleinfute.com>",
      to: email,
      subject: "Ton lien de connexion Plein Futé",
      html: `<p>Clique sur ce lien pour te connecter (valable 15 minutes) :</p><p><a href="${link}">${link}</a></p>`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Impossible d'envoyer l'email" });
  }

  res.status(200).json({ ok: true });
}
