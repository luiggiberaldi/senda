#!/usr/bin/env node
// Módulo Recibos por WhatsApp (Fase 5.3).
//
//   node scripts/whatsapp-recibos.mjs --q "<texto sin el prefijo 'recibo'>"
//
// Contrato: siempre JSON a stdout. El agente responde SOLO desde el JSON:
//   ok:true                    → confirmar con `mensaje`
//   ok:false + codigo:pregunta → preguntar con `pregunta`
//   ok:false + codigo:resumen  → mostrar `resumen` tal cual y esperar "sí"
//                                (el campo `espera_confirmacion` es true)
//   ok:false                   → decir lo que indica `detalle`
//
// Un solo borrador activo por usuario (guardarraíl #8), persistido en
// ~/.config/habitos/recibo-borrador.json. Nada se crea, abona, anula ni
// duplica sin resumen + "sí" explícito (guardarraíl #1). La confirmación es
// idempotente: antes del RPC el borrador pasa a fase "ejecutando", así un
// doble "sí" no crea duplicados.
//
// Intenciones:
//   "para Ana: reparación laptop 150; cargador 25" → borrador crear
//   Opcionales: "emisor: Mi Negocio; tel: 0412-1112233; email: ana@x.com;
//                ciudad: Caracas; vence: 15/10/2026"
//   "sí"                                            → confirma lo pendiente
//   "listar" / "listar Ana"                         → últimos recibos
//   "ver SEN-202609-001" / "ver Ana"                → detalle
//   "pdf Ana"                                       → PDF en base64
//   "duplicar SEN-202609-001"                       → borrador duplicado
//   "abonar 100 al SEN-202609-001"                  → borrador abono
//   "borrar SEN-202609-001"                         → borrador borrado
//   "cancelar"                                      → descarta el borrador
//   "ayuda"                                         → ayuda
//
// NOTA: el router ya enruta el "sí"/"cancelar" sin prefijo a este script cuando
// hay un borrador pendiente (ver whatsapp-router.mjs). Invocación directa con
// --q "sí" también funciona.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { cargarConfig, norm, root } from "./whatsapp-comun.mjs";

const HOME = process.env.HOME || "/home/hatch";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
const out = (obj) => {
  // writeSync: console.log + process.exit trunca el pipe con salidas grandes (pdf_base64).
  try { writeSync(1, JSON.stringify(obj) + "\n"); } catch { console.log(JSON.stringify(obj)); }
  process.exit(obj.ok ? 0 : 1);
};
const q = String(args.q ?? "").trim();
if (!q) out({ ok: false, codigo: "args", detalle: "se requiere --q \"<texto>\"" });

// ── Config + RPC (header x-fin-rpc-secret, igual que whatsapp-finanzas) ──────
let cfg;
try {
  cfg = cargarConfig(args);
} catch (e) {
  out({ ok: false, codigo: "config", detalle: String(e.message || e) });
}

function crearRpcRecibos(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) {
      if (fn === "rpc_recibo_listar") return [];
      if (fn === "rpc_recibo_ver") {
        return {
          id: "mock-id", numero: "SEN-202609-001", estado: "pendiente", moneda: "USD",
          cliente_nombre: "Ana Pérez", total: "325.00", total_pagado: "0", saldo: "325.00",
          fecha_emision: "2026-09-28", fecha_vencimiento: null,
          snapshot: {
            emisor: { nombre: "Mi Negocio" },
            items: [
              { id: "i1", description: "Reparación laptop", quantity: 2, unitPrice: 150, discount: 0 },
              { id: "i2", description: "Cargador", quantity: 1, unitPrice: 25, discount: 0 },
            ],
            pagos: [], descuentoGlobal: 0, impuesto: 0, notas: "",
          },
        };
      }
      if (fn === "rpc_recibo_crear") return { ok: true, id: "mock-id", numero: "SEN-202609-001" };
      if (fn === "rpc_recibo_abonar") return { ok: true, estado: "parcial", saldo: 225 };
      if (fn === "rpc_recibo_borrar") return { ok: true };
      if (fn === "rpc_recibo_duplicar") return { ok: true, id: "mock-id-2", numero: "SEN-202609-002" };
      throw new Error(`mock sin datos para ${fn}`);
    }
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.ANON_KEY,
        Authorization: `Bearer ${cfg.ANON_KEY}`,
        "x-fin-rpc-secret": cfg.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}
const rpc = crearRpcRecibos(cfg);

// ── Estado: un borrador activo por usuario ───────────────────────────────────
const ESTADO_PATH = join(HOME, ".config", "habitos", "recibo-borrador.json");
const EMISOR_PATH = join(HOME, ".config", "habitos", "recibo-emisor.json");

