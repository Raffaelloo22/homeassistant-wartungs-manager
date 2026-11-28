"""Render a bounded, read-only inventory projection as a printable PDF."""
from base64 import b64encode
from io import BytesIO
from decimal import Decimal
from math import isfinite
from pathlib import Path
from threading import Lock

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

_FONT_LOCK = Lock()
_INK = colors.HexColor('#24333A')
_MUTED = colors.HexColor('#66777D')
_PETROL = colors.HexColor('#157F88')


def _text(value, maximum, label, *, empty=False):
    if (not isinstance(value, str) or len(value) > maximum
            or not empty and not value.strip()
            or any((ord(character) < 32 and character not in '\n\r\t')
                   or 0xD800 <= ord(character) <= 0xDFFF for character in value)):
        raise ValueError('Ungültiger PDF-Text: ' + label)
    return value.strip()


def validate_inventory_pdf(payload):
    """Copy and validate presentation data; never inspect or mutate stored records."""
    if not isinstance(payload, dict):
        raise ValueError('Ungültige PDF-Daten.')
    items = payload.get('items')
    if not isinstance(items, list) or len(items) > 1000:
        raise ValueError('Für ein PDF sind höchstens 1000 Artikel erlaubt.')
    query = _text(payload.get('query', ''), 200, 'Suchbegriff', empty=True)
    assigned_only = payload.get('assigned_only', False)
    if type(assigned_only) is not bool:
        raise ValueError('Ungültiger Zuordnungsfilter im PDF.')
    assignment = payload.get('assignment_filter', 'with' if assigned_only else 'all')
    if not isinstance(assignment, str) or assignment not in ('all', 'with', 'without'):
        raise ValueError('Ungültiger Zuordnungsfilter im PDF.')
    result, references, total_characters = [], 0, 0
    for item in items:
        if not isinstance(item, dict) or item.get('kind') not in ('battery', 'material'):
            raise ValueError('Ungültige Artikelgruppe im PDF.')
        name = _text(item.get('name'), 500, 'Bezeichnung')
        unit = _text(item.get('unit'), 80, 'Einheit')
        usage = _text(item.get('usage', ''), 200, 'Batteriebedarf', empty=True)
        quantity = item.get('quantity')
        if quantity is not None and (type(quantity) not in (int, float)
                                     or not -100000 <= quantity <= 100000 or not isfinite(quantity)):
            raise ValueError('Ungültiger Bestand im PDF.')
        devices = item.get('devices')
        if not isinstance(devices, list) or len(devices) > 1000:
            raise ValueError('Ungültige Geräteliste im PDF.')
        devices = [_text(device, 500, 'Gerätename') for device in devices]
        references += len(devices)
        total_characters += len(name) + len(unit) + len(usage) + sum(len(device) for device in devices)
        if references > 10000 or total_characters > 1000000:
            raise ValueError('Die Artikelliste ist für ein PDF zu umfangreich.')
        result.append(dict(kind=item['kind'], name=name, quantity=quantity, unit=unit, devices=devices, usage=usage))
    return dict(items=result, query=query, assignment_filter=assignment)


def _fonts():
    with _FONT_LOCK:
        registered = set(pdfmetrics.getRegisteredFontNames())
        folder = Path(reportlab.__file__).parent / 'fonts'
        for name, filename in (('WartungVera', 'Vera.ttf'),):
            if name not in registered:
                pdfmetrics.registerFont(TTFont(name, str(folder / filename)))


def _one_line(text):
    return ' '.join(text.split())


def _quantity(value):
    if value is None:
        return '—'
    if value == 0:
        return '0'
    text = str(value)
    if 'e' in text.lower():
        fixed = format(Decimal(text), 'f')
        # Preserve the exact supplied decimal value without hundreds of zeros.
        return fixed if len(fixed) <= 24 else text
    return text[:-2] if text.endswith('.0') else text


def _width(text, size=8):
    return pdfmetrics.stringWidth(text, 'WartungVera', size)


def _prefix(text, width):
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if _width(text[:middle]) <= width:
            low = middle
        else:
            high = middle - 1
    return text[:low].rstrip()


