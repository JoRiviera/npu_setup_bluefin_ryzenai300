# Hardware & OS Discovery

Date: 2026-06-18
Host: Bluefin DX 44 (Silverblue base), kernel 7.0.9

## Command 1 — Identify NPU silicon + kernel + OS

**Why**: FastFlowLM only supports XDNA 2 silicon. Lemonade install path depends on OS family. FLM needs kernel ≥7.0. Firmware must be present in `/usr/lib/firmware/amdnpu/`.

```bash
uname -r
lspci -nn | grep -i 1022
cat /etc/os-release | grep -E '^(NAME|VERSION|VARIANT)'
ls /usr/lib/firmware/amdnpu/
```

**Output (relevant lines)**:

```
7.0.9-205.fc44.x86_64

c2:00.1 Signal processing controller [1180]: AMD Strix/Krackan/Strix Halo Neural Processing Unit [1022:17f0] (rev 20)

NAME="Bluefin"
VERSION="44.20260616.1 (Silverblue)"
VARIANT="Silverblue"
VARIANT_ID=bluefin-dx

/usr/lib/firmware/amdnpu/
  17f0_10
  17f0_11
  1502_00
```

**What it tells me**:

| Check | Result | Implication |
|---|---|---|
| NPU PCI ID `1022:17f0` rev 20 | Strix/Krackan/Strix Halo | XDNA 2 — FLM compatible |
| Kernel `7.0.9-fc44` | ≥7.0 | FLM kernel requirement met |
| OS `bluefin-dx` (Silverblue) | rpm-ostree immutable | **Cannot `dnf install` to /usr.** Must use `rpm-ostree`, distrobox/toolbox, flatpak, or nix |
| Firmware `17f0_10/11`, `1502_00` | Present | NPU runtime firmware shipped in base image |

Original setup notes assumed mutable Fedora. Bluefin is immutable — full plan revision needed.
