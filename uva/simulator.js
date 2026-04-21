// simulador.js

// ===== Helpers =====
const fmtARS = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const fmtNum = (n, digits = 2) =>
  new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function monthlyRateFromTNA(tnaPct) {
  return (Number(tnaPct) / 100) / 12;
}

function frenchPayment(P, i, n) {
  if (i === 0) return P / n;
  const pow = Math.pow(1 + i, n);
  return P * (i * pow) / (pow - 1);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

// ===== Gastos entidad =====
function getDefaultPctByMode(mode) {
  if (mode === "restar") return 11.75;
  return 13.31; // sumar
}

function calcularMontoConGastos(montoBase, modo, porcentaje) {
  const pct = Number(porcentaje) / 100;
  const gastoArs = montoBase * pct;

  let montoFinal = montoBase;

  if (modo === "sumar") {
    montoFinal = montoBase + gastoArs;
  } else if (modo === "restar") {
    montoFinal = montoBase - gastoArs;
  }

  return {
    montoBase,
    modo,
    porcentaje: Number(porcentaje),
    gastoArs,
    montoFinal,
  };
}

// ===== BCRA UVA =====
async function fetchUVA() {
  const listUrl =
    "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?Limit=10000&Offset=0";

  const listResp = await fetch(listUrl);
  const list = await listResp.json();
  const results = list.results || [];

  const uvaVar = results.find((v) => {
    const d = (v.descripcion || "").toLowerCase().trim();
    return (
      d === "unidad de valor adquisitivo (uva)" ||
      d === "uva" ||
      d.includes("unidad de valor adquisitivo")
    );
  });

  if (!uvaVar) {
    throw new Error("No encontré la variable UVA en el listado del BCRA.");
  }

  const id = uvaVar.idVariable;
  const detUrl = `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${id}`;

  const detResp = await fetch(detUrl);
  const det = await detResp.json();

  const serie = det.results?.[0]?.detalle || [];

  if (!serie.length) {
    throw new Error("No se encontró la serie de UVA.");
  }

  const hoy = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const seriePasadaOVigente = serie.filter((d) => d.fecha <= hoy);

  if (!seriePasadaOVigente.length) {
    throw new Error("No encontré un valor de UVA vigente para hoy o una fecha anterior.");
  }

  const datoVigente = seriePasadaOVigente.reduce((a, b) =>
    a.fecha > b.fecha ? a : b
  );

  return {
    valor: Number(datoVigente.valor),
    fecha: datoVigente.fecha,
    idVariable: id,
    descripcion: uvaVar.descripcion,
  };
}

// ===== Cálculo =====
function buildSchedule({ montoArs, plazo, tnaPct, inflacionPct, uvaHoy }) {
  const i = monthlyRateFromTNA(tnaPct);
  const infl = Number(inflacionPct) / 100;

  const capitalInicialUva = montoArs / uvaHoy;
  const cuotaPuraUvaFija = frenchPayment(capitalInicialUva, i, plazo);

  let saldo = capitalInicialUva;
  const rows = [];

  for (let cuota = 1; cuota <= Math.min(plazo, 12); cuota++) {
    const interesUva = saldo * i;
    const capitalUva = cuotaPuraUvaFija - interesUva;
    const saldoNuevo = Math.max(0, saldo - capitalUva);

    const uvaEstimada = uvaHoy * Math.pow(1 + infl, cuota - 1);

    const ivaUva = interesUva * 0.21;
    const cuotaPuraUva = capitalUva + interesUva;
    const totalCuotaUva = cuotaPuraUva + ivaUva;
    const totalCuotaArs = totalCuotaUva * uvaEstimada;

    rows.push({
      cuota,
      capitalUva,
      interesUva,
      ivaUva,
      cuotaPuraUva,
      totalCuotaUva,
      totalCuotaArs,
      uvaEstimada,
      saldoUva: saldoNuevo,
    });

    saldo = saldoNuevo;
  }

  return {
    capitalInicialUva,
    cuotaPuraUvaFija,
    rows,
  };
}

// ===== Render =====
function renderTable(rows) {
  const tbody = $("tabla");
  if (!tbody) return;

  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.cuota}</td>
        <td>${fmtNum(r.capitalUva, 4)}</td>
        <td>${fmtNum(r.interesUva, 4)}</td>
        <td>${fmtNum(r.ivaUva, 4)}</td>
        <td>${fmtNum(r.cuotaPuraUva, 4)}</td>
        <td>${fmtNum(r.totalCuotaUva, 4)}</td>
        <td>${fmtARS(r.totalCuotaArs)}</td>
      </tr>
    `
    )
    .join("");
}

function renderMontoResumen({ montoBase, modo, porcentaje, gastoArs, montoFinal }) {
  setText("montoIngresado", fmtARS(montoBase));
  setText("porcentajeGastosAplicado", `${fmtNum(porcentaje, 2)}%`);
  setText("gastosEntidadArs", fmtARS(gastoArs));

  if (modo === "sumar") {
    setText("labelMontoFinal", "Monto total financiado");
  } else {
    setText("labelMontoFinal", "Neto a recibir");
  }

  setText("montoFinalCalculado", fmtARS(montoFinal));
}

function buildSummary({
  montoBase,
  modoGastos,
  porcentajeGastos,
  gastoArs,
  montoFinal,
  plazo,
  tnaPct,
  inflacionPct,
  uva,
  capitalInicialUva,
  cuotaPuraUvaFija,
  totalCuotaArs1,
}) {
  const modoTxt =
    modoGastos === "sumar"
      ? "Sumar gastos al monto"
      : "Monto ingresado representa máximo final";

  return [
    "Simulador UVA",
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)}`,
    `Monto ingresado: ${fmtARS(montoBase)}`,
    `Modo gastos: ${modoTxt}`,
    `Porcentaje gastos: ${fmtNum(porcentajeGastos, 2)}%`,
    `Gastos entidad: ${fmtARS(gastoArs)}`,
    `${
      modoGastos === "sumar"
        ? `Monto total financiado: ${fmtARS(montoFinal)}`
        : `Neto a recibir: ${fmtARS(montoFinal)}`
    }`,
    `Plazo: ${plazo} meses`,
    `TNA: ${fmtNum(tnaPct, 2)}%`,
    `Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`,
    `Capital inicial (UVA): ${fmtNum(capitalInicialUva, 4)}`,
    `Cuota pura fija (UVA): ${fmtNum(cuotaPuraUvaFija, 4)}`,
    `1ra cuota total (ARS): ${fmtARS(totalCuotaArs1)}`,
  ].join("\n");
}

