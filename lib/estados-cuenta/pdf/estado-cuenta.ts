/**
 * Estado de cuenta Synaptica — generador PDF (jsPDF).
 * Réplica de la plantilla aprobada por luigi (build_estado_cuenta.py):
 * banda navy con constelación, logo S, "ESTADO DE CUENTA" + píldora N°,
 * tarjetas de info, tabla de módulos, tabla de modificaciones con píldoras,
 * balance + banner de saldo, tarjetas de pago, términos y bloque de firma.
 */
import { jsPDF } from "jspdf";
import {
  C,
  type Cursor,
  type RGB,
  setFill,
  setStroke,
  setTextColor,
  roundRect,
} from "../../recibos/pdf/shared";
import {
  calcularTotales,
  formatoUSD,
  formatoFechaLarga,
} from "../calculos";
import type { EstadoCuentaCompleto } from "../tipos";

/* ── Paleta de la plantilla (del PDF original) ── */
const NAVY: RGB = [22, 22, 43];
const ORANGE: RGB = [255, 114, 0];
const TEAL: RGB = [13, 148, 160];
const PURPLE: RGB = [124, 58, 237];
const LAVENDER: RGB = [241, 234, 254];
const LAV_TXT: RGB = [109, 40, 217];
const GREEN: RGB = [22, 163, 74];
const GRAYB: RGB = [100, 116, 139];
const CARD: RGB = [241, 245, 249];
const CARD2: RGB = [248, 250, 252];
const INK: RGB = [30, 41, 59];
const BODY: RGB = [51, 65, 85];
const MUTED: RGB = [100, 116, 139];
const WHITE: RGB = [255, 255, 255];
const PEACH: RGB = [253, 186, 116];
const HEAD_SUB: RGB = [148, 163, 184];
const NET: RGB = [43, 43, 78];

/* Letter: 215.9 x 279.4 mm */
const PW = 215.9;
const ML = 12.7;
const MR = 12.7;
const CW = PW - ML - MR; // 190.5
const HEADER_H = 32;
const CONTENT_TOP = 37;
const FOOTER_Y = 271;

export interface EstadoCuentaPdfOptions {
  /** Data URL PNG de la marca S (recortada del logo oficial). */
  logoDataUrl?: string;
  /** Data URL PNG de la firma de luigi. */
  firmaDataUrl?: string;
}

const EMISOR = {
  nombre: "Luigi Beraldi",
  cargo: "Desarrollador de Software & Arquitectura de Sistemas",
  linea: "Servicios Profesionales de Desarrollo de Software",
  pagoMovil: [
    ["Banco", "Banco de Venezuela (0102)"],
    ["Teléfono", "0412-4051793"],
    ["Cédula", "V-24.457.713"],
  ] as Array<[string, string]>,
  binance: [
    ["Correo / Pay ID", "luiggiberaldi94@gmail.com"],
    ["Red", "Binance Pay (USDT)"],
    ["Nota", "USDT directo, sin intermediarios"],
  ] as Array<[string, string]>,
  condicionPago:
    "las cancelaciones se realizan directamente en USDT (Binance Pay) o en moneda local calculada a la tasa USDT de Binance P2P vigente al momento de realizar la transferencia.",
};

function need(doc: jsPDF, cursor: Cursor, h: number): void {
  if (cursor.y + h > FOOTER_Y - 4) {
    doc.addPage();
    cursor.y = CONTENT_TOP;
  }
}

function texto(
  doc: jsPDF,
  txt: string,
  x: number,
  y: number,
  o: {
    size?: number;
    bold?: boolean;
    color?: RGB;
    align?: "left" | "center" | "right";
    maxWidth?: number;
    lineHeight?: number;
  } = {}
): number {
  doc.setFont("helvetica", o.bold ? "bold" : "normal");
  doc.setFontSize(o.size ?? 9);
  setTextColor(doc, o.color ?? INK);
  if (o.maxWidth) {
    const lines = doc.splitTextToSize(txt, o.maxWidth);
    doc.text(lines, x, y, { align: o.align ?? "left" });
    return lines.length * (o.lineHeight ?? (o.size ?? 9) * 0.45);
  }
  doc.text(txt, x, y, { align: o.align ?? "left" });
  return (o.size ?? 9) * 0.45;
}

