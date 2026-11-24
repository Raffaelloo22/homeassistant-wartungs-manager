"""Pure maintenance domain logic; no Home Assistant dependency.

All callers must save a returned copy under a storage lock before publishing it.
Report timestamps must originate from the source integration, never from polling.
"""
from calendar import monthrange
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from uuid import uuid4
from hashlib import sha256
from ipaddress import ip_address
from urllib.parse import urlsplit
import re


BACKEND_UPCOMING_DAYS = 7  # Preserve the existing status/digest window; the dashboard filter uses 14.
DEFAULT_DEVICE_CATEGORIES = ['Haushalt', 'Heizung', 'Internet und WLAN', 'Netzwerk & Büro', 'Fahrzeuge', 'Garten', 'Licht', 'Beschattung', 'Gefahrenmelder', 'Tür- und Fenstermelder', 'Bewegungsmelder', 'Temperatursensoren', 'Sensoren', 'Zutritt', 'Kameras', 'Audio und Medien', 'Buttons', 'Smart Home']
DEFAULT_EVENT_TYPES = {'maintenance':'Wartung', 'repair':'Reparatur', 'installation':'Installation', 'replacement':'Ersatz', 'purchase':'Kauf / Bestellung', 'inspection':'Prüfung', 'note':'Notiz'}


def normalize_shop_url(value):
    """Validate a user-supplied shop link without fetching it."""
    error = 'Shop-Link benötigt eine gültige HTTP- oder HTTPS-Adresse ohne Zugangsdaten.'
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError(error)
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError(error)
    value = value.strip()
    if not value:
        return ''
    if any(char.isspace() for char in value) or any(char in value for char in '\\<>"'):
        raise ValueError(error)
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        if (parsed.scheme not in ('http', 'https') or not host
            or parsed.username is not None or parsed.password is not None
            or parsed.netloc.endswith(':') or port is not None and not 1 <= port <= 65535):
            raise ValueError(error)
        if parsed.netloc.startswith('['):
            if not re.fullmatch(r'\[[0-9a-fA-F:.]+\](?::[0-9]+)?', parsed.netloc) or ip_address(host).version != 6:
                raise ValueError(error)
        elif ':' in parsed.netloc and not re.fullmatch(r'[0-9]+', parsed.netloc.rsplit(':', 1)[1]):
            raise ValueError(error)
        host = host[:-1] if host.endswith('.') else host
        try:
            ip_address(host)
        except ValueError:
            if re.fullmatch(r'[0-9.]+', host):
                raise ValueError(error)
            ascii_host = host.encode('idna').decode('ascii')
            if (len(ascii_host) > 253 or any(not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label)
                                             for label in ascii_host.split('.'))):
                raise ValueError(error)
            # Reject malformed punycode rather than passing it to a browser.
            ascii_host.encode('ascii').decode('idna')
    except (ValueError, UnicodeError) as exc:
        raise ValueError(error) from exc
    return value


def normalize_battery_type(value):
    value = re.sub(r'^\d+\s*[×x]\s*', '', str(value or '').strip())
    if re.match(r'^CR123A', value, re.I):
        return 'CR123A'
    if re.fullmatch(r'9\s*V', value, re.I):
        return '9V'
    return value


def validate_consumable_link(link, shape_error='Ungültige Verbrauchsmaterial-Verknüpfung.'):
    if link is None:
        return
    if not isinstance(link, dict) or link.get('kind') not in ('battery', 'material') or not isinstance(link.get('id'), str) or not link['id'].strip():
        raise ValueError(shape_error)
    quantity = link.get('quantity', 1)
    if type(quantity) not in (int, float) or not isfinite(quantity) or not 0 < quantity <= 100000:
        raise ValueError('Die Verbrauchsmenge muss grösser als null sein.')


def sanitize_directory(data):
    """Compatibility cleanup at the existing load, write and rollback boundaries."""
    data.get('settings', {}).pop('relationship_types', None)
    for device in data.get('devices', {}).values():
        device.pop('incoming_devices', None)
        if 'related_devices' in device:
            device['related_devices'] = [{'id': link['id']} for link in device['related_devices']]
    return remove_evernote_sources(remove_device_images(remove_log_sources(data)))


DEVICE_CHANGE_ACTIONS = frozenset({
    'save_device', 'duplicate_device', 'archive_device', 'delete_device', 'restore_device',
    'replace_device', 'initial_capture_commit', 'bulk', 'save_categories', 'delete_category',
    'edit_battery_type', 'normalize_battery_devices', 'purge_trash', 'purge_trash_device',
})
DEVICE_MASTER_FIELDS = (
    'name', 'manufacturer', 'model', 'category', 'serial', 'purchase_date', 'purchase_period',
    'notes', 'ha_device_id', 'battery_entity_id', 'predecessor_id', 'successor_id', 'controller_device_id',
)


def _device_neighbors(data):
    devices = data.get('devices', {})
    neighbors = {identity: set() for identity in devices}
    for identity, device in devices.items():
        for link in device.get('related_devices', []):
            target = link.get('id')
            if target in neighbors and target != identity:
                neighbors[identity].add(target)
                neighbors[target].add(identity)
    return neighbors


