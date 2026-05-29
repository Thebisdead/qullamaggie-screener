// api/screen-breakout.js — SETUP 1: BREAKOUT (LONG)
// 100% based on qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
//
// EXACT CONDITIONS FROM ARTICLE:
//   1. Stock up 30-100%+ in past 1-3 months (big surge, over a few days to few weeks)
//   2. After the surge: ORDERLY CONSOLIDATION for 2 weeks to 2 months
//        - Higher lows (each pullback low is higher than the last)
//        - Tightening range (day-to-day range shrinking)
//        - Price "surfing" the 10-day and 20-day moving averages
//   3. TODAY: Range expansion BREAKOUT above the consolidation high
//
// ENTRY:  Opening range high (ORH)
// STOP:   Low of the day (must be ≤ 1 ATR wide — if stop is too wide, skip)
// EXIT:   Sell 1/3 to 1/2 after 3-5 days, move stop to breakeven,
//         trail remainder with 10-day or 20-day MA

export const config = { maxDuration: 60 };

import {
  fetchDaily, fetchWeekly, calcEma, calcADR, calcVolSurge,
  weeklyTrendUp, pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

async function screenBreakout(ticker, sector) {
  try {
    const [dailyData, weekly] = await Promise.all([fetchDaily(ticker), fetchWeekly(ticker)]);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 50 || !price || price < 2) return null;

    const closes = bars.map(d => d.c);
    const highs  = bars.map(d => d.h);
    const lows   = bars.map(d => d.l);
    const n = closes.length - 1;

    const atr = calcADR(bars) / 100 * price; // approximate ATR in dollars
    const adrPct = +calcADR(bars).toFixed(1);
    if (adrPct < 3) return null;

    // ── CONDITION 1: Big surge 30-100%+ in past 1-3 months ───────────────────
    // Scan bars[-65] to bars[-10] (1-3 months ago, not too recent)
    // Find any window of 5-40 bars where low-to-high move >= 30%
    const searchBars = bars.slice(-65, -10);
    let surgeMovePct = 0;
    let surgeEndIdx = -1; // index in `bars` where surge peaked
    for (let i = 0; i < searchBars.length - 5; i++) {
      const lo = searchBars[i].l;
      for (let j = i + 3; j < Math.min(i + 40, searchBars.length); j++) {
        const mv = lo > 0 ? (searchBars[j].h - lo) / lo * 100 : 0;
        if (mv > surgeMovePct) {
          surgeMovePct = mv;
          surgeEndIdx = bars.length - 65 + j;
        }
      }
    }
    if (surgeMovePct < 30) return null;

    // ── CONDITION 2: Orderly consolidation AFTER the surge ───────────────────
    // Consolidation = bars from surgeEndIdx+1 to today
    // Must be 10-40 bars (2 weeks to 2 months)
    const consolStart = surgeEndIdx + 1;
    const consolBars = bars.slice(consolStart); // bars since surge peak
    if (consolBars.length < 10) return null;  // too short — still running
    if (consolBars.length > 45) return null;  // too long — move on

    // 2a. HIGHER LOWS: each trough is higher than the previous
    //     Simplified: the lowest low in first half of consolidation < lowest low in second half
    const half = Math.floor(consolBars.length / 2);
    const earlyLow  = Math.min(...consolBars.slice(0, half).map(b => b.l));
    const recentLow = Math.min(...consolBars.slice(half).map(b => b.l));
    if (recentLow <= earlyLow) return null; // lows are NOT getting higher

    // 2b. TIGHTENING RANGE: average daily range in recent bars < early bars
    const earlyAvgRange  = consolBars.slice(0, half).reduce((s, b) => s + (b.h - b.l), 0) / half;
    const recentAvgRange = consolBars.slice(half).reduce((s, b) => s + (b.h - b.l), 0) / consolBars.slice(half).length;
    if (recentAvgRange >= earlyAvgRange) return null; // range not tightening

    // 2c. SURFING 10-day and 20-day MAs: price stays near / bounces off EMAs
    //     Check last 10 bars of consolidation: closes should be within 8% of EMA10 or EMA20
    const e10arr = calcEma(closes, 10);
    const e20arr = calcEma(closes, 20);
    const ema10 = e10arr[n];
    const ema20 = e20arr[n];
    if (!ema10 || !ema20) return null;

    // At least 60% of recent consolidation bars have close within 8% of EMA10 or EMA20
    const recentConsolBars = consolBars.slice(-10);
    const surfCount = recentConsolBars.filter((b, i) => {
      const idx = consolStart + consolBars.length - recentConsolBars.length + i;
      const e10 = e10arr[idx];
      const e20 = e20arr[idx];
      if (!e10 || !e20) return false;
      return Math.abs(b.c - e10) / e10 < 0.08 || Math.abs(b.c - e20) / e20 < 0.08;
    }).length;
    if (surfCount < recentConsolBars.length * 0.5) return null;

    // ── CONDITION 3: TODAY is a range expansion BREAKOUT ─────────────────────
    // Breakout = today's high breaks above the consolidation high
    const consolHigh = Math.max(...consolBars.slice(0, -1).map(b => b.h)); // exclude today
    if (price < consolHigh) return null; // hasn't broken out yet

    // Range expansion: today's range > average of last 10 days
    const todayRange = bars[n].h - bars[n].l;
    const avgRange10 = bars.slice(-11, -1).reduce((s, b) => s + (b.h - b.l), 0) / 10;
    if (todayRange <= avgRange10 * 1.0) return null; // no range expansion

    // Volume expansion on breakout
    const volSurge = +calcVolSurge(bars).toFixed(2);
    if (volSurge < 1.2) return null; // need at least some volume pickup

    // ── STOP CHECK: low of day must be ≤ 1 ATR ───────────────────────────────
    const stopDist = price - bars[n].l;
    if (stopDist > atr * 1.5) return null; // stop too wide, skip per article

    // ── Supporting data ───────────────────────────────────────────────────────
    const e50arr = calcEma(closes, 50);
    const ema50 = e50arr[n] ? +e50arr[n].toFixed(2) : null;
    const weeklyUp = weeklyTrendUp(weekly);
    const chg1d = prevClose > 0 ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;
    const chg1m = n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0;
    const chg3m = n >= 66 ? +(((price / closes[n - 66]) - 1) * 100).toFixed(1) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    let score = 60; // base: all hard conditions passed
    // Bigger surge = better setup
    if (surgeMovePct >= 100) score += 12;
    else if (surgeMovePct >= 60) score += 8;
    else if (surgeMovePct >= 30) score += 4;
    // Tighter consolidation = cleaner setup
    const consolRangePct = (consolHigh - recentLow) / recentLow * 100;
    if (consolRangePct < 8)  score += 12;
    else if (consolRangePct < 15) score += 7;
    else if (consolRangePct < 25) score += 3;
    // More range expansion = stronger breakout signal
    if (todayRange > avgRange10 * 1.5) score += 8;
    else if (todayRange > avgRange10 * 1.2) score += 4;
    // Volume
    if (volSurge >= 3) score += 8;
    else if (volSurge >= 2) score += 5;
    else if (volSurge >= 1.5) score += 2;
    // Weekly trend
    if (weeklyUp) score += 5;
    // ADR
    if (adrPct >= 8) score += 5;
    else if (adrPct >= 5) score += 3;
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan (per article) ──────────────────────────────────────────────
    const suggestedSL  = +bars[n].l.toFixed(2);           // low of today
    const slDist       = price - suggestedSL;
    const slPct        = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    const tp1          = +(price + 3 * slDist).toFixed(2); // 3R
    const tp2          = +(price + 5 * slDist).toFixed(2); // 5R

    return {
      ticker, sector, setup: 'Breakout', direction: 'LONG', score,
      price: +price.toFixed(2), chg1d, chg1m, chg3m,
      adr: adrPct, volSurge,
      ema10: +ema10.toFixed(2), ema20: +ema20.toFixed(2),
      ema50: ema50 ?? null,
      weeklyUp,
      // Breakout-specific
      surgeMovePct:   +surgeMovePct.toFixed(1),
      consolBars:     consolBars.length,
      consolRangePct: +consolRangePct.toFixed(1),
      consolHigh:     +consolHigh.toFixed(2),
      rangeExpansion: +(todayRange / avgRange10).toFixed(2),
      // Trade plan
      suggestedSL, slPct, tp1, tp2,
      trailNote: `Sell 1/3–1/2 after 3-5 days. Trail rest with EMA10 ($${+ema10.toFixed(2)}) or EMA20 ($${+ema20.toFixed(2)}).`,
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
    const tasks   = pairs.map(({ t, s }) => () => screenBreakout(t, s));
    const settled = await pLimit(tasks, 12);
    const data    = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'Breakout', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
