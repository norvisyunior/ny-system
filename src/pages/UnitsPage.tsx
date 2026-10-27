import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
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
  longitud: "Longitud (distancia)",
  conteo: "Conteo (piezas)",
};

function UnitConverter({ units }: { units: Unit[] }) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("kg");
  const [to, setTo] = useState("lb");
  // Sin unidades de conteo: el sistema no las convierte entre sí.
  const convertible = units.filter((u) => u.dimension !== "conteo");
  const fromU = convertible.find((u) => u.code === from) ?? convertible[0];
  const toU = convertible.find((u) => u.code === to);
  // Misma dimensión que el origen.
  const toOptions = convertible.filter((u) => fromU != null && u.dimension === fromU.dimension);
  const compatible = fromU != null && toU != null && toOptions.some((o) => o.code === to);

  // Al cambiar el origen, si el destino deja de ser convertible se elige otro de la misma dimensión.
  const changeFrom = (code: string) => {
    setFrom(code);
    const nu = convertible.find((u) => u.code === code);
    if (!nu) {
      setTo(code);
      return;
    }
    setTo((prev) => {
      const pu = convertible.find((u) => u.code === prev);
      if (pu && pu.dimension === nu.dimension && prev !== code) {
        return prev;
      }
      const alt = convertible.find(
        (u) => u.dimension === nu.dimension && u.code !== code && u.code !== prev,
      );
      return alt?.code ?? prev;
    });
  };

  const n = Number(amount.trim().replace(",", "."));
  const result =
    compatible && fromU != null && toU != null && Number.isFinite(n) && n > 0
      ? (n * fromU.factor) / toU.factor
      : null;

  return (
    <div className="card p-4">
      <h2 className="text-[14px] font-bold text-slate-800">Calculadora de unidades</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="field w-32">
          <label htmlFor="u-amount">Cantidad</label>
          <input
            id="u-amount"
            inputMode="decimal"
            placeholder="Ej. 55"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="field w-44">
          <label htmlFor="u-from">De</label>
          <select id="u-from" value={fromU?.code ?? ""} onChange={(e) => changeFrom(e.target.value)}>
            {convertible.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code} — {u.label}
              </option>
            ))}
          </select>
        </div>
        <ArrowRight size={16} className="mb-2.5 shrink-0 text-slate-300" aria-hidden="true" />
        <div className="field w-44">
          <label htmlFor="u-to">A</label>
          <select id="u-to" value={toU?.code ?? ""} onChange={(e) => setTo(e.target.value)}>
            {convertible.map((u) => {
              const ok = fromU != null && u.dimension === fromU.dimension;
              return (
                <option key={u.code} value={u.code} disabled={!ok}>
                  {u.code} — {u.label}
                </option>
              );
            })}
          </select>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Resultado
          </div>
          <div className="text-[17px] font-extrabold tabular-nums tracking-tight text-slate-800">
            {result == null ? "—" : `${result.toLocaleString("es-ES", { maximumFractionDigits: 4 })} ${to}`}
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-[11px] text-slate-400">
        Usa los mismos factores del sistema: masa (kg · g · lb), volumen (l · ml) y longitud
        (m · cm · mm). Las unidades de conteo (unidad, paquete, caja) no se convierten: cada
        ítem se mide en su unidad base.
      </p>
    </div>
  );
}

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
      {units.length > 0 && (
        <div className="mt-4">
          <UnitConverter units={units} />
        </div>
      )}
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
