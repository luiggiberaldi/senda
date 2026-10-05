"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  actualizarCuenta,
  anularMovimiento,
  archivarCuenta,
  crearCuenta,
  formatearMonto,
  hoyCaracas,
  listarCuentasConSaldos,
  listarMovimientos,
  patrimonioUsd,
  registrarMovimiento,
  resumenSemanal,
} from "../../lib/finanzas/finanzas";
import {
  CATEGORIAS_EGRESO,
  CATEGORIAS_INGRESO,
  MONEDAS,
  TIPOS_CUENTA,
  type FinCuentaConSaldo,
  type FinMoneda,
  type FinMovimiento,
  type FinResumenDia,
  type FinTipoCuenta,
  type FinTipoMov,
} from "../../lib/finanzas/types";
import { Select } from "../../components/core/ui/Select";
import { DatosFinanzas } from "../../components/finanzas/DatosFinanzas";
import { RecibosTab } from "../../components/recibos/RecibosTab";
import { EstadosTab } from "../../components/estados-cuenta/EstadosTab";
import { CarteraTab } from "../../components/cartera/CarteraTab";
import { CatalogoTab } from "../../components/cartera/CatalogoTab";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import {
  IconAlerta,
  IconCheck,
  IconEditar,
  IconFlechaAtras,
  IconMaletin,
  IconMovimiento,
  IconPlus,
  IconX,
} from "../../lib/core/ui/icons";

const TIPOS_MOV: { valor: FinTipoMov; etiqueta: string }[] = [
  { valor: "ingreso", etiqueta: "Ingreso" },
  { valor: "egreso", etiqueta: "Egreso" },
  { valor: "transferencia", etiqueta: "Transferencia" },
];

const inputCls =
  "mt-1 w-full rounded-xl border border-transparent bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const labelCls = "block";
const tituloCls = "text-xs font-bold text-muted";

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

/** Encabezado serio: sin juego, sin XP. Solo el patrimonio del hogar. */
function Encabezado({ patrimonio, cuentas, cargando }: { patrimonio: number; cuentas: FinCuentaConSaldo[]; cargando: boolean }) {
  // Desglose por moneda en su unidad nativa: cuánto hay en Bs, en $ y en USDT.
  const desglose = useMemo(() => {
    const orden: FinMoneda[] = ["VES", "USD", "USDT"];
    const sumas = new Map<FinMoneda, number>();
    for (const c of cuentas) sumas.set(c.moneda, (sumas.get(c.moneda) ?? 0) + c.saldoMoneda);
    return orden.map((m) => formatearMonto(sumas.get(m) ?? 0, m));
  }, [cuentas]);
  return (
    <header
      className="relative overflow-hidden rounded-3xl p-5 text-white"
      style={{ background: flameGradient, boxShadow: "0 18px 40px -12px rgba(248,72,24,.45)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 85% 0%, rgba(255,255,255,.18), transparent 60%)" }}
      />
      <div className="relative [text-shadow:0_1px_10px_rgba(0,0,0,0.30)]">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white"
            aria-label="Volver al inicio"
          >
            <IconFlechaAtras className="h-3.5 w-3.5" aria-hidden="true" />
            Inicio
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold">
            <IconMaletin className="h-3.5 w-3.5" aria-hidden="true" />
            Finanzas
          </span>
        </div>
        <p className="mt-4 text-xs text-white/85">Patrimonio total</p>
        <p className="mt-0.5 text-3xl font-bold tracking-tight">
          {cargando ? "…" : `$ ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(patrimonio)}`}
        </p>
        <p className="mt-1 text-xs text-white/75">Suma de saldos en dólares</p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-white/90" aria-label={`Desglose por moneda: ${desglose.join(", ")}`}>
          {desglose.map((d) => (
            <span key={d} className="whitespace-nowrap">{d}</span>
          ))}
        </p>
      </div>
    </header>
  );
}

