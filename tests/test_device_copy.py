"""Copy only device metadata; never reuse physical identity or operational data."""
from copy import deepcopy
from unittest.mock import patch
from uuid import UUID
import unittest

from backend_test_support import engine
from device_copy import build_device_copy, device_copy_name


def directory():
    data = engine.blank()
    data['devices']['airtag'] = dict(
        id='airtag', name='AirTag R', manufacturer='Apple', model='AirTag',
        category='Smart Home', notes='Rucksack – Eléa', battery_type='CR2032',
        battery_quantity=1, battery_alert_enabled=True, purchase_date='2026-03-14',
        purchase_period='März 2026', serial='SERIAL-ORIGINAL', ha_device_id='ha-original',
        battery_entity_id='sensor.original_battery', area='Büro',
        predecessor_id='old', successor_id='next', controller_device_id='controller',
        controlled_device_ids=['controlled'], related_devices=[{'id': 'other'}],
        incoming_devices=[{'id': 'incoming'}], in_storage=True, archived=True,
        archived_at='2026-01-01', created_at='2025-01-01T12:00:00+01:00',
        device_updated_at='2026-01-02T14:00:00+01:00',
        sensor_registry_id='registry-original', source_ref='import-source',
        import_id='original-import', unknown_legacy_data={'secret': ['original']},
    )
    data['rules']['rule'] = dict(id='rule', device_id='airtag', name='Prüfen', kind='none')
    data['logs']['log'] = dict(id='log', device_id='airtag', kind='purchase', event_date='2026-03-14', cost=35)
    data['shopping']['shopping'] = dict(id='shopping', name='Batterien', battery_type='CR2032', done=False)
    data['settings'] = dict(
        battery_inventory={'CR2032': 45}, battery_device_links={'CR2032': ['airtag']},
        consumables={'cleaner': dict(id='cleaner', name='Reiniger', unit='Stück',
                                    quantity=3, threshold=1, device_ids=['airtag'])},
    )
    return data


