/**
 * Finanzas (Fase 1): cliente del libro. Habla directo con las tablas vía RLS
 * (el usuario autenticado es dueño o miembro del hogar). El secreto de RPC
 * es solo para WhatsApp/integraciones (scripts/), nunca llega al navegador.
 */

import { getSupabase, getSessionUser } from "../core/supabase";
import { obtenerMiHogar } from "../core/hogar";
import type {
  FinCuenta,
  FinCuentaConSaldo,
  FinMoneda,
  FinMovimiento,
  FinResumenDia,
  FinTipoMov,
} from "./types";

/** Hoy en America/Caracas, YYYY-MM-DD. */
export function hoyCaracas(fecha = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
  return partes; // en-CA ya da YYYY-MM-DD
}

function lanzarSiHayError(error: unknown, contexto: string): void {
  if (error) {
    const e = error as { message?: string };
    throw new Error(`${contexto}: ${e.message ?? "error desconocido"}`);
  }
}

function filaACuenta(f: Record<string, unknown>): FinCuenta {
  return {
    id: String(f.id),
    nombre: String(f.nombre),
    moneda: f.moneda as FinCuenta["moneda"],
    tipo: f.tipo as FinCuenta["tipo"],
    tasaUsdManual: f.tasa_usd_manual == null ? null : Number(f.tasa_usd_manual),
    archivada: Boolean(f.archivada),
    hogarId: (f.hogar_id as string | null) ?? null,
    creadoEn: String(f.creado_en),
  };
}

/** Cuentas activas del usuario (personales + del hogar) con sus saldos.
 * Dos consultas: la vista fin_saldos no tiene FK hacia fin_cuentas, así que
 * PostgREST no admite embeberla (`fin_saldos!inner` falla). Se unen en código.
 */
export async function listarCuentasConSaldos(): Promise<FinCuentaConSaldo[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data: cuentas, error: eCuentas } = await supabase
    .from("fin_cuentas")
    .select("*")
    .eq("archivada", false)
    .order("creado_en", { ascending: true });
  lanzarSiHayError(eCuentas, "No se pudieron cargar las cuentas");
  const { data: saldos, error: eSaldos } = await supabase
    .from("fin_saldos")
    .select("cuenta_id, saldo_moneda, saldo_usd, n_movimientos");
  lanzarSiHayError(eSaldos, "No se pudieron cargar los saldos");
  const porCuenta = new Map(
    ((saldos ?? []) as Record<string, unknown>[]).map((s) => [
      String(s.cuenta_id),
      s,
    ])
  );
  return ((cuentas ?? []) as Record<string, unknown>[]).map((f) => {
    const s = (porCuenta.get(String(f.id)) ?? {}) as Record<string, unknown>;
    return {
      ...filaACuenta(f),
      saldoMoneda: Number(s.saldo_moneda ?? 0),
      saldoUsd: Number(s.saldo_usd ?? 0),
      nMovimientos: Number(s.n_movimientos ?? 0),
    };
  });
}

/** Crea una cuenta. `compartida=true` la ata al hogar del usuario (si tiene). */
export async function crearCuenta(input: {
  nombre: string;
  moneda: FinMoneda;
  tipo: FinCuenta["tipo"];
  tasaUsdManual?: number | null;
  compartida?: boolean;
}): Promise<FinCuenta> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("La cuenta necesita un nombre");
  if (input.moneda === "COP" && !(input.tasaUsdManual && input.tasaUsdManual > 0)) {
    throw new Error("COP necesita una tasa manual (COP por $1)");
  }
  let hogarId: string | null = null;
  if (input.compartida) {
    const hogar = await obtenerMiHogar(supabase);
    if (!hogar) throw new Error("No perteneces a ningún hogar");
    hogarId = hogar.id;
  }
  const { data, error } = await supabase
    .from("fin_cuentas")
    .insert({
      user_id: user.id,
      hogar_id: hogarId,
      nombre,
      moneda: input.moneda,
      tipo: input.tipo,
      tasa_usd_manual:
        input.tasaUsdManual && input.tasaUsdManual > 0 ? input.tasaUsdManual : null,
      creado_por: user.id,
    })
    .select()
    .single();
  lanzarSiHayError(error, "No se pudo crear la cuenta");
  return filaACuenta(data as Record<string, unknown>);
}

