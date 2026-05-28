// api/screen.js — Qullamaggie 3 Setups Screener
// Architecture: identical to Martin Luk screener
//   - Yahoo Finance v8 chart API (same endpoints, same headers)
//   - pLimit concurrency pool (max 12 parallel)
//   - maxDuration: 60 for Vercel Pro
//
// SETUP 1: Breakout — big prior surge + EMA bull alignment + pullback to EMA zone
// SETUP 2: EP — gap up ≥10% today on ≥2x volume + prior flat/neglected
// SETUP 3: Parabolic Short — up ≥60% in 1 month + extended + fading today

export const config = { maxDuration: 60 };

// ── Ticker universe (same structure as Martin Luk) ────────────────────────────
const THEMATIC = [
  // Semiconductors
  "NVDA","AMD","AVGO","QCOM","TXN","AMAT","LRCX","KLAC","MU","INTC","ADI","MCHP","NXPI","ON","ARM","SMCI","SLAB","AMBA","WOLF","MRVL","MPWR",
  // Software / Cloud
  "MSFT","ORCL","CRM","NOW","ADBE","INTU","CDNS","SNPS","TEAM","HUBS","DDOG","ZS","CRWD","PANW","MDB","GTLB","OKTA","WDAY","TTD","BRZE","ZETA","PLTR","SNOW","SMAR","PCOR","VEEV","DOCS","BILL","ALTR","CWAN","KVYO",
  // Mega cap tech
  "AAPL","GOOGL","META","AMZN","TSLA","NFLX",
  // Biotech / Healthcare growth
  "LLY","ABBV","REGN","VRTX","MRNA","BNTX","BIIB","GILD","AMGN","AXSM","HIMS","GH","NVCR","ACAD","ARWR","AUPH","RXRX","BEAM","EDIT","CRSP","IMVT","MRUS","RCKT","KRYS","PRCT","RDDT",
  // Fintech
  "COIN","HOOD","SOFI","AFRM","UPST","SQ","PYPL","BILL","FUTU","TIGR","FOUR","FLYW","MQ","DAVE","LC","NU",
  // Energy / Clean Energy
  "XOM","CVX","COP","EOG","OXY","DVN","FANG","VLO","PSX","MPC","SLB","HAL","AR","EQT","ENPH","SEDG","ARRY","RUN","NOVA","SHLS","SMR","NNE","OKLO","CCJ","UEC","PLUG","BE","FCEL",
  // Space / Defense
  "RKLB","ASTS","LUNR","KTOS","LMT","NOC","RTX","GD","BA","AXON","CACI","LDOS","SAIC","BAH",
  // Quantum
  "IONQ","RGTI","QBTS","QUBT","ARQQ",
  // Crypto-adjacent
  "MSTR","MARA","RIOT","CLSK","HUT","BTBT","WULF","CIFR",
  // Consumer / Retail growth
  "ABNB","UBER","LYFT","DASH","SPOT","CVNA","DUOL","RBLX","U","PINS","RDDT","CELH","ELF","LULU","BURL","FIVE","BOOT","ANF","DECK","CROX",
  // Industrials
  "GE","CAT","DE","HON","ETN","GNRC","AXON","SAIA","ODFL","XPO",
  // Small-cap movers
  "SMCI","IOT","GTLB","BRZE","DOCN","CABA","ZETA","KVYO","PRCT","KRYS",
];

