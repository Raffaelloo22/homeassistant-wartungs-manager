"""Link a documented completion after an interval task becomes a one-off date."""
from unittest.mock import patch

from backend_test_support import DirectoryTestCase, deepcopy, datetime, engine, ns, timezone, unittest


NOW = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)


def fixture():
    data = engine.blank()
    data['devices']['d'] = {'id': 'd', 'name': 'Nuki', 'battery_type': 'AA', 'battery_quantity': 2}
    data['settings'] = {'battery_inventory': {'AA': 5}}
    data['rules']['r'] = {
        'id': 'r', 'device_id': 'd', 'name': 'Aufladen', 'kind': 'date',
        'due_date': '2026-11-22', 'last_completed': '2026-11-22',
        'consumable': {'kind': 'battery', 'id': 'AA'},
    }
    data['logs']['l'] = {
        'id': 'l', 'device_id': 'd', 'rule_id': 'r', 'kind': 'maintenance',
        'event_date': '2026-11-22', 'note': 'Aufladen',
        'recorded_at': '2026-11-22T10:00:00+00:00',
    }
    return data


class LinkDateHistory(unittest.TestCase):
    def test_existing_completion_is_reused_without_new_history_or_stock_changes(self):
        original = fixture()
        before = deepcopy(original)
        linked = engine.link_history(original, 'r', 'l', now=NOW)
        self.assertEqual(original, before)
        expected = deepcopy(before)
        expected['rules']['r']['completed_due_date'] = '2026-11-22'
        expected['logs']['l']['scheduled_due_date'] = '2026-11-22'
        expected['revision'] += 1
        self.assertEqual(linked, expected)
        self.assertEqual(engine.view(linked['rules']['r'], NOW.date(), NOW)['status'], 'ok')
        retry = engine.link_history(linked, 'r', 'l', now=NOW)
        retry['revision'] -= 1
        self.assertEqual(retry, linked)

    def test_unlinked_log_and_last_completed_max_semantics(self):
        data = fixture()
        data['logs']['l'].pop('rule_id')
        data['rules']['r']['last_completed'] = '2026-11-23'
        result = engine.link_history(data, 'r', 'l', now=NOW)
        self.assertEqual(result['logs']['l']['rule_id'], 'r')
        self.assertEqual(result['rules']['r']['last_completed'], '2026-11-23')
        data['rules']['r'].pop('last_completed')
        result = engine.link_history(data, 'r', 'l', now=NOW)
        self.assertEqual(result['rules']['r']['last_completed'], '2026-11-22')

    def test_mismatch_or_future_rejected_atomically(self):
        for changes in ({'due_date': '2026-11-23'}, {'due_date': '2026-11-23', 'event_date': '2026-11-23'}):
            with self.subTest(changes=changes):
                data = fixture()
                data['rules']['r']['due_date'] = changes['due_date']
                if 'event_date' in changes:
                    data['logs']['l']['event_date'] = changes['event_date']
                before = deepcopy(data)
                with self.assertRaises(ValueError):
                    engine.link_history(data, 'r', 'l', now=NOW)
                self.assertEqual(data, before)

    def test_original_eligibility_checks_still_apply(self):
        for changes in ({'deleted_at': NOW.isoformat()}, {'kind': 'repair'}, {'device_id': 'other'}, {'rule_id': 'other'}, {'event_date': None}):
            with self.subTest(changes=changes):
                data = fixture()
                data['logs']['l'].update(changes)
                before = deepcopy(data)
                with self.assertRaises(ValueError):
                    engine.link_history(data, 'r', 'l', now=NOW)
                self.assertEqual(data, before)

    def test_deleting_linked_completion_or_moving_deadline_reopens_task(self):
        linked = engine.link_history(fixture(), 'r', 'l', now=NOW)
        reopened = engine.delete_log(linked, 'l', NOW)
        self.assertNotIn('completed_due_date', reopened['rules']['r'])
        self.assertEqual(engine.view(reopened['rules']['r'], NOW.date(), NOW)['status'], 'due')
        linked['rules']['r']['due_date'] = '2027-01-22'
        self.assertEqual(engine.view(linked['rules']['r'], NOW.date(), NOW)['status'], 'scheduled')

    def test_interval_and_on_demand_legacy_linking_unchanged(self):
        for kind in ('interval', 'on_demand'):
            with self.subTest(kind=kind):
                data = fixture()
                data['rules']['r'].update(kind=kind, months=2, last_completed='2026-11-20')
                data['logs']['l']['event_date'] = '2026-11-23'
                result = engine.link_history(data, 'r', 'l', now=NOW)
                self.assertEqual(result['rules']['r']['last_completed'], '2026-11-23')
                self.assertNotIn('completed_due_date', result['rules']['r'])
                self.assertNotIn('scheduled_due_date', result['logs']['l'])
                self.assertEqual(result, engine.link_history(data, 'r', 'l'))


class LinkDateHistoryAction(DirectoryTestCase):
    async def link(self, obj):
        with patch.object(ns['dt_util'], 'now', return_value=NOW):
            return await ns['execute'](obj, 'link_history', {
                'revision': obj.data['revision'], 'rule_id': 'r', 'log_id': 'l'})

    async def test_action_reuses_history_and_never_consumes_material(self):
        obj = self.obj()
        obj.data = fixture()
        before = deepcopy(obj.data)
        await self.link(obj)
        self.assertEqual(set(obj.data['logs']), {'l'})
        self.assertEqual(obj.data['settings'], before['settings'])
        self.assertEqual(obj.data['shopping'], before['shopping'])
        self.assertEqual(obj.data['operations'], before['operations'])
        self.assertEqual(obj.data['logs']['l']['note'], 'Aufladen')
        self.assertEqual(obj.data['logs']['l']['recorded_at'], before['logs']['l']['recorded_at'])
        self.assertNotIn('edited_at', obj.data['logs']['l'])
        self.assertNotIn('material_stock_movement', obj.data['logs']['l'])
        self.assertEqual(engine.view(obj.data['rules']['r'], NOW.date(), NOW)['status'], 'ok')
        linked = deepcopy(obj.data)
        await self.link(obj)
        self.assertEqual(set(obj.data['logs']), {'l'})
        self.assertEqual(obj.data['settings'], linked['settings'])
        self.assertEqual(obj.data['logs'], linked['logs'])

    async def test_action_rejects_mismatch_and_future_without_partial_commit(self):
        for log_date in ('2026-11-22', '2026-11-23'):
            with self.subTest(log_date=log_date):
                obj = self.obj()
                obj.data = fixture()
                obj.data['rules']['r']['due_date'] = '2026-11-23'
                obj.data['logs']['l']['event_date'] = log_date
                before = deepcopy(obj.data)
                with self.assertRaises(ValueError):
                    await self.link(obj)
                self.assertEqual(obj.data, before)
