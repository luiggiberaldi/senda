// Edge Function actualizar-tasas — Servicio de tasas (Fase 0.4 de Senda).
//
// Acciones (body JSON):
//   {"accion":"actualizar"} — trae BCV ($ oficial) y euro oficial (BCV)
//     DIRECTO del BCV (scrape bcv.org.ve → CDN DolarVZLA → DolarAPI como
//     último recurso); paralelo ($) de DolarAPI; USDT de CriptoYa
//     (fallback: Binance P2P); hace upsert en fin_tasas para la fecha de hoy
//     (America/Caracas). Cada fuente falla por separado sin tumbar a las
//     demás: se conserva el valor previo del campo fallido.
//     NOTA: DolarAPI queda como ÚLTIMO recurso para las tasas oficiales
//     porque su publicación puede quedar un día atrás respecto de la página
//     vigente del BCV (criterio de listo-pos-cotizaciones).
//   {"accion":"manual","bcv":n,"euro":n,"usdt":n} — guarda tasas ingresadas a
//     mano por el usuario (fuente "manual"). El paralelo ya no se edita a mano
//     (solo automático): se sigue guardando porque Finanzas lo usa para
//     convertir VES→USD.
//
// Auth: header x-tasas-secret igual a TASAS_SECRET. Fail-closed: sin el
// secreto configurado o con valor incorrecto responde 401 y no ejecuta nada.
// verify_jwt=false (la llama pg_cron y el proxy del servidor, no el browser).
//
// Auth: header x-tasas-secret igual a TASAS_SECRET. Fail-closed: sin el
// secreto configurado o con valor incorrecto responde 401 y no ejecuta nada.
// verify_jwt=false (la llama pg_cron y el proxy del servidor, no el browser).
import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "America/Caracas";

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta variable de entorno requerida: ${name}`);
  return v;
}

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const TASAS_SECRET = Deno.env.get("TASAS_SECRET") ?? "";
if (!TASAS_SECRET) {
  console.error("TASAS_SECRET no configurado: la función rechaza todo.");
}

/** Fecha YYYY-MM-DD de hoy en America/Caracas. */
function fechaHoy(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** DolarAPI: { promedio } para oficial/paralelo del $ o del €. */
async function dolarApi(
  moneda: "dolares" | "euros",
  fuente: "oficial" | "paralelo",
): Promise<number | null> {
  try {
    const d = (await fetchJson(
      `https://ve.dolarapi.com/v1/${moneda}/${fuente}`,
    )) as { promedio?: unknown };
    const v = Number(d?.promedio);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (e) {
    console.error(`DolarAPI ${moneda}/${fuente} falló:`, e);
    return null;
  }
}

// ─── BCV directo (criterio listo-pos-cotizaciones) ───────────────────────────
// El dólar y el euro oficiales se traen DIRECTO del BCV, no de DolarAPI,
// porque la publicación de DolarAPI puede quedar un día atrás respecto de
// la página vigente del BCV.

const BCV_URL = "https://www.bcv.org.ve/";
const BCV_CDN_URL = "https://rates.dolarvzla.com/bcv/current.json";
const BCV_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Parsea "873,86" / "1.234,56" (formato venezolano) a number. */
function parseLocalizedNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const clean = value.replace(/[^\d.,]/g, "");
  if (!clean) return 0;
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  const lastSep = Math.max(lastDot, lastComma);
  if (lastSep === -1) return Number(clean) || 0;
  const integer = clean.slice(0, lastSep).replace(/[.,]/g, "");
  const decimals = clean.slice(lastSep + 1);
  return Number(`${integer}.${decimals}`) || 0;
}

/** Extrae la tasa con id="dolar" o id="euro" del HTML del BCV. */
function extractBcvRate(html: string, id: string): number {
  const patterns = [
    new RegExp(
      `id=["']${id}["'][\\s\\S]{0,5000}?<strong\\b[^>]*class=["'][^"']*strong-tb[^"']*["'][^>]*>\\s*([\\d.,]+)`,
      "i",
    ),
    new RegExp(`id=["']${id}["'][\\s\\S]{0,5000}?<strong\\b[^>]*>\\s*([\\d.,]+)`, "i"),
  ];
  for (const pattern of patterns) {
    const v = parseLocalizedNumber(html.match(pattern)?.[1]);
    if (v > 0) return v;
  }
  return 0;
}

