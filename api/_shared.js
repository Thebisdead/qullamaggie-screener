// api/_shared.js — shared Yahoo Finance fetchers + indicator helpers
// Used by screen-breakout.js, screen-ep.js, screen-parabolic.js

export const config = { maxDuration: 60 };

export const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
};

async function safeJson(r) {
  try { const t = await r.text(); if (!t || t[0] !== "{") return null; return JSON.parse(t); }
  catch { return null; }
}

export async function fetchDaily(ticker) {
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
    const last = bars.length - 1;
    if (meta.regularMarketPrice)   bars[last].c = meta.regularMarketPrice;
    if (meta.regularMarketVolume)  bars[last].v = meta.regularMarketVolume;
    if (meta.regularMarketDayHigh) bars[last].h = meta.regularMarketDayHigh;
    if (meta.regularMarketDayLow)  bars[last].l = meta.regularMarketDayLow;
    return { bars, price: bars[last].c, prevClose: bars.length >= 2 ? bars[last - 1].c : (meta.chartPreviousClose ?? 0) };
  } catch { return null; }
}

export async function fetchWeekly(ticker) {
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

export function calcEma(arr, p) {
  if (arr.length < p) return arr.map(() => null);
  const k = 2 / (p + 1);
  const out = new Array(arr.length).fill(null);
  let prev = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function calcADR(bars, n = 20) {
  const w = bars.slice(-n);
  if (w.length < 5) return 0;
  const avgH = w.reduce((s, d) => s + d.h, 0) / w.length;
  const avgL = w.reduce((s, d) => s + d.l, 0) / w.length;
  return avgL > 0 ? (avgH - avgL) / avgL * 100 : 0;
}

export function calcVolSurge(bars, n = 20) {
  const hist = bars.slice(-n - 5, -5);
  if (hist.length < 5) return 1;
  const avg = hist.reduce((s, d) => s + d.v, 0) / hist.length;
  return avg > 0 ? (bars.at(-1)?.v ?? 0) / avg : 1;
}

export function calcAvwap(bars) {
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

export function weeklyTrendUp(weekly) {
  if (weekly.length < 12) return false;
  const e9 = calcEma(weekly, 9);
  const e21 = calcEma(weekly, 21);
  const wl = weekly.length - 1;
  if (!e9[wl] || !e21[wl]) return false;
  return weekly[wl] > e9[wl] && weekly[wl] > e21[wl] && e9[wl] > e9[Math.max(0, wl - 3)];
}

export async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export async function fetchSP500() {
  try {
    const r = await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    return text.split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "").trim()).filter(t => /^[A-Z]{1,5}$/.test(t));
  } catch { return []; }
}

export async function fetchNASDAQ() {
  try {
    const r = await fetch("https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed-symbols.csv", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    return text.split("\n").slice(1).map(l => l.split(",")[0].replace(/"/g, "").trim()).filter(t => /^[A-Z]{1,5}$/.test(t)).slice(0, 800);
  } catch { return []; }
}

export const THEMATIC = [
  "NVDA","AMD","AVGO","QCOM","TXN","AMAT","LRCX","KLAC","MU","INTC","ADI","MCHP","NXPI","ON","ARM","SMCI","SLAB","AMBA","WOLF","MRVL","MPWR",
  "MSFT","ORCL","CRM","NOW","ADBE","INTU","CDNS","SNPS","TEAM","HUBS","DDOG","ZS","CRWD","PANW","MDB","GTLB","OKTA","WDAY","TTD","BRZE","ZETA","PLTR","SNOW","BILL","KVYO","PCOR","VEEV","DOCS","SMAR","ALTR","CWAN",
  "AAPL","GOOGL","META","AMZN","TSLA","NFLX",
  "LLY","ABBV","REGN","VRTX","MRNA","BNTX","BIIB","GILD","AMGN","AXSM","HIMS","GH","NVCR","ACAD","ARWR","AUPH","RXRX","BEAM","EDIT","CRSP","IMVT","MRUS","KRYS","PRCT","RDDT",
  "COIN","HOOD","SOFI","AFRM","UPST","SQ","PYPL","BILL","FUTU","TIGR","FOUR","FLYW","MQ","DAVE","LC","NU",
  "XOM","CVX","COP","EOG","OXY","DVN","FANG","VLO","PSX","MPC","SLB","HAL","AR","EQT","ENPH","SEDG","ARRY","RUN","NOVA","SHLS","SMR","NNE","OKLO","CCJ","UEC","PLUG","BE","FCEL",
  "RKLB","ASTS","LUNR","KTOS","LMT","NOC","RTX","GD","BA","AXON","CACI","LDOS","SAIC","BAH",
  "IONQ","RGTI","QBTS","QUBT","ARQQ",
  "MSTR","MARA","RIOT","CLSK","HUT","BTBT","WULF","CIFR",
  "ABNB","UBER","LYFT","DASH","SPOT","CVNA","DUOL","RBLX","U","PINS","CELH","ELF","LULU","BURL","FIVE","BOOT","ANF","DECK","CROX",
  "GE","CAT","DE","HON","ETN","GNRC","SAIA","ODFL","XPO",
  "IOT","DOCN","CABA","JPM","BAC","GS","MS","V","MA","HD","MCD","NKE","WMT","PG","KO","PEP","COST",
];

export const SECTOR_HINTS = {
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
