# Change Log & Reversibility Tracker

Every host-affecting change goes here. Every entry must include the **undo command**.

So far: **no host changes**. Only files in `~/path/to/this/repo/` (this repo). All read-only commands run on host.

## Format

```
### YYYY-MM-DD HH:MM — short description
**Change**: what we did
**Why**: why we did it
**Undo**: command(s) to fully reverse
**Verify undo**: how to confirm reversal worked
```

## Entries

### 2026-06-18 — Created discovery/analysis docs
**Change**: Wrote `01-hardware-discovery.md`, `02-current-stack-state.md`, `03-install-paths.md`, `04-revised-recommendation.md`, `05-compatibility-matrix.md`, this CHANGELOG, and tasks #1-#5 in TaskList.
**Why**: Document what Bluefin already provides + plan install path.
**Undo**: `rm -rf ~/path/to/this/repo/*.md` (only touches this dir)
**Verify undo**: `ls ~/path/to/this/repo/` empty.

### 2026-06-18 — Created `npu` distrobox container (Ubuntu 24.04.4)
**Change**: `distrobox create --name npu --image docker.io/library/ubuntu:24.04 --yes`. Pulled `8bf6fbc94074`. Container started, user account set up with sudo. Verified `/dev/accel/accel0` and `/dev/dri/renderD128` passed through automatically.
**Why**: Isolated env for AMD XRT + FLM + Lemonade install. Keeps host clean.
**Undo**: `distrobox stop npu && distrobox rm npu --force`
**Verify undo**: `distrobox list` shows no `npu`; `podman ps -a | grep npu` empty.
**Image cleanup (optional)**: `podman rmi docker.io/library/ubuntu:24.04` to recover ~80MB.

### 2026-06-18 — Added `lemonade-team/stable` PPA inside `npu` container
**Change**: `add-apt-repository -y ppa:lemonade-team/stable` inside container. Added apt source for AMD Lemonade team packages.
**Why**: Canonical source for `libxrt-npu2` + `lemonade-server` matched to FLM stack.
**Undo**: `distrobox enter npu -- sudo add-apt-repository --remove -y ppa:lemonade-team/stable` (or just `distrobox rm npu --force`).
**Verify undo**: `distrobox enter npu -- apt-cache madison libxrt-npu2` returns nothing.

### 2026-06-18 — Installed XRT + ffmpeg + lemonade-server inside container
**Change**: `apt-get install -y libxrt-npu2 ffmpeg lemonade-server` inside `npu` container. Versions: `libxrt-npu2 1:2.21.75-1~noble1`, `lemonade-server 10.8.0~24.04`. Pulled in `libxrt2 2.21.75` as transitive dep. Notes: shared libs land in `/usr/lib/x86_64-linux-gnu/`; `/usr/bin/lemonade` (CLI) and `/usr/bin/lemond` (daemon) installed; no `xrt-smi` binary in PPA (libs only).
**Why**: Provide NPU userspace runtime + OpenAI-API server. Skipped `amdxdna-dkms` because host already has in-kernel `amdxdna 0.6.0`.
**Undo**: `distrobox enter npu -- sudo apt-get purge -y libxrt-npu2 libxrt2 ffmpeg lemonade-server && sudo apt-get autoremove -y` (or just `distrobox rm npu --force`).
**Verify undo**: `distrobox enter npu -- dpkg -l libxrt-npu2 lemonade-server 2>&1 | grep -c "^ii"` returns `0`.

### 2026-06-18 — Host memlock attempt #1 (PAM limits.d) — DID NOT WORK
**Change**: Wrote `/etc/security/limits.d/99-amdxdna.conf` with `<your-user> soft/hard memlock unlimited`.
**Result**: After reboot, `ulimit -l` still `8192`. Bluefin's GDM/Wayland session goes through `gdm-password → password-auth` which DOES include `pam_limits.so`, but limits didn't take effect (likely SELinux interaction or kernel default cap not raised via PAM).
**Undo executed**: `sudo rm /etc/security/limits.d/99-amdxdna.conf` (done in change #6 below).

### 2026-06-18 — Host memlock attempt #2 (systemd manager defaults) — WORKS ✓
**Change**: Created `/etc/systemd/system.conf.d/99-memlock.conf` and `/etc/systemd/user.conf.d/99-memlock.conf` with:
```
[Manager]
DefaultLimitMEMLOCK=infinity
```
Removed prior `/etc/security/limits.d/99-amdxdna.conf` in the same operation.
**Why**: PAM-based limits.d didn't apply on Bluefin GDM session. systemd-manager defaults bypass PAM entirely and propagate to all spawned units including `user@1000.service`.
**Result after reboot**: `ulimit -l` = `unlimited`. `systemctl show --property=DefaultLimitMEMLOCK` = `infinity`. Container inherits `unlimited`. `flm validate` all green.
**Undo**:
```bash
sudo rm /etc/systemd/system.conf.d/99-memlock.conf /etc/systemd/user.conf.d/99-memlock.conf
sudo systemctl reboot
```
**Verify undo**: `systemctl show --property=DefaultLimitMEMLOCK` returns the kernel default (likely 8 MiB).

### (Pending) — distrobox-export to ~/.local/bin
If we want `lemonade`/`flm` callable from host shell without `distrobox enter npu --`. Reversible via `distrobox-export --bin ... --delete`.

## Hard rules

1. **Never modify `/usr` directly** — Bluefin is rpm-ostree immutable; this would silently fail or be wiped.
2. **No `rpm-ostree install`** without explicit user approval — requires reboot, risks future rebases.
3. **Never overwrite firmware in `/usr/lib/firmware/amdnpu/`** — base image owns it.
4. **`/dev/accel/accel0` permissions are already world-rw** — don't add udev rules without approval.
5. **All container-internal changes inherit `distrobox rm` as the global undo** — listing them granularly is informational only.
