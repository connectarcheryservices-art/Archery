// Tiny helpers shared by every serverless function.
'use strict';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function json(res, obj, code = 200) {
  res.status(code).json(obj);
}

// Vercel parses JSON bodies, but be defensive (string / undefined).
function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

module.exports = { cors, json, readBody };
