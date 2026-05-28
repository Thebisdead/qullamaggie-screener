// api/screen-ep.js — SETUP 2: EPISODIC PIVOT (LONG)
//
// Qullamaggie EP logic — completely standalone, no mixing with Breakout or Para Short
//
// The core idea: a NEGLECTED stock (flat/sideways for months) gets a
// FUNDAMENTAL CATALYST (earnings beat, FDA approval, new contract, etc.)
// causing a GAP UP on massive volume. This is the beginning of a new multi-week move.
//
// CONDITIONS (all must pass):
//   1. Today's move ≥ 10% (gap from prior close, or intraday change)
//   2. Today's volume ≥ 2× the 20-day average  (institutional buying)
//   3. Prior 3 months (66 bars) range was FLAT — stock was NEGLECTED
//      (high-to-low range of prior period < 30%)
//      This rules out stocks already in an uptrend — EP must come from nowhere
//   4. ADR ≥ 3%  (stock has enough volatility to produce meaningful moves)
//
// ENTRY: on the gap day itself, or opening range high of the gap day
// STOP:  low of the gap day
// EXIT:  sell partial after 3-5 days; trail remainder with EMA20

export const config = { maxDuration: 60 };

import {
  fetchDaily, fetchWeekly, calcEma, calcADR, calcVolSurge,
  pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

// ── EP screener logic ─────────────────────────────────────────────────────────
async function screenEP(ticker, sector) {
  try {
    const dailyData = await fetchDaily(ticker);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 70 || !price || price < 2) return null;

    // ── CONDITION 1: Today's move ≥ 10% ───────────────────────────────────────
    // Use prev close to today's price as the gap/move measure
    if (!prevClose || prevClose <= 0) return null;
    const todayMovePct = (price - prevClose) / prevClose * 100;
    if (todayMovePct < 10) return null;

    // ── CONDITION 2: Volume ≥ 2× 20-day average ───────────────────────────────
    // Average excludes today (use bars[-21] to bars[-2])
    const volHistory = bars.slice(-21, -1).filter(b => b.v > 0);
    if (volHistory.length < 5) return null;
    const avgVol = volHistory.reduce((s, b) => s + b.v, 0) / volHistory.length;
    const todayVol = bars.at(-1).v;
    const volRatio = avgVol > 0 ? todayVol / avgVol : 0;
    if (volRatio < 2) return null;

    // ── CONDITION 3: Prior 3 months was FLAT / NEGLECTED ─────────────────────
    // Take the 66 bars BEFORE today (i.e., bars[-67] to bars[-2])
    const prior3m = bars.slice(-67, -1);
    if (prior3m.length < 30) return null;
    const priorHigh = Math.max(...prior3m.map(b => b.h));
    const priorLow  = Math.min(...prior3m.map(b => b.l).filter(v => v > 0));
    if (priorLow <= 0) return null;
    const priorRange = (priorHigh - priorLow) / priorLow * 100;
    // If the stock was already running (range > 30%), it's not a true EP
    if (priorRange > 30) return null;

    // ── CONDITION 4: ADR ≥ 3% ─────────────────────────────────────────────────
    const adr = +calcADR(bars).toFixed(1);
    if (adr < 3) return null;

    // ── Supporting data ───────────────────────────────────────────────────────
    const closes = bars.map(d => d.c);
    const n = closes.length - 1;
    const e20arr = calcEma(closes, 20);
    const e50arr = calcEma(closes, 50);
    const ema20 = e20arr[n] ? +e20arr[n].toFixed(2) : null;
    const ema50 = e50arr[n] ? +e50arr[n].toFixed(2) : null;

    const chg1m = n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0;
    const chg3m = n >= 66 ? +(((price / closes[n - 66]) - 1) * 100).toFixed(1) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    // Base 60 (all hard conditions passed)
    let score = 60;
    // Bigger gap = stronger catalyst
    if (todayMovePct >= 25)      score += 20;
    else if (todayMovePct >= 15) score += 13;
    else if (todayMovePct >= 10) score += 7;
    // Higher volume = stronger institutional conviction
    if (volRatio >= 5)      score += 15;
    else if (volRatio >= 3) score += 10;
    else if (volRatio >= 2) score += 5;
    // Flatter prior = more "surprise" = cleaner EP
    if (priorRange < 10)      score += 10;
    else if (priorRange < 20) score += 5;
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan ────────────────────────────────────────────────────────────
    // Stop: low of today's gap bar
    const todayLow = bars.at(-1).l;
    const suggestedSL = +(todayLow * 0.99).toFixed(2); // just below today's low
    const slDist = price - suggestedSL;
    const slPct = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    const tp1 = +(price + 3 * slDist).toFixed(2);
    const tp2 = +(price + 5 * slDist).toFixed(2);

    return {
      ticker, sector, setup: 'EP', direction: 'LONG', score,
      price: +price.toFixed(2),
      chg1d: +todayMovePct.toFixed(2), // today's move IS the EP signal
      chg1m, chg3m,
      adr,
      volRatio: +volRatio.toFixed(1),
      todayVol: Math.round(todayVol),
      avgVol: Math.round(avgVol),
      ema20, ema50,
      // EP-specific
      gapPct: +todayMovePct.toFixed(1),
      priorRange: +priorRange.toFixed(1),
      todayLow: +todayLow.toFixed(2),
      // Trade plan
      suggestedSL, slPct, tp1, tp2,
      trailNote: `Stop = today low $${suggestedSL}. Sell 40% after 3-5 days. Trail rest with EMA20.`,
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
    const tasks = pairs.map(({ t, s }) => () => screenEP(t, s));
    const settled = await pLimit(tasks, 12);
    const data = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'EP', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
