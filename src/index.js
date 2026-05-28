require('dotenv').config();
const cfg        = require('./config');
const indicators = require('./indicators');
const ai         = require('./ai');
const logger     = require('./logger');
const strategies = require('./strategies');
const tg         = require('./telegram');
const state      = require('./state');
const http       = require('http');
const dashboardModule = require('./dashboard');

// ─── Exchange ─────────────────────────────────────────────
const exchange = cfg.EXCHANGE === 'binance'
  ? require('./binance')
  : require('./bybit');

// ─── State ────────────────────────────────────────────────
let openPosition      = null;
let paperBalance      = cfg.PAPER_BALANCE;
let tickCount         = 0;
let startBalance      = 0;
let stopAlertedAt     = 0;

// ─── Dashboard Data ───────────────────────────────────────
const dash = {
  balance:       0,
  startBalance:  0,
  currentSymbol: cfg.SYMBOL,
  currentPrice:  0,
  openPosition:  null,
  trades:        [],
  lastTick:      null,
  mode:          cfg.PAPER_TRADING ? 'PAPER' : cfg.BYBIT_TESTNET || cfg.BINANCE_TESTNET ? 'TESTNET' : 'LIVE',
  exchange:      cfg.EXCHANGE.toUpperCase(),
};

// ─── License verification ─────────────────────────────────
async function verifyLicense() {
  const key    = cfg.LICENSE_KEY;
  const server = cfg.LICENSE_SERVER;

  if (!key) {
    if (process.env.BYPASS_LICENSE === 'true') {
      console.warn('⚠️  LICENSE_KEY not set — running in owner/dev mode (BYPASS_LICENSE=true).');
      return;
    }
    console.error('\n❌  LICENSE_KEY is not set.');
    console.error('    Add your license key from your purchase email to Railway Variables.');
    console.error('    Purchase at: https://aicashsystem.space\n');
    process.exit(1);
  }

  try {
    const res  = await fetch(`${server}/api/verify-license`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key }),
      signal:  AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.valid) {
      console.error(`\n❌  License invalid: ${data.message}`);
      console.error('    Make sure LICENSE_KEY in Variables matches the key from your email.\n');
      process.exit(1);
    }
    console.log(`✅  License verified — welcome, ${data.email || 'trader'}!`);
  } catch (e) {
    console.warn(`⚠️   License server unreachable (${e.message}) — starting in grace mode.`);
  }
}

// ─── Validare startup ─────────────────────────────────────
function validate() {
  const hasAnthropic = !!cfg.ANTHROPIC_API_KEY;
  const hasGroq      = !!process.env.GROQ_API_KEY;

  if (!hasAnthropic && !hasGroq) {
    console.error('❌ No AI key found! Add ANTHROPIC_API_KEY or GROQ_API_KEY to Variables.');
    process.exit(1);
  }
  if (!hasAnthropic && hasGroq) {
    console.log('ℹ️  ANTHROPIC_API_KEY missing — using Groq (free) as AI provider.');
  }
  if (hasAnthropic && hasGroq) {
    console.log('ℹ️  Anthropic + Groq configured — Anthropic primary, Groq fallback.');
  }

  const hasKey = cfg.EXCHANGE === 'binance' ? cfg.BINANCE_API_KEY : cfg.BYBIT_API_KEY;
  if (!hasKey && !cfg.PAPER_TRADING) {
    console.warn('⚠️  No exchange API key found — falling back to PAPER TRADING automatically');
    cfg.PAPER_TRADING = true;
  }
}

// ─── Balanta ──────────────────────────────────────────────
async function getBalance() {
  if (cfg.PAPER_TRADING) return paperBalance;
  try { return await exchange.getBalance(); }
  catch (e) {
    logger.warn(`[BALANCE] API error: ${e.message} — check API keys & BINANCE_TESTNET flag`);
    return 0;
  }
}

// ─── Calcul cantitate ─────────────────────────────────────
async function calcQuantity(price, balance, symbol = cfg.SYMBOL, druckMult = 1.0) {
  const riskAmount = balance * cfg.RISK_PER_TRADE * druckMult;
  const qty        = riskAmount / price;
  const isWhole    = ['DOGEUSDT','SHIBUSDT','XRPUSDT','ADAUSDT','MATICUSDT','TRXUSDT'].includes(symbol);
  const result     = isWhole ? Math.floor(qty) : parseFloat(qty.toFixed(6));
  return result;
}

