"use client";

/**
 * Control (Fase 3): recordatorios de pago, presupuestos, deudas,
 * metas de ahorro y cierre de mes. Tono serio, sin XP ni logros.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "../../components/core/ui/Select";
import {
  IconPlus,
  IconX,
  IconAlerta,
  IconCheck,
  IconEditar,
  IconBorrar,
  IconCampana,
  IconObjetivo,
  IconReloj,
  IconMaletin,
  IconFlechaAtras,
  IconEstadisticas,
} from "../../lib/core/ui/icons";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import {
  listarRecordatorios,
  guardarRecordatorio,
  alternarRecordatorio,
  eliminarRecordatorio,
  pagarRecordatorio,
  listarPresupuestos,
  guardarPresupuesto,
  eliminarPresupuesto,
  copiarPresupuestos,
  listarDeudas,
  guardarDeuda,
  abonarDeuda,
  eliminarDeuda,
  listarMetas,
  guardarMeta,
  aportarAMeta,
  eliminarMeta,
  cierreDeMes,
  mesActualCaracas,
  etiquetaMes,
  type ControlRecordatorio,
  type ControlPresupuesto,
  type ControlDeuda,
  type ControlMeta,
  type ControlCierre,
  type FinRecordatorioTipo,
  type FinDeudaTipo,
  type NuevoRecordatorio,
  type NuevaDeuda,
} from "../../lib/finanzas/control";
import {
  listarCuentasConSaldos,
  formatearMonto,
} from "../../lib/finanzas/finanzas";
import {
  MONEDAS,
  CATEGORIAS_EGRESO,
  type FinCuentaConSaldo,
  type FinMoneda,
} from "../../lib/finanzas/types";

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const labelCls = "block";
const tituloCls = "text-xs font-bold text-muted";

type Tab = "recordatorios" | "presupuestos" | "deudas" | "metas" | "cierre";

const TABS: { valor: Tab; etiqueta: string }[] = [
  { valor: "recordatorios", etiqueta: "Pagos" },
  { valor: "presupuestos", etiqueta: "Presupuestos" },
  { valor: "deudas", etiqueta: "Deudas" },
  { valor: "metas", etiqueta: "Metas" },
  { valor: "cierre", etiqueta: "Cierre" },
];

const ESTADO_REC: Record<string, { texto: string; cls: string }> = {
  vencido: { texto: "Vencido", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  por_vencer: { texto: "Por vencer", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  pendiente: { texto: "Al día", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
};

function Barra({ pct, tono }: { pct: number; tono: "verde" | "ambar" | "rojo" | "acento" }) {
  const cls =
    tono === "verde"
      ? "bg-green-500"
      : tono === "ambar"
        ? "bg-amber-500"
        : tono === "rojo"
          ? "bg-red-500"
          : "bg-accent";
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={Math.min(100, pct)}>
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="switch-track shrink-0"
      data-checked={checked ? "true" : "false"}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/** Modal propio (regla UI: nada de alert/confirm del navegador). */
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-full p-1.5 text-muted hover:text-foreground"
          >
            <IconX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorLinea({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-accent" role="alert">
      <IconAlerta className="h-3.5 w-3.5" aria-hidden="true" />
      {mensaje}
    </p>
  );
}

// ── Formulario recordatorio ───────────────────────────────────────────────────

function FormRecordatorio({
  cuentas,
  inicial,
  onGuardar,
  onCerrar,
}: {
  cuentas: FinCuentaConSaldo[];
  inicial: ControlRecordatorio | null;
  onGuardar: (input: NuevoRecordatorio, id?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [tipo, setTipo] = useState<FinRecordatorioTipo>(inicial?.tipo ?? "egreso");
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : "");
  const [moneda, setMoneda] = useState<FinMoneda>(inicial?.moneda ?? "USD");
  const [diaMes, setDiaMes] = useState(inicial ? String(inicial.diaMes) : "");
  const [cuentaId, setCuentaId] = useState(inicial?.cuentaId ?? "");
  const [categoria, setCategoria] = useState(inicial?.categoria ?? "");
  const [diasAviso, setDiasAviso] = useState(inicial ? String(inicial.diasAviso) : "3");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    const m = Number(monto.replace(",", "."));
    const d = Number(diaMes);
    if (!nombre.trim()) return setError("Falta el nombre");
    if (!(m > 0)) return setError("El monto debe ser mayor a 0");
    if (!(d >= 1 && d <= 31)) return setError("El día debe estar entre 1 y 31");
    setGuardando(true);
    try {
      await onGuardar(
        {
          nombre,
          tipo,
          monto: m,
          moneda,
          diaMes: d,
          cuentaId: cuentaId || null,
          categoria: categoria || null,
          diasAviso: Number(diasAviso) || 0,
        },
        inicial?.id
      );
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={inicial ? "Editar recordatorio" : "Nuevo recordatorio"} onCerrar={onCerrar}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nombre</span>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Internet" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Tipo</span>
          <Select
            value={tipo}
            options={[{ value: "egreso", label: "Pago" }, { value: "ingreso", label: "Cobro" }]}
            onChange={(v) => setTipo(v as FinRecordatorioTipo)}
            ariaLabel="Tipo"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Día del mes</span>
          <input type="text" inputMode="numeric" value={diaMes} onChange={(e) => setDiaMes(e.target.value.replace(/\D/g, ""))} placeholder="27" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Monto</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select
            value={moneda}
            options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
            onChange={(v) => setMoneda(v as FinMoneda)}
            ariaLabel="Moneda"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cuenta</span>
          <Select
            value={cuentaId}
            options={[{ value: "", label: "Automática" }, ...cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }))]}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Categoría</span>
          <Select
            value={categoria}
            options={[{ value: "", label: "Sin categoría" }, ...CATEGORIAS_EGRESO.map((c) => ({ value: c, label: c }))]}
            onChange={setCategoria}
            ariaLabel="Categoría"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Avisar con días de anticipación</span>
          <input type="text" inputMode="numeric" value={diasAviso} onChange={(e) => setDiasAviso(e.target.value.replace(/\D/g, ""))} className={inputCls} />
        </label>
      </div>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

