#!/usr/bin/env bash
# Shows whether the Curriculum Scope installation is running and ready (see ops/cs.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/cs.sh" status "$@"
