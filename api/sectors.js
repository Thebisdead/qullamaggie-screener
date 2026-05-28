// api/sectors.js — Qullamaggie Screener: Sector Heatmap
// TradingView Scanner API — ONE bulk POST, all field names verified

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
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TradingView ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const payload = {
      filter: [
        { left: 'market_cap_basic',        operation: 'greater', right: 300_000_000 },
        { left: 'average_volume_10d_calc',  operation: 'greater', right: 200_000 },
        { left: 'type',                     operation: 'equal',   right: 'stock' },
        { left: 'subtype',                  operation: 'in',      right: ['common', 'foreign-issuer'] },
      ],
      options: { lang: 'en' },
      markets: ['america'],
      columns: [
        'name',                     // 0
        'close',                    // 1
        'change',                   // 2  today % change
        'volume',                   // 3
        'average_volume_10d_calc',  // 4
        'relative_volume_10d_calc', // 5  vol/avg — verified
        'price_52_week_high',       // 6  verified (not High.52W)
        'sector',                   // 7
        'ADRP',                     // 8  avg daily range % — verified (not "ADR Percent")
      ],
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, 2000],
    };

    const data = await fetchTV(payload);
    const rows = data?.data ?? [];

    // Group by sector
    const sectorMap = {};
    for (const row of rows) {
      const [name, close, chg, vol, avgVol, volRatio, high52, sector, adrp] = row.d;
      if (!sector) continue;
      if (!sectorMap[sector]) sectorMap[sector] = [];
      sectorMap[sector].push({ name, close, chg, volRatio, high52, adrp });
    }

    const results = Object.entries(sectorMap).map(([sector, stocks]) => {
      const valid = stocks.filter(s => s.chg != null);
      if (!valid.length) return null;

      const avgChg      = valid.reduce((a, s) => a + (s.chg ?? 0), 0) / valid.length;
      const avgVolRatio = valid.reduce((a, s) => a + (s.volRatio ?? 1), 0) / valid.length;
      const breadth     = valid.filter(s => (s.chg ?? 0) > 0).length / valid.length * 100;
      const nearHigh    = valid.filter(s => s.high52 > 0 && s.close / s.high52 >= 0.85).length / valid.length * 100;
      const avgAdr      = valid.reduce((a, s) => a + (s.adrp ?? 0), 0) / valid.length;

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

      return { sector, heat, avgChg: +avgChg.toFixed(2), avgVolRatio: +avgVolRatio.toFixed(2), breadth: Math.round(breadth), nearHighPct: Math.round(nearHigh), tickerCount: valid.length, topMovers };
    }).filter(Boolean).sort((a, b) => b.heat - a.heat);

    res.status(200).json({ data: results, updatedAt: new Date().toISOString(), totalQuotes: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
