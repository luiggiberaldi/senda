"""Sistema de diseño Senda para informes PDF financieros.
Diseño senior: portada con degradado flama, KPIs con deltas, gráficos de barras,
recuadro de destacados y tablas editoriales.
"""
from pathlib import Path

# ── Paleta Senda ──────────────────────────────────────────────
EMBER      = (248, 72, 24)
BLAZE      = (248, 136, 8)
GOLD       = (248, 184, 8)
EMBER_DARK = (206, 63, 20)
NAVY       = (26, 52, 66)
NAVY_SOFT  = (52, 78, 92)
GREEN      = (22, 148, 96)
RED        = (214, 69, 69)
GRAY       = (120, 120, 120)
GRAY_L     = (243, 244, 245)
GRAY_LINE  = (228, 230, 232)
WHITE      = (255, 255, 255)
GOLD_TINT  = (255, 249, 232)

LOGO = str(Path.home() / "workspace/habitos/public/senda/logo.png")
F_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
F_BLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

PW, ML = 210, 14          # ancho página, margen lateral
CW = PW - 2 * ML          # ancho contenido = 182

from fpdf import FPDF


class SendaPDF(FPDF):
    pie_texto = ""

    def setup(self):
        self.add_font("ds", "", F_REG)
        self.add_font("ds", "B", F_BLD)
        self.set_auto_page_break(auto=True, margin=20)

    def footer(self):
        self.set_y(-14)
        self.set_draw_color(*EMBER)
        self.set_line_width(0.7)
        self.line(ML, self.get_y(), PW - ML, self.get_y())
        self.ln(2.5)
        self.set_font("ds", "", 7.5)
        self.set_text_color(*GRAY)
        self.cell(0, 4, f"{self.pie_texto}   ·   {self.page_no()}/{{nb}}", align="C")


def _interp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def degradado(pdf, x, y, w, h, c1, c2, pasos=48):
    for i in range(pasos):
        pdf.set_fill_color(*_interp(c1, c2, i / (pasos - 1)))
        pdf.rect(x + i * w / pasos, y, w / pasos + 0.4, h, "F")


def fmt_usd(v):
    return f"${v:,.2f}"


# ── Portada ───────────────────────────────────────────────────
def portada(pdf, eyebrow, titulo_grande, subtitulo):
    # franja blanca con logo
    pdf.set_fill_color(*WHITE)
    pdf.rect(0, 0, PW, 17, "F")
    try:
        pdf.image(LOGO, x=ML, y=4.5, w=30)
    except Exception:
        pass
    pdf.set_xy(PW - ML - 60, 6)
    pdf.set_font("ds", "B", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(60, 5, "S E N D A   ·   F I N A N Z A S", align="R")
    # héroe con degradado flama
    degradado(pdf, 0, 17, PW, 46, EMBER, GOLD)
    # velo oscuro sutil a la izquierda para legibilidad
    pdf.set_fill_color(0, 0, 0)
    # eyebrow
    pdf.set_xy(ML, 26)
    pdf.set_font("ds", "B", 9)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 6, eyebrow.upper())
    # título grande
    pdf.set_xy(ML, 33)
    pdf.set_font("ds", "B", 26)
    pdf.cell(0, 12, titulo_grande)
    # subtítulo
    pdf.set_xy(ML, 48)
    pdf.set_font("ds", "", 10)
    pdf.cell(0, 6, subtitulo)
    pdf.set_y(70)


# ── Título de sección ─────────────────────────────────────────
def seccion(pdf, numero, titulo):
    pdf.set_font("ds", "B", 8)
    pdf.set_text_color(*EMBER)
    pdf.cell(10, 7, f"{numero:02d}")
    pdf.set_font("ds", "B", 12.5)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 7, titulo, new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*GRAY_LINE)
    pdf.set_line_width(0.3)
    pdf.line(ML, pdf.get_y() + 1, PW - ML, pdf.get_y() + 1)
    pdf.ln(4)


