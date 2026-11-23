"""Refresh the disposable test session without hiding lost auth or API failures."""
import ast
import asyncio
from contextlib import redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'scripts/ha_lifecycle_probe.py').read_text())
names = {'check', 'AuthenticationError', 'API', 'token_grant', 'access_token', 'refresh_api', 'lifecycle'}
module = ast.fix_missing_locations(ast.Module(body=[node for node in tree.body if getattr(node, 'name', None) in names], type_ignores=[]))


class Response:
    def __init__(self, status, data):
        self.status, self.data = status, data
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def text(self): return json.dumps(self.data)


class Socket:
    def __init__(self, session):
        self.session, self.messages, self.stage = session, [], 0
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def send_json(self, value): self.messages.append(value)
    async def receive_json(self):
        self.stage += 1
        if self.stage == 1: return {'type': 'auth_required'}
        if self.stage == 2:
            token = self.messages[0]['access_token']
            return {'type': 'auth_invalid' if token in self.session.invalid_tokens else 'auth_ok'}
        return {'id': 1, 'type': 'result', 'success': False, 'error': {'code': 'invalid_request'}}


class Session:
    def __init__(self, *, invalid_tokens=(), status=200):
        self.invalid_tokens, self.status = invalid_tokens, status
        self.requests, self.sockets = [], []
    def ws_connect(self, url):
        socket = Socket(self)
        self.sockets.append(socket)
        return socket
    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        return Response(self.status, {'access_token': 'fresh-access'} if self.status == 200 else {'error': 'invalid_grant'})


class LifecycleProbeAuth(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ready = AsyncMock()
        self.ns = {'asyncio': asyncio, 'json': json, 'BASE': 'http://example.invalid', 'DOMAIN': 'ha_wartung',
                   'CLIENT': 'http://example.invalid/client/', 'wait_ready': self.ready}
        exec(compile(module, 'lifecycle_probe_auth', 'exec'), self.ns)
        self.state = {'token': 'previous-access', 'refresh_token': 'persisted-refresh',
                      'entry_id': 'fixture', 'expected': {'devices': {'fixture': {'name': 'Example'}}}}

    async def test_refresh_uses_saved_grant_same_client_and_changes_only_access_token(self):
        session = Session()
        before = deepcopy(self.state)
        api = await self.ns['refresh_api'](session, self.state)
        self.assertEqual(api.token, 'fresh-access')
        self.assertEqual(self.state, {**before, 'token': 'fresh-access'})
        self.assertEqual(session.requests, [('POST', 'http://example.invalid/auth/token', {
            'headers': {}, 'data': {'grant_type': 'refresh_token', 'refresh_token': 'persisted-refresh',
                                   'client_id': 'http://example.invalid/client/'}})])
        self.ready.assert_awaited_once()
        self.assertEqual(session.sockets[0].messages, [{'type': 'auth', 'access_token': 'previous-access'}])

    async def test_previous_rejection_is_reported_but_saved_refresh_still_validated(self):
        session = Session(invalid_tokens={'previous-access'})
        output = io.StringIO()
        with redirect_stdout(output):
            api = await self.ns['refresh_api'](session, self.state)
        self.assertIn('Previous access token was rejected', output.getvalue())
        self.assertNotIn('persisted-refresh', output.getvalue())
        self.assertNotIn('previous-access', output.getvalue())
        await api.ws()
        self.assertEqual(len(session.requests), 1)

    async def test_invalid_grant_and_forbidden_fail_without_login_or_state_replacement(self):
        for status in (400, 403):
            with self.subTest(status=status):
                session = Session(status=status)
                before = deepcopy(self.state)
                with self.assertRaisesRegex(AssertionError, f'HTTP {status}.*invalid_grant'):
                    await self.ns['refresh_api'](session, self.state)
                self.assertEqual(self.state, before)
                self.assertEqual(len(session.requests), 1)
                self.assertTrue(session.requests[0][1].endswith('/auth/token'))

    async def test_new_token_auth_rejection_fails_lifecycle_immediately(self):
        session = Session(invalid_tokens={'fresh-access'})
        stored = []
        self.ns['STATE'] = SimpleNamespace(read_text=lambda: json.dumps(self.state), write_text=stored.append)
        snapshot = self.ns['assert_snapshot'] = AsyncMock()
        sleeper = AsyncMock()
        self.ns['asyncio'] = SimpleNamespace(sleep=sleeper)
        with self.assertRaises(self.ns['AuthenticationError']):
            await self.ns['lifecycle'](session, 'restart')
        sleeper.assert_not_awaited()
        snapshot.assert_not_awaited()
        self.assertEqual(len(session.requests), 1)
        self.assertEqual(stored, [], 'Rejected fresh credentials must not replace the saved state')

    async def test_authenticated_api_error_is_not_an_auth_failure_or_a_refresh_trigger(self):
        session = Session()
        api = self.ns['API'](session, 'fresh-access')
        with self.assertRaisesRegex(AssertionError, 'invalid_request') as error:
            await api.action('export')
        self.assertNotIsInstance(error.exception, self.ns['AuthenticationError'])
        self.assertEqual(session.requests, [])

    async def test_readiness_failure_prevents_auth_calls(self):
        session = Session()
        self.ready.side_effect = AssertionError('not ready')
        with self.assertRaisesRegex(AssertionError, 'not ready'):
            await self.ns['refresh_api'](session, self.state)
        self.assertEqual(session.requests, [])
        self.assertEqual(session.sockets, [])