// ── Modal pagar recordatorio ─────────────────────────────────────────────────

function ModalPagar({
  rec,
  cuentas,
  onPagar,
  onCerrar,
}: {
  rec: ControlRecordatorio;
  cuentas: FinCuentaConSaldo[];
  onPagar: (rec: ControlRecordatorio, cuentaId: string, monto?: number, nota?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [cuentaId, setCuentaId] = useState(rec.cuentaId ?? cuentas[0]?.id ?? "");
  const [monto, setMonto] = useState(String(rec.monto));
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pagando, setPagando] = useState(false);

  const pagar = async () => {
    setError(null);
    if (!cuentaId) return setError("Elige la cuenta");
    const m = Number(monto.replace(",", "."));
    if (!(m > 0)) return setError("El monto debe ser mayor a 0");
    setPagando(true);
    try {
      await onPagar(rec, cuentaId, m, nota || undefined);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago");
    } finally {
      setPagando(false);
    }
  };

  return (
    <Modal titulo={`Marcar como ${rec.tipo === "ingreso" ? "cobrado" : "pagado"}`} onCerrar={onCerrar}>
      <p className="text-sm text-foreground">
        <strong>{rec.nombre}</strong> · vence el {rec.proximo}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Monto ({rec.moneda})</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cuenta</span>
          <Select
            value={cuentaId}
            options={cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }))}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nota (opcional)</span>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={rec.nombre} className={inputCls} />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">
        Se crea el {rec.tipo === "ingreso" ? "ingreso" : "egreso"} en la cuenta elegida
        (convirtiendo la moneda) y el recordatorio se reprograma al próximo mes.
      </p>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={pagar}
          disabled={pagando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pagando ? "Registrando…" : rec.tipo === "ingreso" ? "Registrar cobro" : "Registrar pago"}
        </button>
      </div>
    </Modal>
  );
}

// ── Sección recordatorios ────────────────────────────────────────────────────

