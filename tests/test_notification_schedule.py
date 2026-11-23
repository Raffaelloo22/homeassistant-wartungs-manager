"""Notification cadence keeps local periods, partial settings and legacy weekly data safe."""
import ast
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from backend_test_support import DirectoryTestCase, deepcopy, engine, ns

SOURCE = ast.parse((Path(__file__).resolve().parents[1] / 'custom_components/ha_wartung/__init__.py').read_text())
DIRECTORY = next(node for node in SOURCE.body if isinstance(node, ast.ClassDef) and node.name == 'Directory')
TICK = next(node for node in DIRECTORY.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'tick')
TICK_MODULE = ast.Module(body=[TICK], type_ignores=[])
ast.fix_missing_locations(TICK_MODULE)
ZURICH = ZoneInfo('Europe/Zurich')


def local(year, month, day, hour=9, minute=0, **kwargs):
    return datetime(year, month, day, hour, minute, tzinfo=ZURICH, **kwargs)


class NotificationSchedule(DirectoryTestCase):
    def directory(self, settings, now):
        obj = self.obj()
        obj.data['settings'].update(settings)
        obj.tick_lock = asyncio.Lock()
        sent = []
        async def digest():
            sent.append(deepcopy(obj.data['settings']))
        obj.digest = digest
        clock = SimpleNamespace(value=now)
        namespace = {'engine': engine, 'deepcopy': deepcopy,
                     'dt_util': SimpleNamespace(now=lambda: clock.value)}
        exec(compile(TICK_MODULE, 'notification_tick', 'exec'), namespace)
        return obj, sent, clock, namespace['tick']

    async def save(self, obj, value):
        return await ns['execute'](obj, 'settings', {'revision': obj.data['revision'], 'value': value})

    async def test_legacy_weekly_schedule_and_persisted_week_keep_existing_behavior(self):
        settings = {'enabled': True, 'weekday': 0, 'time': '09:00'}
        obj, sent, clock, tick = self.directory(settings, local(2026, 11, 23, 8, 59))
        before = deepcopy(obj.data)
        await tick(obj, None)
        self.assertEqual(obj.data, before)
        clock.value = local(2026, 11, 23, 9, 0)
        await tick(obj, None)
        self.assertEqual(len(sent), 1)
        self.assertEqual(obj.data['settings']['last_week'], '2026-48')
        self.assertNotIn('notification_frequency', obj.data['settings'])
        self.assertNotIn('monthday', obj.data['settings'])
        revision = obj.data['revision']
        await tick(obj, None)
        self.assertEqual(len(sent), 1)
        self.assertEqual(obj.data['revision'], revision)
        # A new object with persisted settings models a process restart.
        restarted, repeated, _, tick = self.directory(deepcopy(obj.data['settings']), clock.value)
        await tick(restarted, None)
        self.assertEqual(repeated, [])
        clock.value = local(2026, 11, 24, 12, 0)
        self.assertIsNone(engine.notification_due_period(obj.data['settings'], clock.value))

    async def test_daily_sends_once_per_local_date_and_again_on_the_next_date(self):
        obj, sent, clock, tick = self.directory(
            {'enabled': True, 'notification_frequency': 'daily', 'time': '09:00'}, local(2026, 11, 23))
        await tick(obj, None)
        self.assertEqual(obj.data['settings']['last_notification_day'], '2026-11-23')
        clock.value = local(2026, 11, 23, 23, 59)
        await tick(obj, None)
        self.assertEqual(len(sent), 1)
        restarted, repeated, _, restarted_tick = self.directory(deepcopy(obj.data['settings']), clock.value)
        await restarted_tick(restarted, None)
        self.assertEqual(repeated, [])
        clock.value = local(2026, 11, 24)
        await tick(obj, None)
        self.assertEqual(len(sent), 2)
        self.assertEqual(obj.data['settings']['last_notification_day'], '2026-11-24')

    async def test_monthly_clamps_to_month_end_and_does_not_catch_up_on_later_days(self):
        for year, month, actual in [(2027, 2, 28), (2028, 2, 29), (2027, 4, 30), (2027, 5, 31)]:
            with self.subTest(year=year, month=month):
                obj, sent, clock, tick = self.directory(
                    {'enabled': True, 'notification_frequency': 'monthly', 'monthday': 31, 'time': '09:00'},
                    local(year, month, actual - 1, 23, 59))
                await tick(obj, None)
                self.assertEqual(sent, [])
                clock.value = local(year, month, actual)
                await tick(obj, None)
                await tick(obj, None)
                self.assertEqual(len(sent), 1)
                self.assertEqual(obj.data['settings']['last_notification_month'], f'{year}-{month:02}')
        settings = {'enabled': True, 'notification_frequency': 'monthly', 'monthday': 10, 'time': '09:00'}
        self.assertIsNone(engine.notification_due_period(settings, local(2026, 11, 11, 12)))

    async def test_periods_use_ha_local_time_and_dst_repeated_hour_cannot_duplicate(self):
        # UTC Sunday is already Monday in the configured HA timezone.
        utc = datetime(2026, 11, 22, 23, 30, tzinfo=timezone.utc)
        settings = {'enabled': True, 'weekday': 0, 'time': '00:15'}
        obj, sent, _, tick = self.directory(settings, utc.astimezone(ZURICH))
        await tick(obj, utc)
        self.assertEqual(len(sent), 1)
        self.assertEqual(obj.data['settings']['last_week'], '2026-48')
        obj, sent, clock, tick = self.directory(
            {'enabled': True, 'notification_frequency': 'daily', 'time': '02:30'},
            local(2026, 10, 25, 2, 30, fold=0))
        await tick(obj, None)
        clock.value = local(2026, 10, 25, 2, 30, fold=1)
        await tick(obj, None)
        self.assertEqual(len(sent), 1)
        self.assertEqual(obj.data['settings']['last_notification_day'], '2026-10-25')
        self.assertEqual(engine.notification_due_period({'enabled': True, 'weekday': 4, 'time': '09:00'},
                                                       local(2021, 1, 1)), ('last_week', '2020-53'))

    async def test_disabled_missing_settings_and_reading_defaults_do_not_mutate(self):
        for settings in ({}, {'enabled': False, 'notification_frequency': 'daily'}, {'enabled': False, 'notification_frequency': 'monthly'}):
            obj, sent, _, tick = self.directory(settings, local(2026, 11, 23, 12))
            before = deepcopy(obj.data)
            await tick(obj, None)
            self.assertEqual(obj.data, before)
            self.assertEqual(sent, [])
        self.assertIsNone(engine.notification_due_period({'enabled': True}, local(2026, 11, 23, 12)),
                          'legacy weekly records without a weekday keep their existing non-delivery behavior')
        settings = {'enabled': True, 'notification_frequency': 'monthly'}
        before = deepcopy(settings)
        self.assertEqual(engine.notification_due_period(settings, local(2026, 12, 1)),
                         ('last_notification_month', '2026-12'))
        self.assertEqual(settings, before)

    async def test_concurrent_ticks_and_cadence_switches_retain_their_period_guards(self):
        obj, sent, _, tick = self.directory({'enabled': True, 'notification_frequency': 'daily'}, local(2026, 11, 23))
        entered, release = asyncio.Event(), asyncio.Event()
        async def held_digest():
            sent.append(True)
            entered.set()
            await release.wait()
        obj.digest = held_digest
        first = asyncio.create_task(tick(obj, None))
        await entered.wait()
        await tick(obj, None)
        self.assertEqual(sent, [True])
        release.set()
        await first
        obj.data['settings'].update(last_week='2026-48', last_notification_month='2026-11', weekday=0, monthday=23)
        for frequency in ('weekly', 'monthly', 'daily'):
            obj.data['settings']['notification_frequency'] = frequency
            await tick(obj, None)
        self.assertEqual(sent, [True], 'switching modes must not forget a period already delivered in that mode')

    async def test_partial_settings_write_only_requested_schedule_fields(self):
        obj = self.obj()
        before = deepcopy(obj.data)
        await self.save(obj, {'notification_frequency': 'monthly'})
        expected = deepcopy(before)
        expected['settings']['notification_frequency'] = 'monthly'
        expected['revision'] += 1
        self.assertEqual(obj.data, expected, 'partial writes must not fill defaults into old data')
        for value in ({'enabled': True}, {'monthday': 31}, {'time': '11:45:00'}, {'weekday': 4}):
            await self.save(obj, value)
        self.assertEqual(obj.data['settings']['time'], '11:45')
        self.assertEqual(obj.data['settings']['monthday'], 31)
        self.assertEqual(obj.data['settings']['weekday'], 4)
        self.assertTrue(obj.data['settings']['enabled'])
        await self.save(obj, {'notification_frequency': 'daily', 'battery_inventory': {'AA': 999}})
        self.assertNotIn('battery_inventory', obj.data['settings'])
        self.assertEqual(obj.data['settings']['monthday'], 31, 'hidden mode-specific settings remain available when switching back')

    async def test_invalid_schedule_writes_and_imports_are_atomic(self):
        bad = [None, [], 'daily']
        bad += [{'notification_frequency': x} for x in ('yearly', '', None, True, [], {})]
        bad += [{'monthday': x} for x in (0, 32, 1.5, True, '1', None)]
        bad += [{'weekday': x} for x in (-1, 7, True, '0', None)]
        bad += [{'enabled': x} for x in (0, 1, '', None)]
        bad += [{'time': x} for x in ('', '9:30', '25:00', '09:60', '10:30+01:00', None, 930)]
        for value in bad:
            with self.subTest(value=value):
                obj = self.obj()
                before = deepcopy(obj.data)
                async def forbidden_commit(_):
                    self.fail('invalid schedule must not reach storage')
                obj.commit = forbidden_commit
                with self.assertRaises(ValueError):
                    await self.save(obj, value)
                self.assertEqual(obj.data, before)
        for value in [x for x in bad if isinstance(x, dict)]:
            with self.subTest(imported=value):
                incoming = engine.blank()
                incoming['settings'] = deepcopy(value)
                before = deepcopy(incoming)
                with self.assertRaises(ValueError):
                    engine.validate_data(incoming)
                self.assertEqual(incoming, before)

    async def test_export_restore_and_data_reset_retain_schedule_without_migration(self):
        obj = self.obj()
        obj.data['settings'].update(notification_frequency='monthly', monthday=31, enabled=True,
                                    weekday=5, time='08:15', last_week='2026-46')
        exported = await ns['execute'](obj, 'export', {})
        self.assertEqual(exported, obj.data)
        self.assertIsNot(exported['settings'], obj.data['settings'])
        before = deepcopy(exported)
        self.assertIs(engine.validate_data(exported), exported)
        self.assertEqual(exported, before)
        await ns['execute'](obj, 'restore', {'revision': obj.data['revision'], 'value': exported})
        removed = []
        async def remove_rollback():
            removed.append(True)
        obj.rollback = SimpleNamespace(async_remove=remove_rollback)
        await ns['execute'](obj, 'reset_all_data', {'revision': obj.data['revision'], 'confirmed': True,
                                                'confirmation': 'DATEN ZURÜCKSETZEN'})
        self.assertEqual(obj.data['settings'], before['settings'])
        self.assertEqual(removed, [True])
