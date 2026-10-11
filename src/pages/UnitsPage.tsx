import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Badge, Callout, FlowGuide } from "../components/ui";

interface Unit {
  code: string;
  label: string;
  dimension: string;
  factor: number;
  isBase: boolean;
}

const DIM_LABEL: Record<string, string> = {
  masa: "Masa (peso)",
  volumen: "Volumen",
  conteo: "Conteo (piezas)",
};

export function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  useEffect(() => {
    api.get<Unit[]>("/units").then(setUnits).catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHeader
        title="Unidades de medida"
        subtitle="Conversiones seguras dentro de cada dimensión; las unidades de conteo no se convierten entre sí"
      />
      <FlowGuide current="catalogos" />
      <Callout tone="neutral" title="Unidades internas, no códigos que se digiten">
        Aquí solo consulta las unidades que ya trae el sistema (kg, g, lb, l, ml, unidad,
        paquete, caja) y su factor hacia la unidad base. En el resto de la app se eligen de una
        lista, así que nunca hace falta recordar códigos. Las unidades de conteo no se convierten
        entre sí.
      </Callout>
      <div className="card overflow-hidden">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Dimensión</th>
              <th className="num">Equivalencia</th>
              <th>Base</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.code}>
                <td className="font-mono font-semibold">{u.code}</td>
                <td>{u.label}</td>
                <td>{DIM_LABEL[u.dimension] ?? u.dimension}</td>
                <td className="num">
                  1 {u.code} = {(u.factor / 1_000_000).toLocaleString("es-ES")}{" "}
                  {units.find((x) => x.dimension === u.dimension && x.isBase)?.code ?? ""}
                </td>
                <td>{u.isBase ? <Badge tone="blue">Base</Badge> : <Badge>Derivada</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Ejemplos: 1 kg = 1000 g · 1 lb = 0.453592 kg · 1 litro = 1000 ml. Las unidades
        paquete/caja/unidad no se convierten automáticamente: cada material se mide en su
        unidad base para evitar errores de conversión.
      </p>
    </div>
  );
}
