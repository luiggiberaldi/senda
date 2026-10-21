// Lista de compras 2026-10-03 (pedido de luigi por voz): crea los 5 productos
// faltantes y pone los 13 en la lista como pendientes con sus cantidades.
import { cargarConfig } from "./whatsapp-comun.mjs";

function crearRpcFin(cfg) {
  return async function rpc(fn, params) {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: cfg.ANON_KEY,
        Authorization: "Bearer " + cfg.ANON_KEY,
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

const NUEVOS = [
  { nombre: "Toallas sanitarias", unidad: "und", categoria: "higiene" },
  { nombre: "Sal", unidad: "kg", categoria: "viveres" },
  { nombre: "Salsa de soya", unidad: "und", categoria: "condimentos" },
  { nombre: "Picante", unidad: "und", categoria: "condimentos" },
  { nombre: "Caraota", unidad: "kg", categoria: "viveres" },
];

const LISTA = [
  { id: "3b426d20-89cb-4db2-b1a0-81742011eb6c", cantidad: 2 }, // Harina maíz precocida
  { id: "a460c2ba-849b-4a3c-ab40-ff0af92aacbc", cantidad: 1 }, // Pasta
  { id: "a35a227c-88d3-418e-81ec-a69507f3bf8c", cantidad: 1 }, // Toallitas húmedas
  { id: "55110b2a-ac0a-4fa7-b79a-982d2f21cd60", cantidad: 1 }, // Azúcar
  { id: "ef264a35-f9aa-4871-9da3-7a45f28d01d6", cantidad: 1 }, // Café
  { id: "92b0ed25-710c-4013-8b75-2655b56de7df", cantidad: 1 }, // Leche en polvo
  { id: "002dde43-d8d3-4904-8ce8-ef892fb2faea", cantidad: 1 }, // Toddy
  { id: "c982e17b-94e5-4551-915c-5cfa924d0e50", cantidad: 1 }, // Mantequilla
];

const cfg = cargarConfig({});
const rpc = crearRpcFin(cfg);
const ids = [...LISTA];

for (const p of NUEVOS) {
  const up = await rpc("rpc_mer_producto_upsert", {
    p_user_id: cfg.USER_ID, p_nombre: p.nombre, p_unidad: p.unidad,
    p_categoria: p.categoria, p_precio_ref: null,
  });
  const id = up.id || up;
  ids.push({ id, cantidad: 1, nuevo: p.nombre });
}

const res = [];
for (const it of ids) {
  const li = await rpc("rpc_mer_lista_toggle", {
    p_user_id: cfg.USER_ID, p_producto_id: it.id, p_cantidad: it.cantidad, p_estado: "pendiente",
  });
  res.push({ id: it.id, cantidad: it.cantidad, estado: (li && li.estado) || "pendiente", nuevo: it.nuevo || null });
}
console.log(JSON.stringify({ ok: true, lista: res }, null, 1));
