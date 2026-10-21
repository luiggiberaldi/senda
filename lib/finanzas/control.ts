/**
 * Control (Fase 3): recordatorios de pago, presupuestos, deudas, metas y
 * cierre de mes. La UI habla directo con las tablas vía RLS (el usuario
 * autenticado es dueño o miembro del hogar); los RPC con secreto son para
 * WhatsApp/integraciones (scripts/), nunca llegan al navegador.
 *
 * Patrones heredados de lib/finanzas/finanzas.ts: tasaUsdSnapshot manual >
 * fin_tasas; movimientos con clave_evento idempotente; hogar_id heredado.
 */

import { getSupabase, getSessionUser } from "../core/supabase";
import { obtenerMiHogar } from "../core/hogar";
import type { FinMoneda } from "./types";
import { registrarMovimiento, hoyCaracas } from "./finanzas";

export type FinRecordatorioTipo = "ingreso" | "egreso";
export type FinDeudaTipo = "por_cobrar" | "por_pagar";

export interface ControlRecordatorio {
  id: string;
  nombre: string;
  tipo: FinRecordatorioTipo;
  categoria: string | null;
  monto: number;
  moneda: FinMoneda;
  cuentaId: string | null;
  cuenta: string | null;
  diaMes: number;
  diasAviso: number;
  activo: boolean;
  ultimoPago: string | null;
  proximo: string;
  estado: "vencido" | "por_vencer" | "pendiente";
  diasRestantes: number;
}

export interface ControlPresupuesto {
  id: string;
  categoria: string;
  limite: number;
  moneda: FinMoneda;
  limiteUsd: number;
  gastadoUsd: number;
  pct: number;
  estado: "ok" | "alerta" | "excedido";
}

export interface ControlDeuda {
  id: string;
  tipo: FinDeudaTipo;
  contraparte: string;
  monto: number;
  abonado: number;
  moneda: FinMoneda;
  pendiente: number;
  fechaLimite: string | null;
  nota: string | null;
  cuentaId: string | null;
  cuenta: string | null;
  estado: "pendiente" | "saldada";
}

export interface ControlMeta {
  id: string;
  nombre: string;
  objetivo: number;
  moneda: FinMoneda;
  fechaObjetivo: string | null;
  objetivoUsd: number;
  aportadoUsd: number;
  pct: number;
}

export interface ControlCierre {
  mes: string;
  ingresosUsd: number;
  egresosUsd: number;
  balanceUsd: number;
  mesAnterior: { ingresosUsd: number; egresosUsd: number };
  porCategoria: { categoria: string; total_usd: number; n: number }[];
}

function lanzarSiHayError(error: unknown, contexto: string): void {
  if (error) {
    const e = error as { message?: string };
    throw new Error(`${contexto}: ${e.message ?? "error desconocido"}`);
  }
}

/** Próximo vencimiento: día D del mes (último día si D no existe en el mes). */
export function proximoVencimiento(diaMes: number, ultimoPago: string | null, hoy = hoyCaracas()): string {
  const diasEnMes = (ymd: string) => {
    const [y, m] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  const candDe = (ymd: string) => {
    const d = Math.min(diaMes, diasEnMes(ymd));
    return `${ymd.slice(0, 8)}${String(d).padStart(2, "0")}`;
  };
  let cand = candDe(hoy);
  if (ultimoPago && ultimoPago >= cand) {
    const [y, m] = hoy.split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    cand = candDe(`${ny}-${String(nm).padStart(2, "0")}-01`);
  }
  return cand;
}

export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);
}

const MESES: [string, string][] = [
  ["01", "Enero"], ["02", "Febrero"], ["03", "Marzo"], ["04", "Abril"],
  ["05", "Mayo"], ["06", "Junio"], ["07", "Julio"], ["08", "Agosto"],
  ["09", "Septiembre"], ["10", "Octubre"], ["11", "Noviembre"], ["12", "Diciembre"],
];

export function mesActualCaracas(): string {
  return hoyCaracas().slice(0, 7); // YYYY-MM
}

export function etiquetaMes(ym: string): string {
  const [y, m] = ym.split("-");
  const nombre = MESES.find(([n]) => n === m)?.[1] ?? m;
  return `${nombre} ${y}`;
}

