import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";

import { supabase } from "./supabaseClient";
import Home from "./Home.jsx";
import Compras from "./compras";
import Reportes from "./Reportes.jsx";
import ConteoInventario from "./ConteoInventario.jsx";
import { NavLink } from "react-router-dom";
import Ventas from "./ventas.jsx";
import { useNavigate } from "react-router-dom";



// Cliente de Supabase con tus variables .env

/* ---------- Auth mínima (igual que antes) ---------- */
function LoginView() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");

  async function onSubmit(e) {
  e.preventDefault();
  setMsg("");

  try {
    if (mode === "signin") {
      // Iniciar sesión
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      navigate("/"); // al inicio
    } else {
      // Registro
      const { data, error } = await supabase.auth.signUp({ 
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            full_name: fullName.trim(),
          },
        },
      });
      if (error){
        setMsg(error.message);
        return;
      } 

      // ⚠️ Validar que haya nombre
      if (!fullName.trim()) {
        setMsg("Escribe tu nombre y apellido.");
        return;
      }

      // Obtener el ID del usuario creado
      const userId = data.user?.id;
      if (!userId) {
        setMsg("No se obtuvo el usuario tras el registro.");
        return;
      }

      // Guardar nombre completo en profiles
      const { error: eProfile } = await supabase
        .from("profiles")
        .upsert(
          { id: userId, email, full_name: fullName },
          { onConflict: "id" }
        );

      if (eProfile) throw eProfile;

      setMsg("Te enviamos un correo. Tras confirmar, volverás aquí con sesión iniciada.");
    }
  } catch (err) {
    setMsg(err.message);
  }
}

  return (
  <div className="login-container">
    <div className="login-card">
      <img src="/logo.png" alt="Zaphire Tiendita" className="login-logo" />
      <h1>Zaphire Tiendita</h1>
      <p>{mode === "signin" ? "Inicia sesión" : "Regístrate"}</p>

      <form onSubmit={onSubmit} className="auth-form">
        <input
          type="email"
          placeholder="Email"
          value={email}
          autoComplete="new-email"
          onChange={(e) => setEmail(e.target.value)}
        />

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Nombre y Apellido"
            value={fullName}
            autoComplete="new-name"
            onChange={(e) => setFullName(e.target.value)}
          />
        )}

        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit">
          {mode === "signin" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      {msg && <p className="error">{msg}</p>}

      <p>
        {mode === "signin" ? (
          <button onClick={() => setMode("signup")}>
            ¿No tienes cuenta? Regístrate
          </button>
        ) : (
          <button onClick={() => setMode("signin")}>
            ¿Ya tienes cuenta? Inicia sesión
          </button>
        )}
      </p>
    </div>
  </div>
);}

/* ---------- Layout / Navbar ---------- */
function Navbar({ role, onSignOut }) {
  const location = useLocation();
  const path = location.pathname;
  const tab = (to, label) => (
    <Link to={to} className={`tab ${path === to ? "active" : ""}`}>{label}</Link>
  );

  return (
    /* === HEADER / NAV === */
<header className="navbar">
  <div className="brand">
    <img src="/logo.png" alt="Zaphire Tiendita" className="brand-logo" />
    <div className="brand-text">
      <div className="brand-title">Zaphire Tiendita</div>
      <div className="brand-role">Rol: {role}</div>
    </div>
  </div>

  <nav className="tabs no-print">
    <NavLink to="/" end className={({isActive}) => isActive ? 'active' : ''}>Inicio</NavLink>
    <NavLink to="/inventario" className={({isActive}) => isActive ? 'active' : ''}>Inventario</NavLink>
    <NavLink to="/conteo-inventario" className={({isActive}) => isActive ? 'active' : ''}>Contar Inventario</NavLink>
    <NavLink to="/ventas" className={({isActive}) => isActive ? 'active' : ''}>Ventas</NavLink>
    <NavLink to="/clientes" className={({isActive}) => isActive ? 'active' : ''}>Clientes</NavLink>
    <NavLink to="/compras" className={({isActive}) => isActive ? 'active' : ''}>Compras</NavLink>
    <NavLink to="/reportes" className={({isActive}) => isActive ? 'active' : ''}>Reportes</NavLink>
    <button onClick={onSignOut}>Salir</button>
  </nav>
</header>

  );
}

