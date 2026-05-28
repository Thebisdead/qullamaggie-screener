// api/screen.js — Qullamaggie 3 Setups Screener
// TradingView Scanner API: ONE bulk POST → 2000 stocks, all indicators pre-computed
// Field names verified from: shner-elmo.github.io/TradingView-Screener/fields/stocks.html

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
  const text = await r.text();
  if (!r.ok) throw new Error(`TradingView ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { sector } = req.query;

  try {
    const filters = [
      { left: 'market_cap_basic',        operation: 'greater', right: 100_000_000 },
      { left: 'average_volume_10d_calc', operation: 'greater', right: 300_000 },
      { left: 'close',                   operation: 'greater', right: 2 },
      { left: 'type',                    operation: 'equal',   right: 'stock' },
      { left: 'subtype',                 operation: 'in',      right: ['common', 'foreign-issuer'] },
    ];
    if (sector) {
      filters.push({ left: 'sector', operation: 'equal', right: sector });
    }

    // All column names verified against TradingView fields documentation
    // Timeframe suffix format: |1W = weekly, |1M = monthly (only these two exist for non-intraday)
    const columns = [
      'name',                      // 0  ticker symbol
      'close',                     // 1  current price
      'open',                      // 2  today open
      'high',                      // 3  today high
      'low',                       // 4  today low
      'change',                    // 5  today % change  ← verified field name
      'gap',                       // 6  gap % from prev close  ← verified field name
      'volume',                    // 7  today volume
      'average_volume_10d_calc',   // 8  10-day avg volume  ← verified
      'relative_volume_10d_calc',  // 9  vol/avg  ← verified
      'EMA10',                     // 10 EMA(10) daily  ← verified
      'EMA21',                     // 11 EMA(21) daily  ← verified (EMA21 exists, not EMA20→21)
      'EMA50',                     // 12 EMA(50) daily  ← verified
      'EMA10|1W',                  // 13 EMA(10) weekly  ← verified
      'Perf.1M',                   // 14 1-month perf %  ← verified
      'Perf.3M',                   // 15 3-month perf %  ← verified
      'Perf.6M',                   // 16 6-month perf %  ← verified
      'Perf.W',                    // 17 weekly perf %  ← verified
      'High.1M',                   // 18 1-month high  ← verified
      'Low.1M',                    // 19 1-month low  ← verified
      'High.3M',                   // 20 3-month high  ← verified
      'Low.3M',                    // 21 3-month low  ← verified
      'High.6M',                   // 22 6-month high  ← verified
      'ADRP',                      // 23 Avg Daily Range %  ← verified (NOT "ADR Percent")
      'ATR',                       // 24 ATR(14)  ← verified
      'sector',                    // 25 sector name  ← verified
      'close|1W',                  // 26 weekly close (1 week ago)  ← verified
      'change|1W',                 // 27 weekly change %  ← verified
      'price_52_week_high',        // 28 52-week high  ← verified (NOT "High.52W")
      'price_52_week_low',         // 29 52-week low  ← verified (NOT "Low.52W")
    ];

    const payload = {
      filter: filters,
      options: { lang: 'en' },
      markets: ['america'],
      columns,
      sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
      range: [0, 2000],
    };

    const data = await fetchTV(payload);
    const rows = data?.data ?? [];
    const results = [];

    for (const row of rows) {
      const d = row.d;
      const [
        name, close, open, high, low, changePct, gapPct, vol, avgVol, volRatio,
        ema10, ema21, ema50, ema10w,
        perf1m, perf3m, perf6m, perfW,
        high1m, low1m, high3m, low3m, high6m,
        adrp, atr,
        sectorName,
        close1w, change1w,
        high52w, low52w,
      ] = d;

      if (!close || close < 2) continue;
      if (!ema10 || !ema21 || !ema50) continue;

      // ADR: use ADRP (avg daily range %) directly
      const adr = adrp ?? (atr && close ? atr / close * 100 : 0);
      if (adr < 3) continue;

      // ── EMA alignment ──────────────────────────────────────────────────────
      const emaAligned = ema10 > ema21 && ema21 > ema50;
      const kzBot = +Math.min(ema10, ema21).toFixed(2);
      const kzTop = +Math.max(ema10, ema21).toFixed(2);
      const kzWidth = kzTop > 0 ? +((kzTop - kzBot) / kzTop * 100).toFixed(1) : 99;
      const nearEma = Math.abs((close - ema10) / ema10 * 100) < 8 ||
                      Math.abs((close - ema21) / ema21 * 100) < 8;
      const inKeyZone = close >= kzBot * 0.97 && close <= kzTop * 1.05;

      // ── Surge detection ────────────────────────────────────────────────────
      const surgeMovePct = Math.max(perf1m ?? 0, perf3m ?? 0, perf6m ?? 0);
      const pullbackFromHigh3m = high3m > 0 ? (close - high3m) / high3m * 100 : 0;

      // ── Consolidation: 1m range < 15% ──────────────────────────────────────
      const consol1mRange = (high1m > 0 && low1m > 0) ? (high1m - low1m) / low1m * 100 : 100;
      const isConsolidating = consol1mRange < 15 && consol1mRange > 0;

      // ── Weekly trend ───────────────────────────────────────────────────────
      const weeklyUp = close1w != null ? close > close1w : (perfW ?? 0) > 0;

      // ── SETUP 1: BREAKOUT ──────────────────────────────────────────────────
      const isBO = emaAligned
        && surgeMovePct >= 30
        && adr >= 4
        && pullbackFromHigh3m <= -3
        && pullbackFromHigh3m >= -45
        && nearEma;

      // ── SETUP 2: EPISODIC PIVOT ────────────────────────────────────────────
      // gap field = today gap % vs prior close (verified TV field)
      const todayGap = gapPct ?? 0;
      const todayChange = changePct ?? 0;
      // EP: big gap or big daily move + high volume + prior flat/neglected
      const isEP = (todayGap >= 10 || (todayChange >= 10 && (volRatio ?? 1) >= 3))
        && (volRatio ?? 1) >= 2
        && (perf3m ?? 0) < 25;

      // ── SETUP 3: PARABOLIC SHORT ───────────────────────────────────────────
      const extAboveEma21 = ema21 > 0 ? (close - ema21) / ema21 * 100 : 0;
      const weeklyRunPct = perf1m ?? 0;
      // Consecutive up weeks: use weekly perf and 1w change as proxy
      const consecUpWeeks = (perfW ?? 0) > 0 && (change1w ?? 0) > 0 ? 2 : (perfW ?? 0) > 0 ? 1 : 0;
      const todayFading = todayChange < 0 || (open > 0 && close < open);

      const isPS = weeklyRunPct >= 60
        && extAboveEma21 >= 25
        && consecUpWeeks >= 1
        && todayFading;

      if (!isBO && !isEP && !isPS) continue;

      // ── Score & classify ───────────────────────────────────────────────────
      let setup, score;
      if (isEP) {
        setup = 'EP';
        score = Math.min(50
          + (todayGap >= 15 ? 15 : todayGap >= 10 ? 10 : todayChange >= 10 ? 7 : 3)
          + ((volRatio ?? 1) >= 4 ? 15 : (volRatio ?? 1) >= 2 ? 10 : 5)
          + ((perf3m ?? 0) < 5 ? 15 : (perf3m ?? 0) < 15 ? 10 : 5)
          + (adr >= 6 ? 10 : adr >= 4 ? 5 : 0)
          + (emaAligned ? 5 : 0),
          100);
      } else if (isPS) {
        setup = 'Parabolic Short';
        score = Math.min(50
          + (weeklyRunPct >= 100 ? 20 : weeklyRunPct >= 60 ? 12 : 6)
          + (extAboveEma21 >= 50 ? 15 : extAboveEma21 >= 30 ? 10 : 5)
          + (todayFading ? 10 : 0)
          + (adr >= 6 ? 5 : 0),
          100);
      } else {
        setup = 'Breakout';
        score = Math.min(
          (emaAligned ? 20 : 0)
          + (surgeMovePct >= 50 ? 15 : surgeMovePct >= 30 ? 10 : 5)
          + (adr >= 8 ? 12 : adr >= 5 ? 8 : adr >= 4 ? 5 : 0)
          + (pullbackFromHigh3m <= -8 && pullbackFromHigh3m >= -25 ? 15 : pullbackFromHigh3m <= -3 ? 8 : 0)
          + (inKeyZone ? 20 : nearEma ? 10 : 0)
          + (isConsolidating ? 10 : 0)
          + (weeklyUp ? 5 : 0)
          + ((volRatio ?? 1) >= 2 ? 3 : 0),
          100);
      }
      if (score < 55) continue;

      // ── Stop / Target ──────────────────────────────────────────────────────
      const suggestedSL = setup === 'Parabolic Short'
        ? +(Math.max(high ?? close, open ?? close) * 1.005).toFixed(2)
        : +(Math.min(low ?? close * 0.97, ema21 * 0.97) * 0.99).toFixed(2);
      const slDist = Math.abs(close - suggestedSL);
      const slPct = close > 0 ? +(slDist / close * 100).toFixed(1) : 2;
      const tp1 = setup === 'Parabolic Short'
        ? +(close - 3 * slDist).toFixed(2)
        : +(close + 3 * slDist).toFixed(2);
      const tp2 = setup === 'Parabolic Short'
        ? +(close - 5 * slDist).toFixed(2)
        : +(close + 5 * slDist).toFixed(2);

      results.push({
        ticker: name,
        sector: sectorName ?? 'Unknown',
        setup, score,
        price:   +close.toFixed(2),
        chg1d:   +(changePct ?? 0).toFixed(2),
        gap:     +(gapPct ?? 0).toFixed(2),
        chg1m:   +(perf1m ?? 0).toFixed(1),
        chg3m:   +(perf3m ?? 0).toFixed(1),
        surgeMovePct: +surgeMovePct.toFixed(1),
        pullbackPct:  +pullbackFromHigh3m.toFixed(1),
        adr:     +adr.toFixed(1),
        volSurge: +(volRatio ?? 1).toFixed(1),
        ema10: +ema10.toFixed(2),
        ema21: +ema21.toFixed(2),
        ema50: +ema50.toFixed(2),
        emaAligned, inKeyZone, isConsolidating, weeklyUp,
        keyZoneBot: kzBot, keyZoneTop: kzTop, keyZoneWidth: kzWidth,
        epGapPct:   +todayGap.toFixed(1),
        epVolRatio: +(volRatio ?? 1).toFixed(1),
        paraRunPct:  +weeklyRunPct.toFixed(1),
        paraExtended: +extAboveEma21.toFixed(1),
        todayFading,
        suggestedSL, slPct, tp1, tp2,
      });
    }

    results.sort((a, b) => b.score - a.score);
    res.status(200).json({ data: results, total: rows.length, updatedAt: new Date().toISOString() });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