/** 1 unidad de moneda → USD (manual > fin_tasas). Replica del cliente de finanzas. */
export async function tasaUsdPara(moneda: FinMoneda): Promise<number> {
  if (moneda === "USD" || moneda === "USDT") return 1;
  if (moneda === "VES") {
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
  throw new Error("COP necesita una tasa manual en la cuenta");
}

// ── Recordatorios ────────────────────────────────────────────────────────────

export interface NuevoRecordatorio {
  nombre: string;
  tipo: FinRecordatorioTipo;
  monto: number;
  moneda: FinMoneda;
  diaMes: number;
  cuentaId?: string | null;
  categoria?: string | null;
  diasAviso?: number;
}

function filaARecordatorio(f: Record<string, unknown>): ControlRecordatorio {
  const hoy = hoyCaracas();
  const ultimoPago = (f.ultimo_pago as string | null) ?? null;
  const proximo = proximoVencimiento(Number(f.dia_mes), ultimoPago, hoy);
  const diasRestantes = diasEntre(hoy, proximo);
  const diasAviso = Number(f.dias_aviso ?? 3);
  return {
    id: String(f.id),
    nombre: String(f.nombre),
    tipo: f.tipo as FinRecordatorioTipo,
    categoria: (f.categoria as string | null) ?? null,
    monto: Number(f.monto),
    moneda: f.moneda as FinMoneda,
    cuentaId: (f.cuenta_id as string | null) ?? null,
    cuenta: null,
    diaMes: Number(f.dia_mes),
    diasAviso,
    activo: Boolean(f.activo),
    ultimoPago,
    proximo,
    estado: proximo < hoy ? "vencido" : diasRestantes <= diasAviso ? "por_vencer" : "pendiente",
    diasRestantes,
  };
}

export async function listarRecordatorios(): Promise<ControlRecordatorio[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("fin_recordatorios")
    .select("*")
    .order("dia_mes", { ascending: true });
  lanzarSiHayError(error, "No se pudieron leer los recordatorios");
  const filas = (data ?? []) as Record<string, unknown>[];
  const recs = filas.map(filaARecordatorio);
  if (filas.length === 0) return recs;
  const cuentaIds = [...new Set(filas.map((f) => f.cuenta_id).filter(Boolean))] as string[];
  if (cuentaIds.length > 0) {
    const { data: cuentas } = await supabase
      .from("fin_cuentas")
      .select("id, nombre")
      .in("id", cuentaIds);
    const porId = new Map((cuentas ?? []).map((c: { id: string; nombre: string }) => [c.id, c.nombre]));
    for (const r of recs) r.cuenta = r.cuentaId ? (porId.get(r.cuentaId) ?? null) : null;
  }
  return recs.sort((a, b) => a.proximo.localeCompare(b.proximo));
}

export async function guardarRecordatorio(input: NuevoRecordatorio, id?: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!input.nombre.trim()) throw new Error("Falta el nombre");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a 0");
  if (!(input.diaMes >= 1 && input.diaMes <= 31)) throw new Error("El día debe estar entre 1 y 31");
  const hogar = await obtenerMiHogar(supabase);
  const fila = {
    user_id: user.id,
    hogar_id: hogar?.id ?? null,
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    categoria: input.categoria?.trim().toLowerCase() || null,
    monto: Math.round(input.monto * 100) / 100,
    moneda: input.moneda,
    cuenta_id: input.cuentaId || null,
    dia_mes: input.diaMes,
    dias_aviso: input.diasAviso ?? 3,
    creado_por: user.id,
  };
  if (id) {
    const { error } = await supabase.from("fin_recordatorios").update(fila).eq("id", id);
    lanzarSiHayError(error, "No se pudo actualizar el recordatorio");
    return id;
  }
  const { data, error } = await supabase.from("fin_recordatorios").insert(fila).select("id").single();
  lanzarSiHayError(error, "No se pudo guardar el recordatorio");
  return (data as { id: string }).id;
}

export async function alternarRecordatorio(id: string, activo: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase.from("fin_recordatorios").update({ activo }).eq("id", id);
  lanzarSiHayError(error, "No se pudo cambiar el estado");
}

export async function eliminarRecordatorio(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase.from("fin_recordatorios").delete().eq("id", id);
  lanzarSiHayError(error, "No se pudo eliminar el recordatorio");
}

/**
 * Pagar un recordatorio: registra el egreso/ingreso en la cuenta (convirtiendo
 * la moneda del recordatorio a la de la cuenta) y reprograma ultimo_pago.
 * Idempotente por día gracias a la clave de evento.
 */
