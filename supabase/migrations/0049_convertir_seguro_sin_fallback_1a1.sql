-- 0049: fin_convertir_seguro() sin fallback 1:1 (2026-10-15).
--
-- Contexto: la versión creada en 0036 terminaba con
--   RETURN p_monto * COALESCE(NULLIF(p_tasa_respaldo, 0), 1);
-- Si la tasa de respaldo venía NULL o 0, la función asumía conversión 1:1
-- en silencio, violando la regla permanente "el coach nunca asume 1:1"
-- ($, Bs y USDT no son lo mismo; luigi, 2026-10-10).
--
-- Cambio: el failover solo aplica con tasa de respaldo válida (> 0).
-- Sin tasa válida devuelve NULL (un honesto "no sé") en vez de inventar
-- un número. Quien llame debe tratar el NULL como "sin conversión posible".
--
-- Nota: la función hoy no tiene llamadas en producción (solo existe como
-- utilitaria de respaldo), así que el cambio no altera ningún cálculo
-- existente. Se mantiene sin SECURITY DEFINER como en 0036 (sin cambio
-- de postura de seguridad en esta migración).

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
  -- Failover: SOLO con tasa de respaldo válida (> 0).
  -- Sin tasa válida: NULL. Nunca 1:1.
  IF p_tasa_respaldo IS NOT NULL AND p_tasa_respaldo > 0 THEN
    RETURN p_monto * p_tasa_respaldo;
  END IF;
  RETURN NULL;
END;
$$;