function SeccionRecordatorios({
  recs,
  cuentas,
  onCambiar,
}: {
  recs: ControlRecordatorio[];
  cuentas: FinCuentaConSaldo[];
  onCambiar: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<ControlRecordatorio | null>(null);
  const [pagando, setPagando] = useState<ControlRecordatorio | null>(null);
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activos = recs.filter((r) => r.activo);
  const pausados = recs.filter((r) => !r.activo);

  return (
    <section aria-label="Recordatorios de pago">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Recordatorios</h2>
        <button
          type="button"
          onClick={() => { setEditando(null); setMostrarForm(true); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-bold text-white"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nuevo
        </button>
      </div>
      <ErrorLinea mensaje={error} />
      {recs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
          <IconCampana className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">Sin recordatorios. Crea el primero: alquiler, internet, sueldo…</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {[...activos, ...pausados].map((r) => {
            const est = ESTADO_REC[r.estado];
            return (
              <li key={r.id} className={`rounded-2xl border border-border bg-surface p-4 ${r.activo ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{r.nombre}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {r.tipo === "ingreso" ? "Cobro" : "Pago"} · día {r.diaMes} · vence {r.proximo}
                      {r.cuenta ? ` · ${r.cuenta}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-foreground">{formatearMonto(r.monto, r.moneda)}</p>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${est.cls}`}>{est.texto}</span>
                  {r.activo && (
                    <button
                      type="button"
                      onClick={() => setPagando(r)}
                      className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-white"
                    >
                      <IconCheck className="h-3 w-3" aria-hidden="true" />
                      {r.tipo === "ingreso" ? "Cobrado" : "Pagado"}
                    </button>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1">
                    {confirmandoBorrar === r.id ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            setError(null);
                            try {
                              await eliminarRecordatorio(r.id);
                              setConfirmandoBorrar(null);
                              onCambiar();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "No se pudo eliminar");
                            }
                          }}
                          className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
                        >
                          Eliminar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmandoBorrar(null)}
                          aria-label="Cancelar"
                          className="rounded-full border border-border px-2 py-1 text-[11px] font-bold text-muted"
                        >
                          <IconX className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { setEditando(r); setMostrarForm(true); }}
                          aria-label={`Editar ${r.nombre}`}
                          className="rounded-full p-1.5 text-muted hover:text-foreground"
                        >
                          <IconEditar className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmandoBorrar(r.id)}
                          aria-label={`Eliminar ${r.nombre}`}
                          className="rounded-full p-1.5 text-muted hover:text-accent"
                        >
                          <IconBorrar className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </span>
                  <Switch
                    checked={r.activo}
                    onChange={async (v) => {
                      setError(null);
                      try {
                        await alternarRecordatorio(r.id, v);
                        onCambiar();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "No se pudo cambiar");
                      }
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {mostrarForm && (
        <FormRecordatorio
          cuentas={cuentas}
          inicial={editando}
          onGuardar={async (input, id) => { await guardarRecordatorio(input, id); onCambiar(); }}
          onCerrar={() => { setMostrarForm(false); setEditando(null); }}
        />
      )}
      {pagando && (
        <ModalPagar
          rec={pagando}
          cuentas={cuentas}
          onPagar={async (rec, cuentaId, monto, nota) => { await pagarRecordatorio(rec, cuentaId, monto, nota); onCambiar(); }}
          onCerrar={() => setPagando(null)}
        />
      )}
    </section>
  );
}

// ── Sección presupuestos ─────────────────────────────────────────────────────

function FormPresupuesto({
  mes,
  onGuardar,
  onCerrar,
}: {
  mes: string;
  onGuardar: (categoria: string, limite: number, moneda: FinMoneda) => Promise<void>;
  onCerrar: () => void;
}) {
  const [categoria, setCategoria] = useState("");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [limite, setLimite] = useState("");
  const [moneda, setMoneda] = useState<FinMoneda>("USD");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    const cat = categoria === "__nueva" ? nuevaCategoria.trim().toLowerCase() : categoria;
    const l = Number(limite.replace(",", "."));
    if (!cat) return setError("Elige o escribe una categoría");
    if (!(l > 0)) return setError("El límite debe ser mayor a 0");
    setGuardando(true);
    try {
      await onGuardar(cat, l, moneda);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={`Presupuesto · ${etiquetaMes(mes)}`} onCerrar={onCerrar}>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Categoría</span>
          <Select
            value={categoria}
            options={[
              { value: "", label: "Elige…" },
              ...CATEGORIAS_EGRESO.map((c) => ({ value: c, label: c })),
              { value: "__nueva", label: "Otra…" },
            ]}
            onChange={setCategoria}
            ariaLabel="Categoría"
            className="mt-1"
          />
        </label>
        {categoria === "__nueva" && (
          <label className={labelCls}>
            <span className={tituloCls}>Nueva categoría</span>
            <input type="text" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} className={inputCls} />
          </label>
        )}
        <label className={labelCls}>
          <span className={tituloCls}>Límite mensual</span>
          <input type="text" inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select
            value={moneda}
            options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
            onChange={(v) => setMoneda(v as FinMoneda)}
            ariaLabel="Moneda"
            className="mt-1"
          />
        </label>
      </div>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

function SeccionPresupuestos({
  pres,
  mes,
  onCambiarMes,
  onCambiar,
}: {
  pres: ControlPresupuesto[];
  mes: string;
  onCambiarMes: (m: string) => void;
  onCambiar: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moverMes = (delta: number) => {
    const [y, m] = mes.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onCambiarMes(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <section aria-label="Presupuestos por categoría">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => moverMes(-1)} aria-label="Mes anterior" className="rounded-full p-1.5 text-muted hover:text-foreground">
            <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
          </button>
          <h2 className="text-sm font-bold text-foreground">{etiquetaMes(mes)}</h2>
          <button type="button" onClick={() => moverMes(1)} aria-label="Mes siguiente" className="rotate-180 rounded-full p-1.5 text-muted hover:text-foreground">
            <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                const [y, m] = mes.split("-").map(Number);
                const d = new Date(Date.UTC(y, m - 2, 1));
                const origen = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
                const n = await copiarPresupuestos(origen, mes);
                if (n === 0) setError("El mes anterior no tiene presupuestos");
                onCambiar();
              } catch (e) {
                setError(e instanceof Error ? e.message : "No se pudo copiar");
              }
            }}
            className="rounded-full border border-border px-3 py-1.5 text-[11px] font-bold text-muted"
          >
            Copiar del mes anterior
          </button>
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-bold text-white"
          >
            <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nuevo
          </button>
        </div>
      </div>
      <ErrorLinea mensaje={error} />
      {pres.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
          <IconEstadisticas className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">Sin presupuestos este mes. Ponle un tope a cada categoría.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pres.map((p) => {
            const tono = p.estado === "excedido" ? "rojo" : p.estado === "alerta" ? "ambar" : "verde";
            const estCls =
              p.estado === "excedido"
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                : p.estado === "alerta"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
            const estTxt = p.estado === "excedido" ? "Excedido" : p.estado === "alerta" ? "Al 80% o más" : "En curso";
            return (
              <li key={p.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold capitalize text-foreground">{p.categoria}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      ${p.gastadoUsd.toFixed(2)} de ${p.limiteUsd.toFixed(2)} · límite {formatearMonto(p.limite, p.moneda)}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${estCls}`}>{estTxt}</span>
                    {confirmandoBorrar === p.id ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            try { await eliminarPresupuesto(p.id); setConfirmandoBorrar(null); onCambiar(); }
                            catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
                          }}
                          className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
                        >
                          Eliminar
                        </button>
                        <button type="button" onClick={() => setConfirmandoBorrar(null)} aria-label="Cancelar" className="rounded-full border border-border px-2 py-1 text-muted">
                          <IconX className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmandoBorrar(p.id)} aria-label={`Eliminar presupuesto ${p.categoria}`} className="rounded-full p-1.5 text-muted hover:text-accent">
                        <IconBorrar className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
                <Barra pct={p.pct} tono={tono} />
              </li>
            );
          })}
        </ul>
      )}
      {mostrarForm && (
        <FormPresupuesto
          mes={mes}
          onGuardar={async (categoria, limite, moneda) => { await guardarPresupuesto(categoria, limite, moneda, mes); onCambiar(); }}
          onCerrar={() => setMostrarForm(false)}
        />
      )}
    </section>
  );
}