export async function pagarRecordatorio(
  rec: ControlRecordatorio,
  cuentaId: string,
  monto?: number,
  nota?: string
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const montoRec = monto && monto > 0 ? monto : rec.monto;
  // Convertir recordatorio.moneda → cuenta.moneda.
  const { data: cuenta, error: eCta } = await supabase
    .from("fin_cuentas")
    .select("id, moneda, tasa_usd_manual")
    .eq("id", cuentaId)
    .single();
  lanzarSiHayError(eCta, "Cuenta no encontrada");
  const c = cuenta as { moneda: FinMoneda; tasa_usd_manual: number | null };
  const tasaRec = await tasaUsdPara(rec.moneda);
  const tasaCta = c.tasa_usd_manual && c.tasa_usd_manual > 0 ? c.tasa_usd_manual : await tasaUsdPara(c.moneda);
  const montoCuenta = Math.round(((montoRec * tasaRec) / tasaCta) * 100) / 100;

  const hoy = hoyCaracas();
  await registrarMovimiento({
    tipo: rec.tipo,
    cuentaId,
    monto: montoCuenta,
    categoria: rec.categoria || "recurrente",
    fecha: hoy,
    nota: nota?.trim() || rec.nombre,
  });

  const { error } = await supabase
    .from("fin_recordatorios")
    .update({ ultimo_pago: hoy })
    .eq("id", rec.id);
  lanzarSiHayError(error, "El movimiento se registró pero no se pudo reprogramar");
}

// ── Presupuestos ─────────────────────────────────────────────────────────────

