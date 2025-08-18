import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { useNavigate } from "react-router-dom";




// Formateadores 🇨🇴
const fmtNum = (n, d = 0) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d })
    .format(Number.isFinite(+n) ? +n : 0);

const fmtDateTimeCO = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

export default function ConteoInventario({ role = "seller" }) {
  const isAdmin = role === "admin";

  // Vistas
  const [view, setView] = useState("list"); // list | detail

  // LISTA
  const [counts, setCounts] = useState([]); // [{id, fecha_revision, estado, created_at, created_by, created_by_name}]
  const [loadingList, setLoadingList] = useState(true);
  const [newDate, setNewDate] = useState("");
  const [msgList, setMsgList] = useState("");

  // DETALLE
  const [countId, setCountId] = useState(null);
  const [head, setHead] = useState(null); // {id, fecha_revision, estado, created_at, created_by, created_by_name}
  const [items, setItems] = useState([]); // [{id, product_id, stock_sistema, stock_fisico, diferencia}]
  const [products, setProducts] = useState([]); // [{id, name, sku}]
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [msgDetail, setMsgDetail] = useState("");

  const navigate = useNavigate();

  // Permisos por estado
  const canEdit = useMemo(() => {
    if (!head) return false;
    if (head.estado === "borrador") return true;        // seller/admin
    if (head.estado === "enviado") return isAdmin;      // solo admin
    return false;                                       // aplicado => solo lectura
  }, [head, isAdmin]);

  useEffect(() => {
  const before = () => document.body.classList.add("printing");
  const after  = () => document.body.classList.remove("printing");

  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);

  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
  };
}, []);

  // ===== Helpers: cargar nombres de perfiles para created_by =====
  async function injectCreatorNames(rows) {
    const ids = Array.from(new Set((rows || []).map(r => r.created_by).filter(Boolean)));
    if (ids.length === 0) return rows;

    const { data: profs, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    if (error) return rows;

    const map = Object.fromEntries(
      (profs || []).map(p => [p.id, (p.full_name && p.full_name.trim()) || p.email || p.id])
    );

    return (rows || []).map(r => ({
      ...r,
      created_by_name: map[r.created_by] || r.created_by || "—",
    }));
  }

  // =================== LISTA ===================
  async function loadList() {
    setLoadingList(true);
    setMsgList("");
    const { data, error } = await supabase
      .from("inventory_counts")
      .select("id, fecha_revision, estado, created_at, created_by")
      .order("id", { ascending: false });
    if (error) {
      setMsgList(error.message);
      setCounts([]);
      setLoadingList(false);
      return;
    }
    const withNames = await injectCreatorNames(data || []);
    setCounts(withNames);
    setLoadingList(false);
  }

  useEffect(() => { if (view === "list") loadList(); }, [view]);

  async function onDeleteCount(id) {
  if (!isAdmin) return;
  const row = counts.find(c => c.id === id);
  if (!row) return;

  if (!confirm(`¿Eliminar el conteo del ${row.fecha_revision} (estado: ${row.estado})? Esta acción no se puede deshacer.`)) return;

  const { error } = await supabase.from("inventory_counts").delete().eq("id", id);
  if (error) { alert(error.message); return; }
  loadList();
}


  async function createCount() {
    try {
      setMsgList("");
      if (!newDate) throw new Error("Selecciona la fecha de revisión.");

      // usuario actual para created_by
      const { data: userData, error: eUser } = await supabase.auth.getUser();
      if (eUser) throw eUser;
      const uid = userData?.user?.id || null;

      // 1) Crear encabezado en 'borrador'
      const { data: header, error: eHead } = await supabase
        .from("inventory_counts")
        .insert([{ fecha_revision: newDate, estado: "borrador", created_by: uid }])
        .select("id, fecha_revision, estado, created_at, created_by")
        .single();
      if (eHead) throw eHead;

      // 2) Productos activos
      const { data: prods, error: eProds } = await supabase
        .from("products")
        .select("id, name, sku, stock, active")
        .eq("active", true)
        .order("name", { ascending: true });
      if (eProds) throw eProds;

      // 3) Insertar líneas (snapshot)
      const payload = (prods || []).map(p => ({
        count_id: header.id,
        product_id: p.id,
        stock_sistema: Number(p.stock) || 0,
        stock_fisico: null, // pon null si prefieres a ciegas
        diferencia: null,
      }));
      if (payload.length) {
        const { error: eLines } = await supabase.from("inventory_count_items").insert(payload);
        if (eLines) throw eLines;
      }

      setNewDate("");

      // Abrir detalle
      openDetail(header.id);
    } catch (err) {
      setMsgList(err.message || String(err));
    }
  }

  // =================== DETALLE ===================
  async function openDetail(id) {
    setView("detail");
    setMsgDetail("");
    setSaving(false);
    setCountId(id);

    // header
    const { data: h, error: eH } = await supabase
      .from("inventory_counts")
      .select("id, fecha_revision, estado, created_at, created_by")
      .eq("id", id)
      .single();
    if (eH) { setMsgDetail(eH.message); return; }

    // nombre creador
    let created_by_name = "—";
    if (h?.created_by) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", h.created_by)
        .single();
      created_by_name = (prof?.full_name && prof.full_name.trim()) || prof?.email || h.created_by;
    }
    setHead({ ...h, created_by_name });

    // catálogo productos
    const { data: prods } = await supabase.from("products").select("id, name, sku");
    setProducts(prods || []);

    // líneas
    const { data: lines, error: eL } = await supabase
      .from("inventory_count_items")
      .select("id, product_id, stock_sistema, stock_fisico, diferencia")
      .eq("count_id", id)
      .order("id", { ascending: true });
    if (eL) { setMsgDetail(eL.message); return; }

    setItems(lines || []);
  }

  const pmap = useMemo(
    () => Object.fromEntries((products || []).map(p => [p.id, p])),
    [products]
  );

  const filteredItems = useMemo(() => {
    if (!q.trim()) return items;
    const qq = q.toLowerCase();
    return items.filter(it => {
      const p = pmap[it.product_id];
      return [p?.name, p?.sku].filter(Boolean).some(t => String(t).toLowerCase().includes(qq));
    });
  }, [q, items, pmap]);

  function setFisico(lineId, val) {
    const v = Number(val);
    setItems(prev => prev.map(it => {
      if (it.id !== lineId) return it;
      const dif = (Number.isFinite(v) ? v : 0) - (Number(it.stock_sistema) || 0);
      return { ...it, stock_fisico: Number.isFinite(v) ? v : it.stock_fisico, diferencia: dif };
    }));
  }

  // Guarda en BD con UPDATE por fila y vuelve a leer
  // Actualiza una fila del detalle y, si cambia stock_fisico, recalcula la diferencia en el front