class DeviceCopy(unittest.TestCase):
    def test_copies_metadata_and_has_a_new_identity_without_reusing_device_state(self):
        data = directory()
        before = deepcopy(data)
        copy = build_device_copy(data, 'airtag')
        self.assertEqual(copy, dict(
            id=copy['id'], name='AirTag R (Kopie)', manufacturer='Apple', model='AirTag',
            category='Smart Home', notes='Rucksack – Eléa', battery_type='CR2032',
            battery_quantity=1, battery_alert_enabled=True, purchase_date='2026-03-14',
            purchase_period='März 2026', in_storage=False, archived=False, archived_at=None,
        ))
        self.assertEqual(UUID(copy['id']).version, 4)
        self.assertNotEqual(copy['id'], data['devices']['airtag']['id'])
        self.assertEqual(data, before, 'Preparing a copy does not touch the source, snapshots or inventory')
        self.assertNotIn(copy['id'], data['devices'], 'Only the caller may persist a prepared copy')

    def test_copying_three_devices_allocates_separate_ids_and_unique_names(self):
        data = directory()
        copies = []
        for _ in range(3):
            copy = build_device_copy(data, 'airtag')
            data['devices'][copy['id']] = copy
            copies.append(copy)
        self.assertEqual([copy['name'] for copy in copies],
                         ['AirTag R (Kopie)', 'AirTag R (Kopie 2)', 'AirTag R (Kopie 3)'])
        self.assertEqual(len({copy['id'] for copy in copies}), 3)
        for copy in copies:
            self.assertNotIn('ha_device_id', copy)
            self.assertNotIn('serial', copy)
            self.assertNotIn('battery_entity_id', copy)
        self.assertEqual(len(data['rules']), 1)
        self.assertEqual(len(data['logs']), 1)
        self.assertEqual(data['settings']['battery_inventory'], {'CR2032': 45})
        self.assertEqual(data['settings']['battery_device_links'], {'CR2032': ['airtag']})
        self.assertEqual(data['settings']['consumables']['cleaner']['device_ids'], ['airtag'])

    def test_names_consider_storage_archive_trash_case_and_equivalent_whitespace(self):
        data = directory()
        for identity, name, state in (
            ('storage', 'airtag r (kopie)', {'in_storage': True}),
            ('archive', '  AirTag  R (Kopie 2)  ', {'archived': True}),
            ('trash', 'AirTag R (Kopie 3)', {'deleted_at': '2026-11-23T14:00:00+01:00'}),
        ):
            data['devices'][identity] = dict(id=identity, name=name, **state)
        before = deepcopy(data)
        self.assertEqual(device_copy_name(data, 'airtag'), 'AirTag R (Kopie 4)')
        self.assertEqual(data, before)

    def test_preview_does_not_allocate_an_id_and_preserves_unicode(self):
        data = directory()
        data['devices']['airtag']['name'] = 'Gerät Eléa'
        before = deepcopy(data)
        with patch('device_copy.uuid4', side_effect=AssertionError('Preview must not allocate an ID')):
            self.assertEqual(device_copy_name(data, 'airtag'), 'Gerät Eléa (Kopie)')
        self.assertEqual(data, before)

    def test_explicit_names_remain_when_free_and_are_made_unique_on_collision(self):
        data = directory()
        self.assertEqual(build_device_copy(data, 'airtag', {'name': '  AirTag A  '})['name'], 'AirTag A')
        data['devices']['another'] = dict(id='another', name='AirTag A')
        self.assertEqual(build_device_copy(data, 'airtag', {'name': 'AirTag A'})['name'], 'AirTag A (Kopie)')
        self.assertEqual(device_copy_name(data, 'airtag', 'AIRTag a'), 'AIRTag a (Kopie)')

    def test_uuid_collision_never_overwrites_an_existing_device(self):
        data = directory()
        with patch('device_copy.uuid4', side_effect=['airtag', 'fresh-id']):
            self.assertEqual(build_device_copy(data, 'airtag')['id'], 'fresh-id')
        self.assertEqual(data['devices']['airtag']['name'], 'AirTag R')

    def test_explicit_metadata_overrides_do_not_mutate_either_input(self):
        data = directory()
        overrides = dict(name='AirTag A', manufacturer='Andere Marke', model='Modell 2',
                         category='Sensoren', notes='', battery_type='CR2450', battery_quantity=2,
                         battery_alert_enabled=False, purchase_date='2026-11-23', purchase_period=None)
        before, before_overrides = deepcopy(data), deepcopy(overrides)
        copy = build_device_copy(data, 'airtag', overrides)
        for key, value in overrides.items():
            self.assertEqual(copy[key], value)
        copy['notes'] = 'Nur die neue Kopie'
        self.assertEqual(data, before)
        self.assertEqual(overrides, before_overrides)

    def test_identity_links_state_and_timestamps_cannot_be_injected_as_overrides(self):
        data = directory()
        before = deepcopy(data)
        for key in ('id', 'serial', 'ha_device_id', 'battery_entity_id', 'sensor_registry_id',
                    'area', 'related_devices', 'incoming_devices', 'controller_device_id',
                    'predecessor_id', 'successor_id', 'device_status', 'archived', 'in_storage',
                    'deleted_at', 'created_at', 'device_updated_at', 'source_ref', 'import_id'):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Stammdaten'):
                build_device_copy(data, 'airtag', {key: None})
        self.assertEqual(data, before)

    def test_missing_or_trashed_sources_are_rejected_without_mutation(self):
        data = directory()
        for identity in ('missing', None, 12):
            with self.subTest(identity=identity), self.assertRaisesRegex(ValueError, 'nicht gefunden'):
                build_device_copy(data, identity)
        for state in ({'deleted_at': '2026-11-23'}, {'device_status': 'trash'}):
            with self.subTest(state=state):
                data['devices']['airtag'].update(state)
                before = deepcopy(data)
                with self.assertRaisesRegex(ValueError, 'Papierkorb'):
                    build_device_copy(data, 'airtag')
                with self.assertRaisesRegex(ValueError, 'Papierkorb'):
                    device_copy_name(data, 'airtag')
                self.assertEqual(data, before)
                for key in state:
                    data['devices']['airtag'].pop(key)

    def test_invalid_override_shapes_names_and_types_are_rejected(self):
        data = directory()
        before = deepcopy(data)
        for overrides in ([], 'name', 12, {'name': None}, {'name': ''}, {'name': '  '},
                          {'notes': []}, {'manufacturer': 12}, {'purchase_date': '2026-02-30'},
                          {'purchase_date': 'morgen'}, {'battery_alert_enabled': 'on'}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                build_device_copy(data, 'airtag', overrides)
        self.assertEqual(data, before)

    def test_battery_quantity_uses_existing_device_limits_without_inventing_missing_counts(self):
        data = directory()
        for quantity in (True, 0, -1, 1001, 1.5, '2'):
            with self.subTest(quantity=quantity), self.assertRaisesRegex(ValueError, 'Batterieanzahl'):
                build_device_copy(data, 'airtag', {'battery_quantity': quantity})
        for quantity in (None, 1, 2, 1000):
            with self.subTest(quantity=quantity):
                self.assertEqual(build_device_copy(data, 'airtag', {'battery_quantity': quantity})['battery_quantity'], quantity)

    def test_removing_the_battery_type_clears_count_and_automatic_warning(self):
        data = directory()
        before = deepcopy(data)
        for battery_type in (None, '', '  '):
            copy = build_device_copy(data, 'airtag', {'battery_type': battery_type})
            self.assertIsNone(copy['battery_quantity'])
            self.assertFalse(copy['battery_alert_enabled'])
        self.assertEqual(data, before)

    def test_minimal_manual_device_is_valid_and_does_not_invent_optional_metadata(self):
        data = engine.blank()
        data['devices']['manual'] = dict(id='manual', name='Regendusche')
        copy = build_device_copy(data, 'manual')
        self.assertEqual(copy['name'], 'Regendusche (Kopie)')
        self.assertNotIn('manufacturer', copy)
        self.assertNotIn('purchase_date', copy)
        self.assertIsNone(copy['battery_quantity'])
        self.assertFalse(copy['battery_alert_enabled'])
        data['devices'][copy['id']] = copy
        engine.validate_data(data)
