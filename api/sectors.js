// api/sectors.js — Qullamaggie Screener: Sector Heatmap
// Architecture: identical to Martin Luk screener (Yahoo Finance v8, pLimit concurrency)
export const config = { maxDuration: 60 };

const SECTOR_TICKERS = {
  "信息技术": ["AAPL","MSFT","NVDA","AVGO","AMD","QCOM","TXN","AMAT","LRCX","KLAC","MU","INTC","ADI","MCHP","NXPI","ON","ARM","SMCI","DELL","HPQ","HPE","NTAP","PSTG","PLTR","SNOW","CRM","NOW","ORCL","ADBE","INTU","CDNS","SNPS","TEAM","HUBS","DDOG","ZS","CRWD","PANW","MDB","GTLB","OKTA","WDAY","TTD","BRZE","ZETA","SLAB","AMBA"],
  "通信服务": ["GOOGL","META","NFLX","DIS","CMCSA","T","VZ","TMUS","CHTR","SNAP","PINS","RDDT","MTCH","ZM","TWLO","SIRI","WBD","PARA","IPG","OMC","LYV","BIDU","LUMN"],
  "非必需消费": ["AMZN","TSLA","HD","MCD","NKE","SBUX","LOW","TJX","BKNG","MAR","HLT","RCL","CCL","NCLH","MGM","WYNN","LVS","DKNG","ABNB","UBER","LYFT","DASH","EXPE","EBAY","ETSY","CHWY","F","GM","RIVN","LCID","CVNA","LULU","BURL","FIVE","PTON","SPOT"],
  "医疗健康": ["LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","DHR","SYK","BSX","ISRG","AMGN","GILD","BIIB","REGN","VRTX","MRNA","BNTX","NVAX","INCY","BEAM","EDIT","CRSP","AXSM","HIMS","TDOC","VEEV","DOCS","GH","NVCR","ACAD","ARWR","AUPH"],
  "金融": ["JPM","BAC","WFC","GS","MS","C","USB","TFC","PNC","COF","AXP","DFS","SYF","ALLY","SOFI","AFRM","UPST","V","MA","PYPL","SQ","FIS","FISV","GPN","HOOD","IBKR","SCHW","BLK","ICE","CME","CBOE","SPGI","MCO","COIN","MSTR"],
  "工业": ["GE","HON","UPS","RTX","LMT","NOC","GD","BA","CAT","DE","EMR","ROK","AME","PH","IR","GWW","FDX","UNP","CSX","NSC","JBHT","ODFL","XPO","SAIA","AXON","CACI","LDOS","SAIC","BAH","KTOS"],
  "能源": ["XOM","CVX","COP","EOG","OXY","DVN","FANG","MRO","APA","HES","VLO","PSX","MPC","SLB","HAL","BKR","KMI","WMB","ET","EPD","LNG","AR","EQT","RRC","SMR","NNE","OKLO","CCJ","UEC","ENPH","SEDG","ARRY","RUN"],
  "原材料": ["LIN","APD","SHW","ECL","DD","DOW","LYB","NEM","GOLD","AEM","KGC","FCX","SCCO","MP","ALB","SQM","LAC","X","NUE","STLD","CLF","VALE","RIO","BHP","LTHM","SGML"],
  "医疗健康": ["LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","DHR","SYK","BSX","ISRG","AMGN","GILD","REGN","VRTX","MRNA","AXSM","HIMS"],
  "房地产": ["PLD","AMT","EQIX","CCI","DLR","SBAC","WELL","VTR","SPG","O","VICI","GLPI","EXR","CUBE","AVB","EQR","ARE","BXP"],
  "公用事业": ["NEE","DUK","SO","AEP","EXC","SRE","D","PCG","ED","XEL","WEC","DTE","CMS","ETR","PPL","AWK"],
  "量子计算": ["IONQ","RGTI","QBTS","QUBT","ARQQ","QTUM","IBM"],
  "人工智能": ["PLTR","AI","BBAI","SOUN","PATH","VRNS","UPWK","NVDA","MSFT","GOOGL","META","CRM","NOW","ORCL"],
  "加密/区块链": ["MSTR","COIN","MARA","RIOT","CLSK","HUT","BTBT","CIFR","WULF","BKKT"],
  "太空/国防": ["RKLB","ASTS","LUNR","KTOS","LMT","NOC","RTX","GD","BA","AXON","CACI","LDOS","SAIC","BAH"],
  "核能/清洁能源": ["SMR","NNE","OKLO","BWXT","LEU","LTBR","CCJ","UEC","DNN","PLUG","FCEL","BE","ENPH","SEDG"],
  "金融科技": ["HOOD","SOFI","AFRM","UPST","LC","DAVE","MQ","SQ","PYPL","BILL","FUTU","TIGR","FOUR","FLYW"],
};

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://finance.yahoo.com/",
};

