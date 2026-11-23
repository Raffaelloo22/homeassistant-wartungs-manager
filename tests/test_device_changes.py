"""Track device master-data edits and commit independent, retry-safe copies."""
import ast
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from backend_test_support import DirectoryTestCase, TaskMaterialFixture, ROOT, deepcopy, engine, ns

OLD = '2026-01-01T10:00:00+00:00'
CREATED = '2025-01-01T10:00:00+00:00'
NOW = datetime(2026, 11, 23, 16, 20, tzinfo=timezone.utc)
LATER = datetime(2026, 11, 24, 9, 0, tzinfo=timezone.utc)


class DeviceChangeFixture:
    async def call(self, obj, action, when=NOW, **payload):
        with patch.dict(ns, dt_util=SimpleNamespace(now=lambda: when)):
            return await ns['execute'](obj, action, {'revision': obj.data['revision'], **payload})

    def tracked(self):
        obj = self.obj()
        obj.data['devices']['d'].update(created_at=CREATED, device_updated_at=OLD)
        return obj


class DeviceChanges(DeviceChangeFixture, TaskMaterialFixture, DirectoryTestCase):
    async def test_new_device_gets_both_timestamps_and_legacy_devices_are_not_backfilled(self):
        obj = self.obj()
        await self.call(obj, 'save_device', value={'id': 'new', 'name': 'Neues Gerät'})
        self.assertEqual(obj.data['devices']['new']['created_at'], NOW.isoformat())
        self.assertEqual(obj.data['devices']['new']['device_updated_at'], NOW.isoformat())
        self.assertNotIn('created_at', obj.data['devices']['d'])
        self.assertNotIn('device_updated_at', obj.data['devices']['d'])
        await self.call(obj, 'save_device', value={'id': 'd', 'name': 'Anderer Name'})
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())
        self.assertNotIn('created_at', obj.data['devices']['d'], 'Unknown creation dates must remain unknown')

    async def test_noop_defaults_area_and_client_timestamps_do_not_create_changes(self):
        obj = self.tracked()
        await self.call(obj, 'save_device', value={
            'id': 'd', 'name': 'Lampe', 'category': 'Licht', 'notes': '', 'manufacturer': None,
            'model': None, 'serial': None, 'purchase_date': None, 'battery_type': None,
            'battery_quantity': None, 'battery_alert_enabled': False, 'ha_device_id': None,
            'device_status': 'active', 'in_storage': False, 'archived': False, 'archived_at': None,
            'related_devices': [], 'area': 'Vom HA-Bereich abgeleitet', 'battery_level': 20,
            'created_at': 'forged', 'device_updated_at': 'forged',
        })
        self.assertEqual(obj.data['devices']['d']['created_at'], CREATED)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)
        await self.call(obj, 'save_device', value={'id': 'd', 'notes': 'Neue Notiz',
                                                  'created_at': 'forged', 'device_updated_at': 'forged'})
        self.assertEqual(obj.data['devices']['d']['created_at'], CREATED)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())

    async def test_direct_links_stamp_both_ends_but_reorienting_the_same_edge_is_a_noop(self):
        obj = self.tracked()
        obj.data['devices']['b'] = {'id': 'b', 'name': 'B', 'device_updated_at': OLD}
        await self.call(obj, 'save_device', value={'id': 'd', 'related_devices': [{'id': 'b'}]})
        for device in obj.data['devices'].values():
            self.assertEqual(device['device_updated_at'], NOW.isoformat())
        await self.call(obj, 'save_device', when=LATER, value={'id': 'b', 'related_devices': [{'id': 'd'}]})
        self.assertEqual(obj.data['devices']['d']['related_devices'], [])
        self.assertEqual(obj.data['devices']['b']['related_devices'], [{'id': 'd'}])
        for device in obj.data['devices'].values():
            self.assertEqual(device['device_updated_at'], NOW.isoformat(), 'An undirected edge did not change')
        await self.call(obj, 'save_device', when=LATER, value={'id': 'd', 'related_devices': []})
        for device in obj.data['devices'].values():
            self.assertEqual(device['device_updated_at'], LATER.isoformat())

    async def test_status_changes_count_without_touching_related_devices(self):
        obj = self.tracked()
        obj.data['devices']['b'] = {'id': 'b', 'name': 'B', 'related_devices': [{'id': 'd'}], 'device_updated_at': OLD}
        await self.call(obj, 'archive_device', id='d')
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())
        self.assertEqual(obj.data['devices']['b']['device_updated_at'], OLD)
        await self.call(obj, 'delete_device', when=LATER, id='d', confirmed=True)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], LATER.isoformat())
        self.assertEqual(obj.data['devices']['b']['device_updated_at'], OLD)
        await self.call(obj, 'restore_device', id='d')
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())

    async def test_category_rename_counts_but_reorder_does_not(self):
        obj = self.tracked()
        obj.data['devices']['b'] = {'id': 'b', 'name': 'Heizung', 'category': 'Heizung', 'device_updated_at': OLD}
        await self.call(obj, 'save_categories', categories=['Sensoren', 'Licht', 'Heizung'])
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)
        await self.call(obj, 'save_categories', categories=['Sensoren', 'Leuchten', 'Heizung'],
                        rename={'from': 'Licht', 'to': 'Leuchten'})
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())
        self.assertEqual(obj.data['devices']['b']['device_updated_at'], OLD)

    async def test_battery_type_change_counts_but_legacy_format_normalization_does_not(self):
        obj = self.tracked()
        obj.data['devices']['d'].update(battery_type='2 × AA', battery_quantity=None)
        obj.data['settings']['battery_inventory'] = {'AA': 4}
        await self.call(obj, 'normalize_battery_devices')
        self.assertEqual(obj.data['devices']['d']['battery_type'], 'AA')
        self.assertEqual(obj.data['devices']['d']['battery_quantity'], 2)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)
        await self.call(obj, 'edit_battery_type', type='AA', new_type='AA (Lithium)', quantity=4, device_ids=[])
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], NOW.isoformat())

    async def test_task_completion_logs_purchase_date_autofill_and_stock_do_not_stamp(self):
        obj = self.linked(stock=5)
        obj.data['devices']['d'].update(created_at=CREATED, device_updated_at=OLD)
        result = await self.call(obj, 'complete', rule_id='r', operation_id='complete-op', consume_material=True)
        await self.call(obj, 'undo_completion', id=result['id'])
        await self.call(obj, 'battery_inventory', stocks={'AA': 2})
        await self.call(obj, 'save_shopping', value={'id': 'manual', 'name': 'Batterien', 'battery_type': 'AA'})
        await self.call(obj, 'battery_purchase', id='manual', quantity=2, operation_id='purchase-op')
        await self.call(obj, 'add_log', value={'id': 'purchase', 'device_id': 'd', 'kind': 'purchase', 'event_date': '2026-11-01'})
        self.assertEqual(obj.data['devices']['d']['purchase_date'], '2026-11-01')
        self.assertEqual(obj.data['devices']['d']['created_at'], CREATED)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)

    async def test_material_linking_and_stock_do_not_stamp_unchanged_device_records(self):
        obj = self.tracked()
        await self.call(obj, 'save_consumable', value={'id': 'filter', 'name': 'Filter', 'unit': 'Stück',
                                                      'quantity': 2, 'threshold': 1, 'device_ids': ['d']})
        await self.call(obj, 'battery_inventory', stocks={'AA': 2}, device_links={'AA': ['d']})
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)

    async def test_restore_preserves_timestamps_and_rejects_invalid_ones_atomically(self):
        obj = self.tracked()
        exported = await self.call(obj, 'export')
        await self.call(obj, 'save_device', value={'id': 'd', 'notes': 'Bearbeitet'})
        await self.call(obj, 'restore', value=exported)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)
        self.assertEqual(obj.data['devices']['d']['created_at'], CREATED)
        for field in ('created_at', 'device_updated_at'):
            for value in (None, '', '2026-11-23', '2026-11-23T12:00:00', 'invalid', 42):
                incoming = deepcopy(exported)
                incoming['devices']['d'][field] = value
                before = deepcopy(obj.data)
                with self.assertRaises(ValueError):
                    await self.call(obj, 'restore', value=incoming)
                self.assertEqual(obj.data, before)

    def test_trash_snapshot_preserves_available_timestamps_without_falling_back_to_deletion(self):
        source = ast.parse((ROOT / 'custom_components/ha_wartung/__init__.py').read_text())
        cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'Directory')
        snapshot = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == 'snapshot')
        module = ast.fix_missing_locations(ast.Module(body=[snapshot], type_ignores=[]))
        namespace = {**ns, 'VERSION': 'test', 'STATUS': {}}
        exec(compile(module, 'device_change_snapshot', 'exec'), namespace)
        obj = self.obj()
        obj.registry = lambda **kwargs: {'devices': []}
        obj.hass = SimpleNamespace(config=SimpleNamespace(time_zone='Europe/Zurich', currency='CHF'))
        obj.data['devices'].update({
            'legacy': {'id': 'legacy', 'name': 'Alter Papierkorbeintrag', 'deleted_at': NOW.isoformat()},
            'tracked': {'id': 'tracked', 'name': 'Neuer Papierkorbeintrag', 'deleted_at': NOW.isoformat(),
                        'created_at': CREATED, 'device_updated_at': OLD, 'notes': 'Bleibt privat im Datensatz'},
            'created': {'id': 'created', 'name': 'Nur Erfassung bekannt', 'deleted_at': NOW.isoformat(), 'created_at': CREATED},
        })
        before = deepcopy(obj.data)
        result = namespace['snapshot'](obj)
        rows = {row['id']: row for row in result['trash']}
        self.assertEqual(set(rows['legacy']), {'id', 'name', 'deleted_at'})
        self.assertEqual(rows['tracked']['created_at'], CREATED)
        self.assertEqual(rows['tracked']['device_updated_at'], OLD)
        self.assertNotIn('notes', rows['tracked'])
        self.assertEqual(rows['created']['created_at'], CREATED)
        self.assertNotIn('device_updated_at', rows['created'])
        self.assertEqual(set(result['devices']), {'d'})
        self.assertEqual(obj.data, before, 'Reading a snapshot never backfills or mutates timestamps')

    async def test_import_stamps_only_new_devices_missing_their_creation_timestamp(self):
        obj = self.tracked()
        records = [
            {'collection': 'devices', 'source_key': 'new-device', 'value': {'id': 'new', 'name': 'Neu importiert'}},
            {'collection': 'devices', 'source_key': 'historical-device', 'value': {
                'id': 'historical', 'name': 'Historische Metadaten', 'created_at': CREATED, 'device_updated_at': OLD}},
            {'collection': 'devices', 'source_key': 'known-update', 'value': {
                'id': 'updated', 'name': 'Nur Änderung bekannt', 'device_updated_at': OLD}},
        ]
        incoming = deepcopy(records)
        await self.call(obj, 'import', records=records)
        self.assertEqual(obj.data['devices']['new']['created_at'], NOW.isoformat())
        self.assertNotIn('device_updated_at', obj.data['devices']['new'])
        self.assertEqual(obj.data['devices']['historical']['created_at'], CREATED)
        self.assertEqual(obj.data['devices']['historical']['device_updated_at'], OLD)
        self.assertEqual(obj.data['devices']['updated']['created_at'], NOW.isoformat())
        self.assertEqual(obj.data['devices']['updated']['device_updated_at'], OLD)
        self.assertEqual(records, incoming, 'Imported source records remain unchanged')
        self.assertEqual(obj.data['devices']['d']['created_at'], CREATED)
        self.assertEqual(obj.data['devices']['d']['device_updated_at'], OLD)
        before = deepcopy(obj.data['devices'])
        result = await self.call(obj, 'import', when=LATER, records=records)
        self.assertEqual(result['counts']['new'], 0)
        self.assertEqual(result['counts']['existing'], 3)
        self.assertEqual(obj.data['devices'], before)

    async def test_imported_purchase_log_does_not_stamp_existing_devices_or_backfill_unknown_dates(self):
        for tracked in (False, True):
            with self.subTest(tracked=tracked):
                obj = self.tracked() if tracked else self.obj()
                before = deepcopy(obj.data['devices']['d'])
                await self.call(obj, 'import', records=[{
                    'collection': 'logs', 'source_key': 'purchase-entry', 'value': {
                        'id': 'purchase', 'device_id': 'd', 'kind': 'purchase', 'event_date': '2026-11-01'}}])
                self.assertEqual(obj.data['devices']['d']['purchase_date'], '2026-11-01')
                for field in ('created_at', 'device_updated_at'):
                    self.assertEqual(obj.data['devices']['d'].get(field), before.get(field))
                    self.assertEqual(field in obj.data['devices']['d'], field in before)

    async def test_restore_does_not_assign_capture_dates_to_legacy_devices(self):
        obj = self.tracked()
        incoming = engine.blank()
        incoming['devices']['restored'] = {'id': 'restored', 'name': 'Historisch ohne Zeitstempel'}
        await self.call(obj, 'restore', value=incoming)
        self.assertNotIn('created_at', obj.data['devices']['restored'])
        self.assertNotIn('device_updated_at', obj.data['devices']['restored'])

    async def test_import_requires_an_aware_clock_and_rejects_invalid_supplied_dates_atomically(self):
        obj = self.obj()
        records = [{'collection': 'devices', 'source_key': 'new-device', 'value': {'id': 'new', 'name': 'Neu'}}]
        before = deepcopy(obj.data)
        with self.assertRaisesRegex(ValueError, 'Zeitzone'):
            await self.call(obj, 'import', when=datetime(2026, 11, 23, 12, 0), records=records)
        self.assertEqual(obj.data, before)
        records[0]['value']['created_at'] = '2026-11-23T12:00:00'
        with self.assertRaisesRegex(ValueError, 'Zeitzone'):
            await self.call(obj, 'import', records=records)
        self.assertEqual(obj.data, before)

    async def test_selected_device_read_is_bounded_deepcopied_and_never_enters_write_path(self):
        obj = self.tracked()
        obj.data['devices']['d']['related_devices'] = [{'id': 'other'}]
        obj.data['devices']['other'] = {'id': 'other', 'name': 'Nicht angefordert', 'notes': 'Nicht ausgeben'}
        obj.data['devices']['trash'] = {'id': 'trash', 'name': 'Papierkorb', 'deleted_at': OLD}
        obj.data['settings']['private'] = 'Nicht ausgeben'
        obj.data['logs']['l'] = {'id': 'l', 'device_id': 'd', 'kind': 'maintenance', 'event_date': '2026-01-01'}
        obj.hass = SimpleNamespace(config=SimpleNamespace(time_zone='Europe/Zurich'))
        def forbidden(*args):
            self.fail('A selected-device read must never check a write revision or commit')
        obj.check_revision = forbidden
        obj.commit = forbidden
        before = deepcopy(obj.data)
        result = await self.call(obj, 'get_devices', device_ids=['d', 'trash'], revision=-1)
        self.assertEqual(set(result), {'devices', 'revision', 'today', 'timezone'})
        self.assertEqual(result['devices'], {identity: before['devices'][identity] for identity in ['d', 'trash']})
        self.assertEqual(result['revision'], before['revision'])
        self.assertEqual(result['today'], '2026-11-23')
        self.assertEqual(result['timezone'], 'Europe/Zurich')
        self.assertEqual(obj.data, before)
        result['devices']['d']['related_devices'].append({'id': 'never-save'})
        result['devices']['d']['notes'] = 'Nur im Ergebnis geändert'
        self.assertEqual(obj.data, before, 'Returned nested objects never alias stored device data')

    async def test_selected_device_read_rejects_invalid_selections_without_mutation(self):
        for ids in (None, 'd', [], ['d', 'd'], ['d', 'missing'], [42], [{}], ['d'] * 101):
            with self.subTest(ids=ids):
                obj = self.tracked()
                before = deepcopy(obj.data)
                with self.assertRaises(ValueError):
                    await self.call(obj, 'get_devices', device_ids=ids)
                self.assertEqual(obj.data, before)

    async def test_explicit_mark_updates_only_selected_metadata_in_every_device_status(self):
        obj = self.tracked()
        obj.data['devices'].update({
            'storage': {'id': 'storage', 'name': 'Lager', 'in_storage': True},
            'archive': {'id': 'archive', 'name': 'Archiv', 'archived': True, 'archived_at': '2026-01-01'},
            'trash': {'id': 'trash', 'name': 'Papierkorb', 'deleted_at': OLD},
            'other': {'id': 'other', 'name': 'Unberührt', 'device_updated_at': OLD},
        })
        obj.data['devices']['d']['related_devices'] = [{'id': 'storage'}]
        obj.data['rules']['r'] = {'id': 'r', 'device_id': 'd', 'name': 'Prüfen', 'kind': 'none'}
        obj.data['logs']['l'] = {'id': 'l', 'device_id': 'd', 'kind': 'maintenance', 'event_date': '2026-01-01'}
        obj.data['settings']['battery_inventory'] = {'AA': 4}
        obj.data['operations']['saved'] = 'l'
        before = deepcopy(obj.data)
        ids = ['d', 'storage', 'archive', 'trash']
        result = await self.call(obj, 'mark_devices_changed', device_ids=ids,
                                 device_updated_at='1900-01-01T00:00:00+00:00', created_at='forged')
        self.assertEqual(result, {'updated': 4, 'device_updated_at': NOW.isoformat(), 'revision': before['revision'] + 1})
        expected = deepcopy(before)
        expected['revision'] += 1
        for identity in ids:
            expected['devices'][identity]['device_updated_at'] = NOW.isoformat()
        self.assertEqual(obj.data, expected, 'No content, creation date, booking, link or other record is changed')

    async def test_explicit_mark_rejects_invalid_or_stale_selections_atomically(self):
        for ids in (None, 'd', [], ['d', 'd'], ['d', 'missing'], [42], [{}], ['d'] * 101):
            with self.subTest(ids=ids):
                obj = self.tracked()
                before = deepcopy(obj.data)
                with self.assertRaises(ValueError):
                    await self.call(obj, 'mark_devices_changed', device_ids=ids)
                self.assertEqual(obj.data, before)
        obj = self.tracked()
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.call(obj, 'mark_devices_changed', device_ids=['d'], revision=-1)
        self.assertEqual(obj.data, before)
        with self.assertRaisesRegex(ValueError, 'Zeitzone'):
            await self.call(obj, 'mark_devices_changed', when=datetime(2026, 11, 23, 12, 0), device_ids=['d'])
        self.assertEqual(obj.data, before)

    async def test_explicit_mark_commit_failure_does_not_publish_any_timestamp(self):
        obj = self.tracked()
        before = deepcopy(obj.data)
        async def fail(data):
            raise OSError('disk full')
        obj.commit = fail
        with self.assertRaises(OSError):
            await self.call(obj, 'mark_devices_changed', device_ids=['d'])
        self.assertEqual(obj.data, before)

    async def test_failed_save_does_not_publish_timestamp_or_content(self):
        obj = self.tracked()
        before = deepcopy(obj.data)
        async def fail(data):
            raise OSError('disk full')
        obj.commit = fail
        with self.assertRaises(OSError):
            await self.call(obj, 'save_device', value={'id': 'd', 'name': 'Nicht gespeichert'})
        self.assertEqual(obj.data, before)


