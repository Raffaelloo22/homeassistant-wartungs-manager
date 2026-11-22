"""Read-only, deterministic checks for maintenance-directory data.

A finding is a review prompt, never a proposed automatic merge or repair.
Registry presence is checked separately from sensor availability: an unavailable
sensor is not a broken assignment, and manual device records need no HA link.
"""
import re
import unicodedata
from collections import defaultdict

try:
    from .engine import normalize_battery_type, validate_consumable_link
except ImportError:  # Pure-module imports in the offline test harness.
    from engine import normalize_battery_type, validate_consumable_link


def _text(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or ''))
                   if not unicodedata.combining(c)).casefold().strip()


def _battery_change(value):
    """Recognise replacement, without treating checks or charging as consumption."""
    text = _text(value)
    return bool(re.search(r'\bbatterie(?:n)?\b.*\b(?:wechseln|ersetzen|tauschen)\b|'
                          r'\bbatteriewechsel\b|\bwechsel(?:n)?\s+auf\s+lithium\b', text))


def _fixed_battery(value):
    return bool(re.search(r'fest.*verbaut|integriert|eingebaut', _text(value)))


def _unknown_battery(value):
    return not str(value or '').strip() or bool(re.search(
        r'unbekannt|nicht dokumentiert|zu klaren|\boffen\b|nicht bekannt', _text(value)))


