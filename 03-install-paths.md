# Install Paths — XRT + FastFlowLM + Lemonade on Bluefin DX 44

Date: 2026-06-18
Context: Hardware confirmed XDNA 2 (Strix/Krackan). Kernel module + firmware + `/dev/accel/accel0` already present. Only userspace stack missing.

Three viable paths. Pick one — do **not** mix.

---

## Path A — distrobox Fedora 44 (RECOMMENDED)

### Why
- Bluefin native pattern for "I need build tools / non-standard packages".
- Host rpm-ostree untouched → safe across base-image rebases.
- Container sees `/dev/accel/accel0` automatically via distrobox device passthrough.
- Fedora userland matches Bluefin → same library versions, no glibc skew.
- Container disposable → easy to nuke and retry.

### Trade-offs
- Lemonade has to be invoked via `distrobox-enter` or an exported binary.
- One extra `~2GB` image on disk.
- USB / GPU passthrough already implicit in distrobox; no extra flags.

### Probable commands

```bash
# 1. Create the container
distrobox create --name npu --image registry.fedoraproject.org/fedora:44

# 2. Enter it
distrobox enter npu

# 3. Inside container: enable Copr + install XRT + build deps
sudo dnf copr enable xanderlent/amd-npu-driver
sudo dnf install -y xrt xdna-driver tcsh \
    ninja-build ffmpeg-free-devel fftw-devel rust cargo git cmake gcc-c++ python3-pip

# 4. Source XRT env
source /usr/xrt/setup.sh
echo 'source /usr/xrt/setup.sh' >> ~/.bashrc

# 5. Test NPU visibility from inside container
xrt-smi examine
```

Expected: `xrt-smi examine` lists the NPU device. If it does not, /dev/accel passthrough is broken (rare).

```bash
# 6. Build FastFlowLM
git clone https://github.com/FastFlowLM/FastFlowLM.git
cd FastFlowLM && mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j $(nproc)
sudo cmake --install .

# 7. Install Lemonade
curl -L https://lemonade-server.ai/install.sh | sh

# 8. Export commands to host (optional, convenience)
distrobox-export --bin /usr/local/bin/lemonade-server
distrobox-export --bin /usr/local/bin/flm
```

### Caveats
- `xanderlent/amd-npu-driver` Copr is a **community Copr**, not AMD-official. Pin a version or vendor the SRPMs if you care about reproducibility.
- `xdna-driver` Copr package includes a DKMS module. **In a distrobox container the DKMS build is harmless / no-op** because the container can't load kernel modules. We rely on Bluefin host's already-loaded `amdxdna`. The userspace bits (`libxrt_core`, firmware paths) are what we need from the package.
- Lemonade `install.sh`: review before running. It's a third-party install script that writes to `~/.local/bin` and creates a venv. Read it first:
  ```bash
  curl -L https://lemonade-server.ai/install.sh -o /tmp/lemonade-install.sh
  less /tmp/lemonade-install.sh
  ```

---

## Path B — distrobox Ubuntu 24.04

### Why
- AMD's primary supported Linux for ROCm / XRT / xdna is Ubuntu. Upstream packages are tested there first.
- AMD ships `.deb` for `xrt` and `xdna-driver` directly on ryzenai.docs.amd.com.

### Trade-offs
- Different package manager → diverges from rest of host toolchain.
- ROCm `.deb` repo for Ubuntu sometimes lags vs Fedora Copr on bleeding edge.
- Slight overhead translating Ubuntu paths in any docs you write later.

### Probable commands

```bash
distrobox create --name npu-ubu --image docker.io/library/ubuntu:24.04
distrobox enter npu-ubu

# Inside container
sudo apt update
sudo apt install -y wget gnupg ca-certificates curl

# Pull AMD's official xrt + xdna-driver debs (URLs from ryzenai.docs.amd.com — verify current)
wget https://ryzenai.docs.amd.com/.../xrt_*.deb
wget https://ryzenai.docs.amd.com/.../xrt_plugin*-amdxdna.deb
sudo apt install -y ./xrt_*.deb ./xrt_plugin*-amdxdna.deb

source /opt/xilinx/xrt/setup.sh
xrt-smi examine

# Then FLM + Lemonade as in Path A steps 6–8
```

### Caveats
- Exact `.deb` URLs change. Browse https://ryzenai.docs.amd.com first.
- ROCm `.deb` source needs `apt-key`/keyring — follow AMD's current instructions, do not blindly trust outdated guides.

---

## Path C — rpm-ostree layer on host

### Why
- Native binaries directly on Bluefin host. No container shell.
- Single command to invoke `lemonade-server` from any terminal.

### Trade-offs (the big ones)
- Requires **reboot** to apply.
- `xdna-driver` includes a DKMS module — DKMS on rpm-ostree is **fragile**. Module gets rebuilt against the host kernel during ostree deployment; if the build fails on a future base image, the deployment may fail to finalize.
- Bluefin base image already provides `amdxdna` in-kernel → the DKMS module from the Copr will **conflict** or be redundant. Likely have to ship `--exclude xdna-driver` and only layer the userspace pieces.
- Future Bluefin updates may break Copr layering. You will need to monitor `rpm-ostree status` carefully.

### Probable commands

```bash
# Enable Copr (rpm-ostree needs the .repo file manually)
sudo wget https://copr.fedorainfracloud.org/coprs/xanderlent/amd-npu-driver/repo/fedora-44/xanderlent-amd-npu-driver-fedora-44.repo \
     -O /etc/yum.repos.d/xanderlent-amd-npu-driver.repo

# Layer XRT (only — skip the DKMS package, host kernel already has amdxdna)
sudo rpm-ostree install xrt

# Reboot to apply layer
systemctl reboot

# After reboot, test
source /usr/xrt/setup.sh
xrt-smi examine
```

Then build FLM from `~/path/to/this/repo/FastFlowLM` (no container needed because xrt is on host).

### Caveats
- DO NOT `rpm-ostree install xdna-driver` — DKMS conflict with already-loaded in-kernel `amdxdna`. Only the userspace XRT bits.
- Lemonade can be installed under `~/.local` without rpm-ostree at all (just `pip` or its installer).
- Every Bluefin base update → check `rpm-ostree status` for failed layer rebuild.

---

## Decision matrix

| Concern | Path A (Fedora distrobox) | Path B (Ubuntu distrobox) | Path C (rpm-ostree layer) |
|---|---|---|---|
| Reversibility | `distrobox rm npu` | `distrobox rm npu-ubu` | `rpm-ostree rollback` + reboot |
| Survives base-image rebase | yes | yes | maybe (Copr may break) |
| Build tools pollute host | no | no | yes |
| Native CLI without wrapper | no (or via export) | no (or via export) | yes |
| AMD-official packages | community Copr | yes (.deb) | community Copr |
| Reboot needed | no | no | yes |

## Recommendation

**SUPERSEDED — see `04-revised-recommendation.md`. Path B with AMD official packages now recommended.**

Original reasoning (Path A) kept here for reference:
- Bluefin's idiomatic non-flatpak install vector.
- Fedora 44 userland inside container matches host glibc.
- Trivial to retry / nuke.

Rejected because: community Copr provenance vs. AMD-signed official .deb. Provenance + AMD-docs alignment + bug-report credibility outweigh the Fedora-native ergonomic gain.
