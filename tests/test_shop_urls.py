"""Optional inventory shop links survive edits and reject unsafe imported URLs."""
import json
import unittest
from types import SimpleNamespace

from backend_test_support import DirectoryTestCase, deepcopy, engine, ns

URL = 'https://shop.example/products/filter?size=2&pack=4#details'
OTHER_URL = 'https://store.example/batteries/aa'


def material(**changes):
    return {**dict(id='filter', name='Filter', unit='Stück', quantity=3,
                   threshold=1, notes='Notiz bleibt', device_ids=['d']), **changes}


class ShopUrlValidation(unittest.TestCase):
    def test_absolute_http_urls_and_outer_spaces(self):
        for url in [URL, 'http://shop.example:8080/produkt',
                    'https://bücher.example/filter', 'https://xn--bcher-kva.example/',
                    'https://192.0.2.1/', 'https://[2001:db8::1]:8443/filter',
                    'https://shop.local/', 'https://shop.example./',
                    'https://shop.example/Filter%20neu?q=grün']:
            with self.subTest(url=url):
                self.assertEqual(engine.normalize_shop_url('  ' + url + '  '), url)
        self.assertEqual(engine.normalize_shop_url('   '), '')

    def test_unsafe_schemes_credentials_hosts_controls_and_ports_are_rejected(self):
        for url in invalid_urls():
            with self.subTest(url=repr(url)):
                with self.assertRaisesRegex(ValueError, 'Shop-Link'):
                    engine.normalize_shop_url(url)


def invalid_urls():
    return [None, False, 42, {}, [], 'javascript:alert(1)', 'data:text/html,test',
            'ftp://shop.example/file', '//shop.example/filter', '/filter', 'https:///filter',
            'https://', 'https://user:secret@shop.example/', 'https://@shop.example/',
            'https://user%40name@shop.example/', 'https://shop.example\\@other.example/',
            'https://shop.example/with space', '\nhttps://shop.example/',
            'https://shop.example/\x00file', 'https://shop.example/\tfile',
            'https://shop.example/\x7ffile', 'https://shop.example/<tag>',
            'https://shop.example/"quoted', 'https://-bad.example/',
            'https://bad-.example/', 'https://bad..example/', 'https://bad_host.example/',
            'https://shop.example:abc/', 'https://shop.example:/',
            'https://shop.example:0/', 'https://shop.example:65536/',
            'https://[::1]other.example/', 'https://[bad]/', 'https://%65xample.com/',
            'https://999.999.999.999/', 'https://127.1/', 'https://xn--a.example/',
            'https://' + 'x' * 64 + '.example/', 'https://shop.example/' + 'a' * 2048]