def _device_master_signature(device, neighbors):
    battery = normalize_battery_type(device.get('battery_type'))
    quantity = device.get('battery_quantity')
    if battery and quantity is None:
        match = re.match(r'^(\d+)\s*[×x]\s*', str(device.get('battery_type') or '').strip())
        quantity = int(match.group(1)) if match else 1
    if isinstance(quantity, str) and quantity.isdigit():
        quantity = int(quantity)
    status = ('trash' if device.get('deleted_at') else 'archive' if device.get('archived') or device.get('archived_at')
              else 'storage' if device.get('in_storage') else 'active')
    return (tuple(device.get(field) or None for field in DEVICE_MASTER_FIELDS), status,
            battery or None, quantity if battery else None,
            device.get('battery_alert_enabled') is not False if battery else None,
            frozenset(neighbors), frozenset(device.get('controlled_device_ids') or []))


def stamp_device_changes(previous, current, now, action):
    """Record device edits and new imports without rewriting historical timestamps."""
    if action not in DEVICE_CHANGE_ACTIONS and action != 'import':
        return
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('Geräteänderungszeitpunkt benötigt eine Zeitzone.')
    old_devices, devices = previous.get('devices', {}), current.get('devices', {})
    timestamp = now.isoformat()
    if action == 'import':
        for identity, device in devices.items():
            if identity not in old_devices:
                device.setdefault('created_at', timestamp)
        return
    old_neighbors, neighbors = _device_neighbors(previous), _device_neighbors(current)
    for identity, device in devices.items():
        if identity not in old_devices:
            device['created_at'] = timestamp
            device['device_updated_at'] = timestamp
        elif _device_master_signature(old_devices[identity], old_neighbors[identity]) != _device_master_signature(device, neighbors[identity]):
            device['device_updated_at'] = timestamp


def event_types(data):
    return dict(DEFAULT_EVENT_TYPES, **data.get('settings', {}).get('event_types', {}))


def remove_device_images(data):
    for device in data.get('devices', {}).values():
        for key in ('image_id', 'image_upload', 'image_source'):
            device.pop(key, None)
    return data


def canonical_source_key(key):
    if isinstance(key, str) and 'evernote' in key.casefold():
        return 'source:sha256:' + sha256(key.encode('utf-8')).hexdigest()
    return key


EVERNOTE_REFERENCE_PATTERN = re.compile(r"https?://(?:[a-z0-9-]+\.)*evernote\.com/[^\s<>\"'\)\]]+|evernote://[^\s<>\"'\)\]]+|evernote(?:-note)?:[0-9a-f-]{36}", re.I)

def remove_evernote_sources(data):
    """Remove source handles and links without dropping substantive notes or IDs."""
    if isinstance(data.get('imports'), dict):
        data['imports'] = {canonical_source_key(key): value for key, value in data['imports'].items()}
    def clean(value):
        if isinstance(value, str):
            return EVERNOTE_REFERENCE_PATTERN.sub('', value)
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, dict):
            for key in list(value):
                item = value[key]
                if key.casefold() in ('evernote_note_id', 'evernote_id', 'evernote_guid', 'evernote_url', 'evernote_link', 'evernote_source'):
                    del value[key]
                elif key in ('source_ref', 'source_refs'):
                    if isinstance(item, str) and 'evernote' in item.casefold():
                        del value[key]
                    elif isinstance(item, list):
                        value[key] = [clean(ref) for ref in item if not isinstance(ref, str) or 'evernote' not in ref.casefold()]
                        if not value[key]:
                            del value[key]
                    else:
                        value[key] = clean(item)
                else:
                    value[key] = clean(item)
            return value
        return value
    return clean(data)


def remove_log_sources(data):
    for event in data.get('logs', {}).values():
        event.pop('source_ref', None)
        event.pop('source_refs', None)
    return data


def save_event_type(data, identity, name):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise ValueError('Bitte eine Bezeichnung mit höchstens 80 Zeichen eingeben.')
    name = name.strip()
    types = event_types(data)
    hidden = set(data.get('settings', {}).get('hidden_event_types', []))
    if identity is not None and (not isinstance(identity, str) or identity not in types or identity in hidden):
        raise ValueError('Ereignisart wurde nicht gefunden.')
    same = next((key for key, label in types.items() if label.casefold() == name.casefold() and key != identity), None)
    if same is not None:
        if identity is None and same in hidden:
            identity = same
            hidden.remove(same)
        else:
            raise ValueError('Diese Ereignisart ist bereits vorhanden.')
    if identity is None:
        if len(types) >= 100:
            raise ValueError('Es sind bereits 100 Ereignisarten vorhanden.')
        identity = 'event-' + uuid4().hex
    settings = data.setdefault('settings', {})
    settings.setdefault('event_types', {})[identity] = name
    settings['hidden_event_types'] = sorted(hidden)
    return identity


def save_event_type_order(data, order):
    active = set(event_types(data)) - set(data.get('settings', {}).get('hidden_event_types', []))
    if (not isinstance(order, list) or any(not isinstance(key, str) for key in order)
            or len(order) != len(set(order)) or set(order) != active):
        raise ValueError('Bitte alle verfügbaren Ereignisarten genau einmal angeben.')
    data.setdefault('settings', {})['event_type_order'] = list(order)


def delete_event_type(data, identity, confirmed):
    if confirmed is not True:
        raise ValueError('Bitte das Entfernen bestätigen.')
    types = event_types(data)
    hidden = set(data.get('settings', {}).get('hidden_event_types', []))
    if not isinstance(identity, str) or identity not in types or identity in hidden:
        raise ValueError('Ereignisart wurde nicht gefunden.')
    if len(set(types) - hidden) <= 1:
        raise ValueError('Mindestens eine Ereignisart muss verfügbar bleiben.')
    # Keep the label for old entries; only remove it from new selections.
    hidden.add(identity)
    data.setdefault('settings', {})['hidden_event_types'] = sorted(hidden)


