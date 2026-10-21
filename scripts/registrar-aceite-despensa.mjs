// Registra el aceite en la despensa (inventario) SIN tocar Finanzas:
// el egreso de Bs 1.020 en BDV ya se registró por separado.
// Aprobado por luigi 2026-09-30.
import { cargarConfig } from "./whatsapp-comun.mjs";

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

const cfg = cargarConfig({});
const rpc = crearRpcFin(cfg);

const up = await rpc("rpc_mer_producto_upsert", {
  p_user_id: cfg.USER_ID, p_nombre: "Aceite La Pampa", p_unidad: "ml",
  p_categoria: "despensa", p_precio_ref: null,
});
const prodId = up.id || up;

const mov = await rpc("rpc_mer_movimiento", {
  p_user_id: cfg.USER_ID,
  p_producto_id: prodId,
  p_tipo: "compra",
  p_cantidad: 500,
  p_precio_total: 1020,
  p_moneda: "VES",
  p_comercio: null,
  p_cuenta_id: null, // sin egreso en Finanzas: ya registrado aparte
  p_nota: "compra por WhatsApp (aceite 500ml)",
  p_clave_evento: "mer-wa-aceite-la-pampa-2026-09-30",
});
console.log(JSON.stringify({ ok: true, producto_id: prodId, movimiento: mov }));
