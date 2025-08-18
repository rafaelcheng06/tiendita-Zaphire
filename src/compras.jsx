// src/compras.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

// Formato moneda COP
const moneyCO = (n) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(+n) ? +n : 0);

export default function Compras({ role = "admin" }) {
  const isAdmin = role === "admin";

  // Datos base
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]); // id, name, sku, stock, price

  // Defaults por producto (última compra + lo que edita el usuario en la tabla)
  // { [productId]: { packages, upp, pkgCost } }
  const [defaults, setDefaults] = useState({});

  // Precio de venta editable por producto (solo se guarda al completar compra)
  const [salePriceByProd, setSalePriceByProd] = useState({}); // { [productId]: number }

  // Filtro
  const [q, setQ] = useState("");

  // Carrito [{id,name,sku,packages,upp,pkgCost,unitCost}]
  const [cart, setCart] = useState([]);

  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // ================== CARGA INICIAL ==================
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");

      // 1) Productos activos
      const { data: prods, error: eProds } = await supabase
        .from("products")
        .select("id,name,sku,stock,price,active")
        .eq("active", true)
        .order("name", { ascending: true });

      if (eProds) {
        setMsg(eProds.message);
        setLoading(false);
        return;
      }
      setProducts(prods || []);

      // 2) Defaults desde la vista de últimas compras
      //    Debe devolver: product_id, units_per_package, package_cost
      const { data: defs, error: eDefs } = await supabase
        .from("purchase_defaults_latest")
        .select("product_id, units_per_package, package_cost");

      if (eDefs) {
        setMsg(eDefs.message);
        setLoading(false);
        return;
      }

      const map = {};
      (prods || []).forEach((p) => {
        map[p.id] = { packages: 1, upp: 0, pkgCost: 0 }; // base
      });

      (defs || []).forEach((d) => {
        map[d.product_id] = {
          packages: 1, // por defecto 1 paquete al agregar
          upp: Number(d.units_per_package) || 0,
          pkgCost: Number(d.package_cost) || 0,
        };
      });

      setDefaults(map);

      // precio de venta inicial (solo en memoria)
      const initSale = {};
      (prods || []).forEach((p) => (initSale[p.id] = Number(p.price) || 0));
      setSalePriceByProd(initSale);

      setLoading(false);
    })();
  }, []);

  // ================== FILTRO ==================
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) =>
      [p.name, p.sku].filter(Boolean).some((t) => String(t).toLowerCase().includes(s))
    );
  }, [q, products]);

  // ================== CÁLCULOS ==================
  const unitCostOf = (pid) => {
    const d = defaults[pid] || {};
    const upp = Number(d.upp) || 0;
    const pkgCost = Number(d.pkgCost) || 0;
    if (!upp || upp <= 0) return 0;
    return pkgCost / upp;
  };

  // ================== EDITAR DEFAULTS EN TABLA ==================
  const updateDefault = (pid, field, value) => {
    setDefaults((prev) => {
      const curr = prev[pid] || { packages: 1, upp: 0, pkgCost: 0 };
      const next = { ...curr, [field]: Number(value) || 0 };
      return { ...prev, [pid]: next };
    });
  };

  // Si cambian upp o pkgCost en la tabla, mantén carrito sincronizado
  useEffect(() => {
    if (!cart.length) return;
    setCart((prev) =>
      prev.map((it) => {
        const d = defaults[it.id];
        if (!d) return it;
        const nextUnit = unitCostOf(it.id);
        return { ...it, upp: Number(d.upp) || 0, pkgCost: Number(d.pkgCost) || 0, unitCost: nextUnit };
      })
    );
  }, [defaults, cart.length]);

  // ================== AGREGAR AL CARRITO ==================
  const addToCart = (p) => {
    setMsg("");
    const d = defaults[p.id] || { packages: 1, upp: 0, pkgCost: 0 };
    const packages = Number(d.packages) || 0;
    const upp = Number(d.upp) || 0;
    const pkgCost = Number(d.pkgCost) || 0;

    if (packages <= 0) return setMsg("Paquetes debe ser > 0");
    if (upp <= 0) return setMsg("Unid/Paquete debe ser > 0");
    if (pkgCost <= 0) return setMsg("Precio paquete debe ser > 0");

    const unitCost = pkgCost / upp;

    setCart((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id);
      const line = { id: p.id, name: p.name, sku: p.sku, packages, upp, pkgCost, unitCost };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = line;
        return copy;
      }
      return [...prev, line];
    });
  };

  // ================== GUARDAR COMPRA ==================
  async function savePurchase() {
    try {
      setMsg("");
      if (!isAdmin) throw new Error("Solo el admin puede registrar compras.");
      if (cart.length === 0) throw new Error("Agrega al menos un producto al carrito.");

      setSaving(true);

      // 1) Crea encabezado (ajusta columnas si tienes vendor/note/created_by)
      const { data: header, error: eHead } = await supabase
        .from("purchases")
        .insert([{ note: null }])
        .select("id")
        .single();
      if (eHead) throw eHead;

      // 2) Items — qty = paquetes × unid/paquete (unidades que ingresan a stock)
      const payload = cart.map((it) => ({
        purchase_id: header.id,
        product_id: it.id,
        qty: Number(it.packages) * Number(it.upp),           // ✅ total de unidades
        units_per_package: Number(it.upp),
        package_cost: Number(it.pkgCost),
        unit_cost: Number(it.pkgCost) / Number(it.upp),      // calculado en el front
      }));

      const { error: eItems } = await supabase.from("purchase_items").insert(payload);
      if (eItems) throw eItems;

      // 3) Actualizar precio de venta SOLO al completar la compra
      try {
        const updates = [];
        for (const p of products) {
          const current = Number(p.price) || 0;
          const desired = Number(salePriceByProd[p.id]);
          if (Number.isFinite(desired) && desired >= 0 && desired !== current) {
            updates.push(supabase.from("products").update({ price: desired }).eq("id", p.id));
          }
        }
        if (updates.length) {
          await Promise.all(updates);
          // sincroniza local para que la UI quede alineada
          setProducts((prev) =>
            prev.map((prod) => {
              const desired = Number(salePriceByProd[prod.id]);
              return Number.isFinite(desired) && desired >= 0 && desired !== Number(prod.price)
                ? { ...prod, price: desired }
                : prod;
            })
          );
        }
      } catch {
        // si falla, no rompas la compra
      }

      // 4) Limpiar y refrescar defaults
      setCart([]);

      const { data: defs } = await supabase
        .from("purchase_defaults_latest")
        .select("product_id, units_per_package, package_cost");
      const map = {};
      (products || []).forEach((p) => (map[p.id] = { packages: 1, upp: 0, pkgCost: 0 }));
      (defs || []).forEach((d) => {
        map[d.product_id] = {
          packages: 1,
          upp: Number(d.units_per_package) || 0,
          pkgCost: Number(d.package_cost) || 0,
        };
      });
      setDefaults(map);

      setSaving(false);
      alert(`Compra #${header.id} registrada`);
    } catch (err) {
      setSaving(false);
      setMsg(err.message || String(err));
    }
  }

  // ================== UI ==================
  if (loading) {
    return (
      <div className="page">
        <div className="card">Cargando…</div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Filtro */}
      <div className="card">
        <h2>Compras</h2>
        <p className="subtitle" style={{ marginTop: 6 }}>
          La cantidad que ingresa a stock es <b>Paquetes × Unid/Paquete</b>. El <b>Precio unitario</b> se calcula como <b>Precio paquete ÷ Unid/Paquete</b>.
        </p>
        <label className="subtitle" style={{ marginTop: 12 }}>Buscar producto</label>
        <input className="input" placeholder="Nombre o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* Tabla de productos */}
      <div className="card">
        <h3>Productos activos</h3>

        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "8px 6px" }}>Producto</th>
                <th style={{ padding: "8px 6px" }}>SKU</th>
                <th style={{ padding: "8px 6px" }}>Stock</th>
                <th style={{ padding: "8px 6px" }}>Paquetes</th>
                <th style={{ padding: "8px 6px" }}>Unid/Paquete</th>
                <th style={{ padding: "8px 6px" }}>Precio paquete</th>
                <th style={{ padding: "8px 6px" }}>Precio unitario</th>
                <th style={{ padding: "8px 6px" }}>Precio venta</th>
                <th style={{ padding: "8px 6px" }}></th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((p) => {
                const d = defaults[p.id] || { packages: 1, upp: 0, pkgCost: 0 };
                const unit = unitCostOf(p.id);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 6px" }}>{p.name}</td>
                    <td style={{ padding: "8px 6px" }}>{p.sku || "—"}</td>
                    <td style={{ padding: "8px 6px" }}>{p.stock}</td>

                    {/* Paquetes */}
                    <td style={{ padding: "8px 6px" }}>
                      <input
                        className="input"
                        style={{ width: 110 }}
                        type="number"
                        min="0"
                        value={d.packages ?? 1}
                        onChange={(e) => updateDefault(p.id, "packages", e.target.value)}
                      />
                    </td>

                    {/* Unid/Paquete */}
                    <td style={{ padding: "8px 6px" }}>
                      <input
                        className="input"
                        style={{ width: 120 }}
                        type="number"
                        min="0"
                        value={d.upp ?? 0}
                        onChange={(e) => updateDefault(p.id, "upp", e.target.value)}
                      />
                    </td>

                    {/* Precio paquete */}
                    <td style={{ padding: "8px 6px" }}>
                      <input
                        className="input"
                        style={{ width: 140 }}
                        type="number"
                        min="0"
                        step="1"
                        value={d.pkgCost ?? 0}
                        onChange={(e) => updateDefault(p.id, "pkgCost", e.target.value)}
                      />
                    </td>

                    {/* Precio unitario (auto front) */}
                    <td style={{ padding: "8px 6px", fontWeight: 600 }}>{moneyCO(unit)}</td>

                    {/* Precio de venta (solo memoria; se guarda al completar compra) */}
                    <td style={{ padding: "8px 6px" }}>
                      <input
                        className="input"
                        style={{ width: 140 }}
                        type="number"
                        min="0"
                        step="1"
                        value={salePriceByProd[p.id] ?? 0}
                        onChange={(e) =>
                          setSalePriceByProd((s) => ({ ...s, [p.id]: e.target.value }))
                        }
                        title="Precio de venta (inventario). Se guardará al completar la compra."
                      />
                    </td>

                    {/* Agregar */}
                    <td style={{ padding: "8px 6px" }}>
                      <button className="btn" onClick={() => addToCart(p)}>Agregar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Carrito */}
      <div className="card">
        <h3>Carrito</h3>

        {cart.length === 0 ? (
          <p className="subtitle">Aún no agregas productos.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 6px" }}>Producto</th>
                  <th style={{ padding: "8px 6px" }}>Paquetes</th>
                  <th style={{ padding: "8px 6px" }}>Unid/Paquete</th>
                  <th style={{ padding: "8px 6px" }}>Precio paquete</th>
                  <th style={{ padding: "8px 6px" }}>Precio unitario</th>
                  <th style={{ padding: "8px 6px" }}>Unidades (+)</th>
                  <th style={{ padding: "8px 6px" }}>Subtotal</th>
                  <th style={{ padding: "8px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((it) => {
                  const unitsAdd = (Number(it.packages) || 0) * (Number(it.upp) || 0);
                  const subtotal = (Number(it.packages) || 0) * (Number(it.pkgCost) || 0);
                  return (
                    <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 6px" }}>{it.name}</td>
                      <td style={{ padding: "8px 6px" }}>{it.packages}</td>
                      <td style={{ padding: "8px 6px" }}>{it.upp}</td>
                      <td style={{ padding: "8px 6px" }}>{moneyCO(it.pkgCost)}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{moneyCO(it.unitCost)}</td>
                      <td style={{ padding: "8px 6px" }}>{unitsAdd}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{moneyCO(subtotal)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <button
                          className="btn"
                          onClick={() => setCart((prev) => prev.filter((x) => x.id !== it.id))}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td></td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>Total paquetes</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>
                    {cart.reduce((s, x) => s + (Number(x.packages) || 0), 0)}
                  </td>
                  <td></td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>Unidades (+)</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>
                    {cart.reduce(
                      (s, x) => s + (Number(x.packages) || 0) * (Number(x.upp) || 0),
                      0
                    )}
                  </td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>
                    {moneyCO(
                      cart.reduce(
                        (s, x) => s + (Number(x.packages) || 0) * (Number(x.pkgCost) || 0),
                        0
                      )
                    )}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {msg && <div style={{ color: "crimson", marginTop: 10 }}>{msg}</div>}

        <div className="stack" style={{ marginTop: 12 }}>
          <button className="btn brand" onClick={savePurchase} disabled={!isAdmin || saving || cart.length === 0}>
            {saving ? "Guardando…" : "Guardar compra"}
          </button>
          <button className="btn" onClick={() => setCart([])} disabled={saving || cart.length === 0}>
            Vaciar carrito
          </button>
        </div>
      </div>
    </div>
  );
}
