-- 0044_estados_cuenta.sql — Creador de estados de cuenta Synaptica (Fase: facturación freelance).
--
-- Tablas:
--   fin_estados_cuenta        cabecera (cliente, proyecto, condición, totales desnormalizados)
--   fin_estados_cuenta_items  módulos base + modificaciones/nuevas implementaciones
--   fin_estados_cuenta_pagos  abonos/pagos recibidos
-- Numeración atómica por año: 2026-096, 2026-097… (el 2026-095 de Construacero
-- se siembra a mano y la secuencia arranca en 95).
-- Auth dual en los RPC (secreto o JWT del navegador), patrón de 0029_recibos.
-- Los totales (total, total_pagado, saldo, estado) se recalculan en cada
-- escritura vía fin_ec_recalcular(). Los abonos NO crean movimientos en
-- Finanzas: eso solo ocurre cuando luigi lo pide explícito (regla 2026-10-05).

-- ── Cabecera ──
create table if not exists public.fin_estados_cuenta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  hogar_id uuid,
  numero text not null unique,
  cliente text not null,
  proyecto text,
  condicion text not null default 'Tasa USDT',
  moneda text not null default 'USD' check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  fecha_emision date not null default ((now() at time zone 'America/Caracas'))::date,
  notas text,
  total numeric not null default 0,
  total_pagado numeric not null default 0,
  saldo numeric not null default 0,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'parcial', 'pagado')),
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists fin_ec_user_idx on public.fin_estados_cuenta (user_id, creado_en desc);
create index if not exists fin_ec_numero_idx on public.fin_estados_cuenta (numero);

