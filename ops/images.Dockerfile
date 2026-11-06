# Images the operations scripts (ops/midad.sh, ops/midad.ps1) run that the stack itself does not, pinned
# by digest so Dependabot (.github/dependabot.yml, directory /ops) proposes their updates (production
# finding S-15). Nothing builds this file: the scripts read the reference from the FROM line.
# (The scripts' PostgreSQL client and tool images come from docker-compose.yml and docker-compose.prod.yml.)
FROM rclone/rclone:1.71@sha256:3103526c506266a9ecdf064efe99bf3677d92ef6407af124d8c56b4f49cbaa51