function pill(
  doc: jsPDF,
  label: string,
  cx: number,
  y: number,
  bg: RGB,
  opts: { check?: boolean; size?: number } = {}
): void {
  const size = opts.size ?? 6.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  const tw = doc.getTextWidth(label);
  const pad = 3;
  const checkW = opts.check ? 4 : 0;
  const w = tw + pad * 2 + checkW;
  const h = 5.2;
  setFill(doc, bg);
  roundRect(doc, cx - w / 2, y, w, h, h / 2, "F");
  setTextColor(doc, WHITE);
  const tx = cx - w / 2 + pad + (opts.check ? checkW : 0);
  if (opts.check) {
    // check dibujado con líneas (helvetica no trae ✓)
    const cy = y + h / 2;
    const x0 = cx - w / 2 + pad + 0.4;
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.45);
    doc.line(x0, cy - 0.2, x0 + 1.1, cy + 0.9);
    doc.line(x0 + 1.1, cy + 0.9, x0 + 2.6, cy - 1.2);
  }
  doc.text(label, tx, y + 3.55);
}

function sectionHead(doc: jsPDF, cursor: Cursor, num: string, title: string, sub?: string): void {
  need(doc, cursor, sub ? 13 : 9);
  const y = cursor.y;
  setFill(doc, ORANGE);
  roundRect(doc, ML, y, 1.4, 6.5, 0.7, "F");
  texto(doc, `${num}.  ${title.toUpperCase()}`, ML + 4, y + 4.8, { size: 11, bold: true, color: NAVY });
  cursor.y = y + 7;
  if (sub) {
    texto(doc, sub, ML, cursor.y + 3.2, { size: 7.5, color: MUTED });
    cursor.y += 6;
  } else {
    cursor.y += 2;
  }
}

