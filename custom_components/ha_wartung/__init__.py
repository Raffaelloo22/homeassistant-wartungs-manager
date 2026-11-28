"""Local, versioned household maintenance directory for Home Assistant."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import timedelta
import json
import logging
import re
from pathlib import Path
from uuid import uuid4

import probatio as vol
from homeassistant.components import frontend, panel_custom, persistent_notification, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers import config_validation as cv
from .onboarding import capture_preview, apply_capture
from .materials import material_info, consume, return_event_stock
from .battery_edit import edit_battery_type
from .device_copy import build_device_copy
from .inventory_pdf import build_inventory_pdf
from .diagnostics import inspect_directory
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from . import engine

DEFAULT_DEVICE_CATEGORIES = engine.DEFAULT_DEVICE_CATEGORIES

DOMAIN = 'ha_wartung'
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
VERSION = '1.2.20'
_LOGGER = logging.getLogger(__name__)
STATUS = {'no_due':'Ohne Fälligkeit','planning':'Einplanen','overdue':'Überfällig','due':'Fällig',
          'soon':'Nächste sieben Tage','scheduled':'Geplant',
          'measurement_pending':'Messwert ausstehend','ok':'In Ordnung','archived':'Archiviert','on_demand':'Nach Geräteanzeige'}


def purge_device_image_files(folder):
    """Remove only generated device-photo files from the retired photo feature."""
    path = Path(folder)
    if not path.is_dir():
        return
    for file in path.iterdir():
        if file.is_file() and re.fullmatch(r'[a-f0-9]{32}\.jpg', file.name):
            file.unlink()
    if not any(path.iterdir()):
        path.rmdir()


def manual_sample(rule, value, now):
    if rule['kind'] != 'measurement':
        raise ValueError('Keine Messwertregel.')
    from math import isfinite
    number = float(value)
    if not isfinite(number):
        raise ValueError('Ungültiger Messwert.')
    return {'value':number, 'reported_at':now.isoformat(),
            'source_report_confirmed':True, 'source':'manual'}


def battery_type(value):
    return engine.normalize_battery_type(value)


def validate_material_device_ids(data, ids):
    if not isinstance(ids, list) or len(ids) > 1000 or any(not isinstance(i, str) or i not in data['devices'] for i in ids):
        raise ValueError('Bitte vorhandene Geräte für das Material auswählen.')
    if len(set(ids)) != len(ids):
        raise ValueError('Ein Gerät darf nur einmal zugeordnet werden.')
    return list(ids)


def select_devices(data, identities):
    """Validate a bounded explicit selection without reading other collections."""
    devices = data['devices']
    if (not isinstance(identities, list) or not 1 <= len(identities) <= 100
        or any(not isinstance(identity, str) or identity not in devices for identity in identities)
        or len(set(identities)) != len(identities)):
        raise ValueError('Bitte 1 bis 100 unterschiedliche vorhandene Geräte auswählen.')
    return {identity:devices[identity] for identity in identities}


def remove_disabled_battery_shopping(data):
    """Remove suppressed open automatic orders, retaining manual and paid orders."""
    disabled = set(data.get('settings', {}).get('battery_no_restock', []))
    booked = {target for target in data.get('operations', {}).values() if isinstance(target, str)}
    for identity, item in list(data['shopping'].items()):
        if item.get('battery_inventory_auto') and not item.get('done') and item.get('battery_type') in disabled:
            if identity in booked or any(isinstance(key, str) and key.startswith('purchased_') for key in item):
                item['done'] = True
            else:
                del data['shopping'][identity]


def sync_battery_shopping(data, previous):
    remove_disabled_battery_shopping(data)
    settings = data.get('settings', {})
    stocks = settings.get('battery_inventory', {})
    hidden = set(settings.get('battery_inventory_hidden_types', [])) | set(settings.get('battery_no_restock', []))
    old = previous.get('settings', {}).get('battery_inventory', {})
    shopping = data['shopping']
    for identity, item in list(shopping.items()):
        if item.get('battery_inventory_auto') and (item.get('battery_type') not in stocks or item.get('battery_type') in settings.get('battery_inventory_hidden_types', []) or re.search(r'fest.*verbaut', item.get('battery_type', ''), re.I)):
            del shopping[identity]
    for kind, quantity in stocks.items():
        if kind in hidden or re.search(r'fest.*verbaut', kind, re.I):
            continue
        identity = 'battery-stock:' + kind
        if quantity <= settings.get('battery_inventory_thresholds', {}).get(kind, 1):
            existing = shopping.get(identity, {})
            shopping[identity] = dict(existing, id=identity, name=f'Batterien {kind} nachkaufen',
                battery_inventory_auto=True, battery_type=kind, quantity_remaining=quantity,
                done=existing.get('done', False) if kind not in previous.get('settings', {}).get('battery_no_restock', []) and old.get(kind) == quantity and previous.get('settings', {}).get('battery_inventory_thresholds', {}).get(kind, 1) == settings.get('battery_inventory_thresholds', {}).get(kind, 1) else False)
        elif identity in shopping:
            shopping[identity].update(done=True, quantity_remaining=quantity)


def apply_ha_device_areas(data, registry):
    areas = {device['id']:device.get('area') for device in registry['devices']}
    for device in data.get('devices', {}).values():
        device['area'] = areas.get(device.get('ha_device_id'))
    return data


def delete_consumable(data, identity, now):
    settings = data.setdefault('settings', {})
    material = settings.get('consumables', {}).get(identity)
    if material is None:
        raise ValueError('Verbrauchsmaterial wurde nicht gefunden.')
    settings.setdefault('deleted_consumables', {})[identity] = dict(material, deleted_at=now.isoformat())
    del settings['consumables'][identity]
    for rule in data['rules'].values():
        link = rule.get('consumable')
        if link and link.get('kind') == 'material' and link.get('id') == identity:
            rule['consumable'] = None
        for step, link in rule.get('consumables_by_step', {}).items():
            if link and link.get('kind') == 'material' and link.get('id') == identity:
                rule['consumables_by_step'][step] = None
    for item in data['shopping'].values():
        if item.get('consumable_id') == identity and not item.get('done'):
            item.update(done=True, cancelled_at=now.isoformat(), cancelled_reason='Verbrauchsmaterial gelöscht')


def project_directory(data, payload):
    """Optional bounded reads for clients; the default response stays unchanged."""
    fields = payload.get('fields')
    if fields is not None and (not isinstance(fields, list) or not fields or any(not isinstance(key, str) or key not in data for key in fields)):
        raise ValueError('Ungültige Datenfeldauswahl.')
    query = payload.get('device_query')
    if query is not None:
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ValueError('Ungültige Gerätesuche.')
        term = query.strip().casefold()
        data = dict(data)
        data['devices'] = {identity:device for identity,device in data['devices'].items() if term in ' '.join(str(device.get(key) or '') for key in ('name','manufacturer','model','ha_device_id','source_ref','source_refs')).casefold()}
        for collection in ('rules','logs'):
            if collection in data:
                data[collection] = {identity:item for identity,item in data[collection].items() if item.get('device_id') in data['devices']}
    return data if fields is None else {key:data[key] for key in fields}


class Directory:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, DOMAIN, private=True, atomic_writes=True)
        self.rollback = Store(hass, 1, DOMAIN + '.rollback', private=True, atomic_writes=True)
        self.data = engine.blank()
        self.lock = asyncio.Lock()
        self.tick_lock = asyncio.Lock()

    async def load(self):
        saved = await self.store.async_load()
        if saved is not None:
            self.data = engine.validate_data(saved)
        self.data.setdefault('settings', {'enabled':False, 'weekday':0, 'time':'09:00'})
        self.data.setdefault('questions', [])
        self.data.setdefault('samples', {})
        cleaned = apply_ha_device_areas(engine.sanitize_directory(deepcopy(self.data)), self.registry(areas_only=True))
        remove_disabled_battery_shopping(cleaned)
        if cleaned != self.data:
            cleaned['revision'] += 1
            await self.store.async_save(cleaned)
            self.data = cleaned
        rollback = await self.rollback.async_load()
        if rollback is not None:
            cleaned_rollback = engine.sanitize_directory(deepcopy(rollback))
            if cleaned_rollback != rollback:
                await self.rollback.async_save(cleaned_rollback)

        await self.hass.async_add_executor_job(purge_device_image_files, self.hass.config.path('.storage', 'ha_wartung_images'))

    def sample(self, rule):
        manual = self.data.get('samples', {}).get(rule['id'])
        entity = er.async_get(self.hass).async_get(rule.get('sensor_registry_id',''))
        state = self.hass.states.get(entity.entity_id) if entity else None
        if state and state.attributes.get('restored') is not True:
            report = getattr(state, 'last_reported', None) or getattr(state, 'last_updated', None)
            if report and report.tzinfo:
                # This is an HA state report, not proof of a new physical measurement.
                live = {'value':state.state, 'reported_at':report.isoformat(),
                        'source':'home_assistant'}
                manual_report = dt_util.parse_datetime(manual.get('reported_at', '')) if manual else None
                if not manual_report or not manual_report.tzinfo or report > manual_report:
                    return live
        return manual

    def snapshot(self):
        now = dt_util.now()
        result = apply_ha_device_areas(deepcopy(self.data), self.registry(areas_only=True))
        result['trash'] = [{'id':d['id'],'name':d['name'],'deleted_at':d['deleted_at'],
                            **{field:d[field] for field in ('created_at', 'device_updated_at') if field in d}}
                           for d in result['devices'].values() if d.get('deleted_at')]
        result['devices'] = {k:d for k,d in result['devices'].items() if not d.get('deleted_at')}
        for collection in ('rules','logs'):
            result[collection] = {k:v for k,v in result[collection].items()
                                  if v['device_id'] in result['devices'] and not v.get('deleted_at')}
        views = []
        for rule in result['rules'].values():
            device = result['devices'][rule['device_id']]
            view = engine.view(rule, now.date(), now, self.sample(rule))
            if rule['kind'] == 'on_demand':
                view.update(engine.observed_interval(self.data,rule['id']))
            if device.get('archived') or device.get('archived_at') or device.get('in_storage'):
                view['status'] = 'archived'
            views.append(dict(view, name=view.get('task_name',rule['name']), device_id=device['id'],
                              device_name=device['name'], area=device.get('area'),
                              label=STATUS[view['status']]))
        today = now.date().isoformat()
        today_tasks = self.data.get('today_tasks', {})
        result.update(views=views, today=today,
                      today_tasks={'date':today, 'rule_ids':today_tasks.get('rule_ids', []) if today_tasks.get('date') == today else []},
                      timezone=self.hass.config.time_zone, currency=getattr(self.hass.config, 'currency', None) or 'CHF', version=VERSION, version_date='24.11.26')
        return result

    async def commit(self, new):
        engine.sanitize_directory(new)
        apply_ha_device_areas(new, self.registry(areas_only=True))
        engine.validate_data(new)
        # A recoverable previous version, then one durable atomic store write.
        await self.rollback.async_save(engine.sanitize_directory(deepcopy(self.data)))
        await self.store.async_save(new)
        self.data = new
        self.hass.bus.async_fire(DOMAIN + '_changed', {'revision':new['revision']})

    def registry(self, *, areas_only=False):
        areas = ar.async_get(self.hass)
        devices = list(dr.async_get(self.hass).devices.values())
        device_areas = {}
        for device in devices:
            area = areas.async_get_area(device.area_id) if device.area_id else None
            device_areas[device.id] = area.name if area else None
        if areas_only:
            return {'devices':[{'id':device.id, 'area':device_areas[device.id]} for device in devices]}
        entity_types, sensors = {}, []
        for entity in er.async_get(self.hass).entities.values():
            if not entity.disabled_by and entity.entity_category is None:
                entity_types.setdefault(entity.device_id, []).append({
                    'domain':entity.domain, 'device_class':entity.device_class or entity.original_device_class})
            if entity.domain == 'sensor':
                sensors.append({'id':entity.id, 'entity_id':entity.entity_id,
                    'name':entity.name or entity.original_name or entity.entity_id,
                    'device_id':entity.device_id, 'platform':entity.platform,
                    'disabled':bool(entity.disabled_by)})
        return {'devices':[{'id':device.id, 'name':device.name_by_user or device.name or device.id,
                'manufacturer':device.manufacturer, 'model':device.model,
                'area':device_areas[device.id], 'disabled':bool(device.disabled_by),
                'service':getattr(device.entry_type,'value',device.entry_type)=='service',
                'entity_types':entity_types.get(device.id, [])} for device in devices],
            'sensors':sensors, 'areas':[area.name for area in areas.async_list_areas()]}

    async def digest(self):
        snap = self.snapshot()
        rows = [v for v in snap['views'] if v['status'] in ('planning','overdue','due','soon','measurement_pending')]
        lines = [f"- **{v['device_name']} – {v['name']}**: {v['label']}"
                 + (f" (fällig {v['due']})" if v['due'] else '')
                 + (f"; Termin {v['booked']}" if v.get('booked') else '') for v in rows]
        shopping = [s['name'] for s in snap['shopping'].values() if not s.get('done')]
        if shopping:
            lines += ['', '**Nachkaufen:** ' + ', '.join(shopping)]
        persistent_notification.async_create(self.hass,
            '\n'.join(lines) if lines else 'Keine offenen Wartungsaufgaben.',
            title='Wartungsverzeichnis', notification_id=DOMAIN + '_weekly')
        return {'tasks':len(rows),'shopping':len(shopping)}

    async def tick(self, _now):
        if self.tick_lock.locked():
            return
        async with self.tick_lock:
            now = dt_util.now()
            settings = self.data.get('settings', {})
            period = engine.notification_due_period(settings, now)
            if period and settings.get(period[0]) != period[1]:
                await self.digest()
                async with self.lock:
                    new = deepcopy(self.data)
                    new['settings'][period[0]] = period[1]
                    new['revision'] += 1
                    await self.commit(new)

    def check_revision(self, payload):
        if payload.get('revision') != self.data['revision']:
            raise ValueError('Zwischenzeitlich geändert. Bitte Ansicht aktualisieren.')

    def validate_registry_links(self, data):
        devices = dr.async_get(self.hass)
        entities = er.async_get(self.hass)
        for d in data['devices'].values():
            if d.get('deleted_at'):
                continue
            if (d.get('ha_device_id') and devices.async_get(d['ha_device_id']) is None
                and self.data['devices'].get(d['id'],{}).get('ha_device_id') != d['ha_device_id']):
                raise ValueError('Das ausgewählte HA-Gerät existiert nicht.')
        for rule in data['rules'].values():
            if rule.get('deleted_at'):
                continue
            if data['devices'][rule['device_id']].get('deleted_at'):
                continue
            if rule['kind'] != 'measurement':
                continue
            e = entities.async_get(rule['sensor_registry_id'])
            if e is None:
                previous = self.data['rules'].get(rule['id'],{})
                if previous.get('sensor_registry_id') == rule['sensor_registry_id']:
                    continue  # Preserve history and allow edits after registry loss.
                raise ValueError('Sensorzuordnung ist ungültig.')
            if e.domain != 'sensor':
                raise ValueError('Sensorzuordnung ist ungültig.')
            d = data['devices'][rule['device_id']]
            if d.get('ha_device_id') and e.device_id != d['ha_device_id']:
                raise ValueError('Der Sensor gehört nicht zum ausgewählten HA-Gerät.')

    async def execute(self, action, p):
        if action == 'get_devices':
            selected = select_devices(self.data, p.get('device_ids'))
            return dict(devices=deepcopy(selected), revision=self.data['revision'],
                        today=dt_util.now().date().isoformat(), timezone=self.hass.config.time_zone)
        if action == 'inventory_pdf':
            return await self.hass.async_add_executor_job(build_inventory_pdf, p, dt_util.now())
        if action == 'get':
            return project_directory(self.snapshot(), p)
        if action == 'registry':
            return self.registry()
        if action == 'diagnose':
            return dict(inspect_directory(self.data, self.registry()), revision=self.data['revision'])
        if action == 'initial_capture_preview':
            return capture_preview(self.data, self.registry(), p.get('types'))
        if action == 'export':
            return project_directory(deepcopy(self.data), p)
        if action == 'test_digest':
            return await self.digest()
        if action in ('import_seed_preview','import_seed'):
            path = Path(__file__).with_name('seed.json')
            raw = await self.hass.async_add_executor_job(path.read_text)
            seed = json.loads(raw)
            if action == 'import_seed_preview':
                proposed, counts = engine.import_new(self.data, seed['records'])
                engine.validate_data(proposed)
                return dict(counts=counts, questions=seed.get('review',[]),
                            records=seed['records'], revision=self.data['revision'])
            p = dict(p, records=seed['records'], questions=seed.get('review',[]))
            action = 'import'
        async with self.lock:
            if action == 'duplicate_device':
                operation = p.get('operation_id')
                if not isinstance(operation, str) or not operation.strip() or len(operation) > 128:
                    raise ValueError('Buchungskennung fehlt.')
                if operation in self.data['operations']:
                    identity = self.data['operations'][operation]
                    if not isinstance(identity, str) or identity not in self.data['devices']:
                        raise ValueError('Diese Buchungskennung wurde bereits verwendet oder die Kopie endgültig entfernt.')
                    return {'id':identity, 'name':self.data['devices'][identity]['name'], 'already_saved':True, 'revision':self.data['revision']}
            if action in ('complete', 'battery_replacement', 'battery_purchase', 'consumable_purchase') and p.get('operation_id') in self.data['operations']:
                return {'id':self.data['operations'][p['operation_id']], 'already_saved':True}
            if action == 'undo_completion' and self.data['logs'].get(p.get('id'), {}).get('undone_at'):
                return {'id':p['id'], 'already_undone':True}
            self.check_revision(p)
            new = deepcopy(self.data)
            result = {}
            material_movement = None
            now = dt_util.now()
            target = p.get('rule_id')
            device_id = new['rules'].get(target,{}).get('device_id')
            if action == 'delete_rule':
                device_id = new['rules'].get(p.get('id'),{}).get('device_id')
            if action in ('edit_log','delete_log','undo_completion'):
                device_id = new['logs'].get(p.get('id'),{}).get('device_id')
            if action in ('save_rule','add_log','battery_replacement'):
                device_id = p.get('value',{}).get('device_id')
            if action in ('save_device','archive_device','replace_device'):
                device_id = p.get('id') or p.get('value',{}).get('id')
            if device_id and new['devices'].get(device_id,{}).get('deleted_at'):
                raise ValueError('Gerät ist im Papierkorb. Zuerst wiederherstellen.')
            if action == 'mark_devices_changed':
                selected = select_devices(new, p.get('device_ids'))
                if now.tzinfo is None or now.utcoffset() is None:
                    raise ValueError('Geräteänderungszeitpunkt benötigt eine Zeitzone.')
                timestamp = now.isoformat()
                for device in selected.values():
                    device['device_updated_at'] = timestamp
                result.update(updated=len(selected), device_updated_at=timestamp)
            elif action == 'set_today_tasks':
                rule_ids = p.get('rule_ids')
                if not isinstance(rule_ids, list) or len(rule_ids) > 500 or any(not isinstance(identity, str) or not identity for identity in rule_ids):
                    raise ValueError('Ungültige Auswahl für Heute erledigen.')
                if p.get('date') != now.date().isoformat():
                    raise ValueError('Der Tag hat gewechselt. Bitte die Tagesauswahl aktualisieren.')
                allowed = {identity for identity, rule in new['rules'].items() if not rule.get('deleted_at')}
                allowed.update('battery:' + identity for identity, device in new['devices'].items() if not device.get('deleted_at') and not device.get('in_storage') and not device.get('archived') and not device.get('archived_at') and (device.get('battery_type') or device.get('battery_entity_id')) and device.get('battery_alert_enabled') is not False)
                if any(identity not in allowed for identity in rule_ids):
                    raise ValueError('Die Auswahl enthält eine nicht mehr verfügbare Aufgabe.')
                new['today_tasks'] = {'date':now.date().isoformat(), 'rule_ids':list(dict.fromkeys(rule_ids))}
            elif action == 'preferences':
                value = p.get('value', {})
                if not isinstance(value, dict):
                    raise ValueError('Ungültige allgemeine Einstellungen.')
                settings = new.setdefault('settings', {})
                for key in ('currency', 'battery_threshold_entity', 'language'):
                    if key in value:
                        settings[key] = value[key]
                if 'language' in value and value['language'] not in ('de', 'en', 'fr'):
                    raise ValueError('Bitte Deutsch, Englisch oder Französisch auswählen.')
                engine.validate_data(new)
            elif action == 'save_event_type':
                result['id'] = engine.save_event_type(new, p.get('id'), p.get('name'))
            elif action == 'save_event_type_order':
                engine.save_event_type_order(new, p.get('order'))
            elif action == 'delete_event_type':
                engine.delete_event_type(new, p.get('id'), p.get('confirmed'))
            elif action == 'initial_capture_commit':
                result = apply_capture(new, self.registry(), p.get('types'), p.get('device_ids'), p.get('confirmed'), now)
            elif action in ('purge_trash', 'purge_trash_device'):
                if p.get('confirmed') is not True:
                    raise ValueError('Endgültiges Leeren muss bestätigt werden.')
                deleted = {identity for identity, device in new['devices'].items() if device.get('deleted_at')}
                if action == 'purge_trash_device':
                    if p.get('id') not in deleted:
                        raise ValueError('Gerät ist nicht im Papierkorb.')
                    deleted = {p['id']}
                rule_ids = {identity for identity, rule in new['rules'].items() if rule.get('device_id') in deleted}
                log_ids = {identity for identity, log in new['logs'].items() if log.get('device_id') in deleted}
                for identity in deleted:
                    del new['devices'][identity]
                for identity in rule_ids:
                    del new['rules'][identity]
                    new.get('samples', {}).pop(identity, None)
                for identity in log_ids:
                    del new['logs'][identity]
                new['operations'] = {key:value for key,value in new['operations'].items() if value not in log_ids}
                for device in new['devices'].values():
                    for key in ('predecessor_id', 'successor_id', 'controller_device_id'):
                        if device.get(key) in deleted:
                            device.pop(key, None)
                    if 'related_devices' in device:
                        device['related_devices'] = [link for link in device['related_devices'] if link.get('id') not in deleted]
                    if 'controlled_device_ids' in device:
                        device['controlled_device_ids'] = [identity for identity in device['controlled_device_ids'] if identity not in deleted]
                for material in new.get('settings', {}).get('consumables', {}).values():
                    if 'device_ids' in material:
                        material['device_ids'] = [i for i in material['device_ids'] if i not in deleted]
                for kind, ids in new.get('settings', {}).get('battery_device_links', {}).items():
                    new['settings']['battery_device_links'][kind] = [i for i in ids if i not in deleted]
                # Keep source-import tombstones so removed source records are not silently reimported.
                result.update(purged_devices=len(deleted), purged_rules=len(rule_ids), purged_logs=len(log_ids))
            elif action == 'delete_device':
                if p.get('confirmed') is not True:
                    raise ValueError('Löschen muss bestätigt werden.')
                new = engine.delete_device(new,p['id'],now.isoformat())
            elif action == 'delete_rule':
                if p.get('confirmed') is not True:
                    raise ValueError('Löschen muss bestätigt werden.')
                new = engine.delete_rule(new,p['id'],now)
                result['id'] = p['id']
            elif action == 'delete_log':
                if p.get('confirmed') is not True:
                    raise ValueError('Löschen muss bestätigt werden.')
                event = new['logs'].get(p['id'], {})
                new = engine.delete_log(new,p['id'],now)
                movement, material_movement = return_event_stock(new, event)
                result['id'] = p['id']
            elif action == 'undo_completion':
                event = new['logs'].get(p.get('id'))
                if event is None or event.get('deleted_at') or event.get('edited_at'):
                    raise ValueError('Diese Erledigung kann nicht mehr direkt rückgängig gemacht werden.')
                device = new['devices'][event['device_id']]
                if device.get('archived') or device.get('archived_at'):
                    raise ValueError('Gerät ist archiviert. Zuerst wieder aktivieren.')
                sample = event.get('completion_sample')
                if sample and new.get('samples', {}).get(event.get('rule_id')) != sample['after']:
                    raise ValueError('Der Messwert wurde inzwischen geändert. Rücknahme nicht möglich.')
                if event.get('completion_state'):
                    new = engine.undo_completion(new, p['id'], now)
                elif event.get('battery_stock_movement') and new['operations'].get(event.get('operation_id')) == p['id']:
                    new = engine.delete_log(new, p['id'], now)
                    new['logs'][p['id']]['undone_at'] = now.isoformat()
                else:
                    raise ValueError('Für diesen Eintrag ist keine direkte Rücknahme verfügbar.')
                if sample:
                    samples = new.setdefault('samples', {})
                    if sample['before'] is None:
                        samples.pop(event['rule_id'], None)
                    else:
                        samples[event['rule_id']] = deepcopy(sample['before'])
                movement, material_movement = return_event_stock(new, event)
                for identity, item in list(new['shopping'].items()):
                    if item.get('log_id') == p['id']:
                        del new['shopping'][identity]
                result['id'] = p['id']
            elif action == 'normalize_battery_devices':
                changed = 0
                for device in new['devices'].values():
                    if device.get('deleted_at') or not device.get('battery_type'):
                        continue
                    original = device['battery_type']
                    match = re.match(r'^(\d+)\s*[×x]\s*', original.strip())
                    quantity = device.get('battery_quantity')
                    if quantity is None:
                        quantity = int(match.group(1)) if match else 1
                    if type(quantity) is not int or not 1 <= quantity <= 1000:
                        raise ValueError('Batterieanzahl muss zwischen 1 und 1000 liegen.')
                    normalized = battery_type(original)
                    if normalized != original or device.get('battery_quantity') != quantity:
                        if normalized != original:
                            device.setdefault('battery_description', original)
                        device.update(battery_type=normalized, battery_quantity=quantity)
                        changed += 1
                result['updated_devices'] = changed
            elif action == 'battery_replacement':
                value = p.get('value', {})
                device = new['devices'].get(value.get('device_id'))
                if device is None:
                    raise ValueError('Gerät wurde nicht gefunden.')
                identity = p.get('operation_id')
                if not isinstance(identity, str) or not identity.strip() or len(identity) > 128:
                    raise ValueError('Buchungskennung fehlt.')
                kind = battery_type(value.get('battery_type') or device.get('battery_type'))
                quantity = value.get('battery_quantity', device.get('battery_quantity', 1))
                if type(quantity) is not int or not 1 <= quantity <= 1000:
                    raise ValueError('Batterieanzahl muss eine ganze Zahl zwischen 1 und 1000 sein.')
                stocks = new.setdefault('settings', {}).setdefault('battery_inventory', {})
                hidden = new.get('settings', {}).get('battery_inventory_hidden_types', [])
                if not kind or re.search(r'fest.*verbaut', kind, re.I) or kind in hidden:
                    raise ValueError('Bitte einen Batterietyp aus dem Batterie-Inventar wählen.')
                if kind not in stocks:
                    known = any(battery_type(d.get('battery_type')) == kind and not d.get('deleted_at') and not d.get('archived') for d in new['devices'].values())
                    if not known:
                        raise ValueError('Bitte einen Batterietyp aus dem Batterie-Inventar wählen.')
                    stocks[kind] = 1
                event_date = value.get('event_date') or now.date().isoformat()
                actual = engine.parse_date(event_date)
                if actual > now.date():
                    raise ValueError('Batteriewechsel darf nicht in der Zukunft liegen.')
                cost = value.get('cost')
                if cost is not None:
                    from math import isfinite
                    if type(cost) not in (int, float) or not isfinite(cost) or cost < 0:
                        raise ValueError('Ungültige Kosten.')
                log_id = str(uuid4())
                before = stocks[kind]
                stocks[kind] = before - quantity
                new['logs'][log_id] = dict(id=log_id, device_id=device['id'], kind='maintenance',
                    event_date=event_date, note=value.get('note') or f'Batterien gewechselt ({quantity} × {kind}).',
                    cost=cost, recorded_at=now.isoformat(), operation_id=identity,
                    battery_stock_movement=dict(type=kind, quantity=quantity, before=before, after=stocks[kind]))
                new['operations'][identity] = log_id
                result.update(id=log_id, battery_type=kind, quantity=quantity, stock=stocks[kind])
            elif action == 'edit_log':
                new = engine.edit_log(new,p['id'],p['value'],now)
                result['id'] = p['id']
            elif action == 'restore_device':
                new = engine.restore_device(new,p['id'])
            elif action == 'duplicate_device':
                value = build_device_copy(new, p.get('id'), p.get('value'))
                new['devices'][value['id']] = value
                new['operations'][p['operation_id']] = value['id']
                result.update(id=value['id'], name=value['name'])
            elif action in ('save_device','save_rule','add_log','save_shopping'):
                collection = {'save_device':'devices','save_rule':'rules','add_log':'logs','save_shopping':'shopping'}[action]
                value = dict(p['value'])
                if collection == 'devices':
                    for field in ('created_at', 'device_updated_at'):
                        value.pop(field, None)
                identity = value.get('id') or str(uuid4())
                existing = new[collection].get(identity,{})
                value = {**existing, **value, 'id':identity}
                if collection == 'shopping' and value.get('battery_inventory_auto') and value.get('battery_type') in new.get('settings', {}).get('battery_no_restock', []):
                    raise ValueError('Für diesen Batterietyp ist Nachkaufen deaktiviert.')
                if collection == 'shopping' and 'notes' in p['value']:
                    notes = p['value']['notes']
                    if not isinstance(notes, str) or len(notes) > 20000:
                        raise ValueError('Notizen müssen Text mit höchstens 20000 Zeichen sein.')
                    if value.get('battery_type'):
                        kind = value['battery_type']
                        if kind not in new.get('settings', {}).get('battery_inventory', {}):
                            raise ValueError('Batterietyp ist nicht mehr im Inventar.')
                        new['settings'].setdefault('battery_notes', {})[kind] = notes
                        value.pop('notes', None)
                    elif value.get('consumable_id'):
                        material = new.get('settings', {}).get('consumables', {}).get(value['consumable_id'])
                        if not material:
                            raise ValueError('Verbrauchsmaterial wurde nicht gefunden.')
                        material['notes'] = notes
                        value.pop('notes', None)
                if collection == 'devices':
                    if 'info_url' in value:
                        value['info_url'] = engine.normalize_shop_url(value['info_url'])
                    status = value.pop('device_status', None)
                    if status is not None:
                        if status not in ('active', 'storage', 'archive', 'trash'):
                            raise ValueError('Bitte einen gültigen Gerätestatus auswählen.')
                        if status == 'trash':
                            if not existing:
                                raise ValueError('Ein neues Gerät kann nicht direkt im Papierkorb angelegt werden.')
                            value.update(deleted_at=now.isoformat(), **{key:existing.get(key) for key in ('in_storage', 'archived', 'archived_at')})
                        else:
                            value.update(in_storage=status == 'storage', archived=status == 'archive', archived_at=(existing.get('archived_at') or now.date().isoformat()) if status == 'archive' else None)
                    value.pop('incoming_devices', None)
                    if not str(value.get('name','')).strip():
                        raise ValueError('Gerätename ist erforderlich.')
                    quantity = value.get('battery_quantity')
                    if quantity is not None and (type(quantity) is not int or not 1 <= quantity <= 1000):
                        raise ValueError('Batterieanzahl muss eine ganze Zahl zwischen 1 und 1000 sein.')
                    if 'related_devices' in p['value']:
                        links = value['related_devices']
                        if not isinstance(links, list) or len(links) > 1000:
                            raise ValueError('Ungültige Geräteverknüpfungen.')
                        ids = []
                        for link in links:
                            if not isinstance(link, dict) or link.get('id') == identity:
                                raise ValueError('Ungültige Geräteverknüpfung.')
                            ids.append(link.get('id'))
                        validate_material_device_ids(new, ids)
                        # One undirected edge is sufficient; replace all edges touching this device.
                        for other in new['devices'].values():
                            if not other.get('deleted_at') and other['id'] != identity and any(link.get('id') == identity for link in other.get('related_devices', [])):
                                other['related_devices'] = [link for link in other['related_devices'] if link.get('id') != identity]
                        value['related_devices'] = [{'id':linked} for linked in ids]
                elif collection == 'rules':
                    if existing.get('deleted_at'):
                        raise ValueError('Aufgabe wurde gelöscht. Bitte Ansicht aktualisieren.')
                    engine.validate_rule(value)
                    for link in [value.get('consumable'), *value.get('consumables_by_step', {}).values()]:
                        if link:
                            material_info(new, dict(value, consumable=link, consumables_by_step={}))
                    if value['kind'] == 'none':
                        value['booked'] = None
                    if value['kind'] == 'season':
                        value.setdefault('first_cycle',now.year)
                    # Completion provenance is managed only by complete(), never by forms.
                    for k in ('last_completed','completed_cycles','awaiting_since','rotation_step','completed_due_date'):
                        if k in existing:
                            value[k] = existing[k]
                        else:
                            value.pop(k,None)
                    if value['kind'] == 'season' and existing.get('kind') != 'season':
                        cycles = set(existing.get('completed_cycles', []))
                        for log in new['logs'].values():
                            if (log.get('rule_id') == identity and log.get('kind') == 'maintenance'
                                and log.get('event_date') and not log.get('deleted_at')):
                                cycle = engine.parse_date(log['event_date']).year
                                log['cycle'] = cycle
                                cycles.add(cycle)
                        if existing.get('last_completed'):
                            cycles.add(engine.parse_date(existing['last_completed']).year)
                        value['completed_cycles'] = sorted(cycles)
                elif collection == 'logs':
                    if value.get('kind') not in engine.event_types(new) or value.get('kind') in new.get('settings', {}).get('hidden_event_types', []):
                        raise ValueError('Bitte eine verfügbare Ereignisart auswählen.')
                    if existing.get('battery_stock_movement') or existing.get('material_stock_movement'):
                        raise ValueError('Batteriewechsel bitte über Historie bearbeiten ändern.')
                    value.pop('battery_stock_movement', None)
                    value.pop('material_stock_movement', None)
                    value['recorded_at'] = now.isoformat()
                    if value.get('event_date') and engine.parse_date(value['event_date']) > now.date():
                        raise ValueError('Historieneintrag darf nicht in der Zukunft liegen.')
                elif not str(value.get('name','')).strip():
                    raise ValueError('Bezeichnung ist erforderlich.')
                new[collection][identity] = value
                if collection == 'logs':
                    engine.fill_purchase_date(new, value)
                result['id'] = identity
            elif action == 'complete':
                completed_rule = deepcopy(new['rules'][p['rule_id']])
                new, identity = engine.complete(new,p['rule_id'],
                    event_date=p.get('event_date') or now.date().isoformat(), now=now,
                    operation_id=p['operation_id'],expected_revision=p['revision'],
                    note=p.get('note',''),cost=p.get('cost'),shopping=p.get('shopping'),cycle=p.get('cycle'))
                if type(p.get('consume_material', False)) is not bool:
                    raise ValueError('Bitte den Bestandsabzug ausdrücklich bestätigen.')
                if p.get('consume_material'):
                    material_movement = consume(new, completed_rule, identity)
                if 'measurement' in p:
                    samples = new.setdefault('samples', {})
                    sample = manual_sample(completed_rule, p['measurement'], now)
                    new['logs'][identity]['completion_sample'] = {'before':deepcopy(samples.get(p['rule_id'])), 'after':deepcopy(sample)}
                    samples[p['rule_id']] = sample
                result['id'] = identity
            elif action == 'link_history':
                new = engine.link_history(new,p['rule_id'],p['log_id'],now=now)
            elif action == 'archive_device':
                when = p.get('date') or now.date().isoformat()
                if engine.parse_date(when) > now.date():
                    raise ValueError('Archivdatum darf nicht in der Zukunft liegen.')
                new['devices'][p['id']].update(archived=True,archived_at=when)
            elif action == 'replace_device':
                when = p.get('date') or now.date().isoformat()
                if engine.parse_date(when) > now.date():
                    raise ValueError('Austauschdatum darf nicht in der Zukunft liegen.')
                new, identity = engine.replace_device(new,p['id'],p['value'],when,p.get('rule_ids'))
                result['id'] = identity
            elif action == 'measurement':
                rule = new['rules'][p['rule_id']]
                new.setdefault('samples',{})[rule['id']] = manual_sample(rule, p['value'], now)
            elif action == 'delete_category':
                if p.get('confirmed') is not True:
                    raise ValueError('Kategorie löschen muss bestätigt werden.')
                name = p.get('name')
                settings = new.setdefault('settings', {})
                categories = list(settings.get('device_categories', DEFAULT_DEVICE_CATEGORIES))
                if name not in categories:
                    raise ValueError('Kategorie wurde nicht gefunden.')
                affected = p.get('device_ids', [])
                if not isinstance(affected, list) or any(not isinstance(i, str) or i not in new['devices'] for i in affected):
                    raise ValueError('Ungültige Gerätezuordnung.')
                aliases = dict(settings.get('category_aliases', {}))
                def resolved(value):
                    seen = set()
                    while value in aliases and value not in seen:
                        seen.add(value)
                        value = aliases[value]
                    return value
                for device in new['devices'].values():
                    if device['id'] in affected or resolved(device.get('category')) == name:
                        device['category'] = 'Ohne Kategorie'
                for alias in list(aliases):
                    if resolved(alias) == name:
                        aliases[alias] = 'Ohne Kategorie'
                aliases[name] = 'Ohne Kategorie'
                settings['category_aliases'] = aliases
                settings['device_categories'] = [c for c in categories if c != name]
            elif action == 'save_categories':
                categories = p.get('categories')
                if not isinstance(categories, list) or not 1 <= len(categories) <= 100:
                    raise ValueError('Mindestens eine und höchstens 100 Kategorien sind erlaubt.')
                if any(not isinstance(name, str) or not name.strip() or name != name.strip() or len(name) > 80 for name in categories):
                    raise ValueError('Kategorienamen müssen 1 bis 80 Zeichen lang sein.')
                if len({name.casefold() for name in categories}) != len(categories):
                    raise ValueError('Kategorienamen müssen eindeutig sein.')
                settings = new.setdefault('settings', {})
                existing = settings.get('device_categories', DEFAULT_DEVICE_CATEGORIES)
                rename = p.get('rename')
                if rename:
                    if not isinstance(rename, dict):
                        raise ValueError('Ungültige Umbenennung.')
                    old_name, new_name = rename.get('from'), rename.get('to')
                    if old_name not in existing or new_name not in categories:
                        raise ValueError('Kategorie wurde zwischenzeitlich geändert.')
                    expected = [new_name if name == old_name else name for name in existing]
                    if set(expected) != set(categories) or len(expected) != len(categories):
                        raise ValueError('Beim Umbenennen dürfen keine Kategorien verloren gehen.')
                    aliases = dict(settings.get('category_aliases', {}))
                    aliases = {key:new_name if value == old_name else value for key,value in aliases.items()}
                    aliases[old_name] = new_name
                    settings['category_aliases'] = {key:value for key,value in aliases.items() if key != value}
                    for device in new['devices'].values():
                        if device.get('category') == old_name:
                            device['category'] = new_name
                elif not set(existing).issubset(categories):
                    raise ValueError('Bestehende Kategorien dürfen nicht entfernt werden. Bitte umbenennen oder umsortieren.')
                for added in set(categories) - set(existing):
                    settings.setdefault('category_aliases', {}).pop(added, None)
                settings['device_categories'] = list(categories)
            elif action == 'delete_consumable':
                if p.get('confirmed') is not True:
                    raise ValueError('Löschen muss bestätigt werden.')
                delete_consumable(new, p.get('id'), now)
                result['id'] = p['id']
            elif action == 'save_consumable':
                value = dict(p.get('value', {}))
                identity = value.get('id')
                if not isinstance(identity, str) or not identity or len(identity) > 128:
                    raise ValueError('Materialkennung fehlt.')
                if not isinstance(value.get('name'), str) or not value['name'].strip() or len(value['name']) > 160:
                    raise ValueError('Bitte eine Bezeichnung angeben.')
                if not isinstance(value.get('unit'), str) or not value['unit'].strip() or len(value['unit']) > 40:
                    raise ValueError('Bitte eine Einheit angeben.')
                for key in ('quantity', 'threshold'):
                    number = value.get(key)
                    if key == 'quantity' and number is None:
                        continue
                    minimum = -100000 if key == 'quantity' else 0
                    if type(number) not in (int, float) or not minimum <= number <= 100000:
                        raise ValueError('Bestand muss zwischen -100000 und 100000 und Nachkaufgrenze zwischen 0 und 100000 liegen.')
                materials = new.setdefault('settings', {}).setdefault('consumables', {})
                notes = value.get('notes', materials.get(identity, {}).get('notes', ''))
                if not isinstance(notes, str) or len(notes) > 20000:
                    raise ValueError('Notizen müssen Text mit höchstens 20000 Zeichen sein.')
                ids = validate_material_device_ids(new, value.get('device_ids', materials.get(identity, {}).get('device_ids', [])))
                shop_url = engine.normalize_shop_url(value.get('shop_url', materials.get(identity, {}).get('shop_url', '')))
                materials[identity] = {k:value[k] for k in ('id','name','unit','quantity','threshold')}
                materials[identity]['device_ids'] = ids
                materials[identity]['notes'] = notes
                if shop_url:
                    materials[identity]['shop_url'] = shop_url
                result['id'] = identity
            elif action == 'consumable_purchase':
                item = new['shopping'].get(p.get('id'), {})
                material = new.get('settings', {}).get('consumables', {}).get(item.get('consumable_id'))
                identity, quantity = p.get('operation_id'), p.get('quantity')
                if not material:
                    raise ValueError('Verbrauchsmaterial wurde nicht gefunden.')
                if not isinstance(identity, str) or not identity or len(identity) > 128:
                    raise ValueError('Buchungskennung fehlt.')
                if type(quantity) not in (int, float) or not 0 < quantity <= 100000:
                    raise ValueError('Bitte eine positive Nachkaufmenge angeben.')
                total = (material['quantity'] or 0) + quantity
                if total > 100000:
                    raise ValueError('Der Gesamtbestand darf 100000 nicht überschreiten.')
                material['quantity'] = total
                new['operations'][identity] = item['id']
                result['id'] = item['id']
            elif action == 'battery_purchase':
                item = new['shopping'].get(p.get('id'))
                if not item or not item.get('battery_type'):
                    raise ValueError('Batterie-Nachkauf wurde nicht gefunden.')
                identity = p.get('operation_id')
                quantity = p.get('quantity')
                if not isinstance(identity, str) or not identity.strip() or len(identity) > 128:
                    raise ValueError('Buchungskennung fehlt.')
                if type(quantity) is not int or not 1 <= quantity <= 100000:
                    raise ValueError('Bitte eine Stückzahl zwischen 1 und 100000 eingeben.')
                stocks = new.setdefault('settings', {}).setdefault('battery_inventory', {})
                kind = item['battery_type']
                if kind not in stocks:
                    raise ValueError('Batterietyp ist nicht mehr im Inventar.')
                total = stocks[kind] + quantity
                if total > 100000:
                    raise ValueError('Der Gesamtbestand darf 100000 nicht überschreiten.')
                stocks[kind] = total
                item.update(done=True, purchased_quantity=quantity, purchased_at=now.isoformat())
                new['operations'][identity] = item['id']
                result['id'] = item['id']
            elif action == 'edit_battery_type':
                result = edit_battery_type(new, p.get('type'), p.get('new_type'), p.get('quantity'), p.get('device_ids', []), battery_type, validate_material_device_ids, p.get('threshold'), p.get('notes'), **({'shop_url':p['shop_url']} if 'shop_url' in p else {}), **({'no_restock':p['no_restock']} if 'no_restock' in p else {}), **({'rechargeable':p['rechargeable']} if 'rechargeable' in p else {}))
            elif action == 'battery_inventory':
                stocks = p.get('stocks', {})
                removed = p.get('remove_types', [])
                device_links = p.get('device_links', {})
                thresholds = p.get('thresholds', {})
                notes = p.get('notes', {})
                shop_urls = p.get('shop_urls', {})
                no_restock = p.get('no_restock', {})
                if not isinstance(no_restock, dict) or len(no_restock) > 100 or any(type(value) is not bool for value in no_restock.values()):
                    raise ValueError('Ungültige Nachkaufeinstellungen für Batterien.')
                if not isinstance(shop_urls, dict) or len(shop_urls) > 100:
                    raise ValueError('Ungültige Batterie-Shop-Links.')
                if not isinstance(notes, dict) or len(notes) > 100 or any(not isinstance(text, str) or len(text) > 20000 for text in notes.values()):
                    raise ValueError('Ungültige Batterie-Notizen.')
                rechargeable = p.get('rechargeable', {})
                if not isinstance(rechargeable, dict) or len(rechargeable) > 100 or any(type(value) is not bool for value in rechargeable.values()):
                    raise ValueError('Ungültige Akku-Einstellungen für Batterien.')
                if not isinstance(stocks, dict) or len(stocks) > 100 or not isinstance(removed, list) or len(removed) > 100 or not isinstance(device_links, dict) or len(device_links) > 100 or not isinstance(thresholds, dict) or len(thresholds) > 100 or not (stocks or removed or device_links or thresholds or notes or shop_urls or no_restock or rechargeable):
                    raise ValueError('Batterietypen und Bestände fehlen.')
                for kind in [*stocks, *removed, *device_links, *thresholds, *notes, *shop_urls, *no_restock, *rechargeable]:
                    if not isinstance(kind, str) or not kind.strip() or len(kind) > 160:
                        raise ValueError('Ungültiger Batterietyp.')
                for quantity in stocks.values():
                    if type(quantity) is not int or not -100000 <= quantity <= 100000:
                        raise ValueError('Bestand muss eine ganze Zahl zwischen -100000 und 100000 sein.')
                settings = new.setdefault('settings', {})
                updated = dict(settings.get('battery_inventory', {}), **stocks)
                for kind in removed:
                    updated.pop(kind, None)
                for kind, threshold in thresholds.items():
                    if kind not in updated or type(threshold) is not int or not 0 <= threshold <= 100000:
                        raise ValueError('Bitte eine gültige Nachkauf-Schwelle für einen vorhandenen Batterietyp eingeben.')
                settings['battery_inventory_thresholds'] = {kind:value for kind,value in dict(settings.get('battery_inventory_thresholds', {}), **thresholds).items() if kind not in removed}
                settings['battery_inventory'] = updated
                if 'no_restock' in p or 'battery_no_restock' in settings:
                    disabled = set(settings.get('battery_no_restock', [])) - set(removed)
                    for kind, suppress in no_restock.items():
                        if kind not in updated:
                            raise ValueError('Batterietyp für die Nachkaufeinstellung wurde nicht gefunden.')
                        if suppress:
                            disabled.add(kind)
                        else:
                            disabled.discard(kind)
                    settings['battery_no_restock'] = sorted(disabled)
                rechargeable_types=set(settings.get('battery_rechargeable_types', [])) - set(removed)
                for kind, is_rechargeable in rechargeable.items():
                    if kind not in updated:
                        raise ValueError('Batterietyp für die Akku-Einstellung wurde nicht gefunden.')
                    if is_rechargeable:
                        rechargeable_types.add(kind)
                    else:
                        rechargeable_types.discard(kind)
                if 'rechargeable' in p or 'battery_rechargeable_types' in settings:
                    settings['battery_rechargeable_types'] = sorted(rechargeable_types)
                if any(kind not in updated for kind in notes):
                    raise ValueError('Batterietyp für Notizen wurde nicht gefunden.')
                settings['battery_notes'] = {kind:text for kind,text in dict(settings.get('battery_notes', {}), **notes).items() if kind not in removed}
                if 'shop_urls' in p or 'battery_shop_urls' in settings:
                    urls = dict(settings.get('battery_shop_urls', {}))
                    for kind, value in shop_urls.items():
                        if kind not in updated:
                            raise ValueError('Batterietyp für den Shop-Link wurde nicht gefunden.')
                        url = engine.normalize_shop_url(value)
                        if url:
                            urls[kind] = url
                        else:
                            urls.pop(kind, None)
                    settings['battery_shop_urls'] = {kind:url for kind,url in urls.items() if kind not in removed}
                hidden = set(settings.get('battery_inventory_hidden_types', []))
                hidden.update(removed)
                hidden.difference_update(stocks)
                settings['battery_inventory_hidden_types'] = sorted(hidden)
                linked = dict(settings.get('battery_device_links', {}))
                for kind in removed:
                    linked.pop(kind, None)
                for kind, ids in device_links.items():
                    if kind in removed or kind in hidden:
                        raise ValueError('Gelöschte Batterietypen können nicht zugeordnet werden.')
                    linked[kind] = validate_material_device_ids(new, ids)
                settings['battery_device_links'] = linked
            elif action == 'settings':
                value = p.get('value', {})
                if not isinstance(value, dict):
                    raise ValueError('Ungültige Meldungseinstellungen.')
                fields = ('enabled', 'notification_frequency', 'weekday', 'monthday', 'time')
                settings = dict(new.get('settings', {}), **{key:value[key] for key in fields if key in value})
                if 'time' in value:
                    from datetime import time
                    if not isinstance(value['time'], str):
                        raise ValueError('Die Uhrzeit muss im Format HH:MM angegeben werden.')
                    try:
                        clock = time.fromisoformat(value['time'])
                    except ValueError as error:
                        raise ValueError('Die Uhrzeit muss im Format HH:MM angegeben werden.') from error
                    if clock.tzinfo is not None:
                        raise ValueError('Die Uhrzeit wird in der Home-Assistant-Zeitzone angegeben.')
                    settings['time'] = clock.strftime('%H:%M')
                engine.validate_notification_settings(settings)
                new['settings'] = settings
            elif action == 'import':
                new, counts = engine.import_new(new,p['records'])
                result['counts'] = counts
                if 'questions' in p:
                    new['questions'] = p['questions']
            elif action == 'reset_all_data':
                if p.get('confirmed') is not True or p.get('confirmation') != 'DATEN ZURÜCKSETZEN':
                    raise ValueError('Das endgültige Löschen der Geräte- und Aufgabendaten muss ausdrücklich bestätigt werden.')
                settings = deepcopy(new.get('settings', {}))
                for key in ('battery_inventory', 'battery_inventory_hidden_types', 'battery_inventory_thresholds', 'battery_device_links', 'battery_notes', 'battery_shop_urls', 'battery_no_restock', 'battery_rechargeable_types', 'consumables', 'deleted_consumables', 'initial_device_capture', 'last_device_capture'):
                    settings.pop(key, None)
                new = engine.blank()
                new.update(settings=settings, questions=[], samples={})
            elif action == 'restore':
                new = engine.validate_data(deepcopy(p['value']))
                remove_disabled_battery_shopping(new)
                new['revision'] = self.data['revision'] + 1
            elif action == 'bulk':
                for selected in p['devices']:
                    d = dr.async_get(self.hass).async_get(selected['ha_device_id'])
                    if d is None:
                        raise ValueError('Unbekanntes HA-Gerät.')
                    same = next((a for a in new['devices'].values() if a.get('ha_device_id') == d.id
                                 and not a.get('archived') and not a.get('archived_at') and not a.get('deleted_at')),None)
                    did = same['id'] if same else str(uuid4())
                    if not same:
                        new['devices'][did] = dict(id=did,name=d.name_by_user or d.name or d.id,
                            manufacturer=d.manufacturer,model=d.model,ha_device_id=d.id,
                            area=selected.get('area'))
                    rule = dict(p['rule'],id=str(uuid4()),device_id=did)
                    if rule['kind'] == 'measurement':
                        rule['sensor_registry_id'] = selected.get('sensor_registry_id')
                    engine.validate_rule(rule)
                    duplicate = any(r['device_id']==did and r['name']==rule['name'] and not r.get('deleted_at') for r in new['rules'].values())
                    if not duplicate:
                        new['rules'][rule['id']] = rule
            else:
                raise ValueError('Unbekannte Aktion.')
            if action in ('battery_replacement', 'battery_purchase', 'normalize_battery_devices', 'edit_battery_type') or (action == 'battery_inventory' and (p.get('stocks') or p.get('remove_types') or p.get('thresholds') or p.get('no_restock'))) or (action in ('delete_log', 'undo_completion') and movement):
                sync_battery_shopping(new, self.data)
            if material_movement and material_movement['kind'] == 'battery':
                sync_battery_shopping(new, self.data)
            if action in ('save_consumable', 'consumable_purchase') or (material_movement and material_movement['kind'] == 'material'):
                for material in new.get('settings', {}).get('consumables', {}).values():
                    identity = 'consumable:' + material['id']
                    quantity = material.get('quantity')
                    if quantity is not None and quantity <= material['threshold']:
                        new['shopping'][identity] = dict(new['shopping'].get(identity, {}), id=identity, name=material['name'] + ' nachkaufen', consumable_id=material['id'], done=False)
                    elif identity in new['shopping']:
                        new['shopping'][identity]['done'] = True
            self.validate_registry_links(new)
            engine.stamp_device_changes(self.data, new, now, action)
            new['revision'] = max(new['revision'],self.data['revision'] + 1)
            await self.commit(new)
            if action == 'reset_all_data':
                await self.rollback.async_remove()
            return dict(result, revision=new['revision'])


@websocket_api.websocket_command({'type':DOMAIN + '/request', vol.Required('action'):str,
                                  vol.Optional('payload', default={}):dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_request(hass, connection, msg):
    directory = hass.data.get(DOMAIN,{}).get('directory')
    if directory is None:
        connection.send_error(msg['id'],'not_loaded','Wartungsverzeichnis ist nicht geladen.')
        return
    try:
        result = await directory.execute(msg['action'],msg['payload'])
        connection.send_result(msg['id'],result)
    except (ValueError, KeyError, TypeError) as exc:
        connection.send_error(msg['id'],'invalid_request',str(exc))
    except Exception:
        _LOGGER.exception('Wartungsverzeichnis: Änderung fehlgeschlagen')
        connection.send_error(msg['id'],'save_failed','Änderung konnte nicht gespeichert werden. Bitte aktualisieren.')


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN,{})
    websocket_api.async_register_command(hass,ws_request)
    await hass.http.async_register_static_paths([StaticPathConfig(
        '/ha_wartung/panel.js',str(Path(__file__).parent/'frontend'/'panel.js'),False)])
    return True


async def async_setup_entry(hass, entry):
    directory = Directory(hass)
    await directory.load()
    hass.data[DOMAIN]['directory'] = directory
    await panel_custom.async_register_panel(hass,frontend_url_path='wartung',
        webcomponent_name='ha-wartung-panel',sidebar_title='Wartung',
        sidebar_icon='mdi:tools',module_url=f'/ha_wartung/panel.js?v={VERSION}',require_admin=True)
    entry.async_on_unload(async_track_time_interval(hass,directory.tick,timedelta(minutes=1)))
    return True


async def async_unload_entry(hass, entry):
    frontend.async_remove_panel(hass,'wartung')
    hass.data[DOMAIN].pop('directory',None)
    return True
