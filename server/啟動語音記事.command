#!/bin/zsh
cd "$(dirname "$0")"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
open http://localhost:3000
node server.js
