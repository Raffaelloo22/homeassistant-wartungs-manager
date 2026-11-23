"""Keep legacy upgrade baselines compatible without weakening new-feature checks."""
import ast
from types import SimpleNamespace
from unittest.mock import AsyncMock
from copy import deepcopy
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
source = ast.parse((ROOT / 'scripts/ha_lifecycle_probe.py').read_text())
names = {'check', 'supports_shop_urls', 'supports_device_copy', 'set_shop_urls', 'assert_snapshot', 'wait_running'}
module = ast.fix_missing_locations(ast.Module(
    body=[node for node in source.body if getattr(node, 'name', None) in names
          or isinstance(node, ast.Assign) and any(getattr(target, 'id', None) == 'DEVICE_COPY_OPERATION'
                                                 for target in node.targets)], type_ignores=[]))
BATTERY_URL = 'https://example.com/shop/aa'
MATERIAL_URL = 'https://example.com/shop/filter'
namespace = {'BATTERY_SHOP_URL': BATTERY_URL, 'MATERIAL_SHOP_URL': MATERIAL_URL}
exec(compile(module, 'lifecycle_probe_features', 'exec'), namespace)


def fixture(with_links):
    data = {'devices': {'fixture-device': {'notes': 'Synthetic device note'}},
            'rules': {'fixture-rule': {'completed_due_date': '2020-01-01'}},
            'logs': {'completion': {'note': 'Done'}},
            'settings': {'battery_inventory': {'AA': 3}, 'consumables': {
                'fixture-filter': {'id': 'fixture-filter', 'name': 'Example filter', 'unit': 'pieces',
                                   'quantity': 1.5, 'threshold': 1, 'notes': 'Keep me', 'device_ids': ['fixture-device']}}}}
    if with_links:
        data['settings']['battery_shop_urls'] = {'AA': BATTERY_URL}
        data['settings']['consumables']['fixture-filter']['shop_url'] = MATERIAL_URL
    return data


class API:
    def __init__(self, data):
        self.data, self.exported, self.writes = deepcopy(data), deepcopy(data), []
    async def action(self, action, **payload):
        if action == 'export':
            return deepcopy(self.exported)
        if action == 'get':
            return deepcopy(self.data)
        raise AssertionError('Unexpected action')
    async def request(self, method, path):
        return 'ha-wartung-panel' if path == '/ha_wartung/panel.js' else None
    async def ws(self, command):
        return {'wartung': {'require_admin': True}}
    async def mutate(self, action, **payload):
        self.writes.append((action, deepcopy(payload)))