const SECTOR_HINTS = {
  "NVDA":"半导体","AMD":"半导体","AVGO":"半导体","QCOM":"半导体","TXN":"半导体","AMAT":"半导体","LRCX":"半导体","KLAC":"半导体","MU":"半导体","INTC":"半导体","ADI":"半导体","MCHP":"半导体","NXPI":"半导体","ON":"半导体","ARM":"半导体","SMCI":"半导体","SLAB":"半导体","AMBA":"半导体","WOLF":"半导体","MRVL":"半导体","MPWR":"半导体",
  "MSFT":"软件/云","ORCL":"软件/云","CRM":"软件/云","NOW":"软件/云","ADBE":"软件/云","INTU":"软件/云","CDNS":"软件/云","SNPS":"软件/云","TEAM":"软件/云","HUBS":"软件/云","DDOG":"软件/云","ZS":"软件/云","CRWD":"软件/云","PANW":"软件/云","MDB":"软件/云","GTLB":"软件/云","OKTA":"软件/云","WDAY":"软件/云","TTD":"软件/云","BRZE":"软件/云","ZETA":"软件/云","PLTR":"软件/云","SNOW":"软件/云","BILL":"软件/云","KVYO":"软件/云",
  "AAPL":"大盘科技","GOOGL":"大盘科技","META":"大盘科技","AMZN":"大盘科技","TSLA":"大盘科技","NFLX":"大盘科技",
  "LLY":"生物医疗","ABBV":"生物医疗","REGN":"生物医疗","VRTX":"生物医疗","MRNA":"生物医疗","BNTX":"生物医疗","BIIB":"生物医疗","GILD":"生物医疗","AMGN":"生物医疗","AXSM":"生物医疗","HIMS":"生物医疗","BEAM":"生物医疗","EDIT":"生物医疗","CRSP":"生物医疗","ACAD":"生物医疗","ARWR":"生物医疗","AUPH":"生物医疗","RXRX":"生物医疗","IMVT":"生物医疗","KRYS":"生物医疗","PRCT":"生物医疗",
  "COIN":"金融科技","HOOD":"金融科技","SOFI":"金融科技","AFRM":"金融科技","UPST":"金融科技","SQ":"金融科技","PYPL":"金融科技","FUTU":"金融科技","TIGR":"金融科技","FOUR":"金融科技","FLYW":"金融科技","MQ":"金融科技","DAVE":"金融科技","LC":"金融科技","NU":"金融科技",
  "ENPH":"清洁能源","SEDG":"清洁能源","ARRY":"清洁能源","RUN":"清洁能源","NOVA":"清洁能源","SHLS":"清洁能源","SMR":"清洁能源","NNE":"清洁能源","OKLO":"清洁能源","CCJ":"清洁能源","UEC":"清洁能源","PLUG":"清洁能源","BE":"清洁能源","FCEL":"清洁能源",
  "RKLB":"太空/国防","ASTS":"太空/国防","LUNR":"太空/国防","KTOS":"太空/国防","AXON":"太空/国防","CACI":"太空/国防","LDOS":"太空/国防","SAIC":"太空/国防","BAH":"太空/国防",
  "IONQ":"量子计算","RGTI":"量子计算","QBTS":"量子计算","QUBT":"量子计算","ARQQ":"量子计算",
  "MSTR":"加密","MARA":"加密","RIOT":"加密","CLSK":"加密","HUT":"加密","BTBT":"加密","WULF":"加密","CIFR":"加密",
  "XOM":"能源","CVX":"能源","COP":"能源","EOG":"能源","OXY":"能源","DVN":"能源","VLO":"能源","MPC":"能源","SLB":"能源","HAL":"能源","AR":"能源","EQT":"能源",
};

// ── Yahoo Finance helpers (copied from Martin Luk) ────────────────────────────
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
};

async function safeJson(r) {
  try { const t = await r.text(); if (!t || t[0] !== "{") return null; return JSON.parse(t); }
  catch { return null; }
}

async function fetchDaily(ticker) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 86400 * 130;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await safeJson(r);
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const meta = res.meta ?? {};
    const q = res.indicators?.quote?.[0] ?? {};
    const bars = (res.timestamp ?? []).map((_, i) => ({
      c: q.close?.[i], h: q.high?.[i], l: q.low?.[i], v: q.volume?.[i] ?? 0,
    })).filter(d => d.c != null && d.h != null && d.l != null);
    if (!bars.length) return null;
    // Patch last bar with realtime data
    const last = bars.length - 1;
    if (meta.regularMarketPrice)    bars[last].c = meta.regularMarketPrice;
    if (meta.regularMarketVolume)   bars[last].v = meta.regularMarketVolume;
    if (meta.regularMarketDayHigh)  bars[last].h = meta.regularMarketDayHigh;
    if (meta.regularMarketDayLow)   bars[last].l = meta.regularMarketDayLow;
    return { bars, price: bars[last].c, prevClose: bars.length >= 2 ? bars[last - 1].c : meta.chartPreviousClose };
  } catch { return null; }
}

