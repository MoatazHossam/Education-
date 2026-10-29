#!/usr/bin/env bash
# Starts the Midad installation (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/midad.sh" start "$@"