def _fit(text, width):
    text = _one_line(text)
    if _width(text) <= width:
        return text, False
    if width < _width('…'):
        return '', True
    return _prefix(text, width - _width('…')) + '…', True


def _device_suffix(remaining):
    return '… (+' + str(remaining) + (' Gerät)' if remaining == 1 else ' Geräte)')


def _device_text(devices, width):
    names = [_one_line(name) for name in devices]
    if not names:
        return '—', False
    if len(names) == 1:
        return _fit(names[0], width)
    if sum(_width(name) for name in names) + max(0, len(names) - 1) * _width(', ') <= width:
        return ', '.join(names), False
    shown = []
    for name in names:
        remaining = len(names) - len(shown) - 1
        suffix = _device_suffix(remaining)
        candidate = ', '.join([*shown, name, suffix])
        if _width(candidate) > width:
            break
        shown.append(name)
    remaining = len(names) - len(shown)
    suffix = _device_suffix(remaining)
    if shown:
        return ', '.join([*shown, suffix]), True
    # A shortened first name still represents one visible device.
    remaining = len(names) - 1
    suffix = _device_suffix(remaining)
    prefix = _prefix(names[0], max(0, width - _width(' ' + suffix)))
    return (prefix + ' ' if prefix else '') + suffix, True


def _usage_devices_text(devices, usage, width):
    """Keep the shared UI summary before names, with space for a device and count."""
    if not usage:
        return _device_text(devices, width)[0]
    minimum = _width('—')
    if devices:
        first = _one_line(devices[0])[:1]
        tail = ' ' + _device_suffix(len(devices) - 1) if len(devices) > 1 else '…'
        minimum = _width(first + tail)
    summary, _ = _fit(usage, max(0, width - minimum - _width(' · ')))
    prefix = summary + ' · ' if summary else ''
    names, _ = _device_text(devices, max(0, width - _width(prefix)))
    return prefix + names


def _logo(canvas):
    """The existing brand/icon.svg geometry, embedded once as a reusable vector."""
    canvas.beginForm('WartungsManagerLogo', 0, 0, 256, 256)
    canvas.setFillColor(colors.HexColor('#147D8B'))
    canvas.roundRect(12, 12, 232, 232, 56, stroke=0, fill=1)
    canvas.setStrokeColor(colors.white)
    canvas.setLineWidth(20)
    canvas.setLineCap(1)
    canvas.setLineJoin(1)
    house = canvas.beginPath()
    house.moveTo(166, 85)
    for x, y in ((128, 52), (64, 107), (64, 193), (192, 193), (192, 147)):
        house.lineTo(x, y)
    canvas.drawPath(house, stroke=1, fill=0)
    canvas.setFillColor(colors.white)
    hexagon = canvas.beginPath()
    hexagon.moveTo(192, 94)
    for x, y in ((206, 102), (206, 118), (192, 126), (178, 118), (178, 102)):
        hexagon.lineTo(x, y)
    hexagon.close()
    canvas.drawPath(hexagon, stroke=0, fill=1)
    canvas.endForm()


