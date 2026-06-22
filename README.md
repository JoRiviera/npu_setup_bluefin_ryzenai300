# NPU Setup — Bluefin DX 44 + AMD Ryzen AI 300

End-to-end install path for **AMD XDNA 2 NPU inference** on **Bluefin DX 44** (Silverblue base, kernel 7.0+) using **FastFlowLM** + **Lemonade Server**, without touching the rpm-ostree base image.

Verified on:
- Framework Laptop 13, Ryzen AI 300 series ("Krackan", PCI `1022:17f0`)
- Bluefin DX 44 (kernel 7.0.9-fc44), in-tree `amdxdna 0.6.0`, NPU firmware 1.1.2.64
- FastFlowLM v0.9.43, Lemonade 10.8.0, XRT 2.21.75

## What this gets you

An OpenAI-compatible HTTP API at `http://localhost:13305/api/v1` driving the NPU, accessible from any host process. Point any OpenAI SDK / Continue.dev / Open WebUI / `aichat` at it.

Measured on Llama-3.2-1B-FLM: **prefill 80 tps**, **decode 46 tps**, **TTFT 0.58 s**.

## Approach in one line

Install everything inside an **Ubuntu 24.04 distrobox** container that talks to the host's in-kernel `amdxdna` driver via `/dev/accel/accel0`. Only one reversible host change (memlock via systemd manager defaults).

## Read in this order

| When | File |
|---|---|
| First — quick orientation | this README |
| Daily use | [`USER-GUIDE.md`](./USER-GUIDE.md) |
| Reproducing the setup | [Reproduce (declarative)](#reproduce-declarative) — `Containerfile` + `distrobox.ini` + `Makefile`; reasoning in [`03-install-paths.md`](./03-install-paths.md) + [`04-revised-recommendation.md`](./04-revised-recommendation.md) |
| Understanding the why | [`01-hardware-discovery.md`](./01-hardware-discovery.md) → [`02-current-stack-state.md`](./02-current-stack-state.md) → [`05-compatibility-matrix.md`](./05-compatibility-matrix.md) |
| End state + benchmarks | [`06-final-summary.md`](./06-final-summary.md) |
| What was changed on the host (and how to undo) | [`CHANGELOG.md`](./CHANGELOG.md) |
| Fix for streaming tool-call clients (opencode, ai-sdk, …) | [`npu-shim.mjs`](./npu-shim.mjs) — see USER-GUIDE §3 |
| Wiring an agentic client (opencode/Continue.dev/Aider) | [`07-agentic-clients.md`](./07-agentic-clients.md) — context-size fix + shim usage + opencode config |

## Quick install (recap)

For full reasoning + path comparison, see [`04-revised-recommendation.md`](./04-revised-recommendation.md). Short form:

```bash
# 1. Create container
distrobox create --name npu --image docker.io/library/ubuntu:24.04 --yes

# 2. Install XRT + Lemonade from AMD's PPA inside container
distrobox enter npu -- bash -c '
  sudo apt-get update
  sudo apt-get install -y software-properties-common
  sudo add-apt-repository -y ppa:lemonade-team/stable
  sudo apt-get install -y libxrt-npu2 ffmpeg lemonade-server
'

# 3. Install FastFlowLM .deb
distrobox enter npu -- bash -c '
  cd /tmp
  wget -q https://github.com/FastFlowLM/FastFlowLM/releases/download/v0.9.43/fastflowlm_0.9.43_ubuntu24.04_amd64.deb
  sudo apt-get install -y ./fastflowlm_0.9.43_ubuntu24.04_amd64.deb
'

# 4. Host memlock fix (only host-side change — full reasoning in CHANGELOG.md)
sudo mkdir -p /etc/systemd/system.conf.d /etc/systemd/user.conf.d
printf '[Manager]\nDefaultLimitMEMLOCK=infinity\n' | sudo tee \
  /etc/systemd/system.conf.d/99-memlock.conf \
  /etc/systemd/user.conf.d/99-memlock.conf
sudo systemctl reboot

# 5. After reboot — validate
distrobox enter npu -- flm validate
```

Then jump to [`USER-GUIDE.md`](./USER-GUIDE.md) for day-to-day usage.

## Reproduce (declarative)

The manual steps above are also packaged as pinned, reproducible artifacts so a fresh machine can rebuild the exact userspace stack:

| File | Owns |
|---|---|
| [`Containerfile`](./Containerfile) | Pinned image: `ubuntu:24.04` + XRT `2.21.75` + Lemonade `10.8.0` + FastFlowLM `0.9.43` |
| [`distrobox.ini`](./distrobox.ini) | Declarative `npu` container from that image (`distrobox assemble create`) |
| [`setup-host.sh`](./setup-host.sh) | The one host mutation (memlock + reboot), reversible |
| [`Makefile`](./Makefile) | Glue targets tying it all together |

Fresh-machine path:

```bash
make host        # one-time host memlock fix, then: sudo systemctl reboot
make image       # build the pinned userspace image
make container   # create the `npu` distrobox from it
make config      # set ctx_size=32768 (agentic-client fix)
make models      # pull the FLM models (~10 GB total, runtime)
make serve       # start the lemonade daemon
```

**Reproducibility boundary** — the `Containerfile` pins everything that *can* be pinned. It deliberately does **not** contain: the `amdxdna` driver (host kernel), `/dev/accel` + `/dev/dri` passthrough (distrobox runtime), the memlock fix (host systemd), or the models (pulled at first run). If the PPA later drops an exact pinned version, strip the `=<version>` suffix in the `Containerfile`.

## Try it

```bash
# Start daemon
distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &

# Pull a model
distrobox enter npu -- lemonade pull llama3.2-1b-FLM

# OpenAI-compatible API
curl -s -X POST http://localhost:13305/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2-1b-FLM",
    "messages": [{"role": "user", "content": "What is the capital of France?"}]
  }' | jq -r '.choices[0].message.content'
```

## Why this isn't just `dnf install`

Bluefin DX is **rpm-ostree immutable**: `/usr` is read-only and `dnf install` doesn't work. Community Copr packages are available but stale (~14 months behind AMD). The chosen path:

- Uses AMD's **lemonade-team PPA** (.deb), matched to FastFlowLM's tested stack
- Runs inside **distrobox** so nothing leaks into the rpm-ostree base
- Relies on Bluefin's **in-tree `amdxdna` kernel module** (no DKMS layering, no out-of-tree driver)
- Single reversible host change for memlock — undo with one file removal + reboot

See [`05-compatibility-matrix.md`](./05-compatibility-matrix.md) for the full version-skew analysis.

## Hardware compatibility

Works on AMD Ryzen AI **300 series** (Strix / Strix Halo / Krackan / Gorgon Point) with XDNA 2 NPU. **XDNA 1** (Ryzen AI 7000/8000/200) is not supported by FastFlowLM on Linux. Check yours:

```bash
lspci -nn | grep -i 'Neural Processing Unit\|Signal processing controller.*\[1022:17f0\]'
```

If you see PCI ID `1022:17f0`, you're good.
