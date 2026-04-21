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
  const el = $("status");
  if (el) el.textContent = msg || "";
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

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value;
}

// ===== Configuración de gastos =====
const GASTOS_ENTIDAD = {
  12: { sumar: 13.31, restar: 11.75 },
  18: { sumar: 18.15, restar: 15.36 },
  24: { sumar: 22.99, restar: 18.69 },
};

const GASTO_INFINITO_RESTAR = 9.09;
const GASTO_INFINITO_SUMAR = 10.0;

function getPctEntidad(plazo, modo) {
  const cfg = GASTOS_ENTIDAD[Number(plazo)];
  if (!cfg) return 0;
  return Number(cfg[modo] || 0);
}

function getDefaultPctByMode(mode, plazo) {
  return getPctEntidad(plazo, mode);
}

// ===== Lógica de montos =====
function calcularMontosUVA(montoBase, plazo, modo) {
  const pctEntidad = getPctEntidad(plazo, modo);

  if (!pctEntidad) {
    throw new Error("No hay configuración de gastos para ese plazo.");
  }

  if (modo === "restar") {
    const pctEntidadDec = pctEntidad / 100;
    const pctInfinitoDec = GASTO_INFINITO_RESTAR / 100;

    const gastoEntidadArs = montoBase * pctEntidadDec;
    const gastoInfinitoArs = montoBase * pctInfinitoDec;
    const netoCliente = montoBase - gastoEntidadArs - gastoInfinitoArs;

    if (netoCliente <= 0) {
      throw new Error("El neto final debe ser mayor a cero.");
    }

    return {
      montoBase,
      plazo,
      modo,
      porcentajeEntidad: pctEntidad,
      porcentajeInfinito: GASTO_INFINITO_RESTAR,

      montoIntermedio: montoBase,
      montoFinal: netoCliente,
      montoFinanciado: montoBase,

      gastoEntidadArs,
      gastoInfinitoArs,

      netoCliente,
      netoInfinito: gastoInfinitoArs,
    };
  }

  if (modo === "sumar") {
    const pctInfinitoDec = GASTO_INFINITO_SUMAR / 100;
    const pctEntidadDec = pctEntidad / 100;

    const montoConInfinito = montoBase * (1 + pctInfinitoDec);
    const gastoInfinitoArs = montoConInfinito - montoBase;

    const gastoEntidadArs = montoConInfinito * pctEntidadDec;
    const montoFinanciado = montoConInfinito + gastoEntidadArs;

    return {
      montoBase,
      plazo,
      modo,
      porcentajeEntidad: pctEntidad,
      porcentajeInfinito: GASTO_INFINITO_SUMAR,

      montoIntermedio: montoConInfinito,
      montoFinal: montoFinanciado,
      montoFinanciado,

      gastoEntidadArs,
      gastoInfinitoArs,

      netoCliente: montoBase,
      netoInfinito: gastoInfinitoArs,
    };
  }

  throw new Error("Modo de gastos inválido.");
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

// ===== Cálculo de cuotas =====
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

function renderMontoResumen(data) {
  const {
    montoBase,
    modo,
    porcentajeEntidad,
    porcentajeInfinito,
    gastoEntidadArs,
    gastoInfinitoArs,
    montoIntermedio,
    montoFinal,
    netoCliente,
  } = data;

  setText("montoIngresado", fmtARS(montoBase));
  setText("porcentajeGastosAplicado", `${fmtNum(porcentajeEntidad, 2)}%`);
  setText("gastosEntidadArs", fmtARS(gastoEntidadArs));

  setText("porcentajeGastosInfinito", `${fmtNum(porcentajeInfinito, 2)}%`);
  setText("gastosInfinitoArs", fmtARS(gastoInfinitoArs));
  setText("montoIntermedioCalculado", fmtARS(montoIntermedio));
  setText("netoClienteArs", fmtARS(netoCliente));

  if (modo === "sumar") {
    setText("labelMontoFinal", "Monto total financiado");
    setText("labelMontoIngresado", "Monto base");
    setText("labelMontoIntermedio", "Monto + Infinito");
    setText("montoFinalCalculado", fmtARS(montoFinal));
  } else {
    setText("labelMontoFinal", "Neto a recibir");
    setText("labelMontoIngresado", "Monto base");
    setText("labelMontoIntermedio", "Monto usado para calcular cuotas");
    setText("montoFinalCalculado", fmtARS(montoFinal));
  }
}

function buildSummary({
  montoBase,
  plazo,
  modo,
  porcentajeEntidad,
  porcentajeInfinito,
  gastoEntidadArs,
  gastoInfinitoArs,
  montoIntermedio,
  montoFinal,
  netoCliente,
  netoInfinito,
  montoFinanciado,
  tnaPct,
  inflacionPct,
  uva,
  capitalInicialUva,
  cuotaPuraUvaFija,
  totalCuotaArs1,
}) {
  const modoTxt =
    modo === "sumar"
      ? "Monto específico + sumar gastos"
      : "Monto base - restar gastos";

  const lineas = [
    "Simulador UVA",
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)}`,
    `Modo: ${modoTxt}`,
    `Plazo: ${plazo} meses`,
    `Monto ingresado: ${fmtARS(montoBase)}`,
    `Gastos Infinito (${fmtNum(porcentajeInfinito, 2)}%): ${fmtARS(gastoInfinitoArs)}`,
    `Gastos entidad (${fmtNum(porcentajeEntidad, 2)}%): ${fmtARS(gastoEntidadArs)}`,
  ];

  if (modo === "sumar") {
    lineas.push(`Monto + Infinito: ${fmtARS(montoIntermedio)}`);
    lineas.push(`Monto total financiado: ${fmtARS(montoFinal)}`);
    lineas.push(`Neto cliente: ${fmtARS(netoCliente)}`);
  } else {
    lineas.push(`Monto usado para calcular cuotas: ${fmtARS(montoFinanciado)}`);
    lineas.push(`Neto a recibir: ${fmtARS(montoFinal)}`);
  }

  lineas.push(`Neto Infinito: ${fmtARS(netoInfinito)}`);
  lineas.push(`TNA: ${fmtNum(tnaPct, 2)}%`);
  lineas.push(`Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`);
  lineas.push(`Capital inicial (UVA): ${fmtNum(capitalInicialUva, 4)}`);
  lineas.push(`Cuota pura fija (UVA): ${fmtNum(cuotaPuraUvaFija, 4)}`);
  lineas.push(`1ra cuota total (ARS): ${fmtARS(totalCuotaArs1)}`);

  return lineas.join("\n");
}

// ===== Sincronización UI =====
function syncPorcentajeSegunSeleccion() {
  const plazo = Number($("plazo")?.value || 0);
  const modo = $("modoGastos")?.value || "sumar";
  const pct = getDefaultPctByMode(modo, plazo);
  setValue("porcentajeGastos", pct ? fmtNum(pct, 2).replace(",", ".") : "");
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

    if (montoBase <= 0 || plazo <= 0) {
      throw new Error("Completá monto y plazo con valores válidos.");
    }

    const gastos = calcularMontosUVA(montoBase, plazo, modoGastos);

    setValue(
      "porcentajeGastos",
      fmtNum(gastos.porcentajeEntidad, 2).replace(",", ".")
    );

    const uva = await fetchUVA();

    setText("uvaActual", `$${fmtNum(uva.valor, 2)}`);
    setText("uvaFecha", `Fecha: ${uva.fecha}`);

    renderMontoResumen(gastos);

    const { capitalInicialUva, cuotaPuraUvaFija, rows } = buildSchedule({
      montoArs: gastos.montoFinanciado,
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
      plazo: gastos.plazo,
      modo: gastos.modo,
      porcentajeEntidad: gastos.porcentajeEntidad,
      porcentajeInfinito: gastos.porcentajeInfinito,
      gastoEntidadArs: gastos.gastoEntidadArs,
      gastoInfinitoArs: gastos.gastoInfinitoArs,
      montoIntermedio: gastos.montoIntermedio,
      montoFinal: gastos.montoFinal,
      netoCliente: gastos.netoCliente,
      netoInfinito: gastos.netoInfinito,
      montoFinanciado: gastos.montoFinanciado,
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

$("modoGastos")?.addEventListener("change", syncPorcentajeSegunSeleccion);
$("plazo")?.addEventListener("change", syncPorcentajeSegunSeleccion);

// ===== Init =====
syncPorcentajeSegunSeleccion();
setStatus("Ingresá los datos y presioná Calcular.");
