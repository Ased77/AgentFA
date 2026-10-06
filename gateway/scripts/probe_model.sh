#!/usr/bin/env sh
# Ask the INTERNAL LiteLLM proxy which model actually answered.
#
#   sh scripts/probe_model.sh [model] [iterations]
#
# Defaults: model=agent-pro, iterations=3.
#
# Why a script: LiteLLM publishes no port (customers must never reach it) and
# the image contains no curl - so the probe has to run *inside* the litellm
# container with python3. Never expose its output to customers: it deliberately
# prints real model names and real USD costs.
#
# Requires the stack to be running:  docker compose up -d
set -eu

MODEL="${1:-agent-pro}"
ITERATIONS="${2:-3}"

READER='
import json, os, sys, urllib.error, urllib.request

model = sys.argv[1]
request = urllib.request.Request(
    "http://localhost:4000/chat/completions",
    data=json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            "user": "ops-probe",
        }
    ).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"],
        "Content-Type": "application/json",
    },
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print(
            "%-12s -> model_used=%-32s real_cost=%s"
            % (
                model,
                response.headers.get("x-model-used", "<header missing>"),
                response.headers.get("x-real-cost", "<header missing>"),
            )
        )
except urllib.error.HTTPError as exc:
    print("%-12s -> HTTP %s (every provider in the chain failed)" % (model, exc.code))
except Exception as exc:  # noqa: BLE001 - ops script, show the reason
    print("%-12s -> error=%s: %s" % (model, type(exc).__name__, exc))
'

i=0
while [ "$i" -lt "$ITERATIONS" ]; do
    i=$((i + 1))
    docker compose exec -T litellm python3 -c "$READER" "$MODEL"
done
