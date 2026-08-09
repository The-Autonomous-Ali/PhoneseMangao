#!/bin/sh
# Nightly database dump, uploaded offsite to Cloudflare R2.
#
# The Oracle Always Free tier carries no SLA — an idle instance can be reclaimed
# with little warning. A dump that only ever lands on the same disk as the
# database protects against nothing that actually happens.
#
# Requires rclone configured with an R2 remote named `r2`:
#   rclone config  ->  s3  ->  Cloudflare R2
#
# Restore:
#   rclone copy r2:phonesemangao-backups/<file> .
#   gunzip -c <file> | docker compose exec -T db psql -U phonesemangao phonesemangao

set -eu

APP_DIR="${APP_DIR:-/opt/phonesemangao}"
BUCKET="${BACKUP_BUCKET:-r2:phonesemangao-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

# shellcheck disable=SC1090
. "$APP_DIR/.env"

DB_USER="${POSTGRES_USER:-phonesemangao}"
DB_NAME="${POSTGRES_DB:-phonesemangao}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$APP_DIR/backups/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$APP_DIR/backups"

# -T: no TTY, so this works unattended from cron.
docker compose --project-directory "$APP_DIR" exec -T db \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$ARCHIVE"

# A dump that failed part-way still produces a file. Refuse to upload a stub
# and, worse, to then prune the good copies below it.
if [ ! -s "$ARCHIVE" ]; then
  echo "backup: dump is empty, refusing to upload $ARCHIVE" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

rclone copy "$ARCHIVE" "$BUCKET/"

# Keep the local disk from filling. The offsite copies are pruned by an R2
# lifecycle rule, not from here — a compromised box must not be able to delete
# the backups it is the reason for.
find "$APP_DIR/backups" -name '*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "backup: uploaded $(basename "$ARCHIVE")"
