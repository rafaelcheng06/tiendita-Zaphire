// src/ventas.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient"; // <- usa tu ruta actual del cliente Supabase
import ResumenQuincena from "./ResumenQuincena";
// Si tu import es distinto (p.ej. './lib/supabase'), cámbialo arriba.

export default function Ventas({ role }) {
  const isAdmin = role === "admin";

  // --- Estado base ---
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // Panel superior (cliente)
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");

  // Productos y búsqueda
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState("");

  // Carrito (venta en construcción)
  const [cart, setCart] = useState([]); // [{id,name,price,qty,stock}]

  // Resumen de quincena abierta (panel derecho)
  const [resumenQuincena, setResumenQuincena] = useState({
    byProduct: [],
    byCustomer: [],
    total: 0,
    totalItems: 0,
  });

  // =========================================================
  // Helpers utilitarios locales
  // =========================================================
  const money = (n) => {
    const v = Number(n || 0);
    return v.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  };

  const sumBy = (arr, getKey, getQty = (x) => x.qty, getSub = (x) => Number(x.price || 0) * Number(x.qty || 0)) => {
    const map = new Map();
    for (const it of arr || []) {
      const key = getKey(it);
      const prev = map.get(key) || { key, qty: 0, subtotal: 0, sample: it };
      prev.qty += Number(getQty(it) || 0);
      prev.subtotal += Number(getSub(it) || 0);
      prev.sample = prev.sample || it;
      map.set(key, prev);
    }
    return Array.from(map.values());
  };

  // =========================================================
  // Carga inicial: clientes + productos + resumen quincena
  // =========================================================
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");

      // 1) Clientes activos
      const { data: cust, error: eCust } = await supabase
        .from("customers")
        .select("id,name")
        .eq("active", true)
        .order("name", { ascending: true });

      if (eCust) console.error(eCust);

      // 2) Productos activos
      const { data: prods, error: eProd } = await supabase
        .from("products")
        .select("id,name,sku,price,stock,active")
        .eq("active", true)
        .order("name", { ascending: true });

      if (eProd) console.error(eProd);

      setCustomers(cust || []);
      setProducts(prods || []);

      // 3) Resumen quincena abierta (panel derecho)
      await loadResumenQuincena();

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================
  // Panel derecho: resumen de quincena abierta
  // =========================================================
  async function getOpenPeriodId() {
    const { data, error } = await supabase
      .from("periods")
      .select("id")
      .eq("status", "open")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    if (error || !data) return null;
    return data.id;
  }

  async function loadResumenQuincena() {
    try {
      const periodId = await getOpenPeriodId();
      if (!periodId) {
        setResumenQuincena({ byProduct: [], byCustomer: [], total: 0, totalItems: 0 });
        return;
      }

      // Traemos los sale_items de la quincena abierta con joins a sales/customers/products
      // Ajusta los campos si tus nombres reales difieren.
      const { data, error } = await supabase
        .from("sale_items")
        .select(`
          qty,
          price,
          product:products(id,name),
          sale:sales(
            id,
            period_id,
            customer:customers(id,name)
          )
        `)
        .eq("sale.period_id", periodId);

      if (error) {
        console.error(error);
        setResumenQuincena({ byProduct: [], byCustomer: [], total: 0, totalItems: 0 });
        return;
      }

      // Normalizamos filas
      const rows = (data || []).map((it) => ({
        qty: Number(it?.qty || 0),
        price: Number(it?.price || 0),
        productId: it?.product?.id,
        productName: it?.product?.name || "Producto",
        customerId: it?.sale?.customer?.id,
        customerName: it?.sale?.customer?.name || "Cliente",
      }));

      // Agrupación por producto
      const byProduct = sumBy(
        rows,
        (r) => String(r.productId || r.productName),
        (r) => r.qty,
        (r) => r.price * r.qty
      ).map((r) => ({
        id: r.sample.productId,
        name: r.sample.productName,
        qty: r.qty,
        subtotal: r.subtotal,
      }));

      // Agrupación por cliente
      const byCustomer = sumBy(
        rows,
        (r) => String(r.customerId || r.customerName),
        (r) => r.qty,
        (r) => r.price * r.qty
      ).map((r) => ({
        id: r.sample.customerId,
        name: r.sample.customerName,
        qty: r.qty,
        subtotal: r.subtotal,
      }));

      const totalItems = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
      const total = rows.reduce((s, r) => s + Number(r.price || 0) * Number(r.qty || 0), 0);

      setResumenQuincena({ byProduct, byCustomer, total, totalItems });
    } catch (e) {
      console.error(e);
      setResumenQuincena({ byProduct: [], byCustomer: [], total: 0, totalItems: 0 });
    }
  }

  // =========================================================
  // Búsqueda / filtro de productos
  // =========================================================
  const filteredProducts = useMemo(() => {
    const qq = (q || "").trim().toLowerCase();
    if (!qq) return products;
    return (products || []).filter((p) =>
      [p.name, p.sku].filter(Boolean).some((t) => String(t).toLowerCase().includes(qq))
    );
  }, [q, products]);

  // =========================================================
  // Carrito: add / update / remove
  // =========================================================
  function addToCart(p, qty = 1) {
    setMsg("");
    const addQty = Math.max(1, Number(qty) || 1);

    // Validación de stock (no vender más de lo disponible)
    const existing = cart.find((i) => i.id === p.id);
    const currentQty = existing ? existing.qty : 0;
    const available = Math.max(0, Number(p.stock || 0) - currentQty);
    if (addQty > available) {
      setMsg(`Stock insuficiente para ${p.name}. Disponible: ${available}`);
      return;
    }

    if (existing) {
      setCart(cart.map((i) => (i.id === p.id ? { ...i, qty: i.qty + addQty } : i)));
    } else {
      setCart([...cart, { id: p.id, name: p.name, price: Number(p.price || 0), qty: addQty, stock: p.stock }]);
    }
  }

  function updateQty(id, qty) {
    const qn = Math.max(1, Number(qty) || 1);
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (qn > Number(p.stock || 0)) {
      setMsg(`No puedes vender más de ${p.stock}`);
      return;
    }
    setCart(cart.map((i) => (i.id === id ? { ...i, qty: qn } : i)));
  }

  function updatePrice(id, price) {
    if (!isAdmin) return; // solo admin edita precio en la venta
    const pn = Number(price);
    if (Number.isNaN(pn) || pn < 0) return;
    setCart(cart.map((i) => (i.id === id ? { ...i, price: pn } : i)));
  }

  function removeItem(id) {
    setCart(cart.filter((i) => i.id !== id));
  }

  const total = useMemo(
    () => (cart || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 0), 0),
    [cart]
  );

  // =========================================================
  // Guardar venta
  // =========================================================
  async function saveSale() {
    setMsg("");
    if (!customerId) {
      setMsg("Selecciona un cliente.");
      return;
    }
    if ((cart || []).length === 0) {
      setMsg("Agrega al menos un producto.");
      return;
    }

    // Validación stock en vivo
    for (const item of cart) {
      const p = products.find((x) => x.id === item.id);
      if (!p || item.qty > Number(p.stock || 0)) {
        setMsg(`Stock insuficiente para ${item?.name || "producto"}.`);
        return;
      }
    }

    const periodId = await getOpenPeriodId();
    if (!periodId) {
      setMsg("No hay quincena abierta. Pídele al admin que abra una.");
      return;
    }

    // 1) Insertar venta
    const { data: sale, error: eSale } = await supabase
      .from("sales")
      .insert([{ customer_id: Number(customerId), total: Number(total.toFixed(2)), period_id: periodId }])
      .select("id")
      .single();

    if (eSale) {
      setMsg(eSale.message);
      return;
    }

    // 2) Insertar items
    const itemsPayload = cart.map((i) => ({
      sale_id: sale.id,
      product_id: i.id,
      qty: i.qty,
      price: Number(i.price.toFixed(2)),
    }));

    const { error: eItems } = await supabase.from("sale_items").insert(itemsPayload);
    if (eItems) {
      setMsg(eItems.message);
      return;
    }

    // 3) Limpiar carrito + recargar productos y resumen quincena
    setCart([]);
    const { data: prods } = await supabase
      .from("products")
      .select("id,name,sku,price,stock,active")
      .eq("active", true)
      .order("name", { ascending: true });
    setProducts(prods || []);

    await loadResumenQuincena();

    alert(`Venta #${sale.id} creada con éxito.`);
  }

  // =========================================================
  // Render
  // =========================================================
  if (loading) {
    return (
      <div className="page">
        <div className="card">Cargando…</div>
      </div>
    );
  }

  return (
  <div className="page">
    {/* ENCABEZADO / PANEL SUPERIOR */}
    <div className="card" style={{ marginTop:"8px"}}>
      <h2>Ventas</h2>
      <p className="subtitle" style={{ marginTop: 6 }}>
        Selecciona cliente, agrega productos al carrito y confirma.
      </p>

      <div className="sales-layout" style={{
                                  display:"grid",
                                  gridAutoColumns: "2fr 1fr",
                                  gap: "16px",
                                 // height: "calc(100vh - 160px)",
                                  alignItems: 'start',
                                  minWidth: 0

      }}>
        <div>
          <label className="subtitle">Cliente</label>
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Selecciona cliente activo —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="subtitle">Buscar producto</label>
          <input className="input" placeholder="Nombre o SKU" value={q} onChange={(e)=>setQ(e.target.value)} />
        </div>
      </div>
    </div>

    {/* LAYOUT 2 COLUMNAS */}
    <div className="sales-layout">

      {/* IZQUIERDA: Productos + Carrito */}
      <section className="ventas-col-izquierda">

        {/* Productos activos */}
        <div className="card card-productos">
          <h3>Productos activos</h3>
          <div className="table-scroll">
            {products && products.length ? (
              
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ textAlign:"left", borderBottom:"1px solid var(--border)" }}>
                      <th style={{ padding:"8px 6px" }}>Producto</th>
                      <th style={{ padding:"8px 6px" }}>SKU</th>
                      <th style={{ padding:"8px 6px" }}>Precio</th>
                      <th style={{ padding:"8px 6px" }}>Stock</th>
                      <th style={{ padding:"8px 6px" }}>Agregar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products
                      .filter(p => [p.name, p.sku].filter(Boolean).some(txt => txt.toLowerCase().includes(q.toLowerCase())))
                      .map(p => (
                      <tr key={p.id} style={{ borderBottom:"1px solid var(--border)" }}>
                        <td style={{ padding:"8px 6px" }}>{p.name}</td>
                        <td style={{ padding:"8px 6px" }}>{p.sku || "—"}</td>
                        <td style={{ padding:"8px 6px" }}>${Number(p.price).toFixed(2)}</td>
                        <td style={{ padding:"8px 6px" }}>{p.stock}</td>
                        <td style={{ padding:"8px 6px" }}>
                          <div className="stack">
                            <input
  className="input"
  style={{ width:90 }}
  type="number"
  min="1"
  step="1"
  placeholder="Cantidad"
  id={`qty-${p.id}`}
/>
                            <button
                            type="button"
                            className="btn"
                            onClick={() => {
                            const el = document.getElementById(`qty-${p.id}`);
                            const raw = el?.value?.trim();
                            const qty = Number(raw);

                        // si está vacío, no numérico o <= 0: NO agregues y alerta
                                      if (!raw || Number.isNaN(qty) || qty <= 0) {
                               alert("Si pones la cantidad no me enojo");
      return;
                            }

                      addToCart(p, qty);
                     if (el) el.value = ""; // limpia solo cuando fue válido
                           }}
                                  >
                            Agregar
                                        </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              
            ) : (
              <p className="subtitle">No hay productos.</p>
            )}
          </div>
        </div>

        {/* Carrito */}
        <div className="card card carrito">
          <h3>Carrito</h3>
          <div className="table-scroll">
            {cart.length === 0 ? (
              <p className="subtitle">Aún no agregas productos.</p>
            ) : (
              <div style={{ overflowX:"auto", marginTop: 8 }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ textAlign:"left", borderBottom:"1px solid var(--border)" }}>
                      <th style={{ padding:"8px 6px" }}>Producto</th>
                      <th style={{ padding:"8px 6px" }}>Cantidad</th>
                      <th style={{ padding:"8px 6px" }}>Precio</th>
                      <th style={{ padding:"8px 6px" }}>Subtotal</th>
                      <th style={{ padding:"8px 6px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(i => (
                      <tr key={i.id} style={{ borderBottom:"1px solid var(--border)" }}>
                        <td style={{ padding:"8px 6px" }}>{i.name}</td>
                        <td style={{ padding:"8px 6px" }}>
                          <input
                            className="input"
                            type="number"
                            min="1"
                            value={i.qty}
                            onChange={(e)=>updateQty(i.id, e.target.value)}
                            style={{ width:90 }}
                          />
                        </td>
                        <td style={{ padding:"8px 6px" }}>
                          {isAdmin ? (
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={i.price}
                              onChange={(e)=>updatePrice(i.id, e.target.value)}
                              style={{ width:120 }}
                            />
                          ) : (
                            <>${Number(i.price).toFixed(2)}</>
                          )}
                        </td>
                        <td style={{ padding:"8px 6px" }}>${(Number(i.price) * Number(i.qty)).toFixed(2)}</td>
                        <td style={{ padding:"8px 6px" }}>
                          <button className="btn" onClick={()=>removeItem(i.id)}>Quitar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Botones del carrito */}
          <div className="stack cart-actions" style={{ marginTop: 12 }}>
            <button className="btn brand" onClick={saveSale} disabled={!customerId || cart.length === 0}>
              Guardar venta
            </button>
            <button className="btn" onClick={()=>setCart([])} disabled={cart.length === 0}>
              Vaciar carrito
            </button>
          </div>

          {msg && <div style={{ color:"crimson", marginTop:10 }}>{msg}</div>}
        </div>
      </section>

      {/* DERECHA: Resumen */}
      <aside className="ventas-col-derecha">
       <div className="card card-resumen">    
             <h3>Resumen (quincena abierta)</h3>
          <div className="table-scroll">
            <ResumenQuincena />
          </div>
        </div>
      </aside>

    </div>
  </div>
);
}