def fill_purchase_date(data, event):
    """Fill a missing device purchase date from an explicitly dated purchase."""
    if event.get('kind') != 'purchase' or event.get('deleted_at') or not event.get('event_date'):
        return
    if event.get('date_precision') in ('year', 'month', 'period', 'approximate'):
        return
    device = data.get('devices', {}).get(event.get('device_id'))
    if device is None or device.get('deleted_at') or str(device.get('purchase_date') or '').strip():
        return
    device['purchase_date'] = parse_date(event['event_date']).isoformat()


def add_months(day, months):
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def calendar_day(year, month, day):
    # Feb 29 recurs on the last day of February in non-leap years.
    return date(year, month, min(day, monthrange(year, month)[1]))


def blank():
    return {'schema': 1, 'revision': 0, 'devices': {}, 'rules': {},
            'logs': {}, 'shopping': {}, 'imports': {}, 'operations': {}}


def parse_date(value):
    return date.fromisoformat(value) if value else None


def validate_rule(rule):
    if not rule.get('name') or not rule.get('device_id'):
        raise ValueError('Aufgabe und Geräteakte sind erforderlich.')
    links = [rule.get('consumable')]
    by_step = rule.get('consumables_by_step', {})
    if not isinstance(by_step, dict) or len(by_step) > 24 or any(key not in rule.get('steps', []) for key in by_step):
        raise ValueError('Ungültige Materialzuordnung für Arbeitsschritte.')
    links.extend(by_step.values())
    for link in links:
        validate_consumable_link(link)
    kind = rule.get('kind')
    if kind not in ('interval', 'season', 'measurement', 'rotation', 'on_demand', 'none', 'date'):
        raise ValueError('Unbekannter Regeltyp.')
    if kind == 'date':
        if not rule.get('due_date'):
            raise ValueError('Bitte einen Termin eingeben.')
        parse_date(rule['due_date'])
    if kind == 'interval':
        months, days = rule.get('months', 0), rule.get('days', 0)
        if any(type(v) is not int or v < 0 for v in (months, days)):
            raise ValueError('Intervall muss aus positiven ganzen Tagen/Monaten bestehen.')
        # A deliberately unknown interval is allowed and means "Einplanen".
    if kind == 'season':
        if type(rule.get('month')) is not int or type(rule.get('day')) is not int:
            raise ValueError('Saisonmonat und Tag müssen ganze Zahlen sein.')
        if rule.get('first_cycle') is not None and (type(rule['first_cycle']) is not int or not 1900 <= rule['first_cycle'] <= 9998):
            raise ValueError('Ungültiger Saisonzyklus.')
        if rule.get('weekday') is not None and (type(rule['weekday']) is not int or not 0 <= rule['weekday'] <= 6):
            raise ValueError('Ungültiger Wochentag.')
        calendar_day(2024, int(rule['month']), int(rule['day']))
        if not 1 <= int(rule['day']) <= monthrange(2024, int(rule['month']))[1]:
            raise ValueError('Ungültiger Saisontermin.')
    if kind == 'rotation':
        steps = rule.get('steps')
        if (not isinstance(steps,list) or not 2 <= len(steps) <= 24
            or any(not isinstance(v,str) or not v.strip() for v in steps)):
            raise ValueError('Rotation benötigt zwei bis 24 benannte Arbeitsschritte.')
        if type(rule.get('months')) is not int or not 1 <= rule['months'] <= 120:
            raise ValueError('Rotationsabstand muss ein bis 120 Monate betragen.')
        if type(rule.get('rotation_step',0)) is not int or rule.get('rotation_step',0) < 0:
            raise ValueError('Ungültiger Rotationsstand.')
    if kind == 'measurement':
        threshold = float(rule['threshold'])
        if not isfinite(threshold) or not rule.get('sensor_registry_id'):
            raise ValueError('Sensorzuordnung und gültiger Schwellenwert erforderlich.')
    period = rule.get('first_due_period')
    if period is not None:
        if not isinstance(period,str) or len(period) != 7:
            raise ValueError('Erster Planmonat benötigt das Format JJJJ-MM.')
        parse_date(period+'-01')
    for field in ('first_due', 'booked', 'last_completed'):
        parse_date(rule.get(field))