async function fetchWeeklyClose(ticker) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 86400 * 365;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1wk&period1=${start}&period2=${end}`;
  try {
    const r = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await safeJson(r);
    return (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(Boolean);
  } catch { return []; }
}

// ── Indicators ────────────────────────────────────────────────────────────────
function calcEma(arr, p) {
  if (arr.length < p) return arr.map(() => null);
  const k = 2 / (p + 1);
  const out = new Array(arr.length).fill(null);
  let prev = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function calcADR(bars, n = 20) {
  const w = bars.slice(-n);
  if (w.length < 5) return 0;
  const avgH = w.reduce((s, d) => s + d.h, 0) / w.length;
  const avgL = w.reduce((s, d) => s + d.l, 0) / w.length;
  return avgL > 0 ? ((avgH - avgL) / avgL) * 100 : 0;
}

function calcAvwap(bars) {
  // Anchor: find biggest surge in last 100 bars, anchor to low before it
  const search = bars.slice(-100, -5);
  let bestSurge = 0, anchorIdx = 0;
  for (let i = 0; i < search.length - 5; i++) {
    const lo = search[i].l;
    for (let j = i + 5; j < Math.min(i + 40, search.length); j++) {
      const surge = lo > 0 ? (search[j].h - lo) / lo : 0;
      if (surge > bestSurge) { bestSurge = surge; anchorIdx = bars.length - 100 + i; }
    }
  }
  if (bestSurge < 0.20) {
    const w = bars.slice(-60);
    const ai = w.reduce((mi, d, i) => d.l < w[mi].l ? i : mi, 0);
    anchorIdx = bars.length - 60 + ai;
  }
  const after = bars.slice(Math.max(0, anchorIdx));
  let cpv = 0, cv = 0;
  after.forEach(d => { const tp = (d.h + d.l + d.c) / 3; cpv += tp * d.v; cv += d.v; });
  return cv > 0 ? cpv / cv : bars.at(-1)?.c ?? 0;
}

function calcVolSurge(bars, n = 20) {
  const hist = bars.slice(-n - 5, -5);
  if (hist.length < 5) return 1;
  const avg = hist.reduce((s, d) => s + d.v, 0) / hist.length;
  return avg > 0 ? (bars.at(-1)?.v ?? 0) / avg : 1;
}

function weeklyTrendUp(weekly) {
  if (weekly.length < 12) return false;
  const e9 = calcEma(weekly, 9); const e21 = calcEma(weekly, 21);
  const wl = weekly.length - 1;
  if (!e9[wl] || !e21[wl]) return false;
  return weekly[wl] > e9[wl] && weekly[wl] > e21[wl] && e9[wl] > e9[Math.max(0, wl - 3)];
}

// ── Setup detection ───────────────────────────────────────────────────────────

function detectBreakout(bars, closes, price, ema10, ema21, ema50, weekly) {
  // 1. EMA bull: EMA10 > EMA21 > EMA50, sloping up
  if (!ema10 || !ema21 || !ema50) return null;
  if (!(ema10 > ema21 && ema21 > ema50)) return null;
  const e10arr = calcEma(closes, 10);
  const last = closes.length - 1;
  if (e10arr[last] <= (e10arr[last - 5] ?? 0)) return null; // not sloping up

  // 2. Big prior surge ≥30% in last 100 bars
  const search = bars.slice(-100, -5);
  let bestMove = 0, surgeHigh = price;
  for (let i = 0; i < search.length - 5; i++) {
    for (let j = i + 5; j < Math.min(i + 40, search.length); j++) {
      const mv = search[i].l > 0 ? (search[j].h - search[i].l) / search[i].l : 0;
      if (mv > bestMove) { bestMove = mv; surgeHigh = search[j].h; }
    }
  }
  if (bestMove < 0.30) return null;

  // 3. Price pulled back from surge high (must be below it)
  const pullbackPct = surgeHigh > 0 ? (price - surgeHigh) / surgeHigh * 100 : 0;
  if (pullbackPct >= 0 || pullbackPct < -50) return null;

  // 4. AVWAP + key zone
  const avwap = +calcAvwap(bars).toFixed(2);
  const kzTop = +Math.max(ema10, ema21, avwap).toFixed(2);
  const kzBot = +Math.min(ema10, ema21, avwap).toFixed(2);
  const kzWidth = kzTop > 0 ? (kzTop - kzBot) / kzTop * 100 : 99;

  // 5. Price in key zone
  if (!(price >= kzBot * 0.97 && price <= kzTop * 1.02)) return null;

  // Consolidation: 20-bar range < 20%
  const recent = bars.slice(-20);
  const rHi = Math.max(...recent.map(d => d.h));
  const rLo = Math.min(...recent.map(d => d.l));
  const consolRange = rLo > 0 ? (rHi - rLo) / rLo * 100 : 99;
  const isConsolidating = consolRange < 20;

  const weeklyUp = weeklyTrendUp(weekly);

  return {
    surgeMovePct: +(bestMove * 100).toFixed(1),
    pullbackPct: +pullbackPct.toFixed(1),
    avwap, kzTop, kzBot, kzWidth: +kzWidth.toFixed(1),
    isConsolidating, consolRange: +consolRange.toFixed(1),
    weeklyUp,
  };
}

function detectEP(bars, closes, price, prevClose, volSurge, ema10, ema21, ema50) {
  // Gap up ≥10% OR today change ≥10%
  const gapPct = prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0;
  if (gapPct < 10 && (closes.at(-1) - closes.at(-2)) / closes.at(-2) * 100 < 10) return null;

  // Volume ≥2x average
  if (volSurge < 2) return null;

  // Prior 3 months NOT in strong uptrend (stock was neglected)
  const prior3m = closes.slice(-66, -1);
  if (prior3m.length < 20) return null;
  const priorHi = Math.max(...prior3m);
  const priorLo = Math.min(...prior3m.filter(v => v > 0));
  const priorRun = priorLo > 0 ? (priorHi - priorLo) / priorLo * 100 : 100;
  if (priorRun > 30) return null; // was already running — not EP

  return { gapPct: +gapPct.toFixed(1), volSurge: +volSurge.toFixed(1), priorRange: +priorRun.toFixed(1) };
}

function detectParabolicShort(bars, closes, price, ema21, volSurge) {
  // 1-month gain ≥60%
  const c22 = closes[closes.length - 23];
  if (!c22 || c22 <= 0) return null;
  const perf1m = (price - c22) / c22 * 100;
  if (perf1m < 60) return null;

  // Extended ≥25% above EMA21
  if (!ema21 || ema21 <= 0) return null;
  const extAbove = (price - ema21) / ema21 * 100;
  if (extAbove < 25) return null;

  // Fading today: close < open (use close vs prev close as proxy)
  const todayFading = closes.at(-1) < closes.at(-2);

  // Consecutive up closes ≥3
  let consecUp = 0;
  for (let i = closes.length - 1; i >= 1; i--) {
    if (closes[i] > closes[i - 1]) consecUp++;
    else break;
  }
  if (consecUp < 3 && !todayFading) return null;

  return { perf1m: +perf1m.toFixed(1), extAbove: +extAbove.toFixed(1), consecUp, todayFading };
}

// ── Score ─────────────────────────────────────────────────────────────────────
function scoreSetup(setup, data, adr, volSurge, weeklyUp) {
  if (setup === 'Breakout') {
    return Math.min(
      60
      + (data.kzWidth < 4 ? 15 : data.kzWidth < 8 ? 8 : 0)
      + (data.isConsolidating ? 10 : 0)
      + (weeklyUp ? 5 : 0)
      + (adr >= 8 ? 5 : adr >= 5 ? 3 : 0)
      + (data.pullbackPct >= -25 && data.pullbackPct <= -5 ? 5 : 0)
      + (volSurge >= 2 ? 5 : 0),
      100);
  }
  if (setup === 'EP') {
    return Math.min(
      55
      + (data.gapPct >= 20 ? 20 : data.gapPct >= 15 ? 15 : data.gapPct >= 10 ? 10 : 0)
      + (data.volSurge >= 4 ? 15 : data.volSurge >= 2 ? 10 : 0)
      + (data.priorRange < 10 ? 10 : data.priorRange < 20 ? 5 : 0),
      100);
  }
  if (setup === 'Parabolic Short') {
    return Math.min(
      55
      + (data.perf1m >= 150 ? 20 : data.perf1m >= 100 ? 15 : data.perf1m >= 60 ? 10 : 0)
      + (data.extAbove >= 60 ? 15 : data.extAbove >= 40 ? 10 : data.extAbove >= 25 ? 5 : 0)
      + (data.todayFading ? 10 : 0)
      + (data.consecUp >= 5 ? 5 : 0),
      100);
  }
  return 55;
}

// ── Screen one ticker ─────────────────────────────────────────────────────────
async function screenTicker(ticker, sector) {
  try {
    const [dailyData, weekly] = await Promise.all([fetchDaily(ticker), fetchWeeklyClose(ticker)]);
    if (!dailyData) return null;
    const { bars, price, prevClose } = dailyData;
    if (bars.length < 60 || !price || price < 2 || price > 8000) return null;

    const adr = +calcADR(bars).toFixed(1);
    if (adr < 3) return null;

    const closes = bars.map(d => d.c);
    const n = closes.length - 1;

    const e10arr = calcEma(closes, 10);
    const e21arr = calcEma(closes, 21);
    const e50arr = calcEma(closes, 50);
    const ema10 = e10arr[n], ema21 = e21arr[n], ema50 = e50arr[n];
    if (!ema10 || !ema21 || !ema50) return null;

    const emaAligned = ema10 > ema21 && ema21 > ema50;
    const volSurge = +calcVolSurge(bars).toFixed(2);
    const weeklyUp = weeklyTrendUp(weekly);

    // Try EP first (most specific — gap event)
    const epData = detectEP(bars, closes, price, prevClose, volSurge, ema10, ema21, ema50);
    // Then Parabolic Short
    const psData = !epData ? detectParabolicShort(bars, closes, price, ema21, volSurge) : null;
    // Then Breakout (requires more conditions)
    const boData = (!epData && !psData) ? detectBreakout(bars, closes, price, ema10, ema21, ema50, weekly) : null;

    if (!epData && !psData && !boData) return null;

    let setup, setupData;
    if (epData)   { setup = 'EP';              setupData = epData; }
    else if (psData) { setup = 'Parabolic Short'; setupData = psData; }
    else          { setup = 'Breakout';         setupData = boData; }

    const score = scoreSetup(setup, setupData, adr, volSurge, weeklyUp);
    if (score < 55) return null;

    // EMA key zone (for Breakout; for EP/PS use simpler bounds)
    const avwap = setup === 'Breakout' ? setupData.avwap : +calcAvwap(bars).toFixed(2);
    const kzTop = setup === 'Breakout' ? setupData.kzTop : +Math.max(ema10, ema21).toFixed(2);
    const kzBot = setup === 'Breakout' ? setupData.kzBot : +Math.min(ema10, ema21).toFixed(2);
    const kzWidth = setup === 'Breakout' ? setupData.kzWidth : +(kzTop > 0 ? (kzTop - kzBot) / kzTop * 100 : 99).toFixed(1);

    const chg1m = n >= 22 ? +(((price / closes[n - 22]) - 1) * 100).toFixed(1) : 0;
    const chg3m = n >= 66 ? +(((price / closes[n - 66]) - 1) * 100).toFixed(1) : 0;

    const suggestedSL = setup === 'Parabolic Short'
      ? +(Math.max(...bars.slice(-3).map(d => d.h)) * 1.005).toFixed(2)
      : +(kzBot * 0.98).toFixed(2);
    const slDist = Math.abs(price - suggestedSL);
    const slPct = price > 0 ? +(slDist / price * 100).toFixed(1) : 2;
    const tp1 = setup === 'Parabolic Short' ? +(price - 3 * slDist).toFixed(2) : +(price + 3 * slDist).toFixed(2);
    const tp2 = setup === 'Parabolic Short' ? +(price - 5 * slDist).toFixed(2) : +(price + 5 * slDist).toFixed(2);

    return {
      ticker, sector, setup, score,
      price: +price.toFixed(2),
      chg1d: prevClose > 0 ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0,
      chg1m, chg3m,
      adr, volSurge, emaAligned, weeklyUp,
      ema10: +ema10.toFixed(2), ema21: +ema21.toFixed(2), ema50: +ema50.toFixed(2),
      avwap, keyZoneTop: kzTop, keyZoneBot: kzBot, keyZoneWidth: kzWidth,
      inKeyZone: price >= kzBot * 0.97 && price <= kzTop * 1.02,
      isConsolidating: setup === 'Breakout' ? setupData.isConsolidating : false,
      surgeMovePct: setup === 'Breakout' ? setupData.surgeMovePct : (setupData.perf1m ?? 0),
      pullbackPct: setup === 'Breakout' ? setupData.pullbackPct : 0,
      epGapPct:   setup === 'EP' ? setupData.gapPct : 0,
      epVolRatio: setup === 'EP' ? setupData.volSurge : 0,
      paraRunPct:  setup === 'Parabolic Short' ? setupData.perf1m : 0,
      paraExtended: setup === 'Parabolic Short' ? setupData.extAbove : 0,
      paraConsecUp: setup === 'Parabolic Short' ? setupData.consecUp : 0,
      todayFading: setup === 'Parabolic Short' ? setupData.todayFading : false,
      suggestedSL, slPct, tp1, tp2,
    };
  } catch { return null; }
}

// ── Concurrency pool ──────────────────────────────────────────────────────────
async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ── Ticker list builders (SP500 + NASDAQ, same as Martin Luk) ─────────────────
async function fetchSP500() {
  try {
    const r = await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    return text.split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "").trim()).filter(t => /^[A-Z]{1,5}$/.test(t));
  } catch { return []; }
}

async function fetchNASDAQ() {
  try {
    const r = await fetch("https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed-symbols.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    return text.split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "").trim()).filter(t => /^[A-Z]{1,5}$/.test(t)).slice(0, 800);
  } catch { return []; }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const reqSector = req.query.sector;
    let pairs = [];

    if (reqSector) {
      const st = THEMATIC.filter(t => SECTOR_HINTS[t] === reqSector);
      pairs = (st.length > 0 ? st : THEMATIC.slice(0, 60)).map(t => ({ t, s: reqSector }));
    } else {
      const [sp500Res, nasdaqRes] = await Promise.allSettled([fetchSP500(), fetchNASDAQ()]);
      const sp500  = sp500Res.status  === "fulfilled" ? sp500Res.value  : [];
      const nasdaq = nasdaqRes.status === "fulfilled" ? nasdaqRes.value : [];
      const seen = new Set();
      for (const t of [...THEMATIC, ...sp500, ...nasdaq]) {
        if (!seen.has(t)) { seen.add(t); pairs.push({ t, s: SECTOR_HINTS[t] ?? "美股" }); }
      }
    }

    const tasks = pairs.map(({ t, s }) => () => screenTicker(t, s));
    const settled = await pLimit(tasks, 12);
    const data = settled.filter(Boolean).sort((a, b) => b.score - a.score);

    res.status(200).json({ data, total: pairs.length, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], total: 0, updatedAt: new Date().toISOString() });
  }
}
