'use strict';
/**
 * /pairing — scan the WhatsApp QR code from a browser.
 *
 * `rumi pair` prints the QR code in a terminal, which a hosted container does not
 * give you. This serves the same code as an image, behind a secret:
 *
 *   PAIRING_TOKEN=<long random string>     (unset → these routes do not exist: 404)
 *   https://<host>/pairing?key=<PAIRING_TOKEN>
 *
 * The page refreshes itself (a QR code is replaced about every 20 seconds). When
 * the session was invalidated or logged out it offers a button to forget the old
 * session and pair again (Redis session store only).
 *
 * Whoever has the token can link their own WhatsApp to this bot, so treat it like
 * a password and unset PAIRING_TOKEN once the number is paired.
 */

const crypto = require('crypto');
const express = require('express');

const connection = require('./baileys-connection');

function tokenOk(supplied) {
  const expected = process.env.PAIRING_TOKEN;
  if (!expected || typeof supplied !== 'string' || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The QR payload as an inline SVG (the same encoder qrcode-terminal draws with). */
function qrToSvg(text, { scale = 6, margin = 4 } = {}) {
  const QRCode = require('qrcode-terminal/vendor/QRCode');
  const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * scale;
  let path = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) path += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="WhatsApp pairing QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const MESSAGES = {
  connecting: 'Starting the WhatsApp connection…',
  waiting_for_scan: 'Scan this code: WhatsApp → Settings → Linked devices → Link a device.',
  connected: 'Connected. This number is paired and Rumi is answering on it.',
  invalidated: 'WhatsApp ended the old session (often two copies of the app were running). Reset and pair again.',
  logged_out: 'This device was logged out from the phone. Reset and pair again.',
  stopped: 'This instance gave up the WhatsApp session to another one.',
};

function page({ state, key, svg }) {
  const needsReset = state.status === 'invalidated' || state.status === 'logged_out';
  const refresh = state.status === 'connected' ? '' : '<meta http-equiv="refresh" content="4">';
  const reset = needsReset && state.store === 'redis'
    ? `<form method="post" action="/pairing/reset?key=${encodeURIComponent(key)}"><button>Forget the old session and pair again</button></form>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<meta name="robots" content="noindex"><title>Pair WhatsApp</title>
<style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;text-align:center}svg{max-width:100%;height:auto;border:1px solid #ccc}button{font:inherit;padding:.6rem 1rem}code{background:#eee;padding:0 .3rem}</style></head>
<body><h1>Pair WhatsApp</h1><p>${MESSAGES[state.status] || state.status}</p>${svg || ''}${reset}<p><small>Status: <code>${state.status}</code> · store: <code>${state.store}</code></small></p></body></html>`;
}

function build() {
  const router = express.Router();

  router.use((req, res, next) => {
    // Unset token = feature off. 404, not 401, so the path does not advertise itself.
    if (!process.env.PAIRING_TOKEN) return res.status(404).end();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
    if (!tokenOk(req.query.key)) return res.status(404).end();
    return next();
  });

  router.get('/', (req, res) => {
    const state = connection.getPairingState();
    const svg = state.status === 'waiting_for_scan' && state.qr ? qrToSvg(state.qr) : '';
    res.type('html').send(page({ state, key: String(req.query.key), svg }));
  });

  router.get('/state', (req, res) => {
    const { status, store, updatedAt } = connection.getPairingState();
    res.json({ status, store, updatedAt });
  });

  router.post('/reset', async (req, res) => {
    try {
      await connection.resetSession();
      res.redirect(303, `/pairing?key=${encodeURIComponent(String(req.query.key))}`);
    } catch (error) {
      res.status(409).type('text').send(error.message);
    }
  });

  return router;
}

module.exports = { build, qrToSvg, tokenOk };
