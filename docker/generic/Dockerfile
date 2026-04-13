# QuantDesk generic-engine runtime image.
#
# This is the single container image every `generic` desk uses to run
# agent-authored backtest / data-fetch / paper scripts. It bundles the
# five supported runtimes (python3, node, bun, rust, go) on top of
# Ubuntu LTS so scripts are isolated from the host regardless of the
# user's OS (macOS / Linux / Windows Docker Desktop).
#
# The image is intentionally kept as a single monolith instead of per-
# language variants. First pull is ~700-900MB compressed, but after
# that cargo/pip/npm/go-build caches are mounted from the host into
# the container so repeat runs are fast. Per CLAUDE.md rule #11 the
# tag is pinned and floats only when we deliberately rebuild.
#
# Published to ghcr.io/0xbet-ai/quantdesk-generic via the
# docker-generic.yml GitHub Actions workflow (multi-arch: amd64+arm64).
# Pulled automatically during `npx quantdesk onboard`.
#
# Build locally (for development):
#   pnpm build:generic-image
# which expands to:
#   docker build -t ghcr.io/0xbet-ai/quantdesk-generic:0.1.0 docker/generic/

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH=/root/.cargo/bin:/root/.bun/bin:/usr/local/go/bin:$PATH \
    CARGO_HOME=/root/.cargo \
    RUSTUP_HOME=/root/.rustup \
    GOPATH=/root/go \
    GOCACHE=/root/.cache/go-build \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=0

# ── Base tools + Python + Node + Go ──────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl git \
        build-essential pkg-config libssl-dev \
        python3 python3-pip python3-venv \
        nodejs npm \
        golang-go \
        unzip && \
    rm -rf /var/lib/apt/lists/*

# ── bun ──────────────────────────────────────────────────────────────
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# ── rust (pinned toolchain) ──────────────────────────────────────────
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y --default-toolchain 1.83.0 --profile minimal && \
    /root/.cargo/bin/rustc --version

# ── workspace + entrypoint ───────────────────────────────────────────
WORKDIR /workspace
COPY entrypoint.sh /usr/local/bin/quantdesk-entrypoint
RUN chmod +x /usr/local/bin/quantdesk-entrypoint
ENTRYPOINT ["/usr/local/bin/quantdesk-entrypoint"]
CMD ["--help"]
