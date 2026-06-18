# Final Summary — NPU + FLM + Lemonade on Bluefin DX 44

Date: 2026-06-18
Status: **Working end-to-end.**

## What runs now

```
Host (Bluefin DX 44, kernel 7.0.9-fc44)
├── amdxdna 0.6.0  (in-kernel, upstream)
├── firmware 1.1.2.64 (amdnpu/17f0_10/npu_7.sbin)
├── /dev/accel/accel0  (crw-rw-rw-)
└── memlock = unlimited  (systemd manager defaults)
    │
    └── distrobox container `npu`  (Ubuntu 24.04.4 LTS)
        ├── libxrt2 2.21.75       (PPA lemonade-team/stable)
        ├── libxrt-npu2 2.21.75
        ├── fastflowlm v0.9.43    (GitHub Release .deb)
        ├── lemonade 10.8.0       (PPA lemonade-team/stable)
        └── ~/.config/flm/models/Llama-3.2-1B-NPU2/
```

## Verified

- `flm validate` → all green (kernel + NPU + FW + amdxdna + memlock)
- Direct FLM: "What is 2+2?" → "2 + 2 = 4" (NPU prefill 48 tokens)
- Lemonade OpenAI API `/api/v1/chat/completions` → "The capital of France is Paris."
  - Prefill 79.9 tps, decode 46.1 tps, TTFT 576 ms, 7 completion tokens

## Day-to-day usage

```bash
# Start daemon
distrobox enter npu -- nohup lemond > /tmp/lemond.log 2>&1 &

# Call OpenAI-compatible API
curl -s -X POST http://localhost:13305/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2-1b-FLM","messages":[{"role":"user","content":"Hello"}]}'

# CLI chat (interactive)
distrobox enter npu -- lemonade chat

# Direct FLM CLI
distrobox enter npu -- flm run llama3.2:1b

# List/pull more NPU models
distrobox enter npu -- flm list
distrobox enter npu -- flm pull gemma3:1b
```

## Optional next steps (not done)

- `distrobox-export --bin /usr/bin/lemonade --export-path ~/.local/bin/` → call `lemonade` from host shell without `distrobox enter`.
- Auto-start `lemond` at login. The `.deb` ships `/usr/lib/systemd/user/lemond.service` inside the container — but systemd `--user` isn't running inside distrobox by default. Easier: add `nohup lemond &` to `~/.bashrc` or write a `~/.config/systemd/user/` unit on the **host** that launches `distrobox enter npu -- lemond` (untested).
- Pull a larger model for actual work: `gemma3:4b`, `gemma4-it:e4b`, `gpt-oss:20b` (32 GB RAM headroom = ~24.5 GB usable).
- Try `lemonade run llama3.2-1b-FLM` to get the web UI (port 13305) in a browser.

## Host changes made (all reversible — see CHANGELOG.md)

1. Container `npu` (distrobox) — `distrobox rm npu --force` to undo all.
2. `/etc/systemd/system.conf.d/99-memlock.conf` — `sudo rm` + reboot.
3. `/etc/systemd/user.conf.d/99-memlock.conf` — `sudo rm` + reboot.

No `rpm-ostree` mutation. No `/usr` modification. No DKMS modules layered. Base image untouched.

## Diverged from original setup notes

| Original recommendation | What actually worked |
|---|---|
| `nix-profile install` Lemonade | Lemonade is in `lemonade-team/stable` PPA (.deb) |
| `dnf copr enable xanderlent/amd-npu-driver` | Use lemonade-team PPA inside Ubuntu distrobox |
| Build FLM from source | FLM ships `.deb` for Ubuntu 24.04 on GitHub Releases |
| `/etc/security/limits.d/99-amdxdna.conf` | `/etc/systemd/system.conf.d/99-memlock.conf` (PAM limits don't apply to Bluefin's GDM session) |
| `lemonade-server start` | `lemond` is the daemon; `lemonade` is the CLI client |
| Build `xdna-driver` kernel module | **Not needed** — Bluefin kernel 7.0 already ships in-tree `amdxdna 0.6.0` |
