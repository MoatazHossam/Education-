#!/usr/bin/env bash
# Stops the Curriculum Scope installation; data is kept (see ops/cs.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/cs.sh" stop "$@"