/** Perfil del emisor: RIF/doc, teléfono, email y dirección que van en el PDF. */
function cargarPerfilEmisor() {
  try {
    if (!existsSync(EMISOR_PATH)) return { nombre: "", doc: "", telefono: "", email: "", direccion: "" };
    const p = JSON.parse(readFileSync(EMISOR_PATH, "utf8"));
    return {
      nombre: String(p.nombre || ""),
      doc: String(p.doc || ""),
      telefono: String(p.telefono || ""),
      email: String(p.email || ""),
      direccion: String(p.direccion || ""),
    };
  } catch {
    return { nombre: "", doc: "", telefono: "", email: "", direccion: "" };
  }
}
function cargarEstado() {
  try {
    if (!existsSync(ESTADO_PATH)) return {};
    return JSON.parse(readFileSync(ESTADO_PATH, "utf8"));
  } catch {
    return {};
  }
}
function guardarEstadoTodo(estado) {
  mkdirSync(join(HOME, ".config", "habitos"), { recursive: true });
  writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
}
const perfilEmisor = cargarPerfilEmisor();
const estadoTodo = cargarEstado();
let miDraft = estadoTodo[cfg.USER_ID] || null;
function guardarDraft(d) {
  if (d) estadoTodo[cfg.USER_ID] = d;
  else delete estadoTodo[cfg.USER_ID];
  guardarEstadoTodo(estadoTodo);
}
function recordarEmisor(emisor) {
  if (!emisor?.nombre) return;
  estadoTodo[cfg.USER_ID] = estadoTodo[cfg.USER_ID] || {};
  estadoTodo[cfg.USER_ID].ultimo_emisor = emisor;
  guardarEstadoTodo(estadoTodo);
}
const ultimoEmisor = estadoTodo[cfg.USER_ID]?.ultimo_emisor || null;

// ── Formato ──────────────────────────────────────────────────────────────────
const fmtNum = (n) =>
  new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtMoneda = (monto, moneda) => {
  const n = fmtNum(monto);
  if (moneda === "VES") return `Bs ${n}`;
  if (moneda === "USDT") return `${n} USDT`;
  if (moneda === "COP") return `COP ${n}`;
  return `$ ${n}`;
};
const fmtFecha = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
};
const ESTADO_LABEL = { pendiente: "pendiente", parcial: "parcial", pagado: "pagado", anulado: "anulado" };
const hoyCaracas = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
/** Suma días a una fecha ISO yyyy-mm-dd (UTC). */
const sumarDias = (iso, dias) => {
  const [y, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
};

// ── Parseo ───────────────────────────────────────────────────────────────────
/** Monto: acepta 1.234,56 (es-VE), 1,234.56 y 1234.56. Devuelve number o null. */
function extraerMonto(texto) {
  const m = texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1];
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}
const montoRaw = (texto) =>
  (texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/) || [])[1] || null;

function detectarMoneda(texto) {
  const n = norm(texto);
  if (/\b(usdt|tether)\b/.test(n)) return "USDT";
  if (/\b(bs|bolivares?|ves)\b/.test(n)) return "VES";
  if (/\b(cop|pesos?)\b/.test(n)) return "COP";
  if (/\$|\b(dolar(es)?|bucks?)\b/.test(n)) return "USD";
  return null;
}

/** Fecha a ISO yyyy-mm-dd. Acepta DD/MM/AAAA, DD-MM-AAAA y AAAA-MM-DD. */
function normalizarFecha(txt) {
  const t = String(txt || "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0");
    if (+dd >= 1 && +dd <= 31 && +mm >= 1 && +mm <= 12) return `${m[3]}-${mm}-${dd}`;
  }
  return null;
}

/** Como normalizarFecha, pero acepta dd/mm sin año (asume el año actual). */
function normalizarFechaCorta(txt) {
  const f = normalizarFecha(txt);
  if (f) return f;
  const t = String(txt || "").trim();
  const m = t.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
  if (m) {
    const dd = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0");
    if (+dd >= 1 && +dd <= 31 && +mm >= 1 && +mm <= 12) {
      const y = new Date().getFullYear();
      return `${y}-${mm}-${dd}`;
    }
  }
  return null;
}

