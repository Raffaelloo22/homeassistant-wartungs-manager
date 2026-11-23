"""Render a bounded, read-only inventory projection as a printable PDF."""
from base64 import b64encode
from io import BytesIO
from math import isfinite
from pathlib import Path
from threading import Lock
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

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
    result, references, total_characters = [], 0, 0
    for item in items:
        if not isinstance(item, dict) or item.get('kind') not in ('battery', 'material'):
            raise ValueError('Ungültige Artikelgruppe im PDF.')
        name = _text(item.get('name'), 500, 'Bezeichnung')
        unit = _text(item.get('unit'), 80, 'Einheit')
        quantity = item.get('quantity')
        if quantity is not None and (type(quantity) not in (int, float)
                                     or not -100000 <= quantity <= 100000 or not isfinite(quantity)):
            raise ValueError('Ungültiger Bestand im PDF.')
        devices = item.get('devices')
        if not isinstance(devices, list) or len(devices) > 1000:
            raise ValueError('Ungültige Geräteliste im PDF.')
        devices = [_text(device, 500, 'Gerätename') for device in devices]
        references += len(devices)
        total_characters += len(name) + len(unit) + sum(len(device) for device in devices)
        if references > 10000 or total_characters > 1000000:
            raise ValueError('Die Artikelliste ist für ein PDF zu umfangreich.')
        result.append(dict(kind=item['kind'], name=name, quantity=quantity, unit=unit, devices=devices))
    return dict(items=result, query=query, assigned_only=assigned_only)


def _fonts():
    with _FONT_LOCK:
        registered = set(pdfmetrics.getRegisteredFontNames())
        folder = Path(reportlab.__file__).parent / 'fonts'
        for name, filename in (('WartungVera', 'Vera.ttf'), ('WartungVeraBold', 'VeraBd.ttf')):
            if name not in registered:
                pdfmetrics.registerFont(TTFont(name, str(folder / filename)))


def _markup(text):
    return escape(text).replace('\r\n', '\n').replace('\r', '\n').replace('\n', '<br/>')


def _quantity(value):
    if value is None:
        return '—'
    return format(value, '.8f').rstrip('0').rstrip('.') or '0'


def build_inventory_pdf(payload, when):
    """Return a PDF download without writing files or accessing a Home Assistant object."""
    data = validate_inventory_pdf(payload)
    _fonts()
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
                                 topMargin=19 * mm, bottomMargin=20 * mm,
                                 title='Verbrauchsmaterial', author='Wartungs-Manager',
                                 pageCompression=1)
    normal = ParagraphStyle('WartungBody', fontName='WartungVera', fontSize=9,
                            leading=13, textColor=_INK, splitLongWords=True)
    muted = ParagraphStyle('WartungMuted', parent=normal, fontSize=8, leading=12, textColor=_MUTED)
    title = ParagraphStyle('WartungTitle', parent=normal, fontName='WartungVeraBold',
                           fontSize=23, leading=29, spaceAfter=6)
    group_style = ParagraphStyle('WartungGroup', parent=normal, fontName='WartungVeraBold',
                                 fontSize=12, leading=16, textColor=_PETROL,
                                 spaceBefore=0, spaceAfter=0)
    header = ParagraphStyle('WartungHeader', parent=normal, fontName='WartungVeraBold',
                            fontSize=8, leading=11, textColor=_PETROL)
    stock_style = ParagraphStyle('WartungStock', parent=normal, fontName='WartungVeraBold',
                                 fontSize=11, leading=14, alignment=TA_RIGHT)
    name_style = ParagraphStyle('WartungName', parent=normal, fontName='WartungVeraBold', alignment=TA_LEFT)
    story = [Paragraph('Verbrauchsmaterial', title),
             Paragraph('Stand: ' + when.strftime('%d.%m.%y · %H:%M') + ' · '
                       + str(len(data['items'])) + ' Artikel', muted)]
    filters = []
    if data['query']:
        filters.append('Suche: ' + data['query'])
    if data['assigned_only']:
        filters.append('Material ohne Gerätezuordnung ausgeblendet')
    if filters:
        story.append(Paragraph(_markup(' · '.join(filters)), muted))
    story.append(Spacer(1, 5 * mm))
    for kind, label in (('battery', 'Batterien'), ('material', 'Weitere Verbrauchsmaterialien')):
        group = [item for item in data['items'] if item['kind'] == kind]
        if not group:
            continue
        story.append(Spacer(1, 4 * mm))
        rows = [[Paragraph(label + ' · ' + str(len(group)), group_style), '', ''],
                [Paragraph('Bestand', header), Paragraph('Bezeichnung', header), Paragraph('Geräte', header)]]
        for item in group:
            amount = Paragraph(_markup(_quantity(item['quantity'])), stock_style)
            quantity = [amount, Paragraph(_markup(item['unit']), muted)]
            devices = ', '.join(item['devices']) if item['devices'] else 'Keine Gerätezuordnung'
            rows.append([quantity, Paragraph(_markup(item['name']), name_style), Paragraph(_markup(devices), normal)])
        table = LongTable(rows, colWidths=[23 * mm, 64 * mm, document.width - 87 * mm],
                          repeatRows=2, hAlign='LEFT', splitByRow=1, splitInRow=1)
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('SPAN', (0, 0), (-1, 0)),
            ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#E8F3F3')),
            ('LINEBELOW', (0, 1), (-1, 1), 0.6, colors.HexColor('#8BBFC2')),
            ('ROWBACKGROUNDS', (0, 2), (-1, -1), [colors.white, colors.HexColor('#F5F8F8')]),
            ('LINEBELOW', (0, 2), (-1, -1), 0.3, colors.HexColor('#E0E7E9')),
            ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ]))
        story.append(table)
    if not data['items']:
        story.append(Paragraph('Keine Artikel für die gewählte Ansicht.', normal))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#D7E0E3'))
        canvas.setLineWidth(0.5)
        canvas.line(document.leftMargin, 15 * mm, A4[0] - document.rightMargin, 15 * mm)
        canvas.setFont('WartungVera', 7)
        canvas.setFillColor(_MUTED)
        canvas.drawString(document.leftMargin, 10 * mm, 'Wartungs-Manager · Verbrauchsmaterial')
        canvas.drawRightString(A4[0] - document.rightMargin, 10 * mm, 'Seite ' + str(doc.page))
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return dict(filename='Verbrauchsmaterial-' + when.strftime('%d.%m.%y') + '.pdf',
                content_type='application/pdf', data=b64encode(output.getvalue()).decode('ascii'))
