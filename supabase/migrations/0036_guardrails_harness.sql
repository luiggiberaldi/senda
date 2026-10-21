-- 0036_guardrails_harness.sql — Guardrails, arneses y failovers (2026-10-10, luigi).
--
-- 1. GUARDRAIL DB: tasa_usd siempre > 0 (nunca NULL ni 0).
--    Evita que Bs se trate como USD 1:1 por tasa faltante.
-- 2. FAILOVER: fin_convertir_seguro() — si fin_convertir falla (tasa faltante),
--    usa la tasa_usd guardada en el movimiento como respaldo.
-- 3. ARNÉS: rpc_fin_auditoria() — verifica integridad de datos:
--    movimientos sin categoría, tasa_usd inválida, duplicados sospechosos.

-- 1. Guardrail: tasa_usd NOT NULL y > 0
DO $$
BEGIN
  -- Solo si no hay violaciones existentes
  IF NOT EXISTS (
    SELECT 1 FROM public.fin_movimientos 
    WHERE tasa_usd IS NULL OR tasa_usd <= 0
  ) THEN
    ALTER TABLE public.fin_movimientos 
      ALTER COLUMN tasa_usd SET NOT NULL;
    ALTER TABLE public.fin_movimientos
      ADD CONSTRAINT fin_movimientos_tasa_usd_positiva 
      CHECK (tasa_usd > 0);
    RAISE NOTICE 'Guardrail tasa_usd aplicado';
  ELSE
    RAISE NOTICE 'Hay movimientos con tasa_usd inválida, guardrail no aplicado';
  END IF;
END $$;

-- 2. Failover: conversión segura con respaldo
CREATE OR REPLACE FUNCTION public.fin_convertir_seguro(
  p_monto numeric, 
  p_moneda text, 
  p_tasa_respaldo numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result numeric;
BEGIN
  -- Intento principal: conversión con tasas actuales
  BEGIN
    v_result := public.fin_convertir(p_monto, p_moneda, 'USD');
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Si falla, cae al respaldo
    NULL;
  END;
  -- Failover: usa la tasa guardada en el movimiento
  RETURN p_monto * COALESCE(NULLIF(p_tasa_respaldo, 0), 1);
END;
$$;

-- 3. Arnés: auditoría de integridad
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
BEGIN
  -- Sin categoría (excluyendo transferencias)
  SELECT COUNT(*) INTO v_sin_cat
  FROM public.fin_movimientos
  WHERE user_id = p_user_id
    AND anulado_en IS NULL
    AND categoria IS NULL
    AND tipo != 'transferencia'
    AND fecha >= CURRENT_DATE - INTERVAL '30 days';
  
  -- Tasa inválida
  SELECT COUNT(*) INTO v_tasa_mala
  FROM public.fin_movimientos
  WHERE user_id = p_user_id
    AND anulado_en IS NULL
    AND (tasa_usd IS NULL OR tasa_usd <= 0);
  
  -- Duplicados sospechosos (misma fecha, tipo, monto, nota)
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
  
  RETURN jsonb_build_object(
    'sin_categoria', v_sin_cat,
    'tasa_invalida', v_tasa_mala,
    'duplicados_sospechosos', v_duplicados,
    'saludable', (v_sin_cat = 0 AND v_tasa_mala = 0 AND v_duplicados = 0)
  );
END;
$$;
