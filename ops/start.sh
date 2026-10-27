#!/usr/bin/env bash
# Starts the Curriculum Scope installation (see ops/cs.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/cs.sh" start "$@"
