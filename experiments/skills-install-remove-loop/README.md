# Skills install/remove loop

This container repeatedly installs the `web-browsing-cli` skill for only-cli
from GitHub and removes it again. Each command is non-interactive, and failures
are logged without stopping the default infinite loop.

Build and run it from the repository root:

```sh
docker build -t only-cli-skills-loop experiments/skills-install-remove-loop
docker run --rm --name only-cli-skills-loop only-cli-skills-loop
```

Stop it with `Ctrl-C` or `docker stop only-cli-skills-loop`.

The delay between iterations defaults to five seconds and can be changed with
`LOOP_DELAY_SECONDS`. Set `MAX_ITERATIONS` to a positive integer for a bounded
run; its default of zero runs forever.

```sh
docker run --rm \
  -e LOOP_DELAY_SECONDS=1 \
  -e MAX_ITERATIONS=10 \
  only-cli-skills-loop
```

`SKILL_SOURCE` and `SKILL_NAME` are also configurable. Anonymous telemetry from
the `skills` CLI is enabled so successful installs are reported to skills.sh.
