// Verifies the magic link token, creates a session (30 days), sets an
// httpOnly cookie, and redirects back to the site — now logged in.
import { Redis } from "@upstash/redis";
import { serialize } from "cookie";
import { randomBytes } from "crypto";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send("Lien invalide");

  const email = await kv.get(`magic:${token}`);
  if (!email) {
    return res.status(400).send("Ce lien a expiré ou a déjà été utilisé. Redemande-en un nouveau.");
  }
  await kv.del(`magic:${token}`); // one-time use

  const sessionId = randomBytes(24).toString("hex");
  const THIRTY_DAYS = 60 * 60 * 24 * 30;
  await kv.set(`session:${sessionId}`, email, { ex: THIRTY_DAYS });

  res.setHeader(
    "Set-Cookie",
    serialize("pf_session", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: THIRTY_DAYS,
    })
  );
  res.writeHead(302, { Location: `${process.env.SITE_URL}?login=success` });
  res.end();
}
