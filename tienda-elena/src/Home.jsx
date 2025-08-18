// src/Home.jsx
import { useNavigate } from "react-router-dom";

export default function Home({ user }) {
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin" || user?.isAdmin === true;

  return (
    <div className="page" style={{marginTop:40}}>
      <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
        <br></br>
        <h2>Bienvenido a Tiendita Zaphire</h2>
        <p className="subtitle">Selecciona una opción:</p>

        <div className="stack" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => navigate("/inventario")}>📦 Inventario</button>
          <button className="btn" onClick={() => navigate("/ventas")}>🛒 Ventas</button>
          <button className="btn" onClick={() => navigate("/clientes")}>👥 Clientes</button>
          <button className="btn" onClick={() => navigate("/reportes")}>📊 Reportes</button>
          <button className="btn" onClick={() => navigate("/conteo-inventario")}>📋 Contar inventario</button>
          {isAdmin && (
            <button className="btn" onClick={() => navigate("/compras")}>🛍️ Compras (admin)</button>
          )}
        </div>
      </div>
    </div>
  );
}