-- 0037_mercado_punto_reorden.sql — Punto de reorden por producto.
--
-- luigi 2026-09-30: no todo pasa a la lista de compras al llegar a cero.
-- Cada producto tiene su umbral (stock_minimo, defecto 0); cuando el stock
-- queda en el umbral o por debajo, el producto entra SOLO a la lista de
-- compras (estado 'pendiente'). El chequeo vive en la DB para que aplique
-- a WhatsApp, la app y cualquier cliente:
--   - rpc_mer_movimiento lo evalúa tras cada movimiento (devuelve paso_a_lista)
--   - rpc_mer_producto_actualizar lo evalúa al cambiar el umbral
--   - rpc_mer_inventario expone stock_minimo + bajo_minimo
-- Auth dual via rpc_mer_llamada_ok (patrón 0028/0029).

-- ── 1. Columna ──────────────────────────────────────────────────────────
alter table public.mer_productos
  add column if not exists stock_minimo numeric(18, 3) not null default 0
    check (stock_minimo >= 0);

-- ── 2. Helper interno: pasa a la lista si stock <= stock_minimo ──────────
-- Devuelve true solo si la lista cambió (insertó o reactivó un 'comprado').
create or replace function public.mer_pasar_a_lista_si_reorden(
  p_user_id uuid,
  p_producto_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min numeric;
  v_hogar uuid;
  v_stock numeric;
  v_n int;
begin
  select pr.stock_minimo, pr.hogar_id
  into v_min, v_hogar
  from public.mer_productos pr
  where pr.id = p_producto_id;
  if v_min is null then
    return false;
  end if;
  select coalesce(sum(case when m.tipo in ('compra', 'ajuste') then m.cantidad
                           else -m.cantidad end), 0)
  into v_stock
  from public.mer_movimientos m
  where m.producto_id = p_producto_id
    and m.anulado_en is null;
  if v_stock > v_min then
    return false;
  end if;
  insert into public.mer_lista (user_id, hogar_id, producto_id, cantidad, estado, creado_por)
  values (p_user_id, v_hogar, p_producto_id, 1, 'pendiente', p_user_id)
  on conflict (user_id, producto_id)
  do update set estado = 'pendiente'
  where mer_lista.estado <> 'pendiente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ── 3. rpc_mer_producto_actualizar + p_stock_minimo ──────────────────────
-- La firma vieja (8 args) se elimina: si no, PostgREST devuelve PGRST203.
drop function if exists public.rpc_mer_producto_actualizar(uuid, uuid, text, text, int, numeric, boolean, boolean);

create or replace function public.rpc_mer_producto_actualizar(
  p_user_id uuid,
  p_producto_id uuid,
  p_nombre text default null,
  p_categoria text default null,
  p_horizonte_dias int default null,
  p_consumo_semanal_estim numeric default null,
  p_quitar_estimado boolean default false,
  p_activo boolean default null,
  p_stock_minimo numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_paso boolean := false;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select * into v_prod from public.mer_productos pr
  where pr.id = p_producto_id
    and (pr.user_id = p_user_id
      or (pr.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
  if v_prod.id is null then
    raise exception 'producto_no_encontrado';
  end if;
  if p_nombre is not null and char_length(trim(p_nombre)) not between 1 and 80 then
    raise exception 'nombre_invalido';
  end if;
  if p_categoria is not null and char_length(trim(p_categoria)) not between 1 and 40 then
    raise exception 'categoria_invalida';
  end if;
  if p_horizonte_dias is not null and p_horizonte_dias not between 1 and 90 then
    raise exception 'horizonte_invalido';
  end if;
  if p_consumo_semanal_estim is not null and p_consumo_semanal_estim < 0 then
    raise exception 'estimado_invalido';
  end if;
  if p_stock_minimo is not null and p_stock_minimo < 0 then
    raise exception 'minimo_invalido';
  end if;

  update public.mer_productos set
    nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
    categoria = lower(coalesce(nullif(trim(p_categoria), ''), categoria)),
    horizonte_compra_dias = coalesce(p_horizonte_dias, horizonte_compra_dias),
    consumo_semanal_estim = case
      when p_quitar_estimado then null
      else coalesce(p_consumo_semanal_estim, consumo_semanal_estim)
    end,
    stock_minimo = coalesce(p_stock_minimo, stock_minimo),
    activo = coalesce(p_activo, activo)
  where id = v_prod.id
  returning * into v_prod;

  -- Si cambió el umbral, evaluar de inmediato (el stock ya puede estar debajo).
  if p_stock_minimo is not null then
    v_paso := public.mer_pasar_a_lista_si_reorden(p_user_id, v_prod.id);
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'categoria', v_prod.categoria, 'activo', v_prod.activo,
    'horizonte_compra_dias', v_prod.horizonte_compra_dias,
    'consumo_semanal_estim', v_prod.consumo_semanal_estim,
    'stock_minimo', v_prod.stock_minimo,
    'paso_a_lista', v_paso
  );
exception when unique_violation then
  raise exception 'nombre_duplicado';
end;
$$;

-- ── 4. rpc_mer_movimiento: evaluar reorden tras cada movimiento ─────────
create or replace function public.rpc_mer_movimiento(
  p_user_id uuid,
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_precio_total numeric default null,
  p_moneda text default null,
  p_comercio text default null,
  p_cuenta_id text default null,
  p_nota text default null,
  p_clave_evento text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_mov_id uuid;
  v_fin jsonb;
  v_tasa numeric;
  v_tasa_ves numeric;
  v_tasa_cuenta numeric;
  v_monto_cuenta numeric;
  v_usd_unit numeric;
  v_cta public.fin_cuentas%rowtype;
  v_dup public.mer_movimientos%rowtype;
  v_stock numeric;
  v_paso boolean := false;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_tipo not in ('compra', 'consumo', 'ajuste', 'danado') then
    raise exception 'tipo_invalido';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'cantidad_invalida';
  end if;

  select * into v_prod from public.mer_productos pr
  where pr.id = p_producto_id
    and (pr.user_id = p_user_id
      or (pr.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
  if v_prod.id is null then
    raise exception 'producto_no_encontrado';
  end if;

  -- Fixeo 0029: consumo/dañado no puede dejar el stock negativo.
  if p_tipo in ('consumo', 'danado') then
    select coalesce(sum(case when m.tipo in ('compra', 'ajuste') then m.cantidad
                             else -m.cantidad end), 0)
    into v_stock
    from public.mer_movimientos m
    where m.producto_id = v_prod.id and m.anulado_en is null;
    if p_cantidad > v_stock then
      raise exception 'stock_insuficiente: quedan % % de %',
        trim(trailing '0' from to_char(v_stock, 'FM999999990.000')),
        v_prod.unidad, v_prod.nombre;
    end if;
  end if;

  -- Idempotencia: si la clave ya existe, devolver el movimiento sin duplicar.
  if p_clave_evento is not null then
    select m.* into v_dup
    from public.mer_movimientos m
    join public.mer_productos pr on pr.id = m.producto_id
    where m.clave_evento = p_clave_evento
      and (pr.user_id = p_user_id
        or (pr.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
    if v_dup.id is not null then
      return jsonb_build_object(
        'ok', true, 'id', v_dup.id, 'duplicado', true,
        'tipo', v_dup.tipo, 'producto', v_prod.nombre,
        'cantidad', v_dup.cantidad, 'unidad', v_prod.unidad,
        'fin_movimiento_id', v_dup.fin_movimiento_id
      );
    end if;
  end if;

  v_tasa := null;
  v_tasa_ves := null;
  if p_tipo = 'compra' then
    if p_precio_total is null or p_precio_total <= 0 then
      raise exception 'precio_requerido';
    end if;
    v_tasa := public.fin_tasa_usd_para(coalesce(p_moneda, 'VES'), null);
    select paralelo into v_tasa_ves
    from public.fin_tasas order by fecha desc limit 1;
    v_usd_unit := round((p_precio_total * v_tasa) / p_cantidad, 4);
  end if;

  -- Compra pagada con cuenta → egreso en finanzas (idempotente por clave).
  if p_tipo = 'compra' and p_cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta_id or lower(c.nombre) = lower(p_cuenta_id))
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)))
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
    v_tasa_cuenta := public.fin_tasa_usd_para(v_cta.moneda, v_cta.tasa_usd_manual);
    v_monto_cuenta := round(p_precio_total * v_tasa / v_tasa_cuenta, 2);
    v_fin := public.fin_registrar_interno(
      p_user_id, 'egreso', v_monto_cuenta, p_cuenta_id, 'mercado',
      ((now() at time zone 'America/Caracas'))::date,
      trim(coalesce(v_prod.nombre, '') || ' · ' || coalesce(p_comercio, 'mercado')),
      'mer-' || coalesce(p_clave_evento, gen_random_uuid()::text),
      null
    );
  end if;

  insert into public.mer_movimientos
    (producto_id, tipo, cantidad, precio_total, moneda, tasa_usd, tasa_ves,
     comercio, cuenta_id, fin_movimiento_id, nota, creado_por, clave_evento)
  values
    (v_prod.id, p_tipo, p_cantidad,
     case when p_tipo = 'compra' then p_precio_total end,
     case when p_tipo = 'compra' then coalesce(p_moneda, 'VES') end,
     v_tasa, v_tasa_ves,
     nullif(trim(coalesce(p_comercio, '')), ''),
     case when p_cuenta_id is not null
       then (v_fin ->> 'cuenta_id')::uuid end,
     case when v_fin is not null then (v_fin ->> 'id')::uuid end,
     nullif(trim(coalesce(p_nota, '')), ''),
     p_user_id, p_clave_evento)
  returning id into v_mov_id;

  -- Punto de reorden (0037): si el stock quedó en el umbral o por debajo,
  -- el producto pasa solo a la lista de compras.
  v_paso := public.mer_pasar_a_lista_si_reorden(p_user_id, v_prod.id);

  return jsonb_build_object(
    'ok', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'producto', v_prod.nombre,
    'cantidad', p_cantidad,
    'unidad', v_prod.unidad,
    'precio_usd_unitario', v_usd_unit,
    'monto_cuenta', v_monto_cuenta,
    'moneda_cuenta', case when v_cta.id is not null then v_cta.moneda end,
    'fin_movimiento_id', case when v_fin is not null then v_fin ->> 'id' end,
    'paso_a_lista', v_paso
  );
end;
$$;

-- ── 5. rpc_mer_inventario: exponer stock_minimo + bajo_minimo ────────────
create or replace function public.rpc_mer_inventario(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return (
    with alcance as (
      select pr.*
      from public.mer_productos pr
      where pr.activo
        and (pr.user_id = p_user_id
          or (pr.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    ),
    movs as (
      select m.*
      from public.mer_movimientos m
      join alcance a on a.id = m.producto_id
      where m.anulado_en is null
    ),
    stock as (
      select producto_id,
        sum(case when tipo = 'compra' then cantidad
                 when tipo = 'ajuste' then cantidad
                 else -cantidad end) as stock
      from movs group by producto_id
    ),
    compras as (
      select producto_id,
        (precio_total * tasa_usd) / nullif(cantidad, 0) as usd_unit,
        precio_total / nullif(cantidad, 0) as precio_unit,
        moneda, fecha, comercio, creado_en
      from movs where tipo = 'compra'
    ),
    stats as (
      select producto_id,
        min(usd_unit) as min_usd, max(usd_unit) as max_usd,
        avg(usd_unit) as prom_usd, count(*) as n_compras,
        (array_agg(usd_unit order by creado_en desc))[1] as ultimo_usd,
        (array_agg(precio_unit order by creado_en desc))[1] as ultimo_precio,
        (array_agg(moneda order by creado_en desc))[1] as ultima_moneda,
        (array_agg(comercio order by creado_en desc))[1] as ultimo_comercio
      from compras group by producto_id
    ),
    consumo as (
      select producto_id,
        sum(cantidad) / 30.0 as consumo_diario
      from movs
      where tipo = 'consumo' and fecha >= ((now() at time zone 'America/Caracas'))::date - 30
      group by producto_id
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.nombre), '[]'::jsonb)
    from (
      select b.*,
        round(b.diario, 3) as consumo_diario,
        round(b.diario * 30, 2) as consumo_mensual,
        case when b.diario > 0
          then floor(b.stock / b.diario)
        end as dias_agotamiento,
        case when b.diario > 0
          then (((now() at time zone 'America/Caracas'))::date
            + floor(b.stock / b.diario)::int)::text
        end as fecha_agotamiento,
        case when b.diario > 0
          then greatest(0, round(b.diario * b.horizonte_compra_dias - b.stock, 2))
        end as sugerido_comprar,
        (b.stock <= b.stock_minimo) as bajo_minimo
      from (
        select a.id, a.nombre, a.unidad, a.categoria,
          a.stock_minimo,
          coalesce(s.stock, 0) as stock,
          st.ultimo_precio as ultimo_precio,
          st.ultima_moneda as ultima_moneda,
          st.ultimo_comercio as ultimo_comercio,
          round(st.min_usd, 2) as precio_min_usd,
          round(st.max_usd, 2) as precio_max_usd,
          round(st.prom_usd, 2) as precio_prom_usd,
          round(st.ultimo_usd, 2) as precio_usd_unitario,
          case when st.prom_usd > 0
            then round((st.ultimo_usd - st.prom_usd) / st.prom_usd * 100, 1)
          end as variacion_pct,
          case
            when c.consumo_diario is not null then c.consumo_diario
            when a.consumo_semanal_estim is not null then a.consumo_semanal_estim / 7.0
          end as diario,
          (c.consumo_diario is null
            and a.consumo_semanal_estim is not null) as consumo_estimado,
          a.horizonte_compra_dias,
          a.consumo_semanal_estim,
          st.n_compras
        from alcance a
        left join stock s on s.producto_id = a.id
        left join stats st on st.producto_id = a.id
        left join consumo c on c.producto_id = a.id
      ) b
    ) t
  );
end;
$$;

-- ── 6. Permisos (la puerta real es rpc_mer_llamada_ok) ───────────────────
revoke all on function public.rpc_mer_producto_actualizar(uuid, uuid, text, text, int, numeric, boolean, boolean, numeric) from public;
grant execute on function public.rpc_mer_producto_actualizar(uuid, uuid, text, text, int, numeric, boolean, boolean, numeric) to anon, authenticated;