function TarjetaCuenta({
  cuenta,
  onArchivar,
  onLista,
}: {
  cuenta: FinCuentaConSaldo;
  onArchivar: (id: string) => void;
  onLista: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [editando, setEditando] = useState(false);
  const tipoEtiqueta = TIPOS_CUENTA.find((t) => t.valor === cuenta.tipo)?.etiqueta ?? cuenta.tipo;

  if (editando) {
    return (
      <li className="rounded-2xl border border-border bg-surface p-4">
        <FormEditarCuenta
          cuenta={cuenta}
          onLista={() => { setEditando(false); onLista(); }}
          onCancelar={() => setEditando(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{cuenta.nombre}</p>
          <p className="mt-0.5 text-xs text-muted">
            {tipoEtiqueta} · {cuenta.moneda}
            {cuenta.hogarId ? " · Compartida" : ""}
          </p>
        </div>
        {confirmando ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => { onArchivar(cuenta.id); setConfirmando(false); }}
              className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
            >
              Archivar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-bold text-muted"
              aria-label="Cancelar"
            >
              <IconX className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-muted hover:text-foreground"
              aria-label={`Editar cuenta ${cuenta.nombre}`}
            >
              <IconEditar className="h-3 w-3" aria-hidden="true" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="shrink-0 rounded-full px-2 py-1 text-[11px] font-bold text-muted hover:text-foreground"
            >
              Archivar
            </button>
          </span>
        )}
      </div>
      <p className="mt-2 text-xl font-bold text-foreground">
        {formatearMonto(cuenta.saldoMoneda, cuenta.moneda)}
      </p>
      <p className="text-xs text-muted">
        ≈ $ {new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cuenta.saldoUsd)}
        {cuenta.nMovimientos > 0 ? ` · ${cuenta.nMovimientos} movimientos` : " · sin movimientos"}
      </p>
    </li>
  );
}

function FormEditarCuenta({
  cuenta,
  onLista,
  onCancelar,
}: {
  cuenta: FinCuentaConSaldo;
  onLista: () => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(cuenta.nombre);
  const [moneda, setMoneda] = useState<FinMoneda>(cuenta.moneda);
  const [tipo, setTipo] = useState<FinTipoCuenta>(cuenta.tipo);
  const [tasaManual, setTasaManual] = useState(
    cuenta.tasaUsdManual != null ? String(cuenta.tasaUsdManual).replace(".", ",") : ""
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La moneda no se puede cambiar si ya hay movimientos: corrompería el
  // historial en USD registrado con la moneda anterior.
  const puedeCambiarMoneda = cuenta.nMovimientos === 0;

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      const tasa = tasaManual.trim() === "" ? null : Number(tasaManual.replace(",", "."));
      await actualizarCuenta(cuenta.id, {
        nombre,
        tipo,
        tasaUsdManual: tasa,
        moneda: puedeCambiarMoneda ? moneda : undefined,
      });
      onLista();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la cuenta");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <p className="text-sm font-bold text-foreground">Editar cuenta</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Nombre</span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Tipo</span>
          <Select
            value={tipo}
            options={TIPOS_CUENTA.map((t) => ({ value: t.valor, label: t.etiqueta }))}
            onChange={(v) => setTipo(v as FinTipoCuenta)}
            ariaLabel="Tipo de cuenta"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Moneda</span>
          <Select
            value={moneda}
            options={MONEDAS.map((m) => ({ value: m.valor, label: m.etiqueta }))}
            onChange={(v) => setMoneda(v as FinMoneda)}
            ariaLabel="Moneda"
            className="mt-1"
            disabled={!puedeCambiarMoneda}
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Tasa manual {moneda === "COP" ? "(obligatoria)" : "(opcional)"}</span>
          <input
            type="text"
            inputMode="decimal"
            value={tasaManual}
            onChange={(e) => setTasaManual(e.target.value)}
            placeholder={moneda === "COP" ? "COP por $1" : "Vacío = tasa del día"}
            className={inputCls}
          />
        </label>
      </div>
      {!puedeCambiarMoneda && (
        <p className="mt-2 text-xs text-muted">
          La moneda no se puede cambiar porque la cuenta ya tiene movimientos.
        </p>
      )}
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-full border border-border px-4 py-2 text-xs font-bold text-muted"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function FormNuevaCuenta({ onLista }: { onLista: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [moneda, setMoneda] = useState<FinMoneda>("USD");
  const [tipo, setTipo] = useState<FinTipoCuenta>("efectivo");
  const [tasaManual, setTasaManual] = useState("");
  const [compartida, setCompartida] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      const tasa = tasaManual.trim() === "" ? null : Number(tasaManual.replace(",", "."));
      await crearCuenta({
        nombre,
        moneda,
        tipo,
        tasaUsdManual: tasa,
        compartida,
      });
      setNombre(""); setMoneda("USD"); setTipo("efectivo"); setTasaManual(""); setCompartida(false);
      setAbierto(false);
      onLista();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la cuenta");
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-4 py-2 text-xs font-bold text-muted hover:text-foreground"
      >
        <IconPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Nueva cuenta
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>Nombre</span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Efectivo"
            className={inputCls}
          />
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
          <span className={tituloCls}>Tipo</span>
          <Select
            value={tipo}
            options={TIPOS_CUENTA.map((t) => ({ value: t.valor, label: t.etiqueta }))}
            onChange={(v) => setTipo(v as FinTipoCuenta)}
            ariaLabel="Tipo de cuenta"
            className="mt-1"
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Tasa manual {moneda === "COP" ? "(obligatoria)" : "(opcional)"}</span>
          <input
            type="text"
            inputMode="decimal"
            value={tasaManual}
            onChange={(e) => setTasaManual(e.target.value)}
            placeholder={moneda === "COP" ? "COP por $1" : "Vacío = tasa del día"}
            className={inputCls}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted">Compartida con el hogar</span>
        <Switch checked={compartida} onChange={setCompartida} />
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {guardando ? "Creando…" : "Crear cuenta"}
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setError(null); }}
          className="rounded-full border border-border px-4 py-2 text-xs font-bold text-muted"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function FormMovimiento({
  cuentas,
  onListo,
}: {
  cuentas: FinCuentaConSaldo[];
  onListo: () => void;
}) {
  const [tipo, setTipo] = useState<FinTipoMov>("egreso");
  const [cuentaId, setCuentaId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const categorias = tipo === "ingreso" ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO;
  const opcionesCuentas = cuentas.map((c) => ({
    value: c.id,
    label: `${c.nombre} (${c.moneda})`,
  }));
  // Sin efecto: la primera cuenta es el valor por defecto durante el render.
  const cuentaSel = cuentaId || (cuentas[0]?.id ?? "");

  const guardar = async () => {
    setError(null); setOk(null); setGuardando(true);
    try {
      const m = Number(monto.replace(",", "."));
      if (!(m > 0)) throw new Error("El monto debe ser mayor a 0");
      if (!cuentaSel) throw new Error("Elige la cuenta");
      await registrarMovimiento({
        tipo,
        cuentaId: cuentaSel,
        cuentaDestinoId: tipo === "transferencia" ? destinoId || null : null,
        monto: m,
        categoria: categoria || null,
        fecha: fecha || hoyCaracas(),
        nota: nota || null,
      });
      setOk(tipo === "transferencia" ? "Transferencia registrada" : "Movimiento registrado");
      setMonto(""); setNota(""); setCategoria("");
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex gap-1 rounded-full bg-surface-2 p-1" role="tablist" aria-label="Tipo de movimiento">
        {TIPOS_MOV.map((t) => (
          <button
            key={t.valor}
            type="button"
            role="tab"
            aria-selected={tipo === t.valor}
            onClick={() => setTipo(t.valor)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              tipo === t.valor ? "bg-accent text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className={labelCls}>
          <span className={tituloCls}>{tipo === "transferencia" ? "Desde" : "Cuenta"}</span>
          <Select
            value={cuentaSel}
            options={opcionesCuentas}
            onChange={setCuentaId}
            ariaLabel="Cuenta"
            className="mt-1"
          />
        </label>
        {tipo === "transferencia" ? (
          <label className={labelCls}>
            <span className={tituloCls}>Hacia</span>
            <Select
              value={destinoId}
              options={opcionesCuentas.filter((o) => o.value !== cuentaSel)}
              onChange={setDestinoId}
              ariaLabel="Cuenta destino"
              className="mt-1"
            />
          </label>
        ) : (
          <label className={labelCls}>
            <span className={tituloCls}>Categoría</span>
            <Select
              value={categoria}
              options={[{ value: "", label: "Sin categoría" }, ...categorias.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))]}
              onChange={setCategoria}
              ariaLabel="Categoría"
              className="mt-1"
            />
          </label>
        )}
        <label className={labelCls}>
          <span className={tituloCls}>Monto</span>
          <input
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0,00"
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className={tituloCls}>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className={`${labelCls} col-span-2`}>
          <span className={tituloCls}>Nota (opcional)</span>
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej. Pan de la panadería"
            className={inputCls}
          />
        </label>
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-green-400" role="status">
          <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {ok}
        </p>
      )}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || cuentas.length === 0}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <IconMovimiento className="h-3.5 w-3.5" aria-hidden="true" />
        {guardando ? "Registrando…" : "Registrar"}
      </button>
      {cuentas.length === 0 && (
        <p className="mt-2 text-xs text-muted">Crea primero una cuenta para registrar movimientos.</p>
      )}
    </div>
  );
}

function FilaMovimiento({
  mov,
  onAnular,
}: {
  mov: FinMovimiento;
  onAnular: (id: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const fecha = new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${mov.fecha}T12:00:00`));
  const signo = mov.tipo === "ingreso" ? "+" : mov.tipo === "egreso" ? "−" : "→";
  const detalle =
    mov.tipo === "transferencia"
      ? `${mov.cuentaNombre ?? ""} → ${mov.destinoNombre ?? ""}`
      : mov.categoria
        ? `${mov.categoria[0].toUpperCase()}${mov.categoria.slice(1)}${mov.nota ? ` · ${mov.nota}` : ""}`
        : (mov.nota ?? mov.cuentaNombre ?? "");
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          mov.tipo === "ingreso"
            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
            : mov.tipo === "egreso"
              ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
              : "bg-surface-2 text-muted"
        }`}
        aria-hidden="true"
      >
        {signo}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{detalle || "Movimiento"}</p>
        <p className="text-xs text-muted">
          {fecha}
          {mov.tipo === "transferencia" && mov.montoDestino != null && mov.cuentaMoneda
            ? ` · ${formatearMonto(mov.montoDestino, mov.cuentaMoneda)}`
            : ""}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-bold ${mov.tipo === "ingreso" ? "text-green-700 dark:text-green-400" : mov.tipo === "egreso" ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
        {mov.tipo === "ingreso" ? "+" : mov.tipo === "egreso" ? "−" : ""}
        {mov.cuentaMoneda ? formatearMonto(mov.monto, mov.cuentaMoneda) : mov.monto}
      </p>
      {confirmando ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => { onAnular(mov.id); setConfirmando(false); }}
            className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-white"
          >
            Anular
          </button>
          <button
            type="button"
            onClick={() => setConfirmando(false)}
            className="rounded-full border border-border px-2 py-1 text-[11px] font-bold text-muted"
            aria-label="Cancelar"
          >
            <IconX className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="shrink-0 rounded-full px-2 py-1 text-[11px] font-bold text-muted hover:text-accent"
          aria-label={`Anular movimiento ${detalle}`}
        >
          Anular
        </button>
      )}
    </li>
  );
}

/** Etiqueta corta para los valores del gráfico semanal: $ 38, $ 1,2k. */
function formatoCortoSemanal(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 1000) return `$ ${(usd / 1000).toFixed(1).replace(".", ",")}k`;
  return `$ ${Math.round(usd).toLocaleString("es-VE")}`;
}

function ResumenSemanal({ dias }: { dias: FinResumenDia[] }) {
  const hoy = hoyCaracas();
  const hayDatos = dias.some((d) => d.ingresosUsd > 0 || d.egresosUsd > 0);
  const max = Math.max(1, ...dias.flatMap((d) => [d.ingresosUsd, d.egresosUsd]));
  const ALTURA = 120;
  const nombreDia = (fecha: string) =>
    new Intl.DateTimeFormat("es-VE", { weekday: "narrow" })
      .format(new Date(`${fecha}T12:00:00`))
      .toUpperCase();

  if (!hayDatos) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="text-sm font-semibold text-foreground">Sin movimientos esta semana</p>
        <p className="mt-1 text-xs text-muted">
          Registra un ingreso o un egreso y aquí verás el pulso de tu semana.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div
        className="flex items-stretch justify-between gap-1"
        role="img"
        aria-label="Ingresos y egresos de cada día de la semana"
      >
        {dias.map((d) => {
          const esHoy = d.fecha === hoy;
          const neto = d.ingresosUsd - d.egresosUsd;
          const hIng = d.ingresosUsd > 0 ? Math.max(6, (d.ingresosUsd / max) * ALTURA) : 0;
          const hEgr = d.egresosUsd > 0 ? Math.max(6, (d.egresosUsd / max) * ALTURA) : 0;
          return (
            <div
              key={d.fecha}
              className={`flex min-w-0 flex-1 flex-col items-center justify-end rounded-xl px-0.5 py-1.5 ${esHoy ? "bg-accent-soft" : ""}`}
            >
              <span
                className={`h-4 whitespace-nowrap text-[10px] font-bold ${
                  neto > 0 ? "text-green-700 dark:text-green-400" : neto < 0 ? "text-red-700 dark:text-red-400" : ""
                }`}
              >
                {neto !== 0 ? `${neto > 0 ? "+" : "−"}${formatoCortoSemanal(Math.abs(neto))}` : ""}
              </span>
              <div className="flex w-full items-end justify-center gap-1" style={{ height: ALTURA }}>
                <div
                  className="w-3.5 rounded-full bg-green-500"
                  style={{ height: `${hIng}px` }}
                  title={`Ingresos: ${formatearMonto(d.ingresosUsd, "USD")}`}
                />
                <div
                  className="w-3.5 rounded-full bg-accent"
                  style={{ height: `${hEgr}px` }}
                  title={`Egresos: ${formatearMonto(d.egresosUsd, "USD")}`}
                />
              </div>
              <span className={`mt-1.5 text-[10px] font-bold ${esHoy ? "text-accent" : "text-muted"}`}>
                {nombreDia(d.fecha)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-center gap-5 text-xs font-semibold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" aria-hidden="true" /> Ingresos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" /> Egresos
        </span>
      </div>
    </div>
  );
}

export default function Finanzas() {
  const [cuentas, setCuentas] = useState<FinCuentaConSaldo[]>([]);
  const [movimientos, setMovimientos] = useState<FinMovimiento[]>([]);
  const [semana, setSemana] = useState<FinResumenDia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumen" | "recibos" | "estados" | "cartera" | "catalogo" | "datos">("resumen");

  const recargar = useCallback(async () => {
    setError(null);
    try {
      const [c, m, s] = await Promise.all([
        listarCuentasConSaldos(),
        listarMovimientos(30),
        resumenSemanal(),
      ]);
      setCuentas(c);
      setMovimientos(m);
      setSemana(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las finanzas");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setError(null);
      try {
        const [c, m, s] = await Promise.all([
          listarCuentasConSaldos(),
          listarMovimientos(30),
          resumenSemanal(),
        ]);
        if (!vivo) return;
        setCuentas(c);
        setMovimientos(m);
        setSemana(s);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar las finanzas");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [recargar]);

  const patrimonio = useMemo(() => patrimonioUsd(cuentas), [cuentas]);

  const archivar = async (id: string) => {
    try {
      await archivarCuenta(id);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo archivar");
    }
  };

  const anular = async (id: string) => {
    try {
      await anularMovimiento(id);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Encabezado patrimonio={patrimonio} cuentas={cuentas} cargando={cargando} />

      <div className="grid grid-cols-6 gap-1.5 rounded-2xl bg-surface p-1.5" role="tablist" aria-label="Secciones de Finanzas">
        {(
          [
            { id: "resumen", etiqueta: "Resumen" },
            { id: "recibos", etiqueta: "Recibos" },
            { id: "estados", etiqueta: "Estados" },
            { id: "cartera", etiqueta: "Cartera" },
            { id: "catalogo", etiqueta: "Catálogo" },
            { id: "datos", etiqueta: "Datos" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-w-0 rounded-xl px-1 py-2 text-center text-xs font-bold transition-colors sm:text-sm ${
              tab === t.id ? "bg-accent text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {error && (
        <p className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-xs font-bold text-accent" role="alert">
          <IconAlerta className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {tab === "resumen" ? (
        <>
          <section aria-labelledby="fin-cuentas">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="fin-cuentas" className="text-base font-bold text-foreground">Cuentas</h2>
        </div>
        {cargando ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : cuentas.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Aún no hay cuentas. Crea la primera para empezar.</p>
            <FormNuevaCuenta onLista={recargar} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="grid gap-3 sm:grid-cols-2">
              {cuentas.map((c) => (
                <TarjetaCuenta key={c.id} cuenta={c} onArchivar={archivar} onLista={recargar} />
              ))}
            </ul>
            <FormNuevaCuenta onLista={recargar} />
          </div>
        )}
        </section>

        <section aria-labelledby="fin-registrar">
        <h2 id="fin-registrar" className="mb-3 text-base font-bold text-foreground">Registrar movimiento</h2>
        <FormMovimiento cuentas={cuentas} onListo={recargar} />
        </section>

        <section aria-labelledby="fin-semana">
        <h2 id="fin-semana" className="mb-3 text-base font-bold text-foreground">Esta semana</h2>
        <ResumenSemanal dias={semana} />
        </section>

        <section aria-labelledby="fin-historial">
        <h2 id="fin-historial" className="mb-3 text-base font-bold text-foreground">Movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted">Sin movimientos todavía.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {movimientos.map((m) => (
              <FilaMovimiento key={m.id} mov={m} onAnular={anular} />
            ))}
          </ul>
            )}
          </section>
        </>
        ) : tab === "recibos" ? (
        <RecibosTab />
        ) : tab === "estados" ? (
        <EstadosTab />
        ) : tab === "cartera" ? (
        <CarteraTab />
        ) : tab === "catalogo" ? (
        <CatalogoTab />
        ) : (
        <DatosFinanzas patrimonio={patrimonio} />
      )}
    </div>
  );
}
