#!/bin/sh
# Calls one cron route on the local app.
#
# A wrapper rather than a bare curl line in the crontab, for two reasons: cron
# runs with almost no environment, so CRON_SECRET has to be read from the same
# .env the app uses; and a secret written into the crontab is visible to every
# user on the box through `ps` every time the job fires.
#
# Usage: cron-job.sh generate-slots

set -eu

JOB="${1:?usage: cron-job.sh <job-name>}"
APP_DIR="${APP_DIR:-/opt/phonesemangao}"

# shellcheck disable=SC1090
. "$APP_DIR/.env"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "cron-job: CRON_SECRET is not set in $APP_DIR/.env" >&2
  exit 1
fi

# --fail so an HTTP error is a non-zero exit and cron mails it, rather than the
# job silently "succeeding" on a 401 for the last six months.
curl --fail --silent --show-error --max-time 300 \
  -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "http://127.0.0.1:3000/api/cron/$JOB"