// ─── Calculeaza SL/TP ──────────────────────────────────────
function calcSLTP(side, price, atrValue) {
  if (cfg.ATR_BASED_SL && atrValue > 0) {
    const slDist = atrValue * cfg.ATR_SL_MULT;
    const tpDist = atrValue * cfg.ATR_TP_MULT;
    return {
      stopLoss:   side === 'BUY' ? price - slDist : price + slDist,
      takeProfit: side === 'BUY' ? price + tpDist : price - tpDist,
    };
  }
  return {
    stopLoss:   side === 'BUY' ? price * (1 - cfg.STOP_LOSS_PCT)   : price * (1 + cfg.STOP_LOSS_PCT),
    takeProfit: side === 'BUY' ? price * (1 + cfg.TAKE_PROFIT_PCT) : price * (1 - cfg.TAKE_PROFIT_PCT),
  };
}

// ─── Verifica SL/TP si Trailing Stop ─────────────────────
function checkPosition(price) {
  if (!openPosition) return null;
  const { side, stopLoss, takeProfit } = openPosition;

  if (cfg.TRAILING_STOP) {
    if (side === 'BUY') {
      openPosition.trailHigh = Math.max(openPosition.trailHigh ?? price, price);
      const trailSL = openPosition.trailHigh * (1 - cfg.TRAILING_STOP_DIST);
      if (trailSL > openPosition.stopLoss) {
        openPosition.stopLoss = trailSL;
      }
    } else {
      openPosition.trailLow = Math.min(openPosition.trailLow ?? price, price);
      const trailSL = openPosition.trailLow * (1 + cfg.TRAILING_STOP_DIST);
      if (trailSL < openPosition.stopLoss) {
        openPosition.stopLoss = trailSL;
      }
    }
  }

  const pnlPct = side === 'BUY'
    ? (price - openPosition.entryPrice) / openPosition.entryPrice * 100
    : (openPosition.entryPrice - price) / openPosition.entryPrice * 100;
  openPosition.pnlPct = pnlPct;

  if (side === 'BUY') {
    if (price <= openPosition.stopLoss)  return 'STOP_LOSS';
    if (price >= takeProfit)              return 'TAKE_PROFIT';
  }
  if (side === 'SELL') {
    if (price >= openPosition.stopLoss)  return 'STOP_LOSS';
    if (price <= takeProfit)             return 'TAKE_PROFIT';
  }
  return null;
}

// ─── Deschide pozitie ─────────────────────────────────────
async function openTrade(side, price, balance, atrValue = 0, symbol = cfg.SYMBOL, druckMult = 1.0) {
  const quantity = await calcQuantity(price, balance, symbol, druckMult);
  if (quantity <= 0) { logger.warn(`Cantitate prea mica pentru ${symbol} @ $${price} — skip`); return; }
  if (druckMult !== 1.0) logger.info(`🎯 Druckenmiller: marime pozitie x${druckMult.toFixed(2)}`);

  await exchange.placeOrder(side, quantity, symbol);

  if (cfg.PAPER_TRADING) {
    if (side === 'BUY') paperBalance -= price * quantity;
    else                paperBalance += price * quantity;
  }

  const { stopLoss, takeProfit } = calcSLTP(side, price, atrValue);
  const rrRatio = Math.abs(takeProfit - price) / Math.abs(price - stopLoss);

  openPosition = {
    symbol,
    side, entryPrice: price, quantity, stopLoss, takeProfit,
    openedAt: new Date().toISOString(), pnlPct: 0,
    trailHigh: side === 'BUY' ? price : null,
    trailLow:  side === 'SELL' ? price : null,
  };
  dash.openPosition = openPosition;

  logger.printTrade(side, symbol, price, quantity);
  logger.info(`SL: $${stopLoss.toFixed(5)} | TP: $${takeProfit.toFixed(5)} | R:R = 1:${rrRatio.toFixed(2)}`);
  tg.alertOpen(side, symbol, price, quantity, stopLoss, takeProfit, druckMult);
  state.save(paperBalance, openPosition);
}

