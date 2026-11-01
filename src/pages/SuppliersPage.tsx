import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { Badge, Callout, ErrorAlert, FlowGuide, Modal, SearchInput } from "../components/ui";
import { usePaged } from "../hooks/usePaged";

interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: number | boolean;
}

const EMPTY = { name: "", phone: "", address: "", notes: "", active: true };

export function SuppliersPage() {
  const list = usePaged<Supplier>(({ page, pageSize, search }) =>
    api.get(
      `/suppliers?page=${page}&pageSize=${pageSize}` +
        (search ? `&q=${encodeURIComponent(search)}` : ""),
    ),
  );
  const rows = list.rows;
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setForm(EMPTY);
    setEditing("new");
    setError(null);
  };
  const openEdit = (s: Supplier) => {
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
      active: Boolean(s.active),
    });
    setEditing(s.id);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        phone: form.phone || null,
        address: form.address || null,
        notes: form.notes || null,
        active: form.active,
      };
      if (editing !== null && editing !== "new") await api.put(`/suppliers/${editing}`, body);
      else await api.post("/suppliers", body);
      toast.success(editing !== null && editing !== "new" ? "Proveedor actualizado" : "Proveedor creado");
      setEditing(null);
      setForm(EMPTY);
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Maestro de proveedores de materias primas"
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            + Nuevo proveedor
          </button>
        }
      />
      <FlowGuide current="catalogos" />
      <Callout tone="tip" title="Solo nombres, sin códigos">
        El proveedor se elige al registrar una compra y aparece en el reporte de compras. Su
        nombre es único y el ID lo asigna el sistema.
      </Callout>
      <div className="mb-4 flex items-center justify-between">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Buscar proveedor..." />
        <span className="text-sm text-slate-500">{list.total} registro(s)</span>
      </div>

      <div className="card overflow-hidden overflow-x-auto">
        <table className="table-ny">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Dirección</th>
              <th className="center">Estado</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  {list.loading ? "Cargando…" : "Sin proveedores registrados."}
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td>{s.phone ?? "—"}</td>
                <td>{s.address ?? "—"}</td>
                <td className="center">
                  {s.active ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}
                </td>
                <td className="text-right">
                  <button className="btn btn-secondary" onClick={() => openEdit(s)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 pb-3">
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            pageSize={list.pageSize}
            rowsCount={rows.length}
            onPage={list.setPage}
            label="proveedores"
          />
        </div>
      </div>

      {editing !== null && (
        <Modal
          title={editing === "new" ? "Nuevo proveedor" : "Editar proveedor"}
          onClose={() => setEditing(null)}
        >
          <div className="flex flex-col gap-3">
            <ErrorAlert message={error} />
            <div className="field">
              <label>Nombre *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Teléfono</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Estado</label>
                <select
                  value={form.active ? "1" : "0"}
                  onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}
                >
                  <option value="1">Activo</option>
                  <option value="0">Inactivo</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Dirección</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