/** Parsea un borrador de creación desde texto libre. */
function parseCrear(texto) {
  const d = { emisor: null, cliente: null, clienteTelefono: "", clienteEmail: "", clienteCiudad: "", vencimiento: "", moneda: null, items: [], descuento: 0, impuesto: 0, notas: "", garantiaDias: 0, cuotas: [], observaciones: "" };
  let resto = ` ${texto} `;

  let m = resto.match(/\bemisor\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.emisor = { nombre: m[1].trim() };
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\b(?:tel|telefono)\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.clienteTelefono = m[1].trim();
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\b(?:email|correo)\s*:\s*([^\s;]+@[^\s;]+)/i);
  if (m) {
    d.clienteEmail = m[1].trim();
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bciudad\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.clienteCiudad = m[1].trim();
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bvenc(?:e|imiento)?\s*:\s*([^\s;]+)/i);
  if (m) {
    const f = normalizarFecha(m[1].trim());
    if (f) d.vencimiento = f;
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bcliente\s*:\s*([^;]+?)(?=\s*[;]|$)/i) || resto.match(/\bpara\s+([^:;]+?)(?=\s*[:;]|$)/i);
  if (m) {
    d.cliente = m[1].trim().replace(/^(el|la|los|las)\s+/i, "");
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bnotas?\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.notas = m[1].trim().slice(0, 280);
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bdescuento\s+(\d+(?:[.,]\d+)?)\s*%?/i);
  if (m) {
    d.descuento = Number(m[1].replace(",", "."));
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\b(?:impuesto|iva)\s+(\d+(?:[.,]\d+)?)\s*%?/i);
  if (m) {
    d.impuesto = Number(m[1].replace(",", "."));
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bgarant[ií]a\s*:?\s*(\d+)\s*d[ií]as?/i);
  if (m) {
    d.garantiaDias = Math.max(0, parseInt(m[1], 10));
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bcuotas?\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.cuotas = [];
    for (const parte of m[1].split(/[,+]/)) {
      const pm = parte.trim().match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
      if (pm) {
        const f = normalizarFechaCorta(pm[2].trim());
        if (f) d.cuotas.push({ monto: Number(pm[1].replace(",", ".")), fecha: f });
      }
    }
    resto = resto.replace(m[0], " ");
  }
  m = resto.match(/\bobservaciones?\s*:\s*([^;]+?)(?=\s*[;]|$)/i);
  if (m) {
    d.observaciones = m[1].trim().slice(0, 280);
    resto = resto.replace(m[0], " ");
  }
  d.moneda = detectarMoneda(texto);
  // Quitar palabras de moneda para no confundir el parseo de conceptos
  resto = resto.replace(/\b(bs|bolivares?|dolares?|usdt|cop|pesos?)\b/gi, " ").replace(/\$/g, " ");

  const trozos = resto.split(/[;\n]+/).map((t) => t.trim()).filter(Boolean);
  for (const t of trozos) {
    const limpio = t
      .replace(/^(recibo|crea|crear|haz|nuevo)\s+/i, "")
      .replace(/^[:\-–—,]+\s*/, "")
      .replace(/\s*[,;:]+$/, "")
      .trim();
    if (!limpio || /^(para|cliente|emisor|tel|telefono|email|correo|ciudad|vence|vencimiento)\b/i.test(limpio)) continue;
    let it = null;
    let mm = limpio.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*(.+?)\s+(?:a\s+)?(\d+(?:[.,]\d+)?)$/i);
    if (mm) {
      it = {
        descripcion: mm[2].trim(),
        cantidad: Number(mm[1].replace(",", ".")),
        precio: extraerMonto(mm[3]),
      };
    } else {
      mm = limpio.match(/^(.+?)\s+(?:a\s+)?(\d+(?:[.,]\d+)?)$/);
      if (mm && !/^(el|la|de|en|con|por|para)$/i.test(mm[1].trim())) {
        it = { descripcion: mm[1].trim(), cantidad: 1, precio: extraerMonto(mm[2]) };
      } else if (limpio.length >= 3) {
        it = { descripcion: limpio, cantidad: 1, precio: null };
      }
    }
    if (it && it.descripcion) d.items.push(it);
  }
  return d;
}

function faltantesCrear(d) {
  const f = [];
  if (!d.cliente) f.push("el cliente (¿para quién es? ej. «para Ana Pérez»)");
  if (!d.items.length) f.push("al menos un concepto con su precio (ej. «reparación laptop 150»)");
  else {
    const sinPrecio = d.items.filter((it) => !(it.precio > 0)).map((it) => it.descripcion);
    if (sinPrecio.length) f.push(`el precio de: ${sinPrecio.join(", ")}`);
  }
  if (!d.emisor?.nombre) f.push("tu nombre o negocio como emisor (ej. «emisor: Mi Negocio»)");
  return f;
}

/** Réplica de computeTotals para el borrador (descuento % global + impuesto %). */
function calcularTotal(items, descuentoPct, impuestoPct) {
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sub = r2(items.reduce((a, it) => a + (it.cantidad || 0) * (it.precio || 0), 0));
  const desc = r2((sub * (Number(descuentoPct) || 0)) / 100);
  const base = r2(sub - desc);
  const imp = r2((base * (Number(impuestoPct) || 0)) / 100);
  return r2(base + imp);
}

function detectarMetodo(texto) {
  const n = norm(texto);
  if (/\bpago movil\b/.test(n)) return "mobile";
  if (/\befectivo\b/.test(n)) return "cash";
  if (/\bcontado\b/.test(n)) return "cash";
  if (/\bzelle\b/.test(n)) return "zelle";
  if (/\btarjeta\b/.test(n)) return "card";
  if (/\btransfer/.test(n)) return "transfer";
  return "transfer";
}

// ── Resúmenes ────────────────────────────────────────────────────────────────
function lineasItems(items, moneda) {
  return items.map(
    (it) => `• ${it.cantidad} × ${it.descripcion} — ${fmtMoneda((it.cantidad || 0) * (it.precio || 0), moneda)}`
  );
}
function resumenCrear(d) {
  const moneda = d.moneda || "USD";
  const total = calcularTotal(d.items, d.descuento, d.impuesto);
  const l = [
    "🧾 Revisa el recibo antes de crearlo:",
    `Emisor: ${d.emisor.nombre}${d.emisor.detalle ? ` (${d.emisor.detalle})` : ""}`,
    `Cliente: ${d.cliente}`,
    `Moneda: ${moneda}`,
    ...lineasItems(d.items, moneda),
  ];
  if (d.clienteTelefono) l.push(`Teléfono: ${d.clienteTelefono}`);
  if (d.clienteEmail) l.push(`Correo: ${d.clienteEmail}`);
  if (d.clienteCiudad) l.push(`Ciudad: ${d.clienteCiudad}`);
  if (d.vencimiento) l.push(`Vencimiento: ${fmtFecha(d.vencimiento)}`);
  if (d.descuento > 0) l.push(`Descuento: ${d.descuento}%`);
  if (d.impuesto > 0) l.push(`Impuesto: ${d.impuesto}%`);
  if (d.garantiaDias > 0) l.push(`Garantía: ${d.garantiaDias} días`);
  if (d.cuotas?.length) l.push(`Cuotas: ${d.cuotas.map((c) => `${fmtMoneda(c.monto, moneda)} el ${fmtFecha(c.fecha)}`).join(", ")}`);
  if (d.notas) l.push(`Notas: ${d.notas}`);
  if (d.observaciones) l.push(`Observaciones: ${d.observaciones}`);
  l.push(`Total: ${fmtMoneda(total, moneda)}`, "", '¿Lo creo? Responde "sí" para confirmar.');
  return l.join("\n");
}

