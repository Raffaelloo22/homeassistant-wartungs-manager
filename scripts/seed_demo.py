"""Seed an isolated lifecycle-test container with entirely fictional German data.

Run only inside a disposable container created by test_ha_lifecycle.py --keep:
    docker exec CONTAINER python /qa/seed_demo.py
There is deliberately no server URL option and no production credentials input.
All writes use Home Assistant REST/WebSocket APIs, never its .storage files.
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
import json

from aiohttp import ClientSession, ClientTimeout

from ha_lifecycle_probe import API, STATE, check


def months_before(day: date, months: int) -> date:
    """Use a safe mid-month date for reproducible interval demonstrations."""
    index = day.year * 12 + day.month - 1 - months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, 28))


async def main():
    state = json.loads(STATE.read_text())
    async with ClientSession(timeout=ClientTimeout(total=20)) as session:
        api = API(session, state['token'])
        config = await api.request('GET', '/api/config')
        check(config.get('location_name') == 'Release validation', 'Not the isolated release-test installation')
        previous = await api.action('export')
        check(all(identity.startswith(('fixture-', 'demo-')) for identity in previous['devices']),
              'Refusing to replace anything except synthetic test/demo devices')
        await api.mutate('reset_all_data', confirmed=True, confirmation='DATEN ZURÜCKSETZEN')
        helpers = await api.ws({'type': 'input_number/list'})
        if not any(helper['id'] == 'batterien_schwellwert' for helper in helpers):
            await api.ws({'type': 'input_number/create', 'name': 'Batterien Schwellwert', 'min': 0,
                          'max': 100, 'step': 1, 'mode': 'slider', 'initial': 20, 'unit_of_measurement': '%'})
        await api.request('POST', '/api/services/input_number/set_value',
                          {'entity_id': 'input_number.batterien_schwellwert', 'value': 20})
        await api.mutate('preferences', value={'currency': 'EUR',
                         'battery_threshold_entity': 'input_number.batterien_schwellwert'})
        await api.mutate('settings', value={'enabled': False, 'weekday': 0, 'time': '09:00'})
        today = date.fromisoformat((await api.action('get', fields=['today']))['today'])
        devices = [
            {'id': 'demo-kaffee', 'name': 'Kaffeemaschine', 'manufacturer': 'Demotec', 'model': 'Aroma 7',
             'category': 'Haushalt', 'notes': 'Fiktives Beispiel: Filter nach Herstellerangabe wechseln. Reinigung bei Geräteanzeige.'},
            {'id': 'demo-spueler', 'name': 'Geschirrspüler', 'manufacturer': 'Klarwerk', 'model': 'Silent 60',
             'category': 'Haushalt', 'notes': 'Fiktives Beispiel für eine wiederkehrende Wartungsrotation.'},
            {'id': 'demo-wasser', 'name': 'Wasserenthärtungsanlage', 'manufacturer': 'Aquanova', 'model': 'Soft 25',
             'category': 'Haushalt', 'notes': 'Vorrat im Salzbehälter prüfen und bei Bedarf nachfüllen.',
             'related_devices': [{'id': 'demo-spueler'}]},
            {'id': 'demo-fenster', 'name': 'Fenstersensor Arbeitszimmer', 'manufacturer': 'DemoSense', 'model': 'Contact 2',
             'category': 'Tür- und Fenstermelder', 'battery_type': 'CR2032', 'battery_quantity': 1,
             'battery_entity_id': 'sensor.demo_fenster_batterie', 'battery_alert_enabled': True,
             'notes': 'Fiktiver Sensor. Der niedrige Batteriestand demonstriert die automatische Warnaufgabe.'},
            {'id': 'demo-rauch', 'name': 'Rauchmelder Flur', 'manufacturer': 'DemoSafe', 'model': 'Smoke One',
             'category': 'Gefahrenmelder', 'battery_type': '9V', 'battery_quantity': 1,
             'battery_entity_id': 'sensor.demo_rauch_batterie', 'battery_alert_enabled': True},
            {'id': 'demo-maeher', 'name': 'Rasenmäher', 'manufacturer': 'DemoGarden', 'model': 'Green 400',
             'category': 'Garten', 'notes': 'Vor dem Saisonstart Messer, Räder und Gehäuse prüfen.'},
            {'id': 'demo-schloss', 'name': 'Türschloss', 'manufacturer': 'DemoAccess', 'model': 'Entry 2',
             'category': 'Zutritt', 'battery_type': 'AA', 'battery_quantity': 4,
             'battery_entity_id': 'sensor.demo_schloss_batterie', 'battery_alert_enabled': True,
             'related_devices': [{'id': 'demo-fenster'}]},
            {'id': 'demo-thermo', 'name': 'Temperatursensor Wintergarten', 'manufacturer': 'DemoSense', 'model': 'Climate Mini',
             'category': 'Temperatursensoren', 'battery_type': 'AA', 'battery_quantity': 2,
             'battery_entity_id': 'sensor.demo_thermo_batterie', 'battery_alert_enabled': True},
        ]
        for device in devices:
            await api.mutate('save_device', value=device)
        for entity, value in [('fenster', 12), ('rauch', 88), ('schloss', 46), ('thermo', 64)]:
            await api.request('POST', '/api/states/sensor.demo_' + entity + '_batterie',
                              {'state': str(value), 'attributes': {'friendly_name': 'Demo Batteriestand',
                               'unit_of_measurement': '%', 'device_class': 'battery'}})
        await api.mutate('battery_inventory', stocks={'CR2032': 0, 'AA': 8, 'AAA': 1, '9V': 2},
                         thresholds={'CR2032': 1, 'AA': 4, 'AAA': 2, '9V': 1},
                         notes={'CR2032': 'Für den Fenstersensor. Beim Einkauf auf die Bauform achten.',
                                'AA': 'Für Türschloss und Temperatursensor; sechs Stück im Einsatz.',
                                'AAA': 'Reserve für weitere kleine Geräte.', '9V': 'Reserve für den Rauchmelder.'})
        for material in [
            {'id': 'demo-filter', 'name': 'Wasserfilter', 'unit': 'Stück', 'quantity': 1, 'threshold': 1,
             'notes': 'Passend zur Demo-Kaffeemaschine. Ein Filter pro Wechsel.', 'device_ids': ['demo-kaffee']},
            {'id': 'demo-salz', 'name': 'Regeneriersalz', 'unit': 'kg', 'quantity': 4.5, 'threshold': 5,
             'notes': 'Tablettensalz trocken lagern. Nachkauf in 10-kg-Säcken.', 'device_ids': ['demo-wasser']},
            {'id': 'demo-reiniger', 'name': 'Maschinenreiniger', 'unit': 'Flasche', 'quantity': 3, 'threshold': 1,
             'notes': 'Eine Flasche pro Intensivreinigung. Packungsanleitung beachten.', 'device_ids': ['demo-spueler']},
        ]:
            await api.mutate('save_consumable', value=material)
        coffee_completed = months_before(today - timedelta(days=3), 2)
        dishwasher_completed = months_before(today - timedelta(days=2), 1)
        rules = [
            {'id': 'demo-filter-wechsel', 'device_id': 'demo-kaffee', 'name': 'Wasserfilter wechseln',
             'kind': 'interval', 'months': 2, 'days': 0, 'first_due': coffee_completed.isoformat(),
             'consumable': {'kind': 'material', 'id': 'demo-filter', 'quantity': 1}},
            {'id': 'demo-spueler-pflege', 'device_id': 'demo-spueler', 'name': 'Maschinenpflege',
             'kind': 'rotation', 'months': 1, 'first_due': dishwasher_completed.isoformat(),
             'steps': ['Intensivreinigung', 'Sieb und Sprüharme reinigen'],
             'consumables_by_step': {'Intensivreinigung': {'kind': 'material', 'id': 'demo-reiniger', 'quantity': 1}}},
            {'id': 'demo-salz-pruefen', 'device_id': 'demo-wasser', 'name': 'Salz nachfüllen',
             'kind': 'date', 'due_date': today.isoformat(),
             'consumable': {'kind': 'material', 'id': 'demo-salz', 'quantity': 2.5}},
            {'id': 'demo-rauch-test', 'device_id': 'demo-rauch', 'name': 'Funktionstest durchführen',
             'kind': 'date', 'due_date': (today + timedelta(days=7)).isoformat()},
            {'id': 'demo-maeher-service', 'device_id': 'demo-maeher', 'name': 'Saisonstart vorbereiten',
             'kind': 'season', 'month': 3, 'day': 15, 'weekday': 5, 'first_cycle': today.year + 1},
            {'id': 'demo-schloss-pruefen', 'device_id': 'demo-schloss', 'name': 'Zutrittscodes prüfen',
             'kind': 'date', 'due_date': (today + timedelta(days=3)).isoformat(),
             'booked': (today + timedelta(days=3)).isoformat()},
        ]
        for rule in rules:
            await api.mutate('save_rule', value=rule)
        await api.mutate('complete', rule_id='demo-filter-wechsel', operation_id='demo-filter-completion',
                         event_date=coffee_completed.isoformat(), note='Wasserfilter wechseln — Filter eingesetzt und gespült.',
                         consume_material=True)
        await api.mutate('complete', rule_id='demo-spueler-pflege', operation_id='demo-clean-completion', cycle=0,
                         event_date=dishwasher_completed.isoformat(), note='Reinigungsprogramm vollständig durchgeführt.',
                         consume_material=True)
        for log in [
            {'id': 'demo-kauf', 'device_id': 'demo-kaffee', 'kind': 'purchase',
             'event_date': (today - timedelta(days=240)).isoformat(), 'cost': 649,
             'note': 'Kaffeemaschine gekauft. Fiktives Beispiel ohne Händlerbeleg.'},
            {'id': 'demo-maeher-historie', 'device_id': 'demo-maeher', 'kind': 'maintenance',
             'event_date': (today - timedelta(days=180)).isoformat(), 'cost': 79,
             'note': 'Messer ersetzt, Gehäuse gereinigt und Funktionsprüfung durchgeführt.'},
        ]:
            await api.mutate('add_log', value=log)
        result = await api.action('get')
        check(len(result['devices']) == 8, 'Expected eight fictional devices')
        check(len(result['rules']) == 6 and len(result['logs']) == 4, 'Expected six tasks and four history entries')
        check(result['settings']['consumables']['demo-filter']['quantity'] == 0, 'Confirmed material consumption')
        check(sum(not item.get('done') for item in result['shopping'].values()) == 4, 'Expected four automatic purchase reminders')
        check(any(view['status'] == 'overdue' for view in result['views']), 'Expected overdue task')
        check((await api.request('GET', '/api/states/sensor.demo_fenster_batterie'))['state'] == '12', 'Low-battery demo state')
        print('PASS: 8 fictional devices, 6 tasks, 4 history entries, 4 automatic purchase reminders; battery example 12 % / 20 %')
        print('Demo data is intentionally synthetic. REST-created battery states are temporary and disappear on restart.')


if __name__ == '__main__':
    asyncio.run(main())
