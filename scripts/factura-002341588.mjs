// Factura grande 04/10/2026 (orden 002341588): registra 18 compras en Mercado
// (stock + precios a tasa BCV) SIN crear egresos en Finanzas (el egreso único
// de Bs 36.680,03 se registra aparte). Marca como comprados los de la lista.
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

// [nombre factura, cantidad, unidad, precio total Bs, productoId o null, categoria si nuevo]
const ITEMS = [
  ["Azúcar Montalbán 1kg", 1, "kg", 1263, "55110b2a-ac0a-4fa7-b79a-982d2f21cd60"],
  ["Bolsa de saco", 1, "und", 1307, null, "limpieza"],
  ["Café Della Nonna 200gr", 0.2, "kg", 2169, "ef264a35-f9aa-4871-9da3-7a45f28d01d6"],
  ["Chuleta ahumada", 0.59, "kg", 3470, null, "carniceria"],
  ["Desodorante Dioxogen", 1, "und", 2150, null, "higiene"],
  ["Harina maíz Mary 900gr x3", 2.7, "kg", 2614, "3b426d20-89cb-4db2-b1a0-81742011eb6c"],
  ["Jabón tocador aloe 125gr x2", 2, "und", 1096, null, "higiene"],
  ["Leche Campestre polvo 400gr", 0.4, "kg", 5053, "92b0ed25-710c-4013-8b75-2655b56de7df"],
  ["Margarina Mavesa 500gr", 1, "und", 2614, null, "viveres"],
  ["Masa pastelito Supremo 900gr", 0.9, "kg", 1089, "17555439-de19-4906-9ff7-fbea17ea1e18"],
  ["Papel higiénico Rosal", 1, "und", 2105, "54fd1024-9b55-4efb-8b70-5dfbf020391a"],
  ["Pasta Primor 1kg x2", 2, "kg", 3572, "a460c2ba-849b-4a3c-ab40-ff0af92aacbc"],
  ["Sal Las Marías 1kg", 1, "kg", 304.98, "411f9fa8-577f-4538-b1f0-1550580d8f20"],
  ["Salsa soya Del Ávila 150ml", 1, "und", 623.46, "67d098bb-154f-47af-934d-5cafb42f34e6"],
  ["Salsa ketchup Capri 198gr", 1, "und", 656.29, null, "condimentos"],
  ["Salsa picante Del Campo 150gr", 1, "und", 726.11, "878140d2-33c8-4b77-8e58-f9587571a10a"],
  ["Toallas sanitarias Alive x2", 2, "und", 2614, "57c2375e-86dc-4a74-9d6b-74297550cc2d"],
  ["Toallitas húmedas Oki Baby 64u", 1, "und", 1224, "a35a227c-88d3-418e-81ec-a69507f3bf8c"],
];

const NOMBRES_NUEVOS = {
  "Bolsa de saco": "Bolsa de saco",
  "Chuleta ahumada": "Chuleta ahumada",
  "Desodorante Dioxogen": "Desodorante",
  "Jabón tocador aloe 125gr x2": "Jabón tocador",
  "Margarina Mavesa 500gr": "Margarina",
  "Salsa ketchup Capri 198gr": "Salsa ketchup",
};

// Productos de la lista de compras que se marcan como comprados
const LISTA_COMPRADO = [
  "55110b2a-ac0a-4fa7-b79a-982d2f21cd60", // Azúcar
  "ef264a35-f9aa-4871-9da3-7a45f28d01d6", // Café
  "3b426d20-89cb-4db2-b1a0-81742011eb6c", // Harina
  "92b0ed25-710c-4013-8b75-2655b56de7df", // Leche en polvo
  "17555439-de19-4906-9ff7-fbea17ea1e18", // Masa pastelito
  "54fd1024-9b55-4efb-8b70-5dfbf020391a", // Papel de baño
  "a460c2ba-849b-4a3c-ab40-ff0af92aacbc", // Pasta
  "411f9fa8-577f-4538-b1f0-1550580d8f20", // Sal
  "67d098bb-154f-47af-934d-5cafb42f34e6", // Salsa soya
  "878140d2-33c8-4b77-8e58-f9587571a10a", // Picante
  "57c2375e-86dc-4a74-9d6b-74297550cc2d", // Toallas sanitarias
  "a35a227c-88d3-418e-81ec-a69507f3bf8c", // Toallitas húmedas
];

const cfg = cargarConfig({});
const rpc = crearRpcFin(cfg);
const out = [];

for (const [nombreFac, cant, und, precio, prodId, cat] of ITEMS) {
  let pid = prodId;
  if (!pid) {
    const up = await rpc("rpc_mer_producto_upsert", {
      p_user_id: cfg.USER_ID, p_nombre: NOMBRES_NUEVOS[nombreFac], p_unidad: und,
      p_categoria: cat, p_precio_ref: null, p_hogar_id: null, p_stock_inicial: null,
      p_marca: null, p_presentacion: null,
    });
    pid = up.id || up;
  }
  const r = await rpc("rpc_mer_movimiento", {
    p_user_id: cfg.USER_ID, p_producto_id: pid, p_tipo: "compra",
    p_cantidad: cant, p_precio_total: precio, p_moneda: "VES",
    p_comercio: null, p_cuenta_id: null,
    p_nota: "factura 002341588 (04/10/2026)",
    p_clave_evento: `mer-fac002341588-${pid.slice(0, 8)}`,
  });
  out.push({ item: nombreFac, cantidad: cant, precio_bs: precio, ok: !!r.ok, nuevo: !prodId });
}

const lista = [];
for (const pid of LISTA_COMPRADO) {
  try {
    const li = await rpc("rpc_mer_lista_toggle", {
      p_user_id: cfg.USER_ID, p_producto_id: pid, p_cantidad: 1, p_estado: "comprado",
    });
    lista.push({ id: pid.slice(0, 8), estado: li.estado });
  } catch (e) { lista.push({ id: pid.slice(0, 8), error: String(e).slice(0, 60) }); }
}

console.log(JSON.stringify({ ok: true, items: out.length, detalle: out, lista }, null, 1));
