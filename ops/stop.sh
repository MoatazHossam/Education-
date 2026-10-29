#!/usr/bin/env bash
# Stops the Midad installation; data is kept (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/midad.sh" stop "$@"