-- ── Ítems (módulos base + modificaciones) ──
create table if not exists public.fin_estados_cuenta_items (
  id uuid primary key default gen_random_uuid(),
  estado_cuenta_id uuid not null references public.fin_estados_cuenta(id) on delete cascade,
  orden integer not null default 0,
  tipo text not null default 'item' check (tipo in ('modulo', 'item')),
  titulo text not null,
  descripcion text,
  clasificacion text check (clasificacion in ('modificacion', 'nueva')),
  monto numeric not null default 0 check (monto >= 0),
  listo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index if not exists fin_ec_items_ec_idx
  on public.fin_estados_cuenta_items (estado_cuenta_id, orden);

-- ── Pagos/abonos recibidos ──
create table if not exists public.fin_estados_cuenta_pagos (
  id uuid primary key default gen_random_uuid(),
  estado_cuenta_id uuid not null references public.fin_estados_cuenta(id) on delete cascade,
  fecha date not null default ((now() at time zone 'America/Caracas'))::date,
  concepto text not null,
  monto numeric not null check (monto > 0),
  -- Si el abono se llevó a Finanzas (solo cuando luigi lo pide explícito),
  -- guarda el id del movimiento para no duplicarlo.
  fin_movimiento_id uuid,
  creado_en timestamptz not null default now()
);

create index if not exists fin_ec_pagos_ec_idx
  on public.fin_estados_cuenta_pagos (estado_cuenta_id, fecha);

-- ── Secuencia anual atómica ──
create table if not exists public.fin_ec_secuencias (
  clave text not null,
  anio text not null,
  ultimo integer not null default 0,
  primary key (clave, anio)
);

-- ── RLS: dueño o miembro del hogar ──
alter table public.fin_estados_cuenta enable row level security;
drop policy if exists "fin_ec_dueno_o_hogar" on public.fin_estados_cuenta;
create policy "fin_ec_dueno_o_hogar" on public.fin_estados_cuenta
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

alter table public.fin_estados_cuenta_items enable row level security;
drop policy if exists "fin_ec_items_dueno_o_hogar" on public.fin_estados_cuenta_items;
create policy "fin_ec_items_dueno_o_hogar" on public.fin_estados_cuenta_items
  for all
  using (
    exists (
      select 1 from public.fin_estados_cuenta ec
      where ec.id = estado_cuenta_id
        and (ec.user_id = auth.uid()
          or (ec.hogar_id is not null and public.es_miembro_de_hogar(ec.hogar_id)))
    )
  )
  with check (
    exists (
      select 1 from public.fin_estados_cuenta ec
      where ec.id = estado_cuenta_id and ec.user_id = auth.uid()
        and (ec.hogar_id is null or public.es_miembro_de_hogar(ec.hogar_id))
    )
  );

alter table public.fin_estados_cuenta_pagos enable row level security;
drop policy if exists "fin_ec_pagos_dueno_o_hogar" on public.fin_estados_cuenta_pagos;
create policy "fin_ec_pagos_dueno_o_hogar" on public.fin_estados_cuenta_pagos
  for all
  using (
    exists (
      select 1 from public.fin_estados_cuenta ec
      where ec.id = estado_cuenta_id
        and (ec.user_id = auth.uid()
          or (ec.hogar_id is not null and public.es_miembro_de_hogar(ec.hogar_id)))
    )
  )
  with check (
    exists (
      select 1 from public.fin_estados_cuenta ec
      where ec.id = estado_cuenta_id and ec.user_id = auth.uid()
        and (ec.hogar_id is null or public.es_miembro_de_hogar(ec.hogar_id))
    )
  );

-- ── Helper de autenticación dual (secreto o JWT) ──
create or replace function public.rpc_ec_llamada_ok(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.rpc_fin_secret_ok() then
    return true;
  end if;
  return auth.uid() is not null and auth.uid() = p_user_id;
exception when others then
  return false;
end;
$$;

-- ── Recalcular totales de la cabecera ──
create or replace function public.fin_ec_recalcular(p_ec_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_pagado numeric;
begin
  select coalesce(sum(monto), 0) into v_total
  from public.fin_estados_cuenta_items
  where estado_cuenta_id = p_ec_id;

  select coalesce(sum(monto), 0) into v_pagado
  from public.fin_estados_cuenta_pagos
  where estado_cuenta_id = p_ec_id;

  update public.fin_estados_cuenta
  set total = v_total,
      total_pagado = v_pagado,
      saldo = greatest(v_total - v_pagado, 0),
      estado = case
        when v_pagado <= 0 then 'pendiente'
        when v_pagado >= v_total then 'pagado'
        else 'parcial'
      end,
      actualizado_en = now()
  where id = p_ec_id;
end;
$$;

-- ── Verificar pertenencia (dueño o hogar) ──
create or replace function public.fin_ec_es_mio(p_ec_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.fin_estados_cuenta ec
    where ec.id = p_ec_id
      and (ec.user_id = p_user_id
        or (ec.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = ec.hogar_id and hm.user_id = p_user_id)))
  );
end;
$$;

-- ── Número secuencial atómico por año: 2026-096 ──
create or replace function public.rpc_ec_numero(
  p_user_id uuid,
  p_hogar_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := coalesce(p_hogar_id::text, 'u:' || p_user_id::text);
  v_anio text := to_char((now() at time zone 'America/Caracas'), 'YYYY');
  v_ultimo integer;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  insert into public.fin_ec_secuencias (clave, anio, ultimo)
  values (v_clave, v_anio, 1)
  on conflict (clave, anio)
  do update set ultimo = public.fin_ec_secuencias.ultimo + 1
  returning public.fin_ec_secuencias.ultimo into v_ultimo;
  return v_anio || '-' || lpad(v_ultimo::text, 3, '0');
end;
$$;

-- ── Crear estado de cuenta ──
create or replace function public.rpc_ec_crear(
  p_user_id uuid,
  p_cliente text,
  p_proyecto text default null,
  p_condicion text default 'Tasa USDT',
  p_moneda text default 'USD',
  p_fecha_emision date default null,
  p_notas text default null,
  p_hogar_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_id uuid;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_cliente is null or char_length(trim(p_cliente)) = 0 then
    raise exception 'cliente_requerido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  v_numero := public.rpc_ec_numero(p_user_id, p_hogar_id);
  insert into public.fin_estados_cuenta
    (user_id, hogar_id, numero, cliente, proyecto, condicion, moneda,
     fecha_emision, notas, creado_por)
  values
    (p_user_id, p_hogar_id, v_numero, trim(p_cliente),
     nullif(trim(coalesce(p_proyecto, '')), ''),
     nullif(trim(coalesce(p_condicion, 'Tasa USDT')), ''),
     p_moneda,
     coalesce(p_fecha_emision, ((now() at time zone 'America/Caracas'))::date),
     nullif(trim(coalesce(p_notas, '')), ''),
     p_user_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
end;
$$;

-- ── Listar ──
create or replace function public.rpc_ec_listar(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.fecha_emision desc, t.creado_en desc), '[]'::jsonb)
    from (
      select ec.id, ec.numero, ec.cliente, ec.proyecto, ec.condicion, ec.moneda,
        ec.fecha_emision, ec.total, ec.total_pagado, ec.saldo, ec.estado,
        ec.creado_en
      from public.fin_estados_cuenta ec
      where ec.user_id = p_user_id
        or (ec.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = ec.hogar_id and hm.user_id = p_user_id))
    ) t
  );
end;
$$;

-- ── Ver completo (cabecera + ítems + pagos) ──
create or replace function public.rpc_ec_ver(p_user_id uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ec jsonb;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.fin_ec_es_mio(p_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  select row_to_json(ec) into v_ec
  from public.fin_estados_cuenta ec where ec.id = p_id;
  return jsonb_build_object(
    'cabecera', v_ec,
    'items', (
      select coalesce(jsonb_agg(row_to_json(i) order by i.orden, i.creado_en), '[]'::jsonb)
      from public.fin_estados_cuenta_items i where i.estado_cuenta_id = p_id
    ),
    'pagos', (
      select coalesce(jsonb_agg(row_to_json(p) order by p.fecha, p.creado_en), '[]'::jsonb)
      from public.fin_estados_cuenta_pagos p where p.estado_cuenta_id = p_id
    )
  );
end;
$$;

-- ── Actualizar cabecera ──
create or replace function public.rpc_ec_actualizar(
  p_user_id uuid,
  p_id uuid,
  p_cliente text default null,
  p_proyecto text default null,
  p_condicion text default null,
  p_fecha_emision date default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.fin_ec_es_mio(p_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  update public.fin_estados_cuenta
  set cliente = coalesce(nullif(trim(p_cliente), ''), cliente),
      proyecto = case when p_proyecto is null then proyecto
                      else nullif(trim(p_proyecto), '') end,
      condicion = coalesce(nullif(trim(p_condicion), ''), condicion),
      fecha_emision = coalesce(p_fecha_emision, fecha_emision),
      notas = case when p_notas is null then notas
                   else nullif(trim(p_notas), '') end,
      actualizado_en = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ── Ítem upsert ──
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
  p_id uuid default null
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
        orden = coalesce(p_orden, orden)
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
      (estado_cuenta_id, orden, tipo, titulo, descripcion, clasificacion, monto, listo)
    values
      (p_estado_id, coalesce(p_orden, v_orden), p_tipo, trim(p_titulo),
       nullif(trim(coalesce(p_descripcion, '')), ''), p_clasificacion, p_monto,
       coalesce(p_listo, true))
    returning id into v_id;
  end if;

  perform public.fin_ec_recalcular(p_estado_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── Ítem borrar ──
create or replace function public.rpc_ec_item_borrar(p_user_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ec uuid;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select estado_cuenta_id into v_ec
  from public.fin_estados_cuenta_items where id = p_id;
  if v_ec is null or not public.fin_ec_es_mio(v_ec, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  delete from public.fin_estados_cuenta_items where id = p_id;
  perform public.fin_ec_recalcular(v_ec);
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ── Pago registrar ──
create or replace function public.rpc_ec_pago_registrar(
  p_user_id uuid,
  p_estado_id uuid,
  p_monto numeric,
  p_concepto text,
  p_fecha date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.fin_ec_es_mio(p_estado_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_concepto is null or char_length(trim(p_concepto)) = 0 then
    raise exception 'concepto_requerido';
  end if;
  insert into public.fin_estados_cuenta_pagos
    (estado_cuenta_id, fecha, concepto, monto)
  values
    (p_estado_id,
     coalesce(p_fecha, ((now() at time zone 'America/Caracas'))::date),
     trim(p_concepto), p_monto)
  returning id into v_id;
  perform public.fin_ec_recalcular(p_estado_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── Pago borrar ──
create or replace function public.rpc_ec_pago_borrar(p_user_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ec uuid;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select estado_cuenta_id into v_ec
  from public.fin_estados_cuenta_pagos where id = p_id;
  if v_ec is null or not public.fin_ec_es_mio(v_ec, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  delete from public.fin_estados_cuenta_pagos where id = p_id;
  perform public.fin_ec_recalcular(v_ec);
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ── Marcar pago como llevado a Finanzas ──
create or replace function public.rpc_ec_pago_marcar_finanzas(
  p_user_id uuid,
  p_pago_id uuid,
  p_movimiento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ec uuid;
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select estado_cuenta_id into v_ec
  from public.fin_estados_cuenta_pagos where id = p_pago_id;
  if v_ec is null or not public.fin_ec_es_mio(v_ec, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  update public.fin_estados_cuenta_pagos
  set fin_movimiento_id = p_movimiento_id
  where id = p_pago_id;
  return jsonb_build_object('ok', true, 'id', p_pago_id);
end;
$$;

-- ── Borrar estado de cuenta completo ──
create or replace function public.rpc_ec_borrar(p_user_id uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_ec_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.fin_ec_es_mio(p_id, p_user_id) then
    raise exception 'no_encontrado';
  end if;
  delete from public.fin_estados_cuenta where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;
