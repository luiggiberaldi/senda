import { jsPDF } from "jspdf";
import type { Receipt, ReceiptTotals } from "../tipos";
import { computeTotals } from "../calculos";
import {
  formatCurrency,
  formatDate,
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODE_LABELS,
  STATUS_LABELS,
} from "../formato";
import {
  convertirABs,
  formatearBs,
  type TasaBs,
} from "../tasas";
import { resolveWarranty } from "../garantia";
import {
  C,
  PAGE,
  type Cursor,
  type RGB,
  setFill,
  setStroke,
  setTextColor,
  roundRect,
  compactLines,
} from "./shared";

/**
 * PDF 2.0 — Marca SYNAPTICA.
 * Réplica del diseño aprobado por luigi (recibo SYN-2026-158):
 * banda navy con diagonal naranja, logo oficial, "RECIBO" en serif,
 * pastilla de estado, franja de metadatos, tarjetas de partes,
 * tabla de conceptos bicolor, pagos + resumen lado a lado,
 * calendario de cuotas, banda de garantía, firma y pie con diagonal.
 */

export interface SynapticaPdfOptions {
  bsRate?: TasaBs | null;
  /** Recibo anulado: marca de agua ANULADO. */
  anulado?: boolean;
  /** Data URL PNG (con transparencia) del logo oficial. */
  logoDataUrl?: string;
  /** Data URL PNG (con transparencia) de la firma. */
  firmaDataUrl?: string;
  /** Cargo bajo la firma. */
  firmaCargo?: string;
}

/* ── Paleta Synaptica (del diseño de referencia) ── */
const NAVY: RGB = [22, 22, 43];
const ORANGE: RGB = [255, 114, 0];
const ORANGE_TXT: RGB = [198, 72, 0];
const PEACH: RGB = [255, 227, 194];
const CARD: RGB = [241, 245, 249];
const META_BG: RGB = [244, 246, 250];
const TEAL: RGB = [13, 148, 160];
const RED: RGB = [220, 38, 38];
const RED_BG: RGB = [253, 231, 231];
const GREEN: RGB = [22, 163, 74];
const GREEN_BG: RGB = [220, 252, 231];
const AMBER: RGB = [217, 119, 6];
const AMBER_BG: RGB = [254, 243, 199];
const SKY: RGB = [2, 132, 199];
const SKY_BG: RGB = [224, 242, 254];
const WHITE: RGB = [255, 255, 255];
const HEAD_SUB: RGB = [172, 176, 198];
const FOOT_TXT: RGB = [200, 205, 220];

const SYN = {
  nombre: "SYNAPTICA.CA",
  rif: "",
  telefono: "",
  email: "",
  direccion: "",
  ciudad: "VALENCIA",
  tagline: "Desarrollo de Software & Soluciones Digitales",
  gracias: "Gracias por su pago. Synaptica \u2014 Soluciones digitales.",
};

/** El pie con la banda navy ocupa desde esta Y: el contenido no debe pasarla. */
const LIMITE_CONTENIDO = 268;

function numeroCorto(n: string): string {
  const t = (n || "").trim();
  const m = t.match(/-(\d+)\s*$/);
  return m ? m[1] : t || "\u2014";
}

function emisorDe(r: Receipt) {
  const i = r.issuer;
  return {
    nombre: i.name?.trim() || SYN.nombre,
    rif: i.taxId?.trim() || SYN.rif,
    telefono: i.phone?.trim() || SYN.telefono,
    email: i.email?.trim() || SYN.email,
    direccion: i.address?.trim() || SYN.direccion,
  };
}

function salto(doc: jsPDF, cursor: Cursor, needed: number): void {
  if (cursor.y + needed > LIMITE_CONTENIDO) {
    doc.addPage();
    cursor.y = 14;
  }
}