function updateRow(id, field, raw) {
  const val = raw === "" ? "" : raw.replace(/[^\d-]/g, ""); // solo números y posible "-"
  setItems(prev =>
    prev.map(it => {
      if (it.id !== id) return it;

      // valor limpio a número si no está vacío
      const num = val === "" ? null : Number(val);

      // si editan stock_fisico, calculamos diferencia en el front
      if (field === "stock_fisico") {
        const dif =
          val === ""
            ? ""                       // vacío visualmente
            : (Number(num) - Number(it.stock_sistema) || 0); // cálculo front
        return { ...it, stock_fisico: num, diferencia: dif };
      }

      // si algún día permites escribir la diferencia manualmente (ahora la dejamos readonly),
      // podrías manejar aquí 'diferencia' cuando field === "diferencia".
      return { ...it, [field]: num };
    })
  );
}

  async function saveDraft() {
  try {
    setSaving(true);
    setMsgDetail("");

    const updates = items.map(it => ({
      id: it.id,
      stock_fisico: it.stock_fisico === null || it.stock_fisico === ""
      ? null : Number(it.stock_fisico),
      diferencia: it.stock_fisico === null || it.stock_fisico === ""
  ? null
  : (Number(it.stock_fisico) || 0) - (Number(it.stock_sistema) || 0),
    }));

    const results = await Promise.all(
      updates.map(u =>
        supabase
          .from("inventory_count_items")
          .update({ stock_fisico: u.stock_fisico, diferencia: u.diferencia })
          .eq("id", u.id)
      )
    );
    const firstError = results.find(r => r.error)?.error;
    if (firstError) throw firstError;

    // Releer para confirmar
    const { data: lines, error: eL } = await supabase
      .from("inventory_count_items")
      .select("id, product_id, stock_sistema, stock_fisico, diferencia")
      .eq("count_id", countId)
      .order("id", { ascending: true });
    if (eL) throw eL;

    setItems(lines || []);
    alert("Borrador guardado");
     setSaving(false);
    return true;  // ⬅️ importante: éxito
  } catch (err) {
    setSaving(false);
    setMsgDetail(err.message || String(err));
    return false; // ⬅️ importante: fallo
  }
}


  // Cambia a ENVIADO (bloquea seller; admin aún puede editar)
  async function sendFinal() {
  try {
    setSaving(true);
    setMsgDetail("");

    // Guardar borrador primero (auto-save)
    const ok = await saveDraft();
    if (!ok) { setSaving(false); return; }

    // Cambiar a ENVIADO
    const { error } = await supabase
      .from("inventory_counts")
      .update({ estado: "enviado" })
      .eq("id", countId);
    if (error) throw error;

    setHead(h => ({ ...h, estado: "enviado" }));
    alert("Borrador guardado");
   
    setSaving(false);
  } catch (err) {
    setSaving(false);
    setMsgDetail(err.message || String(err));
  }
}

  // Reabrir a BORRADOR (solo admin)
  async function reopenDraft() {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setMsgDetail("");
      const { error } = await supabase
        .from("inventory_counts")
        .update({ estado: "borrador" })
        .eq("id", countId);
      if (error) throw error;
      setHead(h => ({ ...h, estado: "borrador" }));
      setSaving(false);
    } catch (err) {
      setSaving(false);
      setMsgDetail(err.message || String(err));
    }
  }

  // Aplicar (marca aplicado; no ajusta stock aún)
