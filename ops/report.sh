#!/usr/bin/env bash
# Checks the server and the backups, cleans up what Docker no longer uses, and emails the report
# (see ops/midad.sh --help and docs/DEPLOYMENT_GUIDE.md §8.11).
exec "$(dirname "$0")/midad.sh" report "$@"
