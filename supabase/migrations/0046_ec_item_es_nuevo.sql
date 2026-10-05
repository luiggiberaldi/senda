-- 0046_ec_item_es_nuevo.sql — Flag "es nuevo" en ítems del estado de cuenta.
--
-- luigi quiere dejar claro en el PDF cuáles ítems son las adiciones más
-- recientes (p. ej. las 3 últimas de Construacero 2026-095). Como la semilla
-- les puso el mismo creado_en, el flag es explícito y controlable desde la UI.
-- También corrige la clasificación del ítem "Modificar métodos de pago en
-- despachos entregados": es nueva implementación, no modificación.

alter table public.fin_estados_cuenta_items
  add column if not exists es_nuevo boolean not null default false;

-- Corrección pedida por luigi (2026-10-05): este ítem es nueva implementación.
update public.fin_estados_cuenta_items
set clasificacion = 'nueva'
where estado_cuenta_id = (select id from public.fin_estados_cuenta where numero = '2026-095')
  and titulo = 'Modificar métodos de pago en despachos entregados';

-- Las 3 adiciones más recientes del 2026-095.
update public.fin_estados_cuenta_items
set es_nuevo = true
where estado_cuenta_id = (select id from public.fin_estados_cuenta where numero = '2026-095')
  and titulo in (
    'Transferencia de clientes restringida',
    'Código real para productos externos',
    'Modificar métodos de pago en despachos entregados'
  );

-- rpc_ec_ver usa row_to_json(i): el nuevo campo viaja solo.
-- Se extiende rpc_ec_item_upsert con p_es_nuevo (null = no cambiar).
create or replace function public.rpc_ec_item_upsert(
  p_user_id uuid,
  p_estado_id uuid,
  p_titulo text,
  p_monto numeric,
  p_tipo text default 'item',
  p_descripcion text default null,
  p_clasificacion text default null,
  p_listo boolean default true,
  p_orden integer default null,
  p_id uuid default null,
  p_es_nuevo boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_orden integer;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.fin_ec_es_mio(p_estado_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  if p_titulo is null or char_length(trim(p_titulo)) = 0 then
    raise exception 'titulo_requerido';
  end if;
  if p_monto is null or p_monto < 0 then
    raise exception 'monto_invalido';
  end if;
  if p_tipo not in ('modulo', 'item') then
    raise exception 'tipo_invalido';
  end if;
  if p_clasificacion is not null and p_clasificacion not in ('modificacion', 'nueva') then
    raise exception 'clasificacion_invalida';
  end if;

  if p_id is not null then
    update public.fin_estados_cuenta_items
    set titulo = trim(p_titulo),
        descripcion = nullif(trim(coalesce(p_descripcion, '')), ''),
        tipo = p_tipo,
        clasificacion = p_clasificacion,
        monto = p_monto,
        listo = coalesce(p_listo, listo),
        orden = coalesce(p_orden, orden),
        es_nuevo = coalesce(p_es_nuevo, es_nuevo)
    where id = p_id and estado_cuenta_id = p_estado_id
    returning id into v_id;
    if v_id is null then
      raise exception 'item_no_encontrado';
    end if;
  else
    select coalesce(max(orden), -1) + 1 into v_orden
    from public.fin_estados_cuenta_items
    where estado_cuenta_id = p_estado_id;
    insert into public.fin_estados_cuenta_items
      (estado_cuenta_id, orden, tipo, titulo, descripcion, clasificacion, monto, listo, es_nuevo)
    values
      (p_estado_id, coalesce(p_orden, v_orden), p_tipo, trim(p_titulo),
       nullif(trim(coalesce(p_descripcion, '')), ''), p_clasificacion, p_monto,
       coalesce(p_listo, true), coalesce(p_es_nuevo, false))
    returning id into v_id;
  end if;

  perform public.fin_ec_recalcular(p_estado_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
