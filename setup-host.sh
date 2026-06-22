#!/usr/bin/env bash
# The ONE host-side mutation the NPU stack needs: raise memlock so FLM can
# pin its weight buffers. Reversible (see CHANGELOG.md "Host memlock fix").
# Requires a reboot to take effect. Everything else lives in the container.
set -euo pipefail

sudo mkdir -p /etc/systemd/system.conf.d /etc/systemd/user.conf.d
printf '[Manager]\nDefaultLimitMEMLOCK=infinity\n' | sudo tee \
  /etc/systemd/system.conf.d/99-memlock.conf \
  /etc/systemd/user.conf.d/99-memlock.conf >/dev/null

echo "memlock config written. Reboot for it to take effect:  sudo systemctl reboot"
echo "Undo: sudo rm /etc/systemd/{system,user}.conf.d/99-memlock.conf && reboot"
