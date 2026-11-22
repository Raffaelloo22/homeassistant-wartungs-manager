"""The integration exposes diagnostics without a commit or revision change."""
from backend_test_support import DirectoryTestCase, deepcopy, ns


class DiagnosticsAction(DirectoryTestCase):
    async def test_read_only_action_uses_current_registry_and_keeps_data(self):
        obj = self.obj()
        obj.data['devices']['d']['ha_device_id'] = 'missing'
        obj.registry = lambda: {'devices': [], 'sensors': []}
        before = deepcopy(obj.data)
        async def forbid_commit(data):
            self.fail('Diagnostics must never commit')
        obj.commit = forbid_commit
        result = await ns['execute'](obj, 'diagnose', {})
        self.assertEqual(result['revision'], before['revision'])
        self.assertEqual(result['checked_devices'], 1)
        self.assertIn('ha_device_missing', [issue['code'] for issue in result['issues']])
        self.assertEqual(obj.data, before)
        obj.registry = lambda: {'devices': [{'id': 'missing'}], 'sensors': []}
        result = await ns['execute'](obj, 'diagnose', {})
        self.assertNotIn('ha_device_missing', [issue['code'] for issue in result['issues']])
        self.assertEqual(obj.data, before)
