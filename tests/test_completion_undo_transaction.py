"""Exercise real Directory.execute: completion and undo are atomic and retry-safe."""
from backend_test_support import DirectoryTestCase, TaskMaterialFixture, deepcopy, ns


class CompletionUndoTransaction(TaskMaterialFixture, DirectoryTestCase):
    async def undo(self, obj, identity, **extra):
        return await ns['execute'](obj, 'undo_completion', {
            'revision': obj.data['revision'], 'id': identity, **extra})

    async def test_battery_undo_credits_once_and_preserves_subsequent_purchase(self):
        obj = self.linked(stock=3)
        obj.data['rules']['r'].update(last_completed='2025-12-31', booked='2026-11-24')
        result = await self.done(obj, consume_material=True)
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 1)
        self.assertFalse(obj.data['shopping']['battery-stock:AA']['done'])
        obj.data['settings']['battery_inventory']['AA'] += 10
        await self.undo(obj, result['id'])
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 13)
        self.assertTrue(obj.data['shopping']['battery-stock:AA']['done'])
        self.assertEqual(obj.data['rules']['r']['last_completed'], '2025-12-31')
        self.assertEqual(obj.data['rules']['r']['booked'], '2026-11-24')
        unchanged = deepcopy(obj.data)
        retry = await self.undo(obj, result['id'], revision=0)
        self.assertTrue(retry['already_undone'])
        self.assertEqual(obj.data, unchanged)
        # A delayed retry of the original completion must not deduct again, either.
        await self.done(obj, consume_material=True)
        self.assertEqual(obj.data, unchanged)

    async def test_material_undo_and_without_consumption(self):
        for consume in (True, False):
            obj = self.linked('material', stock=2)
            obj.data['rules']['r']['consumable']['quantity'] = 1.5
            result = await self.done(obj, consume_material=consume)
            if consume:
                self.assertFalse(obj.data['shopping']['consumable:salt']['done'])
            await self.undo(obj, result['id'])
            self.assertEqual(obj.data['settings']['consumables']['salt']['quantity'], 2)
            if consume:
                self.assertTrue(obj.data['shopping']['consumable:salt']['done'])

    async def test_measurement_saved_and_restored_in_same_transaction(self):
        for previous in (None, {'value': 8, 'source': 'manual', 'reported_at': '2026-01-01T00:00:00+00:00'}):
            obj = self.linked()
            obj.data['rules']['r'].update(kind='measurement', sensor_registry_id='sensor', threshold=20)
            obj.data['samples'] = {'other': {'value': 99}}
            if previous:
                obj.data['samples']['r'] = previous
            result = await self.done(obj, measurement=3)
            self.assertEqual(obj.data['samples']['r']['value'], 3)
            await self.undo(obj, result['id'])
            self.assertEqual(obj.data['samples'].get('r'), previous)
            self.assertEqual(obj.data['samples']['other'], {'value': 99})
            self.assertNotIn('awaiting_since', obj.data['rules']['r'])

    async def test_changed_sample_or_stale_revision_rejected_without_partial_undo(self):
        obj = self.linked()
        obj.data['rules']['r'].update(kind='measurement', sensor_registry_id='sensor', threshold=20)
        result = await self.done(obj, measurement=3, consume_material=True)
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.undo(obj, result['id'], revision=0)
        self.assertEqual(obj.data, before)
        obj.data['samples']['r']['value'] = 4
        before = deepcopy(obj.data)
        with self.assertRaisesRegex(ValueError, 'Messwert'):
            await self.undo(obj, result['id'])
        self.assertEqual(obj.data, before)

    async def test_invalid_optional_measurement_rolls_back_completion_and_stock(self):
        obj = self.linked()
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.done(obj, measurement=3, consume_material=True)
        self.assertEqual(obj.data, before)
        obj.data['rules']['r'].update(kind='measurement', sensor_registry_id='s', threshold=20)
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.done(obj, measurement=float('nan'), consume_material=True)
        self.assertEqual(obj.data, before)

    async def test_automatic_battery_replacement_undo_and_retry(self):
        obj = self.linked(stock=3)
        result = await ns['execute'](obj, 'battery_replacement', {
            'revision': 0, 'operation_id': 'battery-op', 'value': {'device_id': 'd'}})
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 1)
        await self.undo(obj, result['id'])
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 3)
        self.assertTrue(obj.data['shopping']['battery-stock:AA']['done'])
        before = deepcopy(obj.data)
        await self.undo(obj, result['id'])
        self.assertEqual(obj.data, before)

    async def test_undo_commit_failure_does_not_reopen_or_credit(self):
        obj = self.linked(stock=3)
        result = await self.done(obj, consume_material=True)
        before = deepcopy(obj.data)
        async def fail(data):
            raise OSError('disk full')
        obj.commit = fail
        with self.assertRaises(OSError):
            await self.undo(obj, result['id'])
        self.assertEqual(obj.data, before)

    async def test_unavailable_material_rejects_undo_atomically(self):
        obj = self.linked('material', stock=3)
        result = await self.done(obj, consume_material=True)
        obj.data['settings']['consumables']['salt']['quantity'] = None
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.undo(obj, result['id'])
        self.assertEqual(obj.data, before)
