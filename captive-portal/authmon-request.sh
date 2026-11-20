#!/bin/sh
# openNDS remoterequest adapter: url action gatewayhash user_agent payload.
# Install on the router as /usr/lib/opennds/checkin-authmon-request.sh.
set -eu
[ "$#" -eq 5 ] || exit 1
case "$1" in https://*) ;; *) exit 1 ;; esac
case "$2" in list|view|clear|deauthed|custom) ;; *) exit 1 ;; esac
secret_file=${AUTHMON_TOKEN_FILE:-/etc/checkin-authmon.token}
IFS= read -r authmon_token < "$secret_file"
case "$authmon_token" in ''|*[!A-Za-z0-9_-]*) exit 1 ;; esac
[ "${#authmon_token}" -ge 32 ] && [ "${#authmon_token}" -le 256 ] || exit 1
if command -v base64 >/dev/null 2>&1; then
  encoded_payload=$(printf '%s' "$5" | base64)
  encoded_payload=$(printf '%s' "$encoded_payload" | tr -d '\n')
else
  # OpenWrt commonly provides openssl but no standalone base64 utility.
  encoded_payload=$(printf '%s' "$5" | openssl base64 -A)
fi
# Keep the credential out of URLs and curl's process arguments.
# Do not follow redirects; never disable certificate validation.
printf 'header = "Authorization: Bearer %s"\n' "$authmon_token" |
  curl --disable --config - --silent --show-error --fail --proto '=https' \
    --connect-timeout 10 --max-time 20 --get --user-agent "$4" \
    --data-urlencode "auth_get=$2" --data-urlencode "gatewayhash=$3" \
    --data-urlencode "payload=$encoded_payload" --url "$1"
