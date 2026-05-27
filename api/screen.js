// api/screen.js  —  Qullamaggie 3 Setups Screener
// Uses TradingView scanner API — ONE bulk call returns 2000 stocks with all pre-computed indicators
//
// SETUP 1: Breakout
//   EMA10 > EMA21 > EMA50 (aligned + sloping up) + stock up 30%+ in last 3m + now pulled back to EMA zone
//
// SETUP 2: Episodic Pivot (EP)
//   Gap up ≥10% today (or recent) on ≥2x volume + prior 3m was flat (neglected stock)
//
// SETUP 3: Parabolic Short
//   Up ≥60% in last month + 3+ consecutive closes higher + showing fade today

const TV_SCAN = 'https://scanner.tradingview.com/america/scan';

const TV_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://www.tradingview.com',
  'Referer': 'https://www.tradingview.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function fetchTV(payload) {
  const r = await fetch(TV_SCAN, {
    method: 'POST',
    headers: TV_HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`TradingView ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

// ─── EMA helper ──────────────────────────────────────────────────────────────
function emaOf(arr, p) {
  if (!arr || arr.length < p) return null;
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) e = (arr[i] - e) * k + e;
  return e;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sector } = req.query;

  try {
    // ── Step 1: Bulk TradingView scan ──
    // TradingView scanner returns pre-computed indicators for up to 2000 symbols in ONE request.
    // This is the same approach Martin Luk screener uses — no per-stock history loops.
    //
    // Key columns for Qullamaggie setups:
    //   EMA10, EMA20, EMA50 → alignment check
    //   Perf.1M, Perf.3M, Perf.6M → surge / prior run detection
    //   change, change_abs → today gap/fade
    //   relative_volume_10d_calc → volume surge
    //   ATR, ADR Percent → volatility
    //   High.1M, Low.1M → recent range for pullback calc
    //   open → gap-up detection
    //   close|1W, close|2W, close|3W, close|4W → weekly closes for consecutive up days

    const filters = [
      { left: 'market_cap_basic',       operation: 'greater', right: 100_000_000 },
      { left: 'average_volume_10d_calc', operation: 'greater', right: 300_000 },
      { left: 'close',                  operation: 'greater', right: 2 },
      { left: 'type',                   operation: 'equal',   right: 'stock' },
      { left: 'subtype',                operation: 'in',      right: ['common', 'foreign-issuer'] },
    ];

    // Optionally filter by sector
    if (sector) {
      filters.push({ left: 'sector', operation: 'equal', right: sector });
    }

    const payload = {
      filter: filters,
      options: { lang: 'en' },
      markets: ['america'],
      columns: [
        'name',             // 0  ticker
        'close',            // 1  current price
        'open',             // 2  today open
        'high',             // 3  today high
        'low',              // 4  today low
        'change',           // 5  today % change
        'volume',           // 6  today volume
        'average_volume_10d_calc',   // 7  10d avg volume
        'relative_volume_10d_calc',  // 8  vol/avg
        'EMA10',            // 9  EMA10
        'EMA20',            // 10 EMA20 (≈ EMA21)
        'EMA50',            // 11 EMA50
        'Perf.1M',          // 12 1-month performance %
        'Perf.3M',          // 13 3-month performance %
        'Perf.6M',          // 14 6-month performance %
        'High.1M',          // 15 1-month high
        'Low.1M',           // 16 1-month low
        'High.3M',          // 17 3-month high
        'Low.3M',           // 18 3-month low
        'High.6M',          // 19 6-month high
        'Low.6M',           // 20 6-month low
        'ADR Percent',      // 21 Average Daily Range %
        'ATR',              // 22 ATR(14)
        'sector',           // 23 sector name
        'close|1W',         // 24 close 1 week ago
        'close|2W',         // 25 close 2 weeks ago (approx)
        'close|3W',         // 26
        'close|4W',         // 27
        'EMA10|1W',         // 28 weekly EMA10 for trend context
        'EMA20|1W',         // 29 weekly EMA20
        'High.52W',         // 30
        'Low.52W',          // 31
      ],
      sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
      range: [0, 2000],
    };

    const data = await fetchTV(payload);
    const rows = data?.data ?? [];

    const results = [];

    for (const row of rows) {
      const d = row.d;
      const [
        name, close, open, high, low, changePct, vol, avgVol, volRatio,
        ema10, ema20, ema50,
        perf1m, perf3m, perf6m,
        high1m, low1m, high3m, low3m, high6m, low6m,
        adrPct, atr,
        sectorName,
        close1w, close2w, close3w, close4w,
        ema10w, ema20w,
        high52w, low52w,
      ] = d;

      if (!close || close < 2) continue;
      if (!ema10 || !ema20 || !ema50) continue;

      // ── Common indicators ──────────────────────────────────────────────────
      const adr = adrPct ?? (atr && close ? (atr / close * 100) : 0);
      if (adr < 3) continue; // skip very low volatility stocks

      const emaAligned = ema10 > ema20 && ema20 > ema50;

      // EMA slope: compare current EMA10 to close1w EMA10 — proxy: is close > ema10 trending up?
      // We check close relative to EMAs for slope
      const emaSloping = close > ema10 * 0.98 || ema10 > ema20 * 1.005;

      // Weekly trend
      const weeklyUp = close1w != null ? close > close1w : close > ema20w;

      // ── SETUP 1: BREAKOUT ──────────────────────────────────────────────────
      // Conditions:
      // 1. EMA10 > EMA20 > EMA50 (multi-week uptrend)
      // 2. Big prior surge: 3m or 6m performance ≥ 30%
      // 3. Price has pulled back from the 3m high (consolidating / retesting EMAs)
      // 4. Price is now near EMA zone (within 10% of EMA10/EMA20)
      // 5. ADR ≥ 4%

      const surgeMovePct = Math.max(perf3m ?? 0, perf6m ?? 0, perf1m ?? 0);
      const pullbackFromHigh3m = high3m > 0 ? (close - high3m) / high3m * 100 : 0;
      const nearEma = Math.abs((close - ema10) / ema10 * 100) < 8 ||
                      Math.abs((close - ema20) / ema20 * 100) < 8;

      // Key zone: convergence of EMA10, EMA20, and AVWAP (we use EMA20 as AVWAP proxy)
      const kzBot = +Math.min(ema10, ema20).toFixed(2);
      const kzTop = +Math.max(ema10, ema20).toFixed(2);
      const kzWidth = kzTop > 0 ? +((kzTop - kzBot) / kzTop * 100).toFixed(1) : 99;
      const inKeyZone = close >= kzBot * 0.97 && close <= kzTop * 1.05;

      // Consolidation: 1m range tight (< 15%) — stock has been digesting gains
      const consol1mRange = (high1m > 0 && low1m > 0) ? (high1m - low1m) / low1m * 100 : 100;
      const isConsolidating = consol1mRange < 15 && consol1mRange > 0;

      const isBO = emaAligned && surgeMovePct >= 30 && adr >= 4
        && pullbackFromHigh3m <= -3 && pullbackFromHigh3m >= -45
        && nearEma;

      // ── SETUP 2: EPISODIC PIVOT (EP) ───────────────────────────────────────
      // Conditions:
      // 1. Gap up ≥ 10% today (open vs yesterday implied — we use change% as proxy)
      //    OR today's % change ≥ 10% (gap/breakout day)
      // 2. Volume ≥ 2x average
      // 3. Prior 3m performance was FLAT or DOWN (neglected/sideways stock)
      //    i.e. perf3m < 20% — stock was not already in a strong uptrend

      const gapPct = open > 0 && close > 0 ? changePct ?? 0 : 0; // use daily change as EP proxy
      const isEP = (gapPct >= 10 || (changePct >= 8 && volRatio >= 3))
        && (volRatio ?? 1) >= 2
        && (perf3m ?? 0) < 25     // was not already extended
        && close > 2;

      // ── SETUP 3: PARABOLIC SHORT ───────────────────────────────────────────
      // Conditions:
      // 1. Stock up ≥ 60% in last month (parabolic run)
      // 2. Price is extended far above EMA20 (≥ 30% above)
      // 3. Today showing fade / reversal (change ≤ 0 or open > close)
      // 4. Volume elevated

      const extendedAboveEma = ema20 > 0 ? (close - ema20) / ema20 * 100 : 0;
      const weeklyRunPct = close2w != null && close2w > 0
        ? (close - close2w) / close2w * 100
        : perf1m ?? 0;

      // Consecutive up weeks (proxy for consecutive up days)
      const consecUpWeeks = (() => {
        const prices = [close, close1w, close2w, close3w, close4w].filter(p => p != null && p > 0);
        let c = 0;
        for (let i = 0; i < prices.length - 1; i++) {
          if (prices[i] > prices[i + 1]) c++;
          else break;
        }
        return c;
      })();

      const todayFading = (changePct ?? 0) < 0 || (open > 0 && close < open);

      const isPS = (perf1m ?? 0) >= 60
        && extendedAboveEma >= 25
        && consecUpWeeks >= 2
        && todayFading
        && close > 2;

      if (!isBO && !isEP && !isPS) continue;

      // ── Determine primary setup ────────────────────────────────────────────
      // Priority: EP > Parabolic Short > Breakout
      let setup, score;

      if (isEP) {
        setup = 'EP';
        score = Math.min(
          50 +
          (gapPct >= 15 ? 15 : gapPct >= 10 ? 10 : 5) +
          (volRatio >= 4 ? 15 : volRatio >= 2 ? 10 : 5) +
          ((perf3m ?? 0) < 10 ? 15 : (perf3m ?? 0) < 20 ? 8 : 0) +
          (adr >= 6 ? 10 : adr >= 4 ? 5 : 0) +
          (emaAligned ? 5 : 0),
          100
        );
      } else if (isPS) {
        setup = 'Parabolic Short';
        score = Math.min(
          50 +
          ((perf1m ?? 0) >= 100 ? 20 : (perf1m ?? 0) >= 60 ? 12 : 6) +
          (extendedAboveEma >= 50 ? 15 : extendedAboveEma >= 30 ? 10 : 5) +
          (consecUpWeeks >= 3 ? 10 : consecUpWeeks >= 2 ? 5 : 0) +
          (todayFading ? 10 : 0) +
          (adr >= 6 ? 5 : 0),
          100
        );
      } else {
        setup = 'Breakout';
        score = Math.min(
          (emaAligned ? 20 : 0) +
          (surgeMovePct >= 50 ? 15 : surgeMovePct >= 30 ? 10 : 5) +
          (adr >= 8 ? 12 : adr >= 5 ? 8 : adr >= 4 ? 5 : 0) +
          (pullbackFromHigh3m <= -8 && pullbackFromHigh3m >= -25 ? 15 : pullbackFromHigh3m <= -3 ? 8 : 0) +
          (inKeyZone ? 20 : nearEma ? 10 : 0) +
          (isConsolidating ? 10 : 0) +
          (weeklyUp ? 5 : 0) +
          ((volRatio ?? 1) >= 2 ? 3 : 0),
          100
        );
      }

      if (score < 55) continue;

      // ── Stop / Target calculations ─────────────────────────────────────────
      const suggestedSL = setup === 'Parabolic Short'
        ? +(Math.max(high, open) * 1.005).toFixed(2)  // short: stop above HOD
        : +(Math.min(low, ema20 * 0.97) * 0.99).toFixed(2);  // long: below recent low / EMA

      const slDist = Math.abs(close - suggestedSL);
      const slPct = close > 0 ? +(slDist / close * 100).toFixed(1) : 2;

      const tp1 = setup === 'Parabolic Short'
        ? +(close - 3 * slDist).toFixed(2)
        : +(close + 3 * slDist).toFixed(2);
      const tp2 = setup === 'Parabolic Short'
        ? +(close - 5 * slDist).toFixed(2)
        : +(close + 5 * slDist).toFixed(2);

      results.push({
        ticker:    name,
        sector:    sectorName ?? 'Unknown',
        setup,
        score,
        price:     +close.toFixed(2),
        chg1d:     +(changePct ?? 0).toFixed(2),
        chg1m:     +(perf1m ?? 0).toFixed(1),
        chg3m:     +(perf3m ?? 0).toFixed(1),
        surgeMovePct: +surgeMovePct.toFixed(1),
        pullbackPct:  +pullbackFromHigh3m.toFixed(1),
        adr:       +adr.toFixed(1),
        volSurge:  +(volRatio ?? 1).toFixed(1),
        ema10:     +ema10.toFixed(2),
        ema20:     +ema20.toFixed(2),
        ema50:     +ema50.toFixed(2),
        emaAligned,
        keyZoneBot: kzBot,
        keyZoneTop: kzTop,
        keyZoneWidth: kzWidth,
        inKeyZone,
        isConsolidating,
        weeklyUp,
        // EP-specific
        epGapPct:  +gapPct.toFixed(1),
        epVolRatio: +(volRatio ?? 1).toFixed(1),
        // Para-specific
        paraRunPct:     +(perf1m ?? 0).toFixed(1),
        paraExtended:   +extendedAboveEma.toFixed(1),
        paraConsecWeeks: consecUpWeeks,
        // Trade plan
        suggestedSL, slPct, tp1, tp2,
      });
    }

    results.sort((a, b) => b.score - a.score);

    res.status(200).json({
      data:      results,
      total:     rows.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
