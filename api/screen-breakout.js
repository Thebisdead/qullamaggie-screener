// api/screen-breakout.js — SETUP 1: BREAKOUT (LONG)
//
// Qullamaggie Breakout logic — completely standalone, no mixing with EP or Para Short
//
// CONDITIONS (all must pass):
//   1. ADR ≥ 4%  (stock has enough daily range to trade)
//   2. EMA10 > EMA21 > EMA50  AND  EMA10 sloping up  (multi-week bull trend)
//   3. Stock had a big surge ≥30% within any 40-day window in the past 100 bars
//   4. Price has PULLED BACK from that surge high  (between -3% and -50%)
//   5. EMA10/EMA21/AVWAP converge into a tight key zone
//   6. Current price is INSIDE that key zone  (the entry trigger zone)
//
// ENTRY: buy as price reclaims / bounces off the key zone
// STOP:  below key zone low
// EXIT:  trail with EMA10; partial at 3R after 3-5 days

export const config = { maxDuration: 60 };

import {
  fetchDaily, fetchWeekly, calcEma, calcADR, calcVolSurge, calcAvwap,
  weeklyTrendUp, pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

// ── Breakout screener logic ───────────────────────────────────────────────────
async function screenBreakout(ticker, sector) {
  try {
    const [dailyData, weekly] = await Promise.all([fetchDaily(ticker), fetchWeekly(ticker)]);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 60 || !price || price < 2) return null;

    // ── CONDITION 1: ADR ≥ 4% ─────────────────────────────────────────────────
    const adr = +calcADR(bars).toFixed(1);
    if (adr < 4) return null;

    const closes = bars.map(d => d.c);
    const n = closes.length - 1;

    // ── CONDITION 2: EMA10 > EMA21 > EMA50, EMA10 sloping up ─────────────────
    const e10arr = calcEma(closes, 10);
    const e21arr = calcEma(closes, 21);
    const e50arr = calcEma(closes, 50);
    const ema10 = e10arr[n], ema21 = e21arr[n], ema50 = e50arr[n];
    if (!ema10 || !ema21 || !ema50) return null;
    if (!(ema10 > ema21 && ema21 > ema50)) return null;
    // EMA10 must be higher than it was 5 bars ago (sloping up)
    if (!e10arr[n - 5] || ema10 <= e10arr[n - 5]) return null;

    // ── CONDITION 3: Big prior surge ≥30% in last 100 bars ───────────────────
    // Look for any 40-day window where low-to-high move ≥ 30%
    // Exclude last 5 bars (those would be current consolidation)
    const search = bars.slice(-100, -5);
    let bestMove = 0, surgeHigh = 0;
    for (let i = 0; i < search.length - 5; i++) {
      const lo = search[i].l;
      for (let j = i + 5; j < Math.min(i + 40, search.length); j++) {
        const mv = lo > 0 ? (search[j].h - lo) / lo : 0;
        if (mv > bestMove) { bestMove = mv; surgeHigh = search[j].h; }
      }
    }
    if (bestMove < 0.30) return null; // no qualifying surge found

    // ── CONDITION 4: Price has pulled back from surge high ────────────────────
    // Must be below surge high (has already had its big run)
    // Pullback range: -3% to -50% from surge high
    if (surgeHigh <= 0) return null;
    const pullbackPct = (price - surgeHigh) / surgeHigh * 100;
    if (pullbackPct >= 0) return null;   // still at/above surge high = still running
    if (pullbackPct < -50) return null;  // too far below = broken down

    // ── CONDITION 5 & 6: EMA10/EMA21/AVWAP key zone + price inside it ────────
    const avwap = +calcAvwap(bars).toFixed(2);
    const kzTop = +Math.max(ema10, ema21, avwap).toFixed(2);
    const kzBot = +Math.min(ema10, ema21, avwap).toFixed(2);
    const kzWidth = kzTop > 0 ? +((kzTop - kzBot) / kzTop * 100).toFixed(1) : 99;

    // Price must be inside the zone (tolerance: 2% below bot, 2% above top)
    if (price < kzBot * 0.98) return null;  // below the zone = broke down
    if (price > kzTop * 1.02) return null;  // above the zone = already extended

    // ── Bonus conditions (improve score, don't gate) ──────────────────────────
    // Consolidation: recent 20-bar range < 20%
    const recent20 = bars.slice(-20);
    const rHi = Math.max(...recent20.map(d => d.h));
    const rLo = Math.min(...recent20.map(d => d.l));
    const consolRange = rLo > 0 ? +((rHi - rLo) / rLo * 100).toFixed(1) : 99;
    const isConsolidating = consolRange < 20;

    const weeklyUp = weeklyTrendUp(weekly);
    const volSurge = +calcVolSurge(bars).toFixed(2);
    const chg1m = n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0;
    const chg3m = n >= 66 ? +(((price / closes[n - 66]) - 1) * 100).toFixed(1) : 0;
    const chg1d = prevClose > 0 ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    // Base 60 (already passed all hard filters)
    let score = 60;
    if (kzWidth < 4)  score += 15; // tight convergence — ideal entry
    else if (kzWidth < 8) score += 8;
    if (isConsolidating) score += 10; // sideways pattern forming
    if (weeklyUp)        score += 5;  // weekly trend also up
    if (adr >= 8)        score += 5;  // high ADR = more volatile = bigger moves
    else if (adr >= 5)   score += 3;
    if (pullbackPct >= -25 && pullbackPct <= -5) score += 5; // sweet spot pullback
    if (volSurge >= 1.5) score += 5; // some volume pickup on the setup day
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan ────────────────────────────────────────────────────────────
    // Stop: just below key zone bottom
    const suggestedSL = +(kzBot * 0.98).toFixed(2);
    const slDist = price - suggestedSL;
    const slPct = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    const tp1 = +(price + 3 * slDist).toFixed(2); // 3R target
    const tp2 = +(price + 5 * slDist).toFixed(2); // 5R target
    // Trail: EMA10 after partial exit at 3R

    return {
      ticker, sector, setup: 'Breakout', direction: 'LONG', score,
      price: +price.toFixed(2), chg1d, chg1m, chg3m,
      adr, volSurge,
      ema10: +ema10.toFixed(2), ema21: +ema21.toFixed(2), ema50: +ema50.toFixed(2),
      avwap,
      keyZoneBot: kzBot, keyZoneTop: kzTop, keyZoneWidth: kzWidth,
      surgeMovePct: +(bestMove * 100).toFixed(1),
      pullbackPct: +pullbackPct.toFixed(1),
      isConsolidating, consolRange,
      weeklyUp,
      // Trade plan
      suggestedSL, slPct, tp1, tp2,
      trailNote: `Trail with EMA10 ($${+ema10.toFixed(2)}). Sell 40% at 3R, hold rest.`,
    };
  } catch { return null; }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const [sp500Res, nasdaqRes] = await Promise.allSettled([fetchSP500(), fetchNASDAQ()]);
    const sp500  = sp500Res.status  === "fulfilled" ? sp500Res.value  : [];
    const nasdaq = nasdaqRes.status === "fulfilled" ? nasdaqRes.value : [];
    const seen = new Set();
    const pairs = [];
    for (const t of [...THEMATIC, ...sp500, ...nasdaq]) {
      if (!seen.has(t)) { seen.add(t); pairs.push({ t, s: SECTOR_HINTS[t] ?? "美股" }); }
    }
    const tasks = pairs.map(({ t, s }) => () => screenBreakout(t, s));
    const settled = await pLimit(tasks, 12);
    const data = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'Breakout', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
