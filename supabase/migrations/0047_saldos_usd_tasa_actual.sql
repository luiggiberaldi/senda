-- 0047: fin_saldos.saldo_usd a tasa ACTUAL (no suma de conversiones históricas).
--
-- Problema (2026-10-11, luigi): el BDV mostraba Bs 63,69 = $3,2 porque saldo_usd
-- sumaba cada movimiento convertido a SU tasa histórica (monto * tasa_usd).
-- Eso es un "costo histórico", no el valor actual del saldo: a tasa de hoy
-- (paralelo ~1010) Bs 63,69 son ~$0,06, no $3,2. Para una cartera lo que
-- importa es cuánto vale el saldo HOY.
--
-- Fix: saldo_usd = fin_convertir(saldo_moneda, moneda_cuenta, 'USD')
-- con la tasa vigente. El saldo en moneda original no cambia (sigue exacto).

create or replace view public.fin_saldos with (security_invoker = true) as
select
  c.id as cuenta_id,
  coalesce(sum(case
    when m.tipo = 'ingreso' then m.monto
    when m.tipo = 'egreso' then -m.monto
    when m.tipo = 'transferencia' and m.cuenta_id = c.id then -m.monto
    when m.tipo = 'transferencia' and m.cuenta_destino_id = c.id then m.monto_destino
    else 0
  end), 0)::numeric(18, 2) as saldo_moneda,
  public.fin_convertir(
    coalesce(sum(case
      when m.tipo = 'ingreso' then m.monto
      when m.tipo = 'egreso' then -m.monto
      when m.tipo = 'transferencia' and m.cuenta_id = c.id then -m.monto
      when m.tipo = 'transferencia' and m.cuenta_destino_id = c.id then m.monto_destino
      else 0
    end), 0),
    c.moneda,
    'USD'
  )::numeric(18, 2) as saldo_usd,
  count(m.id)::int as n_movimientos
from public.fin_cuentas c
left join public.fin_movimientos m
  on (m.cuenta_id = c.id or m.cuenta_destino_id = c.id)
  and m.anulado_en is null
group by c.id, c.moneda;
