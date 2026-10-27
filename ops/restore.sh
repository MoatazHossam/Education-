#!/usr/bin/env bash
# Restores a Curriculum Scope backup, or tests one with --only-verify (see ops/cs.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/cs.sh" restore "$@"
