// /api/coach — AI archery coach.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set in the environment;
// otherwise returns {fallback:true} and the page answers from its built-in
// coaching knowledge base. Keys never touch the browser.
'use strict';
const { cors, json, readBody } = require('./_lib/respond');

const SYSTEM = `You are the AI Coach on Archery.Services, an Indian archery platform.
You coach recurve, compound and barebow archers from beginner to national level.
Give specific, actionable advice grounded in World Archery rules and standard
coaching practice (shot cycle, anchor, release, tuning, spine selection, SPT,
periodisation, competition prep, mental game). Use metric units and Indian
context (AAI, state associations) where relevant. Keep answers under 200 words
unless a training plan is requested. Never give medical advice beyond suggesting
a qualified professional. If asked about doping, defer to NADA/WADA guidance.`;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, { ok: false }, 405);

  if (!process.env.ANTHROPIC_API_KEY) return json(res, { ok: false, fallback: true });

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const b = readBody(req);
    const text = String(b.message || '').slice(0, 2000).trim();
    if (!text) return json(res, { ok: false, error: 'Empty message' }, 400);

    // Short rolling history from the widget: [{role:'user'|'assistant', text}]
    const history = Array.isArray(b.history) ? b.history.slice(-8) : [];
    const messages = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.text)
      .map(m => ({ role: m.role, content: String(m.text).slice(0, 2000) }));
    messages.push({ role: 'user', content: text });

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,           // coaching replies are deliberately short
      system: SYSTEM,
      messages,
    });

    const reply = response.content
      .filter(blk => blk.type === 'text')
      .map(blk => blk.text)
      .join('\n')
      .trim();
    if (!reply) return json(res, { ok: false, fallback: true });
    return json(res, { ok: true, reply });
  } catch (e) {
    console.error('coach:', e?.status || '', e?.message);
    // Any API problem (rate limit, auth, network) → let the page fall back
    return json(res, { ok: false, fallback: true });
  }
};
