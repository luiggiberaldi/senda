#!/usr/bin/env python3
"""Informe financiero mensual en PDF - Senda.
Genera el reporte del mes anterior con ingresos, egresos, balance y desglose por categoría.
Uso: python3 informe-mensual-pdf.py [--mes YYYY-MM] [--out /ruta/salida.pdf]
"""
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

# Config
PROJECT_REF = "diqjwidceauuhppbxtwm"
MGMT_CLI = str(Path.home() / "workspace/skills/supabase-mgmt/bin/mgmt.py")
USER_ID = "7d6a7bf4-c99f-479d-8785-8ce17909f758"

MESES_ES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

def run_query(sql):
    """Ejecuta SQL vía Management API y retorna el JSON."""
    import tempfile, os
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump({"query": sql}, f)
        fname = f.name
    try:
        r = subprocess.run(
            ["python3", MGMT_CLI, "POST", f"/v1/projects/{PROJECT_REF}/database/query",
             "--data-file", fname],
            capture_output=True, text=True, timeout=60
        )
        out = r.stdout
        start = out.find('[{')
        if start < 0:
            start = out.find('[]')
            if start >= 0:
                return []
            raise RuntimeError(f"Respuesta inesperada: {out[:200]}")
        return json.loads(out[start:])
    finally:
        os.unlink(fname)

def mes_anterior(ym):
    y, m = map(int, ym.split("-"))
    if m == 1:
        return f"{y-1}-12"
    return f"{y}-{m-1:02d}"

def obtener_totales(ym):
    """Retorna (ingresos, egresos) del mes YYYY-MM."""
    y, m = map(int, ym.split("-"))
    ini = f"{ym}-01"
    fin = f"{y+1}-01-01" if m == 12 else f"{y}-{m+1:02d}-01"
    q = f"""SELECT
      ROUND(SUM(CASE WHEN m.tipo='ingreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as ing,
      ROUND(SUM(CASE WHEN m.tipo='egreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as egr
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'"""
    r = run_query(q)[0]
    return float(r["ing"] or 0), float(r["egr"] or 0)

def obtener_datos(ym):
    """Retorna (ing, egr, ing_prev, egr_prev, cats, top) del mes YYYY-MM."""
    ing, egr = obtener_totales(ym)
    prev_ym = mes_anterior(ym)
    ing_prev, egr_prev = obtener_totales(prev_ym)

    y, m = map(int, ym.split("-"))
    ini = f"{ym}-01"
    fin = f"{y+1}-01-01" if m == 12 else f"{y}-{m+1:02d}-01"

    # Por categoría (egresos)
    q2 = f"""SELECT m.categoria, COUNT(*) as n,
      ROUND(SUM((m.monto * m.tasa_usd)),2) as total
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL AND m.tipo='egreso'
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'
    GROUP BY m.categoria ORDER BY total DESC"""
    cats = run_query(q2)

    # Top movimientos
    q3 = f"""SELECT m.fecha, m.tipo, m.nota, m.monto, c.moneda, m.categoria,
      ROUND((m.monto * m.tasa_usd),2) as usd
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'
    ORDER BY (m.monto * m.tasa_usd) DESC LIMIT 20"""
    top = run_query(q3)

    return ing, egr, ing_prev, egr_prev, prev_ym, cats, top