// ─── Inchide pozitie ──────────────────────────────────────
async function closeTrade(price, reason) {
  if (!openPosition) return;
  const { side, entryPrice, quantity, symbol = cfg.SYMBOL } = openPosition;
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';

  await exchange.placeOrder(closeSide, quantity, symbol);

  const pnl = side === 'BUY'
    ? (price - entryPrice) * quantity
    : (entryPrice - price) * quantity;

  if (cfg.PAPER_TRADING) {
    if (side === 'BUY') paperBalance += price * quantity;
    else                paperBalance -= price * quantity;
  }

  logger.printTrade(closeSide, symbol, price, quantity, pnl);
  logger.info(`Motivul: ${reason} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`);
  strategies.recordTrade(pnl > 0, pnl, startBalance || cfg.PAPER_BALANCE);
  const bal = await getBalance();
  tg.alertClose(reason, symbol, side, entryPrice, price, pnl, bal);

  dash.trades.unshift({
    time:       new Date().toLocaleString('en-US'),
    symbol,
    side,
    entry:      entryPrice,
    exit:       price,
    qty:        quantity,
    pnl:        parseFloat(pnl.toFixed(4)),
    pnlPct:     parseFloat(((pnl / (entryPrice * quantity)) * 100).toFixed(2)),
    reason,
    win:        pnl > 0,
  });
  if (dash.trades.length > 50) dash.trades.pop();
  dash.openPosition = null;
  dash.balance      = bal;

  openPosition = null;
  state.save(paperBalance, null);
}

// ─── Selecteaza cel mai bun simbol ──────────────────────
async function bestSymbol() {
  if (!cfg.MULTI_SYMBOL || cfg.SCAN_SYMBOLS.length <= 1) return cfg.SYMBOL;

  const results = await Promise.all(cfg.SCAN_SYMBOLS.map(async sym => {
    try {
      const candles = await exchange.getCandles(sym, cfg.TIMEFRAME, 50);
      const ind     = indicators.analyze(candles);
      const rsiNum  = parseFloat(ind.rsi);
      const macdH   = parseFloat(ind.macdHist);
      const volR    = parseFloat(ind.volumeRatio);
      const score = (Math.abs(rsiNum - 50) / 50) * 0.4 + Math.min(volR / 3, 1) * 0.4 + (Math.abs(macdH) > 0 ? 0.2 : 0);
      return { sym, score, ind };
    } catch { return { sym, score: 0, ind: null }; }
  }));

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (best.sym !== cfg.SYMBOL) logger.info(`📡 Scanner: best symbol → ${best.sym} (score: ${best.score.toFixed(2)})`);
  return best.sym;
}

