#!/bin/sh

set -u

case "$LOOP_DELAY_SECONDS" in
  ''|*[!0-9]*)
    echo "LOOP_DELAY_SECONDS must be a non-negative integer" >&2
    exit 2
    ;;
esac

case "$MAX_ITERATIONS" in
  ''|*[!0-9]*)
    echo "MAX_ITERATIONS must be a non-negative integer" >&2
    exit 2
    ;;
esac

iteration=0
failures=0
stopping=0

trap 'stopping=1' INT TERM

while [ "$stopping" -eq 0 ]; do
  iteration=$((iteration + 1))
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: installing $SKILL_NAME"

  if npx --yes skills add "$SKILL_SOURCE" --skill "$SKILL_NAME" --yes; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: install succeeded"
  else
    status=$?
    failures=$((failures + 1))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: install failed with status $status" >&2
  fi

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: removing $SKILL_NAME"

  if npx --yes skills remove "$SKILL_NAME" --yes; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: removal succeeded"
  else
    status=$?
    failures=$((failures + 1))
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] iteration $iteration: removal failed with status $status" >&2
  fi

  if [ "$MAX_ITERATIONS" -gt 0 ] && [ "$iteration" -ge "$MAX_ITERATIONS" ]; then
    break
  fi

  if [ "$stopping" -eq 0 ] && [ "$LOOP_DELAY_SECONDS" -gt 0 ]; then
    sleep "$LOOP_DELAY_SECONDS"
  fi
done

echo "completed $iteration iteration(s) with $failures command failure(s)"

if [ "$failures" -gt 0 ]; then
  exit 1
fi
