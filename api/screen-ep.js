// api/screen-ep.js — SETUP 2: EPISODIC PIVOT (LONG)
// 100% based on qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
//
// EXACT CONDITIONS FROM ARTICLE:
//   1. Stock gaps up 10%+ on a fundamental catalyst (earnings, FDA, contract, etc.)
//   2. High volume — "many times the average daily volume in first 15-30 minutes"
//      (we use full-day volume vs 20-day average as proxy)
//   3. Stock has NOT been in a strong uptrend — ideally flat/sideways for past 3-6 months
//      (this distinguishes EP from a regular breakout)
//
// ENTRY:  Opening range high (ORH)
// STOP:   Low of the gap day
// TRAIL:  10-day or 20-day moving average

export const config = { maxDuration: 60 };

import {
  fetchDaily, calcEma, calcADR, calcVolSurge,
  pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

async function screenEP(ticker, sector) {
  try {
    const dailyData = await fetchDaily(ticker);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 70 || !price || price < 2) return null;

    // ── CONDITION 1: Gap up 10%+ (open vs previous close) ────────────────────
    // Gap = today's open relative to yesterday's close
    // We use prevClose (yesterday's close) vs today's price as the best daily proxy
    if (!prevClose || prevClose <= 0) return null;
    const gapPct = (price - prevClose) / prevClose * 100;
    if (gapPct < 10) return null;

    // ── CONDITION 2: High volume — many times average ─────────────────────────
    // Article says "many times" — we require at least 2x, ideally 3x+
    const volHistory = bars.slice(-21, -1).filter(b => b.v > 0);
    if (volHistory.length < 10) return null;
    const avgVol   = volHistory.reduce((s, b) => s + b.v, 0) / volHistory.length;
    const todayVol = bars.at(-1).v;
    const volRatio = avgVol > 0 ? todayVol / avgVol : 0;
    if (volRatio < 2) return null;

    // ── CONDITION 3: Stock was flat/sideways for past 3-6 months (neglected) ──
    // Take bars[-126] to bars[-2] (up to 6 months before today)
    // The stock should NOT have been in a strong uptrend
    // We measure: what was the total gain/loss over the prior 3-6 months?
    const prior6m = bars.slice(-127, -1);
    const prior3m = bars.slice(-67, -1);
    if (prior3m.length < 30) return null;

    // Check 3-month performance — should be flat/sideways (not already running)
    const start3m = prior3m[0].c;
    const end3m   = prior3m[prior3m.length - 1].c;
    const perf3m  = start3m > 0 ? (end3m - start3m) / start3m * 100 : 0;

    // Also check 6-month if available
    const start6m = prior6m.length > 60 ? prior6m[0].c : null;
    const end6m   = prior6m.length > 60 ? prior6m[prior6m.length - 1].c : null;
    const perf6m  = start6m && start6m > 0 ? (end6m - start6m) / start6m * 100 : perf3m;

    // Stock should have been going sideways — not up 50%+ already
    // Use the milder of 3m/6m as the check
    const priorPerf = Math.max(perf3m, perf6m);
    if (priorPerf > 40) return null; // already had a big run — not a true EP

    // ── Supporting data ───────────────────────────────────────────────────────
    const closes = bars.map(d => d.c);
    const n = closes.length - 1;
    const e10arr = calcEma(closes, 10);
    const e20arr = calcEma(closes, 20);
    const ema10  = e10arr[n] ? +e10arr[n].toFixed(2) : null;
    const ema20  = e20arr[n] ? +e20arr[n].toFixed(2) : null;
    const adrPct = +calcADR(bars).toFixed(1);
    const chg1m  = n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    let score = 60;
    // Bigger gap = stronger catalyst signal
    if (gapPct >= 30)      score += 20;
    else if (gapPct >= 20) score += 14;
    else if (gapPct >= 15) score += 9;
    else if (gapPct >= 10) score += 5;
    // Higher volume = stronger institutional conviction
    if (volRatio >= 8)      score += 15;
    else if (volRatio >= 5) score += 10;
    else if (volRatio >= 3) score += 6;
    else if (volRatio >= 2) score += 3;
    // Flatter prior = cleaner EP (more "surprise" to the market)
    if (Math.abs(priorPerf) < 5)  score += 10; // totally flat
    else if (Math.abs(priorPerf) < 15) score += 6;
    else if (Math.abs(priorPerf) < 30) score += 3;
    // ADR
    if (adrPct >= 6) score += 5;
    else if (adrPct >= 4) score += 3;
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan (per article) ──────────────────────────────────────────────
    const todayLow    = +bars.at(-1).l.toFixed(2);
    const suggestedSL = +(todayLow * 0.995).toFixed(2); // just below today's low
    const slDist      = price - suggestedSL;
    const slPct       = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    const tp1         = +(price + 3 * slDist).toFixed(2);
    const tp2         = +(price + 5 * slDist).toFixed(2);

    return {
      ticker, sector, setup: 'EP', direction: 'LONG', score,
      price: +price.toFixed(2),
      chg1d: +gapPct.toFixed(2),
      chg1m,
      adr: adrPct,
      // EP-specific
      gapPct:    +gapPct.toFixed(1),
      volRatio:  +volRatio.toFixed(1),
      todayVol:  Math.round(todayVol),
      avgVol:    Math.round(avgVol),
      priorPerf3m: +perf3m.toFixed(1),
      priorPerf6m: +perf6m.toFixed(1),
      todayLow,
      ema10, ema20,
      // Trade plan
      suggestedSL, slPct, tp1, tp2,
      trailNote: `Stop = today low $${suggestedSL}. Sell 1/3–1/2 after 3-5 days. Trail rest with EMA10/EMA20.`,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const [sp500Res, nasdaqRes] = await Promise.allSettled([fetchSP500(), fetchNASDAQ()]);
    const sp500  = sp500Res.status  === 'fulfilled' ? sp500Res.value  : [];
    const nasdaq = nasdaqRes.status === 'fulfilled' ? nasdaqRes.value : [];
    const seen = new Set();
    const pairs = [];
    for (const t of [...THEMATIC, ...sp500, ...nasdaq]) {
      if (!seen.has(t)) { seen.add(t); pairs.push({ t, s: SECTOR_HINTS[t] ?? '美股' }); }
    }
    const tasks   = pairs.map(({ t, s }) => () => screenEP(t, s));
    const settled = await pLimit(tasks, 12);
    const data    = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'EP', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
