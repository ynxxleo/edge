#!/usr/bin/env bash
set -euo pipefail

app_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
config_file="${EDGE_CPANEL_CONFIG:-${HOME}/.config/edge/deploy.env}"
if [[ ! -f "$config_file" ]]; then
    echo "Deployment setup is incomplete: create the private server configuration from deploy/cpanel.env.example." >&2
    exit 1
fi
# This owner-managed file contains verified PHP, Composer and document-root paths.
source "$config_file"
: "${PHP_BIN:?Configure PHP_BIN on the server}"
: "${COMPOSER_BIN:?Configure COMPOSER_BIN on the server}"
: "${EDGE_WEB_ROOT:?Configure EDGE_WEB_ROOT on the server}"
[[ -x "$PHP_BIN" && -f "$COMPOSER_BIN" && -f "$app_root/.env" ]] || {
    echo "Missing PHP, Composer, or the private production .env. Complete server setup first." >&2
    exit 1
}
[[ -d "$EDGE_WEB_ROOT" ]] || { echo "The configured domain document root does not exist." >&2; exit 1; }
web_root="$(CDPATH= cd -- "$EDGE_WEB_ROOT" && pwd -P)"
case "$app_root/" in
    "$web_root/"*) echo "The application checkout must be outside the public document root." >&2; exit 1 ;;
esac
if [[ "$web_root" != "$app_root/public" ]]; then
    echo "The domain must serve this checkout's public directory. Configure its document root or an inspected cPanel public-directory bridge first." >&2
    exit 1
fi
"$PHP_BIN" -r 'if (PHP_VERSION_ID < 80300 || !extension_loaded("bcmath") || !extension_loaded("fileinfo")) {fwrite(STDERR, "Use PHP 8.3+ with BCMath and Fileinfo.\n"); exit(1);}'
command -v flock >/dev/null || { echo "The deployment requires flock to serialize releases." >&2; exit 1; }
cd "$app_root"
exec 9>storage/framework/edge-deploy.lock
flock -n 9 || { echo "Another deployment is already running." >&2; exit 1; }
"$PHP_BIN" "$COMPOSER_BIN" install --no-dev --prefer-dist --no-interaction --optimize-autoloader
"$PHP_BIN" artisan config:clear
"$PHP_BIN" -r '
require "vendor/autoload.php";
$app = require "bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!$app->environment("production") || config("app.debug") || !config("app.key") || parse_url(config("app.url"), PHP_URL_SCHEME) !== "https" || !config("session.secure")) {
    fwrite(STDERR, "Configure production mode, APP_DEBUG=false, APP_KEY, HTTPS APP_URL and secure sessions before deployment.\n"); exit(1);
}
'
"$PHP_BIN" artisan migrate --force
"$PHP_BIN" artisan db:seed --class=CopyStrategySeeder --force
"$PHP_BIN" artisan config:cache
"$PHP_BIN" artisan route:cache
"$PHP_BIN" artisan view:cache
echo "Laravel deployment commands completed. Verify the domain and authenticated flows over HTTPS."
