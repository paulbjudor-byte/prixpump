import { Redis } from "@upstash/redis";
import { parse, serialize } from "cookie";

const kv = Redis.fromEnv();

export default async function handler(req, res) {
  const cookies = parse(req.headers.cookie || "");
  const sessionId = cookies.pf_session;
  if (sessionId) await kv.del(`session:${sessionId}`);

  res.setHeader(
    "Set-Cookie",
    serialize("pf_session", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 })
  );
  res.status(200).json({ ok: true });
}
