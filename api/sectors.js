// api/sectors.js  —  Qullamaggie Screener: Sector Heatmap
// Uses TradingView scanner API (same as Martin Luk screener)
// One POST call returns pre-computed indicators for all stocks — no per-stock loops

const TV_SCAN = 'https://scanner.tradingview.com/america/scan';

const TV_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://www.tradingview.com',
  'Referer': 'https://www.tradingview.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Sector ETF → sector name mapping (for heatmap)
const SECTOR_ETFS = {
  'Technology':             ['XLK','QQQ','SMH','SOXX','IGV','SKYY'],
  'Semiconductors':         ['SMH','SOXX','SOXQ'],
  'Biotech/Healthcare':     ['XLV','IBB','XBI','ARKG'],
  'Energy':                 ['XLE','XOP','OIH'],
  'Financials':             ['XLF','KRE','KBE'],
  'Consumer Discretionary': ['XLY','IBUY','MAGS'],
  'Industrials':            ['XLI','ITA','XAR'],
  'Materials':              ['XLB','GDX','GDXJ'],
  'Real Estate':            ['XLRE','IYR'],
  'Utilities':              ['XLU'],
  'Communication Services': ['XLC','NXTG'],
  'Small Cap':              ['IWM','SCHA','VB'],
};

// GICS sector names as used by TradingView
const SECTOR_NAMES = [
  'Technology','Health Technology','Electronic Technology','Finance',
  'Energy Minerals','Consumer Durables','Producer Manufacturing',
  'Consumer Non-Durables','Retail Trade','Commercial Services',
  'Distribution Services','Process Industries','Transportation',
  'Health Services','Utilities','Miscellaneous','Non-Energy Minerals',
  'Communications','Industrial Services',
];

async function fetchTV(payload) {
  const r = await fetch(TV_SCAN, {
    method: 'POST',
    headers: TV_HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`TradingView HTTP ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Single bulk call: fetch all US stocks with sector + daily stats
    const payload = {
      filter: [
        { left: 'market_cap_basic', operation: 'greater', right: 300_000_000 },
        { left: 'average_volume_10d_calc', operation: 'greater', right: 200_000 },
        { left: 'type', operation: 'equal', right: 'stock' },
        { left: 'subtype', operation: 'in', right: ['common', 'foreign-issuer'] },
      ],
      options: { lang: 'en' },
      markets: ['america'],
      columns: [
        'name',
        'close',
        'change',                       // today % change
        'volume',
        'average_volume_10d_calc',      // 10d avg vol
        'relative_volume_10d_calc',     // vol/avg
        'High.52W',                     // 52w high
        'Low.52W',
        'sector',
        'ADR Percent',                  // Average Daily Range %
      ],
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, 2000],
    };

    const data = await fetchTV(payload);
    const rows = data?.data ?? [];

    // Group by sector
    const sectorMap = {};
    for (const row of rows) {
      const [name, close, chg, vol, avgVol, volRatio, high52, low52, sector, adr] = row.d;
      if (!sector) continue;
      if (!sectorMap[sector]) sectorMap[sector] = [];
      sectorMap[sector].push({ name, close, chg, vol, avgVol, volRatio, high52, low52, adr });
    }

    // Compute heat per sector
    const results = Object.entries(sectorMap).map(([sector, stocks]) => {
      const valid = stocks.filter(s => s.chg != null);
      if (!valid.length) return null;

      const avgChg = valid.reduce((a, s) => a + (s.chg ?? 0), 0) / valid.length;
      const avgVolRatio = valid.reduce((a, s) => a + (s.volRatio ?? 1), 0) / valid.length;
      const breadth = valid.filter(s => (s.chg ?? 0) > 0).length / valid.length * 100;
      const nearHigh = valid.filter(s => s.high52 > 0 && s.close / s.high52 >= 0.85).length / valid.length * 100;
      const avgAdr = valid.reduce((a, s) => a + (s.adr ?? 0), 0) / valid.length;

      // Heat = volRatio 35% + breadth 20% + chg 20% + nearHigh 15% + adr 10%
      const heat = Math.min(Math.round(
        Math.min(avgVolRatio / 3 * 100, 100) * 0.35 +
        breadth * 0.20 +
        Math.min(Math.max((avgChg + 5) / 15 * 100, 0), 100) * 0.20 +
        nearHigh * 0.15 +
        Math.min(avgAdr / 8 * 100, 100) * 0.10
      ), 99);

      const topMovers = [...valid]
        .sort((a, b) => Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0))
        .slice(0, 3)
        .map(s => ({ ticker: s.name, chg: +(s.chg ?? 0).toFixed(2), volRatio: +(s.volRatio ?? 1).toFixed(1) }));

      return {
        sector,
        heat,
        avgChg: +avgChg.toFixed(2),
        avgVolRatio: +avgVolRatio.toFixed(2),
        breadth: Math.round(breadth),
        nearHighPct: Math.round(nearHigh),
        tickerCount: valid.length,
        topMovers,
      };
    }).filter(Boolean).sort((a, b) => b.heat - a.heat);

    res.status(200).json({
      data: results,
      updatedAt: new Date().toISOString(),
      totalQuotes: rows.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
