// src/lib/format.jsx

// --- Moneda COP (Colombia) ---
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

// src/lib/format.jsx

export function fmtDateCO(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Formatea fecha y hora en formato colombiano (DD/MM/AAAA HH:MM)
export function fmtDateTimeCO(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Bogota"
  });
}

// Formatea valores monetarios en Pesos Colombianos
export function fmtMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value || 0);
}

// Si aún usas formato ISO (AAAA-MM-DD)
export function fmtDate(date) {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}


// --- helpers para construir rangos en UTC a partir de "YYYY-MM-DD" (hora Bogotá) ---
export function zFromLocalDate(dateStr) {
  // 00:00 hora Colombia
  const d = new Date(`${dateStr}T00:00:00-05:00`);
  return d.toISOString();
}
export function zToLocalDate(dateStr) {
  // 23:59:59 hora Colombia
  const d = new Date(`${dateStr}T23:59:59-05:00`);
  return d.toISOString();
}
// --- QUINCENAS (zona Bogotá = UTC-5) ---
// Devuelve [startUTC, endUTC, label] de la quincena que contiene 'd' (Date)
// --- QUINCENAS (zona Bogotá = UTC-5) ---
// Devuelve [startUTC, endUTC, label] de la quincena que contiene 'd'
// --- QUINCENAS (zona Bogotá = UTC-5) ---
// Devuelve [startUTC(Date), endUTC(Date), label(String)]
export function getQuincenaRangeUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  let day = d.getUTCDate();

  // Antes de las 05:00 UTC aún es “ayer” en Bogotá
  if (d.getUTCHours() < 5) day -= 1;

  const isFirst = day <= 15;
  const startDay = isFirst ? 1 : 16;

  // 00:00 Bogotá = 05:00 UTC
  const startUTC = new Date(Date.UTC(y, m, startDay, 5, 0, 0, 0));

  // Fin EXCLUSIVO:
  // 1–15  => 16 05:00Z
  // 16–fin => 1 del mes sig. 05:00Z
  const endUTC = isFirst
    ? new Date(Date.UTC(y, m, 16, 5, 0, 0, 0))
    : new Date(Date.UTC(y, m + 1, 1, 5, 0, 0, 0));

  // Etiqueta INCLUSIVA dd/mm/yyyy – dd/mm/yyyy
  const pad = n => String(n).padStart(2, "0");
  const endDayInclusive = isFirst
    ? 15
    : new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // último día del mes
  const label = `${pad(startDay)}/${pad(m + 1)}/${y} – ${pad(endDayInclusive)}/${pad(m + 1)}/${y}`;

  return [startUTC, endUTC, label];
}

// Lista las últimas N quincenas (incluye la actual)
export function listLastQuincenas(n = 8, fromDate = new Date()) {
  const out = [];
  let [startUTC, endUTC, label] = getQuincenaRangeUTC(fromDate);
  for (let i = 0; i < n; i++) {
    out.push({ startUTC, endUTC, label });
    // retrocede a la quincena anterior (tomamos un día antes del inicio actual)
    const prevDay = new Date(startUTC.getTime() - 24 * 3600 * 1000);
    [startUTC, endUTC, label] = getQuincenaRangeUTC(prevDay);
  }
  return out;
}
// src/lib/format.js
export function zToLocalDateEnd(d /* "YYYY-MM-DD" */) {
  const [y, m, day] = d.split("-").map(Number);
  // Inicio del día siguiente en UTC -> fin exclusivo del rango
  return new Date(Date.UTC(y, m - 1, day + 1, 0, 0, 0)).toISOString();
}