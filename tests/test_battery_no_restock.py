"""Battery opt-outs affect automatic shopping only, never stock transactions."""
import json
from types import SimpleNamespace

from backend_test_support import DirectoryTestCase, TaskMaterialFixture, deepcopy, engine, ns


def order(identity, kind='AA', *, automatic=False, done=False, **extra):
    return dict(id=identity, name='Batterien nachkaufen', battery_type=kind,
                battery_inventory_auto=automatic, done=done, **extra)


class BatteryNoRestock(TaskMaterialFixture, DirectoryTestCase):
    async def call(self, obj, action, **payload):
        return await ns['execute'](obj, action, {'revision': obj.data['revision'], **payload})

    async def edit(self, obj, **payload):
        return await self.call(obj, 'edit_battery_type', type='AA', new_type='AA',
                               quantity=obj.data['settings']['battery_inventory']['AA'],
                               device_ids=[], **payload)

    async def test_missing_setting_retains_existing_low_stock_behavior(self):
        obj = self.obj()
        await self.call(obj, 'battery_inventory', stocks={'AA': 1})
        self.assertNotIn('battery_no_restock', obj.data['settings'])
        self.assertFalse(obj.data['shopping']['battery-stock:AA']['done'])
        await self.edit(obj)
        self.assertNotIn('battery_no_restock', obj.data['settings'])

    async def test_edit_suppresses_only_open_automatic_orders_without_touching_stock(self):
        obj = self.obj()
        obj.data['settings']['battery_inventory'] = {'AA': 1, 'AAA': 1}
        obj.data['shopping'] = {
            'battery-stock:AA': order('battery-stock:AA', automatic=True),
            'custom-auto': order('custom-auto', automatic=True),
            'manual': order('manual', notes='Manuell beibehalten'),
            'paid': order('paid', automatic=True, done=True, purchased_quantity=4),
            'other': order('other', 'AAA', automatic=True),
        }
        before = deepcopy(obj.data)
        await self.edit(obj, no_restock=True)
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AA'])
        self.assertEqual(obj.data['settings']['battery_inventory'], before['settings']['battery_inventory'])
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        self.assertNotIn('custom-auto', obj.data['shopping'])
        for key in ('manual', 'paid', 'other'):
            self.assertEqual(obj.data['shopping'][key], before['shopping'][key])

    async def test_reopened_auto_orders_keep_old_purchase_metadata_and_booking_references(self):
        for details, booked in [({'purchased_quantity': 4}, False),
                                ({'purchased_at': '2026-01-01T10:00:00+00:00'}, False), ({}, True)]:
            with self.subTest(details=details, booked=booked):
                obj = self.obj()
                obj.data['settings']['battery_inventory'] = {'AA': 0}
                obj.data['shopping']['battery-stock:AA'] = order('battery-stock:AA', automatic=True, **details)
                if booked:
                    obj.data['operations']['old-purchase'] = 'battery-stock:AA'
                before = deepcopy(obj.data)
                await self.edit(obj, no_restock=True)
                self.assertEqual(obj.data['shopping']['battery-stock:AA'],
                                 {**before['shopping']['battery-stock:AA'], 'done': True})
                self.assertEqual(obj.data['operations'], before['operations'])
                self.assertEqual(obj.data['settings']['battery_inventory'], {'AA': 0})
                await self.edit(obj, no_restock=False)
                self.assertFalse(obj.data['shopping']['battery-stock:AA']['done'])
                for key, value in details.items():
                    self.assertEqual(obj.data['shopping']['battery-stock:AA'][key], value)
                self.assertEqual(obj.data['operations'], before['operations'])

    async def test_inventory_partial_updates_create_and_reenable_only_selected_types(self):
        obj = self.obj()
        await self.call(obj, 'battery_inventory', stocks={'AA': 0, 'AAA': 0}, no_restock={'AA': True})
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        self.assertFalse(obj.data['shopping']['battery-stock:AAA']['done'])
        await self.call(obj, 'battery_inventory', no_restock={'AAA': True})
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AA', 'AAA'])
        self.assertEqual(obj.data['shopping'], {})
        await self.call(obj, 'battery_inventory', no_restock={'AA': False})
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AAA'])
        self.assertFalse(obj.data['shopping']['battery-stock:AA']['done'])
        self.assertEqual(obj.data['settings']['battery_inventory'], {'AA': 0, 'AAA': 0})

    async def test_reenable_reopens_a_completed_auto_order_when_stock_is_still_low(self):
        obj = self.obj()
        obj.data['settings'].update(battery_inventory={'AA': 0}, battery_no_restock=['AA'])
        obj.data['shopping']['battery-stock:AA'] = order('battery-stock:AA', automatic=True, done=True, purchased_quantity=2)
        await self.edit(obj, no_restock=False)
        self.assertFalse(obj.data['shopping']['battery-stock:AA']['done'])
        self.assertEqual(obj.data['shopping']['battery-stock:AA']['purchased_quantity'], 2)
        self.assertEqual(obj.data['settings']['battery_no_restock'], [])

    async def test_omitted_edit_preserves_optout_and_rename_moves_it(self):
        obj = self.obj()
        obj.data['settings'].update(battery_inventory={'AA': 0}, battery_no_restock=['AA', 'AAA'])
        await self.edit(obj)
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AA', 'AAA'])
        await self.call(obj, 'edit_battery_type', type='AA', new_type='AA (Lithium)',
                        quantity=0, device_ids=[])
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AA (Lithium)', 'AAA'])
        self.assertNotIn('battery-stock:AA (Lithium)', obj.data['shopping'])
        await self.call(obj, 'battery_inventory', remove_types=['AA (Lithium)'])
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AAA'])
        await self.call(obj, 'battery_inventory', stocks={'AA (Lithium)': 0})
        self.assertFalse(obj.data['shopping']['battery-stock:AA (Lithium)']['done'])

    async def test_purchase_replacement_undo_and_normalization_honor_optout(self):
        obj = self.linked(stock=1)
        obj.data['settings']['battery_no_restock'] = ['AA']
        obj.data['shopping']['manual'] = order('manual')
        await self.call(obj, 'battery_purchase', id='manual', quantity=1, operation_id='purchase')
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 2)
        self.assertTrue(obj.data['shopping']['manual']['done'])
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        result = await self.call(obj, 'battery_replacement', operation_id='replacement', value={'device_id': 'd'})
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 0)
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        await self.call(obj, 'undo_completion', id=result['id'])
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 2)
        await self.call(obj, 'normalize_battery_devices')
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        self.assertEqual(obj.data['operations']['purchase'], 'manual')

    async def test_task_consumption_and_undo_do_not_create_suppressed_orders(self):
        obj = self.linked(stock=1)
        obj.data['settings']['battery_no_restock'] = ['AA']
        result = await self.done(obj, consume_material=True)
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], -1)
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])
        await self.call(obj, 'undo_completion', id=result['id'])
        self.assertEqual(obj.data['settings']['battery_inventory']['AA'], 1)
        self.assertNotIn('battery-stock:AA', obj.data['shopping'])

    async def test_export_restore_prunes_stale_auto_only_and_data_reset_removes_setting(self):
        obj = self.obj()
        await self.call(obj, 'battery_inventory', stocks={'AA': 0}, no_restock={'AA': True})
        exported = json.loads(json.dumps(await self.call(obj, 'export')))
        self.assertEqual(exported['settings']['battery_no_restock'], ['AA'])
        exported['shopping'] = {'stale': order('stale', automatic=True), 'manual': order('manual'),
                                'paid': order('paid', automatic=True, done=True, purchased_quantity=2)}
        incoming = deepcopy(exported)
        await self.call(obj, 'restore', value=exported)
        self.assertEqual(exported, incoming, 'Import source data is not mutated')
        self.assertEqual(obj.data['settings']['battery_inventory'], {'AA': 0})
        self.assertEqual(obj.data['settings']['battery_no_restock'], ['AA'])
        self.assertNotIn('stale', obj.data['shopping'])
        self.assertEqual(obj.data['shopping']['manual'], incoming['shopping']['manual'])
        self.assertEqual(obj.data['shopping']['paid'], incoming['shopping']['paid'])
        removed = []
        async def remove():
            removed.append(True)
        obj.rollback = SimpleNamespace(async_remove=remove)
        await self.call(obj, 'reset_all_data', confirmed=True, confirmation='DATEN ZURÜCKSETZEN')
        self.assertNotIn('battery_no_restock', obj.data['settings'])
        self.assertEqual(obj.data['settings']['device_categories'], ['Licht', 'Heizung', 'Sensoren'])
        self.assertEqual(removed, [True])

    async def test_stale_auto_creation_is_rejected_but_manual_orders_remain_supported(self):
        obj = self.obj()
        obj.data['settings'].update(battery_inventory={'AA': 0}, battery_no_restock=['AA'])
        before = deepcopy(obj.data)
        with self.assertRaisesRegex(ValueError, 'Nachkaufen deaktiviert'):
            await self.call(obj, 'save_shopping', value=order('battery-stock:AA', automatic=True))
        self.assertEqual(obj.data, before)
        await self.call(obj, 'save_shopping', value=order('manual'))
        self.assertFalse(obj.data['shopping']['manual']['done'])
        self.assertEqual(obj.data['settings']['battery_inventory'], {'AA': 0})

    async def test_invalid_flag_payloads_reject_atomically(self):
        for value in (None, 'true', 1, [], {}):
            obj = self.obj()
            obj.data['settings']['battery_inventory'] = {'AA': 1}
            before = deepcopy(obj.data)
            with self.assertRaises(ValueError):
                await self.edit(obj, no_restock=value)
            self.assertEqual(obj.data, before)
        for value in (None, [], ['AA'], {'AA': 'true'}, {'AA': 1}, {'AA': None}, {'missing': True}, {42: True}):
            obj = self.obj()
            obj.data['settings']['battery_inventory'] = {'AA': 1}
            before = deepcopy(obj.data)
            with self.assertRaises(ValueError):
                await self.call(obj, 'battery_inventory', no_restock=value)
            self.assertEqual(obj.data, before)

    async def test_invalid_imported_optouts_reject_before_commit(self):
        for value in (None, {}, 'AA', [None], [1], ['']):
            obj = self.obj()
            before = deepcopy(obj.data)
            incoming = deepcopy(before)
            incoming['settings']['battery_no_restock'] = value
            with self.assertRaises(ValueError):
                await self.call(obj, 'restore', value=incoming)
            self.assertEqual(obj.data, before)