def view(rule, today, now, sample=None):
    """Return the one shared status model used by UI and weekly digest."""
    result = {'rule_id': rule['id'], 'due': None, 'booked': rule.get('booked'),
              'cycle': None, 'status': 'planning'}
    if rule.get('archived'):
        return dict(result, status='archived')
    kind = rule['kind']
    if kind == 'none':
        return dict(result, booked=None, status='ok' if rule.get('last_completed') else 'no_due')
    if kind == 'date' and rule.get('completed_due_date') == rule.get('due_date'):
        return dict(result, due=None, booked=None, status='ok')
    if kind == 'on_demand':
        return dict(result, status='on_demand')
    if kind == 'measurement':
        ha_report = sample and sample.get('source') == 'home_assistant'
        fresh = sample and (ha_report or sample.get('source_report_confirmed', False))
        try:
            value = float(sample['value']) if sample else float('nan')
            report = datetime.fromisoformat(sample['reported_at']) if sample else None
            fresh = fresh and isfinite(value) and report.tzinfo is not None and report <= now
            if not ha_report:
                fresh = fresh and now - report <= timedelta(hours=48)
            if rule.get('awaiting_since'):
                fresh = fresh and report > datetime.fromisoformat(rule['awaiting_since'])
        except (KeyError, TypeError, ValueError):
            fresh = False
        if not fresh:
            return dict(result, status='measurement_pending')
        return dict(result, status='due' if value < float(rule['threshold']) else 'ok', value=value)
    if kind == 'rotation':
        step = rule.get('rotation_step',0)
        result.update(cycle=step, task_name=rule['steps'][step % len(rule['steps'])])
        last = parse_date(rule.get('last_completed'))
        due = add_months(last,rule['months']) if last else parse_date(rule.get('first_due'))
    elif kind == 'date':
        due = parse_date(rule['due_date'])
    elif kind == 'interval':
        last = parse_date(rule.get('last_completed'))
        if last and (rule.get('months', 0) or rule.get('days', 0)):
            due = add_months(last, rule.get('months', 0)) + timedelta(days=rule.get('days', 0))
        else:
            due = parse_date(rule.get('first_due')) if not last else None
    else:
        cycles = set(rule.get('completed_cycles', []))
        year = int(rule.get('first_cycle') or today.year)
        while year in cycles:
            year += 1
        due = calendar_day(year, int(rule['month']), int(rule['day']))
        if rule.get('weekday') is not None:
            offset = (rule['weekday'] - due.weekday() + 3) % 7 - 3
            due += timedelta(days=offset)
        result['cycle'] = year
    if due is None:
        period = rule.get('first_due_period') if kind == 'interval' else None
        if period and not rule.get('last_completed'):
            start = parse_date(period+'-01')
            current = today.strftime('%Y-%m')
            return dict(result, due=period, date_precision='month',
                status='overdue' if period < current else 'due' if period == current
                       else 'soon' if start <= today+timedelta(days=BACKEND_UPCOMING_DAYS) else 'scheduled')
        return result
    result['due'] = due.isoformat()
    result['status'] = ('overdue' if due < today else 'due' if due == today
                        else 'soon' if due <= today + timedelta(days=BACKEND_UPCOMING_DAYS) else 'scheduled')
    return result


COMPLETION_FIELDS = ('last_completed', 'booked', 'rotation_step', 'completed_cycles',
                     'completed_due_date', 'awaiting_since')
COMPLETION_CONFIG_FIELDS = ('kind', 'months', 'days', 'first_due', 'first_due_period',
                            'due_date', 'steps', 'month', 'day', 'first_cycle', 'weekday',
                            'sensor_registry_id', 'threshold', 'max_age_hours',
                            'timestamp_attribute', 'freshness_verified')


def _rule_fields(rule, fields):
    return {key: deepcopy(rule[key]) for key in fields if key in rule}


def complete(data, rule_id, *, event_date, now, operation_id, expected_revision,
             note='', cost=None, shopping=None, cycle=None):
    """Atomic, optimistic, idempotent completion incl. log, shopping, next due.

    The client keeps operation_id on retries. expected_revision rejects stale
    independent double-clicks even when they use different operation IDs.
    """
    if operation_id in data['operations']:
        return deepcopy(data), data['operations'][operation_id]
    if expected_revision != data['revision']:
        raise ValueError('Daten wurden geändert. Bitte Ansicht aktualisieren.')
    actual = parse_date(event_date)
    if actual is None or actual > now.date():
        raise ValueError('Erledigungsdatum muss heute oder in der Vergangenheit liegen.')
    if cost is not None and (not isfinite(float(cost)) or float(cost) < 0):
        raise ValueError('Kosten müssen eine nicht negative Zahl sein.')
    output = deepcopy(data)
    rule = output['rules'][rule_id]
    device = output['devices'][rule['device_id']]
    if rule.get('deleted_at'):
        raise ValueError('Aufgabe wurde gelöscht.')
    if device.get('archived_at') or device.get('archived') or rule.get('archived'):
        raise ValueError('Archivierte Geräte können nicht abgeschlossen werden.')
    before = _rule_fields(rule, COMPLETION_FIELDS)
    rotation_name = None
    if rule['kind'] == 'rotation':
        step = rule.get('rotation_step',0)
        if type(cycle) is not int or cycle != step:
            raise ValueError('Rotationsschritt hat sich geändert. Bitte aktualisieren.')
        last = parse_date(rule.get('last_completed'))
        if last and actual < last:
            raise ValueError('Ältere Arbeiten bitte als Historie nachtragen; Rotation bleibt unverändert.')
        rotation_name = rule['steps'][step % len(rule['steps'])]
        rule['rotation_step'] = step + 1
    if rule['kind'] == 'season':
        if type(cycle) is not int or not 1900 <= cycle <= 9998:
            raise ValueError('Für Saisonarbeiten ist der zugehörige Zyklus erforderlich.')
        if cycle in rule.get('completed_cycles', []):
            raise ValueError('Dieser Saisonzyklus wurde bereits abgeschlossen.')
        rule.setdefault('completed_cycles', []).append(cycle)
    if rule['kind'] == 'date':
        rule['completed_due_date'] = rule['due_date']
    if rule['kind'] == 'measurement':
        rule['awaiting_since'] = now.isoformat()
    previous = parse_date(rule.get('last_completed'))
    if previous is None or actual >= previous:
        rule['last_completed'] = actual.isoformat()
        rule['booked'] = None
    log_id = str(uuid4())
    output['logs'][log_id] = {'id': log_id, 'device_id': rule['device_id'],
        'rule_id': rule_id, 'event_date': actual.isoformat(),
        'recorded_at': now.isoformat(), 'kind': 'maintenance', 'cycle': cycle,
        'note': (rotation_name + (' — ' + note if note else '')) if rotation_name else note, 'cost': None if cost is None else float(cost)}
    output['logs'][log_id]['completion_state'] = {
        'before': before, 'after': _rule_fields(rule, COMPLETION_FIELDS),
        'configuration': _rule_fields(rule, COMPLETION_CONFIG_FIELDS)}
    if rule['kind'] == 'date':
        output['logs'][log_id]['scheduled_due_date'] = rule['due_date']
    if shopping:
        item_id = str(uuid4())
        output['shopping'][item_id] = {'id': item_id, 'name': shopping,
            'done': False, 'log_id': log_id}
    output['operations'][operation_id] = log_id
    output['revision'] += 1
    return output, log_id


