"use client";

/**
 * Estados de cuenta Synaptica — pestaña de Finanzas.
 * Lista, crea y edita estados de cuenta con la plantilla del PDF N° 2026-095.
 * Los abonos solo tocan Finanzas cuando luigi lo pide explícito (botón por pago).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "../core/ui/Select";
import {
  IconAlerta,
  IconCheck,
  IconEditar,
  IconFlechaAtras,
  IconPlus,
  IconX,
} from "../../lib/core/ui/icons";
import {
  listarEstadosCuenta,
  verEstadoCuenta,
  crearEstadoCuenta,
  actualizarEstadoCuenta,
  guardarItem,
  borrarItem,
  registrarPago,
  borrarPago,
  borrarEstadoCuenta,
  marcarPagoEnFinanzas,
  descargarPdfEC,
} from "../../lib/estados-cuenta/cliente";
import {
  calcularTotales,
  formatoUSD,
  formatoFechaCorta,
} from "../../lib/estados-cuenta/calculos";
import {
  EC_CLASIFICACION_LABELS,
  EC_ESTADO_LABELS,
  type EstadoCuenta,
  type EstadoCuentaCompleto,
  type ECClasificacion,
  type ECItem,
  type ECEstado,
  type ItemNuevo,
} from "../../lib/estados-cuenta/tipos";
import {
  listarCuentasConSaldos,
  registrarMovimiento,
  hoyCaracas,
} from "../../lib/finanzas/finanzas";
import type { FinCuentaConSaldo } from "../../lib/finanzas/types";

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const tituloCls = "text-xs font-bold text-muted";

const ESTADO_COLOR: Record<ECEstado, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  parcial: "bg-sky-100 text-sky-800",
  pagado: "bg-emerald-100 text-emerald-800",
};

function parseMonto(raw: string): number {
  const t = raw.trim().replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

type Vista =
  | { kind: "lista" }
  | { kind: "nuevo" }
  | { kind: "detalle"; id: string };

export function EstadosTab() {
  const [vista, setVista] = useState<Vista>({ kind: "lista" });
  const [lista, setLista] = useState<EstadoCuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    setCargando(true);
    try {
      setLista(await listarEstadosCuenta());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los estados de cuenta");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const rows = await listarEstadosCuenta();
        if (vivo) setLista(rows);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los estados de cuenta");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <section aria-labelledby="ec-titulo" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 id="ec-titulo" className="text-base font-bold text-foreground">
          Estados de cuenta
        </h2>
        {vista.kind === "lista" && (
          <button
            type="button"
            onClick={() => setVista({ kind: "nuevo" })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
          >
            <IconPlus className="h-4 w-4" aria-hidden="true" /> Nuevo
          </button>
        )}
      </div>

      {error && (
        <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {vista.kind === "lista" ? (
        cargando ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted">
            Aún no hay estados de cuenta. Crea el primero para generarlo en PDF con la plantilla Synaptica.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((ec) => (
              <li key={ec.id}>
                <button
                  type="button"
                  onClick={() => setVista({ kind: "detalle", id: ec.id })}
                  className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">
                      N° {ec.numero} · {ec.cliente}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {ec.proyecto ? `${ec.proyecto} · ` : ""}
                      {formatoFechaCorta(ec.fecha_emision)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_COLOR[ec.estado]}`}>
                      {EC_ESTADO_LABELS[ec.estado]}
                    </span>
                    <span className="text-xs font-bold text-foreground">{formatoUSD(ec.saldo)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : vista.kind === "nuevo" ? (
        <FormNuevoEstado
          onCancelar={() => setVista({ kind: "lista" })}
          onCreado={(id) => {
            setVista({ kind: "detalle", id });
            recargar();
          }}
          onError={setError}
        />
      ) : (
        <DetalleEstado
          id={vista.id}
          onVolver={() => {
            setVista({ kind: "lista" });
            recargar();
          }}
          onError={setError}
        />
      )}
    </section>
  );
}

/* ── Nuevo estado de cuenta ── */
function FormNuevoEstado({
  onCancelar,
  onCreado,
  onError,
}: {
  onCancelar: () => void;
  onCreado: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [cliente, setCliente] = useState("");
  const [proyecto, setProyecto] = useState("");
  const [condicion, setCondicion] = useState("Tasa USDT");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    if (!cliente.trim()) {
      onError("El cliente es obligatorio");
      return;
    }
    setGuardando(true);
    onError(null);
    try {
      const r = await crearEstadoCuenta({
        cliente,
        proyecto,
        condicion,
        fecha_emision: fecha,
        notas,
      });
      onCreado(r.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <label className="block">
        <span className={tituloCls}>Cliente *</span>
        <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Construacero C.A." className={inputCls} />
      </label>
      <label className="block">
        <span className={tituloCls}>Proyecto</span>
        <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} placeholder="Nómina, Finanzas & Logística" className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={tituloCls}>Condición pactada</span>
          <input value={condicion} onChange={(e) => setCondicion(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={tituloCls}>Fecha de emisión</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className={tituloCls}>Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} className="rounded-xl bg-surface px-4 py-2 text-xs font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={crear}
          disabled={guardando}
          className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Creando…" : "Crear"}
        </button>
      </div>
    </div>
  );
}

/* ── Detalle / editor del estado de cuenta ── */
function DetalleEstado({
  id,
  onVolver,
  onError,
}: {
  id: string;
  onVolver: () => void;
  onError: (msg: string | null) => void;
}) {
  const [full, setFull] = useState<EstadoCuentaCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [editandoCabecera, setEditandoCabecera] = useState(false);
  const [confirmBorrado, setConfirmBorrado] = useState(false);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    onError(null);
    try {
      setFull(await verEstadoCuenta(id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
  }, [id, onError]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const data = await verEstadoCuenta(id);
        if (vivo) setFull(data);
      } catch (e) {
        if (vivo) onError(e instanceof Error ? e.message : "No se pudo cargar");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totales = useMemo(
    () => (full ? calcularTotales(full.items, full.pagos) : null),
    [full]
  );

  const descargar = async () => {
    if (!full) return;
    setDescargando(true);
    onError(null);
    try {
      await descargarPdfEC(full);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo generar el PDF");
    } finally {
      setDescargando(false);
    }
  };

  const borrar = async () => {
    if (!confirmBorrado) {
      setConfirmBorrado(true);
      return;
    }
    try {
      await borrarEstadoCuenta(id);
      onVolver();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo borrar");
    }
  };

  if (cargando) return <p className="text-sm text-muted">Cargando…</p>;
  if (!full || !totales) return <p className="text-sm text-muted">No se encontró el estado de cuenta.</p>;

  const ec = full.cabecera;
  const modulos = full.items.filter((i) => i.tipo === "modulo");
  const mods = full.items.filter((i) => i.tipo === "item");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onVolver}
          className="inline-flex items-center gap-1 rounded-xl bg-surface px-3 py-2 text-xs font-bold text-muted"
        >
          <IconFlechaAtras className="h-4 w-4" aria-hidden="true" /> Volver
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            N° {ec.numero} · {ec.cliente}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_COLOR[ec.estado]}`}>
          {EC_ESTADO_LABELS[ec.estado]}
        </span>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-surface px-3 py-2.5">
          <p className={tituloCls}>Servicios</p>
          <p className="text-sm font-bold text-foreground">{formatoUSD(totales.totalServicios)}</p>
        </div>
        <div className="rounded-2xl bg-surface px-3 py-2.5">
          <p className={tituloCls}>Pagado</p>
          <p className="text-sm font-bold text-foreground">{formatoUSD(totales.totalPagado)}</p>
        </div>
        <div className="rounded-2xl bg-surface px-3 py-2.5">
          <p className={tituloCls}>Saldo</p>
          <p className="text-sm font-bold text-accent">{formatoUSD(totales.saldoPendiente)}</p>
        </div>
      </div>

      {/* Cabecera */}
      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Datos</h3>
          <button
            type="button"
            onClick={() => setEditandoCabecera((v) => !v)}
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-bold text-muted"
          >
            <IconEditar className="h-3.5 w-3.5" aria-hidden="true" /> Editar
          </button>
        </div>
        {editandoCabecera ? (
          <FormCabecera
            ec={ec}
            onListo={() => {
              setEditandoCabecera(false);
              cargar();
            }}
            onError={onError}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className={tituloCls}>Cliente</dt>
              <dd className="text-foreground">{ec.cliente}</dd>
            </div>
            <div>
              <dt className={tituloCls}>Proyecto</dt>
              <dd className="text-foreground">{ec.proyecto || "—"}</dd>
            </div>
            <div>
              <dt className={tituloCls}>Condición</dt>
              <dd className="text-foreground">{ec.condicion}</dd>
            </div>
            <div>
              <dt className={tituloCls}>Emisión</dt>
              <dd className="text-foreground">{formatoFechaCorta(ec.fecha_emision)}</dd>
            </div>
          </dl>
        )}
      </div>

      <SeccionItems
        titulo="Módulos base"
        tipo="modulo"
        items={modulos}
        estadoId={id}
        onCambio={cargar}
        onError={onError}
      />
      <SeccionItems
        titulo="Modificaciones y nuevas implementaciones"
        tipo="item"
        items={mods}
        estadoId={id}
        onCambio={cargar}
        onError={onError}
      />
      <SeccionPagos
        pagos={full.pagos}
        estadoId={id}
        numero={ec.numero}
        cliente={ec.cliente}
        onCambio={cargar}
        onError={onError}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={descargar}
          disabled={descargando}
          className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {descargando ? "Generando…" : "Descargar PDF"}
        </button>
        <button
          type="button"
          onClick={borrar}
          className={`rounded-xl px-4 py-2 text-xs font-bold ${
            confirmBorrado ? "bg-red-600 text-white" : "bg-surface text-red-600"
          }`}
        >
          {confirmBorrado ? "Confirmar borrado" : "Borrar"}
        </button>
        {confirmBorrado && (
          <button
            type="button"
            onClick={() => setConfirmBorrado(false)}
            className="rounded-xl bg-surface px-4 py-2 text-xs font-bold text-muted"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Editar cabecera ── */
function FormCabecera({
  ec,
  onListo,
  onError,
}: {
  ec: EstadoCuentaCompleto["cabecera"];
  onListo: () => void;
  onError: (msg: string | null) => void;
}) {
  const [cliente, setCliente] = useState(ec.cliente);
  const [proyecto, setProyecto] = useState(ec.proyecto ?? "");
  const [condicion, setCondicion] = useState(ec.condicion);
  const [fecha, setFecha] = useState(ec.fecha_emision);
  const [notas, setNotas] = useState(ec.notas ?? "");
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    onError(null);
    try {
      await actualizarEstadoCuenta(ec.id, { cliente, proyecto, condicion, fecha_emision: fecha, notas });
      onListo();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className={tituloCls}>Cliente</span>
        <input value={cliente} onChange={(e) => setCliente(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={tituloCls}>Proyecto</span>
        <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={tituloCls}>Condición</span>
          <input value={condicion} onChange={(e) => setCondicion(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={tituloCls}>Fecha de emisión</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className={tituloCls}>Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </label>
      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="self-start rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

/* ── Sección de ítems (módulos o modificaciones) ── */
function SeccionItems({
  titulo,
  tipo,
  items,
  estadoId,
  onCambio,
  onError,
}: {
  titulo: string;
  tipo: "modulo" | "item";
  items: ECItem[];
  estadoId: string;
  onCambio: () => void;
  onError: (msg: string | null) => void;
}) {
  const [agregando, setAgregando] = useState(false);
  const [editando, setEditando] = useState<ECItem | null>(null);
  const [confirmBorrado, setConfirmBorrado] = useState<string | null>(null);

  const borrar = async (itemId: string) => {
    if (confirmBorrado !== itemId) {
      setConfirmBorrado(itemId);
      return;
    }
    try {
      await borrarItem(itemId);
      setConfirmBorrado(null);
      onCambio();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo borrar");
    }
  };

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">
          {titulo} <span className="font-normal text-muted">({items.length})</span>
        </h3>
        <button
          type="button"
          onClick={() => {
            setEditando(null);
            setAgregando((v) => !v);
          }}
          className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-bold text-accent"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Agregar
        </button>
      </div>

      {items.length === 0 && !agregando && (
        <p className="text-xs text-muted">Sin ítems todavía.</p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((it, idx) => (
          <li key={it.id} className="rounded-xl bg-background px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs font-bold text-muted">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{it.titulo}</p>
                {it.descripcion && <p className="text-xs text-muted">{it.descripcion}</p>}
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                  {it.clasificacion && (
                    <span className="rounded-full bg-surface px-2 py-0.5 font-bold text-muted">
                      {EC_CLASIFICACION_LABELS[it.clasificacion]}
                    </span>
                  )}
                  {it.listo ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                      <IconCheck className="h-3 w-3" aria-hidden="true" /> Listo
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                      Pendiente
                    </span>
                  )}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold text-foreground">{formatoUSD(it.monto)}</span>
            </div>
            <div className="mt-1 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setAgregando(false);
                  setEditando(it);
                }}
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-muted"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => borrar(it.id)}
                className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                  confirmBorrado === it.id ? "bg-red-600 text-white" : "text-red-600"
                }`}
              >
                {confirmBorrado === it.id ? "Confirmar" : "Borrar"}
              </button>
            </div>
            {editando?.id === it.id && (
              <FormItem
                tipo={tipo}
                inicial={it}
                estadoId={estadoId}
                onListo={() => {
                  setEditando(null);
                  onCambio();
                }}
                onCancelar={() => setEditando(null)}
                onError={onError}
              />
            )}
          </li>
        ))}
      </ul>

      {agregando && (
        <div className="mt-2">
          <FormItem
            tipo={tipo}
            estadoId={estadoId}
            onListo={() => {
              setAgregando(false);
              onCambio();
            }}
            onCancelar={() => setAgregando(false)}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}

function FormItem({
  tipo,
  inicial,
  estadoId,
  onListo,
  onCancelar,
  onError,
}: {
  tipo: "modulo" | "item";
  inicial?: ECItem;
  estadoId: string;
  onListo: () => void;
  onCancelar: () => void;
  onError: (msg: string | null) => void;
}) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [clasificacion, setClasificacion] = useState<ECClasificacion | "">(
    inicial?.clasificacion ?? (tipo === "item" ? "nueva" : "")
  );
  const [montoRaw, setMontoRaw] = useState(
    inicial ? String(inicial.monto).replace(".", ",") : ""
  );
  const [listo, setListo] = useState(inicial?.listo ?? true);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const monto = parseMonto(montoRaw);
    if (!titulo.trim()) {
      onError("El título es obligatorio");
      return;
    }
    if (!(monto >= 0)) {
      onError("Monto inválido");
      return;
    }
    setGuardando(true);
    onError(null);
    try {
      const item: ItemNuevo = {
        tipo,
        titulo,
        descripcion,
        clasificacion: tipo === "item" ? (clasificacion as ECClasificacion) : null,
        monto,
        listo,
      };
      await guardarItem(estadoId, item, inicial?.id);
      onListo();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <label className="block">
        <span className={tituloCls}>Título *</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={tituloCls}>Descripción</span>
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {tipo === "item" && (
          <label className="block">
            <span className={tituloCls}>Clasificación</span>
            <Select
              value={clasificacion}
              ariaLabel="Clasificación"
              onChange={(v) => setClasificacion(v as ECClasificacion)}
              options={[
                { value: "nueva", label: "Nueva implementación" },
                { value: "modificacion", label: "Modificación" },
              ]}
            />
          </label>
        )}
        <label className="block">
          <span className={tituloCls}>Monto USD *</span>
          <input
            value={montoRaw}
            onChange={(e) => setMontoRaw(e.target.value)}
            placeholder="15,00"
            inputMode="decimal"
            className={inputCls}
          />
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-bold text-muted">
        <input type="checkbox" checked={listo} onChange={(e) => setListo(e.target.checked)} className="h-4 w-4 rounded" />
        Listo / entregado
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} className="rounded-xl bg-surface px-3 py-2 text-xs font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : inicial ? "Guardar" : "Agregar"}
        </button>
      </div>
    </div>
  );
}

