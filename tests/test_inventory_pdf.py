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

    def test_multiple_pages_repeat_only_column_headers_and_number_every_page(self):
        items = [item()]
        items += [dict(kind='material', name=f'Filter {index:03d}', quantity=index / 2,
                       unit='Stück', devices=['Gerät A', 'Gerät B']) for index in range(90)]
        reader = read_pdf(build_inventory_pdf(payload(items), WHEN))
        self.assertGreater(len(reader.pages), 1)
        combined = '\n'.join(page.extract_text() for page in reader.pages)
        self.assertIn('Filter 000', combined)
        self.assertIn('Filter 089', combined)
        self.assertEqual(combined.count('Batterien · 1'), 1)
        self.assertEqual(combined.count('Weitere Verbrauchsmaterialien · 90'), 1)
        self.assertEqual(combined.count('Verbrauchsmaterial\n'), 1, 'The title appears on the first page only')
        for index, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            for header in ('Bestand', 'Bezeichnung', 'Geräte'):
                self.assertIn(header, text)
            self.assertIn('Seite ' + str(index), text)
            self.assertAlmostEqual(float(page.mediabox.width), 595.2756, places=3)
            self.assertAlmostEqual(float(page.mediabox.height), 841.8898, places=3)
            forms = page['/Resources']['/XObject']
            logo = forms['/FormXob.WartungsManagerLogo'].get_object()
            self.assertEqual(logo['/Subtype'], '/Form')
            self.assertEqual(list(logo['/BBox']), [0, 0, 256, 256])
            self.assertIn(b'/FormXob.WartungsManagerLogo Do', page.get_contents().get_data())

    def test_long_device_lists_are_one_line_with_an_exact_remaining_count(self):
        for count in (20, 150):
            with self.subTest(count=count):
                devices = [f'Gerät {index:03d} - Eléa' for index in range(count)]
                reader = read_pdf(build_inventory_pdf(payload([item(devices=devices)]), WHEN))
                self.assertEqual(len(reader.pages), 1)
                text = reader.pages[0].extract_text()
                shown = sum(name in text for name in devices)
                self.assertGreater(shown, 0)
                self.assertLess(shown, count)
                self.assertIn(f'(+{count - shown} Geräte)', text)
                self.assertIn('Lange Angaben werden mit … gekürzt.', text)
        reader = read_pdf(build_inventory_pdf(payload([item(devices=['Ein sehr langer Gerätename ' * 15])]), WHEN))
        self.assertIn('…', reader.pages[0].extract_text())
        self.assertNotIn('(+1 Gerät)', reader.pages[0].extract_text())
        self.assertEqual(len(reader.pages), 1)
        for count in (2, 20, 150):
            devices = ['Ein sehr langer Gerätename ' * 15] + ['Weiteres Gerät'] * (count - 1)
            text = read_pdf(build_inventory_pdf(payload([item(devices=devices)]), WHEN)).pages[0].extract_text()
            suffix = f'(+{count - 1} ' + ('Gerät)' if count == 2 else 'Geräte)')
            self.assertIn(suffix, text)
            self.assertIn('Ein sehr langer Gerätename', text)

    def test_one_line_per_material_one_regular_font_and_uniform_row_spacing(self):
        items = [dict(kind='material', name=f'Artikel {index:03d}', quantity=index + 0.5,
                      unit='Stück', devices=['Gerät A', 'Gerät B']) for index in range(40)]
        reader = read_pdf(build_inventory_pdf(payload(items), WHEN))
        self.assertEqual(len(reader.pages), 1)
        spans = []
        reader.pages[0].extract_text(visitor_text=lambda text, cm, tm, font, size:
                                     spans.append((text.strip(), tm[4], tm[5], font, size)) if text.strip() else None)
        previous = None
        for index in range(40):
            matching = [span for span in spans if span[0] == f'Artikel {index:03d}']
            self.assertEqual(len(matching), 1)
            _, _, baseline, _, _ = matching[0]
            row = [span for span in spans if span[2] == baseline]
            self.assertEqual(len(row), 3, 'Stock with unit, material name and devices each use one line')
            self.assertEqual(row[0][0], f'{index + 0.5} Stück')
            self.assertTrue(all(span[4] == 8 for span in row))
            self.assertEqual(len({span[3]['/BaseFont'] for span in row}), 1)
            self.assertTrue(str(row[0][3]['/BaseFont']).endswith('BitstreamVeraSans-Roman'))
            if previous is not None:
                self.assertAlmostEqual(previous - baseline, 14)
            previous = baseline
        self.assertNotIn('Lange Angaben', reader.pages[0].extract_text())

    def test_stock_numbers_are_complete_and_long_fields_never_overlap(self):
        from inventory_pdf import _quantity, _width
        values = [99999.12345678, -99999.12345678, 1.2345678901234567, 1e-100, 100000, -100000]
        items = [dict(kind='material', name=f'Material {index}: ' + 'Name' * 100, quantity=value,
                      unit='Lange Einheit ' * 5, devices=['Sehr langes Gerät ' * 25])
                 for index, value in enumerate(values)]
        reader = read_pdf(build_inventory_pdf(payload(items), WHEN))
        spans = []
        reader.pages[0].extract_text(visitor_text=lambda text, cm, tm, font, size:
                                     spans.append((text.strip(), tm[4], tm[5], size)) if text.strip() else None)
        for index, value in enumerate(values):
            name = next(span for span in spans if span[0].startswith(f'Material {index}:'))
            row = sorted((span for span in spans if span[2] == name[2]), key=lambda span: span[1])
            self.assertEqual(len(row), 3)
            self.assertTrue(row[0][0].startswith(_quantity(value)))
            for left, right in zip(row, row[1:]):
                self.assertLessEqual(left[1] + _width(left[0]), right[1])
            self.assertLessEqual(row[-1][1] + _width(row[-1][0]), 595.2756 - 12 * 72 / 25.4)
        text = reader.pages[0].extract_text()
        self.assertIn('99999.12345678', text)
        self.assertIn('1.2345678901234567', text)
        self.assertIn('1e-100', text)

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
        self.assertNotIn('Keine Gerätezuordnung', text)
        self.assertIn('— Stück', text)

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
