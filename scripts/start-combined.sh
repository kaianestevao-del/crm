#!/bin/sh
# Runs the API and the worker in the same container, since they share a filesystem
# (uploaded media, Baileys session credentials) that a split-service deploy can't provide
# without rewriting storage to an external service — see the deploy plan for why.
set -e

node apps/api/dist/index.js &
API_PID=$!

node apps/worker/dist/index.js &
WORKER_PID=$!

trap 'kill -TERM "$API_PID" "$WORKER_PID" 2>/dev/null' TERM INT

wait "$API_PID" "$WORKER_PID"
