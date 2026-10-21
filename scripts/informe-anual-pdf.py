#!/usr/bin/env python3
"""Informe financiero anual en PDF - Senda.
Genera el reporte del año anterior: resumen, mes por mes, por categoría y top movimientos.
Uso: python3 informe-anual-pdf.py [--ano YYYY] [--out /ruta/salida.pdf]
"""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

PROJECT_REF = "diqjwidceauuhppbxtwm"
MGMT_CLI = str(Path.home() / "workspace/skills/supabase-mgmt/bin/mgmt.py")
USER_ID = "7d6a7bf4-c99f-479d-8785-8ce17909f758"

MESES_ES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
            "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
MESES_FULL = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
              "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

def run_query(sql):
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

def obtener_datos(ano):
    ini = f"{ano}-01-01"
    fin = f"{ano+1}-01-01"

    # Totales del año
    q = f"""SELECT
      ROUND(SUM(CASE WHEN m.tipo='ingreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as ing,
      ROUND(SUM(CASE WHEN m.tipo='egreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as egr
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'"""
    r = run_query(q)[0]
    ing = float(r["ing"] or 0)
    egr = float(r["egr"] or 0)

    # Mes por mes
    q2 = f"""SELECT EXTRACT(MONTH FROM m.fecha)::int as mes,
      ROUND(SUM(CASE WHEN m.tipo='ingreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as ing,
      ROUND(SUM(CASE WHEN m.tipo='egreso' THEN (m.monto * m.tasa_usd) ELSE 0 END),2) as egr
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'
    GROUP BY mes ORDER BY mes"""
    meses = {int(r["mes"]): (float(r["ing"] or 0), float(r["egr"] or 0)) for r in run_query(q2)}

    # Por categoría (egresos del año)
    q3 = f"""SELECT m.categoria, COUNT(*) as n,
      ROUND(SUM((m.monto * m.tasa_usd)),2) as total
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL AND m.tipo='egreso'
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'
    GROUP BY m.categoria ORDER BY total DESC LIMIT 15"""
    cats = run_query(q3)

    # Top movimientos del año
    q4 = f"""SELECT m.fecha, m.tipo, m.nota, m.monto, c.moneda,
      ROUND((m.monto * m.tasa_usd),2) as usd
    FROM fin_movimientos m JOIN fin_cuentas c ON c.id=m.cuenta_id
    WHERE m.user_id='{USER_ID}' AND m.anulado_en IS NULL
      AND COALESCE(m.categoria,'')!='traspaso'
      AND m.fecha>='{ini}' AND m.fecha<'{fin}'
    ORDER BY (m.monto * m.tasa_usd) DESC LIMIT 15"""
    top = run_query(q4)

    return ing, egr, meses, cats, top

def generar_pdf(ano, ing, egr, meses, cats, top, out_path):
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from informe_pdf_estilo import (nueva_portada, seccion, kpis, destacados,
                                    barras_categorias, grafico_meses, tabla,
                                    fmt_usd, GREEN, RED, NAVY, ML, CW)
    from datetime import date

    bal = ing - egr
    pdf = nueva_portada(
        "Informe financiero anual",
        str(ano),
        f"Senda · 1 de enero al 31 de diciembre de {ano}",
        f"Senda · Informe anual {ano} · Generado {date.today().strftime('%d/%m/%Y')}",
    )

    # ── KPIs ──
    tasa_ahorro = f"{bal / ing * 100:.1f}% de lo ingresado" if ing > 0 else "s/d"
    kpis(pdf, [
        ("Ingresos", fmt_usd(ing), GREEN),
        ("Egresos", fmt_usd(egr), RED),
        ("Balance", fmt_usd(bal), NAVY),
    ])

    # ── Destacados automáticos ──
    feats = []
    pares = [(i, meses.get(i, (0, 0))) for i in range(1, 13)]
    con_mov = [(i, v) for i, v in pares if v[0] > 0 or v[1] > 0]
    if con_mov:
        mejor = max(con_mov, key=lambda x: x[1][0] - x[1][1])
        feats.append(f"Mejor mes: {MESES_FULL[mejor[0]]} (balance {fmt_usd(mejor[1][0] - mejor[1][1])})")
    feats.append(f"Ahorro del año: {fmt_usd(bal)} ({tasa_ahorro})")
    cat_top = sorted(cats, key=lambda c: float(c["total"]), reverse=True)
    if cat_top:
        c0 = cat_top[0]
        pv = float(c0["total"]) / egr * 100 if egr else 0
        feats.append(f"Categoría con más gasto: {c0['categoria'] or 'sin categoría'} ({pv:.0f}% de egresos)")
    destacados(pdf, feats[:3])

    # ── Evolución mensual (gráfico) ──
    seccion(pdf, 1, "Evolución mensual")
    grafico_meses(pdf, meses)

    # ── Gasto por categoría (barras) ──
    seccion(pdf, 2, "Gasto por categoría")
    barras_categorias(pdf, [(c["categoria"] or "sin categoría", float(c["total"])) for c in cats], egr)

    # ── Movimientos destacados ──
    seccion(pdf, 3, "Movimientos destacados")
    trows = []
    for t in top:
        signo = "+" if t["tipo"] == "ingreso" else "-"
        nota = (t["nota"] or "")[:44]
        trows.append([t["fecha"], nota, f"{signo}{fmt_usd(float(t['usd']))}"])
    tabla(pdf, ["Fecha", "Detalle", "Monto"], trows, [28, 116, 38],
          ["L", "L", "R"], money_cols=(2,))

    pdf.output(str(out_path))
    return out_path

def main():
    args = sys.argv[1:]
    ano = None
    out = None
    i = 0
    while i < len(args):
        if args[i] == "--ano" and i + 1 < len(args):
            ano = int(args[i + 1]); i += 2
        elif args[i] == "--out" and i + 1 < len(args):
            out = args[i + 1]; i += 2
        else:
            i += 1
    if not ano:
        ano = date.today().year - 1
    if not out:
        out = Path.home() / f"workspace/your_files/Informe-Financiero-Anual-{ano}.pdf"
    else:
        out = Path(out)

    print(f"Generando informe anual de {ano}...", flush=True)
    ing, egr, meses, cats, top = obtener_datos(ano)
    generar_pdf(ano, ing, egr, meses, cats, top, out)
    print(f"OK: {out}")
    print(f"Ingresos ${ing:,.2f} | Egresos ${egr:,.2f} | Balance ${ing-egr:,.2f}")

if __name__ == "__main__":
    main()
