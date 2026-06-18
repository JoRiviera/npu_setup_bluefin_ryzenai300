# Integrating Agentic Clients (opencode / Continue.dev / Aider)

Date: 2026-06-18
Scope: any client that uses the Vercel `ai-sdk` (or another strict OpenAI streaming parser) and expects tool/function calling, e.g. **opencode**, **Continue.dev**, **Aider** in OpenAI-stream mode.

This document captures **two non-obvious gotchas** discovered while wiring opencode to a local FastFlowLM / Lemonade NPU setup. Both also apply to any other agent client driving FLM via streaming tool calls.

## Symptom

The agent UI shows no output. Server logs:
- Lemonade reports `POST /v1/chat/completions` accepted but `(StreamingProxy) Backend returned error: 400` ~50 ms later, OR
- Two streams open (one for session title, one for the main response) and one or both return 400, OR
- Streams complete `200 OK` but the agent stays silent — the model emitted a tool call that the SDK couldn't reconstruct from the malformed SSE deltas.

## Cause #1 — Default context is too small

Lemonade's default `ctx_size` is `-1` (auto-tune), which resolves to **4 096 tokens** for FLM models.

opencode's system prompt + tool definitions easily run **5 000–10 000 tokens** before the user ever types a message. The request exceeds the loaded context window, FLM rejects it with HTTP 400 within milliseconds, and Lemonade's streaming proxy bubbles up an empty stream. The client sees `200 OK` followed by zero events.

### Fix

```bash
distrobox enter npu -- lemonade config set ctx_size=32768
```

Then restart `lemond` and trigger a model load — verify in the log:

```
[FastFlowLM] Options: ctx_size=32768
… "flm" "serve" "qwen3.5:9b" "--ctx-len" "32768" "--port" "8001" …
```

Per-model maximum context is in `GET /v1/models` under `max_context_window` (e.g. 131 072 for `llama3.2-1b-FLM`, 262 144 for `qwen3.5-9b-FLM`). Larger context = larger KV cache. 32 K is a safe default for most agent clients; raise it if your sessions get long.

## Cause #2 — Streaming tool-call deltas arrive in one chunk

FLM v0.9.43 emits the **entire** streaming tool-call payload (`function.name` + `function.arguments`) in a single SSE event:

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_...","type":"function",
                  "function":{"name":"read","arguments":"{\"filePath\":\"…\"}"}}]}}]}
```

The OpenAI streaming spec — and Vercel `ai-sdk` — require `function.name` and `function.arguments` to arrive incrementally:

```
data: { delta: { tool_calls:[{ index, id, type, function:{ name, arguments:"" }}]}}
data: { delta: { tool_calls:[{ index,             function:{           arguments:"<piece>" }}]}}
…
```

Strict parsers cannot reconstruct the tool call from FLM's single-chunk form. They silently drop the tool call; the agent then either falls through to a text response or shows nothing at all.

### Fix

This repo ships `npu-shim.mjs` — a small Node-stdlib HTTP proxy that sits between the client and Lemonade, splits each combined tool-call delta into proper `name` + `arguments` chunks, and passes every other request through unchanged.

```bash
node /path/to/npu-shim.mjs
# [shim] listening http://127.0.0.1:13306 → http://127.0.0.1:13305
```

Then point the client at port `13306` instead of `13305`. The shim is a no-op for plain chat turns; it only activates when the server emits a `tool_calls` delta with both `name` and non-empty `arguments` in the same chunk.

See [`USER-GUIDE.md`](./USER-GUIDE.md) §3 for env-var knobs (`NPU_SHIM_LISTEN_PORT`, `NPU_SHIM_VERBOSE`, etc.).

### Verifying the shim is actually doing something

Run with `NPU_SHIM_VERBOSE=1` to log every transform. Look for paired `in:` / `out:` lines like:

```
[shim res#4 event#1] in : data: {…"function":{"name":"read","arguments":"{\"filePath\":…}"}…}
[shim res#4 event#1] out: data: {…"function":{"name":"read","arguments":""}…}
[shim res#4 event#1] out: data: {…"function":{"arguments":"{\"filePath\":…}"}…}
```

In a verified production session opencode emitted a `read` tool call on a project file; the shim split it into two chunks and the SDK reconstructed the call correctly. The follow-up response stream then carried the file contents and the model's analysis.

## opencode configuration

Edit `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "Lemonade/qwen3.5-9b-FLM",         // optional default model
  "provider": {
    "Lemonade": {
      "name": "Lemonade (local)",
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "qwen3.5-9b-FLM": { "name": "Qwen 3.5 9B (local)" }
      },
      "options": {
        "apiKey": "lemonade",                  // anything non-empty
        "baseURL": "http://127.0.0.1:13306/v1" // ← shim port; use 13305 to bypass
      }
    }
  }
}
```

Start a session:

```bash
opencode -m Lemonade/qwen3.5-9b-FLM
```

`opencode models Lemonade` lists what opencode parsed from this config — quick sanity check before opening the TUI.

## Order of operations to bring up an agentic client

1. Container up, `lemond` running.
2. `lemonade config set ctx_size=32768` (or higher).
3. Restart `lemond` so the next model load picks up the new ctx.
4. Start `npu-shim.mjs` on the host (port 13306).
5. Point the client's `baseURL` at `http://127.0.0.1:13306/v1` with any non-empty `apiKey`.
6. Launch the client, send a message that requires a tool (e.g. "list files in this directory").

## When to retire the shim

Watch the FastFlowLM release notes at `https://github.com/FastFlowLM/FastFlowLM/releases`. Once FLM emits incremental streaming tool-call deltas (separate `name` and `arguments` chunks), the shim becomes optional:

1. Point the client back at `http://127.0.0.1:13305/v1`.
2. Stop the shim: `pkill -f npu-shim.mjs`.

The context-size fix is permanent — `lemonade config set ctx_size` is just a server-side default.
