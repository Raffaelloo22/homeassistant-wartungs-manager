"""Reject malformed inventory imports while retaining compatible historical exports."""
from backend_test_support import DirectoryTestCase, deepcopy, ns
import engine
import unittest


def directory():
    data = engine.blank()
    data['devices']['d'] = {'id': 'd', 'name': 'Gerät'}
    return data


def material():
    return dict(id='salt', name='Salz', unit='kg', quantity=2, threshold=1)


def malformed_settings():
    yield None
    yield []
    for field in ('consumables', 'deleted_consumables', 'battery_inventory',
                  'battery_inventory_thresholds', 'battery_notes', 'battery_device_links'):
        yield {field: []}
    for value in (42, None, [], {'id': 'different', 'name': 'Salz', 'unit': 'kg', 'quantity': 1, 'threshold': 1}):
        yield {'consumables': {'salt': value}}
        yield {'deleted_consumables': {'salt': value}}
    for field in ('id', 'name', 'unit', 'quantity', 'threshold'):
        broken = material()
        del broken[field]
        yield {'consumables': {'salt': broken}}
    for field, values in (
        ('quantity', [True, '2', float('nan'), float('inf'), -100001, 100001]),
        ('threshold', [True, None, '1', -1, float('nan'), float('inf'), 100001]),
        ('name', [None, 42, '']),
        ('unit', [None, 42, '']),
        ('notes', [None, 42, {}]),
        ('device_ids', [None, 'd', [None], [42], ['']]),
    ):
        for value in values:
            broken = material()
            broken[field] = value
            yield {'consumables': {'salt': broken}}
    for field, values in (
        ('battery_inventory', [None, True, '2', 0.5, float('nan'), float('inf'), -100001, 100001]),
        ('battery_inventory_thresholds', [None, True, '1', -1, 0.5, float('nan'), float('inf'), 100001]),
        ('battery_notes', [None, 42, {}]),
        ('battery_device_links', [None, 'd', [None], [42], ['']]),
    ):
        for value in values:
            yield {field: {'AA': value}}
    for value in (None, {}, 'AA', [42], ['']):
        yield {'battery_inventory_hidden_types': value}


class InventoryValidation(unittest.TestCase):
    def test_old_exports_without_inventory_settings_remain_unchanged(self):
        data = directory()
        before = deepcopy(data)
        self.assertIs(engine.validate_data(data), data)
        self.assertEqual(data, before)
        data['settings'] = {'enabled': True, 'custom_setting': {'future': 42}}
        before = deepcopy(data)
        self.assertIs(engine.validate_data(data), data)
        self.assertEqual(data, before)

    def test_valid_current_and_historical_records_are_not_normalized(self):
        data = directory()
        data['settings'] = {
            'consumables': {'salt': {**material(), 'quantity': -1.25, 'notes': 'Notiz\n<Marke>',
                                     'device_ids': ['d', 'old-device'], 'future': {'preserve': True}}},
            'deleted_consumables': {'old': {'id': 'old', 'name': 'Filter', 'unit': 'Stück',
                                           'quantity': None, 'threshold': 0, 'deleted_at': 'historical'}},
            'battery_inventory': {'AA': -2, 'CR2032': 2.0},
            'battery_inventory_thresholds': {'AA': 1.0},
            'battery_notes': {'AA': ''},
            'battery_inventory_hidden_types': ['AAA'],
            'battery_device_links': {'AA': ['d', 'old-device']},
            'future_setting': {'preserve': True},
        }
        before = deepcopy(data)
        self.assertIs(engine.validate_data(data), data)
        self.assertEqual(data, before)
        self.assertIs(type(data['settings']['battery_inventory']['CR2032']), float)

    def test_numeric_boundaries_allow_missing_stock_and_preserve_negative_values(self):
        for quantity in (None, -100000, -0.125, 0, 100000):
            for threshold in (0, 0.25, 100000):
                with self.subTest(quantity=quantity, threshold=threshold):
                    data = directory()
                    value = material()
                    value.update(quantity=quantity, threshold=threshold)
                    data['settings'] = {'consumables': {'salt': value}}
                    self.assertIs(engine.validate_data(data), data)

    def test_malformed_inventory_is_rejected_before_consumers_can_crash(self):
        for settings in malformed_settings():
            with self.subTest(settings=settings):
                data = directory()
                data['settings'] = settings
                with self.assertRaises(ValueError):
                    engine.validate_data(data)


class InventoryRestore(DirectoryTestCase):
    async def test_malformed_import_never_commits_or_changes_current_directory(self):
        for settings in malformed_settings():
            with self.subTest(settings=settings):
                obj = self.obj()
                before = deepcopy(obj.data)
                incoming = directory()
                incoming['settings'] = settings
                async def forbidden_commit(data):
                    self.fail('Malformed imports must never reach commit')
                obj.commit = forbidden_commit
                with self.assertRaises(ValueError):
                    await ns['execute'](obj, 'restore', {'revision': obj.data['revision'], 'value': incoming})
                self.assertEqual(obj.data, before)

    async def test_valid_negative_stock_restore_keeps_notes_and_unknown_fields(self):
        obj = self.obj()
        incoming = directory()
        value = material()
        value.update(quantity=-1, notes='Notiz', device_ids=['d'], future='preserve')
        incoming['settings'] = {'consumables': {'salt': value}, 'future': ['preserve']}
        before = deepcopy(incoming)
        await ns['execute'](obj, 'restore', {'revision': obj.data['revision'], 'value': incoming})
        self.assertEqual(obj.data['settings'], before['settings'])
        self.assertEqual(incoming, before)
