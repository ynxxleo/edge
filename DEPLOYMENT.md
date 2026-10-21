# Deploy EDGE through Git

Target repository: `https://github.com/ynxxleo/edge.git`. Target host: Namecheap cPanel, `https://edgepremiums.com`. Commit author: `ynxxleo <ynxxleo@edgepremiums.com>`. Server connection details and authenticated Git access are verified separately before deployment. The existing `.openai/hosting.json` and `dist/` belong to the earlier static preview; the Laravel site's web root is `public/`.

## Namecheap cPanel setup

The checked-in `.cpanel.yml` runs `scripts/deploy-cpanel.sh`. cPanel supports pulling updates from a remote repository and deploying the checked-in tasks through its Git Version Control interface ([cPanel deployment documentation](https://docs.cpanel.net/knowledge-base/web-services/guide-to-git-deployment/), [Namecheap Git instructions](https://www.namecheap.com/support/knowledgebase/article.aspx/10113/2210/how-to-use-git-version-control-cpanel-plugin/)). The server checkout must stay outside the domain's publicly served directory.

1. Enable SSH/Terminal and confirm the cPanel SSH hostname, username, port, domain document root and selected PHP version. Verify the server's PHP and Composer paths rather than assuming the sample paths are installed.
2. Create a cPanel Git checkout of the repository, such as `/home/CPANEL_USER/repositories/edge`, using authenticated read access if the repository is private.
3. Serve only that checkout's `public/` directory. If this is the account's primary domain and its document root cannot be changed, inspect the existing document root before configuring a public-directory bridge. The deployment hook stops until the actual public path is configured; it does not copy the private app into `public_html` or overwrite an existing site.
4. Create the production database and grant its dedicated user access in cPanel. Configure the checkout's private `.env` from `.env.production.example`, with real database values and a production encryption key. Keep `storage/` persistent and private KYC files outside the web root.
5. Copy `deploy/cpanel.env.example` to `~/.config/edge/deploy.env` on the server and enter the verified paths. Protect both configuration files so only the account owner can read them.
6. Run the initial-install commands below and create the administrator interactively. Later releases use cPanel **Git Version Control → Manage → Pull or Deploy → Update from Remote → Deploy HEAD Commit**. The hook serializes deploy commands, installs locked dependencies, applies migrations, seeds only strategy definitions and rebuilds caches. It never generates a new key or imports the local database.

A push to GitHub alone does not update cPanel. The initial setup uses cPanel's explicit pull/deploy flow; automatic triggering can be connected once server access is verified. Keep the working tree clean so cPanel can deploy updates.

## Host configuration

Use PHP 8.3 or later with the extensions required by [Laravel 13 deployment](https://laravel.com/docs/13.x/deployment), plus BCMath and the PDO driver for the chosen database. Enable Fileinfo for image uploads. Composer installs dependencies from `composer.lock`. Application assets are already committed in `public/assets`; the Laravel host does not need a Node build to serve them.

Configure the web server to serve only `public/`, with requests routed to `public/index.php`, and enable HTTPS for the final domain. The PHP worker needs write access to `storage/` and `bootstrap/cache/`. Keep the database and private KYC files on persistent storage, including when releases or containers are replaced. Backups must preserve the database, private KYC files and encryption key together.

Create the host's environment variables using `.env.production.example` as a template. Set `APP_ENV=production`, `APP_DEBUG=false`, the real HTTPS `APP_URL`, the actual database connection, and a production `APP_KEY`. Generate the key once for a new empty installation; preserve it across releases. Configure secrets on the host rather than in Git. HTTPS sessions use secure, encrypted cookies. If a reverse proxy terminates HTTPS, configure its trusted proxy addresses for that host before testing sessions.

Set PHP upload limits to support the existing forms: `upload_max_filesize` at least `2M`, `post_max_size` at least `8M`, and `max_file_uploads` at least `20`. KYC files stay outside `public/`. The manual-method image limit remains 1 MB in application validation.

## Initial installation on an empty production database

After checking out the selected Git revision and configuring the host's environment and persistent paths:

```sh
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
php artisan key:generate --force
php artisan migrate --force
php artisan db:seed --class=CopyStrategySeeder --force
php artisan edge:admin your-email@example.com --name="Your Name"
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Run `key:generate` only if the production key has not already been generated or supplied by the host. The admin command prompts privately for a password. No administrator password or local login file is deployed. `CopyStrategySeeder` creates the three default strategy definitions and preserves existing edits; it creates no sample fixtures, accounts, stakes or funds. The default `DatabaseSeeder` is for local sample fixtures and should not be used for this production install. Add actual games and payment methods through the admin desk.

## Subsequent releases

Back up persistent data, check out the reviewed revision, install locked dependencies, then apply migrations and rebuild Laravel caches:

```sh
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Preserve the production environment, database, encryption key and private storage. Do not run `migrate:fresh`, reset balances, copy the local test database, or regenerate the existing encryption key. The host's release mechanism must provide exclusive migrations and restart PHP workers when needed. Final Git-triggered release commands will be configured for the selected provider.

Configure a scheduler entry every minute using the deployment's actual release path:

```cron
* * * * * cd /absolute/path/to/current && php artisan schedule:run >> /dev/null 2>&1
```

This runs the existing hourly pruning of expired pending payment credentials. The app currently uses synchronous queues, so no queue worker is required.

## Verify the hosted release

Check `/up`, `/`, `/app`, and `/admin` over HTTPS. Sign in, confirm sessions and CSRF-protected requests work, confirm new wallets start at zero, and verify private KYC downloads require the owner or an admin. Confirm the chosen database and private uploads survive a release restart. Test new payment methods and review flows with an explicitly authorized test account. Configure any Stripe webhook with the hosted HTTPS URL; existing card-provider eligibility and production-mode restrictions remain in effect.

Git excludes real environment files, local credentials and backups, SQLite database files, dependencies, runtime logs/caches, and private KYC uploads. Only blank/example environment templates are committed. The Git repository does not transfer current local test funds or payment credentials.
