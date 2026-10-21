#!/usr/bin/env python3
from otp_test_mail import complete_otp_fixture
"""Check payment settings and signed webhook boundaries over real local HTTP.

Uses an isolated SQLite database, dummy test keys, and no Stripe API requests.
The checked-in application database and payment credentials are never touched.
"""
import base64
import hashlib
import hmac
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
observed = []
SECRETS = ["sk_test_" + "dummySecretOnlyForHttpChecks" * 2,
           "whsec_" + "dummySigningSecretOnlyForHttpChecks" * 2]
PUBLISHABLE = "pk_test_" + "dummyPublishableOnlyForHttpChecks" * 2


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = None

    def request(self, path, method="GET", data=None, csrf=True, headers=None, raw=None):
        headers = {"Accept": "application/json", **(headers or {})}
        if data is not None:
            headers["Content-Type"] = "application/json"
            raw = json.dumps(data, separators=(",", ":")).encode()
        if csrf and self.token:
            headers["X-CSRF-TOKEN"] = self.token
        req = urllib.request.Request(self.base + path, data=raw, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        text = response.read().decode()
        observed.append(text)
        payment_path = path.split("?", 1)[0]
        if payment_path in ("/api/admin/payment-settings", "/api/payment-methods") or payment_path.startswith("/api/payments/"):
            check("no-store" in response.headers.get("Cache-Control", ""),
                  f"{method} {path} {response.status} must prevent caching payment responses, including errors")
        for secret in SECRETS:
            check(secret not in text, f"{method} {path} must not disclose payment secrets")
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            body = {"raw": text[:300]}
        if isinstance(body, dict) and "csrf_token" in body:
            self.token = body["csrf_token"]
        return response.status, body, response.headers

    def expect(self, status, path, method="GET", data=None, **kwargs):
        code, body, headers = complete_otp_fixture(self, status, path, self.request(path, method, data, **kwargs))
        allowed = status if isinstance(status, tuple) else (status,)
        check(code in allowed, f"{method} {path}: expected {allowed}, received {code}: {body}")
        return body


def main():
    with tempfile.TemporaryDirectory(prefix="edge-payment-api-") as directory:
        database = str(Path(directory) / "checks.sqlite")
        Path(database).touch()
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        Client.otp_mail = Path(str(database) + '.otp-mail.json')
        env = os.environ | {
            "APP_ENV": "local", "APP_DEBUG": "false", "APP_URL": base,
            "APP_KEY": "base64:" + base64.b64encode(os.urandom(32)).decode(),
            "DB_CONNECTION": "sqlite", "DB_DATABASE": database, "SESSION_DRIVER": "database",
            "CACHE_STORE": "database", "CACHE_PREFIX": "edge-payment-api-checks-", "BCRYPT_ROUNDS": "4",
            "LOG_CHANNEL": "stderr",
            "EDGE_PAYMENT_TEST_ROOT": str(ROOT),
        }
        subprocess.run(["php", "artisan", "migrate", "--force", "--quiet"], cwd=ROOT, env=env, check=True)
        password = "PaymentApiCheckPassword123"
        subprocess.run(["php", "artisan", "edge:admin", "admin@payment.test.invalid", "--name=Payment Test Administrator", "--password=" + password], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
        # Keep the real Laravel HTTP stack while preventing accidental provider requests.
        # Successful Stripe request serialization is covered separately with Http::fake().
        router = Path(directory) / "router.php"
        router.write_text("""<?php
define('LARAVEL_START', microtime(true));
require getenv('EDGE_PAYMENT_TEST_ROOT').'/vendor/autoload.php';
$app = require getenv('EDGE_PAYMENT_TEST_ROOT').'/bootstrap/app.php';
$app->make(Illuminate\\Contracts\\Http\\Kernel::class)->bootstrap();
require getcwd().'/scripts/fixtures/capture-otp-mail.php';
Illuminate\\Support\\Facades\\Http::preventStrayRequests();
$app->handleRequest(Illuminate\\Http\\Request::capture());
""")
        log = open(Path(directory) / "server.log", "w+")
        server = subprocess.Popen(["php", "-S", "127.0.0.1:" + str(port), "-t", str(ROOT / "public"), str(router)], cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            anonymous = Client(base)
            for _ in range(100):
                try:
                    code, session, headers = anonymous.request("/api/session")
                    if code == 200:
                        break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
            else:
                raise RuntimeError("Local payment test server did not start")

            check(session["currency"] == "USD", "session publishes the USD wallet currency")
            check(anonymous.expect(200, "/api/payment-methods")["currency"] == "USD", "payment methods publish USD")
            anonymous.expect(401, "/api/admin/payment-settings")
            anonymous.expect(401, "/api/admin/payment-settings", "PATCH", {})
            anonymous.expect(401, "/api/payments/stripe/checkout", "POST", {"amount_cents": 10000, "idempotency_key": "anonymous-checkout"})
            anonymous.expect(401, "/api/payments/stripe/not-my-payment")
            anonymous.expect(419, "/api/admin/payment-settings", "PATCH", {}, csrf=False)
            anonymous.expect(419, "/api/payments/stripe/checkout", "POST", {}, csrf=False)
            anonymous.expect(419, "/api/wallet/requests", "POST", {}, csrf=False)
            anonymous.expect(419, "/api/auth/register", "POST", {}, csrf=False)
            # Only the exact Stripe webhook path may bypass the session CSRF token.
            anonymous.expect((400, 401), "/api/payments/stripe/webhook", "POST", {"id": "evt_unsigned"}, csrf=False)
            anonymous.expect(404, "/api/payments/stripe/webhook/extra", "POST", {}, csrf=False)

            member = Client(base)
            member.expect(200, "/api/session")
            member.expect(201, "/api/auth/register", "POST", {"name": "Payment Member", "email": "member@payment.test.invalid", "password": password, "password_confirmation": password})
            member.expect(403, "/api/admin/payment-settings")
            member.expect(403, "/api/admin/payment-settings", "PATCH", {"current_password": password, "version": 1, "manual_enabled": False})
            member.expect(422, "/api/payments/stripe/checkout", "POST", {"amount_cents": 10000, "idempotency_key": "disabled-checkout"})
            member.expect(419, "/api/payments/stripe/checkout", "POST", {}, csrf=False)

            admin = Client(base)
            admin.expect(200, "/api/session")
            admin.expect(200, "/api/auth/login", "POST", {"email": "admin@payment.test.invalid", "password": password})
            code, settings_body, headers = admin.request("/api/admin/payment-settings")
            check(code == 200, "admin can inspect payment configuration")
            check("no-store" in headers.get("Cache-Control", ""), "payment configuration cannot be cached")
            settings = settings_body["settings"]
            check(settings["stripe_enabled"] is False and settings["stripe_mode"] == "test", "Stripe starts disabled in test mode")
            check(settings["manual_enabled"] is True, "existing manual payment flow remains available")
            check(settings_body["webhook_url"] == base + "/api/payments/stripe/webhook", "webhook URL comes from configured application URL")

            def update(changes, expected=200, current_password=password, version=None):
                nonlocal settings
                # Validation cases are independent of throttling and run in a disposable cache.
                with sqlite3.connect(database) as db:
                    db.execute("DELETE FROM cache")
                payload = {"current_password": current_password, "version": settings["version"] if version is None else version, **changes}
                body = admin.expect(expected, "/api/admin/payment-settings", "PATCH", payload)
                if expected == 200:
                    settings = body["settings"]
                return body

            admin.expect(422, "/api/admin/payment-settings", "PATCH", {"version": settings["version"], "manual_enabled": False})
            update({"manual_enabled": False}, expected=422, current_password="WrongPassword123")
            check(admin.expect(200, "/api/admin/payment-settings")["settings"] == settings, "failed reauthentication does not change settings")
            update({"unknown_setting": "injected"}, expected=422)
            update({"is_admin": True, "wallet_balance": 100000000}, expected=422)
            update({"stripe_enabled": True}, expected=422)
            update({"stripe_mode": "invalid"}, expected=422)
            update({"stripe_publishable_key": "pk_live_" + "x" * 40}, expected=422)
            update({"stripe_secret_key": "sk_live_" + "x" * 40}, expected=422)
            update({"stripe_secret_key": "rk_test_" + "x" * 40}, expected=422)
            update({"stripe_webhook_secret": "not-a-signing-secret"}, expected=422)
            update({"stripe_secret_key": ["bad-type"]}, expected=422)
            stale_version = settings["version"]
            update({"stripe_publishable_key": PUBLISHABLE, "stripe_secret_key": SECRETS[0], "stripe_webhook_secret": SECRETS[1], "stripe_enabled": True})
            check(settings["stripe_secret_key_configured"] and settings["stripe_webhook_secret_configured"], "admin receives configured flags for stored secrets")
            check(settings["stripe_secret_key_last4"] == SECRETS[0][-4:] and settings["stripe_webhook_secret_last4"] == SECRETS[1][-4:], "admin can recognize credentials through suffixes")
            check("stripe_secret_key" not in settings and "stripe_webhook_secret" not in settings, "full secret fields are omitted from admin responses")
            update({"manual_enabled": False}, expected=(409, 422), version=stale_version)
            update({"stripe_secret_key": "", "stripe_webhook_secret": ""})
            check(settings["stripe_secret_key_configured"] and settings["stripe_webhook_secret_configured"], "blank secret form values preserve configured credentials")
            update({"stripe_mode": "live"}, expected=422)

            manual = {
                "manual_enabled": True,
                "manual_bank_name": "Payment Check Bank",
                "manual_account_name": "EDGE Test Payments",
                "manual_account_number": "0123456789",
                "manual_instructions": "Include your transfer reference. Wait for administrator verification.",
                "manual_reference_label": "Bank transaction reference",
                "manual_support_contact": "payments@test.invalid",
            }
            update(manual)
            public = anonymous.expect(200, "/api/payment-methods")
            serialized = json.dumps(public)
            check(manual["manual_account_number"] in serialized and manual["manual_bank_name"] in serialized, "public payment methods publish configured manual transfer instructions")
            check(PUBLISHABLE in serialized, "enabled Stripe publishes its browser-safe publishable key")
            check("stripe_secret_key_last4" not in serialized and "stripe_webhook_secret_last4" not in serialized, "public methods omit administrator-only credential metadata")
            for amount in (0, -1, 9999, 100000000, 10000.5, "bad", [10000], True):
                with sqlite3.connect(database) as db:
                    db.execute("DELETE FROM cache")
                member.expect(422, "/api/payments/stripe/checkout", "POST", {"amount_cents": amount, "idempotency_key": "invalid-amount-checkout"})
            member.expect(422, "/api/payments/stripe/checkout", "POST", {"amount_cents": 10000, "idempotency_key": "short"})
            member.expect(422, "/api/payments/stripe/checkout", "POST", {"amount_cents": 10000, "idempotency_key": "injected-checkout", "user_id": 1, "success_url": "https://evil.test.invalid", "currency": "ngn"})

            deposit_data = {"type": "deposit", "amount_cents": 20000, "method": "bank_transfer", "details": {"reference": "TEST-MANUAL-TRANSFER"}, "idempotency_key": "payment-manual-deposit"}
            deposit = member.expect(201, "/api/wallet/requests", "POST", deposit_data)["request"]
            check(member.expect(200, "/api/state")["balance_cents"] == 0, "manual transfer submission never credits an unverified deposit")
            admin.expect(200, f"/api/admin/wallet-requests/{deposit['id']}/review", "POST", {"decision": "approve", "reference": "PAYMENT-TEST-APPROVED"})
            check(member.expect(200, "/api/state")["balance_cents"] == 20000, "existing manual approval credits a verified bank transfer")
            update({"manual_enabled": False, "stripe_enabled": False})
            member.expect(422, "/api/wallet/requests", "POST", deposit_data | {"idempotency_key": "disabled-manual-deposit"})
            member.expect(422, "/api/wallet/requests", "POST", deposit_data | {"idempotency_key": "bypassed-stripe-deposit", "method": "stripe"})
            member.expect(422, "/api/payments/stripe/checkout", "POST", {"amount_cents": 10000, "idempotency_key": "disabled-again-checkout"})
            public_disabled = anonymous.expect(200, "/api/payment-methods")
            check(public_disabled["manual"]["enabled"] is False and public_disabled["stripe"]["enabled"] is False, "public methods accurately report disabled deposit options")

            other = Client(base)
            other.expect(200, "/api/session")
            other.expect(201, "/api/auth/register", "POST", {"name": "Other Payment Member", "email": "other@payment.test.invalid", "password": password, "password_confirmation": password})
            reference = "stripe-http-fixture-one"
            session_id = "cs_test_HttpFixtureOne"
            with sqlite3.connect(database) as db:
                user_id = db.execute("SELECT id FROM users WHERE email = ?", ("member@payment.test.invalid",)).fetchone()[0]
                db.execute("INSERT INTO stripe_payments (user_id,reference,request_hash,amount,currency,mode,status,session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                           (user_id, reference, "0" * 64, 30000, "USD", "test", "pending", session_id))
            payment = member.expect(200, "/api/payments/stripe/" + reference)["payment"]
            check(payment["currency"] == "USD", "stored deposit status publishes USD")
            check(payment["status"] == "pending" and payment["amount_cents"] == 30000, "member can view their own pending Stripe payment")
            check("pending_secret_key" not in payment and "pending_payload" not in payment and "request_hash" not in payment, "payment status omits internal retry credentials and request material")
            other.expect(404, "/api/payments/stripe/" + reference)
            admin.expect(404, "/api/payments/stripe/" + reference)
            anonymous.expect(401, "/api/payments/stripe/" + reference)
            member.expect(404, "/api/payments/stripe/missing-payment-reference")
            member.expect(200, "/?stripe_return=success&payment_ref=" + reference + "&session_id=" + session_id)
            check(member.expect(200, "/api/state")["balance_cents"] == 20000, "a browser success URL cannot credit a Stripe deposit")

            checkout = {
                "object": "checkout.session", "id": session_id, "client_reference_id": reference,
                "mode": "payment", "livemode": False, "amount_total": 30000, "currency": "usd",
                "status": "complete", "payment_status": "paid", "payment_intent": "pi_HttpFixtureOne",
                "metadata": {"payment_reference": reference, "user_id": str(user_id)},
            }
            event_counter = 0

            def webhook(changes=None, expected=200, event_id=None, timestamp=None, secret=None, signature=None, event_changes=None, raw=None):
                nonlocal event_counter
                event_counter += 1
                event = {"id": event_id or "evt_HttpFixture" + str(event_counter), "type": "checkout.session.completed", "livemode": False,
                         "data": {"object": checkout | (changes or {})}, **(event_changes or {})}
                raw = raw if raw is not None else json.dumps(event, separators=(",", ":")).encode()
                timestamp = int(time.time()) if timestamp is None else timestamp
                digest = hmac.new((secret or SECRETS[1]).encode(), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
                signature = signature or f"t={timestamp},v1={digest}"
                return anonymous.expect(expected, "/api/payments/stripe/webhook", "POST", csrf=False, raw=raw,
                                        headers={"Content-Type": "application/json", "Stripe-Signature": signature})

            webhook(expected=400, signature="t=" + str(int(time.time())) + ",v1=" + "0" * 64)
            webhook(expected=400, timestamp=int(time.time()) - 301)
            webhook(expected=400, timestamp=int(time.time()) + 301)
            webhook(expected=400, secret="whsec_WrongSigningSecretForHttpChecks")
            webhook(expected=400, raw=b"not-json")
            for changes in (
                {"amount_total": 30001}, {"amount_total": "30000"}, {"currency": "ngn"},
                {"id": "cs_test_AnotherSession"}, {"client_reference_id": "another-reference"},
                {"metadata": {"payment_reference": reference, "user_id": "999999"}},
                {"metadata": {"payment_reference": "unknown-reference", "user_id": str(user_id)}},
                {"livemode": True}, {"mode": "subscription"}, {"status": "open"}, {"payment_intent": None},
            ):
                webhook(changes, expected=400)
            webhook(expected=400, event_changes={"livemode": True})
            check(member.expect(200, "/api/state")["balance_cents"] == 20000, "invalid signatures and mismatched signed payment details never credit funds")
            webhook({"payment_status": "unpaid"})
            check(member.expect(200, "/api/payments/stripe/" + reference)["payment"]["status"] == "processing", "unpaid checkout completion remains pending payment confirmation")
            check(member.expect(200, "/api/state")["balance_cents"] == 20000, "unpaid checkout completion cannot credit the wallet")
            webhook(event_id="evt_HttpCreditOnce")
            check(member.expect(200, "/api/state")["balance_cents"] == 50000, "valid paid signed webhook credits the exact configured deposit amount")
            check(member.expect(200, "/api/payments/stripe/" + reference)["payment"]["status"] == "paid", "valid paid webhook updates owner-visible payment status")
            duplicate = webhook(event_id="evt_HttpCreditOnce")
            check(duplicate.get("duplicate") is True, "redelivery of an identical event is acknowledged as a duplicate")
            webhook(event_id="evt_HttpCreditAgain")
            webhook({"amount_total": 30001}, event_id="evt_HttpCreditOnce", expected=409)
            webhook({"payment_status": "unpaid"}, event_changes={"type": "checkout.session.expired"})
            check(member.expect(200, "/api/state")["balance_cents"] == 50000, "duplicate deliveries, distinct paid event IDs, and stale expiration cannot double-credit or reverse a paid deposit")
            check(member.expect(200, "/api/payments/stripe/" + reference)["payment"]["status"] == "paid", "out-of-order expiry cannot overwrite paid status")
            with sqlite3.connect(database) as db:
                ledger_rows = db.execute("SELECT COUNT(*) FROM wallet_transactions WHERE reference = ?", ("stripe-" + reference,)).fetchone()[0]
            check(ledger_rows == 1, "signed webhook settlement creates exactly one wallet ledger entry")

            # Saved deposits keep their original currency. A late pre-migration
            # NGN charge must never be re-labelled or credited as USD.
            legacy_reference = "stripe-http-legacy-naira"
            legacy_session = "cs_test_HttpLegacyNaira"
            with sqlite3.connect(database) as db:
                db.execute("INSERT INTO stripe_payments (user_id,reference,request_hash,amount,currency,mode,status,session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                           (user_id, legacy_reference, "1" * 64, 30000, "NGN", "test", "pending", legacy_session))
            legacy_changes = {"id": legacy_session, "client_reference_id": legacy_reference,
                              "metadata": {"payment_reference": legacy_reference, "user_id": str(user_id)},
                              "payment_intent": "pi_HttpLegacyNaira"}
            webhook(legacy_changes | {"currency": "ngn"}, expected=400)
            webhook(legacy_changes | {"currency": "usd"}, expected=400)
            check(member.expect(200, "/api/state")["balance_cents"] == 50000, "neither genuine NGN nor forged USD confirmation can credit a legacy NGN deposit")
            legacy_payment = member.expect(200, "/api/payments/stripe/" + legacy_reference)["payment"]
            check(legacy_payment["currency"] == "NGN" and legacy_payment["status"] == "pending", "legacy payment history preserves its original denomination without settling")

            # Turning off new card deposits must still permit in-flight signed settlement.
            check(public_disabled["stripe"]["enabled"] is False, "webhook settlement above was tested with new Stripe deposits disabled")
            rotated_secret = "whsec_" + "RotatedDummyHttpSigningSecret" * 2
            SECRETS.append(rotated_secret)
            update({"stripe_webhook_secret": rotated_secret})
            webhook(event_id="evt_HttpOldSecretWithinRollover")
            webhook(event_id="evt_HttpNewSecretAfterRollover", secret=rotated_secret)
            check(member.expect(200, "/api/state")["balance_cents"] == 50000, "current and rollover signing secrets acknowledge in-flight deposits without additional credit")

            audit = admin.expect(200, "/api/admin/overview")
            serialized_audit = json.dumps(audit)
            for secret in SECRETS:
                check(secret not in serialized_audit, "payment credential changes never appear in audit output")
            with sqlite3.connect(database) as db:
                config_text = " ".join(str(value) for row in db.execute("SELECT * FROM payment_settings") for value in row)
                audit_text = " ".join(str(value) for row in db.execute("SELECT * FROM admin_audits") for value in row)
                for secret in SECRETS:
                    check(secret not in config_text, "payment secrets are encrypted in the database")
                    check(secret not in audit_text, "payment audit records do not store credential plaintext")
            log.flush()
            log.seek(0)
            application_log = log.read()
            for secret in SECRETS:
                check(secret not in application_log, "local HTTP server output does not contain payment secrets")
            print(f"PASS: {checks} payment HTTP integration checks.")
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read()[-6000:])
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
            log.close()


if __name__ == "__main__":
    main()
