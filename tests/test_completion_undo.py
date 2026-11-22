"""Completion undo preserves prior due state without restoring a whole directory."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_components' / 'ha_wartung'))
import engine


class CompletionUndo(unittest.TestCase):
    now = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)

    def data(self, **rule):
        data = engine.blank()
        data['settings'] = {}
        data['devices']['d'] = {'id': 'd', 'name': 'Gerät'}
        data['rules']['r'] = dict(id='r', device_id='d', name='Wartung',
                                 kind='interval', months=2, **rule)
        return data

    def complete(self, data, op='done', cycle=None, now=None):
        return engine.complete(data, 'r', event_date='2026-11-22', now=now or self.now,
                               operation_id=op, expected_revision=data['revision'],
                               note='Wartung', cycle=cycle)

    def test_restores_imported_baseline_and_booked_date_and_preserves_other_edits(self):
        original = self.data(last_completed='2025-12-31', booked='2026-11-24')
        before = deepcopy(original)
        done, identity = self.complete(original)
        self.assertEqual(original, before)
        self.assertEqual(done['rules']['r']['last_completed'], '2026-11-22')
        self.assertIsNone(done['rules']['r']['booked'])
        done['devices']['d']['notes'] = 'Neue Notiz'
        done['rules']['r']['name'] = 'Umbenannte Wartung'
        done['settings']['other_setting'] = True
        completed = deepcopy(done)
        undone = engine.undo_completion(done, identity, self.now)
        self.assertEqual(done, completed)
        self.assertEqual(undone['rules']['r']['last_completed'], '2025-12-31')
        self.assertEqual(undone['rules']['r']['booked'], '2026-11-24')
        self.assertEqual(undone['rules']['r']['name'], 'Umbenannte Wartung')
        self.assertEqual(undone['devices']['d']['notes'], 'Neue Notiz')
        self.assertTrue(undone['settings']['other_setting'])
        self.assertEqual(undone['logs'][identity]['undone_at'], self.now.isoformat())
        self.assertEqual(undone['logs'][identity]['deleted_at'], self.now.isoformat())
        self.assertEqual(undone['revision'], done['revision'] + 1)

    def test_restores_each_rule_kind_and_missing_fields_exactly(self):
        rules = [
            ({'kind': 'interval', 'months': 2}, None),
            ({'kind': 'rotation', 'months': 2, 'steps': ['A', 'B'], 'rotation_step': 2}, 2),
            ({'kind': 'season', 'month': 4, 'day': 15, 'completed_cycles': [2024]}, 2026),
            ({'kind': 'date', 'due_date': '2026-12-01'}, None),
            ({'kind': 'measurement', 'threshold': 20, 'sensor_registry_id': 's',
              'awaiting_since': '2026-01-01T00:00:00+00:00'}, None),
            ({'kind': 'none'}, None),
            ({'kind': 'on_demand'}, None),
        ]
        for rule, cycle in rules:
            with self.subTest(kind=rule['kind']):
                original = self.data()
                original['rules']['r'].update(rule)
                done, identity = self.complete(original, cycle=cycle)
                reopened = engine.undo_completion(done, identity, self.now)
                self.assertEqual(reopened['rules'], original['rules'])
                self.assertEqual(engine.view(reopened['rules']['r'], self.now.date(), self.now),
                                 engine.view(original['rules']['r'], self.now.date(), self.now))

    def test_snapshots_do_not_alias_mutable_cycle_lists(self):
        original = self.data()
        original['rules']['r'].update(kind='season', month=4, day=15, completed_cycles=[2024])
        done, identity = self.complete(original, cycle=2026)
        state = done['logs'][identity]['completion_state']
        self.assertEqual(state['before']['completed_cycles'], [2024])
        self.assertEqual(state['after']['completed_cycles'], [2024, 2026])
        done['rules']['r']['completed_cycles'].append(2027)
        self.assertEqual(state['after']['completed_cycles'], [2024, 2026])
        with self.assertRaises(ValueError):
            engine.undo_completion(done, identity, self.now)

    def test_rejects_later_completion_even_when_due_fields_are_identical(self):
        done, first = self.complete(self.data())
        later, second = self.complete(done, op='second', now=self.now + timedelta(seconds=1))
        self.assertEqual(later['rules'], done['rules'])
        before = deepcopy(later)
        with self.assertRaisesRegex(ValueError, 'spätere Erledigung'):
            engine.undo_completion(later, first, self.now)
        self.assertEqual(later, before)
        reopened = engine.undo_completion(later, second, self.now)
        reopened = engine.undo_completion(reopened, first, self.now)
        self.assertNotIn('last_completed', reopened['rules']['r'])

    def test_rejects_edited_log_changed_configuration_or_completion_state(self):
        for mutate in [
            lambda data, identity: data['logs'][identity].update(edited_at=self.now.isoformat()),
            lambda data, identity: data['rules']['r'].update(months=3),
            lambda data, identity: data['rules']['r'].update(booked='2026-12-01'),
            lambda data, identity: data['rules']['r'].update(deleted_at=self.now.isoformat()),
            lambda data, identity: data['devices']['d'].update(archived=True),
            lambda data, identity: data['devices']['d'].update(deleted_at=self.now.isoformat()),
        ]:
            done, identity = self.complete(self.data())
            mutate(done, identity)
            before = deepcopy(done)
            with self.assertRaises(ValueError):
                engine.undo_completion(done, identity, self.now)
            self.assertEqual(done, before)

    def test_old_logs_and_duplicate_undo_are_rejected(self):
        done, identity = self.complete(self.data())
        old = deepcopy(done)
        old['logs'][identity].pop('completion_state')
        with self.assertRaises(ValueError):
            engine.undo_completion(old, identity, self.now)
        undone = engine.undo_completion(done, identity, self.now)
        before = deepcopy(undone)
        with self.assertRaises(ValueError):
            engine.undo_completion(undone, identity, self.now)
        self.assertEqual(undone, before)


if __name__ == '__main__':
    unittest.main()
