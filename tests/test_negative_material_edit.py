from backend_test_support import DirectoryTestCase, TaskMaterialFixture, deepcopy, ns


class NegativeMaterialEdit(TaskMaterialFixture, DirectoryTestCase):
    async def test_note_edit_after_consumption_keeps_negative_quantity(self):
        obj = self.linked('material', stock=2)
        obj.data['rules']['r']['consumable']['quantity'] = 3
        await self.done(obj, consume_material=True)
        material = deepcopy(obj.data['settings']['consumables']['salt'])
        self.assertEqual(material['quantity'], -1)
        material['notes'] = 'Bitte nachkaufen'
        await ns['execute'](obj, 'save_consumable', {'revision':obj.data['revision'], 'value':material})
        self.assertEqual(obj.data['settings']['consumables']['salt']['quantity'], -1)
        self.assertEqual(obj.data['settings']['consumables']['salt']['notes'], 'Bitte nachkaufen')
        self.assertFalse(obj.data['shopping']['consumable:salt']['done'])

    async def test_bounds_unknown_and_invalid_thresholds(self):
        for quantity in [-100000, -0.5, 0, None, 100000]:
            obj = self.linked('material')
            material = deepcopy(obj.data['settings']['consumables']['salt'])
            material['quantity'] = quantity
            await ns['execute'](obj, 'save_consumable', {'revision':obj.data['revision'], 'value':material})
            self.assertEqual(obj.data['settings']['consumables']['salt']['quantity'], quantity)
        for changes in [{'quantity':-100001}, {'quantity':100001}, {'quantity':True}, {'quantity':float('nan')}, {'quantity':float('inf')}, {'threshold':-1}, {'threshold':True}, {'threshold':float('inf')}]:
            obj = self.linked('material'); before = deepcopy(obj.data)
            material = dict(obj.data['settings']['consumables']['salt'], **changes)
            with self.assertRaises(ValueError):
                await ns['execute'](obj, 'save_consumable', {'revision':obj.data['revision'], 'value':material})
            self.assertEqual(obj.data, before)
