// Dashboard module - cinematic dark theme with real trading data
module.exports = {
  getDashboardHTML: (dash, tickCount, tvSym, pnlTotal, pnlColor, wins, losses, winRate, posHtml, tradesHtml) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apex Trade Bot - Advanced Dashboard</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: linear-gradient(135deg, rgba(13, 148, 136, 0.12) 0%, rgba(234, 88, 12, 0.08) 100%), #0a0a0f;
      background-attachment: fixed;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      min-height: 100vh;
      backdrop-filter: blur(10px);
      overflow-x: hidden;
    }

    header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 24px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid rgba(13, 148, 136, 0.3);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(20px);
    }

    header h1 {
      font-size: 1.8rem;
      font-weight: 800;
      letter-spacing: -1px;
      background: linear-gradient(90deg, #06b6d4 0%, #ea580c 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: 0 0 30px rgba(6, 182, 212, 0.3);
    }

    .header-right {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .badge {
      font-size: 0.75rem;
      padding: 8px 16px;
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(234, 88, 12, 0.1));
      color: #06b6d4;
      border: 1.5px solid rgba(6, 182, 212, 0.5);
      font-weight: 700;
      letter-spacing: 0.05em;
      backdrop-filter: blur(10px);
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #10b981;
      animation: pulse 2s infinite;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 18px;
      padding: 32px;
      max-width: 1600px;
      margin: 0 auto;
    }

    .card {
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
      border: 1.5px solid rgba(13, 148, 136, 0.3);
      border-radius: 20px;
      padding: 24px;
      text-align: center;
      backdrop-filter: blur(20px);
      transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
      transition: left 0.6s ease;
    }

    .card:hover::before {
      left: 100%;
    }

    .card:hover {
      border-color: rgba(6, 182, 212, 0.8);
      transform: translateY(-8px) scale(1.02);
      box-shadow: 0 20px 60px rgba(6, 182, 212, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.1);
    }

    .card .val {
      font-size: 2.2rem;
      font-weight: 800;
      margin: 10px 0;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #06b6d4, #ea580c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .card .lbl {
      font-size: 0.7rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
    }

    .green { color: #10b981; }
    .red { color: #ef4444; }
    .blue { color: #06b6d4; }
    .yellow { color: #f59e0b; }
    .orange { color: #ea580c; }

    .chart-wrap {
      margin: 0 32px;
      border-radius: 20px;
      overflow: hidden;
      border: 1.5px solid rgba(13, 148, 136, 0.3);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(10px);
    }

    .section {
      padding: 32px;
      max-width: 1600px;
      margin: 0 auto;
    }

    .section h2 {
      font-size: 1rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-bottom: 18px;
      font-weight: 800;
      background: linear-gradient(90deg, #06b6d4, #ea580c);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .pos-box {
      padding: 20px;
      border-radius: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 0.95rem;
      margin-bottom: 12px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
      border: 1.5px solid rgba(13, 148, 136, 0.3);
    }

    .pos-box.long {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.08));
      border-color: rgba(16, 185, 129, 0.5);
    }

    .pos-box.short {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.08));
      border-color: rgba(239, 68, 68, 0.5);
    }

    .pos-box.neutral {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.6));
      border-color: rgba(107, 114, 128, 0.3);
      color: #94a3b8;
    }

    .pos-label {
      font-weight: 800;
      font-size: 1.2rem;
      width: 100%;
      letter-spacing: -0.5px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    th {
      color: #94a3b8;
      font-weight: 700;
      padding: 14px 10px;
      border-bottom: 2px solid rgba(13, 148, 136, 0.3);
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: rgba(15, 23, 42, 0.6);
    }

    td {
      padding: 12px 10px;
      border-bottom: 1px solid rgba(30, 41, 59, 0.8);
    }

    tr.win {
      background: rgba(16, 185, 129, 0.1);
    }

    tr.win td {
      color: #d1fae5;
    }

    tr.loss {
      background: rgba(239, 68, 68, 0.1);
    }

    tr.loss td {
      color: #fee2e2;
    }

    tr:hover {
      background: rgba(6, 182, 212, 0.12);
    }

    .refresh {
      font-size: 0.8rem;
      color: #64748b;
      padding: 16px 32px;
      text-align: center;
      border-top: 1.5px solid rgba(13, 148, 136, 0.2);
      background: rgba(15, 23, 42, 0.4);
    }

    @media (max-width: 768px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        padding: 16px;
      }
      .chart-wrap {
        margin: 0 12px;
      }
      .section {
        padding: 16px;
      }
      header {
        padding: 16px 20px;
        flex-direction: column;
        gap: 12px;
      }
      header h1 {
        font-size: 1.4rem;
      }
      .header-right {
        width: 100%;
        justify-content: space-between;
      }
    }
  </style>
  <script>setTimeout(() => location.reload(), 30000)</script>
</head>
<body>
  <header>
    <h1>⚡ Apex Trade Bot</h1>
    <div class="header-right">
      <div class="status-indicator"></div>
      <span class="badge">${dash.mode} · ${dash.exchange}</span>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="lbl">💰 Balance</div>
      <div class="val green">$${dash.balance.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="lbl">📈 Total PnL</div>
      <div class="val" style="color: ${pnlColor}">${parseFloat(pnlTotal) >= 0 ? '+' : ''}${pnlTotal}%</div>
    </div>
    <div class="card">
      <div class="lbl">🎯 Total Trades</div>
      <div class="val blue">${dash.trades.length}</div>
    </div>
    <div class="card">
      <div class="lbl">✅ Win Rate</div>
      <div class="val yellow">${winRate}${winRate !== '—' ? '%' : ''}</div>
    </div>
    <div class="card">
      <div class="lbl">📊 Tick Count</div>
      <div class="val orange">#${tickCount}</div>
    </div>
    <div class="card">
      <div class="lbl">💹 Current Price</div>
      <div class="val">$${dash.currentPrice?.toFixed(4) || '—'}</div>
    </div>
  </div>

  <div class="chart-wrap">
    <iframe src="https://www.tradingview.com/widgetembed/?frameElementId=tv&symbol=${tvSym}&interval=5&hidesidetoolbar=1&hidetoptoolbar=0&theme=dark&style=1&timezone=Europe%2FBucharest&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=0&save_image=0&studies=RSI%401%2CMASimple%401&calendar=0&support_host=https%3A%2F%2Fwww.tradingview.com" width="100%" height="500" frameborder="0" allowtransparency="true" scrolling="no"></iframe>
  </div>

  <div class="section">
    <h2>📍 Active Position</h2>
    ${posHtml}
  </div>

  <div class="section">
    <h2>📋 Trade History</h2>
    <div style="overflow-x: auto; border-radius: 16px; border: 1.5px solid rgba(13, 148, 136, 0.3);">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Symbol</th>
            <th>Type</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>PnL</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${tradesHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="refresh">
    ⏱️ Auto-refresh every 30s · Last tick: ${dash.lastTick || '—'}
  </div>
</body>
</html>`;
  }
};
