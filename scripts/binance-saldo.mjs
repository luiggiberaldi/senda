// binance-saldo.mjs — consulta el saldo real de Binance (spot) vía API firmada.
// Uso: BINANCE_API_KEY=... BINANCE_API_SECRET=... node binance-saldo.mjs [--json]
// Solo lectura: la key debe tener únicamente permiso "Enable Reading".
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Auto-carga BINANCE_* desde ~/workspace/habitos/.env.local si no están en el entorno.
function cargarEnv() {
  if (process.env.BINANCE_API_KEY) return;
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^BINANCE_(API_KEY|API_SECRET)='([^']*)'$/);
    if (m) process.env[`BINANCE_${m[1]}`] = m[2];
  }
}
cargarEnv();

const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';
const asJson = process.argv.includes('--json');

if (!API_KEY || !API_SECRET) {
  console.error(JSON.stringify({ ok: false, codigo: 'sin-credenciales', detalle: 'Faltan BINANCE_API_KEY / BINANCE_API_SECRET en el entorno.' }));
  process.exit(1);
}

function firmar(queryString) {
  return createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function main() {
  const params = new URLSearchParams({
    timestamp: String(Date.now()),
    recvWindow: '60000',
  });
  const qs = params.toString();
  const url = `https://api.binance.com/api/v3/account?${qs}&signature=${firmar(qs)}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'X-MBX-APIKEY': API_KEY } });
  } catch (e) {
    console.log(JSON.stringify({ ok: false, codigo: 'red', detalle: `No se pudo alcanzar api.binance.com: ${e.message}` }));
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const motivo = data.code === -2015 ? 'API key inválida o sin permiso de lectura.'
      : data.code === -1021 ? 'Reloj desincronizado (timestamp inválido).'
      : data.msg || `HTTP ${res.status}`;
    console.log(JSON.stringify({ ok: false, codigo: 'binance-error', binanceCode: data.code ?? null, detalle: motivo }));
    process.exit(1);
  }
  const balances = (data.balances || [])
    .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
    .filter((b) => b.free > 0 || b.locked > 0)
    .map((b) => ({ ...b, total: b.free + b.locked }));
  const usdt = balances.find((b) => b.asset === 'USDT');
  const out = {
    ok: true,
    usdt: usdt ? usdt.total : 0,
    nActivos: balances.length,
    balances,
  };
  console.log(JSON.stringify(out));
}

main();