// ─── Loop principal ───────────────────────────────────────
async function tick() {
  tickCount++;
  try {
    const activeSymbol = openPosition?.symbol ?? null;
    const symbol = activeSymbol || await bestSymbol();

    if (tickCount % 5 === 0) logger.printStats(await getBalance(), openPosition, await exchange.getPrice(symbol).catch(() => null));

    if (tickCount % 6 === 0) {
      const hbBalance = await getBalance();
      const hbPrice   = await exchange.getPrice(symbol).catch(() => null);
      tg.alertHeartbeat(tickCount, hbBalance, openPosition, hbPrice);
    }

    logger.info(`[${tickCount}] Analyzing ${symbol} (${cfg.EXCHANGE})${activeSymbol ? ' 🔒 active position' : ''}...`);

    const [candles, price] = await Promise.all([
      exchange.getCandles(symbol, cfg.TIMEFRAME, cfg.CANDLES),
      exchange.getPrice(symbol),
    ]);
    const balance = await getBalance();
    logger.updateBalance(balance);

    dash.balance       = balance;
    dash.currentSymbol = symbol;
    dash.currentPrice  = price;
    dash.lastTick      = new Date().toLocaleString('en-US');
    if (openPosition) {
      const posPnl = openPosition.side === 'BUY'
        ? (price - openPosition.entryPrice) * openPosition.quantity
        : (openPosition.entryPrice - price) * openPosition.quantity;
      dash.openPosition = { ...openPosition, currentPnl: parseFloat(posPnl.toFixed(4)) };
    }

    const trigger = checkPosition(price);
    if (trigger) {
      logger.warn(`${trigger} hit at $${price} (current SL: $${openPosition?.stopLoss?.toFixed(5)})`);
      await closeTrade(price, trigger);
      logger.printStats(await getBalance(), null, null);
      return;
    }

    const ind      = indicators.analyze(candles);
    const stratData = strategies.analyze(candles);

    let portfolioValue = balance;
    if (openPosition && price) {
      portfolioValue = openPosition.side === 'BUY'
        ? balance + openPosition.quantity * price
        : balance - openPosition.quantity * price;
    }
    const stopCheck = strategies.shouldStop(portfolioValue, startBalance || cfg.PAPER_BALANCE);
    if (stopCheck.stop) {
      logger.warn(`🛑 STRATEGY STOP: ${stopCheck.reasons.join(' | ')}`);
      if (openPosition) {
        logger.warn('Open position — keeping until natural SL/TP.');
      }
      const now = Date.now();
      if (now - stopAlertedAt > 30 * 60 * 1000) {
        tg.alertStop(stopCheck.reasons);
        stopAlertedAt = now;
      }
      logger.printStats(await getBalance(), openPosition, price);
      return;
    }

    if (stratData.livermore.trend !== 'NEUTRAL') {
      logger.info(`📊 Livermore: ${stratData.livermore.trend} (${stratData.livermore.reason}) | Strength: ${(stratData.livermore.strength * 100).toFixed(0)}%`);
    }
    if (stratData.turtle.signal) {
      logger.info(`🐢 Turtle: ${stratData.turtle.breakoutStr} breakout ${stratData.turtle.signal} | H20: ${stratData.turtle.high20} | L20: ${stratData.turtle.low20}`);
    }
    if (stratData.soros.direction !== 'NEUTRAL') {
      const sorosDir  = stratData.soros.direction;
      const sorosPct  = stratData.soros.direction === 'BEARISH'
        ? ((1 - stratData.soros.momentum) * 100).toFixed(0) + '% bearish'
        : (stratData.soros.momentum * 100).toFixed(0) + '% bullish';
      logger.info(`💡 Soros: momentum ${sorosDir} (${sorosPct}, velocity ${stratData.soros.velocity?.toFixed(2)}%)`);
    }

    const signal = await ai.getSignal(ind, balance, openPosition, stratData);
    logger.printSignal(signal, ind);

    const tooLowBalance = balance < 1;
    const minCriteria   = parseInt(process.env.MIN_CRITERIA   || '3');
    const minVolume     = parseFloat(process.env.MIN_VOLUME_RATIO || '0.7');
    const criteriaOk    = (signal.criteriaScore ?? 0) >= minCriteria;
    const volumeOk      = parseFloat(ind.volumeRatio) >= minVolume;

    if (tooLowBalance) {
      logger.warn('Balance too low ($' + balance.toFixed(2) + ') — stop trading');
      return;
    }
    if (!volumeOk && !openPosition) {
      logger.info(`⚠️ Insufficient volume (${ind.volumeRatio}x < ${minVolume}x) — HOLD, waiting for volume confirmation`);
    }

    const druckMult = !openPosition
      ? strategies.druckenmillerMultiplier(signal.confidence, signal.criteriaScore, stratData.livermore, stratData.turtle)
      : 1.0;

    const liveSTR   = stratData.livermore.strength ?? 0;
    const turtleSig = stratData.turtle.signal;
    if (!openPosition && signal.action === 'BUY' &&
        stratData.livermore.trend === 'BEARISH' && liveSTR >= 0.8 && turtleSig === 'SELL') {
      logger.warn(`⚡ Signal filtered: BUY against Livermore BEARISH ${(liveSTR*100).toFixed(0)}% + Turtle STRONG SELL — forced HOLD (PTJ: play defense)`);
      tg.alertFiltered('BUY', 'BEARISH 85%', 'STRONG SELL');
      signal.action = 'HOLD';
    }
    if (!openPosition && signal.action === 'SELL' &&
        stratData.livermore.trend === 'BULLISH' && liveSTR >= 0.8 && turtleSig === 'BUY') {
      logger.warn(`⚡ Signal filtered: SELL against Livermore BULLISH ${(liveSTR*100).toFixed(0)}% + Turtle STRONG BUY — forced HOLD (PTJ: play defense)`);
      tg.alertFiltered('SELL', 'BULLISH 85%', 'STRONG BUY');
      signal.action = 'HOLD';
    }

    if (signal.action === 'HOLD' || signal.confidence < cfg.MIN_CONFIDENCE || !criteriaOk || (!volumeOk && !openPosition)) {
      logger.info(`HOLD — confidence: ${signal.confidence}% | criteria: ${signal.criteriaScore ?? '?'}/5 | volume: ${ind.volumeRatio}x`);
    } else if (signal.action === 'CLOSE' && openPosition) {
      await closeTrade(price, 'AI_CLOSE');
    } else if (signal.action === 'BUY' && !openPosition) {
      await openTrade('BUY', price, balance, parseFloat(ind.atr), symbol, druckMult);
    } else if (signal.action === 'SELL' && !openPosition) {
      await openTrade('SELL', price, balance, parseFloat(ind.atr), symbol, druckMult);
    } else {
      logger.info(`Skip — position ${openPosition ? 'already open' : 'already closed'}`);
    }

    logger.printStats(await getBalance(), openPosition, price);
  } catch (err) {
    logger.error(`Tick error: ${err.message}`);
  }
}

