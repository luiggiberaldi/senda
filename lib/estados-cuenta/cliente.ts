/**
 * Estados de cuenta — cliente web.
 * Lecturas directas por RLS; escrituras por RPC con auth dual
 * (el navegador usa su JWT, igual que Recibos y Mercado).
 */
import { getSupabase, getSessionUser } from "../core/supabase";
import { obtenerMiHogar } from "../core/hogar";
import { buildEstadoCuentaPdf, nombreArchivoEC } from "./pdf/estado-cuenta";
import type {
  EstadoCuenta,
  EstadoCuentaCompleto,
  NuevoEstadoCuenta,
  ItemNuevo,
  PagoNuevo,
  ECItem,
} from "./tipos";

function lanzarSiHayError(error: unknown, contexto: string): void {
  if (error) {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
    throw new Error(`${contexto}: ${msg}`);
  }
}

async function usuario(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sin sesión");
  return user.id;
}

function filaAEstadoCuenta(r: Record<string, unknown>): EstadoCuenta {
  return {
    id: String(r.id),
    numero: String(r.numero),
    cliente: String(r.cliente),
    proyecto: r.proyecto == null ? null : String(r.proyecto),
    condicion: String(r.condicion ?? "Tasa USDT"),
    moneda: String(r.moneda ?? "USD"),
    fecha_emision: String(r.fecha_emision),
    notas: r.notas == null ? null : String(r.notas),
    total: Number(r.total ?? 0),
    total_pagado: Number(r.total_pagado ?? 0),
    saldo: Number(r.saldo ?? 0),
    estado: (r.estado as EstadoCuenta["estado"]) ?? "pendiente",
    creado_en: String(r.creado_en ?? ""),
    actualizado_en: String(r.actualizado_en ?? ""),
  };
}

export async function listarEstadosCuenta(): Promise<EstadoCuenta[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_listar", { p_user_id: userId });
  lanzarSiHayError(error, "No se pudieron cargar los estados de cuenta");
  const arr = Array.isArray(data) ? data : [];
  return arr.map((r) => filaAEstadoCuenta(r as Record<string, unknown>));
}

export async function verEstadoCuenta(id: string): Promise<EstadoCuentaCompleto> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_ver", { p_user_id: userId, p_id: id });
  lanzarSiHayError(error, "No se pudo cargar el estado de cuenta");
  const d = data as {
    cabecera: Record<string, unknown>;
    items: Record<string, unknown>[];
    pagos: Record<string, unknown>[];
  } | null;
  if (!d?.cabecera) throw new Error("No se pudo cargar el estado de cuenta");
  return {
    cabecera: filaAEstadoCuenta(d.cabecera),
    items: (d.items ?? []).map((i) => ({
      id: String(i.id),
      estado_cuenta_id: String(i.estado_cuenta_id),
      orden: Number(i.orden ?? 0),
      tipo: (i.tipo as ECItem["tipo"]) ?? "item",
      titulo: String(i.titulo),
      descripcion: i.descripcion == null ? null : String(i.descripcion),
      clasificacion: (i.clasificacion as ECItem["clasificacion"]) ?? null,
      monto: Number(i.monto ?? 0),
      listo: Boolean(i.listo),
      creado_en: String(i.creado_en ?? ""),
    })),
    pagos: (d.pagos ?? []).map((p) => ({
      id: String(p.id),
      estado_cuenta_id: String(p.estado_cuenta_id),
      fecha: String(p.fecha),
      concepto: String(p.concepto),
      monto: Number(p.monto ?? 0),
      fin_movimiento_id: p.fin_movimiento_id == null ? null : String(p.fin_movimiento_id),
      creado_en: String(p.creado_en ?? ""),
    })),
  };
}

export async function crearEstadoCuenta(
  input: NuevoEstadoCuenta
): Promise<{ id: string; numero: string }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  let hogarId: string | null = null;
  try {
    const hogar = await obtenerMiHogar(supabase);
    hogarId = hogar?.id ?? null;
  } catch {
    hogarId = null;
  }
  const { data, error } = await supabase.rpc("rpc_ec_crear", {
    p_user_id: userId,
    p_cliente: input.cliente.trim(),
    p_proyecto: input.proyecto.trim() || null,
    p_condicion: input.condicion.trim() || "Tasa USDT",
    p_moneda: "USD",
    p_fecha_emision: input.fecha_emision || null,
    p_notas: input.notas.trim() || null,
    p_hogar_id: hogarId,
  });
  lanzarSiHayError(error, "No se pudo crear el estado de cuenta");
  const r = data as { ok: boolean; id: string; numero: string } | null;
  if (!r?.ok) throw new Error("No se pudo crear el estado de cuenta");
  return { id: r.id, numero: r.numero };
}

