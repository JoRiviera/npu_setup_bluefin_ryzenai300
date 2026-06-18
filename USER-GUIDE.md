# User Guide — NPU Inference on Bluefin

> Two layers: **(BLUEFIN)** our local distrobox wrapping, **(LEMONADE)** generic Lemonade/FLM commands that work the same way on any Linux install. Tags mark which is which.

## TL;DR

```bash
# Start the daemon (BLUEFIN — wraps generic `lemond` in our container)
distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &

# Use it
distrobox enter npu -- lemonade chat llama3.2-1b-FLM

# Or via OpenAI API (BLUEFIN — endpoint identical, listening on host's localhost:13305)
curl -X POST http://localhost:13305/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2-1b-FLM","messages":[{"role":"user","content":"Hi"}]}'
```

---

## 1. Start / stop the stack

### (BLUEFIN) Enter the container

Everything Lemonade-related lives inside the `npu` distrobox container. Two ways to use it:

```bash
# A) Run a single command inside, then return
distrobox enter npu -- <command>

# B) Open an interactive shell inside (prompt prefix shows `[ <user>@npu ]`)
distrobox enter npu
```

### (BLUEFIN) Start the daemon

```bash
distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &
```

The `&` backgrounds it on the **host** side. `lemond` itself keeps running inside the container as long as the container is up. The container auto-starts on first `distrobox enter`.

Check it's up:

```bash
distrobox enter npu -- lemonade status
```

Expected:
```
Server is running on port 13305
Version             10.8.0
WebSocket Port      9000
```

### (BLUEFIN) Stop the daemon

```bash
distrobox enter npu -- pkill -f lemond
```

Or stop the whole container (also stops `lemond`):

```bash
distrobox stop npu
```

To start the container later without entering it interactively: just running any `distrobox enter npu -- ...` command auto-starts it.

### (LEMONADE) Why two binaries

- `lemond` — the **daemon** (HTTP server on 13305, WebSocket on 9000)
- `lemonade` — the **CLI client** that talks to `lemond` over HTTP

You always start `lemond` first, then issue commands with `lemonade`.

---

## 2. Models — load, list, pull, remove

### (LEMONADE) Catalog vs downloaded

Lemonade ships a curated **catalog** of ~127 models. They appear in `lemonade list` with `Downloaded: No`. You need to `pull` one to use it.

```bash
# Browse catalog (filters by name)
distrobox enter npu -- lemonade list                       # all 127
distrobox enter npu -- lemonade list llama                 # case-insensitive filter
distrobox enter npu -- lemonade list --downloaded          # only local

# Pull (download)
distrobox enter npu -- lemonade pull llama3.2-1b-FLM

# Run (loads model, opens web UI in browser by default)
distrobox enter npu -- lemonade run llama3.2-1b-FLM

# Run with CLI chat instead of web UI
distrobox enter npu -- lemonade run llama3.2-1b-FLM --chat-cli

# Standalone interactive chat (uses currently loaded model if no arg)
distrobox enter npu -- lemonade chat llama3.2-1b-FLM

# Remove model files
distrobox enter npu -- lemonade pull --help    # see options
```

### (LEMONADE) Model naming convention

Names tell you the backend at a glance:

| Suffix / pattern | Backend | Where it runs |
|---|---|---|
| `-FLM` | FastFlowLM | **NPU** ✓ |
| `-GGUF` | llama.cpp | CPU (or ROCm/Vulkan/CUDA if installed) |
| `Stable-Diffusion-*` | sd-cpp | CPU/GPU |
| `whisper-*` | whisper.cpp | CPU |

Only `-FLM` models hit the NPU on Linux.

### (LEMONADE) See currently-installed NPU models

```bash
distrobox enter npu -- lemonade list FLM --downloaded
```

After our setup the answer is:
```
llama3.2-1b-FLM    Yes    flm
```

### (LEMONADE) Pull a Hugging Face checkpoint directly (advanced)

```bash
distrobox enter npu -- lemonade pull org/repo:variant \
  --recipe flm \
  --checkpoint main org/repo:variant
```

### (LEMONADE) Direct FLM CLI (bypasses Lemonade)

