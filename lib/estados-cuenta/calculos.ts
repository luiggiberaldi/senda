/**
 * Estados de cuenta — cálculos puros (sin I/O).
 * Funciones deterministas: toda la aritmética del estado de cuenta vive aquí
 * para poder probarse sin red ni base de datos.
 */
import type { ECItem, ECPago, ECEstado } from "./tipos";

export interface ECTotales {
  totalModulos: number;
  subtotalItems: number;
  /** Total de servicios = módulos + ítems. */
  totalServicios: number;
  totalPagado: number;
  /** Saldo pendiente = totalServicios − totalPagado (nunca negativo). */
  saldoPendiente: number;
  /** Suma de las nuevas implementaciones pendientes (filas resaltadas del PDF). */
  nuevasPendientes: number;
  estado: ECEstado;
}

function num(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Redondea a 2 decimales (dinero). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularTotales(items: ECItem[], pagos: ECPago[]): ECTotales {
  const totalModulos = redondear2(
    items.filter((i) => i.tipo === "modulo").reduce((s, i) => s + num(i.monto), 0)
  );
  const subtotalItems = redondear2(
    items.filter((i) => i.tipo === "item").reduce((s, i) => s + num(i.monto), 0)
  );
  const totalServicios = redondear2(totalModulos + subtotalItems);
  const totalPagado = redondear2(pagos.reduce((s, p) => s + num(p.monto), 0));
  const saldoPendiente = redondear2(Math.max(totalServicios - totalPagado, 0));
  const nuevasPendientes = redondear2(
    items
      .filter((i) => i.tipo === "item" && i.clasificacion === "nueva")
      .reduce((s, i) => s + num(i.monto), 0)
  );
  const estado: ECEstado =
    totalPagado <= 0 ? "pendiente" : totalPagado >= totalServicios ? "pagado" : "parcial";
  return {
    totalModulos,
    subtotalItems,
    totalServicios,
    totalPagado,
    saldoPendiente,
    nuevasPendientes,
    estado,
  };
}

/** Formato de dinero del PDF: 1.234,56 (es-VE) con símbolo. */
export function formatoUSD(n: number): string {
  return (
    "$" +
    redondear2(n).toLocaleString("es-VE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "2026-10-05" -> "05 de octubre de 2026". */
export function formatoFechaLarga(iso: string): string {
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const mi = Math.min(Math.max(Number(mo), 1), 12) - 1;
  return `${Number(d)} de ${meses[mi]} de ${y}`;
}

/** "2026-10-05" -> "05/10/2026". */
export function formatoFechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
