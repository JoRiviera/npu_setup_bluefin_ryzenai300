# Revised Recommendation — Use AMD Official Packages

Date: 2026-06-18
Supersedes the recommendation block in `03-install-paths.md`.

## User question

> Wouldn't it be better to have AMD official packages?

Yes. Revised recommendation: **Path B (distrobox Ubuntu 24.04 + AMD official `.deb`)**.

## Why AMD-official wins

| Concern | Copr (xanderlent) | AMD official .deb |
|---|---|---|
| Source | Community repackage of AMD source | AMD-signed release |
| Provenance / signature | Copr key | AMD release key |
| Match with AMD docs | Partial (Fedora paths differ) | Exact (docs assume Ubuntu paths) |
| Bug-report credibility to AMD | "Try official packages first" | First-class |
| Update cadence | When maintainer has time | AMD's Ryzen AI Software cycle |
| Reproducibility | depends on Copr availability | versioned .deb file you can vendor |

## Real caveat — kernel/userspace skew

AMD ships their `.deb` XRT userspace assuming their **out-of-tree** `xdna-driver` kernel module. Bluefin uses the **in-kernel upstreamed** `amdxdna` (mainlined into Linux ~6.11, mature in 7.0).

In practice the XRT↔XDNA ioctl ABI is stable across the two paths, but version skew can break things. Mitigation:

- Use XRT ≥ 2025.1 (release tag ~`xrt_2.18.0` or later) — these explicitly support the in-kernel `amdxdna`.
- Verify with `xrt-smi examine` after install. If it sees the NPU, ABI is OK.
- If it fails, downgrade XRT or build XRT from `Xilinx/XRT` `master` against host kernel headers (Bluefin ships them; alternatively distrobox container can fetch matching headers).

## Updated path matrix

| Path | Packages | Recommended? |
|---|---|---|
| A: distrobox Fedora 44 + Copr | Community | Fallback only |
| **B: distrobox Ubuntu 24.04 + AMD .deb** | **AMD official** | **YES** |
| C: rpm-ostree layer host | Community Copr + reboot | No (DKMS conflict risk) |

## Updated Path B commands (concrete)

URLs need verification at install time — AMD reorganizes `ryzenai.docs.amd.com` periodically. Will verify live before executing.

```bash
# 1. Create Ubuntu container
distrobox create --name npu --image docker.io/library/ubuntu:24.04

# 2. Enter
distrobox enter npu

# --- inside container ---
sudo apt update
sudo apt install -y wget gnupg ca-certificates curl build-essential cmake git \
    libfftw3-dev libavcodec-dev libavformat-dev libavutil-dev libswscale-dev \
    rustc cargo ninja-build python3 python3-pip python3-venv

# 3. Get AMD official xrt + xdna .debs
#    Latest release page: https://github.com/amd/xdna-driver/releases
#    Look for: xrt_*-amd64.deb  AND  xrt_plugin*-amdxdna_*-amd64.deb
#    Pin a specific version; latest as of 2026-06 should be checked.

mkdir -p ~/amd-npu && cd ~/amd-npu
# (will fetch exact URLs after verifying release page)

# 4. Install
sudo apt install -y ./xrt_*.deb ./xrt_plugin*-amdxdna_*.deb

# 5. Source XRT env
source /opt/xilinx/xrt/setup.sh
echo 'source /opt/xilinx/xrt/setup.sh' >> ~/.bashrc

# 6. Verify NPU visibility
xrt-smi examine
# Expected: NPU listed under "Devices present"

# 7. FastFlowLM
cd ~ && git clone https://github.com/FastFlowLM/FastFlowLM.git
cd FastFlowLM && mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j$(nproc)
sudo cmake --install .
flm validate

# 8. Lemonade
curl -L https://lemonade-server.ai/install.sh -o /tmp/lemonade-install.sh
less /tmp/lemonade-install.sh   # review before running
sh /tmp/lemonade-install.sh

# 9. Export Lemonade to host (optional)
distrobox-export --bin ~/.local/bin/lemonade-server
```

## Open questions to resolve before executing

1. Exact current XRT/xdna-driver .deb URLs on AMD's release page (will fetch live).
2. Whether FLM build script needs any patches for the in-kernel `amdxdna` ioctl interface (likely no, but check `flm validate` output).
3. Confirm `/dev/accel/accel0` is auto-passed into the Ubuntu distrobox (it should — distrobox passes all `/dev` by default — but verify with `ls /dev/accel` inside container).
