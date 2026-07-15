// Metering and caps for the AI layer (ADR-0008, THREAT_MODEL T7).
//
// Every LLM call on this platform goes through here. The rule from ADR-0008:
// "No LLM call without an authenticated user, a rate limit, a spend cap, a model
// chosen by task, server-held conversation state, and streaming."
'use strict';
const { q } = require('./db');

// Price list, paise per million tokens. Kept explicit and dated rather than
// inferred, because a wrong constant here silently under-reports what we spend.
// Sonnet 5 introductory pricing runs to 2026-08-31 ($2/$10 per 1M); we bill
// ourselves at the STANDARD rate ($3/$15) so the cap does not quietly loosen
// when the intro period ends. USD→INR at 90 (round, conservative).
//   Sonnet 5: $3 / 1M in, $15 / 1M out  ->  27000 / 135000 paise per 1M
//   Opus 4.8: $5 / 1M in, $25 / 1M out  ->  45000 / 225000 paise per 1M
const PRICES = {
  'claude-sonnet-5': { in: 27000, out: 135000 },
  'claude-opus-4-8': { in: 45000, out: 225000 },
  'claude-haiku-4-5': { in: 9000, out: 45000 },
};
const DEFAULT_PRICE = { in: 45000, out: 225000 }; // unknown model: assume the dearest

function costPaise(model, inputTokens, outputTokens) {
  const p = PRICES[model] || DEFAULT_PRICE;
  return Math.ceil((inputTokens * p.in + outputTokens * p.out) / 1e6);
}

async function config() {
  const r = await q('select * from ai_config where id=1').catch(() => ({ rows: [] }));
  return r.rows[0] || {
    enabled: true, daily_cap_paise_user: 5000,
    daily_cap_paise_total: 200000, model: 'claude-sonnet-5',
  };
}

/**
 * May this user spend right now? Checks the kill switch, then the per-user and
 * platform-wide daily caps.
 * @returns {Promise<{allowed:boolean, reason?:string, spentUser?:number, capUser?:number}>}
 */
async function checkBudget(userId) {
  const cfg = await config();
  if (!cfg.enabled) return { allowed: false, reason: 'disabled' };

  const [mine, all] = await Promise.all([
    q(`select coalesce(sum(cost_paise),0)::int n from ai_usage
        where user_id=$1 and created_at > now() - interval '24 hours'`, [userId]),
    q(`select coalesce(sum(cost_paise),0)::int n from ai_usage
        where created_at > now() - interval '24 hours'`),
  ]);
  const spentUser = mine.rows[0].n, spentTotal = all.rows[0].n;

  if (spentUser >= cfg.daily_cap_paise_user)
    return { allowed: false, reason: 'user_cap', spentUser, capUser: cfg.daily_cap_paise_user };
  if (spentTotal >= cfg.daily_cap_paise_total)
    return { allowed: false, reason: 'global_cap' };

  return { allowed: true, spentUser, capUser: cfg.daily_cap_paise_user, model: cfg.model };
}

/** Record what a call actually cost, from the model's own token counts. */
async function recordUsage({ userId, conversationId, model, usage, ok = true }) {
  const inTok = Number(usage?.input_tokens || 0);
  const outTok = Number(usage?.output_tokens || 0);
  const paise = costPaise(model, inTok, outTok);
  await q(
    `insert into ai_usage (user_id, conversation_id, model, input_tokens, output_tokens, cost_paise, ok)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, conversationId || null, model, inTok, outTok, paise, ok]
  ).catch(e => console.error('ai usage record:', e?.message));
  return paise;
}

module.exports = { costPaise, config, checkBudget, recordUsage, PRICES };