// ===== Principal =====
async function calcular() {
  try {
    setStatus("Buscando UVA en BCRA...");

    const montoBase = Number($("montoArs")?.value || 0);
    const plazo = Number($("plazo")?.value || 0);
    const tnaPct = Number($("tna")?.value || 0);
    const inflacionPct = Number($("inflacion")?.value || 0);
    const modoGastos = $("modoGastos")?.value || "sumar";
    const porcentajeGastos = Number($("porcentajeGastos")?.value || 0);

    if (montoBase <= 0 || plazo <= 0) {
      throw new Error("Completá monto y plazo con valores válidos.");
    }

    if (porcentajeGastos < 0) {
      throw new Error("El porcentaje de gastos no puede ser negativo.");
    }

    const gastos = calcularMontoConGastos(montoBase, modoGastos, porcentajeGastos);

    if (gastos.montoFinal <= 0) {
      throw new Error("El monto final calculado debe ser mayor a cero.");
    }

    const uva = await fetchUVA();

    setText("uvaActual", `$${fmtNum(uva.valor, 2)}`);
    setText("uvaFecha", `Fecha: ${uva.fecha}`);

    renderMontoResumen(gastos);

    const { capitalInicialUva, cuotaPuraUvaFija, rows } = buildSchedule({
      montoArs: gastos.montoFinal,
      plazo,
      tnaPct,
      inflacionPct,
      uvaHoy: uva.valor,
    });

    setText("capitalUva", fmtNum(capitalInicialUva, 4));
    setText("cuotaUva", fmtNum(cuotaPuraUvaFija, 4));

    const primera = rows[0];
    setText("cuotaArs1", primera ? fmtARS(primera.totalCuotaArs) : "—");

    renderTable(rows);

    window.__summary = buildSummary({
      montoBase: gastos.montoBase,
      modoGastos: gastos.modo,
      porcentajeGastos: gastos.porcentaje,
      gastoArs: gastos.gastoArs,
      montoFinal: gastos.montoFinal,
      plazo,
      tnaPct,
      inflacionPct,
      uva,
      capitalInicialUva,
      cuotaPuraUvaFija,
      totalCuotaArs1: primera?.totalCuotaArs || 0,
    });

    setStatus(`Listo. UVA tomada de BCRA (${uva.fecha}).`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message || error}`);
  }
}

// ===== Eventos =====
$("btnCalcular")?.addEventListener("click", calcular);

$("btnCopiar")?.addEventListener("click", async () => {
  const text = window.__summary || "Primero calculá para generar el resumen.";

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Resumen copiado al portapapeles.");
  } catch (error) {
    console.error(error);
    setStatus("No pude copiar el resumen.");
  }
});

$("modoGastos")?.addEventListener("change", (e) => {
  const mode = e.target.value;
  const inputPct = $("porcentajeGastos");
  if (inputPct) {
    inputPct.value = getDefaultPctByMode(mode);
  }
});

// Mensaje inicial
setStatus("Ingresá los datos y presioná Calcular.");