export async function actualizarEstadoCuenta(
  id: string,
  cambios: Partial<Pick<NuevoEstadoCuenta, "cliente" | "proyecto" | "condicion" | "fecha_emision" | "notas">>
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_actualizar", {
    p_user_id: userId,
    p_id: id,
    p_cliente: cambios.cliente?.trim() || null,
    p_proyecto: cambios.proyecto != null ? cambios.proyecto.trim() || null : null,
    p_condicion: cambios.condicion?.trim() || null,
    p_fecha_emision: cambios.fecha_emision || null,
    p_notas: cambios.notas != null ? cambios.notas.trim() || null : null,
  });
  lanzarSiHayError(error, "No se pudo actualizar el estado de cuenta");
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error("No se pudo actualizar el estado de cuenta");
}

export async function guardarItem(
  estadoId: string,
  item: ItemNuevo,
  id?: string
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_item_upsert", {
    p_user_id: userId,
    p_estado_id: estadoId,
    p_titulo: item.titulo.trim(),
    p_monto: item.monto,
    p_tipo: item.tipo,
    p_descripcion: item.descripcion.trim() || null,
    p_clasificacion: item.clasificacion,
    p_listo: item.listo,
    p_orden: null,
    p_id: id ?? null,
  });
  lanzarSiHayError(error, "No se pudo guardar el ítem");
  const r = data as { ok: boolean; id: string } | null;
  if (!r?.ok) throw new Error("No se pudo guardar el ítem");
  return r.id;
}

export async function borrarItem(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_ec_item_borrar", { p_user_id: userId, p_id: id });
  lanzarSiHayError(error, "No se pudo borrar el ítem");
}

export async function registrarPago(estadoId: string, pago: PagoNuevo): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_pago_registrar", {
    p_user_id: userId,
    p_estado_id: estadoId,
    p_monto: pago.monto,
    p_concepto: pago.concepto.trim(),
    p_fecha: pago.fecha || null,
  });
  lanzarSiHayError(error, "No se pudo registrar el pago");
  const r = data as { ok: boolean; id: string } | null;
  if (!r?.ok) throw new Error("No se pudo registrar el pago");
  return r.id;
}

export async function borrarPago(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_ec_pago_borrar", { p_user_id: userId, p_id: id });
  lanzarSiHayError(error, "No se pudo borrar el pago");
}

export async function borrarEstadoCuenta(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { error } = await supabase.rpc("rpc_ec_borrar", { p_user_id: userId, p_id: id });
  lanzarSiHayError(error, "No se pudo borrar el estado de cuenta");
}

/**
 * Lleva un pago a Finanzas en una sola operación atómica e idempotente
 * (RPC rpc_ec_pago_a_finanzas): registra el ingreso convertido a la moneda
 * de la cuenta y marca el pago. Reintentarlo no duplica el movimiento.
 */
export async function llevarPagoAFinanzas(
  pagoId: string,
  cuentaId: string
): Promise<{ finMovimientoId: string; duplicado: boolean }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sin conexión con la nube");
  const userId = await usuario();
  const { data, error } = await supabase.rpc("rpc_ec_pago_a_finanzas", {
    p_user_id: userId,
    p_pago_id: pagoId,
    p_cuenta_id: cuentaId,
  });
  lanzarSiHayError(error, "No se pudo llevar a Finanzas");
  const r = (data ?? {}) as { fin_movimiento_id?: string; duplicado?: boolean };
  if (!r.fin_movimiento_id) throw new Error("Respuesta inesperada del servidor");
  return { finMovimientoId: r.fin_movimiento_id, duplicado: !!r.duplicado };
}

/* ── Marca Synaptica: logo S recortado + firma, en caché ── */
const marcaCache: { logo?: string; firma?: string } = {};

async function dataUrlImagen(ruta: string): Promise<string | undefined> {
  try {
    const res = await fetch(ruta);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("FileReader"));
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Recorta la marca S (72% superior) del logo oficial. */
async function marcaSRecortada(): Promise<string | undefined> {
  if (marcaCache.logo) return marcaCache.logo;
  const full = await dataUrlImagen("/synaptica/logo.png");
  if (!full) return undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img"));
      img.src = full;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = Math.floor(img.naturalHeight * 0.72);
    const ctx = c.getContext("2d");
    if (!ctx) return full;
    ctx.drawImage(img, 0, 0, c.width, c.height, 0, 0, c.width, c.height);
    marcaCache.logo = c.toDataURL("image/png");
    return marcaCache.logo;
  } catch {
    return full;
  }
}

/** Genera y descarga el PDF del estado de cuenta con la plantilla Synaptica. */
export async function descargarPdfEC(full: EstadoCuentaCompleto): Promise<void> {
  const [logo, firma] = await Promise.all([
    marcaSRecortada(),
    marcaCache.firma ?? dataUrlImagen("/synaptica/firma-luigi.png").then((u) => {
      marcaCache.firma = u;
      return u;
    }),
  ]);
  const doc = buildEstadoCuentaPdf(full, { logoDataUrl: logo, firmaDataUrl: firma });
  doc.save(nombreArchivoEC(full.cabecera));
}