// ── PDF (compila lib/recibos con tsc, igual que whatsapp-comun.cargarLib) ────
let libPdf = null;
function cargarLibRecibos() {
  if (libPdf) return libPdf;
  const cacheDir = join(root, ".cache", "whatsapp-recibos-lib");
  const fuentes = [
    "recibos/tipos.ts", "recibos/calculos.ts", "recibos/formato.ts",
    "recibos/garantia.ts", "recibos/tasas.ts",
    "recibos/pdf/shared.ts", "recibos/pdf/logo.ts", "recibos/pdf/builder.ts",
    "recibos/pdf/synaptica.ts",
  ];
  const marcador = join(cacheDir, ".built-at");
  let recompilar = !existsSync(marcador);
  if (!recompilar) {
    const builtAt = statSync(marcador).mtimeMs;
    recompilar = fuentes.some((f) => statSync(join(root, "lib", f)).mtimeMs > builtAt);
  }
  if (recompilar) {
    mkdirSync(cacheDir, { recursive: true });
    try {
      execFileSync(join(root, "node_modules", ".bin", "tsc"), [
        ...fuentes.map((f) => join(root, "lib", f)),
        "--outDir", cacheDir,
        "--module", "commonjs",
        "--target", "es2020",
        "--moduleResolution", "node",
        "--skipLibCheck",
      ], { stdio: "pipe" });
      writeFileSync(marcador, String(Date.now()));
    } catch (e) {
      throw new Error(`tsc recibos: ${String(e.stderr || e.message).slice(0, 500)}`);
    }
  }
  const req = createRequire(join(cacheDir, "cargador.cjs"));
  // tsc aplana la salida (raíz común: lib/recibos) → pdf/builder.js
  libPdf = {
    builder: req(join(cacheDir, "pdf", "builder.js")),
    synaptica: req(join(cacheDir, "pdf", "synaptica.js")),
  };
  return libPdf;
}

function filaARecibo(fila) {
  const s = (fila.snapshot && typeof fila.snapshot === "object") ? fila.snapshot : {};
  const pagos = Array.isArray(s.pagos) ? s.pagos : [];
  const cuotas = Array.isArray(s.cuotas) ? s.cuotas : [];
  const garantiaDias = Math.max(0, Math.floor(Number(s.garantiaDias) || 0));
  return {
    meta: {
      number: fila.numero, issueDate: fila.fecha_emision, dueDate: fila.fecha_vencimiento || "",
      currency: fila.moneda, primaryMethod: "transfer",
      paymentMode: cuotas.length > 0 ? "installments" : fila.estado === "pagado" ? "full" : (fila.total_pagado > 0 ? "partial" : "full"),
      notes: typeof s.notas === "string" ? s.notas : "",
      observations: typeof s.observaciones === "string" ? s.observaciones : "",
      thankYouMessage: "¡Gracias por su preferencia!",
      warrantyDays: garantiaDias,
      warrantyEndDate: typeof s.garantiaFin === "string" ? s.garantiaFin : "",
    },
    issuer: {
      name: s.emisor?.nombre || "", taxId: s.emisor?.doc || "",
      phone: s.emisor?.telefono || "", email: s.emisor?.email || "",
      address: s.emisor?.direccion || "", cityCountry: "Venezuela",
    },
    client: {
      name: fila.cliente_nombre, taxId: "", phone: s.clienteTelefono || "",
      email: s.clienteEmail || "", address: "", company: "", city: s.clienteCiudad || "",
    },
    items: Array.isArray(s.items) ? s.items : [],
    payments: pagos.map((p) => ({
      id: p.id || randomUUID(), date: p.fecha || fila.fecha_emision,
      amount: Number(p.monto) || 0, method: p.metodo || "transfer",
      reference: p.referencia || "", note: p.nota || "",
      amountBs: Number(p.amountBs) || 0,
    })),
    scheduledPayments: cuotas.map((c, i) => ({
      id: c.id || `cuota-${i}`, date: c.date || c.fecha || "",
      amount: Number(c.amount ?? c.monto) || 0, note: c.note || "",
    })),
    globalDiscount: Number(s.descuentoGlobal ?? 0),
    taxRate: Number(s.impuesto ?? 0),
    declaredTotal: 0,
  };
}

