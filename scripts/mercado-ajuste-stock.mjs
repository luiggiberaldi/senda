#!/usr/bin/env node
// Agrega stock a Mercado sin crear egreso en Finanzas (el egreso ya se registró).
// Uso: node mercado-ajuste-stock.mjs "<nombre>" <cantidad> ["<unidad>"]
import { cargarConfig } from "./whatsapp-comun.mjs";

const cfg = cargarConfig();
async function rpc(fn, params) {
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
}

const [nombre, cantStr, unidad] = process.argv.slice(2);
const cantidad = parseFloat(cantStr);
const inv = await rpc("rpc_mer_inventario", { p_user_id: cfg.USER_ID });
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
let prod = inv.find((p) => norm(p.nombre).includes(norm(nombre)));
if (!prod) {
  console.log(JSON.stringify({ ok: false, codigo: "sin_producto", detalle: `no hay "${nombre}" en inventario` }));
  process.exit(0);
}
const r = await rpc("rpc_mer_movimiento", {
  p_user_id: cfg.USER_ID,
  p_producto_id: prod.id,
  p_tipo: "ajuste",
  p_cantidad: cantidad,
  p_nota: "compra (egreso ya registrado en Finanzas)",
  p_clave_evento: `mer-wa-ajuste-${prod.id}-${Date.now()}`,
});
console.log(JSON.stringify({ ok: true, codigo: "stock_agregado", producto: r.producto || prod.nombre,
  cantidad, unidad: unidad || prod.unidad, stock: r.stock ?? null, paso_a_lista: !!r.paso_a_lista }));
