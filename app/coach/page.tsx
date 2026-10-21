"use client";

/**
 * Coach de Senda (Fase 4): briefing cruzado de solo lectura.
 * Hábitos, Finanzas, Mercado, Control y Tasas en una vista, con
 * correlaciones que citan datos verificables dentro de la app.
 * Tono serio, sin XP ni logros.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IconFlechaAtras,
  IconEstadisticas,
  IconAlerta,
  IconCheck,
  IconCampana,
  IconObjetivo,
  IconMaletin,
  IconReloj,
} from "../../lib/core/ui/icons";
import { flameGradient } from "../../lib/core/ui/design-tokens";
import {
  obtenerBriefing,
  type CoachBriefing,
  type CoachCorrelacion,
} from "../../lib/coach/coach";

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function tarjetaResumen(icono: React.ReactNode, titulo: string, valor: string, sub: string, href: string) {
  return (
    <Link
      key={titulo}
      href={href}
      className="flex items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4"
    >
      <span className="shrink-0 w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300">
        {icono}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{titulo}</span>
        <span className="block text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{valor}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">{sub}</span>
      </span>
    </Link>
  );
}

function tarjetaCorrelacion(c: CoachCorrelacion) {
  return (
    <Link
      key={c.id}
      href={c.ver_en}
      className="block rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center text-amber-700 dark:text-amber-300">
          <IconAlerta className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{c.titulo}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">{c.detalle}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
            Verificar en {c.ver_en === "/" ? "el inicio" : c.ver_en} →
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function CoachPage() {
  const [briefing, setBriefing] = useState<CoachBriefing | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setBriefing(await obtenerBriefing());
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (vivo) await cargar();
    })();
    return () => {
      vivo = false;
    };
  }, [cargar]);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 mb-3">
            <IconFlechaAtras className="w-4 h-4" /> Inicio
          </Link>
          <div className="rounded-3xl p-5 text-white" style={{ background: flameGradient }}>
            <h1 className="text-2xl font-bold">Coach</h1>
            <p className="text-white/85 text-sm mt-1">
              {briefing ? `Semana del ${briefing.ventana.desde} al ${briefing.ventana.hasta}` : "Tu semana cruzada"}
            </p>
          </div>
        </header>

        {cargando && (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 text-center text-sm text-zinc-500">
            Analizando tu semana…
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">No pude cargar el briefing ({error}).</p>
            <button
              onClick={() => void cargar()}
              className="mt-3 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm px-5 py-2"
            >
              Reintentar
            </button>
          </div>
        )}

        {briefing && !cargando && (
          <div className="space-y-5">
            <section>
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Resumen 7 días</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tarjetaResumen(<IconCheck className="w-5 h-5" />, "Hábitos", String(briefing.habitos.completados_7d), `registros (prev: ${briefing.habitos.completados_7d_prev})`, "/habitos")}
                {tarjetaResumen(<IconMaletin className="w-5 h-5" />, "Gastos", fmtUsd(briefing.finanzas.egresos_7d_usd), `prev: ${fmtUsd(briefing.finanzas.egresos_7d_prev_usd)}`, "/finanzas")}
                {tarjetaResumen(<IconMaletin className="w-5 h-5" />, "Ingresos", fmtUsd(briefing.finanzas.ingresos_7d_usd), `prev: ${fmtUsd(briefing.finanzas.ingresos_7d_prev_usd)}`, "/finanzas")}
                {tarjetaResumen(<IconMaletin className="w-5 h-5" />, "Neto", fmtUsd(briefing.finanzas.neto_7d_usd), `prev: ${fmtUsd(briefing.finanzas.neto_7d_prev_usd)}`, "/finanzas")}
                {tarjetaResumen(<IconCampana className="w-5 h-5" />, "Pagos vencidos", String(briefing.control.recordatorios_vencidos), `${briefing.control.deudas_pendientes} deudas pendientes`, "/control")}
                {tarjetaResumen(<IconObjetivo className="w-5 h-5" />, "Por comprar", String(briefing.mercado.lista_pendientes), "pendientes en la lista", "/mercado")}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Correlaciones</h2>
              {briefing.correlaciones.length === 0 ? (
                <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 flex items-start gap-3">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
                    <IconCheck className="w-5 h-5" />
                  </span>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Sin señales esta semana. Sigue registrando: el coach habla solo cuando hay datos reales.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">{briefing.correlaciones.map(tarjetaCorrelacion)}</div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Tasas</h2>
              <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
                {(
                  [
                    ["BCV", briefing.tasas.bcv],
                    ["Euro", briefing.tasas.euro],
                    ["USDT", briefing.tasas.usdt],
                  ] as Array<[string, { hoy: number | null; pct_7d: number | null }]>
                ).map(([nombre, t]) => (
                  <div key={nombre} className="flex items-center gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300">
                      <IconReloj className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">
                        {nombre}{" "}
                        {t.hoy !== null
                          ? `Bs ${Number(t.hoy).toLocaleString("es-VE")}`
                          : "—"}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t.pct_7d !== null
                          ? `${t.pct_7d >= 0 ? "+" : ""}${t.pct_7d}% en 7 días`
                          : "Sin historial de 7 días aún"}
                      </p>
                    </div>
                  </div>
                ))}
                <Link href="/" className="ml-auto text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 pt-1">
                  <IconEstadisticas className="w-4 h-4" /> Tasas del día
                </Link>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
