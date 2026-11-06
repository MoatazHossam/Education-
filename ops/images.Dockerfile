# Images the operations scripts (ops/midad.sh, ops/midad.ps1) run that the stack itself does not, pinned
# by digest so Dependabot (.github/dependabot.yml, directory /ops) proposes their updates (production
# finding S-15). Nothing builds this file: the scripts read the reference from the FROM line.
# (The scripts' PostgreSQL client and tool images come from docker-compose.yml and docker-compose.prod.yml.)
FROM rclone/rclone:1.75@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5