// ─── Start ────────────────────────────────────────────────
async function main() {
  validate();

  if (cfg.PAPER_TRADING) {
    const saved = state.load(cfg.PAPER_BALANCE);
    if (saved) {
      paperBalance = saved.paperBalance;
      openPosition = saved.openPosition;
    }
  }

  const balance = await getBalance();
  startBalance       = balance;
  dash.balance       = balance;
  dash.startBalance  = balance;
  logger.setStartBalance(balance);
  logger.printBanner(balance);

  const isBinanceTestnet = cfg.EXCHANGE === 'binance'
    ? (process.env.BINANCE_TESTNET || '').toLowerCase().trim() !== 'false'
    : false;
  const isTestnet = cfg.BYBIT_TESTNET || isBinanceTestnet;
  const mode = cfg.PAPER_TRADING ? '📝 PAPER TRADING' : isTestnet ? '🧪 TESTNET' : '🔴 LIVE';
  dash.mode = mode.replace(/[📝🧪🔴]/g, '').trim();
  tg.alertStart(cfg.SYMBOL, cfg.TIMEFRAME, balance, mode);

  const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000');
  http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(dash));
      return;
    }
    const sym = (dash.currentSymbol || cfg.SYMBOL);
    const tvSym = `${dash.exchange === 'BINANCE' ? 'BINANCE' : 'BYBIT'}:${sym}`;
    const pnlTotal  = dash.startBalance > 0 ? ((dash.balance - dash.startBalance) / dash.startBalance * 100).toFixed(2) : '0.00';
    const pnlColor  = parseFloat(pnlTotal) >= 0 ? '#00ff88' : '#ff4466';
    const wins      = dash.trades.filter(t => t.win).length;
    const losses    = dash.trades.filter(t => !t.win).length;
    const winRate   = dash.trades.length > 0 ? ((wins / dash.trades.length) * 100).toFixed(0) : '—';
    const posHtml   = dash.openPosition
      ? `<div class="pos-box ${dash.openPosition.side === 'BUY' ? 'long' : 'short'}">
           <span class="pos-label">${dash.openPosition.side === 'BUY' ? '🟢 LONG' : '🔴 SHORT'} ${dash.openPosition.symbol}</span>
           <span>Entry: <b>$${dash.openPosition.entryPrice?.toFixed(5)}</b></span>
           <span>Qty: <b>${dash.openPosition.quantity}</b></span>
           <span>SL: <b>$${dash.openPosition.stopLoss?.toFixed(5)}</b></span>
           <span>TP: <b>$${dash.openPosition.takeProfit?.toFixed(5)}</b></span>
           <span class="${(dash.openPosition.currentPnl ?? 0) >= 0 ? 'green' : 'red'}">PnL: <b>${(dash.openPosition.currentPnl ?? 0) >= 0 ? '+' : ''}$${(dash.openPosition.currentPnl ?? 0).toFixed(4)}</b></span>
         </div>`
      : `<div class="pos-box neutral">⏳ No open position — waiting for signal...</div>`;
    const tradesHtml = dash.trades.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:#666">No trades yet</td></tr>'
      : dash.trades.map(t => `<tr class="${t.win ? 'win' : 'loss'}">
           <td>${t.time}</td><td>${t.symbol}</td>
           <td>${t.side === 'BUY' ? '🟢 LONG' : '🔴 SHORT'}</td>
           <td>$${t.entry?.toFixed(5)}</td><td>$${t.exit?.toFixed(5)}</td>
           <td>${t.win ? '+' : ''}$${t.pnl} (${t.pnlPct}%)</td>
           <td>${t.reason}</td>
         </tr>`).join('');
    const html = dashboardModule.getDashboardHTML(dash, tickCount, tvSym, pnlTotal, pnlColor, wins, losses, winRate, posHtml, tradesHtml);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }).listen(PORT, () => logger.info(`📊 Dashboard: http://localhost:${PORT}`));

  await verifyLicense();
  logger.info('🚀 First analysis...');
  await tick();
  setInterval(tick, cfg.LOOP_INTERVAL_MS);
  logger.info(`⏱️  Analysis every ${cfg.LOOP_INTERVAL_MS / 60000} minutes.`);
}

main().catch(err => { logger.error('Fatal: ' + err.message); process.exit(1); });
