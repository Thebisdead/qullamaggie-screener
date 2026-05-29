// api/screen-parabolic.js — SETUP 3: PARABOLIC SHORT (SHORT)
// 100% based on qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
//
// EXACT CONDITIONS FROM ARTICLE:
//   1. Stock up 50-100%+ in a matter of days or weeks (large cap)
//      OR 300-1000%+ for small caps
//      (parabolic move — near-vertical price action)
//   2. Up 3-5+ consecutive days
//
// ENTRY:  Short on opening range LOWS (ORLs of 1-min or 5-min bars)
//         OR first red 5-min candle
//         OR stock bounces to VWAP and fails
// STOP:   High of the day (or VWAP reclaim)
// TARGET: 10-day and 20-day moving averages (mean reversion)

export const config = { maxDuration: 60 };

import {
  fetchDaily, calcEma, calcADR, calcVolSurge,
  pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

async function screenParabolic(ticker, sector) {
  try {
    const dailyData = await fetchDaily(ticker);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 30 || !price || price < 1) return null;

    const closes = bars.map(d => d.c);
    const n = closes.length - 1;

    // ── CONDITION 1: Parabolic run — up 50-100%+ in days/weeks ───────────────
    // Article says "in a matter of days or weeks"
    // We check multiple windows: 5 days, 10 days, 20 days, 1 month
    // Large cap: need 50%+ in any of those windows
    // Small cap: 300%+ (we lower to 100%+ as daily data proxy for small caps)
    const windows = [5, 10, 15, 20];
    let bestRunPct = 0;
    let bestRunDays = 0;
    for (const w of windows) {
      if (n < w) continue;
      const base = closes[n - w];
      if (base > 0) {
        const runPct = (price - base) / base * 100;
        if (runPct > bestRunPct) { bestRunPct = runPct; bestRunDays = w; }
      }
    }
    // Must be at least 50%+ in one of these windows
    if (bestRunPct < 50) return null;

    // ── CONDITION 2: 3-5+ consecutive higher closes ───────────────────────────
    // Article explicitly says "up 3, 4, 5+ days in a row"
    let consecUp = 0;
    for (let i = n; i >= 1; i--) {
      if (closes[i] > closes[i - 1]) consecUp++;
      else break;
    }
    if (consecUp < 3) return null;

    // ── Supporting data ───────────────────────────────────────────────────────
    const e10arr = calcEma(closes, 10);
    const e20arr = calcEma(closes, 20);
    const ema10  = e10arr[n] ? +e10arr[n].toFixed(2) : null;
    const ema20  = e20arr[n] ? +e20arr[n].toFixed(2) : null;
    const adrPct = +calcADR(bars).toFixed(1);
    const volSurge = +calcVolSurge(bars).toFixed(2);
    const chg1d  = prevClose > 0 ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    let score = 60;
    // More extreme run = more violent eventual reversal
    if (bestRunPct >= 500)      score += 20;
    else if (bestRunPct >= 200) score += 16;
    else if (bestRunPct >= 100) score += 12;
    else if (bestRunPct >= 50)  score += 7;
    // More consecutive up days = more climactic / exhausted
    if (consecUp >= 8)      score += 15;
    else if (consecUp >= 6) score += 11;
    else if (consecUp >= 5) score += 8;
    else if (consecUp >= 4) score += 5;
    else if (consecUp >= 3) score += 3;
    // Faster run = more parabolic (same % in fewer days)
    if (bestRunDays <= 5)       score += 10;
    else if (bestRunDays <= 10) score += 6;
    else if (bestRunDays <= 15) score += 3;
    // ADR — needs volatility for the short to work
    if (adrPct >= 10) score += 5;
    else if (adrPct >= 6) score += 3;
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan (per article) ──────────────────────────────────────────────
    // Stop: high of the day
    const todayHigh   = +bars[n].h.toFixed(2);
    const suggestedSL = +(todayHigh * 1.005).toFixed(2); // 0.5% above HOD
    const slDist      = suggestedSL - price;
    const slPct       = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    // Targets: EMA10 and EMA20 (article explicitly says these are the targets)
    const tp1 = ema20 ?? +(price * 0.75).toFixed(2); // EMA20 = primary target
    const tp2 = ema10 ?? +(price * 0.80).toFixed(2); // EMA10 = secondary target

    return {
      ticker, sector, setup: 'Parabolic Short', direction: 'SHORT', score,
      price: +price.toFixed(2), chg1d,
      chg1m: n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0,
      adr: adrPct, volSurge,
      ema10, ema20,
      // Parabolic-specific
      bestRunPct:  +bestRunPct.toFixed(1),
      bestRunDays,
      consecUp,
      todayHigh,
      todayLow: +bars[n].l.toFixed(2),
      // Trade plan
      suggestedSL, slPct,
      tp1, // EMA20 — primary cover target per article
      tp2, // EMA10 — secondary cover target per article
      trailNote: `SHORT. Stop = HOD $${suggestedSL}. Cover at EMA20 ($${tp1}) and EMA10 ($${tp2}).`,
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
    const tasks   = pairs.map(({ t, s }) => () => screenParabolic(t, s));
    const settled = await pLimit(tasks, 12);
    const data    = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'Parabolic Short', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
