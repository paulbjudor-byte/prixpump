// Vercel Cron Job (scheduled in vercel.json) — for every premium subscriber,
// checks whether the price at their watched stations has dropped since the
// last check, and emails them if so.
import { Redis } from "@upstash/redis";
import { Resend } from "resend";

const kv = Redis.fromEnv();

const CARBURANTS_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

async function fetchPricesForIds(ids) {
  if (ids.length === 0) return {};
  const idList = ids.map((id) => `'${id}'`).join(",");
  const url = `${CARBURANTS_API}?where=${encodeURIComponent(`id in (${idList})`)}&limit=${ids.length}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const data = await res.json();
  const map = {};
  (data.results || []).forEach((r) => {
    map[String(r.id)] = {
      address: r.adresse,
      ville: r.ville,
      gazole: r.gazole_prix,
      sp95: r.sp95_prix,
      e10: r.e10_prix,
      sp98: r.sp98_prix,
      e85: r.e85_prix,
    };
  });
  return map;
}

export default async function handler(req, res) {
  // Only Vercel Cron (or someone with the secret) may trigger this
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const subscribers = await kv.smembers("premium_subscribers");
  let notified = 0;

  for (const email of subscribers) {
    const raw = await kv.get(`favorites:${email}`);
    if (!raw) continue;
    const { stationIds, fuelId } = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!stationIds?.length) continue;

    const prices = await fetchPricesForIds(stationIds);
    const drops = [];

    for (const id of stationIds) {
      const current = prices[id]?.[fuelId];
      if (current == null) continue;
      const lastKey = `lastprice:${id}:${fuelId}`;
      const last = await kv.get(lastKey);
      if (last != null && current < Number(last)) {
        drops.push({ id, address: prices[id].address, ville: prices[id].ville, from: last, to: current });
      }
      await kv.set(lastKey, current);
    }

    if (drops.length > 0) {
      const list = drops
        .map((d) => `${d.address} (${d.ville}) : ${d.from} € → ${d.to} €`)
        .join("<br/>");
      await resend.emails.send({
        from: "Plein Futé <notifications@prixfute.com>",
        to: email,
        subject: "⛽ Le prix a baissé dans une de tes stations favorites",
        html: `<p>Bonne nouvelle :</p><p>${list}</p>`,
      });
      notified++;
    }
  }

  res.status(200).json({ checked: subscribers.length, notified });
}
