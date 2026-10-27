#!/usr/bin/env bash
# Backs up the Curriculum Scope installation, with copies to a folder or USB drive, a server or a bucket (see ops/cs.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/cs.sh" backup "$@"
