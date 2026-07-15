// /api/coach — AI archery coach. Authenticated, metered, capped, server-held.
//
// What this was until 2026-07-15 (THREAT_MODEL T7, ADR-0008): an anonymous,
// unmetered, uncapped, Opus-priced LLM billed to us, whose "conversation history"
// was whatever the caller's browser claimed. Anyone on the internet could spend
// our money, and could forge assistant turns to put words in the model's mouth.
//
// ADR-0008 requires ALL of the following before any LLM call. Each is enforced
// below, in order:
//   1. an authenticated user            — no anonymous inference
//   2. a rate limit (per user, per IP)
//   3. a spend cap (per user/day, global/day, plus a kill switch)
//   4. a model chosen by task           — Sonnet default; Opus only when proven
//   5. server-held conversation state   — the client sends an id, not a transcript
//   6. streaming                        — long answers must not hit the timeout
'use strict';
const { cors, json, readBody } = require('../_lib/respond');
const { authedUser } = require('../_lib/userauth');
const { guard, record } = require('../_lib/ratelimit');
const { checkBudget, recordUsage, config } = require('../_lib/ai');
const { q } = require('../_lib/db');

const SYSTEM = `You are the AI Coach on Archery.Services, an Indian archery platform.
You coach recurve, compound and barebow archers from beginner to national level.
Give specific, actionable advice grounded in World Archery rules and standard
coaching practice (shot cycle, anchor, release, tuning, spine selection, SPT,
periodisation, competition prep, mental game). Use metric units and Indian
context (AAI, state associations) where relevant. Keep answers under 200 words
unless a training plan is requested. Never give medical advice beyond suggesting
a qualified professional. If asked about doping, defer to NADA/WADA guidance.

Cite the World Archery article number when you state a rule. If you are not
certain of the article number, give the rule and say you are not certain of the
number — never invent a citation. A fabricated citation is worse than none.

You do not have access to this athlete's scores or training history. If asked
about their own performance, say so plainly rather than guessing — do not
describe trends or improvements you cannot see.`;

const MAX_TURNS = 16; // server-side transcript window sent to the model

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);

  // 1. AUTHENTICATED USER. ADR-0008: "No anonymous inference."
  //    Deliberately NOT `fallback:true`: the old handler answered every failure
  //    with fallback so the page quietly used its local knowledge base. Doing
  //    that for a 401 would hide from the user that they need to sign in.
  const user = authedUser(req);
  if (!user) return json(res, { ok: false, error: 'Please sign in to use the AI coach.', signIn: true }, 401);

  // 2. RATE LIMIT — per user and per IP.
  const blocked = await guard(req, 'coach:' + user.id, { idMax: 20, ipMax: 40, windowMin: 60 });
  if (blocked) {
    res.setHeader('Retry-After', String(blocked.retryAfter));
    return json(res, { ok: false, error: `You've reached the hourly limit for the coach. Try again in ${Math.ceil(blocked.retryAfter / 60)} minute(s).` }, 429);
  }

  if (!process.env.ANTHROPIC_API_KEY) return json(res, { ok: false, fallback: true });

  try {
    // 3. SPEND CAP + KILL SWITCH.
    const budget = await checkBudget(user.id);
    if (!budget.allowed) {
      if (budget.reason === 'disabled') return json(res, { ok: false, fallback: true });
      if (budget.reason === 'user_cap')
        return json(res, { ok: false, error: "You've used your AI coach allowance for today. It resets in 24 hours." }, 429);
      // Global cap reached: don't publish our platform spend to a caller.
      console.error('coach: GLOBAL daily AI cap reached — kill switch effectively engaged');
      return json(res, { ok: false, fallback: true });
    }

    const b = readBody(req);
    const text = String(b.message || '').slice(0, 2000).trim();
    if (!text) return json(res, { ok: false, error: 'Empty message' }, 400);

    // 5. SERVER-HELD CONVERSATION STATE.
    //    The client sends a conversation id, never a transcript. b.history is
    //    ignored on purpose — trusting it let callers forge assistant turns.
    let convId = Number(b.conversationId) || null;
    if (convId) {
      // Ownership check: a conversation id belonging to another user is not yours.
      const own = await q('select id from coach_conversations where id=$1 and user_id=$2', [convId, user.id]);
      if (!own.rows[0]) convId = null;
    }
    if (!convId) {
      const c = await q(
        `insert into coach_conversations (user_id, title) values ($1,$2) returning id`,
        [user.id, text.slice(0, 60)]);
      convId = c.rows[0].id;
    }

    await q(`insert into coach_messages (conversation_id, role, content) values ($1,'user',$2)`, [convId, text]);

    const hist = await q(
      `select role, content from coach_messages where conversation_id=$1
        order by created_at desc, id desc limit $2`, [convId, MAX_TURNS]);
    const messages = hist.rows.reverse().map(m => ({ role: m.role, content: m.content }));

    // 4. MODEL BY TASK — Sonnet default (ADR-0008(4)). Opus costs ~1.7x per
    //    token in and out; for a 200-word coaching reply there is no eval
    //    showing it is better, so it is not used. ADR-0008 requires an eval to
    //    change this, and the model is in ai_config so it needs no deploy.
    const cfg = await config();
    const model = cfg.model || 'claude-sonnet-5';

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    // 6. STREAMING — a long training plan must not hit the request timeout.
    //    The widget wants one JSON reply, so we stream and await the final
    //    message: same response shape, but no timeout on long generations.
    const stream = client.messages.stream({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages,
    });
    const response = await stream.finalMessage();

    const reply = (response.content || [])
      .filter(blk => blk.type === 'text').map(blk => blk.text).join('\n').trim();

    // Meter from the model's REAL token counts, never an estimate.
    const paise = await recordUsage({
      userId: user.id, conversationId: convId, model,
      usage: response.usage, ok: !!reply,
    });

    if (!reply) return json(res, { ok: false, fallback: true });

    await q(`insert into coach_messages (conversation_id, role, content) values ($1,'assistant',$2)`, [convId, reply]);
    await q(`update coach_conversations set updated_at=now() where id=$1`, [convId]).catch(() => {});
    await record('id:coach:' + user.id, { ok: true, identity: 'coach:' + user.id, req });

    return json(res, {
      ok: true, reply, conversationId: convId,
      // So the UI can warn before the user hits the wall rather than after.
      allowance: { spentPaise: (budget.spentUser || 0) + paise, capPaise: budget.capUser },
    });
  } catch (e) {
    console.error('coach:', e?.status || '', e?.message);
    await record('id:coach:' + user.id, { ok: false, identity: 'coach:' + user.id, req }).catch(() => {});
    return json(res, { ok: false, fallback: true });
  }
};
