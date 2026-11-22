"""Recorded consumption is credited to today's stock, not a stale snapshot."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_components' / 'ha_wartung'))
from materials import return_event_stock


class ReturnEventStock(unittest.TestCase):
    def test_modern_battery_preserves_subsequent_purchases(self):
        data = {'settings': {'battery_inventory': {'AA': 11, 'AAA': 8}}}
        movement = {'kind': 'battery', 'id': 'AA', 'quantity': 2, 'before': 3, 'after': 1}
        event = {'material_stock_movement': movement}
        original = deepcopy(event)
        legacy, modern = return_event_stock(data, event)
        self.assertIsNone(legacy)
        self.assertIs(modern, movement)
        self.assertEqual(data['settings']['battery_inventory'], {'AA': 13, 'AAA': 8})
        self.assertEqual(event, original)

    def test_legacy_battery_preserves_current_stock_and_existing_arithmetic(self):
        data = {'settings': {'battery_inventory': {'AA': 11}}}
        movement = {'type': 'AA', 'quantity': 2, 'before': 3, 'after': 1}
        event = {'battery_stock_movement': movement}
        legacy, modern = return_event_stock(data, event)
        self.assertIs(legacy, movement)
        self.assertIsNone(modern)
        self.assertEqual(data['settings']['battery_inventory']['AA'], 13)
        empty = {}
        return_event_stock(empty, event)
        self.assertEqual(empty, {'settings': {'battery_inventory': {'AA': 2}}})

    def test_material_preserves_current_quantity_and_rounding(self):
        material = {'id': 'salt', 'name': 'Salz', 'quantity': 3.2, 'notes': 'Keep'}
        data = {'settings': {'consumables': {'salt': material}}}
        movement = {'kind': 'material', 'id': 'salt', 'quantity': 1.5}
        self.assertEqual(return_event_stock(data, {'material_stock_movement': movement}), (None, movement))
        self.assertEqual(material, {'id': 'salt', 'name': 'Salz', 'quantity': 4.7, 'notes': 'Keep'})

    def test_removed_material_uses_existing_deleted_material_fallback(self):
        material = {'id': 'salt', 'quantity': -1}
        data = {'settings': {'consumables': {}, 'deleted_consumables': {'salt': material}}}
        return_event_stock(data, {'material_stock_movement': {'kind': 'material', 'id': 'salt', 'quantity': 2}})
        self.assertEqual(material['quantity'], 1)
        self.assertEqual(data['settings']['consumables'], {})

    def test_event_with_both_formats_keeps_material_then_legacy_order(self):
        data = {'settings': {'battery_inventory': {'AA': 0.123456789}}}
        modern = {'kind': 'battery', 'id': 'AA', 'quantity': 0.000000002}
        legacy = {'type': 'AA', 'quantity': 0.000000003}
        # The modern path rounds to eight decimals before the legacy addition.
        expected = round(0.123456789 + modern['quantity'], 8) + legacy['quantity']
        result = return_event_stock(data, {'material_stock_movement': modern, 'battery_stock_movement': legacy})
        self.assertEqual(result, (legacy, modern))
        self.assertEqual(data['settings']['battery_inventory']['AA'], expected)

    def test_missing_movements_are_a_noop_without_creating_settings(self):
        data = {'other': 'Keep'}
        self.assertEqual(return_event_stock(data, {}), (None, None))
        self.assertEqual(data, {'other': 'Keep'})

    def test_failed_material_return_does_not_credit_legacy_movement(self):
        data = {'settings': {'consumables': {'salt': {'quantity': None}}, 'battery_inventory': {'AA': 5}}}
        original = deepcopy(data)
        event = {'material_stock_movement': {'kind': 'material', 'id': 'salt', 'quantity': 1},
                 'battery_stock_movement': {'type': 'AA', 'quantity': 2}}
        with self.assertRaisesRegex(ValueError, 'Materialbestand zuerst'):
            return_event_stock(data, event)
        self.assertEqual(data, original)


if __name__ == '__main__':
    unittest.main()
