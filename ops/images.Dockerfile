# Images the operations scripts (ops/midad.sh, ops/midad.ps1) run that the stack itself does not, pinned
# by digest so Dependabot (.github/dependabot.yml, directory /ops) proposes their updates (production
# finding S-15). Nothing builds this file: the scripts read the reference from the FROM line.
# (The scripts' PostgreSQL client and tool images come from docker-compose.yml and docker-compose.prod.yml.)
FROM rclone/rclone:1.76@sha256:7cbeec24a44f206067597c0368be4de90ae19a64d5113c7d1938bd737a81e466
