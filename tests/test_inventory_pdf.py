"""Validate the printable inventory, page flow, Unicode, and read-only endpoint."""
from base64 import b64decode
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import unittest

from pypdf import PdfReader

from backend_test_support import DirectoryTestCase, deepcopy, ns
from inventory_pdf import build_inventory_pdf, validate_inventory_pdf

WHEN = datetime(2026, 11, 23, 14, 20)


def item(**changes):
    return {**dict(kind='battery', name='AA Batterie', quantity=4, unit='Stück',
                   devices=['Türsensor - Zimmer Eléa', 'Rauchmelder - Büro']), **changes}


def payload(items=None, **changes):
    return {**dict(items=[item()] if items is None else items, query='', assigned_only=False), **changes}


def read_pdf(value):
    return PdfReader(BytesIO(b64decode(value['data'], validate=True)))


class InventoryPdf(unittest.TestCase):
    def test_unicode_embedded_fonts_decimal_point_and_literal_markup(self):
        data = payload([item(), dict(kind='material', name='Salz <b> & Reiniger', quantity=-1.5,
                                     unit='25 kg Säcke', devices=['Gerät <a href="https://example.com">'])])
        before = deepcopy(data)
        result = build_inventory_pdf(data, WHEN)
        self.assertEqual(result['filename'], 'Verbrauchsmaterial-23.11.26.pdf')
        self.assertEqual(result['content_type'], 'application/pdf')
        reader = read_pdf(result)
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        for expected in ('Verbrauchsmaterial', 'Stand: 23.11.26', 'Batterien', 'Weitere Verbrauchsmaterialien',
                         'Türsensor - Zimmer Eléa', 'Büro', 'Stück', '-1.5', 'Salz <b> & Reiniger', 'Seite 1'):
            self.assertIn(expected, text)
        self.assertNotIn('/Annots', reader.pages[0], 'Payload markup never creates PDF links or annotations')
        self.assertNotIn('/JavaScript', reader.trailer['/Root'])
        fonts = reader.pages[0]['/Resources']['/Font'].get_object().values()
        self.assertTrue(any('/FontFile2' in font.get_object().get('/FontDescriptor', {}) for font in fonts),
                        'The portable document embeds a Unicode TrueType font')
        self.assertEqual(data, before)

    def test_multiple_pages_repeat_headers_and_number_every_page(self):
        items = [dict(kind='material', name=f'Filter {index:03d}', quantity=index / 2,
                      unit='Stück', devices=[f'Gerät {number:02d} - Küche und Wohnzimmer' for number in range(5)])
                 for index in range(70)]
        result = build_inventory_pdf(payload(items), WHEN)
        reader = read_pdf(result)
        self.assertGreater(len(reader.pages), 2)
        text = '\n'.join(page.extract_text() for page in reader.pages)
        self.assertIn('Filter 000', text)
        self.assertIn('Filter 069', text)
        for index, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            self.assertIn('Bestand', text)
            self.assertIn('Bezeichnung', text)
            self.assertIn('Geräte', text)
            self.assertIn('Seite ' + str(index), text)
            self.assertAlmostEqual(float(page.mediabox.width), 595.2756, places=3)
            self.assertAlmostEqual(float(page.mediabox.height), 841.8898, places=3)

    def test_very_long_device_lists_split_across_pages_without_losing_names(self):
        devices = [f'Gerät {index:03d} - Sehr lange Gerätebezeichnung mit Eléa & Büro Süd' for index in range(150)]
        result = build_inventory_pdf(payload([item(devices=devices)]), WHEN)
        reader = read_pdf(result)
        self.assertGreater(len(reader.pages), 1)
        text = '\n'.join(page.extract_text() for page in reader.pages)
        for index in range(150):
            self.assertIn(f'Gerät {index:03d}', text)

    def test_empty_selection_and_filter_context_are_explicit(self):
        result = build_inventory_pdf(dict(items=[], query='Filter & Salz', assigned_only=True), WHEN)
        text = read_pdf(result).pages[0].extract_text()
        self.assertIn('0 Artikel', text)
        self.assertIn('Suche: Filter & Salz', text)
        self.assertIn('Material ohne Gerätezuordnung ausgeblendet', text)
        self.assertIn('Keine Artikel', text)
        self.assertNotIn('Weitere Verbrauchsmaterialien', text)

    def test_null_stock_and_unassigned_devices_are_printable(self):
        result = build_inventory_pdf(payload([item(quantity=None, devices=[])]), WHEN)
        text = read_pdf(result).pages[0].extract_text()
        self.assertIn('—', text)
        self.assertIn('Keine Gerätezuordnung', text)

    def test_invalid_numbers_types_and_bounds_are_rejected(self):
        invalid = [None, [], {}, dict(items='wrong'), dict(items=[{}]), dict(items=[item()] * 1001),
                   dict(items=[], assigned_only='true'), dict(items=[], query='q' * 201)]
        for value in (True, '2', float('nan'), float('inf'), -100001, 100001, 10 ** 1000):
            invalid.append(payload([item(quantity=value)]))
        for changes in ({'kind': 'unknown'}, {'name': ''}, {'name': 'x' * 501}, {'name': '\x00'}, {'name': '\ud800'},
                        {'unit': None}, {'unit': 'x' * 81}, {'devices': 'wrong'}, {'devices': [None]},
                        {'devices': ['']}, {'devices': ['x' * 501]}, {'devices': ['d'] * 1001}):
            invalid.append(payload([item(**changes)]))
        invalid.append(payload([item(devices=['x'] * 1000)] * 11))
        invalid.append(payload([item(devices=['x' * 500] * 1000)] * 3))
        for value in invalid:
            with self.subTest(value=str(value)[:100]):
                with self.assertRaises(ValueError):
                    validate_inventory_pdf(value)


class InventoryPdfEndpoint(DirectoryTestCase):
    async def test_download_uses_executor_and_never_checks_revision_or_commits(self):
        obj = self.obj()
        before = deepcopy(obj.data)
        def forbidden(*args):
            self.fail('A PDF download must not use mutation checks or writes')
        obj.check_revision = forbidden
        obj.commit = forbidden
        executor = AsyncMock(side_effect=lambda function, *args: function(*args))
        obj.hass = SimpleNamespace(async_add_executor_job=executor)
        request = payload()
        with patch.dict(ns, build_inventory_pdf=build_inventory_pdf):
            result = await ns['execute'](obj, 'inventory_pdf', request)
        self.assertTrue(b64decode(result['data']).startswith(b'%PDF-'))
        self.assertEqual(executor.await_args.args[0], build_inventory_pdf)
        self.assertEqual(executor.await_args.args[1], request)
        self.assertEqual(obj.data, before)

    async def test_invalid_export_does_not_change_directory(self):
        obj = self.obj()
        before = deepcopy(obj.data)
        obj.hass = SimpleNamespace(async_add_executor_job=AsyncMock(side_effect=lambda function, *args: function(*args)))
        with patch.dict(ns, build_inventory_pdf=build_inventory_pdf):
            with self.assertRaises(ValueError):
                await ns['execute'](obj, 'inventory_pdf', payload([item(quantity=True)]))
        self.assertEqual(obj.data, before)
