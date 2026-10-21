"""Complete OTP using mail captured by an isolated test router only."""
import json


def complete_otp_fixture(client, expected, path, result):
    if result[0] == 202 and expected in (200, 201) and path in ('/api/auth/register', '/api/auth/login'):
        if not hasattr(client, 'otp_mail'):
            raise AssertionError('Set the disposable OTP mailbox path for this test client.')
        assert result[1]['requires_otp'] is True
        code = json.loads(client.otp_mail.read_text())['code']
        verified = client.request('/api/auth/verify', 'POST', {'code': code})
        assert verified[0] == 200, verified[1]
        return (expected, *verified[1:])
    return result
