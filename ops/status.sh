#!/usr/bin/env bash
# Shows whether the Midad installation is running and ready (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/midad.sh" status "$@"
