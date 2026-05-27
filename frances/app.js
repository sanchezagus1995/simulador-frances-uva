const IVA = 0.21;

function fmtARS(n) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "percent",
    maximumFractionDigits: 4,
  }).format(n);
}

async function logSimulacion(data) {
  try {
    await fetch("https://y-loki-api.sanchezagus-1995.workers.dev/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
  } catch (err) {
    console.error("Error enviando log:", err);
  }
}

function pow(a, b) {
  return Math.pow(a, b);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getEl(id) {
  return document.getElementById(id);
}

function tasaMensualFromTNA(tnaPct) {
  return (tnaPct / 100) / 12;
}

function cuotaFijaSinIVA(M, n, i) {
  if (i === 0) return M / n;
  return M * (i / (1 - pow(1 + i, -n)));
}

function interesPrimerMes(M, i) {
  return M * i;
}

function ivaPrimerMes(interes1) {
  return interes1 * IVA;
}

function saldoPrevio(M, i, n) {
  const aN = pow(1 + i, n);
  const aN_1 = pow(1 + i, n - 1);
  const num = aN - aN_1;
  const den = aN - 1;
  if (den === 0) return NaN;
  return M * (num / den);
}

function interesUltima(saldoPrev, i) {
  return saldoPrev * i;
}

function ivaUltima(interesUlt) {
  return interesUlt * IVA;
}

function tea(i) {
  return pow(1 + i, 12) - 1;
}

function cftea(i) {
  return pow(1 + i * (1 + IVA), 12) - 1;
}

function readInputs() {
  const M = Number(getEl("monto")?.value || 0);
  const n = Number(getEl("plazo")?.value || 0);
  const tna = Number(getEl("tna")?.value || 0);
  return { M, n, tna };
}

function clearTablaCuotas() {
  const tbody = getEl("tabla-cuotas-body");
  if (tbody) tbody.innerHTML = "";
}

function clearCalcUI() {
  [
    "res-tna",
    "res-cuota1",
    "res-cuota-final",
    "res-cftea",
  ].forEach((id) => setText(id, "—"));

  clearTablaCuotas();
}

function setStatus(msg) {
  setText("status", msg || "");
}

function generarTablaCuotas(M, n, i, cuotaSinIva) {
  const tbody = getEl("tabla-cuotas-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  let saldo = M;

  for (let mes = 1; mes <= n; mes++) {
    const interes = saldo * i;
    const iva = interes * IVA;
    const capital = cuotaSinIva - interes;
    const cargoExtra = mes === 1 ? M * 0.012 : 0;
    const cuota = cuotaSinIva + iva + cargoExtra;
    const nuevoSaldo = Math.max(0, saldo - capital);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${mes}</td>
      <td>${fmtARS(interes)}</td>
      <td>${fmtARS(iva)}</td>
      <td>${fmtARS(capital)}</td>
      <td>${fmtARS(nuevoSaldo)}</td>
      <td>${fmtARS(cuota)}</td>
    `;

    tbody.appendChild(tr);
    saldo = nuevoSaldo;
  }
}

function calcular() {
  const { M, n, tna } = readInputs();

  if (!(M > 0) || !(n > 0) || tna < 0) {
    clearCalcUI();
    setStatus("Ingresá un monto, plazo y TNA válidos.");
    return null;
  }

  const i = tasaMensualFromTNA(tna);

  const cuotaSinIva = cuotaFijaSinIVA(M, n, i);
  const interes1 = interesPrimerMes(M, i);
  const iva1 = ivaPrimerMes(interes1);
  const cargoExtra = M * 0.012;
  const cuota1 = cuotaSinIva + iva1 + cargoExtra;

  const saldoPrev = saldoPrevio(M, i, n);
  const interesUlt = interesUltima(saldoPrev, i);
  const ivaUlt = ivaUltima(interesUlt);
  const cuotaUlt = saldoPrev + interesUlt + ivaUlt;

  setText("res-tna", `${tna}%`);
  setText("res-cuota1", fmtARS(cuota1));
  setText("res-cuota-final", fmtARS(cuotaUlt));
  setText("res-cftea", fmtPct(cftea(i)));

  generarTablaCuotas(M, n, i, cuotaSinIva);

  setStatus("Simulación calculada.");

  logSimulacion({
    simulador: "frances",
    monto: M,
    plazo: n,
    tna,
    cuota1,
    cuotaUlt,
    timestamp: new Date().toISOString()
  });

  return {
    M,
    n,
    tna,
    i,
    cuotaSinIva,
    interes1,
    iva1,
    cuota1,
    saldoPrev,
    interesUlt,
    ivaUlt,
    cuotaUlt,
  };
}

async function copiarResultado() {
  const monto = getEl("monto")?.value || "—";
  const plazo = getEl("plazo")?.value || "—";
  const tna = getEl("tna")?.value || "—";

  const tnaTxt = getEl("res-tna")?.textContent || "—";
  const cuota1 = getEl("res-cuota1")?.textContent || "—";
  const cuotaFinal = getEl("res-cuota-final")?.textContent || "—";
  const cfteaTxt = getEl("res-cftea")?.textContent || "—";

  const texto = [
    "Simulación Sistema Francés",
    "",
    `Plazo: ${plazo} meses`,
    `TNA ingresada: ${tna} %`,
    "",
    `TNA: ${tnaTxt}`,
    `Cuota 1: ${cuota1}`,
    `Cuota final: ${cuotaFinal}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(texto);
    setStatus("Resultado copiado.");
  } catch (err) {
    console.error(err);
    setStatus("No se pudo copiar el resultado.");
  }
}

function init() {
  getEl("btn")?.addEventListener("click", calcular);
  getEl("btnCopiar")?.addEventListener("click", copiarResultado);
  setStatus("");
}

document.addEventListener("DOMContentLoaded", init);
