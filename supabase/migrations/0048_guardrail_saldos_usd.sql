-- 0048: Guardrails para saldos en USD (2026-10-11, luigi).
--
-- Contexto: el 2026-10-11 luigi detectó que el BDV mostraba Bs 63,69 = $3,2.
-- Causa: fin_saldos.saldo_usd sumaba cada movimiento a SU tasa histórica
-- (costo histórico), no el valor del saldo a tasa actual. Se corrigió en 0047.
--
-- Guardrails nuevos en rpc_fin_auditoria():
-- 1. saldos_descuadrados: recalcula el saldo_usd esperado de cada cuenta de
--    forma INDEPENDIENTE (desde movimientos crudos + fin_convertir a tasa
--    actual) y lo compara con lo que reporta la vista fin_saldos. Si una
--    futura migración revierte la vista al método histórico, esto lo detecta.
--    Tolerancia: diferencia absoluta > $0,05.
-- 2. tasa_desactualizada: la última fila de fin_tasas debe haberse actualizado
--    en las últimas 48h. Tasas vencidas = conversiones USD que se desvían
--    en silencio.

CREATE OR REPLACE FUNCTION public.rpc_fin_auditoria(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sin_cat int;
  v_tasa_mala int;
  v_duplicados int;
  v_saldos_malos int;
  v_saldos_detalle jsonb;
  v_tasa_vieja boolean;
  v_tasa_fecha timestamptz;
BEGIN
  -- Sin categoría (excluyendo transferencias), últimos 30 días
  SELECT COUNT(*) INTO v_sin_cat
  FROM public.fin_movimientos
  WHERE user_id = p_user_id
    AND anulado_en IS NULL
    AND categoria IS NULL
    AND tipo != 'transferencia'
    AND fecha >= CURRENT_DATE - INTERVAL '30 days';

  -- Tasa inválida en movimientos
  SELECT COUNT(*) INTO v_tasa_mala
  FROM public.fin_movimientos
  WHERE user_id = p_user_id
    AND anulado_en IS NULL
    AND (tasa_usd IS NULL OR tasa_usd <= 0);

  -- Duplicados sospechosos (misma fecha, tipo, monto, nota), últimos 30 días
  SELECT COUNT(*) INTO v_duplicados
  FROM (
    SELECT fecha, tipo, monto, nota, COUNT(*) as n
    FROM public.fin_movimientos
    WHERE user_id = p_user_id
      AND anulado_en IS NULL
      AND fecha >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY fecha, tipo, monto, nota
    HAVING COUNT(*) > 1
  ) d;

  -- Guardrail 1: saldos USD a tasa actual (recomputo independiente)
  WITH saldos AS (
    SELECT
      c.id AS cuenta_id,
      c.nombre,
      c.moneda,
      COALESCE(SUM(CASE
        WHEN m.tipo = 'ingreso' THEN m.monto
        WHEN m.tipo = 'egreso' THEN -m.monto
        WHEN m.tipo = 'transferencia' AND m.cuenta_id = c.id THEN -m.monto
        WHEN m.tipo = 'transferencia' AND m.cuenta_destino_id = c.id THEN m.monto_destino
        ELSE 0
      END), 0)::numeric(18,2) AS saldo_moneda
    FROM public.fin_cuentas c
    LEFT JOIN public.fin_movimientos m
      ON (m.cuenta_id = c.id OR m.cuenta_destino_id = c.id)
      AND m.anulado_en IS NULL
    WHERE NOT c.archivada
      AND (c.user_id = p_user_id
        OR (c.hogar_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.hogar_miembros hm
          WHERE hm.hogar_id = c.hogar_id AND hm.user_id = p_user_id)))
    GROUP BY c.id, c.nombre, c.moneda
  ),
  chequeo AS (
    SELECT
      s.nombre,
      s.moneda,
      s.saldo_moneda,
      v.saldo_usd AS vista_usd,
      public.fin_convertir(s.saldo_moneda, s.moneda, 'USD')::numeric(18,2) AS esperado_usd
    FROM saldos s
    JOIN public.fin_saldos v ON v.cuenta_id = s.cuenta_id
  )
  SELECT
    COUNT(*) FILTER (
      WHERE ABS(COALESCE(vista_usd, 0) - COALESCE(esperado_usd, 0)) > 0.05
    ),
    COALESCE(jsonb_agg(jsonb_build_object(
      'cuenta', nombre, 'moneda', moneda,
      'saldo_moneda', saldo_moneda,
      'vista_usd', vista_usd, 'esperado_usd', esperado_usd
    )) FILTER (
      WHERE ABS(COALESCE(vista_usd, 0) - COALESCE(esperado_usd, 0)) > 0.05
    ), '[]'::jsonb)
  INTO v_saldos_malos, v_saldos_detalle
  FROM chequeo;

  -- Guardrail 2: tasa actualizada (últimas 48h)
  SELECT MAX(updated_at) INTO v_tasa_fecha FROM public.fin_tasas;
  v_tasa_vieja := (v_tasa_fecha IS NULL OR v_tasa_fecha < NOW() - INTERVAL '48 hours');

  RETURN jsonb_build_object(
    'sin_categoria', v_sin_cat,
    'tasa_invalida', v_tasa_mala,
    'duplicados_sospechosos', v_duplicados,
    'saldos_descuadrados', v_saldos_malos,
    'saldos_detalle', v_saldos_detalle,
    'tasa_desactualizada', v_tasa_vieja,
    'saludable', (v_sin_cat = 0 AND v_tasa_mala = 0 AND v_duplicados = 0
                  AND v_saldos_malos = 0 AND NOT v_tasa_vieja)
  );
END;
$$;
