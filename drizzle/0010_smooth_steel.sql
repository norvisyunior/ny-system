-- MO por unidad: la plantilla guardaba la MO TOTAL del último lote
-- ("última usada"); ahora guarda la tarifa POR UNIDAD. Se convierte con la
-- cantidad del último lote confirmado de cada material (rate = MO ÷ unidades).
UPDATE elaboration_templates
SET labor_cost_micro = CAST(
  ROUND(
    labor_cost_micro * 1000000.0 / (
      SELECT e.output_qty_micro
      FROM raw_elaborations e
      WHERE e.output_material_id = elaboration_templates.output_material_id
        AND e.status <> 'anulada'
      ORDER BY e.elaboration_date DESC, e.number DESC
      LIMIT 1
    )
  ) AS INTEGER
)
WHERE EXISTS (
  SELECT 1
  FROM raw_elaborations e
  WHERE e.output_material_id = elaboration_templates.output_material_id
    AND e.status <> 'anulada'
);
