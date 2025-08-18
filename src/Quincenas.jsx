// src/Quincenas.jsx
import { useEffect, useState } from "react";
//import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";


export default function Quincenas() {
  const [list, setList] = useState([]);
  const [openPeriod, setOpenPeriod] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [toast, setToast] = useState("");

  async function load() {
    setMsg("");
    const { data, error } = await supabase
      .from("periods")
      .select("id,name,status,start_date,end_date,created_at")
      .order("id", { ascending: false });

    if (error) { setMsg(error.message); return; }
    setList(data || []);
    setOpenPeriod((data || []).find(p => p.status === "open") || null);
  }

  useEffect(() => { load(); }, []);

  async function openNew() {
    setMsg(""); setSaving(true);
    try {
      // cierra si hay una abierta (opcional)
      if (openPeriod) {
        const { error: eClose } = await supabase
          .from("periods")
          .update({ status: "closed", end_date: new Date().toISOString() })
          .eq("id", openPeriod.id);
        if (eClose) throw eClose;
      }
      // abre nueva
      const newName = name.trim() || new Date().toLocaleDateString("es-PE", { year:"numeric", month:"2-digit", day:"2-digit" });
      const { error: eOpen } = await supabase
        .from("periods")
        .insert([{ name: newName, status: "open", start_date: new Date().toISOString() }]);
      if (eOpen) throw eOpen;

      setName("");
      await load();
      setToast("Quincena abierta");
      setTimeout(()=>setToast(""), 2000);
    } catch (err) {
      setMsg(err.message || "Error al abrir quincena");
    } finally {
      setSaving(false);
    }
  }

  async function closeCurrent() {
    if (!openPeriod) return;
    setMsg(""); setSaving(true);
    try {
      const { error } = await supabase
        .from("periods")
        .update({ status: "closed", end_date: new Date().toISOString() })
        .eq("id", openPeriod.id);
      if (error) throw error;

      await load();
      setToast("Quincena cerrada");
      setTimeout(()=>setToast(""), 2000);
    } catch (err) {
      setMsg(err.message || "Error al cerrar quincena");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <h2>Quincenas</h2>

      {toast && (
        <div style={{
          position:"fixed", right:16, bottom:16, padding:"10px 14px",
          borderRadius:10, background:"#e6ffed", border:"1px solid #b8e6c7",
          boxShadow:"0 6px 18px rgba(0,0,0,.12)", zIndex:9999
        }}>
          {toast}
        </div>
      )}

      <div className="card">
        <h3>Estado actual</h3>
        {openPeriod ? (
          <p className="subtitle" style={{marginTop:6}}>
            Abierta: <b>{openPeriod.name}</b> (desde {new Date(openPeriod.start_date).toLocaleString()})
          </p>
        ) : (
          <p className="subtitle" style={{marginTop:6, color:"crimson"}}>No hay quincena abierta</p>
        )}

        <div className="stack" style={{marginTop:12}}>
          <div className="grid" style={{gridTemplateColumns:"2fr 1fr", gap:12}}>
            <input
              className="input"
              placeholder="Nombre de la nueva quincena (opcional)"
              value={name}
              onChange={(e)=>setName(e.target.value)}
            />
            <button className="btn brand" onClick={openNew} disabled={saving}>
              {saving ? "Guardando…" : "Abrir nueva"}
            </button>
          </div>

          <button className="btn" onClick={closeCurrent} disabled={!openPeriod || saving}>
            {saving ? "Guardando…" : "Cerrar la actual"}
          </button>

          {msg && <div style={{color:"crimson"}}>{msg}</div>}
        </div>
      </div>

      <div className="card" style={{marginTop:16}}>
        <h3>Histórico</h3>
        <div style={{overflowX:"auto", marginTop:8}}>
          <table style={{width:"100%", borderCollapse:"collapse"}}>
            <thead>
              <tr style={{textAlign:"left", borderBottom:"1px solid var(--border)"}}>
                <th style={{padding:"8px 6px"}}>#</th>
                <th style={{padding:"8px 6px"}}>Nombre</th>
                <th style={{padding:"8px 6px"}}>Estado</th>
                <th style={{padding:"8px 6px"}}>Inicio</th>
                <th style={{padding:"8px 6px"}}>Fin</th>
              </tr>
            </thead>
            <tbody>
              {list.map(p => (
                <tr key={p.id} style={{borderBottom:"1px solid var(--border)"}}>
                  <td style={{padding:"8px 6px"}}>{p.id}</td>
                  <td style={{padding:"8px 6px"}}>{p.name}</td>
                  <td style={{padding:"8px 6px"}}>{p.status}</td>
                  <td style={{padding:"8px 6px"}}>{p.start_date ? new Date(p.start_date).toLocaleString() : "—"}</td>
                  <td style={{padding:"8px 6px"}}>{p.end_date ? new Date(p.end_date).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan="5" className="subtitle" style={{padding:"8px 6px"}}>Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