async function applyCount() {
  if (!isAdmin) return;
  try {
    setSaving(true);
    setMsgDetail("");

    // 1) Guarda por si hay cambios sin persistir
    const ok = await saveDraft();
    if (!ok) { setSaving(false); return; }

    // 2) Relee las líneas del conteo para aplicar el físico
    const { data: lines, error: eL } = await supabase
      .from("inventory_count_items")
      .select("product_id, stock_sistema, stock_fisico")
      .eq("count_id", countId);
    if (eL) throw eL;

    // 3) Actualiza el stock de cada producto al stock_fisico (o stock_sistema si es nulo)
    const results = await Promise.all(
      (lines || []).map(l => {
        const newStock = Number.isFinite(Number(l.stock_fisico))
          ? Number(l.stock_fisico)
          : Number(l.stock_sistema) || 0;
        return supabase
          .from("products")
          .update({ stock: newStock })
          .eq("id", l.product_id);
      })
    );
    const firstError = results.find(r => r.error)?.error;
    if (firstError) throw firstError;

    // 4) Marca el conteo como aplicado
    const { error: eUp } = await supabase
      .from("inventory_counts")
      .update({ estado: "aplicado" })
      .eq("id", countId);
    if (eUp) throw eUp;

    setHead(h => ({ ...h, estado: "aplicado" }));
    setSaving(false);
    alert("Stock actualizado y conteo aplicado.");
  } catch (err) {
    setSaving(false);
    setMsgDetail(err.message || String(err));
  }
}


  // =================== RENDER ===================
  if (view === "list") {
    return (
      <div className="page">
        <div className="card">
          <h2>Conteos de inventario</h2>
          <p className="subtitle" style={{ marginTop: 6 }}>
            Flujo: <b>Borrador</b> (edita seller) → <b>Enviado</b> (bloquea seller) → <b>Aplicado</b> (cierra).
          </p>

          <div className="grid" style={{ gridTemplateColumns: "1fr auto", gap: 10, marginTop: 12 }}>
            <div>
              <label className="subtitle">Fecha de revisión</label>
              <input type="date" className="input" value={newDate} onChange={(e)=>setNewDate(e.target.value)} />
            </div>
            <button className="btn brand" onClick={createCount} disabled={!newDate}>Nuevo conteo</button>
          </div>

          {msgList && <div style={{ color:"crimson", marginTop: 8 }}>{msgList}</div>}
        </div>

        <div className="card">
          <h3>Historial</h3>
          {loadingList ? (
            <div style={{ padding: 8 }}>Cargando…</div>
          ) : counts.length === 0 ? (
            <div className="subtitle" style={{ padding: 8 }}>Aún no hay conteos.</div>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
  <tr style={{ textAlign:"left", borderBottom:"1px solid var(--border)" }}>
    <th style={{ padding:"8px 6px" }}>ID</th>
    {/* ↓ Eliminada la columna 'Fecha' */}
    <th style={{ padding:"8px 6px" }}>Estado</th>
    <th style={{ padding:"8px 6px" }}>Hecho por</th>
    <th style={{ padding:"8px 6px" }}>Creado</th>
    <th style={{ padding:"8px 6px" }}></th>
  </tr>
</thead>

             <tbody>
  {counts.map(c => (
    <tr key={c.id} style={{ borderBottom:"1px solid var(--border)" }}>
      <td style={{ padding:"8px 6px" }}>#{c.id}</td>
      {/* ↓ Eliminada la celda de 'Fecha' */}
      <td style={{ padding:"8px 6px", textTransform:"capitalize" }}>{c.estado}</td>
      <td style={{ padding:"8px 6px" }}>{c.created_by_name || "—"}</td>
      <td style={{ padding:"8px 6px" }}>{fmtDateTimeCO(c.created_at)}</td>
      <td style={{ padding:"8px 6px" }}>
        <div className="stack">
          <button className="btn" onClick={()=>openDetail(c.id)}>Abrir</button>
          {isAdmin && (
            <button className="btn" onClick={()=>onDeleteCount(c.id)}>Eliminar</button>
          )}
        </div>
      </td>
    </tr>
  ))}
</tbody>

              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  const totalDif = items.reduce((s, it) => s + (Number(it.diferencia) || 0), 0);





  return (
    


    <div className="page">
      <div className="card">
        {/* ----- NO IMPRIMIR: header + barra de acciones ----- */}

  {/* Header: volver + datos del conteo */}
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    }}
  >
    <button className="btn no-print" onClick={() => setView("list")}>← Volver</button>
    <h2 className="print-keep" style={{ margin: 0 }}>Conteo #{head?.id}</h2>
    <span className="subtitle print-keep">Fecha: {head?.fecha_revision}</span>
    <span className="subtitle print-keep">
      Estado: <b style={{ textTransform: "capitalize" }}>{head?.estado}</b>
    </span>
    <span className="subtitle print-keep">Hecho por: <b>{head?.created_by_name || "-"}</b></span>
    <span className="subtitle print-keep">Creado: {fmtDateTimeCO(head?.created_at)}</span>
  </div>

  {/* Barra: buscador + botones */}
  <div className="no-print" style={{ marginTop:8 }}>
  <div
    className="grid"
    style={{ gridTemplateColumns: "1fr auto auto auto auto auto", gap: 8, marginTop: 8 }}
  >
    <input
      className="input"
      placeholder="Buscar producto o SKU"
      value={q}
      onChange={(e) => setQ(e.target.value)}
    />

    <button className="btn" onClick={saveDraft} disabled={!canEdit || saving}>
      Guardar borrador
    </button>

    {head?.estado === "borrador" && (
      <button className="btn brand" onClick={sendFinal} disabled={saving}>
        Enviar inventario
      </button>
    )}

    {isAdmin && head?.estado === "enviado" && (
      <button className="btn" onClick={reopenDraft} disabled={saving}>
        Reabrir
      </button>
    )}

    {isAdmin && head?.estado !== "aplicado" && (
      <button className="btn" onClick={applyCount} disabled={saving}>
        Aplicar
      </button>
    )}

    <button className="btn" onClick={() => window.print()}>
      Imprimir
    </button>
  </div>
</div>
{/* ----- FIN no-print ----- */}


        {msgDetail && <div style={{ color:"crimson", marginTop: 6 }}>{msgDetail}</div>}
      </div>

      <div className="card">
        <h3>Productos</h3>
        <div style={{ overflowX:"auto", marginTop: 8 }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ textAlign:"left", borderBottom:"1px solid var(--border)" }}>
                <th style={{ padding:"8px 6px" }}>Producto</th>
                <th style={{ padding:"8px 6px" }}>SKU</th>
                <th style={{ padding:"8px 6px" }}>Stock sistema</th>
                <th style={{ padding:"8px 6px" }}>Stock físico</th>
                <th style={{ padding:"8px 6px" }}>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(it => {
                const p = pmap[it.product_id];
                return (
                  <tr key={it.id} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:"8px 6px" }}>{p?.name || `#${it.product_id}`}</td>
                    <td style={{ padding:"8px 6px" }}>{p?.sku || "—"}</td>
                    <td style={{ padding:"8px 6px" }}>{fmtNum(it.stock_sistema)}</td>
                    <td style={{ padding:"8px 6px" }}>
                      {canEdit ? (
                        <input
                          className="box-input"
                          style={{ width: 120 }}
                          type="number"
                          min="0"
                          value={Number.isFinite(it.stock_fisico) ? it.stock_fisico : ""}
                          onChange={(e)=>setFisico(it.id, e.target.value === "" ? null : e.target.value)}
                        />
                      ) : (
                        fmtNum(it.stock_fisico)
                      )}
                    </td>
                    <td style={{ padding:"8px 6px", fontWeight: 600 }}>
                        <input
                          className="box-imput"
                          type="number"
                          readOnly
                          value={
                            it.stock_fisico != null && it.stock_fisico !==""
                            ? Number(it.stock_fisico) - Number(it.stock_sistema || 0)
                            : ""
                          }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td></td><td></td><td></td>
                <td style={{ padding:"8px 6px", fontWeight:700 }}>Total diferencia</td>
                <td style={{ padding:"8px 6px", fontWeight:700 }}>{fmtNum(totalDif)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
