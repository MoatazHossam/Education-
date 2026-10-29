#!/usr/bin/env bash
# Restores a Midad backup, or tests one with --only-verify (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/midad.sh" restore "$@"