export async function listarPresupuestos(mesYm: string): Promise<ControlPresupuesto[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const mes = `${mesYm}-01`;
  const { data: pres, error } = await supabase
    .from("fin_presupuestos")
    .select("*")
    .eq("mes", mes)
    .order("categoria");
  lanzarSiHayError(error, "No se pudieron leer los presupuestos");
  const filas = (pres ?? []) as Record<string, unknown>[];
  if (filas.length === 0) return [];

  const fin = new Date(Date.UTC(Number(mesYm.slice(0, 4)), Number(mesYm.slice(5, 7)), 0));
  const finStr = fin.toISOString().slice(0, 10);
  const { data: movs, error: eMov } = await supabase
    .from("fin_movimientos")
    .select("categoria, monto, tasa_usd")
    .eq("tipo", "egreso")
    .is("anulado_en", null)
    .gte("fecha", mes)
    .lte("fecha", finStr)
    .not("categoria", "is", null)
    .neq("categoria", "traspaso");
  lanzarSiHayError(eMov, "No se pudo leer el gasto del mes");

  const gastoPorCat = new Map<string, number>();
  for (const m of (movs ?? []) as { categoria: string; monto: number; tasa_usd: number }[]) {
    gastoPorCat.set(m.categoria, (gastoPorCat.get(m.categoria) ?? 0) + Number(m.monto) * Number(m.tasa_usd));
  }

  const out: ControlPresupuesto[] = [];
  for (const f of filas) {
    const cat = String(f.categoria);
    const moneda = f.moneda as FinMoneda;
    const limite = Number(f.monto_limite);
    const tasa = await tasaUsdPara(moneda).catch(() => 0);
    const limiteUsd = tasa > 0 ? limite * tasa : 0;
    const gastadoUsd = gastoPorCat.get(cat) ?? 0;
    const pct = limiteUsd > 0 ? Math.round((gastadoUsd / limiteUsd) * 1000) / 10 : 0;
    out.push({
      id: String(f.id),
      categoria: cat,
      limite,
      moneda,
      limiteUsd: Math.round(limiteUsd * 100) / 100,
      gastadoUsd: Math.round(gastadoUsd * 100) / 100,
      pct,
      estado: pct >= 100 ? "excedido" : pct >= 80 ? "alerta" : "ok",
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

export async function guardarPresupuesto(
  categoria: string,
  limite: number,
  moneda: FinMoneda,
  mesYm: string
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!categoria.trim()) throw new Error("Falta la categoría");
  if (!(limite > 0)) throw new Error("El límite debe ser mayor a 0");
  const hogar = await obtenerMiHogar(supabase);
  const { error } = await supabase.from("fin_presupuestos").upsert(
    {
      user_id: user.id,
      hogar_id: hogar?.id ?? null,
      categoria: categoria.trim().toLowerCase(),
      monto_limite: Math.round(limite * 100) / 100,
      moneda,
      mes: `${mesYm}-01`,
      creado_por: user.id,
    },
    { onConflict: "user_id,categoria,mes" }
  );
  lanzarSiHayError(error, "No se pudo guardar el presupuesto");
}

export async function eliminarPresupuesto(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase.from("fin_presupuestos").delete().eq("id", id);
  lanzarSiHayError(error, "No se pudo eliminar el presupuesto");
}

export async function copiarPresupuestos(origenYm: string, destinoYm: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  const { data: origen, error } = await supabase
    .from("fin_presupuestos")
    .select("*")
    .eq("mes", `${origenYm}-01`)
    .eq("user_id", user.id);
  lanzarSiHayError(error, "No se pudo leer el mes origen");
  const filas = (origen ?? []) as Record<string, unknown>[];
  if (filas.length === 0) return 0;
  const hogar = await obtenerMiHogar(supabase);
  const nuevos = filas.map((f) => ({
    user_id: user.id,
    hogar_id: (f.hogar_id as string | null) ?? hogar?.id ?? null,
    categoria: String(f.categoria),
    monto_limite: Number(f.monto_limite),
    moneda: f.moneda as FinMoneda,
    mes: `${destinoYm}-01`,
    creado_por: user.id,
  }));
  const { error: eIns } = await supabase
    .from("fin_presupuestos")
    .upsert(nuevos, { onConflict: "user_id,categoria,mes", ignoreDuplicates: true });
  lanzarSiHayError(eIns, "No se pudieron copiar los presupuestos");
  return nuevos.length;
}

// ── Deudas ───────────────────────────────────────────────────────────────────

function filaADeuda(f: Record<string, unknown>): ControlDeuda {
  const monto = Number(f.monto);
  const abonado = Number(f.abonado ?? 0);
  return {
    id: String(f.id),
    tipo: f.tipo as FinDeudaTipo,
    contraparte: String(f.contraparte),
    monto,
    abonado,
    moneda: f.moneda as FinMoneda,
    pendiente: Math.round((monto - abonado) * 100) / 100,
    fechaLimite: (f.fecha_limite as string | null) ?? null,
    nota: (f.nota as string | null) ?? null,
    cuentaId: (f.cuenta_id as string | null) ?? null,
    cuenta: null,
    estado: abonado >= monto ? "saldada" : "pendiente",
  };
}

export async function listarDeudas(): Promise<ControlDeuda[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("fin_deudas")
    .select("*")
    .order("fecha_limite", { ascending: true, nullsFirst: false });
  lanzarSiHayError(error, "No se pudieron leer las deudas");
  const filas = (data ?? []) as Record<string, unknown>[];
  const deudas = filas.map(filaADeuda);
  const cuentaIds = [...new Set(filas.map((f) => f.cuenta_id).filter(Boolean))] as string[];
  if (cuentaIds.length > 0) {
    const { data: cuentas } = await supabase.from("fin_cuentas").select("id, nombre").in("id", cuentaIds);
    const porId = new Map((cuentas ?? []).map((c: { id: string; nombre: string }) => [c.id, c.nombre]));
    for (const d of deudas) d.cuenta = d.cuentaId ? (porId.get(d.cuentaId) ?? null) : null;
  }
  return deudas;
}

export interface NuevaDeuda {
  tipo: FinDeudaTipo;
  contraparte: string;
  monto: number;
  moneda: FinMoneda;
  fechaLimite?: string | null;
  cuentaId?: string | null;
  nota?: string | null;
}

export async function guardarDeuda(input: NuevaDeuda, id?: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!input.contraparte.trim()) throw new Error("Falta con quién es la deuda");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a 0");
  const hogar = await obtenerMiHogar(supabase);
  const fila = {
    user_id: user.id,
    hogar_id: hogar?.id ?? null,
    tipo: input.tipo,
    contraparte: input.contraparte.trim(),
    monto: Math.round(input.monto * 100) / 100,
    moneda: input.moneda,
    fecha_limite: input.fechaLimite || null,
    nota: input.nota?.trim() || null,
    cuenta_id: input.cuentaId || null,
    creado_por: user.id,
  };
  if (id) {
    const { error } = await supabase.from("fin_deudas").update(fila).eq("id", id);
    lanzarSiHayError(error, "No se pudo actualizar la deuda");
    return id;
  }
  const { data, error } = await supabase.from("fin_deudas").insert(fila).select("id").single();
  lanzarSiHayError(error, "No se pudo guardar la deuda");
  return (data as { id: string }).id;
}

/** Abonar a una deuda: por_pagar → egreso; por_cobrar → ingreso. */
export async function abonarDeuda(
  deuda: ControlDeuda,
  monto: number,
  cuentaId: string,
  nota?: string
): Promise<void> {
  if (!(monto > 0)) throw new Error("El abono debe ser mayor a 0");
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { data: cuenta, error: eCta } = await supabase
    .from("fin_cuentas")
    .select("id, moneda, tasa_usd_manual")
    .eq("id", cuentaId)
    .single();
  lanzarSiHayError(eCta, "Cuenta no encontrada");
  const c = cuenta as { moneda: FinMoneda; tasa_usd_manual: number | null };
  const tasaDeuda = await tasaUsdPara(deuda.moneda);
  const tasaCta = c.tasa_usd_manual && c.tasa_usd_manual > 0 ? c.tasa_usd_manual : await tasaUsdPara(c.moneda);
  const montoCuenta = Math.round(((monto * tasaDeuda) / tasaCta) * 100) / 100;

  await registrarMovimiento({
    tipo: deuda.tipo === "por_pagar" ? "egreso" : "ingreso",
    cuentaId,
    monto: montoCuenta,
    categoria: "deuda",
    fecha: hoyCaracas(),
    nota: (nota?.trim() ? `${nota.trim()} · ` : "") + deuda.contraparte,
  });

  const { error } = await supabase
    .from("fin_deudas")
    .update({ abonado: Math.round((deuda.abonado + monto) * 100) / 100 })
    .eq("id", deuda.id);
  lanzarSiHayError(error, "El movimiento se registró pero no se pudo actualizar la deuda");
}

export async function eliminarDeuda(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase.from("fin_deudas").delete().eq("id", id);
  lanzarSiHayError(error, "No se pudo eliminar la deuda");
}

// ── Metas ────────────────────────────────────────────────────────────────────

export async function listarMetas(): Promise<ControlMeta[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data: metas, error } = await supabase.from("fin_metas").select("*").order("creado_en");
  lanzarSiHayError(error, "No se pudieron leer las metas");
  const filas = (metas ?? []) as Record<string, unknown>[];
  if (filas.length === 0) return [];
  const ids = filas.map((f) => String(f.id));
  const { data: aportes, error: eAp } = await supabase
    .from("fin_metas_aportes")
    .select("meta_id, monto, moneda")
    .in("meta_id", ids);
  lanzarSiHayError(eAp, "No se pudieron leer los aportes");
  const porMeta = new Map<string, { monto: number; moneda: FinMoneda }[]>();
  for (const a of (aportes ?? []) as { meta_id: string; monto: number; moneda: FinMoneda }[]) {
    const l = porMeta.get(a.meta_id) ?? [];
    l.push({ monto: Number(a.monto), moneda: a.moneda });
    porMeta.set(a.meta_id, l);
  }
  const out: ControlMeta[] = [];
  for (const f of filas) {
    const moneda = f.moneda as FinMoneda;
    const objetivo = Number(f.monto_objetivo);
    const tasaObj = await tasaUsdPara(moneda).catch(() => 0);
    const objetivoUsd = tasaObj > 0 ? objetivo * tasaObj : 0;
    let aportadoUsd = 0;
    for (const a of porMeta.get(String(f.id)) ?? []) {
      const t = await tasaUsdPara(a.moneda).catch(() => 0);
      if (t > 0) aportadoUsd += a.monto * t;
    }
    const pct = objetivoUsd > 0 ? Math.round((aportadoUsd / objetivoUsd) * 1000) / 10 : 0;
    out.push({
      id: String(f.id),
      nombre: String(f.nombre),
      objetivo,
      moneda,
      fechaObjetivo: (f.fecha_objetivo as string | null) ?? null,
      objetivoUsd: Math.round(objetivoUsd * 100) / 100,
      aportadoUsd: Math.round(aportadoUsd * 100) / 100,
      pct,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

export async function guardarMeta(
  nombre: string,
  objetivo: number,
  moneda: FinMoneda,
  fechaObjetivo?: string | null,
  id?: string
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  if (!nombre.trim()) throw new Error("Falta el nombre de la meta");
  if (!(objetivo > 0)) throw new Error("El objetivo debe ser mayor a 0");
  const hogar = await obtenerMiHogar(supabase);
  const fila = {
    user_id: user.id,
    hogar_id: hogar?.id ?? null,
    nombre: nombre.trim(),
    monto_objetivo: Math.round(objetivo * 100) / 100,
    moneda,
    fecha_objetivo: fechaObjetivo || null,
    creado_por: user.id,
  };
  if (id) {
    const { error } = await supabase.from("fin_metas").update(fila).eq("id", id);
    lanzarSiHayError(error, "No se pudo actualizar la meta");
    return id;
  }
  const { data, error } = await supabase.from("fin_metas").insert(fila).select("id").single();
  lanzarSiHayError(error, "No se pudo guardar la meta");
  return (data as { id: string }).id;
}

/** Aportar a una meta. Con cuenta → egreso "ahorro" (el dinero se aparta). */
export async function aportarAMeta(
  meta: ControlMeta,
  monto: number,
  cuentaId: string | null,
  nota?: string
): Promise<void> {
  if (!(monto > 0)) throw new Error("El aporte debe ser mayor a 0");
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");

  let movimientoId: string | null = null;
  if (cuentaId) {
    const { data: cuenta, error: eCta } = await supabase
      .from("fin_cuentas")
      .select("id, moneda, tasa_usd_manual")
      .eq("id", cuentaId)
      .single();
    lanzarSiHayError(eCta, "Cuenta no encontrada");
    const c = cuenta as { moneda: FinMoneda; tasa_usd_manual: number | null };
    const tasaMeta = await tasaUsdPara(meta.moneda);
    const tasaCta = c.tasa_usd_manual && c.tasa_usd_manual > 0 ? c.tasa_usd_manual : await tasaUsdPara(c.moneda);
    const montoCuenta = Math.round(((monto * tasaMeta) / tasaCta) * 100) / 100;
    movimientoId = await registrarMovimiento({
      tipo: "egreso",
      cuentaId,
      monto: montoCuenta,
      categoria: "ahorro",
      fecha: hoyCaracas(),
      nota: `Meta: ${meta.nombre}${nota?.trim() ? ` · ${nota.trim()}` : ""}`,
    });
  }

  const { error } = await supabase.from("fin_metas_aportes").insert({
    meta_id: meta.id,
    monto: Math.round(monto * 100) / 100,
    moneda: meta.moneda,
    fecha: hoyCaracas(),
    cuenta_id: cuentaId,
    fin_movimiento_id: movimientoId,
    nota: nota?.trim() || null,
    creado_por: user.id,
  });
  lanzarSiHayError(error, "No se pudo registrar el aporte");
}

export async function eliminarMeta(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const { error } = await supabase.from("fin_metas").delete().eq("id", id);
  lanzarSiHayError(error, "No se pudo eliminar la meta");
}

// ── Cierre de mes ────────────────────────────────────────────────────────────

export async function cierreDeMes(mesYm: string): Promise<ControlCierre> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const mes = `${mesYm}-01`;
  const y = Number(mesYm.slice(0, 4));
  const m = Number(mesYm.slice(5, 7));
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const prevIni = `${py}-${String(pm).padStart(2, "0")}-01`;

  const { data: movs, error } = await supabase
    .from("fin_movimientos")
    .select("tipo, categoria, monto, tasa_usd, fecha")
    .is("anulado_en", null)
    .gte("fecha", prevIni)
    .lte("fecha", fin);
  lanzarSiHayError(error, "No se pudo leer el cierre");

  let ing = 0, egr = 0, ingPrev = 0, egrPrev = 0;
  const porCat = new Map<string, { total: number; n: number }>();
  for (const mv of (movs ?? []) as { tipo: string; categoria: string | null; monto: number; tasa_usd: number; fecha: string }[]) {
    // Regla (2026-10-10, luigi): traspaso no es gasto/ingreso real, se excluye.
    if ((mv.categoria ?? "") === "traspaso") continue;
    const usd = Number(mv.monto) * Number(mv.tasa_usd);
    const enMes = mv.fecha >= mes;
    if (mv.tipo === "ingreso") {
      if (enMes) ing += usd; else ingPrev += usd;
    } else if (mv.tipo === "egreso") {
      if (enMes) {
        egr += usd;
        const cat = mv.categoria || "sin categoría";
        const e = porCat.get(cat) ?? { total: 0, n: 0 };
        e.total += usd;
        e.n += 1;
        porCat.set(cat, e);
      } else egrPrev += usd;
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    mes: mesYm,
    ingresosUsd: r2(ing),
    egresosUsd: r2(egr),
    balanceUsd: r2(ing - egr),
    mesAnterior: { ingresosUsd: r2(ingPrev), egresosUsd: r2(egrPrev) },
    porCategoria: [...porCat.entries()]
      .map(([categoria, v]) => ({ categoria, total_usd: r2(v.total), n: v.n }))
      .sort((a, b) => b.total_usd - a.total_usd)
      .slice(0, 10),
  };
}
