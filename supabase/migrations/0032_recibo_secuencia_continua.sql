-- 0032_recibo_secuencia_continua.sql
-- Regla de Luigi (2026-10-08): el correlativo de recibos NUNCA se reinicia por mes.
-- La secuencia es continua por usuario/hogar; solo se reinicia si él lo pide explícitamente.
-- El formato del número sigue siendo SEN-YYYYMM-NNNN (mes de emisión + correlativo global).

create or replace function public.rpc_recibo_numero(
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
  v_mes text := to_char((now() at time zone 'America/Caracas'), 'YYYYMM');
  v_ultimo integer;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  -- Clave fija 'siempre': el correlativo no se reinicia con el cambio de mes.
  insert into public.fin_recibo_secuencias (clave, mes, ultimo)
  values (v_clave, 'siempre', 1)
  on conflict (clave, mes)
  do update set ultimo = public.fin_recibo_secuencias.ultimo + 1
  returning public.fin_recibo_secuencias.ultimo into v_ultimo;
  return 'SEN-' || v_mes || '-' || lpad(v_ultimo::text, 4, '0');
end;
$$;

-- Sembrar la secuencia continua con el máximo vigente por clave (no perder el 0095).
-- greatest() para no retroceder si la migración se re-aplica.
insert into public.fin_recibo_secuencias (clave, mes, ultimo)
select clave, 'siempre', max(ultimo)
from public.fin_recibo_secuencias
where mes <> 'siempre'
group by clave
on conflict (clave, mes)
do update set ultimo = greatest(public.fin_recibo_secuencias.ultimo, excluded.ultimo);
