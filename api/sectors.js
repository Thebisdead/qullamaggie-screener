// api/sectors.js
// Sector heatmap for Qullamaggie screener
// Uses Yahoo Finance quote endpoint (no API key needed)

const SECTORS = {
  'Technology':       ['AAPL','MSFT','NVDA','AMD','AVGO','ORCL','CRM','ADBE','INTC','QCOM','META','GOOGL','AMZN','TSLA','NFLX'],
  'Semiconductors':   ['NVDA','AMD','AVGO','QCOM','INTC','MU','AMAT','KLAC','LRCX','ON','TXN','MCHP','SWKS','MRVL','MPWR'],
  'Biotech/Healthcare':['LLY','UNH','JNJ','ABBV','MRK','TMO','DHR','ABT','AMGN','GILD','REGN','VRTX','BIIB','MRNA','ISRG'],
  'Energy':           ['XOM','CVX','COP','SLB','EOG','MPC','PSX','VLO','DVN','HAL','OXY','FANG','BKR','HES','APA'],
  'Financials':       ['JPM','BAC','WFC','GS','MS','BLK','SCHW','AXP','USB','PNC','TFC','COF','CME','ICE','SPGI'],
  'Consumer Discretionary': ['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','TJX','BKNG','MAR','HLT','GM','F','RIVN','LCID'],
  'Industrials':      ['CAT','DE','HON','UPS','BA','LMT','RTX','GE','MMM','UNP','CSX','NSC','FDX','EMR','ETN'],
  'Materials':        ['LIN','APD','SHW','ECL','NEM','FCX','NUE','ALB','CF','MOS','FMC','IFF','PPG','VMC','MLM'],
  'Real Estate':      ['AMT','PLD','CCI','EQIX','PSA','O','SPG','DLR','WELL','EQR','AVB','VTR','ARE','BXP','KIM'],
  'Utilities':        ['NEE','DUK','SO','D','AEP','SRE','EXC','ES','XEL','WEC','CMS','ETR','PPL','CNP','AES'],
};

async function fetchQuotes(tickers) {
  const symbols = tickers.join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,averageDailyVolume10Day,fiftyTwoWeekHigh,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  return json?.quoteResponse?.result ?? [];
}

function calcHeat(quotes) {
  if (!quotes.length) return { heat: 0, avgChg: 0, avgVolRatio: 1, breadth: 0, nearHighPct: 0 };

  const chgs       = quotes.map(q => q.regularMarketChangePercent ?? 0);
  const volRatios  = quotes.map(q => {
    const avg = q.averageDailyVolume10Day || 1;
    return (q.regularMarketVolume || 0) / avg;
  });
  const breadth    = quotes.filter(q => (q.regularMarketChangePercent ?? 0) > 0).length / quotes.length * 100;
  const nearHigh   = quotes.filter(q => {
    const p = q.regularMarketPrice ?? 0;
    const h = q.fiftyTwoWeekHigh ?? p;
    return h > 0 && (p / h) >= 0.85;
  }).length / quotes.length * 100;

  const avgChg     = chgs.reduce((a, b) => a + b, 0) / chgs.length;
  const avgVolRatio = volRatios.reduce((a, b) => a + b, 0) / volRatios.length;

  // Heat score: volRatio 35% + breadth 20% + avgChg 20% + nearHigh 15% + ADR proxy 10%
  const volScore   = Math.min(avgVolRatio / 3 * 100, 100) * 0.35;
  const breadScore = breadth * 0.20;
  const chgScore   = Math.min(Math.max((avgChg + 5) / 15 * 100, 0), 100) * 0.20;
  const highScore  = nearHigh * 0.15;
  const adrScore   = 50 * 0.10; // placeholder

  const heat = Math.round(volScore + breadScore + chgScore + highScore + adrScore);

  return { heat: Math.min(heat, 99), avgChg: +avgChg.toFixed(2), avgVolRatio: +avgVolRatio.toFixed(2), breadth: Math.round(breadth), nearHighPct: Math.round(nearHigh) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const results = [];

    for (const [sector, tickers] of Object.entries(SECTORS)) {
      try {
        const quotes = await fetchQuotes(tickers);
        const { heat, avgChg, avgVolRatio, breadth, nearHighPct } = calcHeat(quotes);

        const topMovers = quotes
          .map(q => ({
            ticker:   q.symbol,
            chg:      +(q.regularMarketChangePercent ?? 0).toFixed(2),
            volRatio: +((q.regularMarketVolume || 0) / Math.max(q.averageDailyVolume10Day || 1, 1)).toFixed(1),
          }))
          .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
          .slice(0, 3);

        results.push({ sector, heat, avgChg, avgVolRatio, breadth, nearHighPct, tickerCount: quotes.length, topMovers });
      } catch (_) {
        results.push({ sector, heat: 0, avgChg: 0, avgVolRatio: 1, breadth: 0, nearHighPct: 0, tickerCount: 0, topMovers: [] });
      }
    }

    results.sort((a, b) => b.heat - a.heat);

    res.status(200).json({
      data: results,
      updatedAt: new Date().toISOString(),
      totalQuotes: results.reduce((s, r) => s + r.tickerCount, 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