class ShopUrls(DirectoryTestCase):
    async def call(self, obj, action, **payload):
        return await ns['execute'](obj, action, {'revision': obj.data['revision'], **payload})

    async def test_material_link_is_normalized_preserved_on_stock_edit_and_explicitly_cleared(self):
        obj = self.obj()
        await self.call(obj, 'save_consumable', value=material(shop_url='  ' + URL + '  '))
        stored = obj.data['settings']['consumables']['filter']
        self.assertEqual(stored['shop_url'], URL)
        self.assertEqual(stored['notes'], 'Notiz bleibt')
        await self.call(obj, 'save_consumable', value=material(quantity=4))
        self.assertEqual(obj.data['settings']['consumables']['filter']['shop_url'], URL)
        await self.call(obj, 'save_consumable', value=material(shop_url=''))
        self.assertNotIn('shop_url', obj.data['settings']['consumables']['filter'])
        self.assertEqual(obj.data['settings']['consumables']['filter']['device_ids'], ['d'])

    async def test_battery_add_stock_edit_rename_update_clear_and_remove(self):
        obj = self.obj()
        await self.call(obj, 'battery_inventory', stocks={'AA': 4}, shop_urls={'AA': ' ' + URL + ' '})
        await self.call(obj, 'battery_inventory', stocks={'AA': 5})
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {'AA': URL})
        await self.call(obj, 'edit_battery_type', type='AA', new_type='AA (Lithium)',
                        quantity=5, device_ids=['d'])
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {'AA (Lithium)': URL})
        await self.call(obj, 'edit_battery_type', type='AA (Lithium)', new_type='AA (Lithium)',
                        quantity=5, device_ids=['d'], shop_url=OTHER_URL)
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {'AA (Lithium)': OTHER_URL})
        await self.call(obj, 'edit_battery_type', type='AA (Lithium)', new_type='AA (Lithium)',
                        quantity=5, device_ids=['d'], shop_url='')
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {})
        await self.call(obj, 'battery_inventory', shop_urls={'AA (Lithium)': URL})
        await self.call(obj, 'battery_inventory', remove_types=['AA (Lithium)'])
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {})
        await self.call(obj, 'battery_inventory', stocks={'AA (Lithium)': 1})
        self.assertNotIn('AA (Lithium)', obj.data['settings']['battery_shop_urls'])

    async def test_link_only_battery_update_and_clear_preserve_stock_notes_and_threshold(self):
        obj = self.obj()
        await self.call(obj, 'battery_inventory', stocks={'AA': -2}, thresholds={'AA': 3}, notes={'AA': 'Reserve'})
        await self.call(obj, 'battery_inventory', shop_urls={'AA': URL})
        await self.call(obj, 'battery_inventory', shop_urls={'AA': ''})
        self.assertEqual(obj.data['settings']['battery_inventory'], {'AA': -2})
        self.assertEqual(obj.data['settings']['battery_inventory_thresholds'], {'AA': 3})
        self.assertEqual(obj.data['settings']['battery_notes'], {'AA': 'Reserve'})
        self.assertEqual(obj.data['settings']['battery_shop_urls'], {})

    async def test_unsafe_urls_do_not_partially_change_materials_batteries_or_renames(self):
        for url in invalid_urls():
            for action in ('save_consumable', 'battery_inventory', 'edit_battery_type'):
                with self.subTest(action=action, url=repr(url)):
                    obj = self.obj()
                    obj.data['settings'].update(battery_inventory={'AA': 4}, battery_shop_urls={'AA': URL},
                                                consumables={'filter': material(shop_url=URL)})
                    before = deepcopy(obj.data)
                    payload = {'value': material(shop_url=url)} if action == 'save_consumable' else (
                        {'stocks': {'AA': 8}, 'shop_urls': {'AA': url}} if action == 'battery_inventory' else
                        {'type': 'AA', 'new_type': 'AAA', 'quantity': 8, 'device_ids': ['d'], 'shop_url': url})
                    with self.assertRaises(ValueError):
                        await self.call(obj, action, **payload)
                    self.assertEqual(obj.data, before)

    async def test_unknown_battery_type_or_malformed_link_mapping_is_rejected(self):
        for payload in [{'shop_urls': {'unknown': URL}}, {'stocks': {'AA': 1}, 'shop_urls': None},
                        {'stocks': {'AA': 1}, 'shop_urls': []}, {'stocks': {'AA': 1}, 'shop_urls': {42: URL}},
                        {'stocks': {'AA': 1}, 'shop_urls': {'T' + str(n): URL for n in range(101)}}]:
            obj = self.obj()
            before = deepcopy(obj.data)
            with self.assertRaises(ValueError):
                await self.call(obj, 'battery_inventory', **payload)
            self.assertEqual(obj.data, before)

    async def test_rename_collision_preserves_existing_links(self):
        obj = self.obj()
        obj.data['settings'].update(battery_inventory={'AA': 1, 'AAA': 2},
                                    battery_shop_urls={'AA': URL, 'AAA': OTHER_URL})
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.call(obj, 'edit_battery_type', type='AA', new_type='AAA',
                            quantity=1, device_ids=[], shop_url='')
        self.assertEqual(obj.data, before)

    async def test_export_restore_and_removed_material_keep_valid_links(self):
        obj = self.obj()
        await self.call(obj, 'save_consumable', value=material(shop_url=URL))
        await self.call(obj, 'battery_inventory', stocks={'AA': 4}, shop_urls={'AA': OTHER_URL})
        await self.call(obj, 'delete_consumable', id='filter', confirmed=True)
        self.assertEqual(obj.data['settings']['deleted_consumables']['filter']['shop_url'], URL)
        exported = json.loads(json.dumps(obj.data))
        before = deepcopy(exported)
        self.assertIs(engine.validate_data(exported), exported)
        self.assertEqual(exported, before, 'Validation must not rewrite compatible imports')
        restored = self.obj()
        await self.call(restored, 'restore', value=exported)
        self.assertEqual(restored.data['settings']['battery_shop_urls'], {'AA': OTHER_URL})
        self.assertEqual(restored.data['settings']['deleted_consumables']['filter']['shop_url'], URL)

    async def test_unsafe_active_removed_or_battery_links_in_import_are_atomic(self):
        for field in ('consumables', 'deleted_consumables', 'battery_shop_urls'):
            for bad in (None, 'javascript:alert(1)', 'https://user:secret@shop.example/'):
                with self.subTest(field=field, bad=bad):
                    obj = self.obj()
                    before = deepcopy(obj.data)
                    imported = deepcopy(obj.data)
                    imported['settings'][field] = ({'AA': bad} if field == 'battery_shop_urls' else
                                                    {'filter': material(shop_url=bad)})
                    with self.assertRaises(ValueError):
                        await self.call(obj, 'restore', value=imported)
                    self.assertEqual(obj.data, before)
        for bad in (None, [], 'not a mapping'):
            imported = self.obj().data
            imported['settings']['battery_shop_urls'] = bad
            with self.assertRaises(ValueError):
                engine.validate_data(imported)

    async def test_reset_removes_links_but_keeps_general_settings(self):
        obj = self.obj()
        obj.data['settings'].update(currency='EUR', battery_threshold_entity='input_number.demo_threshold',
                                    battery_inventory={'AA': 3}, battery_shop_urls={'AA': URL},
                                    consumables={'filter': material(shop_url=OTHER_URL)})
        removed = []
        async def remove_rollback():
            removed.append(True)
        obj.rollback = SimpleNamespace(async_remove=remove_rollback)
        await self.call(obj, 'reset_all_data', confirmed=True, confirmation='DATEN ZURÜCKSETZEN')
        self.assertNotIn('battery_shop_urls', obj.data['settings'])
        self.assertNotIn('consumables', obj.data['settings'])
        self.assertEqual(obj.data['settings']['currency'], 'EUR')
        self.assertEqual(obj.data['settings']['battery_threshold_entity'], 'input_number.demo_threshold')
        self.assertEqual(obj.data['settings']['device_categories'], ['Licht', 'Heizung', 'Sensoren'])
        self.assertEqual(removed, [True])
