-- 0035_coach_moneda_guardrail.sql — Guardrail de monedas + anulados en el Coach.
--
-- Regla de luigi (2026-10-10): "$, Bs y USDT no son lo mismo".
-- 1) El coach sumaba `monto * coalesce(tasa_usd, 1)`; con `tasa_usd` NULL,
--    Bs 242.000 se contaba como $242.000. Ahora usa
--    `fin_convertir(monto, moneda_cuenta, 'USD')` con la moneda real.
-- 2) Los CTEs de gastos NO filtraban `anulado_en`; dos egresos anulados de
--    100.000 y 142.000 USDT (07/10, "compra p p") seguían sumando $242.000.
--    Ahora todos los CTEs exigen `m.anulado_en is null`.
-- 3) Categoría `traspaso` (2026-10-10, luigi): dinero que pasa por la cuenta
--    pero no es gasto/ingreso real (ej. favor mamá, conversiones P2P).
--    El coach excluye `traspaso` de todos los totales.

create or replace function public.rpc_coach_briefing(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
  v_mes date := date_trunc('month', ((now() at time zone 'America/Caracas'))::date)::date;
  v_d7 date := v_hoy - 7;
  v_d14 date := v_hoy - 14;
  v_out jsonb;
begin
  if p_user_id is null or not public.rpc_coach_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;

  with
  -- Gasto 7d vs 7d previos (egresos, USD, alcance propio/hogar)
  fin_7d as (
    select coalesce(round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2), 0) as total
    from public.fin_movimientos m
    join public.fin_cuentas c on c.id = m.cuenta_id
    where m.tipo = 'egreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.fecha between v_d7 and v_hoy
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
  ),
  fin_7d_prev as (
    select coalesce(round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2), 0) as total
    from public.fin_movimientos m
    join public.fin_cuentas c on c.id = m.cuenta_id
    where m.tipo = 'egreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.fecha between v_d14 and v_d7 - 1
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
  ),
  -- Ingresos 7d vs 7d previos (ingresos, USD, sin traspasos ni anulados)
  ing_7d as (
    select coalesce(round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2), 0) as total
    from public.fin_movimientos m
    join public.fin_cuentas c on c.id = m.cuenta_id
    where m.tipo = 'ingreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.fecha between v_d7 and v_hoy
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
  ),
  ing_7d_prev as (
    select coalesce(round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2), 0) as total
    from public.fin_movimientos m
    join public.fin_cuentas c on c.id = m.cuenta_id
    where m.tipo = 'ingreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.fecha between v_d14 and v_d7 - 1
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
  ),
  top_cats as (
    select m.categoria,
           round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2) as actual,
           round(coalesce((
             select sum(public.fin_convertir(m2.monto, c2.moneda, 'USD'))
             from public.fin_movimientos m2
             join public.fin_cuentas c2 on c2.id = m2.cuenta_id
             where m2.tipo = 'egreso'
               and m2.anulado_en is null
               and coalesce(m2.categoria, '') != 'traspaso'
               and m2.categoria = m.categoria
               and m2.fecha between v_d14 and v_d7 - 1
               and (m2.user_id = p_user_id
                 or (m2.hogar_id is not null and exists (
                   select 1 from public.hogar_miembros hm
                   where hm.hogar_id = m2.hogar_id and hm.user_id = p_user_id)))
           ), 0), 2) as previo
    from public.fin_movimientos m
    join public.fin_cuentas c on c.id = m.cuenta_id
    where m.tipo = 'egreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.fecha between v_d7 and v_hoy
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
    group by m.categoria
    order by actual desc
    limit 5
  ),
  -- Tasas visibles: BCV, Euro y USDT (el paralelo es interno y no se muestra).
  -- Movimiento 7d por tasa para la correlación.
  tasa_hoy as (
    select bcv, euro, usdt from public.fin_tasas
    where fecha = v_hoy order by updated_at desc limit 1
  ),
  tasa_7d as (
    select bcv, euro, usdt from public.fin_tasas
    where fecha <= v_d7 order by fecha desc limit 1
  ),
  tasa_pct as (
    select 'BCV' as nombre,
           case when s.bcv > 0 then round((h.bcv - s.bcv) / s.bcv * 100, 1) end as pct,
           h.bcv as hoy, s.bcv as hace_7d
    from tasa_hoy h left join tasa_7d s on true
    union all
    select 'Euro',
           case when s.euro > 0 then round((h.euro - s.euro) / s.euro * 100, 1) end,
           h.euro, s.euro
    from tasa_hoy h left join tasa_7d s on true
    union all
    select 'USDT',
           case when s.usdt > 0 then round((h.usdt - s.usdt) / s.usdt * 100, 1) end,
           h.usdt, s.usdt
    from tasa_hoy h left join tasa_7d s on true
  ),
  -- Hábitos: completados 7d vs 7d previos (alcance propio)
  hab_7d as (
    select count(*) as n
    from public.completions c
    where c.user_id = p_user_id
      and c.fecha between v_d7 and v_hoy
  ),
  hab_7d_prev as (
    select count(*) as n
    from public.completions c
    where c.user_id = p_user_id
      and c.fecha between v_d14 and v_d7 - 1
  ),
  -- Mercado: productos que subieron ≥10% entre las dos últimas compras
  mer_sub as (
    select p.nombre,
           round(pc.pu, 4) as pu_actual_usd,
           round(pa.pu, 4) as pu_previo_usd,
           round((pc.pu - pa.pu) / nullif(pa.pu, 0) * 100, 1) as pct
    from public.mer_productos p
    join lateral (
      select (mm.precio_total / nullif(mm.cantidad, 0)) / coalesce(nullif(mm.tasa_usd, 0), 1) as pu
      from public.mer_movimientos mm
      where mm.producto_id = p.id and mm.tipo = 'compra'
        and mm.anulado_en is null
      order by mm.fecha desc, mm.creado_en desc
      limit 1
    ) pc on true
    join lateral (
      select (mm.precio_total / nullif(mm.cantidad, 0)) / coalesce(nullif(mm.tasa_usd, 0), 1) as pu
      from public.mer_movimientos mm
      where mm.producto_id = p.id and mm.tipo = 'compra'
        and mm.anulado_en is null
      order by mm.fecha desc, mm.creado_en desc
      limit 1 offset 1
    ) pa on true
    where (p.user_id = p_user_id
      or (p.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = p.hogar_id and hm.user_id = p_user_id)))
      and pc.pu > pa.pu * 1.10
  ),
  lista_ct as (
    select count(*) as n
    from public.mer_lista l
    where l.estado = 'pendiente'
      and (l.user_id = p_user_id
        or (l.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = l.hogar_id and hm.user_id = p_user_id)))
  ),
  -- Control: recordatorios vencidos, presupuestos en alerta, deudas
  rec_venc as (
    select count(*) as n
    from public.fin_recordatorios r
    where r.activo
      and public.fin_proximo_vencimiento(r.dia_mes, r.ultimo_pago) < v_hoy
      and (r.user_id = p_user_id
        or (r.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)))
  ),
  pres_gasto as (
    select pr.categoria,
           round(public.fin_convertir(pr.monto_limite, pr.moneda, 'USD'), 2) as limite_usd,
           coalesce(round(sum(public.fin_convertir(m.monto, c.moneda, 'USD')), 2), 0) as gastado_usd
    from public.fin_presupuestos pr
    left join public.fin_movimientos m
      on m.tipo = 'egreso'
      and m.anulado_en is null
      and coalesce(m.categoria, '') != 'traspaso'
      and m.categoria = pr.categoria
      and m.fecha >= v_mes and m.fecha < v_mes + interval '1 month'
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
    left join public.fin_cuentas c on c.id = m.cuenta_id
    where pr.mes = v_mes
      and (pr.user_id = p_user_id
        or (pr.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    group by pr.categoria, pr.monto_limite, pr.moneda
  ),
  pres_alerta as (
    select categoria,
           case when limite_usd > 0 then round(gastado_usd / limite_usd * 100, 1) else 0 end as pct,
           case when gastado_usd >= limite_usd then 'excedido'
                when gastado_usd >= limite_usd * 0.8 then 'alerta'
                else 'ok' end as estado
    from pres_gasto
  ),
  deudas as (
    select
      count(*) filter (where d.abonado < d.monto) as n_pend,
      coalesce(round(sum(case when d.abonado < d.monto
        then public.fin_convertir(d.monto - d.abonado, d.moneda, 'USD')
        else 0 end), 2), 0) as pend_usd,
      count(*) filter (where d.abonado < d.monto
        and d.fecha_limite is not null
        and d.fecha_limite between v_hoy and v_hoy + 7) as n_prox
    from public.fin_deudas d
    where (d.user_id = p_user_id
      or (d.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = d.hogar_id and hm.user_id = p_user_id)))
  )
  select jsonb_build_object(
    'ventana', jsonb_build_object('desde', v_d7, 'hasta', v_hoy),
    'habitos', jsonb_build_object(
      'completados_7d', (select n from hab_7d),
      'completados_7d_prev', (select n from hab_7d_prev)
    ),
    'finanzas', jsonb_build_object(
      'egresos_7d_usd', (select total from fin_7d),
      'egresos_7d_prev_usd', (select total from fin_7d_prev),
      'ingresos_7d_usd', (select total from ing_7d),
      'ingresos_7d_prev_usd', (select total from ing_7d_prev),
      'neto_7d_usd', (select total from ing_7d) - (select total from fin_7d),
      'neto_7d_prev_usd', (select total from ing_7d_prev) - (select total from fin_7d_prev),
      'top_categorias', coalesce((select jsonb_agg(
          jsonb_build_object('categoria', categoria, 'actual', actual,
                             'previo', previo,
                             'pct', case when previo > 0
                                         then round((actual - previo) / previo * 100, 1)
                                         else null end)
          order by actual desc)
        from top_cats), '[]'::jsonb)
    ),
    'mercado', jsonb_build_object(
      'lista_pendientes', (select n from lista_ct),
      'productos_subieron', coalesce((select jsonb_agg(
          jsonb_build_object('nombre', nombre, 'pu_actual_usd', pu_actual_usd,
                             'pu_previo_usd', pu_previo_usd, 'pct', pct)
          order by pct desc)
        from mer_sub), '[]'::jsonb)
    ),
    'control', jsonb_build_object(
      'recordatorios_vencidos', (select n from rec_venc),
      'presupuestos_alerta', coalesce((select jsonb_agg(
          jsonb_build_object('categoria', categoria, 'pct', pct, 'estado', estado)
          order by pct desc)
        from pres_alerta where estado in ('alerta', 'excedido')), '[]'::jsonb),
      'deudas_pendientes', (select n_pend from deudas),
      'deudas_pendientes_usd', (select pend_usd from deudas),
      'deudas_vencen_7d', (select n_prox from deudas)
    ),
    'tasas', coalesce((select jsonb_object_agg(
        lower(nombre),
        jsonb_build_object('hoy', hoy, 'hace_7d', hace_7d, 'pct_7d', pct))
      from tasa_pct), '{}'::jsonb)
  ) into v_out;

  -- ── Correlaciones: reglas sobre datos reales, cada una verificable ──
  v_out := v_out || jsonb_build_object('correlaciones',
    (select coalesce(jsonb_agg(c order by c->>'id'), '[]'::jsonb)
     from (
       -- 1. Categoría de egreso que más subió (≥20% y base previa > 0)
       select jsonb_build_object(
         'id', 'gasto_categoria_subio',
         'titulo', 'Tu gasto en ' || t.categoria || ' subió ' || t.pct || '%',
         'detalle', 'Pasó de $' || t.previo || ' a $' || t.actual ||
                    ' en 7 días. Revísalo en Finanzas.',
         'ver_en', '/finanzas',
         'datos', jsonb_build_object('categoria', t.categoria, 'actual', t.actual,
                                     'previo', t.previo, 'pct', t.pct)
       ) as c
       from (select categoria, actual, previo, pct
             from jsonb_to_recordset(v_out->'finanzas'->'top_categorias')
               as x(categoria text, actual numeric, previo numeric, pct numeric)
             where pct is not null and pct >= 20 and previo > 0
             order by pct desc limit 1) t
       union all
       -- 2. Alguna tasa visible se movió ≥3% en 7 días (la de mayor movimiento)
       select jsonb_build_object(
         'id', 'tasa_movimiento',
         'titulo', 'El ' || t.nombre || ' se movió ' || t.pct || '% en 7 días',
         'detalle', 'De Bs ' || t.hace_7d || ' a Bs ' || t.hoy || '.',
         'ver_en', '/',
         'datos', jsonb_build_object('tasa', t.nombre, 'hoy', t.hoy,
                                     'hace_7d', t.hace_7d, 'pct_7d', t.pct)
       )
       from (select case x.k when 'bcv' then 'BCV'
                             when 'euro' then 'Euro'
                             else 'USDT' end as nombre,
                    (x.v->>'hoy')::numeric as hoy,
                    (x.v->>'hace_7d')::numeric as hace_7d,
                    (x.v->>'pct_7d')::numeric as pct
             from jsonb_each(v_out->'tasas') as x(k, v)
             where (x.v->>'pct_7d') is not null
               and abs((x.v->>'pct_7d')::numeric) >= 3
             order by abs((x.v->>'pct_7d')::numeric) desc
             limit 1) t
       union all
       -- 3. Presupuesto adelantado: ≥50% consumido con >7 días restantes
       select jsonb_build_object(
         'id', 'ritmo_presupuesto',
         'titulo', 'Vas rápido en ' || pa.categoria || ': ' || pa.pct || '% del presupuesto',
         'detalle', 'Con ' || ((v_mes + interval '1 month - 1 day')::date - v_hoy) ||
                    ' días restantes del mes. Ajústalo en Control.',
         'ver_en', '/control',
         'datos', jsonb_build_object('categoria', pa.categoria, 'pct', pa.pct,
                                     'dias_restantes',
                                     ((v_mes + interval '1 month - 1 day')::date - v_hoy))
       )
       from (select categoria, pct
             from jsonb_to_recordset(v_out->'control'->'presupuestos_alerta')
               as x(categoria text, pct numeric, estado text)
             where pct >= 50
               and ((v_mes + interval '1 month - 1 day')::date - v_hoy) > 7
             order by pct desc limit 1) pa
       union all
       -- 4. Producto que subió ≥10% entre las dos últimas compras
       select jsonb_build_object(
         'id', 'precio_producto_subio',
         'titulo', s.nombre || ' subió ' || s.pct || '%',
         'detalle', 'De $' || s.pu_previo || ' a $' || s.pu_actual ||
                    ' por unidad entre tus dos últimas compras. Historial en Mercado.',
         'ver_en', '/mercado',
         'datos', jsonb_build_object('producto', s.nombre, 'pu_previo', s.pu_previo,
                                     'pu_actual', s.pu_actual, 'pct', s.pct)
       )
       from (select nombre, pu_actual_usd as pu_actual, pu_previo_usd as pu_previo, pct
             from jsonb_to_recordset(v_out->'mercado'->'productos_subieron')
               as x(nombre text, pu_actual_usd numeric, pu_previo_usd numeric, pct numeric)
             order by pct desc limit 1) s
       union all
       -- 5. Deuda pendiente que vence en ≤7 días
       select jsonb_build_object(
         'id', 'deuda_proxima',
         'titulo', 'Tienes ' || (v_out->'control'->>'deudas_vencen_7d') ||
                   ' deuda(s) que vencen esta semana',
         'detalle', 'Suman $' || (v_out->'control'->>'deudas_pendientes_usd') ||
                    ' pendientes en total. Revísalas en Control.',
         'ver_en', '/control',
         'datos', jsonb_build_object(
           'vencen_7d', (v_out->'control'->>'deudas_vencen_7d')::int,
           'pendientes_usd', (v_out->'control'->>'deudas_pendientes_usd')::numeric)
       )
       where (v_out->'control'->>'deudas_vencen_7d')::int > 0
     ) reglas
    )
  );

  return v_out;
end;
$$;

comment on function public.rpc_coach_briefing(uuid) is
  'Fase 4: briefing cruzado de Senda (hábitos, finanzas, mercado, control, tasas) con correlaciones verificables.';