/** Archiva una cuenta (no se borra: el historial se conserva). */
export async function archivarCuenta(cuentaId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase
    .from("fin_cuentas")
    .update({ archivada: true })
    .eq("id", cuentaId);
  lanzarSiHayError(error, "No se pudo archivar la cuenta");
}

/** Actualiza nombre, tipo y tasa manual de una cuenta. La moneda solo se puede
 * cambiar si la cuenta aún no tiene movimientos (cambiarla con historial
 * corrompería los equivalentes en USD ya registrados). */
export async function actualizarCuenta(
  cuentaId: string,
  input: {
    nombre: string;
    tipo: FinCuenta["tipo"];
    tasaUsdManual?: number | null;
    moneda?: FinMoneda;
  }
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("La cuenta necesita un nombre");
  const cambios: Record<string, unknown> = {
    nombre,
    tipo: input.tipo,
    tasa_usd_manual:
      input.tasaUsdManual && input.tasaUsdManual > 0 ? input.tasaUsdManual : null,
  };
  if (input.moneda) {
    const { data: actual, error: eActual } = await supabase
      .from("fin_cuentas")
      .select("moneda")
      .eq("id", cuentaId)
      .single();
    lanzarSiHayError(eActual, "No se pudo leer la cuenta");
    if ((actual as { moneda: string }).moneda !== input.moneda) {
      const { count, error: eMov } = await supabase
        .from("fin_movimientos")
        .select("id", { count: "exact", head: true })
        .eq("cuenta_id", cuentaId);
      lanzarSiHayError(eMov, "No se pudieron revisar los movimientos");
      if ((count ?? 0) > 0) {
        throw new Error("No se puede cambiar la moneda: la cuenta ya tiene movimientos");
      }
      cambios.moneda = input.moneda;
    }
  }
  const { error } = await supabase
    .from("fin_cuentas")
    .update(cambios)
    .eq("id", cuentaId);
  lanzarSiHayError(error, "No se pudo actualizar la cuenta");
}

/** Última tasa VES→USD (1 Bs → USD) desde fin_tasas. */
async function tasaVesSnapshot(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { data, error } = await supabase
    .from("fin_tasas")
    .select("paralelo")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  lanzarSiHayError(error, "No se pudo leer la tasa del día");
  const paralelo = Number((data as { paralelo?: number } | null)?.paralelo ?? 0);
  if (!(paralelo > 0)) throw new Error("No hay tasa VES disponible");
  return 1 / paralelo;
}

/** Snapshot 1 unidad de moneda → USD (manual > fin_tasas). */
async function tasaUsdSnapshot(
  moneda: FinMoneda,
  manual: number | null
): Promise<number> {
  if (manual != null && manual > 0) return manual;
  if (moneda === "USD" || moneda === "USDT") return 1;
  if (moneda === "VES") return tasaVesSnapshot();
  throw new Error("COP necesita una tasa manual en la cuenta");
}

function claveEvento(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `app-${Date.now().toString(36)}-${r}`;
}

export interface NuevoMovimiento {
  tipo: FinTipoMov;
  cuentaId: string;
  cuentaDestinoId?: string | null;
  monto: number;
  categoria?: string | null;
  fecha?: string; // YYYY-MM-DD; hoy Caracas por defecto
  nota?: string | null;
}