async function tasaBsParaPdf(moneda) {
  if (process.env.HABITOS_MOCK) return null;
  if (moneda !== "USD" && moneda !== "USDT") return null;
  try {
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/fin_tasas?select=paralelo,usdt&order=fecha.desc&limit=1`,
      { headers: { apikey: cfg.ANON_KEY, Authorization: `Bearer ${cfg.ANON_KEY}` } }
    );
    if (!res.ok) return null;
    const filas = await res.json();
    const f = filas?.[0];
    const tasa = moneda === "USD" ? Number(f?.paralelo ?? 0) : Number(f?.usdt ?? 0);
    if (!(tasa > 0)) return null;
    return { etiqueta: moneda === "USD" ? "Paralelo" : "USDT", tasa };
  } catch {
    return null;
  }
}

function dataUrlLocal(rel) {
  try {
    const buf = readFileSync(join(root, "public", rel));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function generarPdf(fila) {
  const { synaptica } = cargarLibRecibos();
  const recibo = filaARecibo(fila);
  const bsRate = await tasaBsParaPdf(fila.moneda);
  const doc = synaptica.buildSynapticaPdf(recibo, {
    bsRate,
    anulado: fila.estado === "anulado",
    logoDataUrl: dataUrlLocal("synaptica/logo.png"),
    firmaDataUrl: dataUrlLocal("synaptica/firma-luigi.png"),
  });
  const buf = Buffer.from(doc.output("arraybuffer"));
  const limpio = String(fila.cliente_nombre || "cliente")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cliente";
  return {
    base64: buf.toString("base64"),
    nombre: `synaptica-recibo-${fila.numero}-${limpio}.pdf`,
    bytes: buf.length,
  };
}

// ── Principal ────────────────────────────────────────────────────────────────
const nq = norm(q);

try {
  // ── ayuda ──
  if (/^ayuda$/.test(nq)) {
    out({
      ok: true, codigo: "ayuda",
      mensaje: [
        "Recibos por WhatsApp:",
        "• «recibo para Ana: reparación laptop 150; cargador 25» → arma el borrador",
        "• Opcionales: «emisor: Mi Negocio; tel: 0412-1112233; email: ana@x.com; ciudad: Caracas; vence: 15/10/2026»",
        "• «garantía: 30 días; cuotas: 50 15/10, 50 15/11; observaciones: incluye instalación» → garantía, cuotas y observaciones",
        "• «recibo listar» → últimos recibos · «recibo ver Ana» → detalle",
        "• «recibo pdf Ana» → te mando el PDF",
        "• «recibo abonar 100 al SEN-202609-001» → registra un pago",
        "• «recibo borrar SEN-202609-001» → borra un recibo definitivamente",
        "• «recibo duplicar SEN-202609-001» → lo copia como nuevo",
        "• «recibo emisor» → ver los datos del emisor que salen en el PDF",
        "• «recibo cancelar» → descarta el borrador",
        "Nada se crea sin tu «sí» después del resumen.",
      ].join("\n"),
    });
  }

  // ── emisor: ver perfil ──
  if (/^emisor$/.test(nq)) {
    out({
      ok: true, codigo: "emisor",
      mensaje: [
        "Perfil del emisor (sale en el PDF):",
        `• Nombre: ${perfilEmisor.nombre || "—"}`,
        `• RIF/doc: ${perfilEmisor.doc || "—"}`,
        `• Teléfono: ${perfilEmisor.telefono || "—"}`,
        `• Email: ${perfilEmisor.email || "—"}`,
        `• Dirección: ${perfilEmisor.direccion || "—"}`,
        "Si quieres cambiar algo, dímelo y lo actualizo.",
      ].join("\n"),
    });
  }

  // ── confirmar lo pendiente ──
  const esConfirmacion = args.confirmar || /^(si|confirmo|confirmar|dale|crealo|ok|de una|hazlo|va)$/.test(nq);
  if (esConfirmacion) {
    if (!miDraft || miDraft.fase !== "resumen") {
      out({ ok: false, codigo: "sin-pendiente", detalle: "No hay nada pendiente de confirmación." });
    }
    if (miDraft.fase === "ejecutando") {
      out({ ok: false, codigo: "en-curso", detalle: "Ya se está procesando, dame un momento." });
    }
    miDraft.fase = "ejecutando";
    guardarDraft(miDraft);
    try {
      if (miDraft.tipo === "crear") {
        const d = miDraft.borrador;
        const moneda = d.moneda || "USD";
        const items = d.items.map((it) => ({
          id: randomUUID(), description: it.descripcion,
          quantity: it.cantidad, unitPrice: it.precio, discount: 0,
        }));
        const total = calcularTotal(d.items, d.descuento, d.impuesto);
        const fechaEmision = hoyCaracas();
        const garantiaDias = Math.max(0, Math.floor(Number(d.garantiaDias) || 0));
        const snapshot = {
          emisor: {
            nombre: d.emisor.nombre,
            doc: perfilEmisor.doc || "",
            telefono: perfilEmisor.telefono || "",
            email: perfilEmisor.email || "",
            direccion: perfilEmisor.direccion || "",
          },
          clienteTelefono: d.clienteTelefono || "",
          clienteEmail: d.clienteEmail || "",
          clienteCiudad: d.clienteCiudad || "",
          items,
          pagos: [],
          descuentoGlobal: d.descuento || 0,
          impuesto: d.impuesto || 0,
          notas: d.notas || "",
          garantiaDias,
          garantiaFin: garantiaDias > 0 ? sumarDias(fechaEmision, garantiaDias) : "",
          cuotas: (d.cuotas || [])
            .filter((c) => c.monto > 0 && c.fecha)
            .map((c, i) => ({ id: `cuota-${i}`, date: c.fecha, amount: c.monto })),
          observaciones: d.observaciones || "",
        };
        const r = await rpc("rpc_recibo_crear", {
          p_user_id: cfg.USER_ID,
          p_moneda: moneda,
          p_cliente_nombre: d.cliente,
          p_snapshot: snapshot,
          p_total: total,
          p_fecha_emision: hoyCaracas(),
          p_fecha_vencimiento: d.vencimiento || null,
          p_hogar_id: null,
        });
        recordarEmisor(d.emisor);
        guardarDraft(null);
        out({
          ok: true, codigo: "creado", id: r.id, numero: r.numero,
          mensaje: `Recibo ${r.numero} creado para ${d.cliente} por ${fmtMoneda(total, moneda)}. Pídelo con «recibo pdf ${r.numero}».`,
        });
      }
      if (miDraft.tipo === "abonar") {
        const r = await rpc("rpc_recibo_abonar", {
          p_user_id: cfg.USER_ID,
          p_recibo_id: miDraft.recibo.id,
          p_monto: miDraft.abono.monto,
          p_fecha: hoyCaracas(),
          p_metodo: miDraft.abono.metodo,
          p_referencia: null,
          p_nota: miDraft.abono.nota || null,
        });
        guardarDraft(null);
        out({
          ok: true, codigo: "abonado",
          mensaje: `Abono de ${fmtMoneda(miDraft.abono.monto, miDraft.recibo.moneda)} registrado en ${miDraft.recibo.numero}. Saldo: ${fmtMoneda(r.saldo, miDraft.recibo.moneda)} (${r.estado}).`,
        });
      }
      if (miDraft.tipo === "borrar") {
        await rpc("rpc_recibo_borrar", { p_user_id: cfg.USER_ID, p_recibo_id: miDraft.recibo.id });
        guardarDraft(null);
        out({
          ok: true, codigo: "borrado",
          mensaje: `Recibo ${miDraft.recibo.numero} borrado definitivamente.`,
        });
      }
      if (miDraft.tipo === "duplicar") {
        const r = await rpc("rpc_recibo_duplicar", {
          p_user_id: cfg.USER_ID, p_recibo_id: miDraft.recibo.id,
        });
        guardarDraft(null);
        out({
          ok: true, codigo: "duplicado", id: r.id, numero: r.numero,
          mensaje: `Recibo duplicado: ${r.numero} (copia de ${miDraft.recibo.numero}).`,
        });
      }
      guardarDraft(null);
      out({ ok: false, codigo: "tipo-desconocido", detalle: "Borrador en estado inesperado, lo descarté." });
    } catch (e) {
      guardarDraft(null);
      throw e;
    }
  }

  // ── cancelar ──
  if (/^(cancelar|cancela|olvida|olvídalo|descarta|no)$/.test(nq)) {
    if (miDraft) {
      guardarDraft(null);
      out({ ok: true, codigo: "cancelado", mensaje: "Borrador descartado." });
    }
    out({ ok: false, codigo: "sin-pendiente", detalle: "No había ningún borrador activo." });
  }

  // ── listar ──
  {
    const m = nq.match(/^(lista|listar|ultimos|historial)(?:\s+(.+))?$/);
    if (m) {
      const busqueda = (m[2] || "").trim() || null;
      const filas = await rpc("rpc_recibo_listar", {
        p_user_id: cfg.USER_ID, p_limite: 10, p_busqueda: busqueda,
      });
      if (!filas.length) {
        out({ ok: true, codigo: "listar", recibos: [], mensaje: "Aún no tienes recibos." });
      }
      const lineas = filas.map(
        (r) => `• ${r.numero} · ${r.cliente_nombre} · ${fmtMoneda(r.total, r.moneda)} · saldo ${fmtMoneda(r.saldo, r.moneda)} · ${ESTADO_LABEL[r.estado] || r.estado}`
      );
      out({
        ok: true, codigo: "listar", recibos: filas,
        mensaje: `Recibos${busqueda ? ` («${busqueda}»)` : ""}:\n${lineas.join("\n")}`,
      });
    }
  }

  // ── ver ──
  {
    const m = q.match(/^ver\s+(.+)$/i);
    if (m) {
      let fila;
      try {
        fila = await rpc("rpc_recibo_ver", { p_user_id: cfg.USER_ID, p_busqueda: m[1].trim() });
      } catch (e) {
        if (String(e.message).includes("recibo_no_encontrado")) {
          out({ ok: false, codigo: "no-encontrado", detalle: `No encontré ningún recibo con «${m[1].trim()}».` });
        }
        throw e;
      }
      const s = fila.snapshot || {};
      const items = Array.isArray(s.items) ? s.items : [];
      const l = [
        `🧾 ${fila.numero} · ${ESTADO_LABEL[fila.estado] || fila.estado}`,
        `Cliente: ${fila.cliente_nombre}`,
        `Fecha: ${fmtFecha(fila.fecha_emision)} · Moneda: ${fila.moneda}`,
        ...items.map((it) => `• ${it.quantity} × ${it.description} — ${fmtMoneda((it.quantity || 0) * (it.unitPrice || 0), fila.moneda)}`),
        `Total: ${fmtMoneda(fila.total, fila.moneda)} · Pagado: ${fmtMoneda(fila.total_pagado, fila.moneda)} · Saldo: ${fmtMoneda(fila.saldo, fila.moneda)}`,
      ];
      if (fila.estado === "anulado") l.push("Este recibo está anulado.");
      out({ ok: true, codigo: "ver", recibo: fila, mensaje: l.join("\n") });
    }
  }

  // ── pdf ──
  {
    const m = q.match(/^pdf\s+(.+)$/i);
    if (m) {
      let fila;
      try {
        fila = await rpc("rpc_recibo_ver", { p_user_id: cfg.USER_ID, p_busqueda: m[1].trim() });
      } catch (e) {
        if (String(e.message).includes("recibo_no_encontrado")) {
          out({ ok: false, codigo: "no-encontrado", detalle: `No encontré ningún recibo con «${m[1].trim()}».` });
        }
        throw e;
      }
      const pdf = await generarPdf(fila);
      out({
        ok: true, codigo: "pdf", numero: fila.numero,
        pdf_base64: pdf.base64, nombre_archivo: pdf.nombre,
        mensaje: `PDF del recibo ${fila.numero} (${Math.round(pdf.bytes / 1024)} KB).`,
      });
    }
  }

  // ── duplicar (borrador → resumen → sí) ──
  {
    const m = q.match(/^(duplicar|copiar)\s+(.+)$/i);
    if (m) {
      let fila;
      try {
        fila = await rpc("rpc_recibo_ver", { p_user_id: cfg.USER_ID, p_busqueda: m[2].trim() });
      } catch (e) {
        if (String(e.message).includes("recibo_no_encontrado")) {
          out({ ok: false, codigo: "no-encontrado", detalle: `No encontré ningún recibo con «${m[2].trim()}».` });
        }
        throw e;
      }
      const draft = {
        tipo: "duplicar", fase: "resumen",
        recibo: { id: fila.id, numero: fila.numero, cliente_nombre: fila.cliente_nombre, total: Number(fila.total), moneda: fila.moneda },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          `Duplicar el recibo ${fila.numero}:`,
          `Cliente: ${fila.cliente_nombre} · Total: ${fmtMoneda(fila.total, fila.moneda)}`,
          "Se crea como un recibo nuevo (número nuevo, pagos en cero).",
          "",
          '¿Lo duplico? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  // ── borrar (borrador → resumen → sí) ──
  {
    const m = q.match(/^(borrar|eliminar)\s+(.+)$/i);
    if (m) {
      let fila;
      try {
        fila = await rpc("rpc_recibo_ver", { p_user_id: cfg.USER_ID, p_busqueda: m[2].trim() });
      } catch (e) {
        if (String(e.message).includes("recibo_no_encontrado")) {
          out({ ok: false, codigo: "no-encontrado", detalle: `No encontré ningún recibo con «${m[2].trim()}».` });
        }
        throw e;
      }
      const draft = {
        tipo: "borrar", fase: "resumen",
        recibo: { id: fila.id, numero: fila.numero, cliente_nombre: fila.cliente_nombre, total: Number(fila.total), moneda: fila.moneda },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          `Borrar el recibo ${fila.numero}:`,
          `Cliente: ${fila.cliente_nombre} · Total: ${fmtMoneda(fila.total, fila.moneda)} · Saldo: ${fmtMoneda(fila.saldo, fila.moneda)}`,
          "El recibo se elimina definitivamente del historial.",
          "",
          '¿Lo borro? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  // ── abonar (borrador → resumen → sí) ──
  {
    const m = nq.match(/^(abonar|abono|pago|registrar pago)\b([\s\S]*)$/);
    if (m) {
      const restoAbono = (m[2] || "").trim();
      const monto = extraerMonto(q);
      if (monto === null) {
        out({ ok: false, codigo: "pregunta", pregunta: "¿Cuánto quieres abonar? Ej. «abonar 100 al SEN-202609-001».", detalle: "falta el monto" });
      }
      let busqueda = restoAbono
        .replace(montoRaw(q) || "", " ")
        .replace(/\b(bs|bolivares?|dolares?|usdt|cop|pesos?)\b/gi, " ")
        .replace(/\$/g, " ")
        .replace(/\b(al|del|el|la|recibo)\b/gi, " ")
        .replace(/\s+/g, " ").trim();
      const numMatch = q.match(/SEN-\d{6}-\d{3}/i);
      if (numMatch) busqueda = numMatch[0];
      let fila = null;
      if (busqueda) {
        try {
          fila = await rpc("rpc_recibo_ver", { p_user_id: cfg.USER_ID, p_busqueda: busqueda });
        } catch (e) {
          if (!String(e.message).includes("recibo_no_encontrado")) throw e;
        }
      }
      if (!fila) {
        const pendientes = await rpc("rpc_recibo_listar", { p_user_id: cfg.USER_ID, p_limite: 5, p_busqueda: null });
        const abiertos = pendientes.filter((r) => r.estado !== "pagado" && r.estado !== "anulado");
        if (!abiertos.length) {
          out({ ok: false, codigo: "sin-pendientes", detalle: "No tienes recibos con saldo pendiente." });
        }
        const lineas = abiertos.map((r) => `• ${r.numero} · ${r.cliente_nombre} · saldo ${fmtMoneda(r.saldo, r.moneda)}`);
        out({
          ok: false, codigo: "pregunta",
          pregunta: `¿A qué recibo abono ${fmtNum(monto)}?\n${lineas.join("\n")}\nResponde con el número, ej. «abonar ${fmtNum(monto)} al ${abiertos[0].numero}».`,
          opciones: abiertos.map((r) => r.numero),
          detalle: "no se identificó el recibo",
        });
      }
      if (fila.estado === "anulado") {
        out({ ok: false, codigo: "ya-anulado", detalle: `El recibo ${fila.numero} está anulado, no admite abonos.` });
      }
      if (fila.estado === "pagado" || Number(fila.saldo) <= 0) {
        out({ ok: false, codigo: "sin-saldo", detalle: `El recibo ${fila.numero} ya está pagado.` });
      }
      if (monto > Number(fila.saldo)) {
        out({
          ok: false, codigo: "sobrepago",
          detalle: `El abono de ${fmtMoneda(monto, fila.moneda)} supera el saldo de ${fmtMoneda(fila.saldo, fila.moneda)} del recibo ${fila.numero}.`,
        });
      }
      const metodo = detectarMetodo(q);
      const draft = {
        tipo: "abonar", fase: "resumen",
        recibo: { id: fila.id, numero: fila.numero, cliente_nombre: fila.cliente_nombre, total: Number(fila.total), saldo: Number(fila.saldo), moneda: fila.moneda },
        abono: { monto, metodo, nota: "" },
        actualizado: new Date().toISOString(),
      };
      guardarDraft(draft);
      const nuevoSaldo = Number(fila.saldo) - monto;
      out({
        ok: false, codigo: "resumen", espera_confirmacion: true,
        resumen: [
          `Registrar abono en ${fila.numero}:`,
          `Monto: ${fmtMoneda(monto, fila.moneda)}`,
          `Saldo actual: ${fmtMoneda(fila.saldo, fila.moneda)} → nuevo saldo: ${fmtMoneda(nuevoSaldo, fila.moneda)}`,
          "",
          '¿Lo registro? Responde "sí" para confirmar.',
        ].join("\n"),
      });
    }
  }

  // ── crear / continuar borrador ──
  const parseado = parseCrear(q);
  if (miDraft && miDraft.tipo === "crear" && miDraft.fase === "completar") {
    // Continuación conversacional: fusiona lo nuevo en el borrador.
    const d = miDraft.borrador;
    if (parseado.cliente && !d.cliente) d.cliente = parseado.cliente;
    if (parseado.emisor?.nombre && !d.emisor?.nombre) d.emisor = parseado.emisor;
    if (parseado.moneda && !d.moneda) d.moneda = parseado.moneda;
    for (const it of parseado.items) {
      const sinPrecio = d.items.find((x) => !(x.precio > 0) && norm(x.descripcion) === norm(it.descripcion));
      if (sinPrecio && it.precio > 0) {
        sinPrecio.precio = it.precio;
        sinPrecio.cantidad = it.cantidad || sinPrecio.cantidad;
      } else if (it.precio > 0 || it.descripcion.length >= 3) {
        const duplicado = d.items.some(
          (x) => norm(x.descripcion) === norm(it.descripcion) && (x.precio || 0) === (it.precio || 0) && (x.cantidad || 0) === (it.cantidad || 0)
        );
        if (!duplicado) d.items.push(it);
      }
    }
    if (parseado.notas && !d.notas) d.notas = parseado.notas;
    if (parseado.descuento > 0) d.descuento = parseado.descuento;
    if (parseado.impuesto > 0) d.impuesto = parseado.impuesto;
    if (parseado.garantiaDias > 0 && !(d.garantiaDias > 0)) d.garantiaDias = parseado.garantiaDias;
    if (parseado.cuotas?.length && !(d.cuotas?.length)) d.cuotas = parseado.cuotas;
    if (parseado.observaciones && !d.observaciones) d.observaciones = parseado.observaciones;
    miDraft.borrador = d;
  } else {
    if (ultimoEmisor && !parseado.emisor) parseado.emisor = { ...ultimoEmisor };
    miDraft = {
      tipo: "crear", fase: "completar", borrador: parseado,
      actualizado: new Date().toISOString(),
    };
  }

  const d = miDraft.borrador;
  const falt = faltantesCrear(d);
  guardarDraft(miDraft);
  if (falt.length) {
    const ejemplo = "Ej.: «recibo para Ana Pérez: reparación laptop 150; cargador 25»";
    out({
      ok: false, codigo: "pregunta",
      pregunta: `Para armar el recibo me falta:\n${falt.map((f) => `• ${f}`).join("\n")}\n${ejemplo}`,
      detalle: `faltan datos: ${falt.join("; ")}`,
    });
  }
  miDraft.fase = "resumen";
  guardarDraft(miDraft);
  out({ ok: false, codigo: "resumen", espera_confirmacion: true, resumen: resumenCrear(d) });
} catch (e) {
  const msg = String(e.message || e);
  const codigo =
    msg.includes("no_autorizado") ? "no_autorizado" :
    msg.includes("sobrepago") ? "sobrepago" :
    msg.includes("recibo_anulado") ? "ya-anulado" :
    msg.includes("moneda_invalida") ? "moneda_invalida" :
    "error";
  out({ ok: false, codigo, detalle: msg.slice(0, 300) });
}