// ── Sección deudas ───────────────────────────────────────────────────────────

function FormDeuda({
  cuentas,
  inicial,
  onGuardar,
  onCerrar,
}: {
  cuentas: FinCuentaConSaldo[];
  inicial: ControlDeuda | null;
  onGuardar: (input: NuevaDeuda, id?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [tipo, setTipo] = useState<FinDeudaTipo>(inicial?.tipo ?? "por_pagar");
  const [contraparte, setContraparte] = useState(inicial?.contraparte ?? "");
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : "");
  const [moneda, setMoneda] = useState<FinMoneda>(inicial?.moneda ?? "USD");
  const [fechaLimite, setFechaLimite] = useState(inicial?.fechaLimite ?? "");
  const [cuentaId, setCuentaId] = useState(inicial?.cuentaId ?? "");
  const [nota, setNota] = useState(inicial?.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    const m = Number(monto.replace(",", "."));
    if (!contraparte.trim()) return setError("Falta con quién es la deuda");
    if (!(m > 0)) return setError("El monto debe ser mayor a 0");
    setGuardando(true);
    try {
      await onGuardar(
        { tipo, contraparte, monto: m, moneda, fechaLimite: fechaLimite || null, cuentaId: cuentaId || null, nota: nota || null },
        inicial?.id
      );
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={inicial ? "Editar deuda" : "Nueva deuda"} onCerrar={onCerrar}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Tipo</span>
          <Select
            value={tipo}
            options={[{ value: "por_pagar", label: "Debo (por pagar)" }, { value: "por_cobrar", label: "Me deben (por cobrar)" }]}
            onChange={(v) => setTipo(v as FinDeudaTipo)}
            ariaLabel="Tipo de deuda"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Contraparte</span>
          <input type="text" value={contraparte} onChange={(e) => setContraparte(e.target.value)} placeholder="Ej. Juan" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Monto</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select
            value={moneda}
            options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
            onChange={(v) => setMoneda(v as FinMoneda)}
            ariaLabel="Moneda"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Fecha límite (opcional)</span>
          <input type="date" value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cuenta (opcional)</span>
          <Select
            value={cuentaId}
            options={[{ value: "", label: "Elegir al abonar" }, ...cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }))]}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nota (opcional)</span>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />
        </label>
      </div>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

function ModalAbonar({
  deuda,
  cuentas,
  onAbonar,
  onCerrar,
}: {
  deuda: ControlDeuda;
  cuentas: FinCuentaConSaldo[];
  onAbonar: (deuda: ControlDeuda, monto: number, cuentaId: string, nota?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [cuentaId, setCuentaId] = useState(deuda.cuentaId ?? cuentas[0]?.id ?? "");
  const [monto, setMonto] = useState(String(deuda.pendiente));
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [abonando, setAbonando] = useState(false);

  const abonar = async () => {
    setError(null);
    if (!cuentaId) return setError("Elige la cuenta");
    const m = Number(monto.replace(",", "."));
    if (!(m > 0)) return setError("El abono debe ser mayor a 0");
    setAbonando(true);
    try {
      await onAbonar(deuda, m, cuentaId, nota || undefined);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abonar");
    } finally {
      setAbonando(false);
    }
  };

  return (
    <Modal titulo="Abonar a la deuda" onCerrar={onCerrar}>
      <p className="text-sm text-foreground">
        <strong>{deuda.contraparte}</strong> · pendiente {formatearMonto(deuda.pendiente, deuda.moneda)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Abono ({deuda.moneda})</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cuenta</span>
          <Select
            value={cuentaId}
            options={cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }))}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nota (opcional)</span>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">
        {deuda.tipo === "por_pagar"
          ? "Se registra un egreso en la cuenta elegida."
          : "Se registra un ingreso en la cuenta elegida."}
      </p>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={abonar}
          disabled={abonando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {abonando ? "Abonando…" : "Abonar"}
        </button>
      </div>
    </Modal>
  );
}

function SeccionDeudas({
  deudas,
  cuentas,
  onCambiar,
}: {
  deudas: ControlDeuda[];
  cuentas: FinCuentaConSaldo[];
  onCambiar: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<ControlDeuda | null>(null);
  const [abonando, setAbonando] = useState<ControlDeuda | null>(null);
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | FinDeudaTipo>("todas");
  const [error, setError] = useState<string | null>(null);

  const visibles = deudas.filter((d) => filtro === "todas" || d.tipo === filtro);
  const pendientes = visibles.filter((d) => d.estado === "pendiente");
  const saldadas = visibles.filter((d) => d.estado === "saldada");

  const tarjeta = (d: ControlDeuda) => (
    <li key={d.id} className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{d.contraparte}</p>
          <p className="mt-0.5 text-xs text-muted">
            {d.tipo === "por_pagar" ? "Debo" : "Me deben"}
            {d.fechaLimite ? ` · límite ${d.fechaLimite}` : ""}
            {d.nota ? ` · ${d.nota}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-bold text-foreground">
          {formatearMonto(d.pendiente, d.moneda)}
          <span className="block text-[11px] font-normal text-muted">de {formatearMonto(d.monto, d.moneda)}</span>
        </p>
      </div>
      {d.estado === "pendiente" && d.abonado > 0 && (
        <Barra pct={(d.abonado / d.monto) * 100} tono="acento" />
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {d.estado === "pendiente" ? (
          <button
            type="button"
            onClick={() => setAbonando(d)}
            className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-white"
          >
            Abonar
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
            <IconCheck className="h-3 w-3" aria-hidden="true" /> Saldada
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          {confirmandoBorrar === d.id ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  try { await eliminarDeuda(d.id); setConfirmandoBorrar(null); onCambiar(); }
                  catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
                }}
                className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
              >
                Eliminar
              </button>
              <button type="button" onClick={() => setConfirmandoBorrar(null)} aria-label="Cancelar" className="rounded-full border border-border px-2 py-1 text-muted">
                <IconX className="h-3 w-3" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { setEditando(d); setMostrarForm(true); }} aria-label={`Editar deuda con ${d.contraparte}`} className="rounded-full p-1.5 text-muted hover:text-foreground">
                <IconEditar className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setConfirmandoBorrar(d.id)} aria-label={`Eliminar deuda con ${d.contraparte}`} className="rounded-full p-1.5 text-muted hover:text-accent">
                <IconBorrar className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </span>
      </div>
    </li>
  );

  return (
    <section aria-label="Deudas por cobrar y pagar">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full border border-border p-1">
          {([["todas", "Todas"], ["por_pagar", "Debo"], ["por_cobrar", "Me deben"]] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFiltro(v)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${filtro === v ? "bg-accent text-white" : "text-muted"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setEditando(null); setMostrarForm(true); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-bold text-white"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nueva
        </button>
      </div>
      <ErrorLinea mensaje={error} />
      {visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
          <IconMaletin className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">Sin deudas aquí. Todo en orden.</p>
        </div>
      ) : (
        <>
          {pendientes.length > 0 && <ul className="space-y-2">{pendientes.map(tarjeta)}</ul>}
          {saldadas.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-bold text-muted">Saldadas</h3>
              <ul className="space-y-2 opacity-70">{saldadas.map(tarjeta)}</ul>
            </>
          )}
        </>
      )}
      {mostrarForm && (
        <FormDeuda
          cuentas={cuentas}
          inicial={editando}
          onGuardar={async (input, id) => { await guardarDeuda(input, id); onCambiar(); }}
          onCerrar={() => { setMostrarForm(false); setEditando(null); }}
        />
      )}
      {abonando && (
        <ModalAbonar
          deuda={abonando}
          cuentas={cuentas}
          onAbonar={async (d, m, c, n) => { await abonarDeuda(d, m, c, n); onCambiar(); }}
          onCerrar={() => setAbonando(null)}
        />
      )}
    </section>
  );
}

// ── Sección metas ────────────────────────────────────────────────────────────

function FormMeta({
  inicial,
  onGuardar,
  onCerrar,
}: {
  inicial: ControlMeta | null;
  onGuardar: (nombre: string, objetivo: number, moneda: FinMoneda, fecha?: string | null, id?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [objetivo, setObjetivo] = useState(inicial ? String(inicial.objetivo) : "");
  const [moneda, setMoneda] = useState<FinMoneda>(inicial?.moneda ?? "USD");
  const [fecha, setFecha] = useState(inicial?.fechaObjetivo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    const o = Number(objetivo.replace(",", "."));
    if (!nombre.trim()) return setError("Falta el nombre de la meta");
    if (!(o > 0)) return setError("El objetivo debe ser mayor a 0");
    setGuardando(true);
    try {
      await onGuardar(nombre, o, moneda, fecha || null, inicial?.id);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={inicial ? "Editar meta" : "Nueva meta de ahorro"} onCerrar={onCerrar}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nombre</span>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Fondo de emergencia" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Objetivo</span>
          <input type="text" inputMode="decimal" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select
            value={moneda}
            options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
            onChange={(v) => setMoneda(v as FinMoneda)}
            ariaLabel="Moneda"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Fecha objetivo (opcional)</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </label>
      </div>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

function ModalAportar({
  meta,
  cuentas,
  onAportar,
  onCerrar,
}: {
  meta: ControlMeta;
  cuentas: FinCuentaConSaldo[];
  onAportar: (meta: ControlMeta, monto: number, cuentaId: string | null, nota?: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aportando, setAportando] = useState(false);

  const aportar = async () => {
    setError(null);
    const m = Number(monto.replace(",", "."));
    if (!(m > 0)) return setError("El aporte debe ser mayor a 0");
    setAportando(true);
    try {
      await onAportar(meta, m, cuentaId || null, nota || undefined);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aportar");
    } finally {
      setAportando(false);
    }
  };

  return (
    <Modal titulo="Aportar a la meta" onCerrar={onCerrar}>
      <p className="text-sm text-foreground">
        <strong>{meta.nombre}</strong> · {meta.pct}% (${meta.aportadoUsd.toFixed(2)} de ${meta.objetivoUsd.toFixed(2)})
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Aporte ({meta.moneda})</span>
          <input type="text" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Cuenta</span>
          <Select
            value={cuentaId}
            options={[{ value: "", label: "Sin cuenta (solo registro)" }, ...cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.moneda})` }))]}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nota (opcional)</span>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">
        Si eliges cuenta, se crea un egreso de ahorro en ella (el dinero se aparta).
      </p>
      <ErrorLinea mensaje={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={aportar}
          disabled={aportando}
          className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {aportando ? "Aportando…" : "Aportar"}
        </button>
      </div>
    </Modal>
  );
}