/** Registra ingreso/egreso/transferencia con snapshot de tasa. Idempotente. */
export async function registrarMovimiento(input: NuevoMovimiento): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a 0");

  const { data: cuenta, error: eCuenta } = await supabase
    .from("fin_cuentas")
    .select("id, moneda, tasa_usd_manual, hogar_id")
    .eq("id", input.cuentaId)
    .single();
  lanzarSiHayError(eCuenta, "Cuenta no encontrada");
  const c = cuenta as { moneda: FinMoneda; tasa_usd_manual: number | null; hogar_id: string | null };
  const tasa = await tasaUsdSnapshot(c.moneda, c.tasa_usd_manual);

  let destinoId: string | null = null;
  let montoDestino: number | null = null;
  let tasaDestino: number | null = null;
  if (input.tipo === "transferencia") {
    if (!input.cuentaDestinoId) throw new Error("Falta la cuenta destino");
    if (input.cuentaDestinoId === input.cuentaId)
      throw new Error("Origen y destino no pueden ser la misma cuenta");
    const { data: dest, error: eDest } = await supabase
      .from("fin_cuentas")
      .select("id, moneda, tasa_usd_manual")
      .eq("id", input.cuentaDestinoId)
      .single();
    lanzarSiHayError(eDest, "Cuenta destino no encontrada");
    const d = dest as { moneda: FinMoneda; tasa_usd_manual: number | null };
    tasaDestino = await tasaUsdSnapshot(d.moneda, d.tasa_usd_manual);
    destinoId = input.cuentaDestinoId;
    montoDestino = Math.round((input.monto * tasa) / tasaDestino * 100) / 100;
  }

  const { data, error } = await supabase
    .from("fin_movimientos")
    .insert({
      user_id: user.id,
      hogar_id: c.hogar_id,
      cuenta_id: input.cuentaId,
      cuenta_destino_id: destinoId,
      tipo: input.tipo,
      categoria: input.categoria?.trim().toLowerCase() || null,
      monto: Math.round(input.monto * 100) / 100,
      monto_destino: montoDestino,
      tasa_usd: tasa,
      tasa_usd_destino: tasaDestino,
      fecha: input.fecha || hoyCaracas(),
      nota: input.nota?.trim() || null,
      clave_evento: claveEvento(),
      creado_por: user.id,
    })
    .select("id")
    .single();
  lanzarSiHayError(error, "No se pudo registrar el movimiento");
  return (data as { id: string }).id;
}

/** Últimos movimientos (no anulados) con nombres de cuenta. */
export async function listarMovimientos(limite = 20): Promise<FinMovimiento[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("fin_movimientos")
    .select(
      "*, cuenta:fin_cuentas!fin_movimientos_cuenta_id_fkey(nombre, moneda), destino:fin_cuentas!fin_movimientos_cuenta_destino_id_fkey(nombre)"
    )
    .is("anulado_en", null)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(limite);
  lanzarSiHayError(error, "No se pudieron cargar los movimientos");
  return ((data ?? []) as Record<string, unknown>[]).map((f) => {
    const cuenta = (f.cuenta ?? {}) as Record<string, unknown>;
    const destino = (f.destino ?? {}) as Record<string, unknown>;
    return {
      id: String(f.id),
      cuentaId: String(f.cuenta_id),
      cuentaDestinoId: (f.cuenta_destino_id as string | null) ?? null,
      tipo: f.tipo as FinTipoMov,
      categoria: (f.categoria as string | null) ?? null,
      monto: Number(f.monto),
      montoDestino: f.monto_destino == null ? null : Number(f.monto_destino),
      tasaUsd: Number(f.tasa_usd),
      fecha: String(f.fecha),
      nota: (f.nota as string | null) ?? null,
      claveEvento: (f.clave_evento as string | null) ?? null,
      creadoEn: String(f.creado_en),
      anuladoEn: (f.anulado_en as string | null) ?? null,
      cuentaNombre: cuenta.nombre != null ? String(cuenta.nombre) : undefined,
      cuentaMoneda: (cuenta.moneda as FinMoneda | undefined) ?? undefined,
      destinoNombre: destino.nombre != null ? String(destino.nombre) : null,
    };
  });
}

/** Anula un movimiento (soft delete: el historial se conserva). */
export async function anularMovimiento(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase
    .from("fin_movimientos")
    .update({ anulado_en: new Date().toISOString() })
    .eq("id", id);
  lanzarSiHayError(error, "No se pudo anular el movimiento");
}

