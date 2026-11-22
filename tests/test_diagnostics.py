"""Directory diagnostics are informative, conservative, stable and read-only."""
import unittest
from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_components' / 'ha_wartung'))
from diagnostics import inspect_directory


class Diagnostics(unittest.TestCase):
    def data(self):
        return {'devices': {'d': {'id': 'd', 'name': 'Zoé Sensor', 'manufacturer': 'Acme',
                                  'model': 'S1', 'ha_device_id': 'ha', 'battery_entity_id': 'sensor.battery',
                                  'battery_type': 'AA', 'battery_quantity': 2}},
                'rules': {'r': {'id': 'r', 'device_id': 'd', 'name': 'Batterien wechseln',
                                'kind': 'interval', 'consumable': {'kind': 'battery', 'id': 'AA'}}},
                'settings': {'battery_inventory': {'AA': 3},
                             'consumables': {'salt': {'id': 'salt', 'name': 'Salz'}}}}

    def registry(self):
        return {'devices': [{'id': 'ha'}], 'sensors': [{'id': 's', 'entity_id': 'sensor.battery'}]}

    def check(self, data):
        return inspect_directory(data, self.registry())

    def codes(self, data):
        return [issue['code'] for issue in self.check(data)['issues']]

    def test_valid_directory_and_manual_records_need_no_ha_link(self):
        data = self.data()
        self.assertEqual(self.check(data), {'issues': [], 'checked_devices': 1, 'checked_rules': 1})
        data['devices']['d'] = {'id': 'd', 'name': 'Manueller Herd'}
        data['rules'] = {}
        self.assertEqual(self.codes(data), [])

    def test_missing_ha_device_and_sensors_are_registry_checks(self):
        data = self.data()
        data['devices']['d'].update(ha_device_id='removed', battery_entity_id='sensor.gone')
        data['rules']['r'].update(sensor_registry_id='removed')
        self.assertEqual(set(self.codes(data)), {'ha_device_missing', 'battery_sensor_missing', 'rule_sensor_missing'})
        # State/availability is not a registry deletion.
        registry = self.registry()
        registry['sensors'][0].update(disabled=True, state='unavailable')
        self.assertEqual(inspect_directory(self.data(), registry)['issues'], [])

    def test_battery_and_material_links_include_rotation_steps(self):
        data = self.data()
        data['rules']['r'].update(kind='rotation', steps=['Reinigen', 'Entkalken'],
            consumable={'kind': 'battery', 'id': 'CR2032'},
            consumables_by_step={'Reinigen': {'kind': 'material', 'id': 'gone'},
                                 'Entkalken': {'kind': 'material', 'id': 'salt', 'quantity': 1.5}})
        issues = self.check(data)['issues']
        self.assertEqual([issue['code'] for issue in issues], ['battery_link_missing', 'material_link_missing'])
        self.assertEqual(issues[1]['step'], 'Reinigen')
        self.assertEqual(issues[1]['rule_id'], 'r')
        data['settings']['battery_inventory']['CR2032'] = 2
        data['rules']['r']['consumables_by_step']['Reinigen']['id'] = 'salt'
        self.assertEqual(self.codes(data), [])
        data['settings']['battery_inventory_hidden_types'] = ['CR2032']
        self.assertEqual(self.codes(data), ['battery_link_missing'])
        data['settings']['consumables']['salt']['deleted_at'] = 'today'
        self.assertIn('material_link_missing', self.codes(data))

    def test_only_clear_replacements_need_consumable_assignment(self):
        data = self.data()
        data['rules']['r']['consumable'] = None
        for title in ['Batterien wechseln', 'Batterie ersetzen', 'Batteriewechsel', 'Wechsel auf Lithium vor Winter']:
            data['rules']['r']['name'] = title
            self.assertIn('battery_material_unassigned', self.codes(data), title)
        for title in ['Batterien prüfen', 'Akku aufladen', 'Batteriestand prüfen', 'Firmware Update']:
            data['rules']['r']['name'] = title
            self.assertNotIn('battery_material_unassigned', self.codes(data), title)
        data['rules']['r'].update(kind='rotation', steps=['Batterien wechseln', 'Batterien prüfen'], name='Wartung')
        self.assertEqual(self.codes(data).count('battery_material_unassigned'), 1)

    def test_unknown_battery_type_and_invalid_quantity_without_fixed_accu_noise(self):
        data = self.data()
        for raw in ['', None, 'Unbekannt', 'nicht dokumentiert', 'zu klären', 'Batterietyp offen']:
            data['devices']['d']['battery_type'] = raw
            self.assertIn('battery_type_missing', self.codes(data), raw)
        data['devices']['d'].pop('battery_entity_id')
        data['devices']['d']['battery_type'] = None
        data['rules'] = {}
        self.assertIn('battery_type_missing', self.codes(data))
        data['devices']['d']['battery_type'] = 'AA'
        for quantity in [None, 0, True, 1.5, 1001]:
            data['devices']['d']['battery_quantity'] = quantity
            self.assertIn('battery_quantity_invalid', self.codes(data), quantity)
        data['devices']['d'].update(battery_type='2 × AA', battery_quantity=None)
        self.assertNotIn('battery_quantity_invalid', self.codes(data))
        data['devices']['d'].update(battery_type='Akku fest verbaut', battery_quantity=None)
        data['rules'] = {}
        self.assertEqual(self.codes(data), [])

    def test_storage_archive_and_trash_are_not_treated_as_active_tasks(self):
        data = self.data()
        data['rules']['r']['consumable'] = None
        for mode in [{'in_storage': True}, {'archived': True}, {'archived_at': '2026-01-01'}]:
            data['devices']['d'].update(mode)
            data['devices']['d']['ha_device_id'] = 'gone'
            self.assertNotIn('battery_material_unassigned', self.codes(data))
            self.assertIn('ha_device_missing', self.codes(data))
            for key in mode:
                data['devices']['d'].pop(key)
        data['devices']['d']['deleted_at'] = 'today'
        self.assertEqual(self.check(data), {'issues': [], 'checked_devices': 0, 'checked_rules': 0})
        data['devices']['d'].pop('deleted_at')
        data['rules']['r']['deleted_at'] = 'today'
        data['devices']['d']['ha_device_id'] = 'ha'
        self.assertEqual(self.check(data)['checked_rules'], 0)
        self.assertNotIn('battery_material_unassigned', self.codes(data))

    def test_duplicate_candidates_are_conservative_and_grouped(self):
        data = self.data()
        data['devices']['other'] = dict(data['devices']['d'], id='other', name='Other')
        self.assertEqual(self.codes(data), ['duplicate_ha_device'])
        data['devices']['third'] = dict(data['devices']['d'], id='third')
        self.assertEqual(self.codes(data), ['duplicate_ha_device'])
        del data['devices']['third']
        data['devices']['other'].update(name='Zoe Sensor', ha_device_id=None)
        self.assertEqual(self.codes(data), ['possible_duplicate'])
        data['devices']['other']['ha_device_id'] = 'different-ha'
        self.assertNotIn('possible_duplicate', self.codes(data))
        data['devices']['other'].pop('ha_device_id')
        data['devices']['other']['model'] = 'Different model'
        self.assertNotIn('possible_duplicate', self.codes(data))
        data['devices']['other']['deleted_at'] = 'today'
        self.assertNotIn('possible_duplicate', self.codes(data))

    def test_reserve_or_archived_devices_are_not_name_duplicate_candidates(self):
        for mode in [{'in_storage': True}, {'archived': True}, {'archived_at': '2026-01-01'}]:
            with self.subTest(mode=mode):
                data = self.data()
                data['devices']['other'] = dict(data['devices']['d'], id='other', ha_device_id=None, **mode)
                self.assertNotIn('possible_duplicate', self.codes(data))
                data['devices']['other']['ha_device_id'] = 'missing-ha'
                self.assertIn('ha_device_missing', self.codes(data))
                data['devices']['other']['ha_device_id'] = 'ha'
                self.assertIn('duplicate_ha_device', self.codes(data))

    def test_read_only_stable_raw_text_and_broken_related_link(self):
        data = self.data()
        data['devices']['d'].update(name='<Sensor & Sonderzeichen>', related_devices=[{'id': 'gone'}])
        data['rules']['r']['consumable']['quantity'] = 0
        before, registry = deepcopy(data), self.registry()
        registry_before = deepcopy(registry)
        first = inspect_directory(data, registry)
        self.assertEqual(data, before)
        self.assertEqual(registry, registry_before)
        self.assertEqual(first, inspect_directory(data, registry))
        self.assertEqual(set(issue['code'] for issue in first['issues']), {'material_link_invalid', 'related_device_missing'})
        self.assertIn('<Sensor & Sonderzeichen>', first['issues'][1]['detail'])
        self.assertTrue(all(issue['device_ids'] == ['d'] for issue in first['issues']))


if __name__ == '__main__':
    unittest.main()
