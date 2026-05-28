// api/screen-parabolic.js — SETUP 3: PARABOLIC SHORT (SHORT)
//
// Qullamaggie Parabolic Short logic — completely standalone, SHORT ONLY
// Nothing in common with Breakout or EP entry logic.
//
// The core idea: a stock has gone PARABOLIC — straight up in a near-vertical
// line for days/weeks. These moves ALWAYS end violently. The short is entered
// when the stock shows the FIRST sign of exhaustion/reversal.
//
// CONDITIONS (all must pass):
//   1. Stock up ≥ 100% in last 3 months OR ≥ 60% in last 1 month
//      (the parabolic run — must be extreme)
//   2. At least 3 CONSECUTIVE higher closes (the climax is still running)
//   3. Price is ≥ 30% extended above EMA50 (far from any natural support)
//   4. ADR ≥ 5% (needs volatility for meaningful short move)
//   5. TODAY shows an exhaustion signal:
//        - Today's close < today's open (bearish candle)  OR
//        - Today's range is biggest in last 10 days (blow-off top volume expansion)
//
// ENTRY:  short into the first red day / opening range LOW of reversal day
// STOP:   high of the day (or recent 3-day high)
// EXIT:   cover at EMA50 (the natural mean reversion target)

export const config = { maxDuration: 60 };

import {
  fetchDaily, fetchWeekly, calcEma, calcADR, calcVolSurge,
  pLimit, fetchSP500, fetchNASDAQ, THEMATIC, SECTOR_HINTS,
} from './_shared.js';

// ── Parabolic Short screener logic ────────────────────────────────────────────
async function screenParabolic(ticker, sector) {
  try {
    const dailyData = await fetchDaily(ticker);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 60 || !price || price < 2) return null;

    const closes = bars.map(d => d.c);
    const n = closes.length - 1;

    // ── CONDITION 1: Extreme parabolic run ────────────────────────────────────
    // Check both 1-month and 3-month performance
    const c22 = n >= 22 ? closes[n - 22] : null; // ~1 month ago
    const c66 = n >= 66 ? closes[n - 66] : null; // ~3 months ago
    const perf1m = c22 && c22 > 0 ? (price - c22) / c22 * 100 : 0;
    const perf3m = c66 && c66 > 0 ? (price - c66) / c66 * 100 : 0;
    // Must be ≥60% in 1 month OR ≥100% in 3 months
    if (perf1m < 60 && perf3m < 100) return null;

    // ── CONDITION 2: ≥ 3 consecutive higher closes ────────────────────────────
    // Count from today backwards
    let consecUp = 0;
    for (let i = n; i >= 1; i--) {
      if (closes[i] > closes[i - 1]) consecUp++;
      else break;
    }
    if (consecUp < 3) return null;

    // ── CONDITION 3: Extended ≥ 30% above EMA50 ───────────────────────────────
    const e50arr = calcEma(closes, 50);
    const ema50 = e50arr[n];
    if (!ema50 || ema50 <= 0) return null;
    const extAboveEma50 = (price - ema50) / ema50 * 100;
    if (extAboveEma50 < 30) return null;

    // ── CONDITION 4: ADR ≥ 5% ─────────────────────────────────────────────────
    const adr = +calcADR(bars).toFixed(1);
    if (adr < 5) return null;

    // ── CONDITION 5: Exhaustion signal today ─────────────────────────────────
    const todayBar = bars[n];
    const todayRange = todayBar.h - todayBar.l;
    const bearishCandle = todayBar.c < todayBar.h - (todayBar.h - todayBar.l) * 0.4; // close in lower 40%
    // Blow-off: today's range > any of last 9 days (climactic volume expansion)
    const recentRanges = bars.slice(-10, -1).map(b => b.h - b.l);
    const maxRecentRange = Math.max(...recentRanges);
    const blowOffTop = todayRange > maxRecentRange * 1.1;
    if (!bearishCandle && !blowOffTop) return null;

    // ── Supporting data ───────────────────────────────────────────────────────
    const e10arr = calcEma(closes, 10);
    const e21arr = calcEma(closes, 21);
    const ema10 = e10arr[n] ? +e10arr[n].toFixed(2) : null;
    const ema21 = e21arr[n] ? +e21arr[n].toFixed(2) : null;
    const volSurge = +calcVolSurge(bars).toFixed(2);
    const chg1d = prevClose > 0 ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

    // ── Score ─────────────────────────────────────────────────────────────────
    // Base 60 (all hard conditions passed)
    let score = 60;
    // More extreme run = more violent eventual reversal
    if (perf1m >= 200 || perf3m >= 300) score += 20;
    else if (perf1m >= 100 || perf3m >= 200) score += 15;
    else if (perf1m >= 60 || perf3m >= 100)  score += 8;
    // More extended = more rubber band tension
    if (extAboveEma50 >= 100) score += 15;
    else if (extAboveEma50 >= 60)  score += 10;
    else if (extAboveEma50 >= 30)  score += 5;
    // More consecutive up days = more climactic
    if (consecUp >= 7) score += 10;
    else if (consecUp >= 5) score += 7;
    else if (consecUp >= 3) score += 4;
    // Both exhaustion signals firing = highest conviction
    if (bearishCandle && blowOffTop) score += 10;
    else if (bearishCandle) score += 5;
    else if (blowOffTop) score += 5;
    score = Math.min(score, 100);
    if (score < 60) return null;

    // ── Trade plan ────────────────────────────────────────────────────────────
    // Stop: HIGH of the day (short is wrong if it makes new HOD)
    // Use 3-day high for safety
    const recentHigh = Math.max(...bars.slice(-3).map(b => b.h));
    const suggestedSL = +(recentHigh * 1.005).toFixed(2); // 0.5% above 3-day high
    const slDist = suggestedSL - price;
    const slPct = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    // Target: EMA50 (natural mean reversion target for parabolic)
    const tp1 = +ema50.toFixed(2);
    // Extended target: EMA21
    const tp2 = ema21 ? +ema21.toFixed(2) : +(price * 0.70).toFixed(2);

    return {
      ticker, sector, setup: 'Parabolic Short', direction: 'SHORT', score,
      price: +price.toFixed(2), chg1d,
      chg1m: +perf1m.toFixed(1),
      chg3m: +perf3m.toFixed(1),
      adr, volSurge,
      ema10, ema21, ema50: +ema50.toFixed(2),
      // Parabolic-specific
      perf1m: +perf1m.toFixed(1),
      perf3m: +perf3m.toFixed(1),
      consecUp,
      extAboveEma50: +extAboveEma50.toFixed(1),
      bearishCandle,
      blowOffTop,
      todayHigh: +todayBar.h.toFixed(2),
      todayLow:  +todayBar.l.toFixed(2),
      recentHigh: +recentHigh.toFixed(2),
      // Trade plan (SHORT)
      suggestedSL, slPct,
      tp1, // EMA50 = primary cover target
      tp2, // EMA21 = extended cover target
      trailNote: `SHORT. Cover 50% at EMA50 ($${+ema50.toFixed(2)}). Trail rest with EMA21. Stop = $${suggestedSL}.`,
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
    const tasks = pairs.map(({ t, s }) => () => screenParabolic(t, s));
    const settled = await pLimit(tasks, 12);
    const data = settled.filter(Boolean).sort((a, b) => b.score - a.score);
    res.status(200).json({ data, total: pairs.length, setup: 'Parabolic Short', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0 });
  }
}
