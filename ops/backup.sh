#!/usr/bin/env bash
# Backs up the Midad installation, with copies to a folder or USB drive, a server or a bucket (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8).
exec "$(dirname "$0")/midad.sh" backup "$@"
