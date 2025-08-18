import { useEffect, useState} from "react";
import { supabase } from "./supabaseClient";
import { getQuincenaRangeUTC, zFromLocalDate, zToLocalDateEnd } from "./lib/format";

// helper arriba del archivo
function toYYYYMMDD(x) {
  if (!x) return "";
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === "string") return x.slice(0, 10);
  try {
    return new Date(x).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}



// Formateo COP
const moneyCO = (n) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export default function ResumenQuincena({ refreshKey = 0 }) {
  const [loading, setLoading] = useState(true);
  const [periodId, setPeriodId] = useState(null);
  const [customers, setCustomers] = useState([]); // activos
  const [products, setProducts] = useState([]);   // {id,name}
  const [rows, setRows] = useState([]);           // [{customer_id,name, byProd:{[pid]:qty}, unidades, total}]
  const [totUnitsByProd, setTotUnitsByProd] = useState({}); // {pid:qty}
  const [grandTotal, setGrandTotal] = useState(0);
const [from, setFrom] = useState("");
const [to, setTo] = useState("");

  useEffect(() => {
    // 1) Rango de quincena automática (UTC)
      const [startUTC, endUTC] = getQuincenaRangeUTC(new Date());
      setFrom(toYYYYMMDD(startUTC));
      setTo(toYYYYMMDD(endUTC));

  }, []);

  useEffect(() => {
  // no hagas nada hasta tener el rango listo
  if (!from || !to) return;

  let alive = true;
  (async () => {
    try {
      setLoading?.(true);

      // 1) catálogos (como ya lo tenías)
      const [{ data: cust, error: eCust }, { data: prods, error: eProd }] =
        await Promise.all([
          supabase
            .from("customers")
            .select("id,name,active")
            .eq("active", true)
            .order("name", { ascending: true }),
          supabase
            .from("products")
            .select("id,name,sku,active")
            .eq("active", true)
            .order("name", { ascending: true }),
        ]);

      if (eCust || eProd) throw eCust || eProd;
      if (!alive) return;
      setCustomers(cust || []);
      setProducts(prods || []);

      // 2) rango en UTC a partir de YYYY-MM-DD (tu helper existente)
      const zFrom = zFromLocalDate(from);
      const zTo   = zToLocalDateEnd(to);

      // 3) ventas de la quincena (incluye items)
      const { data: sales, error: eSales } = await supabase
        .from("sales")
        .select(`
          id, customer_id, sold_by, total, created_at,
          items:sale_items (qty, price, product_id)
        `)
        .gte("created_at", zFrom)
        .lt("created_at", zTo)
        .order("created_at", { ascending: true });

      if (eSales) throw eSales;

      // 4) agrupar por cliente y totales por producto (tu misma estructura)
      const rowsMap = new Map();       // key: customer_id
      const totalsByProd = {};         // { pid: qty }
      let totalGeneral = 0;

      for (const s of (sales || [])) {
        const cid  = s.customer_id || 0;
        const name =
          (cust || []).find(c => c.id === cid)?.name || "-";

        const row =
          rowsMap.get(cid) ||
          { customer_id: cid, name, byProd: {}, unidades: 0, total: 0 };

        for (const it of (s.items || [])) {
          const pid   = it.product_id;
          const qty   = Number(it.qty)   || 0;
          const price = Number(it.price) || 0;

          row.byProd[pid]   = (row.byProd[pid] || 0) + qty;
          row.unidades     += qty;
          row.total        += qty * price;

          totalsByProd[pid] = (totalsByProd[pid] || 0) + qty;
          totalGeneral     += qty * price;
        }

        rowsMap.set(cid, row);
      }

      const rowsArr = Array.from(rowsMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!alive) return;
      setRows(rowsArr);
      setTotUnitsByProd(totalsByProd);
      setGrandTotal(totalGeneral);
    } catch (err) {
      console.error("ResumenQuincena useEffect error:", err);
      if (!alive) return;
      setRows([]);
      setTotUnitsByProd({});
      setGrandTotal(0);
    } finally {
      if (alive) setLoading?.(false);
    }
  })();

  return () => { alive = false; };
  // 🔑 importante: depender de from / to para que se ejecute cuando ya están listos
}, [from, to, refreshKey, supabase]); // sin dependencias: quincena actual

  // Renders intermedios
  if (loading) {
    return (
      <div className="card" style={{ position: "sticky", top: 16 }}>
        <h3>Resumen quincena</h3>
        <p className="subtitle">Cargando…</p>
      </div>
    );
  }
 

  // Tabla pivote (incluye clientes sin compras)
  return (
    <div
      className="card"
      style={{ position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflow: "auto" }}
    >
      <h3 style={{ marginBottom: 8 }}>Resumen (quincena actual)</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "8px 6px", position: "sticky", left: 0, background: "var(--card,#fff)", zIndex: 1 }}>
                Cliente
              </th>
              {products.map((p) => (
                <th key={p.id} style={{ padding: "8px 6px" }}>{p.name}</th>
              ))}
              <th style={{ padding: "8px 6px" }}>Unid.</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customer_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 6px", position: "sticky", left: 0, background: "var(--card,#fff)" }}>
                  {r.name}
                </td>
                {products.map((p) => (
                  <td key={p.id} style={{ padding: "8px 6px" }}>
                    {r.byProd[p.id] || 0}
                  </td>
                ))}
                <td style={{ padding: "8px 6px" }}>{r.unidades}</td>
                <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600 }}>
                  {moneyCO(r.total)}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: "8px 6px", fontWeight: 700 }}>Totales</td>
              {products.map((p) => (
                <td key={p.id} style={{ padding: "8px 6px", fontWeight: 700 }}>
                  {totUnitsByProd[p.id] || 0}
                </td>
              ))}
              <td style={{ padding: "8px 6px", fontWeight: 700 }}>
                {rows.reduce((s, r) => s + r.unidades, 0)}
              </td>
              <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700 }}>
                {moneyCO(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
