# Reproducible userspace stack for AMD XDNA 2 NPU inference.
# Bakes the pinned XRT + Lemonade + FastFlowLM software layer.
#
# Does NOT (and cannot) contain:
#   - the amdxdna kernel module      -> lives in the host kernel (Bluefin in-tree)
#   - /dev/accel + /dev/dri passthrough -> injected by distrobox at runtime
#   - the host memlock fix           -> see setup-host.sh
#   - the models                     -> pulled at first run (too big to bake)
#
# Build:  podman build -t localhost/npu-lemonade:0.9.43 -f Containerfile .
# Versions confirmed against CHANGELOG.md (2026-06-18 install).

FROM docker.io/library/ubuntu:24.04

# Pinned package versions. If the PPA later drops an exact version, remove the
# "=<version>" suffix to take the current build (reproducibility degrades to
# "latest in PPA" but the install still works).
ARG XRT_NPU_VERSION="1:2.21.75-1~noble1"
ARG LEMONADE_VERSION="10.8.0~24.04"
ARG FLM_VERSION="0.9.43"

# 1. AMD lemonade-team PPA -> XRT runtime + Lemonade server (+ ffmpeg dep)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates wget gnupg \
 && add-apt-repository -y ppa:lemonade-team/stable \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      "libxrt-npu2=${XRT_NPU_VERSION}" \
      "lemonade-server=${LEMONADE_VERSION}" \
      ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# 2. FastFlowLM .deb (GitHub release, matched to the XRT/Lemonade stack)
RUN cd /tmp \
 && wget -q "https://github.com/FastFlowLM/FastFlowLM/releases/download/v${FLM_VERSION}/fastflowlm_${FLM_VERSION}_ubuntu24.04_amd64.deb" \
 && apt-get update \
 && apt-get install -y --no-install-recommends "./fastflowlm_${FLM_VERSION}_ubuntu24.04_amd64.deb" \
 && rm -f "fastflowlm_${FLM_VERSION}_ubuntu24.04_amd64.deb" \
 && rm -rf /var/lib/apt/lists/*

# distrobox re-runs its own init on first `enter` (user creation, home mount,
# device passthrough). Nothing else to do here.