def inspect_directory(data, registry):
    """Return review findings without mutating data or querying Home Assistant.

    `registry` uses Directory.registry's devices/sensors lists. Live sensor values
    are intentionally not needed; absent states can merely be startup delays.
    """
    devices = {key: value for key, value in data.get('devices', {}).items()
               if not value.get('deleted_at')}
    rules = {key: value for key, value in data.get('rules', {}).items()
             if not value.get('deleted_at') and value.get('device_id') in devices}
    settings = data.get('settings', {})
    ha_devices = {d['id'] for d in registry.get('devices', [])}
    sensor_ids = {sensor['id'] for sensor in registry.get('sensors', [])}
    sensor_entities = {sensor['entity_id'] for sensor in registry.get('sensors', [])}
    materials = settings.get('consumables', {})
    hidden = set(settings.get('battery_inventory_hidden_types', []))
    battery_types = set(settings.get('battery_inventory', {})) | {
        normalize_battery_type(device.get('battery_type')) for device in devices.values()
        if not _unknown_battery(device.get('battery_type'))
        and not _fixed_battery(device.get('battery_type'))}
    issues = []
    battery_required = set()

    def add(code, title, detail, device_ids, rule_id=None, step=None, severity='warning'):
        issue = {'code': code, 'severity': severity, 'title': title, 'detail': detail,
                 'device_ids': sorted(device_ids)}
        if rule_id is not None:
            issue['rule_id'] = rule_id
        if step is not None:
            issue['step'] = step
        issues.append(issue)

    def check_link(link, rule, step=None):
        device_id = rule['device_id']
        context = 'Aufgabe «' + str(rule.get('name', '')) + '»'
        if step is not None:
            context += ', Arbeitsschritt «' + str(step) + '»'
        try:
            validate_consumable_link(link)
        except (ValueError, TypeError):
            add('material_link_invalid', 'Materialzuordnung prüfen',
                context + ': Typ, Kennung oder Verbrauchsmenge sind ungültig.',
                [device_id], rule['id'], step)
            return
        if link is None:
            return
        identity = link['id']
        if link['kind'] == 'battery':
            battery_required.add(device_id)
            if identity in hidden or identity not in battery_types or _fixed_battery(identity) or _unknown_battery(identity):
                add('battery_link_missing', 'Batteriezuordnung nicht verfügbar',
                    context + ': Der Batterietyp «' + identity + '» fehlt oder wurde entfernt.',
                    [device_id], rule['id'], step)
        elif identity not in materials or materials[identity].get('deleted_at'):
            add('material_link_missing', 'Verbrauchsmaterial nicht verfügbar',
                context + ': Das zugeordnete Verbrauchsmaterial wurde entfernt oder ist nicht vorhanden.',
                [device_id], rule['id'], step)

    for rule in rules.values():
        device_id = rule['device_id']
        sensor = rule.get('sensor_registry_id')
        if sensor and sensor not in sensor_ids:
            add('rule_sensor_missing', 'Home-Assistant-Sensor fehlt',
                'Der Sensor der Aufgabe «' + str(rule.get('name', '')) + '» ist nicht mehr registriert.',
                [device_id], rule['id'])
        check_link(rule.get('consumable'), rule)
        steps = rule.get('steps', []) if rule.get('kind') == 'rotation' else []
        by_step = rule.get('consumables_by_step', {})
        for step, link in by_step.items():
            check_link(link, rule, step)
        replacement_names = [(step, by_step.get(step, rule.get('consumable'))) for step in steps]
        if not steps:
            replacement_names = [(None, rule.get('consumable'))]
        for step, link in replacement_names:
            if not _battery_change(step if step is not None else rule.get('name')):
                continue
            battery_required.add(device_id)
            device = devices[device_id]
            active = not (rule.get('archived') or device.get('archived') or device.get('archived_at') or device.get('in_storage'))
            if active and link is None and not _fixed_battery(device.get('battery_type')):
                add('battery_material_unassigned', 'Batteriewechsel ohne Materialzuordnung',
                    'Für «' + str(step or rule.get('name', '')) + '» ist kein Verbrauchsmaterial verknüpft. '
                    'Beim Erledigen kann deshalb kein Bestand abgezogen werden.',
                    [device_id], rule['id'], step, severity='info')

    ha_groups = defaultdict(list)
    name_groups = defaultdict(list)
    for identity, device in devices.items():
        name = str(device.get('name', identity))
        ha_id = device.get('ha_device_id')
        if ha_id:
            ha_groups[ha_id].append(identity)
            if ha_id not in ha_devices:
                add('ha_device_missing', 'Home-Assistant-Gerät fehlt',
                    'Die Home-Assistant-Zuordnung von «' + name + '» ist nicht mehr registriert.', [identity])
        sensor = device.get('battery_entity_id')
        if sensor and sensor not in sensor_entities:
            add('battery_sensor_missing', 'Batteriesensor fehlt',
                'Der zugeordnete Batteriesensor «' + str(sensor) + '» ist nicht mehr registriert.', [identity])
        raw_type = device.get('battery_type')
        if not _fixed_battery(raw_type) and (raw_type or sensor or device.get('battery_quantity') is not None or identity in battery_required):
            if _unknown_battery(raw_type):
                add('battery_type_missing', 'Batterietyp ergänzen',
                    'Bei «' + name + '» ist der benötigte Batterietyp noch nicht erfasst.', [identity])
            else:
                quantity = device.get('battery_quantity')
                # Retain the old combined type/count format as a valid known quantity.
                legacy = re.match(r'^(\d+)\s*[×x]\s*', str(raw_type).strip())
                if quantity is None and legacy:
                    quantity = int(legacy.group(1))
                if type(quantity) is not int or not 1 <= quantity <= 1000:
                    add('battery_quantity_invalid', 'Batterieanzahl prüfen',
                        'Bei «' + name + '» fehlt eine ganze Batterieanzahl zwischen 1 und 1000.', [identity])
        for link in device.get('related_devices', []):
            target = link.get('id')
            # A link to a trashed record is temporarily hidden and can be restored.
            if target not in data.get('devices', {}):
                add('related_device_missing', 'Verknüpftes Gerät fehlt',
                    'Bei «' + name + '» verweist eine Verknüpfung auf ein nicht mehr vorhandenes Gerät.', [identity])
        normalized_name = ' '.join(_text(name).split())
        manufacturer = _text(device.get('manufacturer'))
        model = _text(device.get('model'))
        active = not (device.get('in_storage') or device.get('archived') or device.get('archived_at'))
        if active and normalized_name and (manufacturer or model):
            name_groups[(normalized_name, manufacturer, model)].append(identity)

    duplicate_groups = set()
    for ids in ha_groups.values():
        if len(ids) > 1:
            group = tuple(sorted(ids))
            duplicate_groups.add(group)
            add('duplicate_ha_device', 'Mehrere Akten für dasselbe Home-Assistant-Gerät',
                'Diese Geräteakten verwenden dieselbe Home-Assistant-Zuordnung. Bitte prüfen, ob beide benötigt werden.',
                ids, severity='info')
    for ids in name_groups.values():
        if len(ids) < 2 or tuple(sorted(ids)) in duplicate_groups:
            continue
        assigned = {devices[identity]['ha_device_id'] for identity in ids if devices[identity].get('ha_device_id')}
        # Separate HA devices with the same name/model are not enough evidence.
        if len(assigned) > 1 or (len(assigned) == 1 and all(devices[identity].get('ha_device_id') for identity in ids)):
            continue
        add('possible_duplicate', 'Möglicherweise doppelt erfasst',
            'Name sowie Hersteller/Modell stimmen überein. Dies ist nur ein Prüfhinweis; es wird nichts zusammengeführt.',
            ids, severity='info')

    issues.sort(key=lambda issue: (issue['code'], tuple(issue['device_ids']),
                                  issue.get('rule_id', ''), issue.get('step', ''), issue['detail']))
    return {'issues': issues, 'checked_devices': len(devices), 'checked_rules': len(rules)}