export function buildSynapticaPdf(
  receipt: Receipt,
  options: SynapticaPdfOptions = {}
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const totals = computeTotals(receipt);
  const cursor: Cursor = { y: 0 };

  drawSynHeader(doc, receipt, totals, cursor, options);
  drawSynMeta(doc, receipt, cursor);
  drawSynParties(doc, receipt, cursor);
  drawSynItems(doc, receipt, totals, cursor);
  drawSynPagosResumen(doc, receipt, totals, cursor, options);
  drawSynCuotas(doc, receipt, cursor);
  drawSynGarantia(doc, receipt, cursor);
  drawSynObservaciones(doc, receipt, cursor);
  drawSynFirma(doc, receipt, totals, cursor, options);

  // Marca de agua + pie en cada página (el pie siempre al fondo).
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    drawSynWatermark(doc, totals, options.anulado ?? false);
    drawSynFooter(doc, receipt, p, n, options);
  }
  return doc;
}

/* ============================================================
   HEADER — banda navy, diagonal naranja, logo, RECIBO serif
   ============================================================ */
function drawSynHeader(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor,
  options: SynapticaPdfOptions
): void {
  const H = 35;
  setFill(doc, NAVY);
  doc.rect(0, 0, PAGE.w, H, "F");

  // Diagonal naranja esquina superior izquierda + filete blanco
  setFill(doc, ORANGE);
  doc.triangle(0, 0, 34, 0, 0, 34, "F");
  setStroke(doc, WHITE);
  doc.setLineWidth(0.6);
  doc.line(34, 0, 0, 34);

  // Logo oficial — fuera del triángulo naranja (hipotenusa x+y=34):
  // con W=24 el wordmark arranca en x=23, libre del triángulo a esa altura.
  if (options.logoDataUrl) {
    try {
      const lw = 24;
      doc.addImage(options.logoDataUrl, "PNG", 23, 8, lw, (lw * 1614) / 1904);
    } catch {
      /* sin logo: el layout no se rompe */
    }
  }

  // Título serif centrado
  doc.setFont("times", "bold");
  doc.setFontSize(30);
  setTextColor(doc, WHITE);
  doc.text("RECIBO", PAGE.w / 2, 19, { align: "center", charSpace: 2 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTextColor(doc, HEAD_SUB);
  doc.text(SYN.tagline, PAGE.w / 2, 26.5, { align: "center" });

  // Nº + pastilla de estado
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  setTextColor(doc, WHITE);
  doc.text(`N\u00ba ${numeroCorto(receipt.meta.number)}`, 196, 16, { align: "right" });
  drawSynPill(doc, totals.status, 196, 20.5);

  // Regla naranja bajo la banda
  setFill(doc, ORANGE);
  doc.rect(0, H, PAGE.w, 1.4, "F");

  cursor.y = 43;
}

function drawSynPill(
  doc: jsPDF,
  status: ReceiptTotals["status"],
  rightX: number,
  y: number
): void {
  const label = (STATUS_LABELS[status] ?? "Pagado").toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const w = doc.getTextWidth(label) + 11;
  const h = 7.5;
  let bg: RGB = PEACH;
  let fg: RGB = ORANGE_TXT;
  if (status === "partial") {
    bg = SKY_BG;
    fg = SKY;
  } else if (status === "pending") {
    bg = AMBER_BG;
    fg = AMBER;
  }
  setFill(doc, bg);
  roundRect(doc, rightX - w, y, w, h, 3.75, "F");
  setTextColor(doc, fg);
  doc.text(label, rightX - w / 2, y + 5.2, { align: "center" });
}

/* ============================================================
   META — franja redondeada: emisión / vencimiento / modalidad / moneda
   ============================================================ */
function drawSynMeta(doc: jsPDF, receipt: Receipt, cursor: Cursor): void {
  const y = cursor.y;
  const w = PAGE.w - 24;
  const h = 14;
  setFill(doc, META_BG);
  roundRect(doc, 12, y, w, h, 3, "F");
  setStroke(doc, C.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(12, y, w, h, 3, 3, "S");

  const cols: Array<[string, string]> = [
    ["EMISI\u00d3N", formatDate(receipt.meta.issueDate)],
    ["VENCIMIENTO", receipt.meta.dueDate ? formatDate(receipt.meta.dueDate) : "\u2014"],
    ["MODALIDAD", PAYMENT_MODE_LABELS[receipt.meta.paymentMode] ?? "\u2014"],
    ["MONEDA", receipt.meta.currency],
  ];
  const cw = w / 4;
  cols.forEach(([lab, val], i) => {
    const x = 12 + i * cw + 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setTextColor(doc, C.muted);
    doc.text(lab, x, y + 4.8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setTextColor(doc, C.ink);
    doc.text(val, x, y + 10.3);
  });
  cursor.y = y + h + 6;
}

/* ============================================================
   PARTES — facturado a / emitido por
   ============================================================ */
interface PartyLine {
  t: string;
  bold?: boolean;
  size?: number;
}

function drawSynParties(doc: jsPDF, receipt: Receipt, cursor: Cursor): void {
  const y = cursor.y;
  const cardW = 91;
  const cardH = 42;
  const em = emisorDe(receipt);

  partyCard(doc, 12, y, cardW, cardH, "FACTURADO A", ORANGE, [
    { t: (receipt.client.name?.trim() || "\u2014").toUpperCase(), bold: true, size: 10.5 },
    ...compactLines([
      receipt.client.phone ? `Tlf: ${receipt.client.phone}` : "",
      receipt.client.email ? receipt.client.email.toUpperCase() : "",
      receipt.client.city ? receipt.client.city.toUpperCase() : "",
      receipt.client.address ? receipt.client.address.toUpperCase() : "",
    ]).map((t) => ({ t, size: 8.5 })),
  ]);

  partyCard(doc, 107, y, cardW, cardH, "EMITIDO POR", NAVY, [
    { t: em.nombre, bold: true, size: 10.5 },
    ...compactLines([
      em.rif ? `RIF: ${em.rif}` : "",
      em.telefono ? `Tlf: ${em.telefono}` : "",
      em.email ? em.email.toUpperCase() : "",
      em.direccion ? em.direccion : "",
    ]).map((t) => ({ t, size: 8.5 })),
  ]);

  cursor.y = y + cardH + 6;
}

function partyCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  titulo: string,
  accent: RGB,
  lines: PartyLine[]
): void {
  setFill(doc, CARD);
  roundRect(doc, x, y, w, h, 3, "F");
  // Barra de acento vertical centrada
  const barH = h - 14;
  setFill(doc, accent);
  roundRect(doc, x + 4, y + (h - barH) / 2, 3, barH, 1.5, "F");

  let ly = y + 8.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setTextColor(doc, C.body);
  doc.text(titulo, x + 11, ly);
  ly += 6;
  for (const ln of lines) {
    doc.setFont("helvetica", ln.bold ? "bold" : "normal");
    doc.setFontSize(ln.size ?? 8.5);
    setTextColor(doc, ln.bold ? C.ink : C.body);
    doc.text(ln.t, x + 11, ly, { maxWidth: w - 15 });
    ly += (ln.size ?? 8.5) * 0.36 + 2.2;
  }
}

/* ============================================================
   CONCEPTOS — tabla bicolor (naranja + navy)
   ============================================================ */
function drawSynItems(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor
): void {
  const items = receipt.items.filter(
    (it) => it.description.trim() !== "" || Number(it.unitPrice) > 0
  );
  if (totals.usingDeclaredTotal && items.length === 0) return;
  salto(doc, cursor, 30);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setTextColor(doc, C.ink);
  doc.text("CONCEPTOS", 12, cursor.y);
  cursor.y += 4;

  const x0 = 12;
  const wTot = PAGE.w - 24;
  const cDesc = 96;
  const cCant = 26;
  const cPu = 32;
  const hh = 9;

  const drawHead = () => {
    const hy = cursor.y;
    setFill(doc, ORANGE);
    doc.rect(x0, hy, cDesc, hh, "F");
    setFill(doc, NAVY);
    doc.rect(x0 + cDesc, hy, wTot - cDesc, hh, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setTextColor(doc, WHITE);
    doc.text("Descripci\u00f3n", x0 + 4, hy + 6.2);
    doc.text("Cant.", x0 + cDesc + cCant / 2, hy + 6.2, { align: "center" });
    doc.text("P. unit.", x0 + cDesc + cCant + cPu / 2, hy + 6.2, { align: "center" });
    doc.text("Total", x0 + wTot - 4, hy + 6.2, { align: "right" });
    cursor.y = hy + hh;
  };
  drawHead();

  items.forEach((it) => {
    const descLines = doc.splitTextToSize(it.description, cDesc - 10) as string[];
    const det =
      it.licenseType === "lifetime"
        ? "[Licencia Permanente / Vitalicia]"
        : it.licenseType === "monthly"
          ? "[Licencia Mensual]"
          : "";
    const rh = Math.max(12, descLines.length * 4.4 + (det ? 5 : 0) + 5);
    if (cursor.y + rh > LIMITE_CONTENIDO) {
      doc.addPage();
      cursor.y = 14;
      drawHead();
    }
    const ry = cursor.y;
    let ty = ry + 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, C.ink);
    doc.text(descLines, x0 + 4, ty);
    ty += descLines.length * 4.4;
    if (det) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setTextColor(doc, C.muted);
      doc.text(det, x0 + 4, ty + 1);
    }
    const cy = ry + rh / 2 + 1.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, C.body);
    doc.text(String(it.quantity), x0 + cDesc + cCant / 2, cy, { align: "center" });
    doc.text(formatCurrency(it.unitPrice, receipt.meta.currency), x0 + cDesc + cCant + cPu - 4, cy, {
      align: "right",
    });
    doc.setFont("helvetica", "bold");
    setTextColor(doc, C.ink);
    const totalLinea = totals.usingDeclaredTotal
      ? it.unitPrice * it.quantity
      : it.unitPrice * it.quantity * (1 - (it.discount || 0) / 100);
    doc.text(formatCurrency(totalLinea, receipt.meta.currency), x0 + wTot - 4, cy, {
      align: "right",
    });

    // Separadores
    setStroke(doc, [232, 236, 242]);
    doc.setLineWidth(0.15);
    doc.line(x0, ry + rh, x0 + wTot, ry + rh);
    [cDesc, cDesc + cCant, cDesc + cCant + cPu].forEach((cx) => {
      doc.line(x0 + cx, ry, x0 + cx, ry + rh);
    });
    cursor.y = ry + rh;
  });
  cursor.y += 5;
}

/* ============================================================
   PAGOS REGISTRADOS + RESUMEN (lado a lado)
   ============================================================ */
function drawSynPagosResumen(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor,
  options: SynapticaPdfOptions
): void {
  const pagos = receipt.payments ?? [];
  const cur = receipt.meta.currency;
  salto(doc, cursor, 52);
  const y = cursor.y;
  const leftW = 92;
  const rightX = 108;
  const rightW = 90;
  const headH = 10;
  const rowH = 13;
  const footH = 11;
  const bodyH = pagos.length * rowH + footH + 4;
  const totalH = headH + bodyH;

  // ── Tarjeta PAGOS ──
  setFill(doc, CARD);
  roundRect(doc, 12, y, leftW, totalH, 3, "F");
  setFill(doc, NAVY);
  roundRect(doc, 12, y, leftW, headH + 3, 3, "F");
  doc.rect(12, y + headH, leftW, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setTextColor(doc, WHITE);
  doc.text(`PAGOS REGISTRADOS (${pagos.length})`, 17, y + 6.8);

  pagos.forEach((p, i) => {
    const ry = y + headH + 3 + i * rowH;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setTextColor(doc, C.ink);
    doc.text(PAYMENT_METHOD_LABELS[p.method] ?? "Pago", 17, ry + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setTextColor(doc, C.muted);
    doc.text(formatDate(p.date), 17, ry + 9.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setTextColor(doc, C.ink);
    doc.text(formatCurrency(p.amount, cur), 12 + leftW - 5, ry + 5, { align: "right" });
    if (options.bsRate && (cur === "USD" || cur === "USDT")) {
      const bs = p.amountBs && p.amountBs > 0 ? p.amountBs : convertirABs(p.amount, options.bsRate);
      if (bs > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(formatearBs(bs), 12 + leftW - 5, ry + 9.5, { align: "right" });
      }
    }
    if (i < pagos.length - 1) {
      setStroke(doc, C.border);
      doc.setLineWidth(0.15);
      doc.line(17, ry + rowH - 1, 12 + leftW - 5, ry + rowH - 1);
    }
  });

  const fy = y + headH + 3 + pagos.length * rowH;
  setStroke(doc, C.borderDark);
  doc.setLineWidth(0.25);
  doc.line(17, fy + 1, 12 + leftW - 5, fy + 1);
  if (totals.totalPaid > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setTextColor(doc, C.muted);
    doc.text("Total abonado", 17, fy + 6.5);
    doc.setFontSize(9.5);
    setTextColor(doc, C.ink);
    const totalBsPagos = pagos.reduce(
      (a, p) => a + (p.amountBs && p.amountBs > 0 ? p.amountBs : convertirABs(p.amount, options.bsRate ?? null)),
      0
    );
    const totalBs =
      options.bsRate && (cur === "USD" || cur === "USDT")
        ? ` / ${formatearBs(totalBsPagos > 0 ? totalBsPagos : convertirABs(totals.totalPaid, options.bsRate))}`
        : "";
    doc.text(`${formatCurrency(totals.totalPaid, cur)}${totalBs}`, 12 + leftW - 5, fy + 6.5, {
      align: "right",
    });
  }

  // ── Tarjeta RESUMEN ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setTextColor(doc, C.ink);
  doc.text("RESUMEN", rightX, y + 5);
  const resY = y + 9;
  const resH = 44;
  setFill(doc, WHITE);
  roundRect(doc, rightX, resY, rightW, resH, 3, "F");
  setStroke(doc, C.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(rightX, resY, rightW, resH, 3, 3, "S");

  let sy = resY + 8;
  const fila = (lab: string, val: string, bold: boolean, color: RGB, size = 9) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    setTextColor(doc, color);
    doc.text(lab, rightX + 6, sy);
    doc.text(val, rightX + rightW - 6, sy, { align: "right" });
    sy += size * 0.42 + 4.5;
  };
  fila("Subtotal", formatCurrency(totals.subtotal, cur), false, C.body);
  setStroke(doc, C.border);
  doc.setLineWidth(0.15);
  doc.line(rightX + 6, sy - 5.5, rightX + rightW - 6, sy - 5.5);
  fila("Total", formatCurrency(totals.total, cur), true, C.ink, 11.5);
  if (totals.totalPaid > 0) {
    fila("Total abonado", formatCurrency(totals.totalPaid, cur), false, TEAL, 9.5);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setTextColor(doc, TEAL);
  doc.text((STATUS_LABELS[totals.status] ?? "").toUpperCase(), rightX + 6, sy + 2);

  cursor.y = y + Math.max(totalH, resH + 9) + 5;
}

/* ============================================================
   CUOTAS — calendario de pagos pendientes
   ============================================================ */
function drawSynCuotas(doc: jsPDF, receipt: Receipt, cursor: Cursor): void {
  const cuotas = [...(receipt.scheduledPayments ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  if (receipt.meta.paymentMode !== "installments" || cuotas.length === 0) return;
  salto(doc, cursor, 24);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setTextColor(doc, C.ink);
  doc.text("CALENDARIO DE CUOTAS PENDIENTES", 12, cursor.y);
  cursor.y += 7;

  let total = 0;
  cuotas.forEach((c, i) => {
    salto(doc, cursor, 9);
    total += c.amount;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setTextColor(doc, ORANGE);
    doc.text(`${i + 1}.`, 12, cursor.y);
    doc.setFont("helvetica", "normal");
    setTextColor(doc, C.ink);
    doc.text(formatDate(c.date), 20, cursor.y);
    if (c.note?.trim()) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      setTextColor(doc, C.muted);
      doc.text(c.note.trim().toUpperCase(), 52, cursor.y);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setTextColor(doc, C.ink);
    doc.text(formatCurrency(c.amount, receipt.meta.currency), 198, cursor.y, { align: "right" });
    cursor.y += 6.5;
  });

  setStroke(doc, C.border);
  doc.setLineWidth(0.2);
  doc.line(12, cursor.y - 2, 198, cursor.y - 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setTextColor(doc, C.muted);
  doc.text("Total cuotas pendientes", 12, cursor.y + 3.5);
  setTextColor(doc, C.ink);
  doc.text(formatCurrency(total, receipt.meta.currency), 198, cursor.y + 3.5, { align: "right" });
  cursor.y += 8;
}

/* ============================================================
   GARANTÍA — banda de estado
   ============================================================ */
function drawSynGarantia(doc: jsPDF, receipt: Receipt, cursor: Cursor): void {
  const days = receipt.meta.warrantyDays ?? 0;
  const endDate = receipt.meta.warrantyEndDate ?? "";
  if (days <= 0 && !endDate) return;
  const w = resolveWarranty(days, endDate);
  if (w.status === "none") return;
  salto(doc, cursor, 16);

  let accent: RGB = GREEN;
  let bg: RGB = GREEN_BG;
  let label = "GARANT\u00cdA VIGENTE";
  if (w.status === "expiring") {
    accent = AMBER;
    bg = AMBER_BG;
    label = "GARANT\u00cdA POR VENCER";
  } else if (w.status === "expired") {
    accent = RED;
    bg = RED_BG;
    label = "GARANT\u00cdA VENCIDA";
  }

  const y = cursor.y;
  const h = 10;
  setFill(doc, bg);
  roundRect(doc, 12, y, PAGE.w - 24, h, 3, "F");
  setFill(doc, accent);
  roundRect(doc, 12, y, 3, h, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setTextColor(doc, accent);
  const lw = doc.getTextWidth(label);
  doc.text(label, 20, y + 6.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setTextColor(doc, C.body);
  doc.text(
    `${days} d\u00edas${endDate ? `  \u00b7  Vence el ${formatDate(endDate)}` : ""}`,
    20 + lw + 5,
    y + 6.8
  );
  cursor.y = y + h + 5;
}

/* ============================================================
   OBSERVACIONES — bloque de texto libre
   ============================================================ */
function drawSynObservaciones(doc: jsPDF, receipt: Receipt, cursor: Cursor): void {
  const obs = (receipt.meta.observations ?? "").trim();
  if (!obs) return;
  salto(doc, cursor, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTextColor(doc, ORANGE);
  doc.text("OBSERVACIONES", 12, cursor.y);
  cursor.y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setTextColor(doc, C.body);
  const lines = doc.splitTextToSize(obs, PAGE.w - 24);
  for (const ln of lines) {
    salto(doc, cursor, 5);
    doc.text(ln, 12, cursor.y);
    cursor.y += 4.2;
  }
  cursor.y += 2;
}

/* ============================================================
   FIRMA — imagen de la firma + cargo
   ============================================================ */
function drawSynFirma(
  doc: jsPDF,
  receipt: Receipt,
  totals: ReceiptTotals,
  cursor: Cursor,
  options: SynapticaPdfOptions
): void {
  if (totals.balanceDue > 0.01) return;
  salto(doc, cursor, 30);
  cursor.y += 2;
  const sigW = 46;
  const sigX = 198 - sigW;

  if (options.firmaDataUrl) {
    try {
      const sigH = (sigW * 217) / 687;
      doc.addImage(options.firmaDataUrl, "PNG", sigX, cursor.y, sigW, sigH);
      cursor.y += sigH + 4;
    } catch {
      /* sin imagen: solo texto */
    }
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  setTextColor(doc, C.muted);
  doc.text("FIRMADO DIGITALMENTE", sigX + sigW / 2, cursor.y, { align: "center" });
  cursor.y += 2;
  setStroke(doc, NAVY);
  doc.setLineWidth(0.4);
  doc.line(sigX, cursor.y, sigX + sigW, cursor.y);
  cursor.y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setTextColor(doc, C.ink);
  doc.text(options.firmaCargo ?? "Desarrollador Principal / Director", sigX + sigW / 2, cursor.y, {
    align: "center",
  });
  cursor.y += 6;
}

/* ============================================================
   MARCA DE AGUA — PAGADO / ANULADO en diagonal
   ============================================================ */
function drawSynWatermark(doc: jsPDF, totals: ReceiptTotals, anulado: boolean): void {
  if (anulado) {
    marcaAgua(doc, "ANULADO", RED, 0.09);
    return;
  }
  if (totals.balanceDue > 0.01) return;
  marcaAgua(doc, "PAGADO", ORANGE, 0.13);
}

function marcaAgua(doc: jsPDF, texto: string, color: RGB, opacity: number): void {
  doc.saveGraphicsState();
  try {
    const GState = (doc as unknown as { GState: new (o: object) => object }).GState;
    doc.setGState(new GState({ opacity }) as never);
  } catch {
    /* sin opacidad: el color claro igual se ve sutil */
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(110);
  doc.setTextColor(color[0], color[1], color[2]);
  doc.text(texto, PAGE.w / 2, PAGE.h / 2, { align: "center", angle: 30 });
  doc.restoreGraphicsState();
}

/* ============================================================
   PIE — banda navy con diagonal naranja
   ============================================================ */
function drawSynFooter(
  doc: jsPDF,
  receipt: Receipt,
  pageNum: number,
  pageCount: number,
  options: SynapticaPdfOptions
): void {
  const fy = 273;
  setFill(doc, NAVY);
  doc.rect(0, fy, PAGE.w, PAGE.h - fy, "F");

  // Diagonal naranja inferior derecha + filete blanco
  setFill(doc, ORANGE);
  doc.triangle(PAGE.w, fy, PAGE.w, PAGE.h, 184, PAGE.h, "F");
  setStroke(doc, WHITE);
  doc.setLineWidth(0.6);
  doc.line(PAGE.w, fy, 184, PAGE.h);
  if (options.logoDataUrl) {
    try {
      // +4mm abajo y a la derecha hasta el borde (x=198: con 15mm se salía de la página).
      doc.addImage(options.logoDataUrl, "PNG", 196.5, 283, 12, (12 * 1614) / 1904);
    } catch {
      /* sin logo */
    }
  }

  const em = emisorDe(receipt);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  setTextColor(doc, HEAD_SUB);
  doc.text("INFORMACI\u00d3N DE EMISI\u00d3N", 12, fy + 5.5);
  doc.setFontSize(9);
  setTextColor(doc, WHITE);
  doc.text(em.nombre, 12, fy + 10.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setTextColor(doc, HEAD_SUB);
  const lineaId = [em.rif, em.telefono].filter(Boolean).join("  \u00b7  ");
  if (lineaId) doc.text(lineaId, 12, fy + 15.8);

  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(9);
  setTextColor(doc, WHITE);
  doc.text(SYN.gracias, PAGE.w / 2, fy + 10.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setTextColor(doc, FOOT_TXT);
  if (em.email) doc.text(em.email, 181, fy + 8.5, { align: "right" });
  const lineaDir = [em.direccion, SYN.ciudad].filter(Boolean).join(", ");
  if (lineaDir) doc.text(lineaDir, 181, fy + 17.5, { align: "right" });

  doc.setFontSize(6);
  setTextColor(doc, HEAD_SUB);
  doc.text(`P\u00e1gina ${pageNum} de ${pageCount}`, PAGE.w / 2, 294.5, { align: "center" });
}
