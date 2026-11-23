"""Prepare an independent physical device without copying its operational state."""
from copy import deepcopy
from datetime import date
from unicodedata import normalize
from uuid import uuid4


DEVICE_COPY_FIELDS = (
    'manufacturer', 'model', 'category', 'notes', 'battery_type',
    'battery_quantity', 'battery_alert_enabled', 'purchase_date', 'purchase_period',
)
DEVICE_COPY_OVERRIDE_FIELDS = frozenset((*DEVICE_COPY_FIELDS, 'name'))


def _source_device(data, source_id):
    devices = data.get('devices', {})
    source = devices.get(source_id) if isinstance(source_id, str) else None
    if not isinstance(source, dict):
        raise ValueError('Das zu duplizierende Gerät wurde nicht gefunden.')
    if source.get('deleted_at') or source.get('device_status') == 'trash':
        raise ValueError('Geräte im Papierkorb können nicht dupliziert werden.')
    return source


def _name_key(value):
    return normalize('NFKC', ' '.join(str(value).split())).casefold()


def device_copy_name(data, source_id, name=None):
    """Preview a unique name across all device states, without allocating an ID."""
    source = _source_device(data, source_id)
    base = source.get('name') if name is None else name
    if not isinstance(base, str) or not base.strip():
        raise ValueError('Gerätename ist erforderlich.')
    base = base.strip()
    taken = {_name_key(device.get('name', '')) for device in data['devices'].values()}
    if name is not None and _name_key(base) not in taken:
        return base
    candidate, number = base + ' (Kopie)', 2
    while _name_key(candidate) in taken:
        candidate = base + ' (Kopie ' + str(number) + ')'
        number += 1
    return candidate


def build_device_copy(data, source_id, overrides=None):
    """Return a new active device; the caller owns commit, retries and timestamps.

    HA links, serials, relationships, material links and all lifecycle/history
    fields are deliberately excluded. Explicit overrides use the same narrow
    metadata contract as the copy form, rather than accepting arbitrary records.
    """
    source = _source_device(data, source_id)
    if overrides is None:
        overrides = {}
    if not isinstance(overrides, dict) or set(overrides) - DEVICE_COPY_OVERRIDE_FIELDS:
        raise ValueError('Beim Duplizieren sind nur die angezeigten Stammdaten erlaubt.')
    if 'name' in overrides and (not isinstance(overrides['name'], str) or not overrides['name'].strip()):
        raise ValueError('Gerätename ist erforderlich.')
    value = {key: deepcopy(source[key]) for key in DEVICE_COPY_FIELDS if key in source}
    value.update(deepcopy(overrides))
    value['name'] = device_copy_name(data, source_id, overrides.get('name'))
    for key in ('manufacturer', 'model', 'category', 'notes', 'battery_type', 'purchase_date', 'purchase_period'):
        if value.get(key) is not None and not isinstance(value[key], str):
            raise ValueError('Ungültiger Text in den Gerätestammdaten: ' + key)
    quantity = value.get('battery_quantity')
    if quantity is not None and (type(quantity) is not int or not 1 <= quantity <= 1000):
        raise ValueError('Batterieanzahl muss eine ganze Zahl zwischen 1 und 1000 sein.')
    if 'battery_alert_enabled' in value and type(value['battery_alert_enabled']) is not bool:
        raise ValueError('Die Batteriewarnung muss ein- oder ausgeschaltet sein.')
    if value.get('purchase_date'):
        try:
            date.fromisoformat(value['purchase_date'])
        except ValueError as error:
            raise ValueError('Ungültiges Kaufdatum.') from error
    if not str(value.get('battery_type') or '').strip():
        value.update(battery_quantity=None, battery_alert_enabled=False)
    identity = str(uuid4())
    while identity in data['devices']:
        identity = str(uuid4())
    value.update(id=identity, in_storage=False, archived=False, archived_at=None)
    return value
