// Vercel Cron Job (scheduled in vercel.json, runs once a day) — for every
// premium subscriber: checks their watched stations for a price drop (either
// "any drop" or hitting their custom target price), emails them if so,
// tracks estimated cumulative savings, and snapshots today's price into the
// history log (this is also how price-history.js gets its data — it starts
// empty and builds up day by day, since no free provider offers real past
// fuel prices).
import { Redis } from "@upstash/redis";
import { Resend } from "resend";

const kv = Redis.fromEnv();

const CARBURANTS_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

const HISTORY_MAX_POINTS = 90;

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
  let historySnapshots = 0;

  for (const email of subscribers) {
    const raw = await kv.get(`favorites:${email}`);
    if (!raw) continue;
    const { stations, fuelId, fillLiters } = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!stations?.length) continue;

    const ids = stations.map((s) => s.id);
    const prices = await fetchPricesForIds(ids);
    const drops = [];

    for (const station of stations) {
      const { id, threshold } = station;
      const current = prices[id]?.[fuelId];
      if (current == null) continue;

      // --- Price history snapshot (once per station/fuel/day) ---
      const today = new Date().toISOString().slice(0, 10);
      const historyKey = `history:${id}:${fuelId}`;
      const lastSnapshotDay = await kv.get(`historyday:${id}:${fuelId}`);
      if (lastSnapshotDay !== today) {
        await kv.lpush(historyKey, JSON.stringify({ date: today, price: current }));
        await kv.ltrim(historyKey, 0, HISTORY_MAX_POINTS - 1);
        await kv.set(`historyday:${id}:${fuelId}`, today);
        historySnapshots++;
      }

      // --- Drop / threshold detection ---
      const lastKey = `lastprice:${id}:${fuelId}`;
      const last = await kv.get(lastKey);
      const lastNum = last != null ? Number(last) : null;

      let hit = false;
      let reason = "";
      if (threshold != null && current <= threshold) {
        // Only re-notify once the price has gone back above the threshold
        // and dropped below it again — avoids emailing every single day.
        const belowKey = `belowthreshold:${email}:${id}:${fuelId}`;
        const wasAlreadyBelow = await kv.get(belowKey);
        if (!wasAlreadyBelow) {
          hit = true;
          reason = `sous ton prix cible de ${threshold.toFixed(3)} €`;
        }
        await kv.set(belowKey, "1");
      } else if (threshold != null) {
        await kv.del(`belowthreshold:${email}:${id}:${fuelId}`);
      } else if (lastNum != null && current < lastNum) {
        hit = true;
        reason = "en baisse";
      }

      if (hit && lastNum != null) {
        const saved = Math.max(0, lastNum - current) * (fillLiters || 40);
        if (saved > 0) {
          await kv.incrbyfloat(`savings:${email}`, saved);
        }
        drops.push({
          id,
          address: prices[id].address,
          ville: prices[id].ville,
          from: lastNum,
          to: current,
          reason,
        });
      }

      await kv.set(lastKey, current);
    }

    if (drops.length > 0) {
      const list = drops
        .map((d) => `${d.address} (${d.ville}) — ${d.reason} : ${d.from.toFixed(3)} € → ${d.to.toFixed(3)} €`)
        .join("<br/>");
      await resend.emails.send({
        from: "Plein Futé <notifications@pleinfute.com>",
        to: email,
        subject: "⛽ Le prix a baissé dans une de tes stations favorites",
        html: `<p>Bonne nouvelle :</p><p>${list}</p>`,
      });
      notified++;
    }
  }

  res.status(200).json({ checked: subscribers.length, notified, historySnapshots });
}