function SeccionMetas({
  metas,
  cuentas,
  onCambiar,
}: {
  metas: ControlMeta[];
  cuentas: FinCuentaConSaldo[];
  onCambiar: () => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<ControlMeta | null>(null);
  const [aportando, setAportando] = useState<ControlMeta | null>(null);
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-label="Metas de ahorro">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Metas de ahorro</h2>
        <button
          type="button"
          onClick={() => { setEditando(null); setMostrarForm(true); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-bold text-white"
        >
          <IconPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nueva
        </button>
      </div>
      <ErrorLinea mensaje={error} />
      {metas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
          <IconObjetivo className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">Sin metas. Define a qué quieres llegar y aporta poco a poco.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {metas.map((m) => (
            <li key={m.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{m.nombre}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    ${m.aportadoUsd.toFixed(2)} de ${m.objetivoUsd.toFixed(2)}
                    {m.fechaObjetivo ? ` · meta ${m.fechaObjetivo}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-foreground">{m.pct}%</p>
              </div>
              <Barra pct={m.pct} tono={m.pct >= 100 ? "verde" : "acento"} />
              <div className="mt-2.5 flex items-center gap-2">
                {m.pct < 100 ? (
                  <button
                    type="button"
                    onClick={() => setAportando(m)}
                    className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-white"
                  >
                    Aportar
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    <IconCheck className="h-3 w-3" aria-hidden="true" /> Alcanzada
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1">
                  {confirmandoBorrar === m.id ? (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          try { await eliminarMeta(m.id); setConfirmandoBorrar(null); onCambiar(); }
                          catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar"); }
                        }}
                        className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
                      >
                        Eliminar
                      </button>
                      <button type="button" onClick={() => setConfirmandoBorrar(null)} aria-label="Cancelar" className="rounded-full border border-border px-2 py-1 text-muted">
                        <IconX className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditando(m); setMostrarForm(true); }} aria-label={`Editar meta ${m.nombre}`} className="rounded-full p-1.5 text-muted hover:text-foreground">
                        <IconEditar className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => setConfirmandoBorrar(m.id)} aria-label={`Eliminar meta ${m.nombre}`} className="rounded-full p-1.5 text-muted hover:text-accent">
                        <IconBorrar className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {mostrarForm && (
        <FormMeta
          inicial={editando}
          onGuardar={async (nombre, objetivo, moneda, fecha, id) => { await guardarMeta(nombre, objetivo, moneda, fecha, id); onCambiar(); }}
          onCerrar={() => { setMostrarForm(false); setEditando(null); }}
        />
      )}
      {aportando && (
        <ModalAportar
          meta={aportando}
          cuentas={cuentas}
          onAportar={async (m, monto, c, n) => { await aportarAMeta(m, monto, c, n); onCambiar(); }}
          onCerrar={() => setAportando(null)}
        />
      )}
    </section>
  );
}

// ── Sección cierre de mes ────────────────────────────────────────────────────

function SeccionCierre({ cierre, mes, onCambiarMes }: { cierre: ControlCierre | null; mes: string; onCambiarMes: (m: string) => void }) {
  const [catExpandida, setCatExpandida] = useState<string | null>(null);
  const [movsCat, setMovsCat] = useState<Record<string, { fecha: string; nota: string; monto: number; moneda: string; usd: number }[]>>({});
  const [cargandoCat, setCargandoCat] = useState<string | null>(null);
  const moverMes = (delta: number) => {
    const [y, m] = mes.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onCambiarMes(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const diff = (a: number, b: number) => {
    if (!(b > 0)) return null;
    return Math.round(((a - b) / b) * 1000) / 10;
  };
  const dIng = cierre ? diff(cierre.ingresosUsd, cierre.mesAnterior.ingresosUsd) : null;
  const dEgr = cierre ? diff(cierre.egresosUsd, cierre.mesAnterior.egresosUsd) : null;

  // Al pulsar una categoría, muestra el desglose de sus movimientos.
  const toggleCategoria = async (categoria: string) => {
    if (catExpandida === categoria) {
      setCatExpandida(null);
      return;
    }
    setCatExpandida(categoria);
    if (movsCat[categoria]) return;
    setCargandoCat(categoria);
    try {
      const { getSupabase } = await import("@/lib/core/supabase");
      const supabase = getSupabase();
      if (!supabase) return;
      const [y, m] = mes.split("-").map(Number);
      const ini = `${mes}-01`;
      const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("fin_movimientos")
        .select("fecha, nota, monto, tasa_usd, fin_cuentas!fin_movimientos_cuenta_id_fkey(moneda)")
        .eq("tipo", "egreso")
        .eq("categoria", categoria)
        .is("anulado_en", null)
        .gte("fecha", ini)
        .lte("fecha", fin)
        .order("fecha", { ascending: false });
      const lista = ((data ?? []) as Record<string, unknown>[]).map((f) => {
        const cu = (f.fin_cuentas ?? {}) as Record<string, unknown>;
        const usd = Number(f.monto) * Number(f.tasa_usd);
        return {
          fecha: String(f.fecha),
          nota: String(f.nota ?? ""),
          monto: Number(f.monto),
          moneda: String(cu.moneda ?? ""),
          usd: Math.round(usd * 100) / 100,
        };
      });
      setMovsCat((prev) => ({ ...prev, [categoria]: lista }));
    } finally {
      setCargandoCat(null);
    }
  };

  return (
    <section aria-label="Cierre de mes">
      <div className="mb-3 flex items-center gap-1">
        <button type="button" onClick={() => moverMes(-1)} aria-label="Mes anterior" className="rounded-full p-1.5 text-muted hover:text-foreground">
          <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 className="text-sm font-bold text-foreground">{etiquetaMes(mes)}</h2>
        <button type="button" onClick={() => moverMes(1)} aria-label="Mes siguiente" className="rotate-180 rounded-full p-1.5 text-muted hover:text-foreground">
          <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {!cierre ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
          <IconReloj className="mx-auto h-6 w-6 text-muted" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted">Cargando cierre…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-muted">Ingresos</p>
              <p className="mt-1 text-sm font-bold text-green-700 dark:text-green-400">${cierre.ingresosUsd.toFixed(2)}</p>
              {dIng !== null && (
                <p className={`mt-0.5 text-[11px] font-bold ${dIng >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {dIng >= 0 ? "+" : ""}{dIng}% vs anterior
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-muted">Egresos</p>
              <p className="mt-1 text-sm font-bold text-red-700 dark:text-red-400">${cierre.egresosUsd.toFixed(2)}</p>
              {dEgr !== null && (
                <p className={`mt-0.5 text-[11px] font-bold ${dEgr <= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {dEgr >= 0 ? "+" : ""}{dEgr}% vs anterior
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-muted">Balance</p>
              <p className={`mt-1 text-sm font-bold ${cierre.balanceUsd >= 0 ? "text-foreground" : "text-red-700 dark:text-red-400"}`}>
                ${cierre.balanceUsd.toFixed(2)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">vs ${cierre.mesAnterior.ingresosUsd.toFixed(2)}/${cierre.mesAnterior.egresosUsd.toFixed(2)}</p>
            </div>
          </div>
          <h3 className="mb-2 mt-4 text-xs font-bold text-muted">Gasto por categoría</h3>
          {cierre.porCategoria.length === 0 ? (
            <p className="text-sm text-muted">Sin egresos este mes.</p>
          ) : (
            <ul className="space-y-2">
              {cierre.porCategoria.map((c) => (
                <li key={c.categoria} className="rounded-2xl border border-border bg-surface p-3">
                  <button
                    type="button"
                    onClick={() => toggleCategoria(c.categoria)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                    aria-expanded={catExpandida === c.categoria}
                  >
                    <p className="truncate text-sm font-bold capitalize text-foreground">{c.categoria}</p>
                    <p className="shrink-0 text-sm font-bold text-foreground">${c.total_usd.toFixed(2)}</p>
                  </button>
                  <p className="mt-0.5 text-[11px] text-muted">{c.n} movimiento{c.n === 1 ? "" : "s"}</p>
                  {catExpandida === c.categoria && (
                    <div className="mt-2 border-t border-border pt-2">
                      {cargandoCat === c.categoria ? (
                        <p className="text-[11px] text-muted">Cargando…</p>
                      ) : (movsCat[c.categoria] ?? []).length === 0 ? (
                        <p className="text-[11px] text-muted">Sin movimientos.</p>
                      ) : (
                        <ul className="space-y-1">
                          {(movsCat[c.categoria] ?? []).map((mv, i) => (
                            <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate text-muted">
                                {mv.fecha.slice(8, 10)}/{mv.fecha.slice(5, 7)} · {mv.nota || "—"}
                              </span>
                              <span className="shrink-0 font-semibold text-foreground">${mv.usd.toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function ControlPage() {
  const [tab, setTab] = useState<Tab>("recordatorios");
  const [cuentas, setCuentas] = useState<FinCuentaConSaldo[]>([]);
  const [recs, setRecs] = useState<ControlRecordatorio[]>([]);
  const [pres, setPres] = useState<ControlPresupuesto[]>([]);
  const [deudas, setDeudas] = useState<ControlDeuda[]>([]);
  const [metas, setMetas] = useState<ControlMeta[]>([]);
  const [cierre, setCierre] = useState<ControlCierre | null>(null);
  const [mes, setMes] = useState(mesActualCaracas());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [c, r, p, d, m] = await Promise.all([
        listarCuentasConSaldos(),
        listarRecordatorios(),
        listarPresupuestos(mes),
        listarDeudas(),
        listarMetas(),
      ]);
      setCuentas(c);
      setRecs(r);
      setPres(p);
      setDeudas(d);
      setMetas(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar Control");
    } finally {
      setCargando(false);
    }
  }, [mes]);

  const cargarCierre = useCallback(async () => {
    try {
      setCierre(await cierreDeMes(mes));
    } catch {
      setCierre(null);
    }
  }, [mes]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (vivo) await cargar();
    })();
    return () => {
      vivo = false;
    };
  }, [cargar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (vivo && tab === "cierre") await cargarCierre();
    })();
    return () => {
      vivo = false;
    };
  }, [tab, cargarCierre]);

  const proximosVencidos = recs.filter((r) => r.activo && (r.estado === "vencido" || r.estado === "por_vencer")).length;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <div className="mb-4 overflow-hidden rounded-3xl p-5 text-white" style={{ background: flameGradient }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Control</h1>
            <p className="mt-1 text-sm text-white/85">
              Pagos, presupuestos, deudas, metas y cierre de mes.
            </p>
          </div>
          <Link href="/" aria-label="Volver al inicio" className="rounded-full bg-white/20 p-2.5">
            <IconFlechaAtras className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        {proximosVencidos > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold">
            <IconCampana className="h-3.5 w-3.5" aria-hidden="true" />
            {proximosVencidos} pago{proximosVencidos === 1 ? "" : "s"} por vencer
          </p>
        )}
      </div>

      <nav aria-label="Secciones de Control" className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => setTab(t.valor)}
            aria-current={tab === t.valor ? "page" : undefined}
            className={`shrink-0 rounded-xl px-3 py-2 text-center text-xs font-bold whitespace-nowrap ${
              tab === t.valor ? "bg-accent text-white" : "text-muted"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </nav>

      {cargando ? (
        <div className="space-y-2" aria-label="Cargando">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <IconAlerta className="mx-auto h-6 w-6 text-accent" aria-hidden="true" />
          <p className="mt-2 text-sm text-foreground">{error}</p>
          <button
            type="button"
            onClick={() => { setCargando(true); void cargar(); }}
            className="mt-3 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {tab === "recordatorios" && <SeccionRecordatorios recs={recs} cuentas={cuentas} onCambiar={cargar} />}
          {tab === "presupuestos" && <SeccionPresupuestos pres={pres} mes={mes} onCambiarMes={setMes} onCambiar={cargar} />}
          {tab === "deudas" && <SeccionDeudas deudas={deudas} cuentas={cuentas} onCambiar={cargar} />}
          {tab === "metas" && <SeccionMetas metas={metas} cuentas={cuentas} onCambiar={cargar} />}
          {tab === "cierre" && <SeccionCierre cierre={cierre} mes={mes} onCambiarMes={setMes} />}
        </>
      )}
    </main>
  );
}