def build_inventory_pdf(payload, when):
    """Render one line per material without writes or access to a Home Assistant object."""
    data = validate_inventory_pdf(payload)
    if data['assignment_filter'] != 'all':
        assigned = data['assignment_filter'] == 'with'
        data['items'] = [item for item in data['items'] if bool(item['devices']) == assigned]
    _fonts()
    page_size = landscape(A4)
    page_width, page_height = page_size
    left, right = 12 * mm, page_width - 12 * mm
    usable = right - left
    # Keep the complete stock number; only its unit may be shortened.
    stock_width = max(30 * mm, max((_width(_quantity(item['quantity'])) + 4 for item in data['items']), default=0))
    name_width = 75 * mm
    widths = [stock_width, name_width, usable - stock_width - name_width]
    starts = [left, left + stock_width, left + stock_width + name_width]
    rows = []
    for item in data['items']:
        amount = _quantity(item['quantity'])
        unit, _ = _fit(item['unit'], max(0, widths[0] - 4 - _width(amount + ' '))) if item['kind'] != 'battery' else ('', False)
        stock = amount + (' ' + unit if unit else '')
        name, _ = _fit(item['name'], widths[1] - 8)
        usage = item['usage'] if item['kind'] == 'battery' else ''
        devices = _usage_devices_text(item['devices'], usage, widths[2] - 8)
        rows.append(dict(kind=item['kind'], stock=stock, name=name, devices=devices))
    output = BytesIO()
    canvas = Canvas(output, pagesize=page_size, pageCompression=1)
    canvas.setTitle('Verbrauchsmaterial')
    canvas.setAuthor('Wartungs-Manager')
    _logo(canvas)
    page_number, y = 0, 0
    row_height, header_height, bottom = 14, 16, 20 * mm

    def new_page():
        nonlocal page_number, y
        if page_number:
            canvas.showPage()
        page_number += 1
        y = page_height - 12 * mm
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#D7E0E3'))
        canvas.setLineWidth(0.4)
        canvas.line(left, 17 * mm, right, 17 * mm)
        logo_size = 8 * mm
        canvas.translate(left, 16 * mm)
        canvas.scale(logo_size / 256, -logo_size / 256)
        canvas.doForm('WartungsManagerLogo')
        canvas.restoreState()
        canvas.setFont('WartungVera', 7)
        canvas.setFillColor(_MUTED)
        canvas.drawString(left + 10 * mm, 10.7 * mm, 'Wartungs-Manager')
        canvas.drawCentredString(page_width / 2, 10.7 * mm, when.strftime('%d.%m.%y · %H:%M'))
        canvas.drawRightString(right, 10.7 * mm, 'Seite ' + str(page_number))
        if page_number == 1:
            canvas.setFillColor(_INK)
            canvas.setFont('WartungVera', 17)
            canvas.drawString(left, y - 17, 'Verbrauchsmaterial')
            y -= 30

    def column_header():
        nonlocal y
        canvas.setFillColor(colors.HexColor('#E8F3F3'))
        canvas.rect(left, y - header_height, usable, header_height, stroke=0, fill=1)
        canvas.setFont('WartungVera', 8)
        canvas.setFillColor(_PETROL)
        canvas.drawRightString(starts[1] - 2, y - 11, 'Bestand')
        canvas.drawString(starts[1] + 4, y - 11, 'Bezeichnung')
        canvas.drawString(starts[2] + 4, y - 11, 'Geräte')
        y -= header_height

    new_page()
    for kind, label in (('battery', 'Batterien'), ('material', 'Weitere Verbrauchsmaterialien')):
        group = [row for row in rows if row['kind'] == kind]
        if not group:
            continue
        # A group title is printed once, together with its header and first row.
        if y - (22 + header_height + row_height) < bottom:
            new_page()
        canvas.setFont('WartungVera', 9)
        canvas.setFillColor(_PETROL)
        canvas.drawString(left, y - 13, label + ' · ' + str(len(group)))
        y -= 22
        column_header()
        for index, row in enumerate(group):
            if y - row_height < bottom:
                new_page()
                column_header()
            if index % 2:
                canvas.setFillColor(colors.HexColor('#F5F8F8'))
                canvas.rect(left, y - row_height, usable, row_height, stroke=0, fill=1)
            canvas.setFont('WartungVera', 8)
            canvas.setFillColor(_INK)
            canvas.drawRightString(starts[1] - 2, y - 10, row['stock'])
            canvas.drawString(starts[1] + 4, y - 10, row['name'])
            canvas.drawString(starts[2] + 4, y - 10, row['devices'])
            y -= row_height
        y -= 8
    if not rows:
        canvas.setFont('WartungVera', 8)
        canvas.setFillColor(_MUTED)
        canvas.drawString(left, y - 10, 'Keine Artikel für die gewählte Ansicht.')
    canvas.save()
    return dict(filename='Verbrauchsmaterial-' + when.strftime('%d.%m.%y') + '.pdf',
                content_type='application/pdf', data=b64encode(output.getvalue()).decode('ascii'))
