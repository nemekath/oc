FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /experiment \
    && chown node:node /experiment

ENV LOOP_DELAY_SECONDS=5 \
    MAX_ITERATIONS=0 \
    SKILL_NAME=web-browsing-cli \
    SKILL_SOURCE=https://github.com/only-cli/oc

WORKDIR /experiment

COPY --chmod=0755 loop.sh /usr/local/bin/skills-install-remove-loop

USER node

CMD ["skills-install-remove-loop"]