class DeviceDuplication(DeviceChangeFixture, DirectoryTestCase):
    async def test_copy_is_independent_and_retry_is_idempotent_before_revision_check(self):
        obj = self.tracked()
        obj.data['devices']['d'].update(manufacturer='Example', model='Tracker', battery_type='CR2032',
                                       battery_quantity=1, serial='unique', ha_device_id='ha-original')
        obj.data['rules']['r'] = {'id': 'r', 'device_id': 'd', 'name': 'Wartung', 'kind': 'none'}
        obj.data['logs']['l'] = {'id': 'l', 'device_id': 'd', 'kind': 'maintenance', 'event_date': '2026-01-01'}
        original = deepcopy(obj.data)
        result = await self.call(obj, 'duplicate_device', id='d', operation_id='copy-op')
        copy = obj.data['devices'][result['id']]
        self.assertEqual(copy['name'], 'Lampe (Kopie)')
        self.assertEqual(copy['battery_type'], 'CR2032')
        self.assertEqual(copy['battery_quantity'], 1)
        self.assertEqual(copy['created_at'], NOW.isoformat())
        self.assertEqual(copy['device_updated_at'], NOW.isoformat())
        for field in ('serial', 'ha_device_id', 'related_devices'):
            self.assertNotIn(field, copy)
        self.assertEqual(obj.data['devices']['d'], original['devices']['d'])
        for collection in ('rules', 'logs', 'shopping', 'settings'):
            self.assertEqual(obj.data[collection], original[collection])
        before = deepcopy(obj.data)
        retry = await ns['execute'](obj, 'duplicate_device', {'id': 'd', 'operation_id': 'copy-op', 'revision': -1})
        self.assertEqual(retry['id'], result['id'])
        self.assertTrue(retry['already_saved'])
        self.assertEqual(obj.data, before)

    async def test_three_operations_create_exactly_three_uniquely_named_copies(self):
        obj = self.obj()
        ids = []
        for index in range(3):
            result = await self.call(obj, 'duplicate_device', id='d', operation_id='copy-' + str(index))
            ids.append(result['id'])
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(len(obj.data['devices']), 4)
        self.assertEqual([obj.data['devices'][identity]['name'] for identity in ids],
                         ['Lampe (Kopie)', 'Lampe (Kopie 2)', 'Lampe (Kopie 3)'])

    async def test_stale_invalid_missing_and_collision_requests_never_create_a_device(self):
        for payload in ({'revision': -1, 'operation_id': 'stale'}, {'operation_id': ''}, {'operation_id': None},
                        {'operation_id': True}, {'operation_id': 'x' * 129}, {'operation_id': 'bad', 'id': 'missing'},
                        {'operation_id': 'bad', 'value': {'ha_device_id': 'forbidden'}}):
            obj = self.obj()
            before = deepcopy(obj.data)
            with self.assertRaises(ValueError):
                await self.call(obj, 'duplicate_device', **{'id': 'd', **payload})
            self.assertEqual(obj.data, before)
        obj = self.obj()
        obj.data['operations']['used'] = 'not-a-device'
        before = deepcopy(obj.data)
        with self.assertRaises(ValueError):
            await self.call(obj, 'duplicate_device', id='d', operation_id='used')
        self.assertEqual(obj.data, before)

    async def test_failed_copy_commit_keeps_original_and_operation_table_unchanged(self):
        obj = self.obj()
        before = deepcopy(obj.data)
        async def fail(data):
            raise OSError('disk full')
        obj.commit = fail
        with self.assertRaises(OSError):
            await self.call(obj, 'duplicate_device', id='d', operation_id='copy-op')
        self.assertEqual(obj.data, before)
