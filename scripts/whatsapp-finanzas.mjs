#!/usr/bin/env node
// Módulo Finanzas por WhatsApp (Fase 1).
//
//   node scripts/whatsapp-finanzas.mjs --q "<texto sin el prefijo>"
//
// Contrato: siempre JSON a stdout. El agente responde SOLO desde el JSON:
//   ok:true            → confirmar con los datos devueltos
//   ok:false + ambiguo → preguntar (el campo `pregunta` trae el texto)
//   ok:false           → decir lo que indica `detalle`
//
// Intenciones:
//   "gasté 5 en pan" / "gasto 20000 bs en mercado"   → registrar egreso
//   "ingreso 500 salario" / "me pagaron 300"          → registrar ingreso
//   "transferí 100 de efectivo a bolívares"           → transferencia
//   "saldo" / "cuánto tengo"                         → saldos por cuenta
//   "movimientos" / "qué gasté"                       → recientes
//   "anula el último"                                → anula el último movimiento
//   "ayuda"                                          → comandos
//
// Reglas: nunca se confirma sin ejecutar el RPC; la ambigüedad (cuenta o
// moneda) se pregunta, no se adivina. El secreto viaja en el header
// `x-fin-rpc-secret` (el mismo valor que el de hábitos).

import { randomBytes } from "node:crypto";
import { writeSync } from "node:fs";
import { cargarConfig, norm } from "./whatsapp-comun.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
    args[k] = v;
  }
}
// writeSync en vez de console.log+exit: evita truncar salidas grandes por pipe.
const out = (obj) => { writeSync(1, JSON.stringify(obj) + "\n"); process.exit(obj.ok ? 0 : 1); };
const q = String(args.q ?? "").trim();
if (!q) out({ ok: false, codigo: "args", detalle: "se requiere --q \"<texto>\"" });

const CATEGORIAS_EGRESO = ["comida", "mercado", "transporte", "servicios", "vivienda", "salud", "ocio", "ropa", "otros"];
const CATEGORIAS_INGRESO = ["salario", "ventas", "otros"];

// Mejora 1 (plan 2026-10-01): sugerencia de categoría por palabra clave cuando el
// usuario no la dice explícita. La mención literal mantiene prioridad (ver detectarCategoria).
// OJO: norm() quita acentos, las claves van sin tilde.
const CATEGORIA_KEYWORDS = [
  ["mercado", ["mercado", "queso", "huevo", "verdura", "mayonesa", "atun", "pasta", "aceite", "arroz", "harina", "pan", "leche", "cafe", "azucar", "carne", "pollo", "pescado", "mantequilla", "toddy", "botellon", "agua", "bodega", "tomate", "cebolla", "papa", "platano", "arepa", "empanada", "refresco", "jugo", "galleta", "chocolate", "sal", "salsa", "compra", "mercado"]],
  ["servicios", ["comision", "mantenimiento", "banca movil", "internet", "luz", "electricidad", "telefono", "condominio", "aseo", "cantv", "movistar", "digitel"]],
  ["transporte", ["ridery", "taxi", "pasaje", "gasolina", "transporte", "bus", "moto", "yummy"]],
  ["salud", ["farmacia", "medico", "medicina", "clinica", "doctor", "salud"]],
  ["vivienda", ["alquiler", "arriendo", "vivienda"]],
  ["ocio", ["cine", "fiesta", "ocio"]],
  ["ropa", ["ropa", "zapato", "camisa", "pantalon", "franela"]],
  ["mascotas", ["mascota", "gato", "gata", "gatarina", "miringo", "aserrin", "perro", "arena"]],
  ["herramientas", ["herramienta", "freebuff", "canva", "figma", "notion", "suscripcion", "mensualidad", "licencia", "software", "app"]],
  ["préstamo", ["prestamo", "prestamos"]],
  ["devolución", ["devolucion", "devoluciones"]],
  ["pago deudas", ["deuda", "deudas"]],
];
const CATEGORIA_INGRESO_KEYWORDS = [
  ["salario", ["salario", "sueldo", "quincena"]],
  ["ventas", ["venta", "mercadolibre", "p2p"]],
  ["préstamo", ["prestamo", "prestamos"]],
  ["devolución", ["devolucion", "devoluciones"]],
  ["pago deudas", ["deuda", "deudas"]],
];