class LifecycleFeatureContract(unittest.IsolatedAsyncioTestCase):
    def test_version_gate_is_explicit_and_rejects_unknown_version_formats(self):
        for version, expected in [('1.0.50', False), ('1.1.1', False), ('1.2.0', True),
                                  ('1.2.1', True), ('2.0.0', True)]:
            self.assertIs(namespace['supports_shop_urls'](version), expected)
        for version in ('', '1.2', '1.2.0.dev', 'unknown'):
            with self.assertRaises(AssertionError):
                namespace['supports_shop_urls'](version)

    def test_device_copy_probe_runs_only_on_packages_supporting_the_new_api(self):
        for version, expected in [('1.0.50', False), ('1.2.0', False), ('1.2.8', False),
                                  ('1.2.9', True), ('1.2.10', True), ('2.0.0', True)]:
            with self.subTest(version=version):
                self.assertIs(namespace['supports_device_copy'](version), expected)

    async def test_legacy_baseline_keeps_full_export_checks_without_new_fields(self):
        original = fixture(False)
        await namespace['assert_snapshot'](API(original), original, shop_urls=False)
        api = API(original)
        api.exported['devices']['fixture-device']['notes'] = 'Unexpected change'
        with self.assertRaisesRegex(AssertionError, 'Persistent export changed'):
            await namespace['assert_snapshot'](api, original, shop_urls=False)

    async def test_current_package_requires_both_saved_shop_links(self):
        original = fixture(True)
        await namespace['assert_snapshot'](API(original), original, shop_urls=True)
        for field in ('battery', 'material'):
            with self.subTest(field=field):
                api = API(original)
                if field == 'battery':
                    api.data['settings']['battery_shop_urls']['AA'] = ''
                else:
                    api.data['settings']['consumables']['fixture-filter']['shop_url'] = ''
                with self.assertRaisesRegex(AssertionError, 'shop link persisted'):
                    await namespace['assert_snapshot'](api, original, shop_urls=True)

    async def test_current_package_dropped_fields_are_not_silently_optional(self):
        original = fixture(True)
        api = API(original)
        del api.data['settings']['battery_shop_urls']
        with self.assertRaises(KeyError):
            await namespace['assert_snapshot'](api, original, shop_urls=True)

    async def test_a_saved_device_copy_must_persist_in_the_runtime_snapshot_too(self):
        original = fixture(True)
        original['operations'] = {namespace['DEVICE_COPY_OPERATION']: 'fixture-copy'}
        original['devices']['fixture-copy'] = {
            'id': 'fixture-copy', 'name': 'Example appliance (Kopie)', 'notes': 'Synthetic device note',
            'created_at': '2026-11-23T14:20:00+01:00', 'device_updated_at': '2026-11-23T14:20:00+01:00',
        }
        await namespace['assert_snapshot'](API(original), original, shop_urls=True)
        api = API(original)
        api.data['devices']['fixture-copy']['notes'] = 'Unexpected runtime change'
        with self.assertRaisesRegex(AssertionError, 'independent device copy persisted'):
            await namespace['assert_snapshot'](api, original, shop_urls=True)
        api = API(original)
        del api.data['devices']['fixture-copy']
        with self.assertRaises(KeyError):
            await namespace['assert_snapshot'](api, original, shop_urls=True)

    async def test_link_setup_uses_both_write_apis_without_replacing_existing_material_fields(self):
        original = fixture(False)
        api = API(original)
        await namespace['set_shop_urls'](api)
        self.assertEqual(api.writes, [
            ('battery_inventory', {'shop_urls': {'AA': BATTERY_URL}}),
            ('save_consumable', {'value': {**original['settings']['consumables']['fixture-filter'],
                                          'shop_url': MATERIAL_URL}}),
        ])
        self.assertEqual(api.data, original)


class CoreReadiness(unittest.IsolatedAsyncioTestCase):
    async def test_starting_waits_for_running_using_the_official_state_endpoint(self):
        request = AsyncMock(side_effect=[{'state': 'NOT_RUNNING'}, {'state': 'STARTING'}, {'state': 'RUNNING'}])
        sleeper = AsyncMock()
        ns = {**namespace, 'asyncio': SimpleNamespace(sleep=sleeper)}
        exec(compile(module, 'lifecycle_probe_features', 'exec'), ns)
        await ns['wait_running'](SimpleNamespace(request=request))
        self.assertEqual(request.await_count, 3)
        for call in request.await_args_list:
            self.assertEqual(call.args, ('GET', '/api/core/state'))
        self.assertEqual(sleeper.await_count, 2)

    async def test_timeout_does_not_turn_starting_into_a_success(self):
        request = AsyncMock(return_value={'state': 'STARTING'})
        sleeper = AsyncMock()
        ns = {**namespace, 'asyncio': SimpleNamespace(sleep=sleeper)}
        exec(compile(module, 'lifecycle_probe_features', 'exec'), ns)
        with self.assertRaisesRegex(AssertionError, 'did not reach RUNNING'):
            await ns['wait_running'](SimpleNamespace(request=request))
        self.assertEqual(request.await_count, 180)

    async def test_auth_or_stopping_errors_fail_immediately(self):
        for response, error in [({'state': 'STOPPING'}, None), (None, AssertionError('HTTP 401'))]:
            with self.subTest(response=response):
                request = AsyncMock(return_value=response, side_effect=error)
                sleeper = AsyncMock()
                ns = {**namespace, 'asyncio': SimpleNamespace(sleep=sleeper)}
                exec(compile(module, 'lifecycle_probe_features', 'exec'), ns)
                with self.assertRaises(AssertionError):
                    await ns['wait_running'](SimpleNamespace(request=request))
                self.assertEqual(request.await_count, 1)
                sleeper.assert_not_awaited()