# ── Tarjetas KPI ──────────────────────────────────────────────
def kpis(pdf, cards):
    """cards: (etiqueta, valor, color, delta_texto|None, delta_bueno|None)"""
    n = len(cards)
    gap = 5
    w = (CW - gap * (n - 1)) / n
    h = 32
    y = pdf.get_y()
    for i, card in enumerate(cards):
        etiqueta, valor, color = card[0], card[1], card[2]
        delta = card[3] if len(card) > 3 else None
        bueno = card[4] if len(card) > 4 else True
        x = ML + i * (w + gap)
        pdf.set_fill_color(*WHITE)
        pdf.set_draw_color(*GRAY_LINE)
        pdf.set_line_width(0.3)
        pdf.rect(x, y, w, h, "DF")
        pdf.set_fill_color(*color)
        pdf.rect(x, y, w, 2.4, "F")
        pdf.set_xy(x + 5, y + 6)
        pdf.set_font("ds", "", 7.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(w - 10, 4.5, etiqueta.upper())
        pdf.set_xy(x + 5, y + 12)
        pdf.set_font("ds", "B", 15)
        pdf.set_text_color(*NAVY)
        pdf.cell(w - 10, 8, valor)
        if delta:
            pdf.set_xy(x + 5, y + 22)
            pdf.set_font("ds", "B", 8)
            pdf.set_text_color(*(GREEN if bueno else RED))
            pdf.cell(w - 10, 4.5, delta)
    pdf.set_y(y + h + 7)


# ── Recuadro de destacados ────────────────────────────────────
def destacados(pdf, items):
    if not items:
        return
    y0 = pdf.get_y()
    pdf.set_font("ds", "", 9)
    # medir altura
    h = 12 + len(items) * 6.2
    if y0 + h > 275:
        pdf.add_page()
        y0 = pdf.get_y()
    pdf.set_fill_color(*GOLD_TINT)
    pdf.rect(ML, y0, CW, h, "F")
    pdf.set_fill_color(*GOLD)
    pdf.rect(ML, y0, 3, h, "F")
    pdf.set_xy(ML + 8, y0 + 3.5)
    pdf.set_font("ds", "B", 8.5)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 5, "DESTACADOS DEL PERÍODO", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("ds", "", 9)
    pdf.set_text_color(*NAVY_SOFT)
    for it in items:
        pdf.set_x(ML + 8)
        pdf.cell(4, 6.2, "•")
        pdf.cell(0, 6.2, it, new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(y0 + h + 7)


# ── Barras horizontales por categoría ─────────────────────────
def barras_categorias(pdf, cats, total, max_filas=10):
    """cats: lista de (nombre, monto). Dibuja barras proporcionales."""
    cats = sorted(cats, key=lambda c: c[1], reverse=True)[:max_filas]
    if not cats or total <= 0:
        return
    maxv = cats[0][1]
    y = pdf.get_y()
    nombre_w, barra_w, val_w, pct_w = 52, 68, 34, 28
    for i, (nombre, monto) in enumerate(cats):
        if y > 262:
            pdf.add_page()
            y = pdf.get_y()
        frac = monto / maxv
        pct = monto / total * 100
        # nombre
        pdf.set_xy(ML, y)
        pdf.set_font("ds", "", 8.8)
        pdf.set_text_color(*NAVY)
        pdf.cell(nombre_w, 7.5, nombre[:24])
        # riel + barra con degradado por posición
        bx = ML + nombre_w + 2
        pdf.set_fill_color(*GRAY_L)
        pdf.rect(bx, y + 1.2, barra_w, 5, "F")
        color = _interp(EMBER, GOLD, i / max(len(cats) - 1, 1))
        pdf.set_fill_color(*color)
        pdf.rect(bx, y + 1.2, barra_w * frac, 5, "F")
        # valor + %
        pdf.set_xy(bx + barra_w + 3, y)
        pdf.set_font("ds", "B", 8.8)
        pdf.cell(val_w, 7.5, fmt_usd(monto), align="R")
        pdf.set_font("ds", "", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(pct_w, 7.5, f"{pct:.1f}%", align="R")
        y += 9.2
    pdf.set_y(y + 3)


# ── Gráfico de barras verticales (12 meses) ───────────────────
def grafico_meses(pdf, meses):
    """meses: dict {1..12: (ing, egr)}. Barras agrupadas verde/rojo."""
    labels = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]
    vals = [meses.get(i, (0, 0)) for i in range(1, 13)]
    vmax = max([max(v) for v in vals] + [1])

    gx, gy, gw, gh = ML, pdf.get_y() + 2, CW, 62
    # líneas de referencia
    pdf.set_draw_color(*GRAY_LINE)
    pdf.set_line_width(0.25)
    pdf.set_font("ds", "", 7)
    pdf.set_text_color(*GRAY)
    for k in range(5):
        yy = gy + gh - k * gh / 4
        pdf.line(gx, yy, gx + gw, yy)
        pdf.set_xy(gx - 2, yy - 3)
        pdf.cell(14, 6, fmt_usd(vmax * k / 4), align="R")

    gxx = gx + 16
    gw2 = gw - 16
    grupo_w = gw2 / 12
    bw = min(9, grupo_w * 0.28)
    for i, (ing, egr) in enumerate(vals):
        cx = gxx + i * grupo_w + grupo_w / 2
        # egreso (fondo)
        he = egr / vmax * gh
        pdf.set_fill_color(*RED)
        pdf.rect(cx - bw - 1, gy + gh - he, bw, he, "F")
        # ingreso (frente)
        hi = ing / vmax * gh
        pdf.set_fill_color(*GREEN)
        pdf.rect(cx + 1, gy + gh - hi, bw, hi, "F")
        # etiqueta mes
        pdf.set_xy(cx - grupo_w / 2, gy + gh + 1.5)
        pdf.set_font("ds", "", 7.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(grupo_w, 5, labels[i], align="C")
    # leyenda
    ly = gy + gh + 9
    pdf.set_fill_color(*GREEN)
    pdf.rect(gx + 16, ly, 4, 4, "F")
    pdf.set_xy(gx + 22, ly - 1)
    pdf.set_font("ds", "", 8)
    pdf.set_text_color(*NAVY)
    pdf.cell(24, 6, "Ingresos")
    pdf.set_fill_color(*RED)
    pdf.rect(gx + 48, ly, 4, 4, "F")
    pdf.set_xy(gx + 54, ly - 1)
    pdf.cell(24, 6, "Egresos")
    pdf.set_y(ly + 9)


# ── Tabla editorial ───────────────────────────────────────────
def tabla(pdf, headers, rows, anchos, aligns=None, money_cols=()):
    aligns = aligns or ["L"] * len(headers)
    # encabezados: versalitas grises, sin fondo pesado
    pdf.set_font("ds", "B", 7.5)
    pdf.set_text_color(*GRAY)
    for j, htxt in enumerate(headers):
        pdf.cell(anchos[j], 6, htxt.upper(), align=aligns[j])
    pdf.ln(7.5)  # bajar la altura completa de la fila de encabezados
    pdf.set_draw_color(*NAVY)
    pdf.set_line_width(0.5)
    pdf.line(ML, pdf.get_y(), PW - ML, pdf.get_y())
    pdf.ln(2.5)
    pdf.set_font("ds", "", 9)
    for i, row in enumerate(rows):
        if pdf.get_y() > 268:
            pdf.add_page()
        if i % 2 == 1:
            pdf.set_fill_color(*GRAY_L)
            pdf.rect(ML, pdf.get_y(), CW, 7.2, "F")
        y0 = pdf.get_y()
        negrita = bool(row and row[0] in ("TOTAL",))
        for j, val in enumerate(row):
            c = NAVY
            if j in money_cols and isinstance(val, str):
                c = GREEN if val.strip().startswith("+") else (RED if val.strip().startswith("-") else NAVY)
            pdf.set_text_color(*c)
            pdf.set_font("ds", "B" if negrita else "", 9)
            pdf.set_xy(ML + sum(anchos[:j]), y0)
            pdf.cell(anchos[j], 7.2, str(val), align=aligns[j])
        pdf.set_y(y0 + 7.2)
    pdf.set_draw_color(*EMBER)
    pdf.set_line_width(0.6)
    pdf.line(ML, pdf.get_y() + 1, PW - ML, pdf.get_y() + 1)
    pdf.ln(6)
    pdf.set_text_color(*NAVY)


def nueva_portada(titulo_eyebrow, titulo_grande, subtitulo, pie):
    pdf = SendaPDF()
    pdf.setup()
    pdf.pie_texto = pie
    pdf.alias_nb_pages("{nb}")
    pdf.add_page()
    portada(pdf, titulo_eyebrow, titulo_grande, subtitulo)
    return pdf