/* ── Sección de pagos/abonos ── */
function SeccionPagos({
  pagos,
  estadoId,
  numero,
  cliente,
  onCambio,
  onError,
}: {
  pagos: EstadoCuentaCompleto["pagos"];
  estadoId: string;
  numero: string;
  cliente: string;
  onCambio: () => void;
  onError: (msg: string | null) => void;
}) {
  const [agregando, setAgregando] = useState(false);
  const [fecha, setFecha] = useState(hoyCaracas());
  const [concepto, setConcepto] = useState("");
  const [montoRaw, setMontoRaw] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [confirmBorrado, setConfirmBorrado] = useState<string | null>(null);
  const [llevando, setLlevando] = useState<string | null>(null);
  const [cuentas, setCuentas] = useState<FinCuentaConSaldo[]>([]);
  const [cuentaId, setCuentaId] = useState("");

  const agregar = async () => {
    const monto = parseMonto(montoRaw);
    if (!concepto.trim()) {
      onError("El concepto es obligatorio");
      return;
    }
    if (!(monto > 0)) {
      onError("Monto inválido");
      return;
    }
    setGuardando(true);
    onError(null);
    try {
      await registrarPago(estadoId, { fecha, concepto, monto });
      setConcepto("");
      setMontoRaw("");
      setAgregando(false);
      onCambio();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo registrar");
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (pagoId: string) => {
    if (confirmBorrado !== pagoId) {
      setConfirmBorrado(pagoId);
      return;
    }
    try {
      await borrarPago(pagoId);
      setConfirmBorrado(null);
      onCambio();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo borrar");
    }
  };

  /** Abre el selector de cuenta para llevar el abono a Finanzas (a pedido). */
  const iniciarLlevar = async (pagoId: string) => {
    setLlevando(pagoId);
    onError(null);
    try {
      const cs = await listarCuentasConSaldos();
      setCuentas(cs);
      // USDT siempre es Binance (regla permanente); si no existe, primera cuenta.
      const binance = cs.find((c) => c.nombre.toLowerCase() === "binance");
      setCuentaId(binance?.id ?? cs[0]?.id ?? "");
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas");
      setLlevando(null);
    }
  };

  const confirmarLlevar = async (pago: EstadoCuentaCompleto["pagos"][number]) => {
    if (!cuentaId) {
      onError("Elige la cuenta");
      return;
    }
    setGuardando(true);
    onError(null);
    try {
      const movId = await registrarMovimiento({
        tipo: "ingreso",
        cuentaId,
        monto: pago.monto,
        categoria: "deuda",
        fecha: pago.fecha,
        nota: `Abono estado de cuenta ${numero} · ${cliente}`,
      });
      await marcarPagoEnFinanzas(pago.id, movId);
      setLlevando(null);
      onCambio();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo llevar a Finanzas");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">
          Pagos recibidos <span className="font-normal text-muted">({pagos.length})</span>
        </h3>
        <button
          type="button"
          onClick={() => setAgregando((v) => !v)}
          className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-bold text-accent"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Registrar
        </button>
      </div>

      {agregando && (
        <div className="mb-2 flex flex-col gap-2 rounded-xl border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={tituloCls}>Fecha</span>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={tituloCls}>Monto USD *</span>
              <input value={montoRaw} onChange={(e) => setMontoRaw(e.target.value)} placeholder="100,00" inputMode="decimal" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={tituloCls}>Concepto *</span>
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Abono a mejoras" className={inputCls} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAgregando(false)} className="rounded-xl bg-surface px-3 py-2 text-xs font-bold text-muted">
              Cancelar
            </button>
            <button
              type="button"
              onClick={agregar}
              disabled={guardando}
              className="rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {pagos.length === 0 && !agregando && (
        <p className="text-xs text-muted">Sin pagos registrados.</p>
      )}

      <ul className="flex flex-col gap-2">
        {pagos.map((p) => (
          <li key={p.id} className="rounded-xl bg-background px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{p.concepto}</p>
                <p className="text-xs text-muted">{formatoFechaCorta(p.fecha)}</p>
              </div>
              <span className="shrink-0 text-sm font-bold text-foreground">{formatoUSD(p.monto)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
              {p.fin_movimiento_id ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                  <IconCheck className="h-3 w-3" aria-hidden="true" /> En Finanzas
                </span>
              ) : llevando === p.id ? (
                <>
                  <Select
                    value={cuentaId}
                    ariaLabel="Cuenta de Finanzas"
                    onChange={setCuentaId}
                    options={cuentas.map((c) => ({
                      value: c.id,
                      label: `${c.nombre} (${c.moneda})`,
                    }))}
                    className="min-w-32"
                  />
                  <button
                    type="button"
                    onClick={() => confirmarLlevar(p)}
                    disabled={guardando}
                    className="rounded-lg bg-accent px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setLlevando(null)}
                    className="rounded-lg px-2 py-1 text-[11px] font-bold text-muted"
                  >
                    <IconX className="h-3 w-3" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => iniciarLlevar(p.id)}
                  className="rounded-lg px-2 py-1 text-[11px] font-bold text-accent"
                >
                  Llevar a Finanzas
                </button>
              )}
              <button
                type="button"
                onClick={() => borrar(p.id)}
                className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                  confirmBorrado === p.id ? "bg-red-600 text-white" : "text-red-600"
                }`}
              >
                {confirmBorrado === p.id ? "Confirmar" : "Borrar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
