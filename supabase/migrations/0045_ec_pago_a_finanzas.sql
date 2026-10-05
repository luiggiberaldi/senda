-- 0045_ec_pago_a_finanzas.sql — RPC atómico e idempotente para llevar un abono
-- del estado de cuenta a Finanzas.
--
-- Reemplaza el flujo en dos pasos de la UI (registrar movimiento + marcar pago),
-- que podía duplicar el ingreso si el segundo paso fallaba y se reintentaba.
-- Este RPC, en una sola transacción:
--   1. valida auth dual (patrón 0044) y propiedad del pago;
--   2. si el pago ya tiene fin_movimiento_id, lo devuelve sin crear nada;
--   3. convierte el monto (moneda del estado) a la moneda de la cuenta con
--      public.fin_convertir (igual que rpc_fin_deuda_abonar);
--   4. registra el ingreso con clave_evento estable 'ec-pago-<pago_id>'
--      (public.fin_registrar_interno es idempotente por clave_evento);
--   5. guarda fin_movimiento_id en el pago.

create or replace function public.rpc_ec_pago_a_finanzas(
  p_user_id uuid,
  p_pago_id uuid,
  p_cuenta_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.fin_estados_cuenta_pagos%rowtype;
  v_ec public.fin_estados_cuenta%rowtype;
  v_cta public.fin_cuentas%rowtype;
  v_monto numeric;
  v_fin jsonb;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;

  select * into v_pago
  from public.fin_estados_cuenta_pagos where id = p_pago_id;
  if v_pago.id is null or not public.fin_ec_es_mio(v_pago.estado_cuenta_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;

  -- Idempotente: si ya se llevó a Finanzas, devolver el movimiento existente.
  if v_pago.fin_movimiento_id is not null then
    return jsonb_build_object(
      'ok', true,
      'fin_movimiento_id', v_pago.fin_movimiento_id,
      'duplicado', true
    );
  end if;

  select * into v_ec
  from public.fin_estados_cuenta where id = v_pago.estado_cuenta_id;

  select * into v_cta
  from public.fin_cuentas c
  where c.id = p_cuenta_id
    and not c.archivada
    and (c.user_id = p_user_id
      or (c.hogar_id is not null and public.es_miembro_de_hogar(c.hogar_id)));
  if v_cta.id is null then
    raise exception 'cuenta_no_encontrada';
  end if;

  v_monto := public.fin_convertir(
    v_pago.monto, v_ec.moneda, v_cta.moneda, null, v_cta.tasa_usd_manual
  );

  v_fin := public.fin_registrar_interno(
    p_user_id,
    'ingreso',
    v_monto,
    v_cta.id::text,
    'deuda',
    v_pago.fecha,
    'Abono estado de cuenta ' || v_ec.numero || ' · ' || v_ec.cliente,
    'ec-pago-' || v_pago.id::text,
    null
  );

  update public.fin_estados_cuenta_pagos
  set fin_movimiento_id = (v_fin ->> 'id')::uuid
  where id = v_pago.id;

  return jsonb_build_object(
    'ok', true,
    'fin_movimiento_id', v_fin ->> 'id',
    'duplicado', coalesce((v_fin ->> 'duplicado')::boolean, false)
  );
end;
$$;