```bash
distrobox enter npu -- flm list                   # NPU-only catalog
distrobox enter npu -- flm pull llama3.2:1b
distrobox enter npu -- flm run  llama3.2:1b       # interactive REPL
distrobox enter npu -- flm serve llama3.2:1b      # FLM-native server (port 52625)
distrobox enter npu -- flm validate               # health-check the NPU stack
```

The FLM catalog uses tags like `llama3.2:1b`; Lemonade's catalog re-exposes them as `llama3.2-1b-FLM`. Models you pull through `flm pull` are visible to Lemonade automatically and vice-versa (shared `~/.config/flm/models/`).

---

## 3. OpenAI-compatible HTTP endpoints

### (LEMONADE) Base URL & routes

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/models` | GET | List loaded/available models (OpenAI-style) |
| `/api/v1/chat/completions` | POST | Chat completion (streaming supported) |
| `/api/v1/completions` | POST | Legacy text completion |
| `/api/v1/embeddings` | POST | Embeddings (with `embed-gemma:300m`) |
| `/api/v1/audio/transcriptions` | POST | Whisper / moonshine transcription |
| `/api/v1/audio/speech` | POST | Text-to-speech (kokoro) |
| `/api/v1/images/generations` | POST | Image generation (sd-cpp) |
| `/` | GET | Lemonade web UI (Tauri-based) |

Default base URL: `http://localhost:13305/api/v1`

### (BLUEFIN) `localhost:13305` reachable from host

The container shares the host's network namespace (distrobox default). You hit `http://localhost:13305` from any host process — no port mapping needed.

### (LEMONADE) Examples

```bash
# List models (host or container — same endpoint)
curl -s http://localhost:13305/api/v1/models | jq

# Chat completion (non-streaming)
curl -s -X POST http://localhost:13305/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2-1b-FLM",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user",   "content": "What is the capital of France?"}
    ],
    "max_tokens": 50
  }' | jq

# Streaming
curl -N -X POST http://localhost:13305/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2-1b-FLM","messages":[{"role":"user","content":"Count to 5"}],"stream":true}'
```

### (LEMONADE) Drop into any OpenAI client

The OpenAI Python SDK works as-is — point `base_url` at Lemonade:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:13305/api/v1",
    api_key="not-required",   # daemon ignores it unless you set one
)

resp = client.chat.completions.create(
    model="llama3.2-1b-FLM",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)
```

Same for Node `openai`, `litellm`, `langchain.ChatOpenAI`, Continue.dev, Open WebUI, `aichat`, etc. Most expect:
- `OPENAI_API_BASE=http://localhost:13305/api/v1`
- `OPENAI_API_KEY=<anything>`

### (LEMONADE) Exposing the API on the LAN

By default `lemond` binds `127.0.0.1` (loopback only). To listen on all interfaces:

```bash
# (BLUEFIN) one-off
distrobox enter npu -- bash -c 'pkill -f lemond; nohup lemond --host 0.0.0.0 > /tmp/lemond.log 2>&1 &'

# or via config
distrobox enter npu -- lemonade config set host=0.0.0.0
```

Set an API key when binding to the network — `lemond` has none by default:

```bash
distrobox enter npu -- lemonade config set api_key=$(openssl rand -hex 32)
```

Clients then pass `Authorization: Bearer <key>`.

---

## 4. Web UI

### (LEMONADE) Open the Lemonade webapp

```bash
distrobox enter npu -- lemonade run llama3.2-1b-FLM
```

Opens `http://localhost:13305/` in your browser with the model preloaded. Lemonade's UI does chat, multi-model A/B, debate arena, and image gen (if respective backends installed).

---

## 5. Agent integrations

### (LEMONADE) `lemonade launch` — point coding agents at the local NPU

```bash
distrobox enter npu -- lemonade launch claude     # Anthropic Claude Code → Lemonade
distrobox enter npu -- lemonade launch codex      # OpenAI Codex CLI
distrobox enter npu -- lemonade launch opencode   # opencode
distrobox enter npu -- lemonade launch pi         # pi.ai
```

These wrappers set the agent's `OPENAI_API_BASE`/`ANTHROPIC_API_URL` to your local Lemonade and run the CLI normally.

---

## 6. Adding more NPU models