def undo_completion(data, identity, now):
    """Undo one unchanged completion without rolling back unrelated directory edits.

    Stock and optional measurement movements belong to the integration transaction.
    The retained log is a tombstone, so retries can never consume or credit twice.
    """
    output = deepcopy(data)
    event = output['logs'].get(identity)
    if event is None or event.get('deleted_at'):
        raise ValueError('Erledigung ist nicht mehr zum Rückgängigmachen verfügbar.')
    state = event.get('completion_state')
    if (not isinstance(state, dict)
        or any(not isinstance(state.get(key), dict) for key in ('before', 'after', 'configuration'))
        or (set(state['before']) | set(state['after'])) - set(COMPLETION_FIELDS)):
        raise ValueError('Diese Erledigung kann nicht rückgängig gemacht werden.')
    rule = output['rules'].get(event.get('rule_id'))
    device = output['devices'].get(event.get('device_id'))
    if (not rule or rule.get('device_id') != event.get('device_id')
        or rule.get('deleted_at') or rule.get('archived') or not device
        or device.get('deleted_at') or device.get('archived') or device.get('archived_at')):
        raise ValueError('Gerät oder Aufgabe ist nicht mehr aktiv.')
    if (event.get('edited_at') or event.get('edits')
        or _rule_fields(rule, COMPLETION_FIELDS) != state['after']
        or _rule_fields(rule, COMPLETION_CONFIG_FIELDS) != state['configuration']):
        raise ValueError('Die Erledigung oder Aufgabe wurde inzwischen verändert. Bitte die Historie prüfen.')
    recorded = datetime.fromisoformat(event['recorded_at'])
    for other in output['logs'].values():
        if (other['id'] == identity or other.get('deleted_at')
            or other.get('rule_id') != rule['id'] or other.get('kind') != 'maintenance'
            or not other.get('recorded_at')):
            continue
        if datetime.fromisoformat(other['recorded_at']) >= recorded:
            raise ValueError('Es gibt eine spätere Erledigung. Bitte zuerst diese rückgängig machen.')
    for key in COMPLETION_FIELDS:
        if key in state['before']:
            rule[key] = deepcopy(state['before'][key])
        else:
            rule.pop(key, None)
    event.update(deleted_at=now.isoformat(), undone_at=now.isoformat())
    output['revision'] += 1
    return validate_data(output)


def import_new(data, records):
    """Append-only import by stable per-record source keys, preserving user edits."""
    output = remove_evernote_sources(deepcopy(data))
    counts = {'new': 0, 'existing': 0}
    for record in records:
        key = canonical_source_key(record['source_key'])
        collection = record['collection']
        if collection not in ('devices', 'rules', 'logs'):
            raise ValueError('Ungültige Importsammlung.')
        if key in output['imports']:
            counts['existing'] += 1
            continue
        value = deepcopy(record['value'])
        identity = value['id']
        target = identity if collection == 'devices' else value.get('device_id')
        if output['devices'].get(target,{}).get('deleted_at'):
            counts['existing'] += 1
            continue
        if identity in output[collection]:
            raise ValueError('Import-ID kollidiert mit einem bestehenden Datensatz.')
        if collection == 'rules':
            validate_rule(value)
        if collection in ('rules', 'logs') and value['device_id'] not in output['devices']:
            raise ValueError('Unbekannte Geräteakte im Import.')
        if collection == 'logs':
            value.setdefault('recorded_at',datetime.now(timezone.utc).isoformat())
        output[collection][identity] = value
        if collection == 'logs':
            fill_purchase_date(output, value)
        output['imports'][key] = {'collection': collection, 'id': identity,
                                  'review_status': 'matched'}
        counts['new'] += 1
    if counts['new']:
        output['revision'] += 1
    return remove_evernote_sources(output), counts


