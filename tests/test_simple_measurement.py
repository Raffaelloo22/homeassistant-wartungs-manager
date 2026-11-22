"""Simple HA-backed measurement rules need only a sensor and threshold."""
import ast
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from backend_test_support import engine

NOW = datetime(2026, 11, 22, 20, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[1]
source = ast.parse((ROOT / 'custom_components/ha_wartung/__init__.py').read_text())
cls = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'Directory')
method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'sample')
module = ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[]))


def parse_datetime(value):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def rule(**kwargs):
    return dict(id='r', device_id='d', name='Sensor prüfen', kind='measurement',
                sensor_registry_id='registry-id', threshold=20, **kwargs)


def read_sample(state=None, manual=None, registered=True, **rule_fields):
    data = {'samples': {'r': manual} if manual else {}}
    namespace = {
        'er': SimpleNamespace(async_get=lambda hass: SimpleNamespace(async_get=lambda identity:
            SimpleNamespace(entity_id='sensor.test') if registered and identity == 'registry-id' else None)),
        'dt_util': SimpleNamespace(parse_datetime=parse_datetime),
    }
    exec(compile(module, 'actual-directory-sample', 'exec'), namespace)
    obj = SimpleNamespace(data=data, hass=SimpleNamespace(states=SimpleNamespace(get=lambda identity: state)))
    before = deepcopy(data)
    sample = namespace['sample'](obj, rule(**rule_fields))
    assert data == before, 'reading a sensor must not mutate stored data'
    return sample


def state(value='19', reported=NOW, updated=None, **attributes):
    return SimpleNamespace(state=value, attributes=attributes,
                           last_reported=reported, last_updated=updated or reported)


def view(sample, **rule_fields):
    return engine.view(rule(**rule_fields), NOW.date(), NOW, sample)


class SimpleMeasurement(unittest.TestCase):
    def test_sensor_and_threshold_only_are_sufficient(self):
        engine.validate_rule(rule())
        sample = read_sample(state())
        self.assertEqual(sample, {'value': '19', 'reported_at': NOW.isoformat(), 'source': 'home_assistant'})
        self.assertEqual(view(sample)['status'], 'due')
        self.assertEqual(view(read_sample(state('20')))['status'], 'ok')
        self.assertEqual(view(read_sample(state('21')))['status'], 'ok')

    def test_ha_availability_replaces_hidden_age_configuration(self):
        old = NOW - timedelta(days=10)
        sample = read_sample(state('19', reported=old))
        self.assertEqual(view(sample, max_age_hours=1)['status'], 'due')
        engine.validate_rule(rule(max_age_hours='no longer used', timestamp_attribute='old', freshness_verified=False))
        self.assertEqual(read_sample(state(), timestamp_attribute='missing', freshness_verified=False), read_sample(state()))

    def test_last_reported_is_used_when_value_has_not_changed(self):
        old = NOW - timedelta(days=10)
        sample = read_sample(state('19', reported=NOW, updated=old))
        self.assertEqual(view(sample, awaiting_since=(NOW-timedelta(seconds=1)).isoformat())['status'], 'due')
        self.assertEqual(view(sample, awaiting_since=NOW.isoformat())['status'], 'measurement_pending')
        self.assertEqual(view(sample, awaiting_since=(NOW+timedelta(seconds=1)).isoformat())['status'], 'measurement_pending')

    def test_last_updated_fallback_requires_a_valid_timezone(self):
        sample = read_sample(state('19', reported=None, updated=NOW))
        self.assertEqual(view(sample)['status'], 'due')
        self.assertIsNone(read_sample(state('19', reported=None, updated=None)))
        self.assertIsNone(read_sample(state('19', reported=NOW.replace(tzinfo=None))))
        self.assertEqual(view(read_sample(state('19', reported=NOW+timedelta(seconds=1))))['status'], 'measurement_pending')

    def test_unavailable_unknown_non_numeric_and_restored_never_trigger(self):
        for value in ['unknown', 'unavailable', '', 'abc', 'NaN', 'nan', 'inf', '-inf', None]:
            with self.subTest(value=value):
                self.assertEqual(view(read_sample(state(value)))['status'], 'measurement_pending')
        self.assertIsNone(read_sample(state('19', restored=True)))
        self.assertEqual(view(read_sample(state('19', restored=True)))['status'], 'measurement_pending')
        self.assertIsNone(read_sample(state(), registered=False))
        self.assertIsNone(read_sample())

    def test_manual_confirmation_stays_available_and_latest_source_wins(self):
        manual = {'value': 10, 'reported_at': NOW.isoformat(),
                  'source_report_confirmed': True, 'source': 'manual'}
        self.assertEqual(read_sample(state('80', reported=NOW-timedelta(seconds=1)), manual), manual)
        self.assertEqual(view(read_sample(state('80', reported=NOW-timedelta(seconds=1)), manual))['status'], 'due')
        older = dict(manual, reported_at=(NOW-timedelta(seconds=1)).isoformat())
        self.assertEqual(view(read_sample(state('80'), older))['status'], 'ok')
        self.assertEqual(view(read_sample(state('unavailable'), older))['status'], 'measurement_pending')
        self.assertEqual(view(read_sample(None, manual))['status'], 'due')
        self.assertEqual(view(read_sample(None, manual), awaiting_since=NOW.isoformat())['status'], 'measurement_pending')
        self.assertEqual(view(read_sample(None, manual), awaiting_since=(NOW-timedelta(seconds=1)).isoformat())['status'], 'due')

    def test_old_manual_values_keep_standard_freshness_guard(self):
        manual = {'value': 10, 'reported_at': (NOW-timedelta(hours=49)).isoformat(),
                  'source_report_confirmed': True, 'source': 'manual'}
        self.assertEqual(view(read_sample(None, manual))['status'], 'measurement_pending')
        manual['reported_at'] = (NOW-timedelta(hours=48)).isoformat()
        self.assertEqual(view(read_sample(None, manual))['status'], 'due')
        manual['source_report_confirmed'] = False
        self.assertEqual(view(read_sample(None, manual))['status'], 'measurement_pending')

    def test_invalid_old_manual_timestamp_does_not_hide_live_state(self):
        for timestamp in ['bad', NOW.replace(tzinfo=None).isoformat()]:
            sample = read_sample(state(), {'value': 80, 'reported_at': timestamp})
            self.assertEqual(sample['source'], 'home_assistant')
            self.assertEqual(view(sample)['status'], 'due')
