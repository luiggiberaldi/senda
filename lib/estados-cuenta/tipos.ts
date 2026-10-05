/**
 * Estados de cuenta Synaptica — tipos.
 * Creador de estados de cuenta (facturación freelance) con la plantilla
 * del PDF N° 2026-095 aprobada por luigi.
 */

export type ECItemTipo = "modulo" | "item";
export type ECClasificacion = "modificacion" | "nueva";
export type ECEstado = "pendiente" | "parcial" | "pagado";

export interface ECItem {
  id: string;
  estado_cuenta_id: string;
  orden: number;
  tipo: ECItemTipo;
  titulo: string;
  descripcion: string | null;
  clasificacion: ECClasificacion | null;
  monto: number;
  listo: boolean;
  creado_en: string;
}

export interface ECPago {
  id: string;
  estado_cuenta_id: string;
  fecha: string; // ISO yyyy-mm-dd
  concepto: string;
  monto: number;
  /** Id del movimiento en Finanzas si el abono se llevó allá (solo a pedido). */
  fin_movimiento_id: string | null;
  creado_en: string;
}

export interface EstadoCuenta {
  id: string;
  numero: string; // "2026-095"
  cliente: string;
  proyecto: string | null;
  condicion: string;
  moneda: string;
  fecha_emision: string; // ISO yyyy-mm-dd
  notas: string | null;
  total: number;
  total_pagado: number;
  saldo: number;
  estado: ECEstado;
  creado_en: string;
  actualizado_en: string;
}

export interface EstadoCuentaCompleto {
  cabecera: EstadoCuenta;
  items: ECItem[];
  pagos: ECPago[];
}

export interface NuevoEstadoCuenta {
  cliente: string;
  proyecto: string;
  condicion: string;
  fecha_emision: string; // ISO yyyy-mm-dd | ""
  notas: string;
}

export interface ItemNuevo {
  tipo: ECItemTipo;
  titulo: string;
  descripcion: string;
  clasificacion: ECClasificacion | null;
  monto: number;
  listo: boolean;
}

export interface PagoNuevo {
  fecha: string; // ISO yyyy-mm-dd | ""
  concepto: string;
  monto: number;
}

export const EC_ESTADO_LABELS: Record<ECEstado, string> = {
  pendiente: "Pendiente de pago",
  parcial: "Pago parcial",
  pagado: "Pagado",
};

export const EC_CLASIFICACION_LABELS: Record<ECClasificacion, string> = {
  modificacion: "Modificación",
  nueva: "Nueva Implementación",
};

export const EC_TIPO_LABELS: Record<ECItemTipo, string> = {
  modulo: "Módulo",
  item: "Ítem",
};
