#!/usr/bin/env bash
# Smoke test: posts the 5 README scenarios to a running server (`bun run dev`, port 3000).
# Usage: ./scripts/smoke.sh   (needs jq; URL=... to override the endpoint)
# Watch the server terminal for "RAW PLAN FROM PLANNER" (local planner worked) vs
# "Planner failed, falling back" (escalated to plannerFallback).
set -euo pipefail
URL=${URL:-http://localhost:3000/api/chat}

scenarios=(
  "What is the weather in Paris and what is the USD exchange rate today?"
  "Analyze this review on EvoPhone X: 'The phone is great but battery is weak', then tell me the average battery life from the KB."
  "If Yossi has 100 ILS and wants to buy PrintForge 3D Printer costing 25 USD, how many ILS remain?"
  "How much RAM does EvoPhone X have?"
  "What is the average battery life of EvoPhone X?"
)

# Plus one general-chat prompt (exercises the CHAT component, no stop sequences).
scenarios+=("Explain in two short paragraphs what a data lakehouse is.")

for s in "${scenarios[@]}"; do
  id=$(uuidgen | tr 'A-Z' 'a-z')
  echo "===== $s"
  curl -s "$URL" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg p "$s" --arg c "$id" '{prompt:$p, conversationId:$c}')" | jq -r '.message // .'
  echo
done
