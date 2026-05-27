// api/screen.js
// Qullamaggie 3 Setups Stock Screener
// Screens for: Breakout | Episodic Pivot (EP) | Parabolic Short candidates
//
// Data: Yahoo Finance (no API key required)

// ─── Universe ────────────────────────────────────────────────────────────────
// ~200 liquid US stocks across sectors. Vercel free tier: max ~10s execution.
const UNIVERSE = {
  'Technology':    ['AAPL','MSFT','NVDA','AMD','AVGO','ORCL','CRM','ADBE','QCOM','SNOW','PLTR','DDOG','MDB','NET','ZS','CRWD','PANW','FTNT','ANET','NOW','TEAM','HUBS','BILL','OKTA','DOCU'],
  'Semiconductors':['NVDA','AMD','AVGO','QCOM','MU','AMAT','KLAC','LRCX','ON','MRVL','MPWR','WOLF','AEHR','AMBA','FORM'],
  'Biotech/Healthcare':['LLY','UNH','ABBV','MRK','TMO','AMGN','GILD','REGN','VRTX','MRNA','ISRG','DXCM','ILMN','HOLX','INCY'],
  'Energy':        ['XOM','CVX','COP','SLB','EOG','DVN','HAL','OXY','FANG','AR','EQT','CIVI','MGY','CHRD','ROCC'],
  'Financials':    ['JPM','GS','MS','SCHW','COIN','HOOD','NU','AFRM','SQ','PYPL','V','MA','AXP','COF','ALLY'],
  'Consumer':      ['AMZN','TSLA','HD','MCD','NKE','BKNG','ABNB','UBER','LYFT','DASH','SPOT','TTD','RBLX','U','PINS'],
  'Industrials':   ['CAT','DE','HON','GE','ETN','GNRC','SHLS','FSLR','ENPH','RUN','SEDG','NOVA','ARRY','CSIQ','JKS'],
  'Small Cap Growth':['SMCI','CELH','DUOL','IOT','RXST','AXSM','KRYS','PRCT','RDDT','CABA','ZETA','KVYO','GTLB','BRZE','DOCN'],
};

const SECTOR_MAP = {};
for (const [sec, tickers] of Object.entries(UNIVERSE)) {
  for (const t of tickers) SECTOR_MAP[t] = sec;
}
const ALL_TICKERS = [...new Set(Object.values(UNIVERSE).flat())];

// ─── Yahoo Finance helpers ────────────────────────────────────────────────────
async function fetchQuotesBatch(tickers) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,averageDailyVolume10Day,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketPreviousClose,shortName`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  return j?.quoteResponse?.result ?? [];
}

async function fetchHistory(ticker, range = '6mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}&events=div,splits`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const chart = j?.chart?.result?.[0];
  if (!chart) return null;
  const { timestamp, indicators } = chart;
  const q = indicators?.quote?.[0] ?? {};
  const closes = q.close ?? [];
  const highs   = q.high  ?? [];
  const lows    = q.low   ?? [];
  const volumes = q.volume ?? [];
  return { timestamp, closes, highs, lows, volumes };
}

// ─── Technical helpers ────────────────────────────────────────────────────────
function ema(arr, period) {
  const k = 2 / (period + 1);
  let e = arr[0] ?? 0;
  const out = [e];
  for (let i = 1; i < arr.length; i++) {
    e = (arr[i] - e) * k + e;
    out.push(e);
  }
  return out;
}

