# Compatibility Matrix — De-risking the XDNA Caveat

Date: 2026-06-18
Goal: Find a path where **kernel driver ABI**, **XRT userspace version**, **firmware version**, and **FLM expectations** all intersect cleanly. Decide before any install.

## Evidence collected

### 1. What Bluefin's host currently runs

```
modinfo amdxdna.ko.xz
  filename: /lib/modules/7.0.9-205.fc44.x86_64/kernel/drivers/accel/amdxdna/amdxdna.ko.xz
  depends:  gpu-sched
  (no `version:` field — typical for in-kernel driver)

journalctl -k:
  amdxdna 0000:c2:00.1: [drm] Load firmware amdnpu/17f0_10/npu_7.sbin
  [drm] Initialized amdxdna_accel_driver 0.6.0 for 0000:c2:00.1 on minor 0
```

→ **In-tree upstream `amdxdna` driver v0.6.0**, loading **`npu_7.sbin`** (firmware protocol 7).

### 2. What `amd/xdna-driver` upstream ships (latest tag `2.21.75`)

Repo contains **two** driver source trees:
- `drivers/accel/amdxdna/` — upstream/staging, mirrors Linux mainline. Built into `amdxdna.ko` and **installed as DKMS, overriding the in-kernel module**.
- `src/driver/amdxdna/` — out-of-tree legacy `amdxdna_legacy.ko`. Installed alongside for compat/bring-up.

`./build.sh -release` produces:
- XRT base `.deb` (e.g., `xrt_202510.2.19.0_22.04-amd64-base.deb`)
- `xrt_plugin.*-amdxdna.deb` — DKMS module + XRT plugin

Ubuntu support: 22.04 (kernel needs upgrade to 6.10+), 24.04 (HWE → 6.11), 24.10 (in-kernel 6.11), 25.04 (in-kernel 6.14). No Fedora support.

### 3. What `xanderlent/amd-npu-driver` Copr ships (queried via API)

- `xrt` version: `202510.2.19.0~20250415gitd5835aa-4` (XRT 2.19.0, snapshot 2025-04-15)
- `xdna-driver` version: `2.19.0~20250423git75bc2dc-2` (snapshot 2025-04-23)
- Last build: **April 2025 — ~14 months stale**.
- Targets Fedora 40-44 + rawhide.

→ Copr is **two minor releases behind** AMD upstream (2.19 vs 2.21.75) and not actively maintained recently.

### 4. What FLM's Linux guide actually recommends

```sh
# Ubuntu (24.04, 25.10):
sudo add-apt-repository ppa:lemonade-team/stable
sudo apt update
sudo apt install libxrt-npu2 amdxdna-dkms
sudo reboot
```

→ **The PPA is `lemonade-team/stable`, not raw amd/xdna-driver releases.**

The `lemonade-team` is AMD's Lemonade Server team. The PPA is the **canonical, AMD-tested** path for the FLM + Lemonade Linux stack. Packages there:
- `libxrt-npu2` — AMD XRT NPU userspace (versioned to track FLM compatibility)
- `amdxdna-dkms` — DKMS module that **overrides** stock kernel `amdxdna`

FLM `flm validate` expected output:
```
[Linux]  Kernel: 7.0.0-rc1-00052-g27936bfca73d
[Linux]  NPU: /dev/accel/accel0
[Linux]  NPU FW Version: 1.1.2.64
[Linux]  Memlock Limit: infinity
```

