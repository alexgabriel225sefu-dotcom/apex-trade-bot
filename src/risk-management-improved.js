/**
 * IMPROVED RISK MANAGEMENT
 * - Adaptive stop loss based on ATR
 * - Trailing stop for profit protection
 * - Confirmation candle logic
 * - Position sizing based on volatility
 */

/**
 * Calculate adaptive stop loss based on ATR
 * Instead of fixed %, use ATR to adapt to market volatility
 */
function calculateAdaptiveStopLoss(entryPrice, direction, atrValue, atrPct) {
  const atrMultiplier = 2.0; // Use 2× ATR for stop loss
  const stopDistance = atrValue * atrMultiplier;
  
  if (direction === 'LONG') {
    const stopLoss = entryPrice - stopDistance;
    return {
      stopPrice: stopLoss,
      stopPct: ((entryPrice - stopLoss) / entryPrice * 100).toFixed(2),
      method: 'ATR-based',
      atrMultiplier,
    };
  } else {
    const stopLoss = entryPrice + stopDistance;
    return {
      stopPrice: stopLoss,
      stopPct: ((stopLoss - entryPrice) / entryPrice * 100).toFixed(2),
      method: 'ATR-based',
      atrMultiplier,
    };
  }
}

/**
 * Calculate trailing stop
 * Moves stop loss up (for LONG) or down (for SHORT) as price moves favorably
 * Lock in profits while allowing upside
 */
function calculateTrailingStop(currentPrice, entryPrice, direction, atrValue, trailingAtrMultiplier = 1.5) {
  const trailingDistance = atrValue * trailingAtrMultiplier;
  
  if (direction === 'LONG') {
    // For LONG: trailing stop is below current price
    const trailingStop = currentPrice - trailingDistance;
    // But never move stop loss BELOW entry (that would be a loss)
    const finalStop = Math.max(trailingStop, entryPrice);
    
    return {
      trailingStopPrice: finalStop,
      profitLocked: finalStop > entryPrice ? ((finalStop - entryPrice) / entryPrice * 100).toFixed(2) : '0',
      isActive: currentPrice > entryPrice, // Only active if in profit
    };
  } else {
    // For SHORT: trailing stop is above current price
    const trailingStop = currentPrice + trailingDistance;
    // But never move stop loss ABOVE entry
    const finalStop = Math.min(trailingStop, entryPrice);
    
    return {
      trailingStopPrice: finalStop,
      profitLocked: entryPrice > finalStop ? ((entryPrice - finalStop) / entryPrice * 100).toFixed(2) : '0',
      isActive: currentPrice < entryPrice, // Only active if in profit
    };
  }
}

/**
 * Confirmation candle logic
 * Wait for 1-2 candles to confirm signal before entering
 * Reduces false signals
 */
function needsConfirmationCandle(signal, recentCandles, direction) {
  if (!signal || signal === 'HOLD') return false;
  
  if (recentCandles.length < 2) return true; // Not enough data
  
  const lastCandle = recentCandles[recentCandles.length - 1];
  const prevCandle = recentCandles[recentCandles.length - 2];
  
  // For BUY signal: confirm with bullish candle (close > open)
  if (signal === 'BUY' || direction === 'LONG') {
    const isBullish = lastCandle.close > lastCandle.open;
    const bodySize = ((lastCandle.close - lastCandle.open) / lastCandle.open * 100);
    
    // Need confirmation: bullish candle with decent body (>0.3%)
    return !isBullish || bodySize < 0.3;
  }
  
  // For SELL signal: confirm with bearish candle (close < open)
  if (signal === 'SELL' || direction === 'SHORT') {
    const isBearish = lastCandle.close < lastCandle.open;
    const bodySize = ((lastCandle.open - lastCandle.close) / lastCandle.open * 100);
    
    // Need confirmation: bearish candle with decent body (>0.3%)
    return !isBearish || bodySize < 0.3;
  }
  
  return false;
}

/**
 * Adaptive position sizing based on volatility
 * High volatility = smaller position
 * Low volatility = larger position
 */
function calculateAdaptivePositionSize(balance, riskPct, atrPct, baseRiskPct = 2) {
  // Volatility multiplier: if ATR is high, reduce position
  const volatilityMultiplier = baseRiskPct / Math.max(atrPct, 0.5);
  const adjustedRiskPct = Math.min(riskPct * volatilityMultiplier, riskPct * 1.5); // Cap at 1.5x
  
  const positionSize = (balance * adjustedRiskPct) / 100;
  
  return {
    positionSize: positionSize.toFixed(2),
    adjustedRiskPct: adjustedRiskPct.toFixed(2),
    volatilityMultiplier: volatilityMultiplier.toFixed(2),
    reason: atrPct > baseRiskPct ? 'Volatility high - reduced position' : 'Normal volatility',
  };
}

/**
 * Breakeven protection
 * Move stop loss to entry price after reaching X% profit
 */
function calculateBreakevenStop(currentPrice, entryPrice, direction, breakEvenTriggerPct = 1.0) {
  if (direction === 'LONG') {
    const profit = ((currentPrice - entryPrice) / entryPrice * 100);
    if (profit >= breakEvenTriggerPct) {
      return {
        shouldMoveStop: true,
        newStopPrice: entryPrice,
        profitProtected: profit.toFixed(2),
      };
    }
  } else {
    const profit = ((entryPrice - currentPrice) / entryPrice * 100);
    if (profit >= breakEvenTriggerPct) {
      return {
        shouldMoveStop: true,
        newStopPrice: entryPrice,
        profitProtected: profit.toFixed(2),
      };
    }
  }
  
  return { shouldMoveStop: false };
}

/**
 * Partial take profit logic
 * Close 50% of position at TP1, let rest run to TP2
 */
function calculatePartialTakeProfit(entryPrice, direction, takeProfitPct = 2.0) {
  const tp1Pct = takeProfitPct * 0.5; // 50% of TP at TP1
  const tp2Pct = takeProfitPct; // Full TP at TP2
  
  if (direction === 'LONG') {
    return {
      tp1Price: (entryPrice * (1 + tp1Pct / 100)).toFixed(6),
      tp1Pct: tp1Pct.toFixed(2),
      tp2Price: (entryPrice * (1 + tp2Pct / 100)).toFixed(6),
      tp2Pct: tp2Pct.toFixed(2),
      tp1CloseSize: 0.5, // Close 50%
      tp2CloseSize: 1.0, // Close remaining 50%
    };
  } else {
    return {
      tp1Price: (entryPrice * (1 - tp1Pct / 100)).toFixed(6),
      tp1Pct: tp1Pct.toFixed(2),
      tp2Price: (entryPrice * (1 - tp2Pct / 100)).toFixed(6),
      tp2Pct: tp2Pct.toFixed(2),
      tp1CloseSize: 0.5,
      tp2CloseSize: 1.0,
    };
  }
}

module.exports = {
  calculateAdaptiveStopLoss,
  calculateTrailingStop,
  needsConfirmationCandle,
  calculateAdaptivePositionSize,
  calculateBreakevenStop,
  calculatePartialTakeProfit,
};