function sma(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const slice = arr.slice(i - period + 1, i + 1).filter(v => v != null);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function adr(highs, lows, period = 20) {
  const ratios = highs.map((h, i) => lows[i] > 0 ? (h - lows[i]) / lows[i] : 0);
  const recent = ratios.slice(-period).filter(v => v > 0);
  if (!recent.length) return 0;
  return (recent.reduce((a, b) => a + b, 0) / recent.length) * 100;
}

function findSurgeBigMove(closes, highs, lows, minPct = 30, lookback = 100) {
  // Find the largest single-day or short-burst move (3-10 days) in last `lookback` bars
  const start = Math.max(0, closes.length - lookback);
  let bestMove = { pct: 0, peakIdx: -1, baseIdx: -1 };

  for (let i = start + 1; i < closes.length; i++) {
    // 1-day surge
    if (closes[i - 1] > 0) {
      const oneDayPct = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
      if (oneDayPct >= minPct && oneDayPct > bestMove.pct) {
        bestMove = { pct: +oneDayPct.toFixed(1), peakIdx: i, baseIdx: i - 1 };
      }
    }
    // Multi-day burst (up to 10 days)
    for (let j = Math.max(start, i - 10); j < i; j++) {
      if (closes[j] > 0) {
        const burstPct = (closes[i] - closes[j]) / closes[j] * 100;
        if (burstPct >= minPct && burstPct > bestMove.pct) {
          bestMove = { pct: +burstPct.toFixed(1), peakIdx: i, baseIdx: j };
        }
      }
    }
  }
  return bestMove;
}

function isParabolic(closes, highs, lows) {
  // Stock up 60%+ in last 15 days AND 3+ consecutive up days
  if (closes.length < 16) return { isParabolic: false };
  const n = closes.length;
  const runStart = closes[n - 16];
  const runEnd   = closes[n - 1];
  if (!runStart || runStart <= 0) return { isParabolic: false };
  const runPct = (runEnd - runStart) / runStart * 100;

  // Count consecutive up days from most recent
  let consecUp = 0;
  for (let i = n - 1; i >= 1; i--) {
    if (closes[i] > closes[i - 1]) consecUp++;
    else break;
  }

  // Fading today: close < open
  const todayFading = closes[n - 1] < closes[n - 2]; // simplified (no open in history)

  return {
    isParabolic: runPct >= 60 && consecUp >= 3,
    runPct: +runPct.toFixed(1),
    consecUp,
    todayFading,
  };
}

function isEpisodicPivot(closes, highs, volumes, gapPctThreshold = 10, volMultiple = 2) {
  // Check if most recent bar is a gap-up on big volume vs prior 3-6 months of flat/sideways
  if (closes.length < 64) return { isEP: false };
  const n = closes.length;

  // Gap up: today's close vs yesterday's high
  const prevHigh    = highs[n - 2] ?? closes[n - 2];
  const todayClose  = closes[n - 1];
  if (!prevHigh || prevHigh <= 0) return { isEP: false };
  const gapPct = (todayClose - prevHigh) / prevHigh * 100;

  // Volume check
  const avgVol = volumes.slice(-21, -1).filter(v => v > 0).reduce((a, b) => a + b, 0) / 20;
  const todayVol = volumes[n - 1] ?? 0;
  const volRatio = avgVol > 0 ? todayVol / avgVol : 0;

  // Not extended: prior 3 months range should be < 35%
  const priorCloses = closes.slice(-65, -1);
  const priorHigh   = Math.max(...priorCloses);
  const priorLow    = Math.min(...priorCloses.filter(v => v > 0));
  const priorRange  = priorLow > 0 ? (priorHigh - priorLow) / priorLow * 100 : 100;
  const notExtended = priorRange < 35;

  return {
    isEP: gapPct >= gapPctThreshold && volRatio >= volMultiple && notExtended,
    gapPct:    +gapPct.toFixed(1),
    volRatio:  +volRatio.toFixed(1),
    notExtended,
    priorRange: +priorRange.toFixed(1),
  };
}

function calcBreakoutScore(d) {
  // Score 0-100 for breakout setup quality
  let score = 0;
  if (d.emaAligned)          score += 20; // EMA10 > EMA21 > EMA50
  if (d.surgeMovePct >= 50)  score += 15;
  else if (d.surgeMovePct >= 30) score += 10;
  if (d.adr >= 6)            score += 10;
  else if (d.adr >= 4)       score += 6;
  if (d.pullbackPct <= -5 && d.pullbackPct >= -30) score += 15; // healthy pullback
  if (d.inConsolZone)        score += 20; // price back near EMAs
  if (d.isConsolidating)     score += 10; // tight range consolidation
  if (d.weeklyUp)            score += 5;
  if (d.volSurge >= 2)       score += 5;
  return Math.min(score, 100);
}

function calcEPScore(d) {
  let score = 50; // base: already found a gap
  if (d.epData?.gapPct >= 15) score += 15;
  else if (d.epData?.gapPct >= 10) score += 10;
  if (d.epData?.volRatio >= 3)  score += 15;
  else if (d.epData?.volRatio >= 2) score += 10;
  if (d.epData?.notExtended)    score += 15;
  if (d.adr >= 5)               score += 5;
  return Math.min(score, 100);
}

function calcParabolicScore(d) {
  let score = 50;
  if (d.paraData?.runPct >= 100) score += 20;
  else if (d.paraData?.runPct >= 60) score += 10;
  if (d.paraData?.consecUp >= 5)  score += 15;
  else if (d.paraData?.consecUp >= 3) score += 8;
  if (d.paraData?.todayFading)    score += 10;
  if (d.adr >= 6)                 score += 5;
  return Math.min(score, 100);
}

// ─── Main screener ────────────────────────────────────────────────────────────
async function screenTicker(quote) {
  const ticker = quote.symbol;
  const price  = quote.regularMarketPrice ?? 0;
  if (price <= 2) return null; // skip penny stocks

  const hist = await fetchHistory(ticker, '6mo', '1d');
  if (!hist || hist.closes.length < 40) return null;

  const { closes, highs, lows, volumes } = hist;
  const n = closes.length;

  // ── EMAs ──
  const ema10arr  = ema(closes, 10);
  const ema21arr  = ema(closes, 21);
  const ema50arr  = ema(closes, 50);
  const ema10  = +ema10arr[n - 1].toFixed(2);
  const ema21  = +ema21arr[n - 1].toFixed(2);
  const ema50  = +ema50arr[n - 1].toFixed(2);

  const emaAligned = ema10 > ema21 && ema21 > ema50
    && ema10arr[n - 1] > ema10arr[n - 4]  // slope up
    && ema21arr[n - 1] > ema21arr[n - 4];

  // ── ADR ──
  const adrVal = +adr(highs, lows, 20).toFixed(1);

  // ── Volume surge ──
  const avgVol20  = volumes.slice(-21, -1).filter(v => v > 0).reduce((a, b) => a + b, 0) / 20;
  const todayVol  = volumes[n - 1] ?? 0;
  const volSurge  = avgVol20 > 0 ? +(todayVol / avgVol20).toFixed(1) : 1;

  // ── Big prior surge (Breakout setup prerequisite) ──
  const surge = findSurgeBigMove(closes, highs, lows, 30, 100);
  const surgeMovePct = surge.pct;

  // Pullback from surge peak
  const peakPrice  = surge.peakIdx >= 0 ? (highs[surge.peakIdx] ?? closes[surge.peakIdx]) : price;
  const pullbackPct = peakPrice > 0 ? +((price - peakPrice) / peakPrice * 100).toFixed(1) : 0;

  // ── Consolidation zone: price near EMAs (within 5%) ──
  const nearEma10   = Math.abs((price - ema10) / ema10 * 100) < 5;
  const nearEma21   = Math.abs((price - ema21) / ema21 * 100) < 5;
  const inConsolZone = nearEma10 || nearEma21;

  // ── Tight consolidation (range < 8% over last 10 bars) ──
  const recentHigh = Math.max(...highs.slice(-10));
  const recentLow  = Math.min(...lows.slice(-10).filter(v => v > 0));
  const consolRange = recentLow > 0 ? +((recentHigh - recentLow) / recentLow * 100).toFixed(1) : 100;
  const isConsolidating = consolRange < 8 && consolRange > 0;

  // ── Weekly trend (use last 5 closes as proxy) ──
  const weeklyUp = closes[n - 1] > closes[n - 6];

  // ── AVWAP approximation (anchored to surge base) ──
  let avwap = ema21; // fallback
  if (surge.baseIdx >= 0) {
    const anchorSlice = closes.slice(surge.baseIdx);
    const volSlice    = volumes.slice(surge.baseIdx);
    const totalVol    = volSlice.reduce((a, b) => a + (b ?? 0), 0);
    if (totalVol > 0) {
      const vwapNum = anchorSlice.reduce((acc, c, i) => acc + c * (volSlice[i] ?? 0), 0);
      avwap = +(vwapNum / totalVol).toFixed(2);
    }
  }

  // ── Key zone (EMA10, EMA21, AVWAP convergence) ──
  const zoneVals    = [ema10, ema21, avwap].filter(v => v > 0);
  const keyZoneBot  = +Math.min(...zoneVals).toFixed(2);
  const keyZoneTop  = +Math.max(...zoneVals).toFixed(2);
  const keyZoneWidth = keyZoneTop > 0 ? +((keyZoneTop - keyZoneBot) / keyZoneTop * 100).toFixed(1) : 99;
  const keyZoneNarrow = keyZoneWidth < 4;
  const inKeyZone   = price >= keyZoneBot * 0.98 && price <= keyZoneTop * 1.02;

  // ── Monthly change ──
  const chg1mo = closes[n - 22] > 0 ? +((closes[n - 1] - closes[n - 22]) / closes[n - 22] * 100).toFixed(1) : 0;

  // ── Setup detection ──
  const epData   = isEpisodicPivot(closes, highs, volumes, 10, 2);
  const paraData = isParabolic(closes, highs, lows);

  // Suggested stop / targets
  const recentLowStop = Math.min(...lows.slice(-3).filter(v => v > 0));
  const suggestedSL   = +(recentLowStop * 0.99).toFixed(2);
  const slPct         = price > 0 ? +((price - suggestedSL) / price * 100).toFixed(1) : 2;
  const tp1           = +(price + 3 * (price - suggestedSL)).toFixed(2); // 3R
  const tp2           = +(price + 5 * (price - suggestedSL)).toFixed(2); // 5R

  const base = {
    ticker, sector: SECTOR_MAP[ticker] ?? 'Other',
    price: +price.toFixed(2), chg1mo,
    ema10, ema21, ema50, avwap: +avwap.toFixed(2),
    emaAligned, adr: adrVal, volSurge,
    surgeMovePct, pullbackPct,
    inConsolZone, isConsolidating, consolRange, weeklyUp,
    keyZoneBot, keyZoneTop, keyZoneWidth, keyZoneNarrow, inKeyZone,
    suggestedSL, slPct, tp1, tp2,
    epData, paraData,
  };

  // ── Classify primary setup ──
  const isBO = emaAligned && surgeMovePct >= 30 && adrVal >= 4
    && (inConsolZone || inKeyZone)
    && pullbackPct <= -3 && pullbackPct >= -40;

  const isEP = epData.isEP;
  const isPS = paraData.isParabolic;

  if (!isBO && !isEP && !isPS) return null;

  let setup = isBO ? 'Breakout' : isEP ? 'EP' : 'Parabolic Short';
  let score = isBO ? calcBreakoutScore(base)
            : isEP ? calcEPScore(base)
            : calcParabolicScore(base);

  // Minimum score gate
  if (score < 55) return null;

  return { ...base, setup, score };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { sector } = req.query;

  try {
    let tickers = sector
      ? (UNIVERSE[sector] ?? [])
      : ALL_TICKERS;

    // Vercel free tier: limit to avoid timeout
    if (!sector) tickers = tickers.slice(0, 80);

    // Batch quote fetch (50 at a time)
    const allQuotes = [];
    for (let i = 0; i < tickers.length; i += 50) {
      const batch = tickers.slice(i, i + 50);
      try {
        const q = await fetchQuotesBatch(batch);
        allQuotes.push(...q);
      } catch (_) {}
    }

    // Screen each ticker (sequential to avoid rate limits)
    const results = [];
    for (const quote of allQuotes) {
      try {
        const r = await screenTicker(quote);
        if (r) results.push(r);
      } catch (_) {}
    }

    results.sort((a, b) => b.score - a.score);

    res.status(200).json({
      data: results,
      total: allQuotes.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
