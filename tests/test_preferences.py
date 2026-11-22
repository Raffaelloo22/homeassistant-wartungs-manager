"""General preferences are validated, revision-locked and separate from user records."""
import asyncio
from types import SimpleNamespace

from backend_test_support import DirectoryTestCase, deepcopy, engine, ns


class Preferences(DirectoryTestCase):
    def populated(self):
        obj = self.obj()
        obj.data['settings'].update(
            currency='CHF', battery_threshold_entity='input_number.batterien_schwellwert',
            battery_inventory={'AA': 7}, battery_notes={'AA': 'Packung'},
            consumables={'salt': {'id': 'salt', 'name': 'Salz', 'unit': 'kg',
                                  'quantity': 2, 'threshold': 1}}, enabled=True,
            event_types={'inspection': 'Prüfung'}, event_type_order=['inspection'])
        obj.data['rules']['r'] = {'id': 'r', 'device_id': 'd', 'name': 'Prüfen', 'kind': 'none'}
        obj.data['logs']['l'] = {'id': 'l', 'device_id': 'd', 'kind': 'maintenance',
                                 'event_date': '2026-11-01', 'cost': 12.5}
        return obj

    async def save(self, obj, value, **extra):
        return await ns['execute'](obj, 'preferences', {
            'revision': obj.data['revision'], 'value': value, **extra})

    async def test_save_changes_only_explicit_preferences_and_revision(self):
        obj = self.populated()
        before = deepcopy(obj.data)
        value = {'currency': 'EUR', 'battery_threshold_entity': 'input_number.battery_limit'}
        result = await self.save(obj, value)
        expected = deepcopy(before)
        expected['settings'].update(value)
        expected['revision'] += 1
        self.assertEqual(obj.data, expected)
        self.assertEqual(result['revision'], expected['revision'])
        self.assertEqual(value, {'currency': 'EUR', 'battery_threshold_entity': 'input_number.battery_limit'})

    async def test_partial_update_preserves_other_preference_and_cannot_replace_inventory(self):
        obj = self.populated()
        before = deepcopy(obj.data['settings'])
        await self.save(obj, {'currency': 'USD', 'battery_inventory': {'AA': 999},
                              'consumables': {}, 'enabled': False})
        self.assertEqual(obj.data['settings'], {**before, 'currency': 'USD'})
        await self.save(obj, {'battery_threshold_entity': 'input_number.other_limit'})
        self.assertEqual(obj.data['settings'], {**before, 'currency': 'USD',
                                               'battery_threshold_entity': 'input_number.other_limit'})

    async def test_invalid_values_are_atomic_and_never_reach_commit(self):
        invalid = [None, [], 'EUR']
        invalid += [{'currency': value} for value in ('eur', 'EU', 'EURO', ' EUR ', '', 1, True, {}, None)]
        invalid += [{'battery_threshold_entity': value} for value in (
            'sensor.limit', 'input_boolean.limit', 'input_number.Upper', 'input_number.',
            ' input_number.limit', 'input_number.limit ', '', 1, True, {}, None)]
        for value in invalid:
            with self.subTest(value=value):
                obj = self.populated()
                before = deepcopy(obj.data)
                async def forbidden_commit(data):
                    self.fail('Invalid preferences must never reach storage')
                obj.commit = forbidden_commit
                with self.assertRaises(ValueError):
                    await self.save(obj, value)
                self.assertEqual(obj.data, before)

    async def test_stale_and_competing_updates_cannot_overwrite_newer_preferences(self):
        obj = self.populated()
        original_commit = obj.commit
        async def delayed_commit(data):
            await asyncio.sleep(0)
            await original_commit(data)
        obj.commit = delayed_commit
        revision = obj.data['revision']
        results = await asyncio.gather(*[
            self.save(obj, {'currency': code}, revision=revision) for code in ('EUR', 'USD')
        ], return_exceptions=True)
        self.assertEqual(sum(isinstance(result, ValueError) for result in results), 1)
        self.assertEqual(obj.data['revision'], revision + 1)
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.save(obj, {'currency': 'GBP'}, revision=revision)
        self.assertEqual(obj.data, before)

    async def test_invalid_imported_preferences_are_rejected_without_mutation(self):
        for settings in ({'currency': 'usd'}, {'currency': None},
                         {'battery_threshold_entity': 'sensor.limit'},
                         {'battery_threshold_entity': []}):
            with self.subTest(settings=settings):
                obj = self.populated()
                before = deepcopy(obj.data)
                incoming = engine.blank()
                incoming['settings'] = deepcopy(settings)
                input_before = deepcopy(incoming)
                with self.assertRaises(ValueError):
                    await ns['execute'](obj, 'restore', {'revision': obj.data['revision'], 'value': incoming})
                self.assertEqual(obj.data, before)
                self.assertEqual(incoming, input_before)

    async def test_reset_preserves_preferences_and_general_settings_but_removes_inventory(self):
        obj = self.populated()
        await self.save(obj, {'currency': 'EUR', 'battery_threshold_entity': 'input_number.battery_limit'})
        removed = []
        async def remove_rollback():
            removed.append(True)
        obj.rollback = SimpleNamespace(async_remove=remove_rollback)
        await ns['execute'](obj, 'reset_all_data', {'revision': obj.data['revision'],
                            'confirmed': True, 'confirmation': 'DATEN ZURÜCKSETZEN'})
        self.assertEqual(obj.data['settings']['currency'], 'EUR')
        self.assertEqual(obj.data['settings']['battery_threshold_entity'], 'input_number.battery_limit')
        self.assertTrue(obj.data['settings']['enabled'])
        self.assertEqual(obj.data['settings']['event_type_order'], ['inspection'])
        self.assertEqual(obj.data['settings']['device_categories'], ['Licht', 'Heizung', 'Sensoren'])
        for key in ('devices', 'rules', 'logs'):
            self.assertEqual(obj.data[key], {})
        for key in ('battery_inventory', 'battery_notes', 'consumables'):
            self.assertNotIn(key, obj.data['settings'])
        self.assertEqual(removed, [True])