async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 1. BCV directo: scrapea bcv.org.ve (dólar y euro oficiales). */
async function fetchBcvDirect(): Promise<{ usd: number; eur: number } | null> {
  const html = await fetchText(`${BCV_URL}?_=${Date.now()}`, {
    headers: {
      "User-Agent": BCV_USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-VE,es;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!html) return null;
  const usd = extractBcvRate(html, "dolar");
  const eur = extractBcvRate(html, "euro");
  if (usd <= 0 || eur <= 0) return null;
  return { usd, eur };
}

/** 2. CDN que replica la publicación diaria del BCV. */
async function fetchBcvCdn(): Promise<{ usd: number; eur: number } | null> {
  try {
    const d = (await fetchJson(`${BCV_CDN_URL}?_=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    }, 8_000)) as { current?: { usd?: unknown; eur?: unknown; date?: unknown } };
    const usd = parseLocalizedNumber(d?.current?.usd);
    const eur = parseLocalizedNumber(d?.current?.eur);
    if (usd <= 0 || eur <= 0 || typeof d?.current?.date !== "string") return null;
    return { usd, eur };
  } catch {
    return null;
  }
}

type BcvOficial = { usd: number; eur: number; fuente: string } | null;

/**
 * Tasas oficiales BCV (dólar y euro) con prioridad:
 * BCV directo → CDN DolarVZLA → DolarAPI (último recurso).
 */
async function bcvOficialRates(): Promise<BcvOficial> {
  const directo = await fetchBcvDirect();
  if (directo) return { ...directo, fuente: "BCV Directo" };
  const cdn = await fetchBcvCdn();
  if (cdn) return { ...cdn, fuente: "BCV CDN (DolarVZLA)" };
  const [usdApi, eurApi] = await Promise.all([
    dolarApi("dolares", "oficial"),
    dolarApi("euros", "oficial"),
  ]);
  if (usdApi !== null && eurApi !== null) {
    return { usd: usdApi, eur: eurApi, fuente: "DolarAPI Oficial (último recurso)" };
  }
  return null;
}

/** USDT/VES: promedio de ask/bid de CriptoYa (Binance P2P). */
async function usdtCriptoYa(): Promise<number | null> {
  try {
    const d = (await fetchJson(
      "https://criptoya.com/api/binancep2p/usdt/ves/1",
    )) as { ask?: unknown; bid?: unknown };
    const ask = Number(d?.ask);
    const bid = Number(d?.bid);
    if (Number.isFinite(ask) && Number.isFinite(bid) && ask > 0 && bid > 0) {
      return (ask + bid) / 2;
    }
    return null;
  } catch (e) {
    console.error("CriptoYa falló:", e);
    return null;
  }
}

/** Fallback USDT: mediana de los 5 primeros anuncios BUY de Binance P2P. */
async function usdtBinanceP2P(): Promise<number | null> {
  try {
    const d = (await fetchJson(
      "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: "USDT",
          fiat: "VES",
          merchantCheck: false,
          page: 1,
          payTypes: [],
          publisherType: null,
          rows: 5,
          tradeType: "BUY",
        }),
      },
    )) as { data?: Array<{ adv?: { price?: unknown } }> };
    const precios = (d?.data ?? [])
      .map((x) => Number(x?.adv?.price))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (precios.length === 0) return null;
    const mid = Math.floor(precios.length / 2);
    return precios.length % 2 === 1
      ? precios[mid]
      : (precios[mid - 1] + precios[mid]) / 2;
  } catch (e) {
    console.error("Binance P2P falló:", e);
    return null;
  }
}

function redondear(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Método no permitido" }, { status: 405 });
  }
  const secreto = req.headers.get("x-tasas-secret") ?? "";
  if (!TASAS_SECRET || secreto !== TASAS_SECRET) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const fecha = fechaHoy();
  const { data: previa } = await supabase
    .from("fin_tasas")
    .select("bcv,paralelo,euro,usdt")
    .eq("fecha", fecha)
    .maybeSingle();

  let bcv: number | null = null;
  let paralelo: number | null = null;
  let euro: number | null = null;
  let usdt: number | null = null;
  let fuente = "";

  if (body.accion === "manual") {
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    bcv = num(body.bcv) ?? previa?.bcv ?? null;
    // El paralelo ya no se edita a mano: se conserva el previo (lo mantiene el cron).
    paralelo = num(body.paralelo) ?? previa?.paralelo ?? null;
    euro = num(body.euro) ?? previa?.euro ?? null;
    usdt = num(body.usdt) ?? previa?.usdt ?? null;
    fuente = "manual";
    if (bcv === null && euro === null && usdt === null) {
      return Response.json(
        { error: "Sin valores válidos para guardar" },
        { status: 400 },
      );
    }
  } else if (body.accion === "actualizar") {
    // Oficiales (BCV $ y €): directo del BCV → CDN → DolarAPI (último recurso).
    // Paralelo: solo DolarAPI (el BCV no lo publica). USDT: CriptoYa → Binance.
    const [oficial, paraleloApi, usdtCripto] = await Promise.all([
      bcvOficialRates(),
      dolarApi("dolares", "paralelo"),
      usdtCriptoYa(),
    ]);
    const bcvApi = oficial?.usd ?? null;
    const euroApi = oficial?.eur ?? null;
    const fuenteOficial = oficial?.fuente ?? null;
    let usdtApi = usdtCripto;
    let fuenteUsdt = "CriptoYa";
    if (usdtApi === null) {
      usdtApi = await usdtBinanceP2P();
      fuenteUsdt = "Binance P2P";
    }
    bcv = redondear(bcvApi) ?? previa?.bcv ?? null;
    paralelo = redondear(paraleloApi) ?? previa?.paralelo ?? null;
    euro = redondear(euroApi) ?? previa?.euro ?? null;
    usdt = redondear(usdtApi) ?? previa?.usdt ?? null;
    const partes: string[] = [];
    if (fuenteOficial) {
      partes.push(fuenteOficial);
    } else if (paraleloApi !== null) {
      partes.push("DolarAPI");
    }
    if (usdtApi !== null) partes.push(fuenteUsdt);
    fuente = partes.join(" + ") || "sin datos nuevos";
    if (bcv === null && paralelo === null && euro === null && usdt === null) {
      return Response.json(
        { error: "Todas las fuentes fallaron y no hay tasas guardadas" },
        { status: 502 },
      );
    }
  } else {
    return Response.json(
      { error: 'acción desconocida (usa "actualizar" o "manual")' },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("fin_tasas").upsert(
    {
      fecha,
      bcv,
      paralelo,
      euro,
      usdt,
      fuente,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fecha" },
  );
  if (error) {
    console.error("Upsert fin_tasas falló:", error);
    return Response.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  return Response.json({ ok: true, fecha, bcv, paralelo, usdt, fuente });
});