/** Parsea un monto suelto en formato es-VE (1.234,56) o simple. Devuelve number o null. */
function parseMontoEsVe(s) {
  if (!s) return null;
  let t = String(s).trim();
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ── RPC con el header de finanzas (+ mock) ───────────────────────────────────
function crearRpcFin(cfg) {
  return async function rpc(fn, params) {
    if (process.env.HABITOS_MOCK) {
      if (fn === "rpc_fin_saldos") return [
        { id: "c1", nombre: "Efectivo", moneda: "USD", tipo: "efectivo", saldo_moneda: "120.50", saldo_usd: "120.50", n_movimientos: 3 },
        { id: "c2", nombre: "Bolívares", moneda: "VES", tipo: "efectivo", saldo_moneda: "4500.00", saldo_usd: "4.73", n_movimientos: 1 },
      ];
      if (fn === "rpc_fin_recientes") return [
        { id: "m1", tipo: "egreso", categoria: "comida", monto: "5.00", nota: "pan", fecha: "2026-09-28", cuenta: "Efectivo", moneda: "USD", destino: null, monto_destino: null },
      ];
      if (fn === "rpc_fin_registrar") {
        const esTransf = params.p_tipo === "transferencia";
        return {
          ok: true, id: "mock-id", tipo: params.p_tipo, monto: params.p_monto,
          moneda: "USD", cuenta: "Efectivo", categoria: params.p_categoria,
          destino: esTransf ? "Bolívares" : null,
          monto_destino: esTransf ? params.p_monto : null,
          moneda_destino: esTransf ? "VES" : null,
          usd_equivalente: params.p_monto,
        };
      }
      if (fn === "rpc_fin_anular") return { ok: true, id: params.p_movimiento_id };
      if (fn === "rpc_fin_cuenta_umbral") return { ok: true, cuenta: "BDV", umbral_bajo: params.p_umbral };
      if (fn === "rpc_fin_alertas_saldo") return [];
      if (fn === "rpc_fin_presupuestos") return [];
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

// ── Parseo ───────────────────────────────────────────────────────────────────
/** Monto: acepta 1.234,56 (es-VE), 1,234.56 y 1234.56. Devuelve number o null. */
function extraerMonto(texto) {
  const m = texto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1];
  if (s.includes(",") && s.includes(".")) {
    // es-VE: puntos de miles, coma decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

function detectarMoneda(texto) {
  const n = norm(texto);
  // (?:\b|\d): la unidad puede ir pegada al monto ("3.07usdt" -> norm "3 07usdt").
  if (/(?:\b|\d)(usdt|tether)\b/.test(n)) return "USDT";
  if (/(?:\b|\d)(bs|bolivares?|ves)\b/.test(n)) return "VES";
  if (/\bpago.?movil\b/.test(n)) return "VES"; // el pago móvil siempre es en Bs
  if (/(?:\b|\d)(cop|pesos?)\b/.test(n)) return "COP";
  if (/\$|(?:\b|\d)(usd|dolar(es)?|bucks?)\b/.test(n)) return "USD";
  return null;
}

function detectarTipo(texto) {
  const n = norm(texto);
  if (/\btransf/i.test(n)) return "transferencia";
  if (/\b(pasa|mueve|movi)\b/.test(n)) return "transferencia";
  if (/\b(ingreso|me pagaron|recibi|cobre|salario|ventas?|gane)\b/.test(n)) return "ingreso";
  return "egreso";
}

function detectarCategoria(texto, tipo) {
  const n = ` ${norm(texto)} `;
  // Guardrail (2026-10-10, luigi): "favor" o "traspaso" → categoría "traspaso".
  // Dinero que pasa por la cuenta pero no es gasto/ingreso real (ej. favor mamá
  // Bs 141.330 que entró y salió el mismo día). El coach excluye "traspaso"
  // de los totales para no inflar estadísticas.
  if (/\b(favor|traspaso)\b/.test(n)) return "traspaso";
  // Guardrail (2026-10-10, luigi): P2P es traspaso. "compra p2p" matcheaba
  // "compra" → "mercado" y "venta p2p" matcheaba "p2p" → "ventas", inflando
  // estadísticas (ej. gasto en mercado +2.275.728% por Bs 242.000 en P2P del
  // 07/10). Las conversiones P2P (Bs↔USDT) no son gasto/ingreso real: van a
  // "traspaso" y el coach las excluye. Si es una venta real, luigi la
  // recategoriza manual.
  if (/\bp2p\b/.test(n)) return "traspaso";
  const lista = tipo === "ingreso" ? CATEGORIAS_INGRESO : CATEGORIAS_EGRESO;
  for (const c of lista) {
    if (n.includes(` ${c} `)) return c;
  }
  // Mejora 1: fallback por palabra clave (sin tilde, plural opcional s/es).
  const mapa = tipo === "ingreso" ? CATEGORIA_INGRESO_KEYWORDS : CATEGORIA_KEYWORDS;
  for (const [cat, kws] of mapa) {
    for (const kw of kws) {
      if (new RegExp(`\\b${kw}(s|es)?\\b`).test(n)) return cat;
    }
  }
  return null;
}

/** Match difuso de cuenta por nombre mencionado en el texto. */
function matchCuenta(cuentas, texto) {
  const n = norm(texto);
  const scored = cuentas.map((c) => {
    const nc = norm(c.nombre);
    let score = 0;
    if (nc && new RegExp(`\\b${nc.replace(/ /g, "\\s+")}\\b`).test(n)) score = 100;
    else {
      const toks = nc.split(" ").filter((t) => t.length > 2);
      const inter = toks.filter((t) => n.includes(t));
      if (inter.length > 0) score = 40 + 10 * inter.length;
    }
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored;
}

/** Quita del texto las partes ya interpretadas para dejar la nota. */
function restoNota(texto, montoRaw, nombreCuenta) {
  let s = ` ${norm(texto)} `;
  if (montoRaw) s = s.replace(norm(montoRaw), " ");
  if (nombreCuenta) {
    const nc = norm(nombreCuenta).replace(/ /g, "\\s+");
    s = s.replace(new RegExp(`\\b${nc}\\b`, "g"), " ");
  }
  s = s.replace(/\b(gaste|gasto|compre|pague|ingreso|transferi|transf|pasa|mueve|de|en|el|la|los|las|un|una|a|por|con|cuenta|finanzas|fin)\b/g, " ");
  s = s.replace(/\b(bs|bolivares?|dolares?|usdt|cop|pesos?)\b/g, " ");
  s = s.replace(/\$/g, " ");
  s = s.replace(/\d[.,\d]*/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length >= 3 ? s.slice(0, 140) : null;
}

const fmtUsd = (n) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
const fmtMoneda = (monto, moneda) => {
  const s = moneda === "VES" ? "Bs" : moneda === "COP" ? "COP" : "$";
  const t = fmtUsd(monto);
  return moneda === "USDT" ? `${t} USDT` : `${s} ${t}`;
};

// ── Principal ────────────────────────────────────────────────────────────────
let cfg;
try {
  cfg = cargarConfig(args);
} catch (e) {
  out({ ok: false, codigo: "config", detalle: String(e.message || e) });
}
const rpc = crearRpcFin(cfg);
const nq = norm(q);

try {
  // ── ayuda ──
  if (/^ayuda$/.test(nq)) {
    out({
      ok: true, codigo: "ayuda", modulo: "finanzas",
      mensaje: "Finanzas por WhatsApp:\n• gasté 5 en pan → registra un gasto\n• ingreso 500 salario → registra un ingreso\n• transferí 100 de efectivo a bolívares\n• saldo → saldos por cuenta\n• movimientos → últimos movimientos\n• anula el último → anula el último movimiento\n• conciliar bdv → compara libros contra el banco\n• alerta bdv 2000 → avisa si BDV baja de Bs 2.000",
    });
  }

  // ── saldos ──
  if (/^(saldo|saldos|balance|cuanto tengo|disponible|plata)\b/.test(nq)) {
    const saldos = await rpc("rpc_fin_saldos", { p_user_id: cfg.USER_ID });
    if (!saldos.length) {
      out({ ok: true, codigo: "saldos", cuentas: [], mensaje: "Aún no tienes cuentas. Crea una en la app (Finanzas → Nueva cuenta)." });
    }
    const lineas = saldos.map((c) => `• ${c.nombre} (${c.moneda}): ${fmtMoneda(c.saldo_moneda, c.moneda)} ≈ $${fmtUsd(c.saldo_usd)}`);
    const total = saldos.reduce((a, c) => a + Number(c.saldo_usd), 0);
    // Mejora 4: avisar cuentas bajo su umbral.
    let avisoUmbral = "";
    try {
      const bajas = await rpc("rpc_fin_alertas_saldo", { p_user_id: cfg.USER_ID });
      if (bajas.length) {
        avisoUmbral = "\n⚠️ Bajo el umbral: " + bajas.map((b) => `${b.nombre} (${fmtMoneda(b.saldo_moneda, b.moneda)} < ${fmtMoneda(b.umbral_bajo, b.moneda)})`).join(", ");
      }
    } catch { /* sin umbrales configurados o RPC no disponible: se omite */ }
    out({
      ok: true, codigo: "saldos", cuentas: saldos,
      mensaje: `Saldos:\n${lineas.join("\n")}\nPatrimonio: $${fmtUsd(total)}${avisoUmbral}`,
    });
  }

  // ── recientes ──
  if (/^(movimientos|ultimos|historial|que gaste|gastos|egresos|ingresos)\b/.test(nq)) {
    const movs = await rpc("rpc_fin_recientes", { p_user_id: cfg.USER_ID, p_limite: 8 });
    if (!movs.length) out({ ok: true, codigo: "recientes", movimientos: [], mensaje: "Sin movimientos todavía." });
    const lineas = movs.map((m) => {
      const signo = m.tipo === "ingreso" ? "+" : m.tipo === "egreso" ? "−" : "→";
      const det = m.tipo === "transferencia" ? `${m.cuenta} → ${m.destino}` : `${m.categoria ?? "gasto"}${m.nota ? ` (${m.nota})` : ""}`;
      return `${signo} ${fmtMoneda(m.monto, m.moneda)} · ${det} · ${m.fecha}`;
    });
    out({ ok: true, codigo: "recientes", movimientos: movs, mensaje: `Últimos movimientos:\n${lineas.join("\n")}` });
  }

  // ── anular último ──
  if (/^anul(ar|a)\b/.test(nq)) {
    const movs = await rpc("rpc_fin_recientes", { p_user_id: cfg.USER_ID, p_limite: 1 });
    if (!movs.length) out({ ok: false, codigo: "sin-movimientos", detalle: "No hay movimientos para anular." });
    const m = movs[0];
    const r = await rpc("rpc_fin_anular", { p_user_id: cfg.USER_ID, p_movimiento_id: m.id });
    out({
      ok: true, codigo: "anulado", id: r.id,
      mensaje: `Anulado: ${fmtMoneda(m.monto, m.moneda)} · ${m.categoria ?? m.tipo} (${m.fecha}). El historial se conserva.`,
    });
  }

  // ── conciliar <cuenta> [monto banco] [ajustar] — mejora 3 (plan 2026-10-01) ──
  // OJO: se parsea sobre `q` crudo porque norm() elimina los puntos decimales.
  if (/^conciliar\b/.test(nq)) {
    let resto = q.replace(/^\s*conciliar\b/i, "").trim();
    const ajustar = /\bajustar\s*$/i.test(resto);
    if (ajustar) resto = resto.replace(/\bajustar\s*$/i, "").trim();
    const mNum = resto.match(/([\d.,]+)\s*$/);
    let montoBanco = null;
    if (mNum) {
      montoBanco = parseMontoEsVe(mNum[1]);
      resto = resto.slice(0, mNum.index).trim();
    }
    const saldos = await rpc("rpc_fin_saldos", { p_user_id: cfg.USER_ID });
    const cuentas = saldos.map((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda, saldo_moneda: c.saldo_moneda }));
    const cands = matchCuenta(cuentas, resto);
    let cuenta = null;
    if (cands.length === 1) cuenta = cands[0].c;
    else if (cands.length > 1) {
      out({ ok: false, codigo: "ambiguo", pregunta: `¿Qué cuenta concilio? ${cands.map((x) => x.c.nombre).join(", ")}.`, opciones: cands.map((x) => x.c.nombre), detalle: "varias cuentas coinciden" });
    } else {
      out({ ok: false, codigo: "sin-match", detalle: `No encontré la cuenta "${resto}". Di «finanzas conciliar <cuenta>».` });
    }
    const saldoLibros = Math.round(Number(cuenta.saldo_moneda) * 100) / 100;
    if (montoBanco === null) {
      out({
        ok: true, codigo: "conciliar_pregunta", cuenta: cuenta.nombre,
        saldo_libros: saldoLibros, moneda: cuenta.moneda,
        mensaje: `En libros, ${cuenta.nombre} tiene ${fmtMoneda(saldoLibros, cuenta.moneda)}. ¿Cuánto dice el banco? Responde «conciliar ${cuenta.nombre} <monto>».`,
      });
    }
    const dif = Math.round((montoBanco - saldoLibros) * 100) / 100;
    if (Math.abs(dif) < 0.01) {
      out({ ok: true, codigo: "conciliado", cuenta: cuenta.nombre, mensaje: `✅ ${cuenta.nombre} conciliado: libros ${fmtMoneda(saldoLibros, cuenta.moneda)} = banco ${fmtMoneda(montoBanco, cuenta.moneda)}.` });
    }
    if (!ajustar) {
      const dir = dif > 0 ? "el banco tiene de más" : "en libros hay de más";
      out({
        ok: true, codigo: "conciliar_diferencia", cuenta: cuenta.nombre,
        saldo_libros: saldoLibros, saldo_banco: montoBanco, diferencia: dif, moneda: cuenta.moneda,
        mensaje: `Diferencia en ${cuenta.nombre}: ${dir} ${fmtMoneda(Math.abs(dif), cuenta.moneda)} (libros ${fmtMoneda(saldoLibros, cuenta.moneda)} vs banco ${fmtMoneda(montoBanco, cuenta.moneda)}). Responde «conciliar ${cuenta.nombre} ${montoBanco} ajustar» para registrar el ajuste.`,
      });
    }
    const rAj = await rpc("rpc_fin_registrar", {
      p_user_id: cfg.USER_ID,
      p_tipo: dif > 0 ? "ingreso" : "egreso",
      p_monto: Math.abs(dif),
      p_cuenta: cuenta.id,
      p_categoria: null,
      p_nota: "ajuste conciliación",
      p_clave_evento: `wa-conc-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
    });
    out({
      ok: true, codigo: "ajuste_registrado", id: rAj.id, cuenta: cuenta.nombre,
      diferencia: dif, moneda: cuenta.moneda,
      mensaje: `Ajuste registrado en ${cuenta.nombre}: ${dif > 0 ? "+" : "−"}${fmtMoneda(Math.abs(dif), cuenta.moneda)} (ajuste conciliación). Ahora libros = banco.`,
    });
  }

  // ── alerta <cuenta> <monto> | alerta <cuenta> off — mejora 4 (plan 2026-10-01) ──
  // OJO: se parsea sobre `q` crudo porque norm() elimina los puntos decimales.
  if (/^alerta\b/.test(nq)) {
    let resto = q.replace(/^\s*alerta\b/i, "").trim();
    const off = /\b(off|quitar|ningun[oa])\s*$/i.test(resto);
    if (off) resto = resto.replace(/\b(off|quitar|ningun[oa])\s*$/i, "").trim();
    // El monto puede ir en cualquier posición ("alerta binance 10 usdt").
    const mNum = resto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    let umbral = null;
    if (mNum && !off) {
      umbral = parseMontoEsVe(mNum[1]);
      resto = (resto.slice(0, mNum.index) + " " + resto.slice(mNum.index + mNum[0].length)).replace(/\s+/g, " ").trim();
    }
    // Quitar menciones de moneda del nombre de la cuenta.
    resto = resto.replace(/\b(bs|bolivares?|ves|dolares?|usd|usdt|tether|cop|pesos?)\b/gi, " ").replace(/\$/g, " ").replace(/\s+/g, " ").trim();
    if (!resto) out({ ok: false, codigo: "args", detalle: 'Di «finanzas alerta <cuenta> <monto>» o «finanzas alerta <cuenta> off».' });
    try {
      const r = await rpc("rpc_fin_cuenta_umbral", { p_user_id: cfg.USER_ID, p_cuenta: resto, p_umbral: umbral });
      out({
        ok: true, codigo: "alerta_umbral", cuenta: r.cuenta, moneda: r.moneda, umbral_bajo: r.umbral_bajo,
        mensaje: umbral === null
          ? `Alerta de saldo bajo desactivada para ${r.cuenta}.`
          : `Te avisaré cuando ${r.cuenta} baje de ${fmtMoneda(umbral, r.moneda || "VES")}.`,
      });
    } catch (e) {
      out({ ok: false, codigo: "error", detalle: String(e.message || e).replace(/^.*?: /, "").slice(0, 200) });
    }
  }

  // ── registrar ──
  const monto = extraerMonto(q);
  if (monto === null) {
    out({ ok: false, codigo: "ambiguo", pregunta: "¿Cuánto fue el monto? Ej. «gasté 5 en pan».", detalle: "no se encontró un monto en el mensaje" });
  }
  const tipo = detectarTipo(q);
  const saldos = await rpc("rpc_fin_saldos", { p_user_id: cfg.USER_ID });
  const cuentas = saldos.map((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda }));
  if (!cuentas.length) {
    out({ ok: false, codigo: "sin-cuentas", detalle: "No tienes cuentas todavía. Crea una en la app (Finanzas → Nueva cuenta) y vuelve a intentarlo." });
  }

  const monedaMencion = detectarMoneda(q);
  const candidatos = matchCuenta(cuentas, q);

  let cuenta;
  let cuentaDestino = null;
  if (tipo === "transferencia") {
    // "transferí 100 de efectivo a bolívares": origen y destino explícitos.
    const mDeA = q.match(/\bde\s+([a-záéíóúñü ]+?)\s+a\s+([a-záéíóúñü ]+?)(?:\s*$|[,.])/i);
    if (mDeA) {
      const cOri = matchCuenta(cuentas, mDeA[1]);
      const cDes = matchCuenta(cuentas, mDeA[2]);
      if (cOri.length >= 1) cuenta = cOri[0].c;
      if (cDes.length >= 1) cuentaDestino = cDes[0].c;
    }
    if (!cuenta || !cuentaDestino) {
      const fmtC = (c) => `${c.nombre} (${c.moneda})`;
      out({
        ok: false, codigo: "ambiguo",
        pregunta: `¿De qué cuenta a qué cuenta transfiero ${fmtMoneda(monto, monedaMencion ?? "USD")}? Di «de X a Y». Cuentas: ${cuentas.map(fmtC).join(", ")}.`,
        opciones: cuentas.map((c) => c.nombre),
        detalle: "no se pudo determinar origen y destino",
      });
    }
    if (cuenta.id === cuentaDestino.id) {
      out({ ok: false, codigo: "misma_cuenta", detalle: "Origen y destino son la misma cuenta." });
    }
  } else if (candidatos.length === 1) {
    cuenta = candidatos[0].c;
  } else if (candidatos.length > 1) {
    out({
      ok: false, codigo: "ambiguo",
      pregunta: `¿En qué cuenta? ${candidatos.map((x) => x.c.nombre).join(", ")}.`,
      opciones: candidatos.map((x) => x.c.nombre),
      detalle: "varias cuentas coinciden con el mensaje",
    });
  } else {
    // Sin mención: una sola cuenta → esa; varias → filtrar por moneda mencionada.
    // Regla de Luigi (2026-10-03): USDT siempre es Binance.
    let pool = cuentas;
    if (pool.length > 1 && monedaMencion) pool = pool.filter((c) => c.moneda === monedaMencion);
    if (pool.length === 1) cuenta = pool[0];
    else if (monedaMencion === "USDT") {
      cuenta = cuentas.find((c) => norm(c.nombre).includes("binance")) || cuentas.find((c) => c.moneda === "USDT") || null;
    }
    if (!cuenta) {
      out({
        ok: false, codigo: "ambiguo",
        pregunta: `¿En qué cuenta registro ${fmtMoneda(monto, monedaMencion ?? "USD")}? ${pool.map((c) => `${c.nombre} (${c.moneda})`).join(", ")}.`,
        opciones: pool.map((c) => c.nombre),
        detalle: "no se pudo determinar la cuenta",
      });
    }
  }

  const categoria = tipo === "transferencia" ? null : detectarCategoria(q, tipo);
  const montoRaw = q.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/)?.[1] ?? null;
  const nota = restoNota(q, montoRaw, cuenta.nombre);
  // Regla de luigi (2026-10-10): ningún movimiento puede quedar sin categoría.
  // Si no se detectó, se pregunta en vez de guardar con null.
  if (tipo !== "transferencia" && !categoria) {
    out({
      ok: false,
      codigo: "ambiguo",
      pregunta: `¿En qué categoría registro ${fmtMoneda(monto, monedaMencion ?? cuenta.moneda)} (${nota})?`,
      detalle: "no se pudo determinar la categoría",
    });
  }
  const clave = `wa-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

  const r = await rpc("rpc_fin_registrar", {
    p_user_id: cfg.USER_ID,
    p_tipo: tipo,
    p_monto: monto,
    p_cuenta: cuenta.id,
    p_categoria: categoria,
    p_nota: nota,
    p_clave_evento: clave,
    p_cuenta_destino: cuentaDestino ? cuentaDestino.id : null,
  });
  if (r.duplicado) {
    out({ ok: true, codigo: "duplicado", id: r.id, mensaje: "Ese movimiento ya estaba registrado." });
  }
  let extras = "";
  // Mejora 6: comisión de pago móvil (regla de Luigi 2026-09-28: Bs 14 fijos, no 0,33%).
  // Solo aplica en Bs (el pago móvil es del BDV); la nota evita "pago móvil" para que
  // el router no la confunda con un pago nuevo y le sume otra comisión.
  if (tipo === "egreso" && /pago.?movil/.test(nq) && r.moneda === "VES") {
    const com = 14;
    try {
      await rpc("rpc_fin_registrar", {
        p_user_id: cfg.USER_ID,
        p_tipo: "egreso",
        p_monto: com,
        p_cuenta: cuenta.id,
        p_categoria: "servicios",
        p_nota: "comisión banco",
        p_clave_evento: `wa-com-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      });
      extras += ` Comisión pago móvil (Bs 14): ${fmtMoneda(com, r.moneda)} registrada aparte.`;
    } catch { /* si falla la comisión, el gasto principal ya quedó */ }
  }
  // Mejora 7: aviso si el gasto acerca la categoría a su presupuesto.
  if (tipo === "egreso" && r.categoria) {
    try {
      const pres = await rpc("rpc_fin_presupuestos", { p_user_id: cfg.USER_ID });
      const p = pres.find((x) => x.categoria === r.categoria);
      if (p && Number(p.pct) >= 80) {
        extras += ` ⚠️ Presupuesto ${p.categoria}: ${p.pct}% usado ($${fmtUsd(p.gastado_usd)} de $${fmtUsd(p.limite_usd)}).`;
      }
    } catch { /* sin presupuestos: se omite */ }
  }
  let mensaje;
  if (tipo === "transferencia") {
    mensaje = `Transferencia registrada: ${fmtMoneda(r.monto, r.moneda)} de ${r.cuenta} a ${r.destino} (${fmtMoneda(r.monto_destino, r.moneda_destino)}).`;
  } else {
    const que = r.categoria ?? (nota || tipo);
    mensaje = `${tipo === "ingreso" ? "Ingreso" : "Gasto"} registrado: ${fmtMoneda(r.monto, r.moneda)} en ${r.cuenta} (${que}).${extras}`;
  }
  out({
    ok: true, codigo: "registrado", id: r.id, tipo: r.tipo,
    monto: r.monto, moneda: r.moneda, cuenta: r.cuenta,
    destino: r.destino ?? null, montoDestino: r.monto_destino ?? null,
    categoria: r.categoria, usdEquivalente: r.usd_equivalente,
    mensaje,
  });
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes("cuenta_no_encontrada")) {
    out({ ok: false, codigo: "cuenta_no_encontrada", detalle: "No encontré esa cuenta. Revisa el nombre o créala en la app (Finanzas → Nueva cuenta)." });
  }
  out({ ok: false, codigo: "error", detalle: msg.slice(0, 300) });
}
