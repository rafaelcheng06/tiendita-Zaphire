// src/Reportes.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { fmtDateTimeCO, fmtMoney, zFromLocalDate, zToLocalDate,listLastQuincenas, zToLocalDateEnd } from "./lib/format";


/** Utilidad: agrupa por clave */
function groupBy(xs, fnKey) {
  const map = new Map();
  xs.forEach((x) => {
    const k = fnKey(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  });
  return map;
}

function Tabs({ mode, setMode }) {
  const Tab = ({ id, label }) => (
    <button
      className={`btn ${mode === id ? "brand" : ""}`}
      onClick={() => setMode(id)}
      style={{ marginRight: 8 }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ marginBottom: 16 }}>
      <Tab id="ventas" label="Reporte por ventas" />
      <Tab id="cliente" label="Reporte por cliente" />
      <Tab id="producto" label="Reporte por producto" />
    </div>
  );
}

export default function Reportes() {
  const [mode, setMode] = useState("ventas");

  // rango por defecto: últimos ~13 días
  const today = new Date();
  const d2 = today.toISOString().slice(0, 10);
  const d1 = new Date(today.getTime() - 12 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);


  // data principal de “Ventas”
  const [rows, setRows] = useState([]); // [{id, created_at, total, customer_id, sold_by, items:[{product_id, qty, price, products:{name}}], customer_name, seller_name}]
  const [total, setTotal] = useState(0);

  // Mapas de lookup
  const [customersMap, setCustomersMap] = useState(new Map()); // id -> name
  const [sellerMap, setSellerMap] = useState(new Map());       // uuid -> full_name/email

  // ------- estado para "Por cliente" (resumen) -------
  // (Se calcula desde rows con useMemo → porCliente)
  // ------- estado para "Detalle por cliente" ---------
  const [detailClient, setDetailClient] = useState({ openForId: null, openForName: null, rows: [] });
  const [edit, setEdit] = useState({}); // { [sale_item_id]: { qty, price } }
  const [saving, setSaving] = useState(false);
  const [msgDetail, setMsgDetail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [periods, setPeriods] = useState([]);   // lista de quincenas
  const [periodId, setPeriodId] = useState(""); // quincena seleccionada
  const [from, setFrom]= useState("");
  const [to, setTo]= useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState();

  const [sales, setSales] = useState([]);


  
  
  // ============ FETCH: VENTAS ENTRE FECHAS ============
async function fetchSales() {
  setError("");
  setLoading(true);
  try {
    if (!from || !to) {
      setError("Selecciona una quincena.");
      setLoading(false);
      return;
    }

    // Convierte YYYY-MM-DD -> ISO UTC (zona Bogotá)
    const zFrom = zFromLocalDate(from);
    const zTo   = zToLocalDateEnd(to);

    console.log("DEBUG rango:", { from, to, zFrom, zTo, periodId });

    const { data: sales, error: eSales } = await supabase
  .from("sales")
  .select(`
    id, created_at, total,
    customer_id,
    customer:customers(name),
    seller:profiles(full_name),
    items:sale_items(
      qty, price, subtotal, product_id,
      product:products(name, sku)
    )
  `)
  .gte("created_at", zFrom)
  .lt("created_at", zTo)
  .order("created_at", { ascending: true });

    if (eSales) throw eSales;

    // Construir filas para la tabla
    const mappedRows = (sales ?? []).map(s => ({
      id: s.id,
      created_at: s.created_at,
      customer_id: s.customer_id,
      customer_name: s.customer? s.customer.name : "—",
      seller_name: s.seller?s.seller.full_name : "—",
      items: s.items || [],
      total: Number(s.total ?? 0),
    }));

    // Actualizar el estado que tu tabla ya usa (usa setRows o setSales según corresponda en tu código)
    
    setRows(mappedRows);
    setTotal(mappedRows.reduce((sum,r) => sum + r.total,0));

  } catch (err) {
    console.error(err);
    setError("No se pudieron cargar las ventas.");
  } finally {
    setLoading(false);
  }
}

  // -------- obtener rol para habilitar edición en detalle --------
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: prof } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        setIsAdmin((prof?.role || "").toLowerCase() === "admin");
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);