/* ---------- Rutas protegidas ---------- */
function ProtectedRoute({ session, children }) {
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ role, children }) {
  // Espera a que el rol cargue para no disparar alerta por error
  if (role == null) return null;
  if (role !== "admin") {
    alert("No tienes permiso para ver esta ventana");
    return <Navigate to="/" replace />;
  }
  return children;
}

/* ---------- Páginas (vacías por ahora) ---------- */
const Inicio = () => <div style={{ padding: 16 }}>Resumen (luego pondremos tarjetas rápidas).</div>;

/*Pagina Inventario */
const Inventario = ({ role }) => {
  const isAdmin = role === "admin";

  // Estado
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form crear (solo admin)
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [msg, setMsg] = useState("");

  // Filtros
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("active"); // active | inactive | all

  // Ajuste de stock (solo admin)
  const [adjustFor, setAdjustFor] = useState(null); // { id, name } o null
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjMsg, setAdjMsg] = useState("");

  // Cargar productos
  async function fetchProducts() {
    setLoading(true);
    let query = supabase
      .from("products")
      .select("id,name,sku,price,stock,active,created_at")
      .order("name", { ascending: true });

    if (filter === "active") query = query.eq("active", true);
    if (filter === "inactive") query = query.eq("active", false);

    const { data, error } = await query;
    if (error) {
      setMsg(error.message);
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchProducts(); /* eslint-disable-line */ }, [filter]);

  // Crear producto (solo admin)
  async function onCreate(e) {
    e.preventDefault();
    if (!isAdmin) return;
    setMsg("");

    if (!name.trim()) { setMsg("El nombre es obligatorio."); return; }
    const priceNum = Number(price);
    const stockNum = Number(stock || 0);
    if (!Number.isFinite(priceNum) || priceNum < 0) { setMsg("Precio inválido."); return; }
    if (!Number.isFinite(stockNum) || stockNum < 0) { setMsg("Stock inválido."); return; }

    const { error } = await supabase.from("products").insert([{
      name: name.trim(),
      sku: sku.trim() || null,
      price: priceNum,
      stock: stockNum,
      active: true
    }]);

    if (error) { setMsg(error.message); return; }

    setName(""); setSku(""); setPrice(""); setStock("");
    fetchProducts();
  }

  // Activar / Inactivar (solo admin)
  async function toggleActive(id, current) {
    if (!isAdmin) return;
    const { error } = await supabase
      .from("products")
      .update({ active: !current })
      .eq("id", id);
    if (error) { alert(error.message); return; }
    fetchProducts();
  }

  // Ajuste de stock (solo admin)
  async function submitAdjustment(e) {
    e.preventDefault();
    if (!isAdmin || !adjustFor) return;
    setAdjMsg("");

    const qn = Number(adjQty);
    if (!Number.isFinite(qn) || qn === 0) {
      setAdjMsg("La cantidad debe ser un número distinto de 0 (usa + para entrada, - para salida).");
      return;
    }

    const { error } = await supabase
      .from("stock_movements")
      .insert([{
        product_id: adjustFor.id,
        qty_change: qn,
        reason: adjReason || "ajuste"
      }]);

    if (error) { setAdjMsg(error.message); return; }

    // Limpiar y recargar
    setAdjustFor(null);
    setAdjQty("");
    setAdjReason("");
    fetchProducts();
  }

  // Búsqueda en memoria
  const filtered = items.filter(p =>
    [p.name, p.sku].filter(Boolean).some(txt =>
      txt.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="page grid">
      <div className="card">
        <h2>Inventario</h2>
        <p className="subtitle" style={{ marginTop: 6 }}>
          {isAdmin ? "Admin crea/ajusta; seller solo lectura." : "Solo lectura (Seller)."}
        </p>

        {/* buscador + filtro */}
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Buscar por nombre o SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 180 }}
            value={filter}
            onChange={(e)=>setFilter(e.target.value)}
          >
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        {/* formulario de creación (solo admin) */}
        {isAdmin && (
          <form onSubmit={onCreate} style={{ display: "grid", gap: 8, maxWidth: 640, marginTop: 12 }}>
            <input
              className="input"
              placeholder="Nombre del producto *"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                className="input"
                placeholder="SKU (opcional)"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <input
                className="input"
                placeholder="Precio de venta *"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                className="input"
                placeholder="Stock inicial"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
              <div className="stack">
                <button className="btn brand" type="submit">Guardar producto</button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => { setName(""); setSku(""); setPrice(""); setStock(""); setMsg(""); }}
                >
                  Limpiar
                </button>
              </div>
            </div>
            {msg && <div style={{ color: "crimson" }}>{msg}</div>}
          </form>
        )}
      </div>

      {/* Listado */}
      <div className="card">
        <h3>Listado</h3>
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="subtitle">No hay productos para el filtro/búsqueda.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 6px" }}>Nombre</th>
                  <th style={{ padding: "8px 6px" }}>SKU</th>
                  <th style={{ padding: "8px 6px" }}>Precio</th>
                  <th style={{ padding: "8px 6px" }}>Stock</th>
                  <th style={{ padding: "8px 6px" }}>Estado</th>
                  {isAdmin && <th style={{ padding: "8px 6px" }}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 6px" }}>{p.name}</td>
                    <td style={{ padding: "8px 6px" }}>{p.sku || "—"}</td>
                    <td style={{ padding: "8px 6px" }}>${Number(p.price).toFixed(2)}</td>
                    <td style={{ padding: "8px 6px" }}>{p.stock}</td>
                    <td style={{ padding: "8px 6px" }}>{p.active ? "Activo" : "Inactivo"}</td>
                    {isAdmin && (
                      <td style={{ padding: "8px 6px" }}>
                        <div className="stack">
                          <button className="btn" onClick={() => setAdjustFor({ id: p.id, name: p.name })}>
                            Ajustar
                          </button>
                          <button className="btn" onClick={() => toggleActive(p.id, p.active)}>
                            {p.active ? "Inactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de ajuste de stock (solo admin) */}
      {isAdmin && adjustFor && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.2)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 100
          }}
          onClick={() => { setAdjustFor(null); setAdjQty(""); setAdjReason(""); setAdjMsg(""); }}
        >
          <div className="card" style={{ width: "min(520px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="stack" style={{ justifyContent: "space-between" }}>
              <h3>Ajustar stock — {adjustFor.name}</h3>
              <button className="btn" onClick={() => { setAdjustFor(null); setAdjQty(""); setAdjReason(""); setAdjMsg(""); }}>
                Cerrar
              </button>
            </div>

            <form onSubmit={submitAdjustment} style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  placeholder="Cantidad (+ entra / - sale)"
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Motivo (ej. compra, merma, ajuste)"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                />
              </div>
              {adjMsg && <div style={{ color: "crimson" }}>{adjMsg}</div>}
              <div className="stack">
                <button className="btn brand" type="submit">Guardar ajuste</button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => { setAdjustFor(null); setAdjQty(""); setAdjReason(""); setAdjMsg(""); }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/*pagina ventas*/


/*Pagina Clientes*/
const Clientes = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  // filtro: "active" | "inactive" | "all"
  const [filter, setFilter] = useState("active");

  async function fetchCustomers() {
    setLoading(true);
    let q = supabase
      .from("customers")
      .select("id,name,phone,email,active,created_at,deactivated_at")
      .order("created_at", { ascending: false });

    if (filter === "active") q = q.eq("active", true);
    if (filter === "inactive") q = q.eq("active", false);

    const { data, error } = await q;
    if (!error) setItems(data || []);
    setLoading(false);
  }

  useEffect(() => { fetchCustomers(); /* eslint-disable-next-line */ }, [filter]);

  async function onCreate(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("El nombre es obligatorio."); return; }

    const { error } = await supabase.from("customers").insert([{
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      active: true
    }]);

    if (error) { setError(error.message); return; }
    setName(""); setPhone(""); setEmail("");
    fetchCustomers();
  }

  async function toggleActive(id, currentActive) {
    const { error } = await supabase
      .from("customers")
      .update({
        active: !currentActive,
        deactivated_at: currentActive ? new Date().toISOString() : null
      })
      .eq("id", id);
    if (!error) fetchCustomers();
  }

  // (Opcional) eliminación dura si realmente lo necesitas
  async function onDelete(id) {
    if (!confirm("¿Eliminar este cliente de forma permanente? (No recomendado)")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (!error) fetchCustomers();
  }

  return (
    <div className="page grid">
      <div className="card">
        <h2>Clientes</h2>
        <p className="subtitle" style={{ marginTop: 6 }}>
          Agrega tus clientes. En Ventas mostraremos solo los <strong>activos</strong>.
        </p>

        <form onSubmit={onCreate} style={{ display: "grid", gap: 8, maxWidth: 520, marginTop: 12 }}>
          <input className="input" placeholder="Nombre del cliente *"
                 value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <input className="input" placeholder="Teléfono (opcional)"
                   value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="input" placeholder="Email (opcional)"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="stack">
            <button className="btn brand" type="submit">Guardar cliente</button>
            <button className="btn" type="button" onClick={() => { setName(""); setPhone(""); setEmail(""); }}>
              Limpiar
            </button>
          </div>
          {error && <div style={{ color: "crimson" }}>{error}</div>}
        </form>
      </div>

      <div className="card">
        <div className="stack" style={{ justifyContent: "space-between" }}>
          <h3>Listado</h3>
          <div className="stack">
            <label className="subtitle">Mostrar:</label>
            <select className="input" style={{ width: 180 }}
              value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">Solo activos</option>
              <option value="inactive">Solo inactivos</option>
              <option value="all">Todos</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p>Cargando…</p>
        ) : items.length === 0 ? (
          <p className="subtitle">No hay clientes para el filtro seleccionado.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 6px" }}>Nombre</th>
                  <th style={{ padding: "8px 6px" }}>Teléfono</th>
                  <th style={{ padding: "8px 6px" }}>Email</th>
                  <th style={{ padding: "8px 6px" }}>Estado</th>
                  <th style={{ padding: "8px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 6px" }}>{c.name}</td>
                    <td style={{ padding: "8px 6px" }}>{c.phone || "—"}</td>
                    <td style={{ padding: "8px 6px" }}>{c.email || "—"}</td>
                    <td style={{ padding: "8px 6px" }}>
                      {c.active ? "Activo" : "Inactivo"}
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <div className="stack">
                        <button className="btn"
                          onClick={() => toggleActive(c.id, c.active)}>
                          {c.active ? "Inactivar" : "Activar"}
                        </button>
                        {/* opcional, ocúltalo si no quieres borrados definitivos */}
                        {/* <button className="btn" onClick={() => onDelete(c.id)}>Eliminar</button> */}
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
};

/* ---------- App principal ---------- */
export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);

  // Mantener sesión
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Cargar rol cuando haya sesión
  useEffect(() => {
    if (!session?.user?.id) { setRole(null); return; }
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      if (!error) setRole(data?.role ?? "seller");
    })();
  }, [session]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <BrowserRouter>
      {session && <Navbar role={role} onSignOut={signOut} />}

      <Routes>
        {/* Auth */}
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginView />} />

        {/* Rutas protegidas (log in requerido) */}
        <Route path="/" element={
  <ProtectedRoute session={session}>
    <Home user={session?.user} />
  </ProtectedRoute>
} />
        <Route path="/inventario" element={
          <ProtectedRoute session={session}>
            <Inventario role={role} />
          </ProtectedRoute>
        } />
         <Route path="/conteo-inventario" element={
          <ProtectedRoute session={session}>
            <ConteoInventario role={role} />
          </ProtectedRoute>
        } />
        <Route path="/ventas" element={
          <ProtectedRoute session={session}>
            <Ventas role={role} />
          </ProtectedRoute>
        } />
        <Route path="/clientes" element={
          <ProtectedRoute session={session}><Clientes /></ProtectedRoute>
        } />
        <Route path="/reportes" element={
          <ProtectedRoute session={session}>
            <Reportes role={role} />
          </ProtectedRoute>
        } />
        <Route
  path="/conteo-inventario"
  element={
    <ProtectedRoute session={session}>
      <ConteoInventario role={role} />
    </ProtectedRoute>
  }
/>

        {/* Solo admin */}
        <Route
          path="/compras"
          element={
            <ProtectedRoute session={session}>
              <AdminRoute role={role}>
                <Compras role={role} />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to={session ? "/" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