Only XDNA-2-optimized GGUFs work on NPU. Browse via `flm list`:

```
gemma3:1b  gemma3:4b  gemma4-it:e2b  gemma4-it:e4b
deepseek-r1:8b  gpt-oss:20b  embed-gemma:300m  ...
```

System RAM cap: ~24.5 GB usable for model weights (you have 30.6 GB). `gpt-oss:20b` fits; `gemma3:4b` is a good balance for daily use.

```bash
distrobox enter npu -- flm pull gemma3:4b
# Now visible to lemonade as `gemma3-4b-FLM`:
distrobox enter npu -- lemonade list --downloaded
```

---

## 7. Troubleshooting

### NPU not detected

```bash
distrobox enter npu -- flm validate
```

Anything red? Common cases:

| Error | Cause | Fix |
|---|---|---|
| `Memlock limit is too low` | Host's systemd manager didn't apply `DefaultLimitMEMLOCK=infinity` | Re-check `systemctl show --property=DefaultLimitMEMLOCK`; should be `infinity`. If not, see `CHANGELOG.md` entry on systemd `.conf.d`. |
| `/dev/accel/accel0` not found | Host kernel module not loaded | `lsmod \| grep amdxdna` on host — should show the module. If not, boot a newer Bluefin image (kernel ≥ 7.0). |
| `NPU FW Version: 1.0.0.63` | Firmware proto-6 loaded instead of proto-7 | Check `/usr/lib/firmware/amdnpu/17f0_10/` symlinks; `npu_7.sbin.xz → npu.sbin.1.1.2.64.xz`. Don't tamper. |

### `lemond` won't start

```bash
distrobox enter npu -- cat /tmp/lemond.log
```

Typical issues: port 13305 already taken (`pkill -f lemond` and retry), or model cache permissions (`ls ~/.config/flm/models`).

### Slow first inference

The first request after `lemond` starts loads the model into NPU memory — expect ~3–5 s before TTFT improves. Subsequent calls hit cached state.

### `lemonade status` says "Server is not running"

Daemon died. Restart:
```bash
distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &
```

### Container won't enter / podman complains

```bash
# Nuke and recreate (preserves models in ~/.config/flm/)
distrobox stop npu
distrobox rm npu --force
distrobox create --name npu --image docker.io/library/ubuntu:24.04 --yes
distrobox enter npu -- bash -c '
  sudo apt-get update
  sudo apt-get install -y software-properties-common
  sudo add-apt-repository -y ppa:lemonade-team/stable
  sudo apt-get install -y libxrt-npu2 ffmpeg lemonade-server
  wget -q https://github.com/FastFlowLM/FastFlowLM/releases/download/v0.9.43/fastflowlm_0.9.43_ubuntu24.04_amd64.deb
  sudo apt-get install -y ./fastflowlm_0.9.43_ubuntu24.04_amd64.deb
'
```

Pulled models in `~/.config/flm/models/` (host path) survive container recreation.

### Reverting the whole setup

See `CHANGELOG.md` — every change has an explicit undo command.

---

## 8. Reference: file locations on host

| Path | Owned by | Lives across `distrobox rm` |
|---|---|---|
| `~/.config/flm/models/` | FLM | yes (mounted from host) |
| `~/.cache/lemonade/` | Lemonade daemon | yes |
| `/etc/systemd/{system,user}.conf.d/99-memlock.conf` | our setup | yes (host /etc) |
| `/dev/accel/accel0` | host kernel | yes |
| `/usr/lib/firmware/amdnpu/` | Bluefin base image | yes (read-only) |

---

## 9. Reference: quick-launch alias (optional)

Add to `~/.bashrc` on host to skip `distrobox enter` prefix:

```bash
alias lemonade='distrobox enter npu -- lemonade'
alias flm='distrobox enter npu -- flm'
alias lemond-start='distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &'
alias lemond-stop='distrobox enter npu -- pkill -f lemond'
```

Or use `distrobox-export` for a more permanent binding:

```bash
distrobox enter npu -- distrobox-export --bin /usr/bin/lemonade
distrobox enter npu -- distrobox-export --bin /usr/bin/flm
```

Then `lemonade`, `flm` are on your host `$PATH` and transparently shell into the container.
