"use strict";

function targetHealth(proxy, state, target) {
  return state.proxies?.[proxy.id]?.targets?.[target] ?? {};
}

function eligible(candidates, state, target, nowMs) {
  return candidates.filter((proxy) => {
    const cooldown = targetHealth(proxy, state, target).cooldown_until;
    return !cooldown || Date.parse(cooldown) <= nowMs;
  });
}

function rankFastest(candidates, state, context) {
  return eligible(candidates, state, context.target, context.nowMs)
    .sort((a, b) => Number(targetHealth(a, state, context.target).ewma_latency_ms ?? Infinity) -
      Number(targetHealth(b, state, context.target).ewma_latency_ms ?? Infinity));
}

function rankReliable(candidates, state, context) {
  return eligible(candidates, state, context.target, context.nowMs)
    .sort((a, b) => Number(targetHealth(b, state, context.target).success_rate ?? 0) -
      Number(targetHealth(a, state, context.target).success_rate ?? 0));
}

function balancedScore(proxy, state, context) {
  const health = targetHealth(proxy, state, context.target);
  const success = Number(health.success_rate ?? 0.5);
  const latency = Number(health.ewma_latency_ms ?? context.timeoutMs);
  const latencyScore = Math.max(0, 1 - latency / context.timeoutMs);
  const recency = health.last_success_at ? Math.max(0, 1 - (context.nowMs - Date.parse(health.last_success_at)) / 86_400_000) : 0;
  return success * 0.6 + latencyScore * 0.3 + recency * 0.1;
}

function rankBalanced(candidates, state, context) {
  const ranked = eligible(candidates, state, context.target, context.nowMs)
    .sort((a, b) => balancedScore(b, state, context) - balancedScore(a, state, context));
  if (ranked.length > 1 && context.random() < context.explorationRate) {
    const index = 1 + Math.floor(context.random() * (ranked.length - 1));
    [ranked[0], ranked[index]] = [ranked[index], ranked[0]];
  }
  return ranked;
}

function rankCandidates(candidates, state, options = {}) {
  const context = {
    explorationRate: options.explorationRate ?? 0.1,
    nowMs: options.nowMs ?? Date.now(),
    random: options.random ?? Math.random,
    target: options.target ?? "generic-https",
    timeoutMs: options.timeoutMs ?? 6000,
  };
  if (options.strategy === "fastest") return rankFastest(candidates, state, context);
  if (options.strategy === "reliable") return rankReliable(candidates, state, context);
  if (options.strategy === "round-robin") return eligible(candidates, state, context.target, context.nowMs);
  return rankBalanced(candidates, state, context);
}

module.exports = { balancedScore, rankCandidates };