async function fetchMultiDayChart(ticker) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 86400 * 30;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!txt || txt[0] !== "{") return null;
    const j = JSON.parse(txt);
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const meta = res.meta;
    const q = res.indicators.quote[0];
    const ts = res.timestamp ?? [];
    if (!ts.length) return null;
    const bars = ts.map((t, i) => ({ v: q.volume?.[i] ?? 0, c: q.close?.[i], h: q.high?.[i], l: q.low?.[i] })).filter(b => b.c);
    const last = bars.length - 1;
    const avgVol = bars.slice(0, -1).reduce((s, b) => s + b.v, 0) / Math.max(bars.length - 1, 1);
    const prevClose = bars.length >= 2 ? bars[last - 1].c : meta.chartPreviousClose;
    const chgPct = prevClose ? ((bars[last].c - prevClose) / prevClose) * 100 : 0;
    const volRatio = avgVol > 0 ? bars[last].v / avgVol : 1;
    const todayADR = bars[last].l > 0 ? ((bars[last].h - bars[last].l) / bars[last].l) * 100 : 0;
    const hi52 = meta.fiftyTwoWeekHigh;
    const nearHigh = hi52 && bars[last].c >= hi52 * 0.80;
    return { symbol: ticker, chgPct, volRatio, todayADR, nearHigh, price: bars[last].c };
  } catch { return null; }
}

async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function scoreSector(quotes, name) {
  const valid = quotes.filter(Boolean);
  if (!valid.length) return null;
  const avgChg = valid.reduce((s, q) => s + q.chgPct, 0) / valid.length;
  const avgVolRatio = valid.reduce((s, q) => s + q.volRatio, 0) / valid.length;
  const breadth = valid.filter(q => q.chgPct > 0).length / valid.length;
  const nearHighPct = valid.filter(q => q.nearHigh).length / valid.length;
  const avgAdr = valid.reduce((s, q) => s + q.todayADR, 0) / valid.length;
  const heat = Math.min(Math.round(
    Math.min((avgVolRatio - 1) / 3, 1) * 35 + breadth * 20 +
    Math.min(Math.max(avgChg / 5, 0), 1) * 20 + nearHighPct * 15 +
    Math.min(avgAdr / 10, 1) * 10
  ), 100);
  const topMovers = [...valid].sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct)).slice(0, 3)
    .map(q => ({ ticker: q.symbol, chg: +q.chgPct.toFixed(2), price: +q.price.toFixed(2), volRatio: +q.volRatio.toFixed(1) }));
  return { sector: name, heat, avgChg: +avgChg.toFixed(2), avgVolRatio: +avgVolRatio.toFixed(2), breadth: Math.round(breadth * 100), nearHighPct: Math.round(nearHighPct * 100), avgAdr: +avgAdr.toFixed(1), tickerCount: valid.length, topMovers };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const allTickers = [...new Set(Object.values(SECTOR_TICKERS).flat())];
    const tasks = allTickers.map(t => () => fetchMultiDayChart(t));
    const results = await pLimit(tasks, 15);
    const quoteMap = {};
    results.forEach((r, i) => { if (r) quoteMap[allTickers[i]] = r; });
    const data = Object.entries(SECTOR_TICKERS).map(([name, tickers]) => {
      const quotes = tickers.map(t => quoteMap[t]).filter(Boolean);
      return scoreSector(quotes, name);
    }).filter(Boolean).sort((a, b) => b.heat - a.heat);
    res.status(200).json({ data, totalQuotes: Object.keys(quoteMap).length, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, data: [], updatedAt: new Date().toISOString() });
  }
}
