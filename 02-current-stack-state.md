# Current Stack State

Date: 2026-06-18

## Command — Check kernel module, device node, tooling, ostree

**Why**: Before installing anything, find out what Bluefin already ships. If `amdxdna` module is loaded and `/dev/accel/accel0` exists, kernel-side is done and only userspace (XRT, FLM, Lemonade) needs install.

```bash
lsmod | grep -iE 'amdxdna|amdgpu'
ls -la /dev/accel/
ls -la /dev/dri/
command -v xrt-smi nix flatpak distrobox toolbox lemonade-server flm
rpm-ostree status | head -40
```

**Output (key parts)**:

```
amdxdna               221184  0
amdgpu              22118400  41
gpu_sched              73728  2 amdxdna,amdgpu

/dev/accel/
  crw-rw-rw-  261,0 accel0

/dev/dri/
  crw-rw----  226,1 card1
  crw-rw-rw- 226,128 renderD128

xrt-smi:          MISSING
nix:              MISSING
flatpak:          /usr/bin/flatpak
distrobox:        /usr/bin/distrobox
toolbox:          /usr/bin/toolbox
lemonade-server:  MISSING
flm:              MISSING

Deployments:
 ostree-image-signed:docker://ghcr.io/ublue-os/bluefin-dx:gts
   Version: 44.20260616.1
```

## What it tells me

### Already done (no work needed)
- `amdxdna` kernel module **loaded** — Bluefin's mainline kernel includes it.
- `/dev/accel/accel0` exists, world-rw (`crw-rw-rw-`) — userspace can talk to NPU without sudo.
- AMD firmware shipped in base image.

### Still missing
- **XRT userspace** (`xrt-smi`, `libxrt_core`, `xrt_coreutil`) — required by FLM to issue commands to the NPU.
- **FastFlowLM (`flm`)** — NPU LLM runtime.
- **Lemonade server** — OpenAI-compatible API wrapper that drives FLM.

### Environment constraints
- No `nix` despite Bluefin marketing — original plan's `nix-profile install` won't work without first installing Nix (Determinate Systems installer or similar). Skip nix path.
- `distrobox` + `toolbox` + `flatpak` all available — these are the Bluefin-native install vectors.
- Current rpm-ostree deployment is `bluefin-dx:gts` (Generally Trusted Stable). Any `rpm-ostree install` requires reboot and is wiped on base-image rebase unless pinned.

## Install path implication

Two viable strategies:

### Path A — distrobox (recommended)
Pros: no rpm-ostree mutation, survives base updates, isolates build tools, /dev/accel passthrough works.
Cons: shell wrapper needed (`distrobox-enter`), slight startup overhead.

### Path B — rpm-ostree layering
Pros: native binaries on host, no container.
Cons: requires Copr (no signed image source), reboot per change, may break on next Bluefin update, build-tool clutter in `/usr`.

Lemonade itself ships an `install.sh` that prefers system Python or builds a venv — easy in either path.

Recommendation: **Path A (distrobox)** for FLM + XRT (needs build tools), with Lemonade either inside the same container or as a host venv talking to the same `/dev/accel/accel0`.