/** Ingresos vs egresos (USD) de los últimos 7 días, por día. */
export async function resumenSemanal(): Promise<FinResumenDia[]> {
  const movs = await listarMovimientos(500);
  const dias: FinResumenDia[] = [];
  const ahora = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ahora);
    d.setDate(d.getDate() - i);
    dias.push({ fecha: hoyCaracas(d), ingresosUsd: 0, egresosUsd: 0 });
  }
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  for (const m of movs) {
    const dia = porFecha.get(m.fecha);
    if (!dia) continue;
    const usd = m.monto * m.tasaUsd;
    if (m.tipo === "ingreso") dia.ingresosUsd += usd;
    else if (m.tipo === "egreso") dia.egresosUsd += usd;
  }
  for (const d of dias) {
    d.ingresosUsd = Math.round(d.ingresosUsd * 100) / 100;
    d.egresosUsd = Math.round(d.egresosUsd * 100) / 100;
  }
  return dias;
}

/** Patrimonio total en USD (suma de saldos). */
export function patrimonioUsd(cuentas: FinCuentaConSaldo[]): number {
  return Math.round(cuentas.reduce((acc, c) => acc + c.saldoUsd, 0) * 100) / 100;
}

/** Formato es-VE: 1.234,56. `moneda` elige el símbolo. */
export function formatearMonto(monto: number, moneda: FinMoneda): string {
  const simbolo = moneda === "VES" ? "Bs" : moneda === "COP" ? "COP" : "$";
  const texto = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto);
  return moneda === "USDT" ? `${texto} USDT` : `${simbolo} ${texto}`;
}

/* --- Datos (estadísticas del módulo Finanzas) --- */

export interface FinDatoMes {
  clave: string; // YYYY-MM
  etiqueta: string; // "sep 26"
  ingresosUsd: number;
  egresosUsd: number;
  flujoNetoUsd: number;
}

export interface FinTopCategoria {
  categoria: string;
  usd: number;
}

export interface FinDatos {
  meses: FinDatoMes[];
  topCategorias: FinTopCategoria[];
  totalEgresosMesUsd: number;
}

const MESES_CORTO_FIN = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function claveMesCaracas(d: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
  }).format(d);
  return partes; // YYYY-MM
}

/**
 * Datos para la vista "Datos" de Finanzas: balance de los últimos 6 meses
 * (ingresos/egresos en USD con la tasa histórica de cada movimiento) y las
 * categorías donde más se gastó en el mes actual.
 */
export async function obtenerDatosFinanzas(): Promise<FinDatos> {
  const movs = await listarMovimientos(2000);
  const ahora = new Date();
  const meses: FinDatoMes[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const clave = claveMesCaracas(d);
    const anio = Number(clave.slice(0, 4));
    const mes = Number(clave.slice(5, 7));
    meses.push({
      clave,
      etiqueta: `${MESES_CORTO_FIN[mes - 1]} ${String(anio).slice(2)}`,
      ingresosUsd: 0,
      egresosUsd: 0,
      flujoNetoUsd: 0,
    });
  }
  const porClave = new Map(meses.map((m) => [m.clave, m]));
  const porCategoria = new Map<string, number>();
  const claveMesActual = claveMesCaracas(ahora);
  for (const m of movs) {
    // Regla (2026-10-10, luigi): traspaso no es gasto/ingreso real, se excluye.
    if ((m.categoria ?? "") === "traspaso") continue;
    const usd = Math.round(m.monto * m.tasaUsd * 100) / 100;
    const mes = porClave.get(m.fecha.slice(0, 7));
    if (mes) {
      if (m.tipo === "ingreso") mes.ingresosUsd += usd;
      else if (m.tipo === "egreso") mes.egresosUsd += usd;
    }
    if (m.tipo === "egreso" && m.fecha.slice(0, 7) === claveMesActual) {
      const cat = m.categoria?.trim() || "Sin categoría";
      porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + usd);
    }
  }
  for (const m of meses) {
    m.ingresosUsd = Math.round(m.ingresosUsd * 100) / 100;
    m.egresosUsd = Math.round(m.egresosUsd * 100) / 100;
    m.flujoNetoUsd = Math.round((m.ingresosUsd - m.egresosUsd) * 100) / 100;
  }
  const topCategorias = [...porCategoria.entries()]
    .map(([categoria, usd]) => ({ categoria, usd: Math.round(usd * 100) / 100 }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  const totalEgresosMesUsd = Math.round(
    [...porCategoria.values()].reduce((a, b) => a + b, 0) * 100,
  ) / 100;
  return { meses, topCategorias, totalEgresosMesUsd };
}