/* ── Header + footer (se dibujan al final en cada página) ── */
function drawHeader(doc: jsPDF, numero: string, logoDataUrl?: string): void {
  setFill(doc, NAVY);
  doc.rect(0, 0, PW, HEADER_H, "F");
  // constelación tenue lado derecho
  const nodes: Array<[number, number]> = [
    [160, 8], [176, 14], [190, 7], [203, 15], [209, 8], [182, 24], [197, 25],
  ];
  const links: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [2, 5], [5, 6], [3, 6], [2, 6]];
  setStroke(doc, NET);
  doc.setLineWidth(0.25);
  for (const [a, b] of links) doc.line(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
  setFill(doc, NET);
  for (const [x, y] of nodes) doc.circle(x, y, 0.9, "F");
  // logo S
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", 10.5, 6.5, 19, 19);
    } catch { /* sin logo: el layout no se rompe */ }
  }
  // wordmark
  texto(doc, "SYNAPTICA", 33, 16.5, { size: 15, bold: true, color: WHITE });
  texto(doc, "Soluciones de Software", 33, 22.5, { size: 8, color: HEAD_SUB });
  // título derecho
  texto(doc, "ESTADO DE CUENTA", PW - 12, 15.5, { size: 15, bold: true, color: WHITE, align: "right" });
  // píldora N°
  const folio = `N° ${numero}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const pw = doc.getTextWidth(folio);
  const bw = pw + 12;
  const bx = PW - 12 - bw;
  const by = 19;
  setStroke(doc, ORANGE);
  doc.setLineWidth(0.4);
  doc.roundedRect(bx, by, bw, 7, 3.5, 3.5, "S");
  setTextColor(doc, ORANGE);
  doc.text(folio, bx + bw / 2, by + 4.9, { align: "center" });
  // regla naranja bajo la banda
  setFill(doc, ORANGE);
  doc.rect(0, HEADER_H, PW, 1.1, "F");
}

function drawFooter(doc: jsPDF, page: number, pages: number): void {
  setStroke(doc, C.border);
  doc.setLineWidth(0.25);
  doc.line(ML, FOOTER_Y, PW - MR, FOOTER_Y);
  texto(doc, "Documento de Control y Liquidación de Servicios Tecnológicos", ML, FOOTER_Y + 4.6, {
    size: 7.5, color: MUTED,
  });
  texto(doc, `Página ${page} de ${pages}`, PW - MR, FOOTER_Y + 4.6, { size: 7.5, color: MUTED, align: "right" });
}

/* ── Tabla genérica con filas de alto variable ── */
interface TableCell {
  w: number;
  draw: (doc: jsPDF, x: number, y: number, w: number, h: number) => void;
  minH?: number;
  /** Altura real necesaria según el contenido (si no se define, se usa minH). */
  measure?: (doc: jsPDF, w: number) => number;
}
interface TableRow {
  cells: TableCell[];
  bg?: RGB;
}

function drawTable(
  doc: jsPDF, cursor: Cursor, header: TableCell[], rows: TableRow[],
  opts: { headerBg?: RGB; grid?: RGB } = {}
): void {
  const grid = opts.grid ?? C.border;
  const widths = header.map((c) => c.w);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const rowH = (cells: TableCell[]): number => {
    let h = 7;
    for (const c of cells) {
      const m = c.measure ? c.measure(doc, c.w) : (c.minH ?? 7);
      h = Math.max(h, m, c.minH ?? 7);
    }
    return h;
  };
  const paintRow = (cells: TableCell[], y: number, h: number, bg?: RGB, isHeader = false) => {
    if (bg) { setFill(doc, bg); doc.rect(ML, y, totalW, h, "F"); }
    let x = ML;
    cells.forEach((c) => {
      if (!isHeader) {
        setStroke(doc, grid);
        doc.setLineWidth(0.15);
      }
      c.draw(doc, x, y, c.w, h);
      x += c.w;
    });
    // líneas verticales + borde
    setStroke(doc, grid);
    doc.setLineWidth(0.15);
    let lx = ML;
    doc.line(lx, y, lx, y + h);
    for (const w of widths) { lx += w; doc.line(lx, y, lx, y + h); }
    doc.line(ML, y + h, ML + totalW, y + h);
    if (isHeader) { doc.line(ML, y, ML + totalW, y); }
  };
  const hh = rowH(header);
  const paintHeader = () => {
    need(doc, cursor, hh + 8);
    paintRow(header, cursor.y, hh, opts.headerBg ?? NAVY, true);
    cursor.y += hh;
  };
  paintHeader();
  for (const r of rows) {
    const h = rowH(r.cells);
    if (cursor.y + h > FOOTER_Y - 4) {
      doc.addPage();
      cursor.y = CONTENT_TOP;
      paintHeader();
    }
    paintRow(r.cells, cursor.y, h, r.bg);
    cursor.y += h;
  }
}

function cellText(
  txt: string, o: { size?: number; bold?: boolean; color?: RGB; align?: "left" | "center" | "right"; sub?: string; nuevo?: boolean } = {}
): TableCell {
  const size = o.size ?? 8.5;
  const subSize = 6.8;
  const subLh = 2.7;
  // Geometría compacta como la plantilla original: el texto puede apoyarse
  // ~1mm sobre el padding de la fila siguiente (invisible, sin recorte).
  const baseMin = o.sub ? 10 : 6.8;
  const measure = (doc: jsPDF, w: number): number => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const tW = w - 5 - (o.nuevo ? 16 : 0);
    const tl = doc.splitTextToSize(txt, tW).length;
    let sl = 0;
    if (o.sub) { doc.setFontSize(subSize); sl = doc.splitTextToSize(o.sub, w - 5).length; }
    // Solo crece la fila si el contenido excede lo que la geometría compacta absorbe.
    if (tl >= 2 || sl >= 3) return 2 + tl * 3.4 + (sl ? 1 + sl * subLh : 0) + 1.5;
    return baseMin;
  };
  return {
    w: 0,
    minH: baseMin,
    measure,
    draw(doc, x, y, w) {
      const ax = o.align === "center" ? x + w / 2 : o.align === "right" ? x + w - 2.5 : x + 2.5;
      const tW = (o.align ?? "left") === "left" && o.nuevo ? w - 5 - 16 : w - 5;
      const tLh = size * 0.42;
      doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size);
      const tLines = doc.splitTextToSize(txt, tW);
      texto(doc, txt, ax, y + 3.8, { size, bold: o.bold, color: o.color ?? INK, align: o.align ?? "left", maxWidth: tW, lineHeight: tLh });
      // Si el título ocupa varias líneas, la descripción baja lo necesario.
      const subY = y + 7.2 + (tLines.length - 1) * tLh;
      if (o.sub) {
        texto(doc, o.sub, ax, subY, { size: subSize, color: MUTED, align: o.align ?? "left", maxWidth: w - 5, lineHeight: subLh });
      }
      if (o.nuevo && (o.align ?? "left") === "left") {
        // Badge "NUEVO" naranja junto al título (su ancho se reserva arriba).
        doc.setFont("helvetica", "bold"); doc.setFontSize(size);
        const primera = doc.splitTextToSize(txt, tW)[0] ?? "";
        const bx = ax + doc.getTextWidth(primera) + 4.5;
        doc.setFontSize(5.5);
        const bw = doc.getTextWidth("NUEVO") + 5;
        const bh = 4.2;
        setFill(doc, ORANGE); roundRect(doc, bx, y + 1.4, bw, bh, bh / 2, "F");
        setTextColor(doc, WHITE);
        doc.text("NUEVO", bx + bw / 2, y + 1.4 + 3, { align: "center" });
      }
    },
  };
}

function withW<T extends TableCell>(c: T, w: number): T { c.w = w; return c; }

export function buildEstadoCuentaPdf(
  data: EstadoCuentaCompleto,
  options: EstadoCuentaPdfOptions = {}
): jsPDF {
  const { cabecera: ec, items, pagos } = data;
  const t = calcularTotales(items, pagos);
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  const cursor: Cursor = { y: CONTENT_TOP };

  // ── Línea del emisor ──
  texto(doc, EMISOR.nombre, ML, cursor.y, { size: 9.5, bold: true });
  const nw = doc.getTextWidth(EMISOR.nombre + " ");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); setTextColor(doc, MUTED);
  doc.text(`· ${EMISOR.linea}`, ML + nw, cursor.y);
  cursor.y += 6;

  // ── Tarjetas de info ──
  {
    const y = cursor.y; const cw = CW / 3;
    const cols: Array<[string, string]> = [
      ["FECHA DE EMISIÓN", formatoFechaLarga(ec.fecha_emision)],
      ["CLIENTE / PROYECTO", ec.proyecto ? `${ec.cliente} (${ec.proyecto})` : ec.cliente],
      ["CONDICIÓN PACTADA", ec.condicion],
    ];
    // alto dinámico: si un valor ocupa 2 líneas, la tarjeta crece
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    const maxLines = Math.max(...cols.map(([, val]) => doc.splitTextToSize(val, cw - 8).length));
    const h = Math.max(13, 9.6 + (maxLines - 1) * 3.8 + 3.5);
    setFill(doc, CARD); roundRect(doc, ML, y, CW, h, 2.5, "F");
    cols.forEach(([lab, val], i) => {
      const x = ML + i * cw + 4;
      texto(doc, lab, x, y + 4.4, { size: 6.5, bold: true, color: MUTED });
      texto(doc, val, x, y + 9.6, { size: 9, bold: true, color: NAVY, maxWidth: cw - 8, lineHeight: 3.8 });
    });
    cursor.y = y + h + 7;
  }

  // ── 1. Módulos base ──
  const modulos = items.filter((i) => i.tipo === "modulo");
  sectionHead(doc, cursor, "1", "Módulos base del sistema", `Acuerdo: ${formatoUSD(t.totalModulos)} USD`);
  {
    const c0 = CW * 0.62, c1 = CW * 0.18, c2 = CW * 0.20;
    const header: TableCell[] = [
      withW(cellText("MÓDULO / ALCANCE", { bold: true, color: WHITE, align: "center", size: 8 }), c0),
      withW(cellText("ESTATUS", { bold: true, color: WHITE, align: "center", size: 8 }), c1),
      withW(cellText("BALANCE", { bold: true, color: WHITE, align: "center", size: 8 }), c2),
    ];
    const rows: TableRow[] = modulos.map((m, idx) => ({
      bg: idx % 2 === 1 ? CARD2 : undefined,
      cells: [
        withW(cellText(m.titulo, { bold: true, sub: m.descripcion ?? undefined }), c0),
        withW({ w: 0, minH: 7, draw(d, x, y, w, h) { pill(d, "ENTREGADO", x + w / 2, y + h / 2 - 2.6, TEAL); } }, c1),
        withW(cellText(formatoUSD(m.monto), { bold: true, align: "right", size: 8 }), c2),
      ],
    }));
    rows.push({
      bg: CARD,
      cells: [
        withW(cellText("Acuerdo total de módulos base", { bold: true }), c0),
        withW({ w: 0, minH: 7, draw(d, x, y, w, h) { pill(d, "100% PAGADO", x + w / 2, y + h / 2 - 2.6, TEAL); } }, c1),
        withW(cellText(`${formatoUSD(t.totalModulos)} USD`, { bold: true, align: "right" }), c2),
      ],
    });
    drawTable(doc, cursor, header, rows);
    cursor.y += 5;
  }

  // ── 2. Modificaciones ──
  const mods = items.filter((i) => i.tipo === "item");
  sectionHead(doc, cursor, "2", "Modificaciones y nuevas implementaciones", "100% operativas");
  {
    const c0 = CW * 0.055, c1 = CW * 0.44, c2 = CW * 0.305, c3 = CW * 0.20;
    const header: TableCell[] = [
      withW(cellText("#", { bold: true, color: WHITE, align: "center", size: 8 }), c0),
      withW(cellText("DESCRIPCIÓN DEL REQUERIMIENTO", { bold: true, color: WHITE, align: "center", size: 8 }), c1),
      withW(cellText("CLASIFICACIÓN", { bold: true, color: WHITE, align: "center", size: 8 }), c2),
      withW(cellText("MONTO (USD)", { bold: true, color: WHITE, align: "center", size: 8 }), c3),
    ];
    const rows: TableRow[] = mods.map((m, idx) => {
      const esNueva = m.clasificacion === "nueva";
      return {
        bg: esNueva ? LAVENDER : undefined,
        cells: [
          withW(cellText(String(idx + 1), { color: MUTED, align: "center" }), c0),
          withW(cellText(m.titulo, { bold: true, sub: m.descripcion ?? undefined, size: 8, nuevo: m.es_nuevo }), c1),
          withW({
            w: 0, minH: 7,
            draw(d, x, y, w, h) {
              const cy = y + h / 2 - 2.6;
              pill(d, esNueva ? "Nueva Implementación" : "Modificación", x + w * 0.28, cy, esNueva ? PURPLE : GRAYB, { size: 5.5 });
              if (m.listo) pill(d, "Listo", x + w * 0.78, cy, GREEN, { size: 5.5, check: true });
            },
          }, c2),
          withW(cellText(formatoUSD(m.monto), { align: "right", size: 8 }), c3),
        ],
      };
    });
    rows.push({
      bg: CARD,
      cells: [
        withW(cellText("", {}), c0),
        withW(cellText(`Subtotal Modificaciones & Nuevas Implementaciones (${mods.length} ítems)`, { bold: true, size: 8 }), c1),
        withW(cellText("", {}), c2),
        withW(cellText(`${formatoUSD(t.subtotalItems)} USD`, { bold: true, align: "right" }), c3),
      ],
    });
    drawTable(doc, cursor, header, rows);
    cursor.y += 3;
    // nota de filas resaltadas (cada segmento se mide con la fuente con la que se dibuja)
    need(doc, cursor, 8);
    setFill(doc, LAVENDER);
    roundRect(doc, ML, cursor.y, CW, 8, 2, "F");
    setTextColor(doc, LAV_TXT);
    doc.setFontSize(7.5);
    let nx = ML + 4;
    const segNota = (txt: string, bold: boolean) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(txt, nx, cursor.y + 5);
      nx += doc.getTextWidth(txt);
    };
    segNota("Filas resaltadas: nuevas implementaciones ", false);
    segNota(`pendientes de pago (${formatoUSD(t.nuevasPendientes)} USD del subtotal).`, true);
    const p2n = "  NUEVO = adiciones recientes.";
    doc.setFont("helvetica", "normal");
    if (nx + doc.getTextWidth(p2n) < ML + CW - 4) {
      doc.text(p2n, nx, cursor.y + 5);
    }
    cursor.y += 8 + 5;
  }

  // ── 3. Balance ──
  sectionHead(doc, cursor, "3", "Balance financiero consolidado y liquidación");
  {
    const y0 = cursor.y;
    const rows: Array<[string, string, boolean?]> = [
      [`Total Servicios (${formatoUSD(t.totalModulos)} módulos + ${formatoUSD(t.subtotalItems)} mejoras)`, `${formatoUSD(t.totalServicios)} USD`],
    ];
    for (const p of pagos) {
      rows.push([p.concepto, `-${formatoUSD(p.monto)} USD`]);
    }
    rows.push([`Total cancelado a la fecha`, `${formatoUSD(t.totalPagado)} USD`, true]);
    let y = y0;
    const rh = 6;
    const hasSub = t.totalPagado > 0;
    need(doc, cursor, rows.length * rh + 4);
    y = cursor.y;
    setFill(doc, WHITE);
    setStroke(doc, C.border); doc.setLineWidth(0.25);
    doc.roundedRect(ML, y, CW, rows.length * rh, 2.5, 2.5, "FD");
    rows.forEach(([lab, val, bold], i) => {
      if (i > 0) { setStroke(doc, C.border); doc.setLineWidth(0.15); doc.line(ML + 3, y + i * rh, ML + CW - 3, y + i * rh); }
      texto(doc, lab, ML + 4, y + i * rh + 4.2, { size: 8.5, bold: !!bold, color: bold ? INK : BODY, maxWidth: CW * 0.68, lineHeight: 3.6 });
      if (i === rows.length - 1 && hasSub) {
        // Sub en la misma línea, como la plantilla original.
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
        const labW = doc.getTextWidth(lab);
        // gap explícito: getTextWidth puede medir apenas corto y comerse el espacio
        texto(doc, "(Módulos 100% Pagados + abono a mejoras)", ML + 4 + labW + 1.2, y + i * rh + 4.2, { size: 7, color: TEAL });
      }
      texto(doc, val, ML + CW - 4, y + i * rh + 4.2, { size: 8.5, bold: !!bold, align: "right" });
    });
    cursor.y = y + rows.length * rh + 5;
    // banner de saldo
    need(doc, cursor, 17);
    const by = cursor.y;
    setFill(doc, NAVY);
    roundRect(doc, ML, by, CW, 15, 2.5, "F");
    texto(doc, "TOTAL SALDO PENDIENTE", ML + 5, by + 6.4, { size: 10, bold: true, color: WHITE });
    texto(doc, "Liquidación pactada a Tasa USDT", ML + 5, by + 11, { size: 7.5, color: PEACH });
    doc.setFont("helvetica", "bold"); doc.setFontSize(19); setTextColor(doc, WHITE);
    const amt = formatoUSD(t.saldoPendiente);
    doc.text(amt, ML + CW - 5 - doc.getTextWidth(" USD") - 2, by + 10.5, { align: "right" });
    doc.setFontSize(10); setTextColor(doc, PEACH);
    doc.text("USD", ML + CW - 5, by + 10.5, { align: "right" });
    cursor.y = by + 15 + 6;
  }

  // ── Tarjetas de pago ──
  {
    need(doc, cursor, 27);
    const y = cursor.y; const cw = (CW - 4) / 2; const ch = 23;
    const card = (x: number, title: string, sub: string, lines: Array<[string, string]>) => {
      setFill(doc, CARD); roundRect(doc, x, y, cw, ch, 2.5, "F");
      setFill(doc, ORANGE); doc.rect(x + 2.5, y, cw - 5, 1, "F");
      texto(doc, title, x + 4, y + 5.6, { size: 9, bold: true, color: NAVY });
      const tw = doc.getTextWidth(title + " ");
      texto(doc, sub, x + 4 + tw, y + 5.6, { size: 7, color: MUTED });
      lines.forEach(([lab, val], i) => {
        texto(doc, `${lab}:`, x + 4, y + 10.5 + i * 4.4, { size: 8, bold: true });
        const lw = doc.getTextWidth(`${lab}: `);
        texto(doc, val, x + 4 + lw, y + 10.5 + i * 4.4, { size: 8, maxWidth: cw - 8 - lw, lineHeight: 3.2 });
      });
    };
    card(ML, "Pago Móvil", "(calculado a Tasa USDT)", EMISOR.pagoMovil);
    card(ML + cw + 4, "Binance Pay", "(USDT directo)", EMISOR.binance);
    cursor.y = y + ch + 3;
    need(doc, cursor, 8);
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); setTextColor(doc, MUTED);
    const cond = doc.splitTextToSize(`Condición de Pago Acordada: ${EMISOR.condicionPago}`, CW);
    doc.text(cond, ML, cursor.y + 3.2);
    cursor.y += cond.length * 3.2 + 4;
  }

  // ── 4. Términos ──
  sectionHead(doc, cursor, "4", "Términos de soporte, garantía y tarifario");
  {
    need(doc, cursor, 24);
    texto(doc, "Garantía de Entrega — 30 Días Continuos", ML, cursor.y + 3.4, { size: 9, bold: true, color: NAVY });
    cursor.y += 7;
    const g1 = doc.splitTextToSize(
      "Cada funcionalidad entregada cuenta con 30 días continuos de garantía para la corrección de errores de código (bugs) o fallas sin costo alguno.",
      CW
    );
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); setTextColor(doc, BODY);
    doc.text(g1, ML, cursor.y + 3.4);
    cursor.y += g1.length * 3.8 + 2;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); setTextColor(doc, MUTED);
    const g2 = doc.splitTextToSize(
      "Nota: aplica estrictamente a correcciones del código programado. Nuevos requerimientos o cambios de flujo operacional se presupuestan conforme al tabulador.",
      CW
    );
    doc.text(g2, ML, cursor.y + 3.2);
    cursor.y += g2.length * 3.4 + 4;
    // tarifario
    need(doc, cursor, 12);
    const y = cursor.y;
    setFill(doc, CARD); roundRect(doc, ML, y, CW, 11, 2.5, "F");
    setFill(doc, TEAL); doc.rect(ML + 2.5, y, CW - 5, 1, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); setTextColor(doc, BODY);
    const t1 = "Tarifario:  Modificación Sencilla";
    doc.text(t1, ML + 5, y + 5);
    let tx = ML + 5 + doc.getTextWidth(t1) + 1.6;
    doc.setFont("helvetica", "bold"); setTextColor(doc, INK);
    doc.text("$15.00", tx, y + 5); tx += doc.getTextWidth("$15.00") + 1.6;
    doc.setFont("helvetica", "normal"); setTextColor(doc, BODY);
    doc.text("\u00B7   Modificaci\u00F3n Compleja", tx, y + 5); tx += doc.getTextWidth("\u00B7   Modificaci\u00F3n Compleja") + 1.6;
    doc.setFont("helvetica", "bold"); setTextColor(doc, INK);
    doc.text("$30.00", tx, y + 5); tx += doc.getTextWidth("$30.00") + 1.6;
    doc.setFont("helvetica", "normal"); setTextColor(doc, BODY);
    doc.text("\u00B7   M\u00F3dulo Completo Nuevo", tx, y + 5); tx += doc.getTextWidth("\u00B7   M\u00F3dulo Completo Nuevo") + 1.6;
    doc.setFont("helvetica", "bold"); setTextColor(doc, INK);
    doc.text("$100.00 USD", tx, y + 5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setTextColor(doc, MUTED);
    doc.text("Precios base para la planificación de nuevas fases del sistema.", ML + 5, y + 9.2);
    cursor.y = y + 11 + 5;
  }

  // ── Bloque de firma ──
  {
    need(doc, cursor, 24);
    const y = cursor.y; const h = 22;
    setFill(doc, NAVY); roundRect(doc, ML, y, CW, h, 3, "F");
    if (options.firmaDataUrl) {
      try { doc.addImage(options.firmaDataUrl, "PNG", ML + 5, y + 4.5, 42, 13.3); } catch { /* noop */ }
    }
    const cx = ML + 52;
    texto(doc, "EMITIDO POR", cx, y + 5.5, { size: 6.5, color: HEAD_SUB });
    texto(doc, EMISOR.nombre, cx, y + 10, { size: 10.5, bold: true, color: WHITE });
    texto(doc, EMISOR.cargo, cx, y + 14.5, { size: 7, color: HEAD_SUB, maxWidth: 48, lineHeight: 3 });
    const rx = ML + CW * 0.58;
    texto(doc, "EMITIDO PARA", rx, y + 5.5, { size: 6.5, color: HEAD_SUB });
    texto(doc, ec.cliente, rx, y + 10, { size: 10.5, bold: true, color: WHITE, maxWidth: CW * 0.38, lineHeight: 4.4 });
    const ey = y + 15;
    texto(doc, "Estatus:", rx, ey, { size: 8, bold: true, color: WHITE });
    const ew = doc.getTextWidth("Estatus: ");
    const est = t.estado === "pagado" ? "Pagado" : "Pendiente de pago";
    texto(doc, est, rx + ew, ey, { size: 8, bold: true, color: t.estado === "pagado" ? GREEN : ORANGE });
    texto(doc, `(Saldo: ${formatoUSD(t.saldoPendiente)} USD)`, rx, ey + 4.4, { size: 7.5, color: HEAD_SUB });
    cursor.y = y + h + 4;
  }

  // ── Header + footer en cada página ──
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    drawHeader(doc, ec.numero, options.logoDataUrl);
    drawFooter(doc, p, n);
  }
  return doc;
}

/** Nombre de archivo: Estado-de-cuenta-2026-095-Construacero.pdf */
export function nombreArchivoEC(ec: { numero: string; cliente: string }): string {
  const cli = ec.cliente
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `Estado-de-cuenta-${ec.numero}-${cli || "cliente"}.pdf`;
}
