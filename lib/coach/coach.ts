/**
 * Coach de Senda (Fase 4): briefing cruzado de solo lectura.
 * La UI llama a `rpc_coach_briefing` con el JWT del navegador; el RPC acepta
 * la llamada cuando auth.uid() = p_user_id (el secreto es solo para scripts).
 * Sin XP ni gamificación: tono serio, cifras verificables en la app.
 */

import { getSupabase, getSessionUser } from "../core/supabase";

export interface CoachCorrelacion {
  id: string;
  titulo: string;
  detalle: string;
  ver_en: string;
  datos: Record<string, unknown>;
}

export interface TasaMovimiento {
  hoy: number | null;
  hace_7d: number | null;
  pct_7d: number | null;
}

export interface CoachBriefing {
  ventana: { desde: string; hasta: string };
  habitos: { completados_7d: number; completados_7d_prev: number };
  finanzas: {
    egresos_7d_usd: number;
    egresos_7d_prev_usd: number;
    ingresos_7d_usd: number;
    ingresos_7d_prev_usd: number;
    neto_7d_usd: number;
    neto_7d_prev_usd: number;
    top_categorias: Array<{ categoria: string; actual: number; previo: number; pct: number | null }>;
  };
  mercado: {
    lista_pendientes: number;
    productos_subieron: Array<{ nombre: string; pu_actual_usd: number; pu_previo_usd: number; pct: number }>;
  };
  control: {
    recordatorios_vencidos: number;
    presupuestos_alerta: Array<{ categoria: string; pct: number; estado: string }>;
    deudas_pendientes: number;
    deudas_pendientes_usd: number;
    deudas_vencen_7d: number;
  };
  tasas: { bcv: TasaMovimiento; euro: TasaMovimiento; usdt: TasaMovimiento };
  correlaciones: CoachCorrelacion[];
}

export async function obtenerBriefing(): Promise<CoachBriefing> {
  const supabase = getSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) throw new Error("sin_sesion");
  const { data, error } = await supabase.rpc("rpc_coach_briefing", { p_user_id: user.id });
  if (error) throw new Error(error.message.slice(0, 120));
  return data as CoachBriefing;
}