def validate_notification_settings(settings):
    """Validate only present schedule fields, without filling old exports."""
    if not isinstance(settings, dict):
        raise ValueError('Ungültige Meldungseinstellungen.')
    if 'enabled' in settings and type(settings['enabled']) is not bool:
        raise ValueError('Aktivierung muss ein Wahrheitswert sein.')
    if 'notification_frequency' in settings and settings['notification_frequency'] not in ('daily', 'weekly', 'monthly'):
        raise ValueError('Ungültiges Meldungsintervall.')
    if 'weekday' in settings and (type(settings['weekday']) is not int or not 0 <= settings['weekday'] <= 6):
        raise ValueError('Ungültiger Wochentag.')
    if 'monthday' in settings and (type(settings['monthday']) is not int or not 1 <= settings['monthday'] <= 31):
        raise ValueError('Der Monatstag muss zwischen 1 und 31 liegen.')
    if 'time' in settings and (not isinstance(settings['time'], str)
                              or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', settings['time'])):
        raise ValueError('Die Uhrzeit muss im Format HH:MM angegeben werden.')


def notification_due_period(settings, now):
    """Return the due period and its dedupe key using Home Assistant local time."""
    if not settings.get('enabled') or now.strftime('%H:%M') < settings.get('time', '09:00'):
        return None
    frequency = settings.get('notification_frequency', 'weekly')
    if frequency == 'daily':
        return 'last_notification_day', now.date().isoformat()
    if frequency == 'weekly' and now.weekday() == settings.get('weekday'):
        return 'last_week', now.strftime('%G-%V')
    if frequency == 'monthly' and now.day == min(settings.get('monthday', 1), monthrange(now.year, now.month)[1]):
        return 'last_notification_month', now.strftime('%Y-%m')
    return None


def _validate_inventory_settings(settings):
    """Validate present inventory fields without changing compatible old exports."""
    if not isinstance(settings, dict):
        raise ValueError('Ungültige Einstellungen im Import.')

    def mapping(value, label):
        if not isinstance(value, dict) or any(not isinstance(key, str) or not key.strip() for key in value):
            raise ValueError('Ungültige Inventardaten: ' + label)
        return value

    def number(value, lower, label, whole=False):
        if (type(value) not in (int, float) or not lower <= value <= 100000
            or not isfinite(value) or whole and value != int(value)):
            raise ValueError('Ungültiger Zahlenwert im Import: ' + label)

    def strings(value, label):
        if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
            raise ValueError('Ungültige Inventarzuordnung: ' + label)

    for collection in ('consumables', 'deleted_consumables'):
        for identity, material in mapping(settings.get(collection, {}), collection).items():
            if (not isinstance(material, dict) or material.get('id') != identity
                or any(not isinstance(material.get(key), str) or not material[key].strip() for key in ('name', 'unit'))
                or 'quantity' not in material or 'threshold' not in material):
                raise ValueError('Ungültiges Verbrauchsmaterial im Import: ' + identity)
            if material['quantity'] is not None:
                number(material['quantity'], -100000, 'Bestand von ' + identity)
            number(material['threshold'], 0, 'Nachkaufgrenze von ' + identity)
            if 'shop_url' in material:
                normalize_shop_url(material['shop_url'])
            if 'notes' in material and not isinstance(material['notes'], str):
                raise ValueError('Ungültige Materialnotizen im Import: ' + identity)
            if 'device_ids' in material:
                strings(material['device_ids'], identity)

    for field, lower in (('battery_inventory', -100000), ('battery_inventory_thresholds', 0)):
        for identity, value in mapping(settings.get(field, {}), field).items():
            number(value, lower, identity, whole=True)
    for identity, notes in mapping(settings.get('battery_notes', {}), 'battery_notes').items():
        if not isinstance(notes, str):
            raise ValueError('Ungültige Batterienotizen im Import: ' + identity)
    for identity, url in mapping(settings.get('battery_shop_urls', {}), 'battery_shop_urls').items():
        normalize_shop_url(url)
    for field in ('battery_inventory_hidden_types', 'battery_no_restock', 'battery_rechargeable_types'):
        if field in settings:
            strings(settings[field], field)
    for identity, ids in mapping(settings.get('battery_device_links', {}), 'battery_device_links').items():
        strings(ids, identity)


def validate_data(data):
    """Reject malformed imports/restores before any persistent mutation."""
    if not isinstance(data, dict) or data.get('schema') != 1 or type(data.get('revision')) is not int:
        raise ValueError('Nicht unterstütztes Datenformat.')
    for key in ('devices', 'rules', 'logs', 'shopping', 'imports', 'operations'):
        if not isinstance(data.get(key), dict):
            raise ValueError('Ungültige Datensammlung: ' + key)
    _validate_inventory_settings(data.get('settings', {}))
    settings = data.get('settings', {})
    validate_notification_settings(settings)
    if 'currency' in settings and (not isinstance(settings['currency'], str) or not re.fullmatch(r'[A-Z]{3}', settings['currency'])):
        raise ValueError('Währung benötigt einen dreistelligen Code, zum Beispiel CHF oder EUR.')
    if 'battery_threshold_entity' in settings and (not isinstance(settings['battery_threshold_entity'], str) or not re.fullmatch(r'input_number\.[a-z0-9_]+', settings['battery_threshold_entity'])):
        raise ValueError('Die Batterieschwelle benötigt einen input_number-Helfer.')
    for identity, device in data['devices'].items():
        if not isinstance(device, dict) or device.get('id') != identity or not str(device.get('name', '')).strip():
            raise ValueError('Gerätename und ID sind erforderlich.')
        for field in ('purchase_date', 'archived_at'):
            parse_date(device.get(field))
        for field in ('created_at', 'device_updated_at'):
            if field in device:
                value = device[field]
                try:
                    timestamp = datetime.fromisoformat(value) if isinstance(value, str) and len(value) <= 128 else None
                except ValueError as exc:
                    raise ValueError('Ungültiger Gerätezeitstempel: ' + field) from exc
                if timestamp is None or timestamp.tzinfo is None or timestamp.utcoffset() is None:
                    raise ValueError('Gerätezeitstempel benötigt eine Zeitzone: ' + field)
    for identity, rule in data['rules'].items():
        if not isinstance(rule, dict) or rule.get('id') != identity or rule.get('device_id') not in data['devices']:
            raise ValueError('Ungültige Aufgabenverknüpfung.')
        validate_rule(rule)
    for identity, event in data['logs'].items():
        if not isinstance(event, dict) or event.get('id') != identity or event.get('device_id') not in data['devices']:
            raise ValueError('Ungültiger Historieneintrag.')
        parse_date(event.get('event_date'))
        cost = event.get('cost')
        if cost is not None and (not isfinite(float(cost)) or float(cost) < 0):
            raise ValueError('Ungültige Kosten.')
    return data


def replace_device(data, old_id, new_device, when, rule_ids=None):
    """Keep the predecessor intact, reset all copied rules and link both records."""
    output = deepcopy(data)
    old = output['devices'][old_id]
    if old.get('archived') or old.get('archived_at'):
        raise ValueError('Gerät ist bereits archiviert.')
    parse_date(when)
    new_id = new_device.get('id') or str(uuid4())
    if new_id in output['devices']:
        raise ValueError('Nachfolger existiert bereits.')
    new_device = dict(new_device, id=new_id, predecessor_id=old_id)
    new_device.pop('archived_at', None)
    new_device.pop('archived', None)
    old.update(archived=True, archived_at=when, successor_id=new_id)
    output['devices'][new_id] = new_device
    for identity in rule_ids or []:
        rule = output['rules'][identity]
        if rule['device_id'] != old_id or rule['kind'] == 'measurement':
            raise ValueError('Messwertregeln müssen dem neuen Sensor separat zugeordnet werden.')
        copied = {k:v for k,v in rule.items() if k not in (
            'id','device_id','first_due','last_completed','booked','awaiting_since',
            'completed_cycles','first_cycle','source_ref','archived')}
        rid = str(uuid4())
        if copied['kind'] == 'season':
            copied['first_cycle'] = parse_date(when).year
        output['rules'][rid] = dict(copied, id=rid, device_id=new_id)
    lid = str(uuid4())
    output['logs'][lid] = dict(id=lid, device_id=old_id, kind='replacement',
        event_date=when, note='Ersetzt durch ' + new_device['name'], successor_id=new_id)
    output['revision'] += 1
    return validate_data(output), new_id


def delete_device(data, identity, when):
    """Reversible removal; keep IDs, histories and import tombstones together."""
    output = deepcopy(data)
    device = output['devices'][identity]
    if device.get('deleted_at'):
        raise ValueError('Gerät ist bereits im Papierkorb.')
    if not datetime.fromisoformat(when).tzinfo:
        raise ValueError('Löschzeitpunkt benötigt eine Zeitzone.')
    device['deleted_at'] = when
    output['revision'] += 1
    return validate_data(output)


def restore_device(data, identity):
    output = deepcopy(data)
    if not output['devices'][identity].pop('deleted_at',None):
        raise ValueError('Gerät ist nicht im Papierkorb.')
    output['revision'] += 1
    return validate_data(output)


def observed_interval(data, rule_id):
    """Descriptive history only; it must not replace a machine's display trigger."""
    from statistics import median
    days = sorted({parse_date(log['event_date']) for log in data['logs'].values()
                   if log.get('rule_id') == rule_id and log.get('event_date')
                   and log.get('kind') == 'maintenance' and not log.get('deleted_at')})
    result = {'observations':len(days),'observed_interval_days':None,'estimated_due':None}
    if len(days) >= 2:
        interval = median((b-a).days for a,b in zip(days,days[1:]))
        result.update(observed_interval_days=interval,
                      estimated_due=(days[-1]+timedelta(days=round(interval))).isoformat())
    return result


def link_history(data, rule_id, log_id, now=None):
    """Attach documented maintenance without fabricating a duplicate completion."""
    output = deepcopy(data)
    rule, event = output['rules'][rule_id], output['logs'][log_id]
    if (event.get('deleted_at') or rule['kind'] not in ('interval','on_demand','date') or event.get('kind') != 'maintenance'
        or event.get('device_id') != rule['device_id'] or not event.get('event_date')
        or event.get('rule_id') not in (None,rule_id)):
        raise ValueError('Historieneintrag passt nicht zur Wartungsregel.')
    actual = parse_date(event['event_date'])
    if rule['kind'] == 'date':
        if event['event_date'] != rule.get('due_date'):
            raise ValueError('Historieneintrag passt nicht zum Termin der Wartungsregel.')
        if now is not None and actual > now.date():
            raise ValueError('Historieneintrag darf nicht in der Zukunft liegen.')
        rule['completed_due_date'] = rule['due_date']
        event['scheduled_due_date'] = rule['due_date']
    event['rule_id'] = rule_id
    previous = parse_date(rule.get('last_completed'))
    if previous is None or actual > previous:
        rule['last_completed'] = actual.isoformat()
    output['revision'] += 1
    return validate_data(output)



def edit_log(data, identity, changes, now):
    """Edit history in place while preserving identity, provenance and rule cycles."""
    output = remove_log_sources(deepcopy(data))
    original = output['logs'].get(identity)
    if original is None or original.get('deleted_at'):
        raise ValueError('Historieneintrag wurde nicht gefunden.')
    if output['devices'][original['device_id']].get('deleted_at'):
        raise ValueError('Gerät ist im Papierkorb. Zuerst wiederherstellen.')
    allowed = {'event_date', 'event_period', 'kind', 'note', 'cost'}
    if set(changes) - allowed:
        raise ValueError('Ungültiges Feld im Historieneintrag.')
    event = dict(original, **changes)
    kinds = event_types(output)
    if event.get('kind') != original.get('kind') and (event.get('kind') not in kinds or event.get('kind') in output.get('settings', {}).get('hidden_event_types', [])):
        raise ValueError('Ungültiger Ereignistyp.')
    for field in ('note', 'event_period'):
        if event.get(field) is not None and not isinstance(event[field], str):
            raise ValueError('Ungültiger Text im Historieneintrag.')
    actual = parse_date(event.get('event_date'))
    if actual and actual > now.date():
        raise ValueError('Historieneintrag darf nicht in der Zukunft liegen.')
    if actual and event.get('event_period'):
        raise ValueError('Bitte Datum oder Zeitraum angeben, nicht beides.')
    cost = event.get('cost')
    if cost is not None:
        if isinstance(cost, bool) or not isfinite(float(cost)) or float(cost) < 0:
            raise ValueError('Kosten müssen eine nicht negative Zahl sein.')
        event['cost'] = float(cost)
    rule = output['rules'].get(original.get('rule_id'))
    if rule:
        if event['kind'] != 'maintenance' or actual is None:
            raise ValueError('Eine verknüpfte Wartung benötigt Ereignistyp Wartung und ein Datum.')
        if rule['kind'] == 'rotation':
            cycle = original.get('cycle')
            for other in output['logs'].values():
                if (other.get('deleted_at') or other['id'] == identity or other.get('rule_id') != rule['id']
                    or other.get('cycle') is None or cycle is None or not other.get('event_date')):
                    continue
                other_date = parse_date(other['event_date'])
                if ((other['cycle'] < cycle and other_date > actual)
                    or (other['cycle'] > cycle and other_date < actual)):
                    raise ValueError('Datum widerspricht der Reihenfolge der Wartungsrotation.')
        old_date = original.get('event_date')
        dates = [item['event_date'] for item in output['logs'].values()
                 if item['id'] != identity and item.get('rule_id') == rule['id']
                 and item.get('kind') == 'maintenance' and item.get('event_date') and not item.get('deleted_at')]
        dates.append(event['event_date'])
        # Some imported rules have a baseline without a linked history record.
        baseline = rule.get('last_completed')
        if baseline and baseline != old_date:
            dates.append(baseline)
        rule['last_completed'] = max(dates)
    snapshot = {key: original.get(key) for key in allowed}
    if any(event.get(key) != original.get(key) for key in allowed):
        event['edits'] = [*original.get('edits', []), {'edited_at': now.isoformat(), 'previous': snapshot}]
        event['edited_at'] = now.isoformat()
    output['logs'][identity] = event
    fill_purchase_date(output, event)
    return validate_data(output)



def delete_log(data, identity, now):
    """Hide an event, retain import identity and recompute linked completion state."""
    output = deepcopy(data)
    event = output['logs'].get(identity)
    if event is None or event.get('deleted_at'):
        raise ValueError('Historieneintrag wurde nicht gefunden.')
    if output['devices'][event['device_id']].get('deleted_at'):
        raise ValueError('Gerät ist im Papierkorb. Zuerst wiederherstellen.')
    event['deleted_at'] = now.isoformat()
    rule = output['rules'].get(event.get('rule_id'))
    if rule:
        remaining = [l for l in output['logs'].values()
                     if l.get('rule_id') == rule['id'] and not l.get('deleted_at')
                     and l.get('kind') == 'maintenance']
        if rule['kind'] == 'date':
            if any(l.get('scheduled_due_date') == rule.get('due_date') for l in remaining):
                rule['completed_due_date'] = rule['due_date']
            else:
                rule.pop('completed_due_date', None)
        dates = [l['event_date'] for l in remaining if l.get('event_date')]
        baseline = rule.get('last_completed')
        if baseline and baseline != event.get('event_date'):
            dates.append(baseline)
        if dates:
            rule['last_completed'] = max(dates)
        else:
            rule.pop('last_completed', None)
        cycle = event.get('cycle')
        if rule['kind'] == 'season' and cycle is not None:
            if not any(l.get('cycle') == cycle for l in remaining):
                rule['completed_cycles'] = [c for c in rule.get('completed_cycles', []) if c != cycle]
        if rule['kind'] == 'rotation' and cycle is not None and rule.get('rotation_step') == cycle + 1:
            rule['rotation_step'] = cycle
    return validate_data(output)




def delete_rule(data, identity, now):
    """Remove a task from active views, retaining completion history and import keys."""
    output = deepcopy(data)
    rule = output['rules'].get(identity)
    if rule is None or rule.get('deleted_at'):
        raise ValueError('Aufgabe wurde nicht gefunden oder bereits gelöscht.')
    if output['devices'][rule['device_id']].get('deleted_at'):
        raise ValueError('Gerät ist im Papierkorb. Zuerst wiederherstellen.')
    rule['deleted_at'] = now.isoformat()
    return validate_data(output)
