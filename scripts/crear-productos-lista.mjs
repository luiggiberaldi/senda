// Crea fichas de producto en cero (sin stock) y las añade a la lista de compras.
// Uso: node crear-productos-lista.mjs
// Aprobado por luigi 2026-09-30: los 6 van a la LISTA de mercado (no a la despensa).
import { cargarConfig } from "./whatsapp-comun.mjs";

// El RPC de mercado/finanzas exige x-fin-rpc-secret (no x-habitos-rpc-secret).
function crearRpcFin(cfg) {
  return async function rpc(fn, params) {
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
    if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

const PRODUCTOS = [
  { nombre: "Mayonesa", unidad: "und", categoria: "condimentos" },
  { nombre: "Salsa de tomate", unidad: "und", categoria: "condimentos" },
  { nombre: "Mantequilla", unidad: "und", categoria: "lacteos" },
  { nombre: "Masa de pastelito", unidad: "kg", categoria: "viveres" },
  { nombre: "Leche en polvo", unidad: "kg", categoria: "lacteos" },
  { nombre: "Toddy", unidad: "und", categoria: "viveres" },
];

const cfg = cargarConfig({});
const rpc = crearRpcFin(cfg);
const res = [];
for (const p of PRODUCTOS) {
  const up = await rpc("rpc_mer_producto_upsert", {
    p_user_id: cfg.USER_ID, p_nombre: p.nombre, p_unidad: p.unidad,
    p_categoria: p.categoria, p_precio_ref: null,
  });
  const id = up.id || up;
  const li = await rpc("rpc_mer_lista_toggle", {
    p_user_id: cfg.USER_ID, p_producto_id: id, p_cantidad: 1, p_estado: "pendiente",
  });
  res.push({ producto: p.nombre, id, lista: li.estado || "pendiente" });
}
console.log(JSON.stringify({ ok: true, creados: res }));