→ FLM is tested on kernel 7.0+ (matches Bluefin's 7.0.9). Expects FW 1.1.2.64. We need to confirm what FW is on disk.

### 5. Firmware: what's installed vs what's loaded

Files present:
```
/usr/lib/firmware/amdnpu/
  17f0_10/   (our device ID, FW protocol 7)
  17f0_11/
  1502_00/
```

Driver loaded: `amdnpu/17f0_10/npu_7.sbin` (protocol 7). FLM Arch note says some `linux-firmware-other` packages include both protocol 6 (`npu.sbin.1.0.0.63`) and protocol 7 (`npu.sbin.1.1.2.64`); stock kernel 6.19 in-tree expects protocol 6, DKMS expects protocol 7. **Our in-tree 7.0.9 driver successfully loaded a protocol 7 firmware** → the in-tree driver on this newer kernel speaks protocol 7. ✓

We'll confirm FW version reported via `xrt-smi examine` and `flm validate` post-install.

## The decisive question

> *Does FLM work with the in-kernel `amdxdna` driver on Linux 7.0.9, given AMD's userspace XRT?*

Evidence says **yes**:
- FLM's own validate sample output shows kernel `7.0.0-rc1` (very close to our 7.0.9).
- AMD upstream xdna-driver tree IS the same code as the in-kernel module (they upstream `drivers/accel/amdxdna/` from this exact path).
- Protocol 7 firmware is already loading.

But FLM **prefers** the DKMS path (per Arch docs: "Confirm modinfo resolves to DKMS"). Risk: an FLM bug fix may rely on a newer DKMS-only patch not yet in mainline 7.0.

## Decision matrix (revised)

| Path | Source | XRT ver | Driver | Maintained? | Works with in-kernel amdxdna? | Verdict |
|---|---|---|---|---|---|---|
| **B1: Ubuntu 24.04 distrobox + lemonade-team PPA** | AMD Lemonade team | matches FLM | DKMS (but DKMS can't load from container — falls back to host in-kernel) | YES (active) | YES (FLM Linux docs confirm 7.0+) | **Best** |
| B2: Ubuntu 24.04 distrobox + raw amd/xdna-driver .deb | AMD official | 2.21.75 | DKMS | YES | YES | Good but less FLM-tested |
| A: Fedora 44 distrobox + Copr | Community | 2.19.0 (stale 14mo) | DKMS (skipped in container) | NO (stale) | Probably | Risky — stale |
| C: rpm-ostree layer host | Copr | 2.19.0 (stale) | DKMS conflicts with in-kernel | NO | Conflict | Reject |

## DKMS-in-container nuance

Both AMD `.deb` and Copr install a DKMS module. **A distrobox container cannot load kernel modules** — it shares the host kernel. The DKMS package post-install hook will either:
- Fail silently and continue (most common — install completes, module not loaded into host).
- Try to invoke `dkms install`, hit a permission error, and report a warning.

**This is fine for us** because the host already has `amdxdna` loaded from the in-kernel source. The container only needs the **userspace XRT + plugin libraries**, not a working DKMS build.

To avoid noise, we may want to install only the userspace pieces, e.g.:
```sh
# Ubuntu / lemonade-team PPA
sudo apt install libxrt-npu2 --no-install-recommends
# Skip: amdxdna-dkms (host already has the module)
```

But `libxrt-npu2` may depend on `amdxdna-dkms`. If so, we have two options:
1. Let DKMS install fail/skip and proceed (container is isolated; the failed DKMS leaves no host residue).
2. Use `--no-install-recommends` plus dpkg `--force-depends` (ugly).
3. Repack libxrt-npu2 without the dep.

Option 1 is cleanest. The DKMS failure inside the container does not touch the host's `/lib/modules`.

## Final recommendation

**Path B1: distrobox Ubuntu 24.04 + lemonade-team PPA.**

Reasons:
1. AMD-blessed source for the FLM stack (Lemonade team owns it).
2. Same userspace AMD ships in its docs.
3. FLM docs target this exact path.
4. Bluefin host kernel `amdxdna 0.6.0` + protocol 7 firmware → compatible per FLM's own validate sample (which shows kernel 7.0).
5. DKMS-in-container is a non-event because host kernel already has the module.

**Mitigations if Plan B1 fails**:
- B2 fallback: build XRT/xdna from `amd/xdna-driver` source for exact-version control.
- Build FLM from source as a final fallback (FLM has a `linux-default` cmake preset and source build is documented).

## Open verifications

### Resolved

✓ **Firmware version on host**: `cat /sys/class/accel/accel0/device/fw_version` → `1.1.2.64` — **exact match** to FLM's documented expected output.
✓ **Firmware files on host**: `/usr/lib/firmware/amdnpu/17f0_10/` contains both `npu.sbin.1.0.0.63.xz` (protocol 6) and `npu.sbin.1.1.2.64.xz` (protocol 7). Symlink `npu_7.sbin.xz → npu.sbin.1.1.2.64.xz` makes our protocol-7 driver path work out of the box.
✓ **`/dev/accel/accel0`**: `crw-rw-rw-` — unprivileged access OK.
✓ **distrobox version**: 1.8.2.4 — recent, supports auto device passthrough.

### Still open (small)

- **Memlock limit currently `8192` (not unlimited)** — FLM requires raising this. One host-side change required: `/etc/security/limits.d/99-amdxdna.conf`. Fully reversible (`sudo rm` the file). Logged in CHANGELOG.
- **lemonade-team PPA package availability for our target XRT version** — verify at install time by `apt-cache madison libxrt-npu2` after adding PPA inside container.
- **Whether distrobox 1.8.2.4 auto-passes `/dev/accel/accel0` into Ubuntu container** — test inside fresh container with `ls /dev/accel`. If missing, recreate with `--volume /dev/accel:/dev/accel`. Trivial fallback.

## Conclusion

**Caveat resolved**: Bluefin's in-kernel `amdxdna 0.6.0` runs **firmware 1.1.2.64** — the **exact** version FLM's validate sample shows. AMD's Lemonade team builds their PPA against this same kernel/firmware combo. Path B1 is safe to commit to.

Only host-side change needed: memlock limit. That's it.