def generar_pdf(ym, ing, egr, ing_prev, egr_prev, prev_ym, cats, top, out_path):
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from informe_pdf_estilo import (nueva_portada, seccion, kpis, destacados,
                                    barras_categorias, tabla, fmt_usd,
                                    GREEN, RED, NAVY, ML, CW)
    from datetime import date

    y, m = map(int, ym.split("-"))
    titulo_mes = f"{MESES_ES[m]} {y}"
    py, pm = map(int, prev_ym.split("-"))
    bal = ing - egr

    pdf = nueva_portada(
        "Informe financiero mensual",
        titulo_mes,
        f"Senda · Del 1 al {_ultimo_dia(y, m)} de {MESES_ES[m].lower()} de {y}",
        f"Senda · Informe mensual {titulo_mes} · Generado {date.today().strftime('%d/%m/%Y')}",
    )

    # ── KPIs con deltas ──
    def pct(a, b):
        if not b:
            return None
        v = (a - b) / b * 100
        return f"{'▲' if v >= 0 else '▼'} {'+' if v >= 0 else ''}{v:.1f}% vs {MESES_ES[pm][:3].lower()}"

    kpis(pdf, [
        ("Ingresos", fmt_usd(ing), GREEN, pct(ing, ing_prev), True),
        ("Egresos", fmt_usd(egr), RED, pct(egr, egr_prev), (egr or 0) <= (egr_prev or 0)),
        ("Balance", fmt_usd(bal), NAVY, None, True),
    ])

    # ── Destacados automáticos ──
    feats = []
    cat_top = sorted(cats, key=lambda c: float(c["total"]), reverse=True)
    if cat_top:
        c0 = cat_top[0]
        nombre = (c0["categoria"] or "sin categoría")
        pv = float(c0["total"]) / egr * 100 if egr else 0
        feats.append(f"Tu mayor gasto fue {nombre}: {fmt_usd(float(c0['total']))} ({pv:.0f}% de los egresos)")
    feats.append(
        f"Cerraste el mes en {'positivo' if bal >= 0 else 'negativo'}: "
        f"{'+' if bal >= 0 else ''}{fmt_usd(bal)}"
    )
    ing_top = next((t for t in top if t["tipo"] == "ingreso"), None)
    if ing_top:
        nota = (ing_top["nota"] or "")[:36]
        feats.append(f"Mayor ingreso: {nota} (+{fmt_usd(float(ing_top['usd']))})")
    destacados(pdf, feats[:3])

    # ── Gasto por categoría (barras) ──
    seccion(pdf, 1, "Gasto por categoría")
    barras_categorias(pdf, [(c["categoria"] or "sin categoría", float(c["total"])) for c in cats], egr)

    # ── Comparativa vs mes anterior ──
    seccion(pdf, 2, f"Comparación vs {MESES_ES[pm]} {py}")
    bal_prev = ing_prev - egr_prev

    def var_txt(a, b):
        p = pct(a, b)
        return p.replace("▲ ", "").replace("▼ ", "") if p else "s/d"

    tabla(pdf,
          ["Concepto", MESES_ES[pm], titulo_mes, "Variación"],
          [["Ingresos", fmt_usd(ing_prev), fmt_usd(ing), var_txt(ing, ing_prev)],
           ["Egresos", fmt_usd(egr_prev), fmt_usd(egr), var_txt(egr, egr_prev)],
           ["Balance", fmt_usd(bal_prev), fmt_usd(bal), "—"]],
          [58, 42, 42, 40], ["L", "R", "R", "R"])

    # ── Movimientos destacados ──
    seccion(pdf, 3, "Movimientos destacados")
    mrows = []
    for t in top:
        signo = "+" if t["tipo"] == "ingreso" else "-"
        nota = (t["nota"] or "")[:44]
        mrows.append([t["fecha"], nota, f"{signo}{fmt_usd(float(t['usd']))}"])
    tabla(pdf, ["Fecha", "Detalle", "Monto"], mrows, [28, 116, 38],
          ["L", "L", "R"], money_cols=(2,))

    pdf.output(str(out_path))
    return out_path


def _ultimo_dia(y, m):
    import calendar
    return calendar.monthrange(y, m)[1]

def main():
    args = sys.argv[1:]
    ym = None
    out = None
    i = 0
    while i < len(args):
        if args[i] == "--mes" and i + 1 < len(args):
            ym = args[i + 1]; i += 2
        elif args[i] == "--out" and i + 1 < len(args):
            out = args[i + 1]; i += 2
        else:
            i += 1
    # Por defecto: mes anterior
    if not ym:
        hoy = date.today()
        primero = hoy.replace(day=1)
        anterior = primero - timedelta(days=1)
        ym = anterior.strftime("%Y-%m")
    if not out:
        out = Path.home() / f"workspace/your_files/Informe-Financiero-{ym}.pdf"
    else:
        out = Path(out)

    print(f"Generando informe de {ym}...", flush=True)
    ing, egr, ing_prev, egr_prev, prev_ym, cats, top = obtener_datos(ym)
    generar_pdf(ym, ing, egr, ing_prev, egr_prev, prev_ym, cats, top, out)
    print(f"OK: {out}")
    print(f"Ingresos ${ing:,.2f} (prev ${ing_prev:,.2f}) | Egresos ${egr:,.2f} (prev ${egr_prev:,.2f}) | Balance ${ing-egr:,.2f}")

if __name__ == "__main__":
    main()
