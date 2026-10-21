#!/usr/bin/env python3
from otp_test_mail import complete_otp_fixture
"""Exercise the actual HTTP stack against a disposable SQLite database.

Sessions, CSRF, authentication, authorization, input validation and the full
admin -> wallet -> bet/copy -> result -> settlement flow are all covered.
"""
import base64
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.token = None

    def request(self, path, method="GET", data=None, csrf=True, accept=True):
        headers = {"Accept": "application/json"} if accept else {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if csrf and self.token:
            headers["X-CSRF-TOKEN"] = self.token
        req = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read().decode()
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw[:300]}
        if isinstance(body, dict) and "csrf_token" in body:
            self.token = body["csrf_token"]
        return response.status, body

    def expect(self, status, path, method="GET", data=None, **kwargs):
        code, body = complete_otp_fixture(self, status, path, self.request(path, method, data, **kwargs))
        check(code == status, f"{method} {path}: expected {status}, received {code}: {body}")
        return body


with tempfile.TemporaryDirectory(prefix="edge-api-") as directory:
    database = str(Path(directory) / "checks.sqlite")
    Path(database).touch()
    env = os.environ | {
        "APP_ENV": "local", "APP_DEBUG": "false", "APP_KEY": "base64:" + base64.b64encode(os.urandom(32)).decode(),
        "DB_CONNECTION": "sqlite", "DB_DATABASE": database, "SESSION_DRIVER": "database",
        "CACHE_STORE": "database", "CACHE_PREFIX": "edge-api-checks-", "BCRYPT_ROUNDS": "4",
    }
    subprocess.run(["php", "artisan", "migrate", "--force", "--quiet"], cwd=ROOT, env=env, check=True)
    password = "ApiCheckPassword123"
    subprocess.run(["php", "artisan", "edge:admin", "admin@test.invalid", "--name=Test Administrator", "--password=" + password], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO copy_strategies (name,slug,sport,description,risk,stake_percentage,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                   ("API strategy", "api-strategy", "football", "HTTP integration strategy", "moderate", 10))
    with socket.socket() as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    Client.otp_mail = Path(str(database) + '.otp-mail.json')
    log = open(Path(directory) / "server.log", "w+")
    router = Path(directory) / 'router.php'
    router.write_text("<?php require '" + str(ROOT) + "/vendor/autoload.php'; $app = require '" + str(ROOT) + "/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap(); require getcwd().'/scripts/fixtures/capture-otp-mail.php'; $app->handleRequest(Illuminate\\Http\\Request::capture());")
    server = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'public'), str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)
    try:
        member = Client(base)
        for _ in range(100):
            try:
                code, session = member.request("/api/session")
                if code == 200:
                    break
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        else:
            raise RuntimeError("Local test server did not start")
        check(session["user"] is None and bool(member.token), "session supplies a CSRF token without a user")
        landing_response = member.opener.open(base + "/", timeout=15)
        landing_html = landing_response.read().decode()
        check(landing_response.status == 200 and '/assets/landing.css' in landing_html, "home serves the public landing page")
        check('/app?auth=register' in landing_html and '/app?auth=login' in landing_html, "landing calls to action lead to the real account flows")
        platform_response = member.opener.open(base + "/app", timeout=15)
        platform_html = platform_response.read().decode()
        check(platform_response.status == 200 and 'data-runtime="laravel"' in platform_html and 'id="copy-page"' in platform_html, "platform remains available with its server-backed copy page")
        check('/assets/motion.js' in platform_html and '/assets/motion.css' in platform_html, "platform includes the shared loading and animation assets")
        legacy_response = member.opener.open(base + "/?stripe_return=success&payment_ref=legacy-check&session_id=cs_legacy", timeout=15)
        legacy_response.read()
        check('/app?' in legacy_response.geturl() and 'payment_ref=legacy-check' in legacy_response.geturl() and 'session_id=cs_legacy' in legacy_response.geturl(), "older Stripe checkout return links retain their payment references and reach the platform")
        member.expect(401, "/api/state")
        member.expect(401, "/api/state", accept=False)
        member.expect(419, "/api/auth/login", "POST", {"email": "member@test.invalid", "password": password}, csrf=False)
        member.expect(422, "/api/auth/login", "POST", {"email": ["invalid"], "password": password})
        member.expect(422, "/api/auth/register", "POST", {"name": "Member", "email": "member@test.invalid", "password": password, "password_confirmation": password, "is_admin": True, "balance_cents": 100000000})
        before_token = member.token
        auth = member.expect(201, "/api/auth/register", "POST", {"name": "Member", "email": "member@test.invalid", "password": password, "password_confirmation": password})
        check(auth["user"]["is_admin"] is False and member.token != before_token, "registration never elevates role and rotates CSRF")
        member.expect(403, "/api/admin/overview")
        check(member.expect(200, "/api/state")["balance_cents"] == 0, "new member has no fabricated wallet credit")
        deposit_data = {"type": "deposit", "amount_cents": 100000, "method": "bank_transfer", "details": {"reference": "CUSTOMER-TRANSFER"}, "idempotency_key": "api-deposit-001"}
        deposit = member.expect(201, "/api/wallet/requests", "POST", deposit_data)["request"]
        check(member.expect(201, "/api/wallet/requests", "POST", deposit_data)["request"]["id"] == deposit["id"], "deposit request retry returns the original request")
        check(member.expect(200, "/api/state")["balance_cents"] == 0, "pending deposit does not fund the wallet")
        admin = Client(base)
        admin.expect(200, "/api/session")
        admin.expect(200, "/api/auth/login", "POST", {"email": "admin@test.invalid", "password": password})
        admin.expect(422, f"/api/admin/wallet-requests/{deposit['id']}/review", "POST", {"decision": "approve"})
        admin.expect(200, f"/api/admin/wallet-requests/{deposit['id']}/review", "POST", {"decision": "approve", "reference": "BANK-API-DEPOSIT-001"})
        admin.expect(200, f"/api/admin/wallet-requests/{deposit['id']}/review", "POST", {"decision": "approve", "reference": "BANK-API-DEPOSIT-001"})
        check(member.expect(200, "/api/state")["balance_cents"] == 100000, "approval credits once")
        duplicate_receipt = member.expect(201, "/api/wallet/requests", "POST", deposit_data | {"idempotency_key": "api-deposit-duplicate-002"})["request"]
        admin.expect(422, f"/api/admin/wallet-requests/{duplicate_receipt['id']}/review", "POST", {"decision": "approve", "reference": "BANK-API-DEPOSIT-001"})
        starts = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)).isoformat()
        event_data = {"sport": "football", "league": "API League", "country": "Test", "home_name": "Home FC", "away_name": "Away FC", "starts_at": starts, "status": "open", "odds_home": "2.5000", "odds_draw": "3.2000", "odds_away": "2.8000"}
        event = admin.expect(201, "/api/admin/events", "POST", event_data)["event"]
        admin.expect(422, f"/api/admin/events/{event['id']}/result", "POST", {"home_score": 2, "away_score": 1})
        draft = admin.expect(201, "/api/admin/events", "POST", event_data | {"status": "draft", "home_name": "Hidden FC"})["event"]
        check(draft["id"] not in [item["id"] for item in member.expect(200, "/api/events")["events"]], "draft games are private")
        selection = {"event_id": event["id"], "outcome": "home", "expected_odds": event["odds_home"], "expected_version": event["version"]}
        bet_data = {"type": "single", "stake_cents": 1000, "selections": [selection], "idempotency_key": "api-bet-001"}
        bet = member.expect(201, "/api/bets", "POST", bet_data)["bet"]
        check(bet["potential_return_cents"] == 2500, "accepted odds determine potential return")
        check(member.expect(201, "/api/bets", "POST", bet_data)["bet"]["id"] == bet["id"], "stake retry returns original bet")
        event = admin.expect(200, f"/api/admin/events/{event['id']}", "PATCH", {"version": event["version"], "odds_home": "3.0000"})["event"]
        member.expect(422, "/api/bets", "POST", bet_data | {"idempotency_key": "api-bet-stale-002"})
        admin.expect(422, f"/api/admin/events/{event['id']}", "PATCH", {"version": 1, "odds_home": "4.0000"})
        position = member.expect(201, "/api/copy/positions", "POST", {"strategy_id": 1, "amount_cents": 10000, "idempotency_key": "api-copy-001"})["position"]
        performance = position["performance"]
        check(performance["initial_deposit_cents"] == 10000 and performance["current_value_cents"] == 10000 and len(performance["points"]) == 1, "copy chart starts at the actual allocated deposit")
        admin.expect(201, "/api/admin/copy-picks", "POST", {"strategy_id": 1, "event_id": event["id"], "outcome": "home"})
        pending_position = member.expect(200, "/api/state")["copy_positions"][0]
        check(pending_position["value_cents"] == 9000 and pending_position["performance"]["current_value_cents"] == 10000, "reserving a copied stake does not appear as a chart loss")
        pending_game = pending_position["performance"]["games"][0]
        check(pending_game["home_name"] == "Home FC" and pending_game["away_name"] == "Away FC" and pending_game["status"] == "pending" and pending_game["net_change_cents"] is None, "game names and pending status appear below the chart before settlement")
        member.expect(422, f"/api/copy/positions/{position['id']}/close", "POST", {})
        other = Client(base)
        other.expect(200, "/api/session")
        other.expect(201, "/api/auth/register", "POST", {"name": "Other Member", "email": "other@test.invalid", "password": password, "password_confirmation": password})
        other.expect(404, f"/api/copy/positions/{position['id']}", "PATCH", {"status": "paused"})
        other.expect(404, f"/api/copy/positions/{position['id']}/close", "POST", {})
        check(other.expect(200, "/api/state")["bets"] == [], "accounts cannot read another member's stakes")
        with sqlite3.connect(database) as db:
            db.execute("UPDATE sport_events SET starts_at = datetime('now', '-2 hours') WHERE id = ?", (event["id"],))
        admin.expect(200, f"/api/admin/events/{event['id']}/result", "POST", {"home_score": 2, "away_score": 1})
        admin.expect(200, f"/api/admin/events/{event['id']}/result", "POST", {"home_score": 2, "away_score": 1})
        admin.expect(422, f"/api/admin/events/{event['id']}/result", "POST", {"home_score": 0, "away_score": 1})
        state = member.expect(200, "/api/state")
        check(state["balance_cents"] == 91500 and state["bets"][0]["payout_cents"] == 2500, "score submission settles using originally accepted odds once")
        check(state["copy_positions"][0]["equity_cents"] == 12000 and state["copy_positions"][0]["profit_cents"] == 2000, "score submission also settles copied stakes")
        performance = state["copy_positions"][0]["performance"]
        check([point["value_cents"] for point in performance["points"]] == [10000, 12000] and performance["points"][-1]["change_cents"] == 2000, "final score adds net copied profit exactly once on the chart")
        check(performance["games"][0]["status"] == "won" and performance["games"][0]["net_change_cents"] == 2000, "settled copied game becomes won with its actual net profit")
        # This suite focuses on financial settlement. KYC workflow and document
        # security are exercised independently in check-kyc-api.py.
        subprocess.run(["php", "-r", "require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); App\\Models\\KycSubmission::create(['user_id'=>App\\Models\\User::where('email','member@test.invalid')->firstOrFail()->id,'status'=>'approved','version'=>2,'legal_name'=>'Synthetic HTTP Fixture','date_of_birth'=>'1990-01-01','country'=>'US','address'=>'Synthetic verification fixture address','document_type'=>'passport','document_number'=>'FIXTURE-HTTP-ONLY','documents'=>[],'consented_at'=>now(),'reviewed_at'=>now(),'reviewed_by'=>App\\Models\\User::where('email','admin@test.invalid')->firstOrFail()->id]);"], cwd=ROOT, env=env, check=True)
        withdrawal = member.expect(201, "/api/wallet/requests", "POST", {"type": "withdrawal", "amount_cents": 10000, "method": "bank", "details": {"bank_name": "Test Bank", "account_name": "Member", "account_number": "1234567890"}, "idempotency_key": "api-withdraw-001"})["request"]
        check(member.expect(200, "/api/state")["balance_cents"] == 81500, "withdrawal reserves available funds immediately")
        admin.expect(200, f"/api/admin/wallet-requests/{withdrawal['id']}/review", "POST", {"decision": "reject", "reference": "Account verification required"})
        closed_position = member.expect(200, f"/api/copy/positions/{position['id']}/close", "POST", {})["position"]
        check(closed_position["value_cents"] == 0 and closed_position["performance"]["current_value_cents"] == 12000, "returning copy capital to the wallet preserves its performance history")
        check(member.expect(200, "/api/state")["balance_cents"] == 103500, "rejected withdrawal refunds and copy closure returns actual strategy equity")
        old_token = member.token
        member.expect(200, "/api/auth/logout", "POST", {})
        check(member.token != old_token, "logout rotates the CSRF token")
        member.expect(401, "/api/state")
        member.expect(200, "/api/auth/login", "POST", {"email": "member@test.invalid", "password": password})
        admin.expect(200, "/api/admin/overview")
        print(f"PASS: {checks} HTTP API integration checks.")
    except Exception:
        log.flush()
        log.seek(0)
        print(log.read()[-8000:])
        raise
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        log.close()