// -- Construir quincenas (1–15 y 16–fin de mes) a partir de las ventas --
useEffect(() => {
  let cancelled = false;

  (async () => {
    // Trae solo las fechas de venta (ordenadas, para que el set conserve "recientes primero")
    const { data, error } = await supabase
      .from("sales")
      .select("created_at")
      .order("created_at", { ascending: false });

    if (error || !data) {
      console.error("No se pudieron cargar ventas para armar quincenas:", error);
      if (!cancelled) setPeriods([]);
      return;
    }

    // Helper: convierte un ISO a fecha en zona Bogotá (YYYY, M, D)
    const toCO = (iso) => {
      // Crea una fecha "localizada" a America/Bogota sin librerías externas
      const d = new Date(iso);
      d.setUTCHours(d.getUTCHours()-5);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; // m: 0..11
    };

    // Helper: para (y,m,d) devuelve {start,end} como "YYYY-MM-DD" (zona local CO)
    // Helper: para (y,m,d) devuelve {start,end} como "YYYY-MM-DD"
// Para (y,m,d) devuelve { start, end } como "YYYY-MM-DD" (en zona local CO)
const boundsFor = ({ y, m, d }) => {
  const pad = (n) => String(n).padStart(2, "0");

  // Primer tramo: 01–15, Segundo tramo: 16–fin de mes
  const startDay = (d <= 15) ? 1 : 16;
  const endDay   = (d <= 15) ? 15 : new Date(y, m + 1, 0).getDate(); // último día del mes

  const start = `${y}-${pad(m + 1)}-${pad(startDay)}`;
  const end   = `${y}-${pad(m + 1)}-${pad(endDay)}`;
  return { start, end };
};

    // Usamos un Map para evitar duplicados y conservar orden (reciente → antiguo)
    const map = new Map(); // key = `${start}|${end}`
    for (const row of data) {
      const be = boundsFor(toCO(row.created_at));
      const key = `${be.start}|${be.end}`;
      if (!map.has(key)) {
        map.set(key, {
          id: key,        // usamos el key como id estable
          start_at: be.start,
          end_at: be.end, // límite superior exclusivo
        });
      }
    }

    const periodsList = Array.from(map.values());
    if (!cancelled) {
      setPeriods(periodsList);
      // NO seleccionamos nada por defecto: que quede “Selecciona quincena”
      setPeriodId(""); 
    }
  })();

  return () => { cancelled = true; };
}, [supabase]);

  useEffect(() => {
  const p = periods.find(p => String(p.id) === String(periodId));
  if (!p) {setFrom(""); setTo("");return;}

  // start_at y end_at vienen como ISO; recortamos a YYYY-MM-DD
  const start = (p.start_at || "").slice(0, 10);

  // si end_at es null, usamos hoy (para la quincena abierta)
  const endIso = p.end_at ?? new Date().toISOString();
  const end = endIso.slice(0, 10);

  setFrom(start);
  setTo(end);
}, [periods, periodId]);
// ✅ dispara el fetch solo cuando from y to ya existen
useEffect(() => {
  if (from && to) {
    fetchSales();
  }
}, [from, to]);

  // ----- Vistas por cliente / producto (sumarios rápidos) -----
  const porCliente = useMemo(() => {
  const m = new Map(); // customer_id -> { units, total, name }

  for (const r of rows ?? []) {
    const id = r.customer_id;
    if (!id) continue; // ignora ventas sin cliente

    const prev = m.get(id) || { units: 0, total: 0, name: r.customer_name || "—" };

    // sumar unidades desde items
    const units = (r.items ?? []).reduce((acc, it) => acc + Number(it?.qty || 0), 0);
    prev.units += units;

    // sumar total (por si hay múltiples ventas del mismo cliente)
    prev.total += Number(r.total || 0);

    // conserva nombre si ya existía, o usa el que venga en esta venta
    if (!prev.name && r.customer_name) prev.name = r.customer_name;

    m.set(id, prev);
  }

  // map -> array con las claves que la tabla usa
  const arr = [...m.entries()].map(([customer_id, info]) => ({
    customer_id,
    name: info.name || "—",
    units: info.units,
    total: info.total,
  }));

  // opcional: orden por total desc
  arr.sort((a, b) => b.total - a.total);

  return arr;
}, [rows]);

  const porProducto = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      (r.items || []).forEach((it) => {
        const k = it.product_id ?? 0;
        const prev = m.get(k) || { name: it.products?.name || "—", units: 0, total: 0 };
        prev.units += Number(it.qty || 0);
        prev.total += Number(it.qty || 0) * Number(it.price || 0);
        prev.name = it.product?.name ?? prev.name;
        m.set(k, prev);
      });
    });
    return [...m.entries()].map(([product_id, info]) => ({
      product_id,
      name: info.name || "-",
      units: info.units,
      total: info.total,
    }));
  }, [rows]);


  // =================== DETALLE POR CLIENTE ======================

  // Adaptador de RPCs existentes + fallbacks
  async function tryRpcChain(nameCandidates, args) {
    for (const name of nameCandidates) {
      try {
        const { error } = await supabase.rpc(name, args);
        if (!error) return { ok: true, called: name };
      } catch {
        // probar siguiente
      }
    }
    return { ok: false };
  }

  async function getItemWithProduct(itemId) {
    const { data, error } = await supabase
      .from("sale_items")
      .select("id, sale_id, product_id, qty, price, products(id, stock)")
      .eq("id", itemId)
      .single();
    if (error) throw error;
    return data;
  }

  async function recalcSaleTotal(saleId) {
    const { data: sumRows, error: e1 } = await supabase
      .from("sale_items")
      .select("qty, price")
      .eq("sale_id", saleId);
    if (e1) throw e1;
    const newTotal = (sumRows || []).reduce((s, r) => s + Number(r.qty) * Number(r.price), 0);
    const { error: e2 } = await supabase
      .from("sales")
      .update({ total: newTotal })
      .eq("id", saleId);
    if (e2) throw e2;
  }

  async function saveItemAdapter(itemId, newQty, newPrice) {
    

    // 2) fallback sin transacción
    const it = await getItemWithProduct(itemId);
    const delta = Number(newQty) - Number(it.qty);

        // actualizar item
    await supabase
      .from("sale_items")
      .update({ qty: newQty, price: newPrice })
      .eq("id", itemId);

    // recalcular total
    await recalcSaleTotal(it.sale_id);
    await fetchSales();
    if(detailClient?.openForId){
      await loadClientDetail(detailClient.openForId, detailClient.openForName);
    }
  }

  async function deleteSaleAdapter(saleId) {
    
    // 2) fallback: devolver stock y borrar
    //Traer los Items de la venta
    const { data: items, error: eItems } = await supabase
      .from("sale_items")
      .select("product_id, qty")
      .eq("sale_id", saleId);
      if(eItems) throw eItems;
//Dwevolver stock manuak
   
    await supabase.from("sale_items").delete().eq("sale_id", saleId);
    await supabase.from("sales").delete().eq("id", saleId);
  }

  function startEdit(item) {
    setEdit((prev) => ({ ...prev, [item.id]: { qty: String(item.qty), price: String(item.price) } }));
  }
  function cancelEdit(itemId) {
    setEdit((prev) => {
      const c = { ...prev };
      delete c[itemId];
      return c;
    });
  }
  function onEditChange(itemId, field, val) {
    setEdit((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [field]: val } }));
  }

  async function saveItem(item) {
    if (!isAdmin) return;
    const change = edit[item.id];
    if (!change) return;

    const newQty = Math.max(1, Number(change.qty) || 1);
    const newPrice = Math.max(0, Number(change.price) || 0);

    setSaving(true);
    setMsgDetail("");
    try {
      await saveItemAdapter(item.id, newQty, newPrice);
      await loadClientDetail(detailClient.openForId, detailClient.openForName);
      cancelEdit(item.id);
    } catch (err) {
      console.error(err);
      setMsgDetail(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeSale(saleId) {
    if (!isAdmin) return;
    if (!confirm("¿Eliminar esta venta? Esto devolverá el stock.")) return;

    setSaving(true);
    setMsgDetail("");
    try {
      await deleteSaleAdapter(saleId);
      await fetchSales();
      if(detailClient?.openForId){
      await loadClientDetail(detailClient.openForId, detailClient.openForName);
      }
    } catch (err) {
      console.error("removeSale error:",err);
      setMsgDetail(err.message || "Error al eliminar venta");
    } finally {
      setSaving(false);
    }
  }

  // Cargar detalle por cliente (en rango actual)
  async function loadClientDetail(customerId, customerName) {
    setMsgDetail("");
    setEdit({});
    try {
      const zFrom = zFromLocalDate(from);
      const zTo = zToLocalDateEnd(to);

      // ventas del cliente en el rango
      const { data: sales, error: eSales } = await supabase
        .from("sales")
        .select(`
          id, created_at, total, sold_by, customer_id, seller:profiles(full_name)`)
        .eq("customer_id", customerId)
        .gte("created_at", zFrom)
        .lt("created_at", zTo)
        .order("created_at", { ascending: true });
      if (eSales) throw eSales;

      if (!sales || sales.length === 0) {
        setDetailClient({ openForId: customerId, openForName: customerName, rows: [] });
        return;
      }

      const saleIds = sales.map(s => s.id);
      const sellerIds = [...new Set(sales.map(s => s.sold_by).filter(Boolean))];

      // items + productos
      const { data: items, error: eItems } = await supabase
        .from("sale_items")
        .select("id, sale_id, qty, price, product:products(name, sku)")
        .in("sale_id", saleIds);
      if (eItems) throw eItems;

      // vendedores
      let sellMap = new Map();
      if (sellerIds.length > 0) {
        const { data: profs, error: ePro } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", sellerIds);
        if (ePro) throw ePro;
        sellMap = new Map(
          (profs || []).map((p) => [
            p.id,
            p.full_name?.trim() || p.email || "(sin nombre)",
          ])
        );
      }

      // agrupar items por venta
      const gi = groupBy(items || [], x => x.sale_id);

      const detailRows = sales.map(s => ({
        ...s,
        items: gi.get(s.id) ?? [],
        seller_name: sellMap.get(s.sold_by) ?? "—",
      }));

      setDetailClient({ openForId: customerId, openForName: customerName, rows: detailRows });
    } catch (err) {
      console.error(err);
      setDetailClient({ openForId: customerId, openForName: customerName, rows: [] });
      setMsgDetail(err.message);
    }
  }

  // ---- UI helpers ----
//mostrar inicio - fin quicena
function periodLabel(p) {
  const [y1, m1, d1] = p.start_at.split("-").map(Number);
  const [y2, m2, d2] = p.end_at.split("-").map(Number);
  const dd = (n) => String(n).padStart(2, "0");
  return `${dd(d1)}/${dd(m1)}/${y1} – ${dd(d2)}/${dd(m2)}/${y2}`;
}

  function renderResumenItems(list) {
    if (!list || list.length === 0) return "—";
    // Ej: "Agua ×2; Doritos ×1"
    return list
      .map((x) => `${x.product?.name || "?"} × ${x.qty}`)
      .slice(0, 5)
      .join("; ");
  }

  return (
    
    <div className="page">
      {/* HEADER COMPLETO */}
<div className="card reports-head" style={{ marginBottom: 12 }}>
  <h1>Reportes</h1>

  {/* Fila 1: tabs en una sola línea */}
  <div className="reports-tabs">
    <Tabs mode={mode} setMode={setMode} />
  </div>

  {/* Fila 2: Quincena + select + botón */}
  <div className="reports-filters">
    <label className="subtitle" style={{ margin: 0 }}>Quincena</label>

    <select
      className="input w-260"
      value={periodId}
      onChange={(e) => {
        const id = e.target.value;
        setPeriodId(id);
        const p = periods.find((x) => String(x.id) === id);
        if (!p) {setFrom(""); setTo(""); return;}
        const fromIso = new Date(p.start_at).toISOString().slice(0, 10);
        const toIso = new Date(p.end_at ?? new Date()).toISOString().slice(0, 10);
        setFrom(fromIso);
        setTo(toIso);
      }}
      autoComplete="off"
      name="periodSelect"
      style={{width:260}}
    >
      <option value="">— Selecciona quincena —</option>
      {periods.map((p) => (
        <option key={p.id} value={p.id}>{periodLabel(p)}</option>
      ))}
    </select>

    <button className="btn btn-primary" onClick={fetchSales} disabled={loading}>
      Actualizar
    </button>
  </div>
</div>
      {mode === "ventas" && (
        <div className="card">
          <h2>Resumen de Ventas</h2>

          <div className="grid" style={{ gridTemplateColumns: "180px 180px auto", gap: 12 }}>
                             
           
          </div>

          {/* Tabla */}
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 6px" }}>Fecha</th>
                  <th style={{ padding: "8px 6px" }}>Cliente</th>
                  <th style={{ padding: "8px 6px" }}>Vendedor</th>
                  <th style={{ padding: "8px 6px" }}>Ítems (resumen)</th>
                  <th style={{ padding: "8px 6px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, color: "#666" }}>
                      No hay ventas en ese rango.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 6px" }}>{fmtDateTimeCO(r.created_at)}</td>
                      <td style={{ padding: "8px 6px" }}>{r.customer_name}</td>
                      <td style={{ padding: "8px 6px" }}>{r.seller_name}</td>
                      <td style={{ padding: "8px 6px" }}>{renderResumenItems(r.items)}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{fmtMoney(r.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700 }}>
                    Total
                  </td>
                    <td style={{ padding: "8px 6px", fontWeight: 700 }}>{fmtMoney(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {mode === "cliente" && (
        <div className="card">
          <h2>Ventas por cliente</h2>

          {/* Rango de fechas compartido */}
         

          {porCliente.length === 0 ? (
            <p className="subtitle" style={{ marginTop: 10 }}>Sin datos en el rango seleccionado.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 6px" }}>Cliente</th>
                    <th style={{ padding: "8px 6px" }}>Unidades</th>
                    <th style={{ padding: "8px 6px" }}>Total</th>
                    <th style={{ padding: "8px 6px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {porCliente.map((c) => (
                    <tr key={c.customer_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 6px" }}>{c.name}</td>
                      <td style={{ padding: "8px 6px" }}>{c.units}</td>
                      <td style={{ padding: "8px 6px" }}>{fmtMoney(c.total)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <button
                          className="btn"
                          onClick={() =>
                            detailClient.openForId === c.customer_id
                              ? setDetailClient({ openForId: null, openForName: null, rows: [] })
                              : loadClientDetail(c.customer_id, c.name)
                          }
                        >
                          {detailClient.openForId === c.customer_id ? "Cerrar" : "Ver detalle"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td></td>
                    <td style={{ padding:"8px 6px", textAlign:"right", fontWeight:700 }}>Total</td>
                    <td style={{ padding:"8px 6px", fontWeight:700 }}>{fmtMoney(porCliente.reduce((s,x)=>s+Number(x.total||0),0))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Panel de detalle */}
          {detailClient.openForId && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="stack" style={{ alignItems: "center" }}>
                <h4 style={{ margin: 0 }}>Detalle — {detailClient.openForName}</h4>
                <button className="btn" onClick={() => setDetailClient({ openForId: null, openForName: null, rows: [] })}>
                  Cerrar
                </button>
              </div>
              {msgDetail && <div style={{ color: "crimson", marginTop: 8 }}>{msgDetail}</div>}

              <div style={{ overflowX: "auto", marginTop: 8 }}>
  <table className="tbl">
    <colgroup>
  {[
    160,   // Fecha
    180,   // Vendedor
    null,  // Producto (auto)
    110,   // Cantidad
    120,   // Precio
    130,   // Subtotal
    160,   // Acciones
  ].map((w, i) => (
    <col key={i} style={w ? { width: `${w}px` } : undefined} />
  ))}
</colgroup>


    <thead>
      <tr>
        <th>Fecha</th>
        <th>Vendedor</th>
        <th>Producto</th>
        <th className="num">Cantidad</th>
        <th className="num">Precio</th>
        <th className="num">Subtotal</th>
        <th></th>
      </tr>
    </thead>

    <tbody>
      {detailClient.rows && detailClient.rows.length > 0 ? (
        detailClient.rows.flatMap((sale) => {
          const items = sale.items || [];
          if (items.length === 0) return [];
          const sellerName =
            sale.seller?.full_name?.trim() || sale.seller?.email || "—";

          return items.map((it, idx) => {
            const ed = edit[it.id];
            const qtyView = ed ? ed.qty : it.qty;
            const priceView = ed ? ed.price : it.price;
            const subtotal = Number(qtyView) * Number(priceView);

            return (
              <tr key={`${sale.id}-${it.id}`}>
                {/* Fecha y Vendedor solo en la primera fila de la venta, con rowSpan */}
                {idx === 0 && (
                  <>
                    <td rowSpan={items.length}>{fmtDateTimeCO(sale.created_at)}</td>
                    <td rowSpan={items.length}>{sellerName}</td>
                  </>
                )}

                <td>
                  {it.product?.name || "—"}
                  {it.product?.sku ? ` (${it.product.sku})` : ""}
                </td>

                <td className="num" style={{ minWidth: 110 }}>
                  {isAdmin ? (
                    ed ? (
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={qtyView}
                        onChange={(e) => onEditChange(it.id, "qty", e.target.value)}
                        style={{ width: 100 }}
                      />
                    ) : (
                      it.qty
                    )
                  ) : (
                    it.qty
                  )}
                </td>

                <td className="num" style={{ minWidth: 120 }}>
                  {isAdmin ? (
                    ed ? (
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceView}
                        onChange={(e) => onEditChange(it.id, "price", e.target.value)}
                        style={{ width: 120 }}
                      />
                    ) : (
                      fmtMoney(it.price)
                    )
                  ) : (
                    fmtMoney(it.price)
                  )}
                </td>

                <td className="num">{fmtMoney(subtotal)}</td>

                <td>
                  {isAdmin ? (
                    ed ? (
                      <div className="stack">
                        <button
                          className="btn brand"
                          disabled={saving}
                          onClick={() => saveItem(it)}
                        >
                          Guardar
                        </button>
                        <button
                          className="btn"
                          disabled={saving}
                          onClick={() => cancelEdit(it.id)}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="stack">
                        <button
                          className="btn"
                          disabled={saving}
                          onClick={() => startEdit(it)}
                        >
                          Editar
                        </button>
                        {/* Eliminar venta completa solo en la primera fila */}
                        {idx === 0 && (
                           <button
                            className="btn"
                            disabled={saving}
                            onClick={() => removeSale(sale.id)}
                          >
                            Eliminar venta
                          </button>
                          
                        )}
                      </div>
                    )
                  ) : (
                    <></>
                  )}
                </td>
              </tr>
            );
          });
        })
      ) : (
        <tr>
          <td colSpan={isAdmin ? 7 : 6} style={{ padding: "10px 6px", color: "var(--muted)" }}>
            Sin detalle.
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>

            </div>
          )}
        </div>
      )}

      {mode === "producto" && (
        <div className="card">
          <h2>Ventas por producto</h2>
          {porProducto.length === 0 ? (
            <p className="subtitle">Sin datos en el rango seleccionado.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 6px" }}>Producto</th>
                    <th style={{ padding: "8px 6px" }}>Unidades</th>
                    <th style={{ padding: "8px 6px" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {porProducto.map((p) => (
                    <tr key={p.product_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 6px" }}>{p.name}</td>
                      <td style={{ padding: "8px 6px" }}>{p.units}</td>
                      <td style={{ padding: "8px 6px" }}>{fmtMoney(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
