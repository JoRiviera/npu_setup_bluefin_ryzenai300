# Reproduce the `npu` NPU/Lemonade distrobox from pinned sources.
#
# Full path on a fresh machine:
#   make host      # one-time host memlock fix (then reboot)
#   make image     # build pinned userspace image
#   make container # create the `npu` distrobox from the image
#   make config    # set ctx_size=32768 (agentic-client fix)
#   make models    # pull the FLM models (large: ~10 GB total)
#   make serve     # start the lemonade daemon
#
# `make all` does image + container + config (skips host reboot + heavy pulls).

IMAGE   := localhost/npu-lemonade:0.9.43
NAME    := npu
CTXSIZE := 32768
MODELS  := llama3.2-1b-FLM qwen3.5-9b-FLM

.PHONY: all image container config models serve host rm

all: image container config

image:
	podman build -t $(IMAGE) -f Containerfile .

container:
	distrobox assemble create --file distrobox.ini

config:
	distrobox enter $(NAME) -- lemonade config set ctx_size=$(CTXSIZE)

models:
	@for m in $(MODELS); do \
	  echo ">> pulling $$m"; \
	  distrobox enter $(NAME) -- lemonade pull $$m; \
	done

serve:
	distrobox enter $(NAME) -- bash -c 'nohup lemond > /tmp/lemond.log 2>&1 &'
	@echo "lemonade serving on http://localhost:13305  (log: /tmp/lemond.log in container)"

host:
	./setup-host.sh

rm:
	distrobox rm $(NAME) --force
