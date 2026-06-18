#!/usr/bin/env node
// npu-shim.mjs
//
// Streaming-protocol fixer that sits between OpenAI-compatible clients
// (opencode, ai-sdk, etc.) and Lemonade/FastFlowLM.
//
// Problem: FastFlowLM emits the entire streaming tool_calls delta in ONE
//   SSE chunk (function.name + function.arguments together). The OpenAI
//   streaming spec requires those to arrive incrementally — first a chunk
//   with `function.name` and empty `arguments`, then subsequent chunks
//   that append to `arguments`. Strict clients (Vercel ai-sdk) won't
//   reconstruct the tool call from a single-chunk delta and silently drop
//   it, leading to "no output" in opencode.
//
// Fix: This shim transparently forwards HTTP traffic from a listen port
//   (default 13306) to Lemonade (default 13305). For streaming
//   /v1/chat/completions responses, it parses each SSE event, detects a
//   tool_calls delta that has BOTH name and non-empty arguments, and
//   splits it into two events:
//     1) { delta: { tool_calls: [{ index, id, type, function: { name, arguments: "" }}]}}
//     2) { delta: { tool_calls: [{ index,                 function: {       arguments: "<original>" }}]}}
//   All other traffic passes through untouched.
//
// Usage:
//   node npu-shim.mjs                                       # 127.0.0.1:13306 → 127.0.0.1:13305
//   NPU_SHIM_LISTEN_PORT=18080 node npu-shim.mjs            # custom listen port
//
// Then point your OpenAI-compatible client at http://127.0.0.1:13306/v1.

import http from 'node:http';

const UPSTREAM_HOST = process.env.NPU_SHIM_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.NPU_SHIM_UPSTREAM_PORT || 13305);
const LISTEN_HOST = process.env.NPU_SHIM_LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.NPU_SHIM_LISTEN_PORT || 13306);
const VERBOSE = process.env.NPU_SHIM_VERBOSE === '1';

function transformChunk(chunk) {
  if (!chunk || !Array.isArray(chunk.choices)) return [chunk];
  const choice = chunk.choices[0];
  if (!choice || !choice.delta || !Array.isArray(choice.delta.tool_calls)) {
    return [chunk];
  }

  const headerCalls = [];
  const argCalls = [];

  for (const tc of choice.delta.tool_calls) {
    const fn = tc.function || {};
    const hasName = typeof fn.name === 'string' && fn.name.length > 0;
    const hasArgs = typeof fn.arguments === 'string' && fn.arguments.length > 0;

    if (hasName && hasArgs) {
      headerCalls.push({
        index: tc.index,
        id: tc.id,
        type: tc.type || 'function',
        function: { name: fn.name, arguments: '' },
      });
      argCalls.push({
        index: tc.index,
        function: { arguments: fn.arguments },
      });
    } else {
      headerCalls.push(tc);
    }
  }

  const out = [];
  if (headerCalls.length > 0) {
    out.push({
      ...chunk,
      choices: [{ ...choice, delta: { ...choice.delta, tool_calls: headerCalls } }],
    });
  }
  if (argCalls.length > 0) {
    const argChoice = { ...choice, delta: { tool_calls: argCalls } };
    delete argChoice.delta.role;
    delete argChoice.delta.content;
    out.push({ ...chunk, choices: [argChoice] });
  }
  return out;
}

function transformEvent(eventText) {
  const trimmed = eventText.trim();
  if (!trimmed.startsWith('data:')) return [eventText];
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return [eventText];

  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return [eventText];
  }

  const fixed = transformChunk(chunk);
  if (fixed.length === 1 && fixed[0] === chunk) return [eventText];

  return fixed.map(c => 'data: ' + JSON.stringify(c));
}

function isChatCompletions(url, method) {
  return method === 'POST' && /\/v1\/chat\/completions(\?|$)/.test(url);
}

const server = http.createServer((clientReq, clientRes) => {
  const bodyChunks = [];
  clientReq.on('data', c => bodyChunks.push(c));
  clientReq.on('end', () => {
    const reqBody = Buffer.concat(bodyChunks);

    const headers = { ...clientReq.headers };
    delete headers['host'];
    delete headers['content-length'];
    if (reqBody.length > 0) headers['content-length'] = String(reqBody.length);

    const upReq = http.request(
      {
        hostname: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers,
      },
      upRes => {
        const respHeaders = { ...upRes.headers };
        clientRes.writeHead(upRes.statusCode || 502, respHeaders);

        const contentType = String(upRes.headers['content-type'] || '');
        const isSse = contentType.includes('text/event-stream');
        const shouldTransform = isSse && isChatCompletions(clientReq.url, clientReq.method);

        if (!shouldTransform) {
          upRes.pipe(clientRes);
          return;
        }

        if (VERBOSE) console.error(`[shim] transforming SSE for ${clientReq.url}`);

        let buf = '';
        upRes.setEncoding('utf8');
        upRes.on('data', chunk => {
          buf += chunk;
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            if (part === '') {
              clientRes.write('\n\n');
              continue;
            }
            const out = transformEvent(part);
            for (const ev of out) {
              clientRes.write(ev + '\n\n');
            }
          }
        });
        upRes.on('end', () => {
          if (buf.trim()) {
            const out = transformEvent(buf);
            for (const ev of out) {
              clientRes.write(ev + '\n\n');
            }
          }
          clientRes.end();
        });
        upRes.on('error', err => {
          console.error('[shim] upstream stream error:', err.message);
          clientRes.end();
        });
      }
    );

    upReq.on('error', err => {
      console.error('[shim] upstream connect error:', err.message);
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end(`shim: upstream error: ${err.message}\n`);
    });

    if (reqBody.length > 0) upReq.write(reqBody);
    upReq.end();
  });

  clientReq.on('error', err => {
    console.error('[shim] client error:', err.message);
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.error(
    `[shim] listening http://${LISTEN_HOST}:${LISTEN_PORT} → http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`
  );
});
