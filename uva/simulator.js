// simulador.jss

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
  if (!incluyeGastosEntidad(mode)) return 0;

  const operacion = getOperacionGastos(mode);
  return getPctEntidad(plazo, operacion);
}
function incluyeGastosEntidad(modo) {
  return modo === "sumar" || modo === "restar";
}

function getOperacionGastos(modo) {
  if (modo.includes("restar")) return "restar";
  return "sumar";
}
// ===== Lógica de montos =====
function calcularMontosUVA(montoBase, plazo, modo) {
  const incluyeEntidad = incluyeGastosEntidad(modo);
  const operacion = getOperacionGastos(modo);

  const pctEntidad = incluyeEntidad ? getPctEntidad(plazo, operacion) : 0;

  if (incluyeEntidad && !pctEntidad) {
    throw new Error("No hay configuración de gastos para ese plazo.");
  }

  if (operacion === "restar") {
    const pctEntidadDec = pctEntidad / 100;
    const pctInfinitoDec = GASTO_INFINITO_RESTAR / 100;

    const gastoEntidadArs = incluyeEntidad ? montoBase * pctEntidadDec : 0;
    const gastoInfinitoArs = montoBase * pctInfinitoDec;

    const netoCliente = montoBase - gastoEntidadArs - gastoInfinitoArs;

    if (netoCliente <= 0) {
      throw new Error("El neto final debe ser mayor a cero.");
    }

    return {
      montoBase,
      plazo,
      modo,
      operacion,
      incluyeEntidad,
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

  if (operacion === "sumar") {
    const pctInfinitoDec = GASTO_INFINITO_SUMAR / 100;
    const pctEntidadDec = pctEntidad / 100;

    const montoConInfinito = montoBase * (1 + pctInfinitoDec);
    const gastoInfinitoArs = montoConInfinito - montoBase;

    const gastoEntidadArs = incluyeEntidad ? montoConInfinito * pctEntidadDec : 0;
    const montoFinanciado = montoConInfinito + gastoEntidadArs;

    return {
      montoBase,
      plazo,
      modo,
      operacion,
      incluyeEntidad,
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
async function fetchJsonSafe(url) {
  const resp = await fetch(url, { cache: "no-store" });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const text = await resp.text();

  if (!text || !text.trim()) {
    throw new Error("Respuesta vacía");
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Respuesta inválida:", text);
    throw new Error("JSON inválido");
  }
}

// retry automático
async function fetchJsonSafe(url) {
  const resp = await fetch(url, { cache: "no-store" });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const text = await resp.text();

  if (!text || !text.trim()) {
    throw new Error("Respuesta vacía");
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Respuesta inválida:", text);
    throw new Error("JSON inválido");
  }
}

async function fetchWithRetry(url, retries = 2, delay = 500) {
  try {
    return await fetchJsonSafe(url);
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, retries - 1, delay);
    }
    throw err;
  }
}

function pedirUvaManual() {
  const valorIngresado = prompt(
    "No se pudo obtener la UVA desde BCRA.\n\nIngresá manualmente el valor UVA:"
  );

  if (valorIngresado === null) {
    throw new Error("No se pudo obtener la UVA y no se ingresó un valor manual.");
  }

  const normalizado = valorIngresado.replace(",", ".").trim();
  const valor = Number(normalizado);

  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error("El valor manual de UVA no es válido.");
  }

  const hoy = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const resultado = {
    valor,
    fecha: `${hoy} (manual)`,
    manual: true,
  };

  localStorage.setItem("uva_cache", JSON.stringify(resultado));

  return resultado;
}

async function fetchUVA() {
  try {
    const listUrl =
      "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias?Limit=10000&Offset=0";

    const list = await fetchWithRetry(listUrl);
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

    const detUrl = `https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/${uvaVar.idVariable}`;
    const det = await fetchWithRetry(detUrl);

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

    const resultado = {
      valor: Number(datoVigente.valor),
      fecha: datoVigente.fecha,
      manual: false,
    };

    localStorage.setItem("uva_cache", JSON.stringify(resultado));

    return resultado;
  } catch (error) {
    console.warn("Fallo API BCRA, intento usar cache o ingreso manual...", error);

    const cache = localStorage.getItem("uva_cache");

    if (cache) {
      const parsed = JSON.parse(cache);
      setStatus("⚠️ BCRA no respondió. Usando última UVA guardada.");
      return parsed;
    }

    setStatus("⚠️ BCRA no respondió. Ingresá la UVA manualmente.");
    return pedirUvaManual();
  }
}
// ===== Cálculo de cuotas =====
function buildSchedule({ montoArs, plazo, tnaPct, inflacionPct, uvaHoy }) {
  const i = monthlyRateFromTNA(tnaPct);
  const infl = Number(inflacionPct) / 100;

  const capitalInicialUva = montoArs / uvaHoy;
  const cuotaPuraUvaFija = frenchPayment(capitalInicialUva, i, plazo);

  let saldo = capitalInicialUva;
  const rows = [];

  for (let cuota = 1; cuota <= plazo; cuota++) {
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
// ===== comparacion =====
function buildComparacionFrances({
  rowsUva,
  montoFinanciado,
  plazo,
  tnaPct
}) {
  const i = monthlyRateFromTNA(tnaPct);
  const cuotaPuraFrances = frenchPayment(montoFinanciado, i, plazo);

  let saldo = montoFinanciado;
  let mesCruce = null;

  const filas = rowsUva.map((r) => {
    const interes = saldo * i;
    const capital = cuotaPuraFrances - interes;
    const iva = interes * 0.21;
    const cuotaTotalFrances = cuotaPuraFrances + iva;

    const diferencia = r.totalCuotaArs - cuotaTotalFrances;

    if (mesCruce === null && r.totalCuotaArs >= cuotaTotalFrances) {
      mesCruce = r.cuota;
    }

    saldo = Math.max(0, saldo - capital);

    return {
      mes: r.cuota,
      cuotaUva: r.totalCuotaArs,
      cuotaFrances: cuotaTotalFrances,
      cuotaPuraFrances,
      interesFrances: interes,
      capitalFrances: capital,
      ivaFrances: iva,
      diferencia,
    };
  });

  return {
    cuotaFrances: filas[0]?.cuotaFrances || 0,
    cuotaPuraFrances,
    filas,
    mesCruce,
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

  if (data.operacion === "sumar") {
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
  plazo,
  gastoEntidadArs,
  gastoInfinitoArs,
  montoFinanciado,
  netoCliente,
  tnaPct,
  inflacionPct,
  uva,
  capitalInicialUva,
  cuotaPuraUvaFija,
  totalCuotaArs1,
}) {
  const lineas = [
    "Simulador UVA",
    `UVA (${uva.fecha}): $${fmtNum(uva.valor, 2)}`,
    `Plazo: ${plazo} meses`,
    `Gastos Infinito: ${fmtARS(gastoInfinitoArs)}`,
    `Gastos entidad: ${fmtARS(gastoEntidadArs)}`,
    `Monto total financiado: ${fmtARS(montoFinanciado)}`,
    `Neto cliente: ${fmtARS(netoCliente)}`,
    `TNA: ${fmtNum(tnaPct, 2)}%`,
    `Inflación supuesta: ${fmtNum(inflacionPct, 2)}% mensual`,
    `Capital inicial (UVA): ${fmtNum(capitalInicialUva, 4)}`,
    `Cuota pura fija (UVA): ${fmtNum(cuotaPuraUvaFija, 4)}`,
    `1ra cuota total (ARS): ${fmtARS(totalCuotaArs1)}`,
  ];

  return lineas.join("\n");
}

function renderComparacionFrances(data) {
  const cont = $("resultadoComparacionFrances");
  if (!cont) return;

  const { filas, mesCruce, cuotaFrances } = data;

  const mensaje = mesCruce
    ? `La cuota UVA supera a la tradicional en el mes ${mesCruce}`
    : `La cuota UVA no supera a la tradicional en el plazo`;

  const filasHtml = filas
    .map(
      (f) => `
      <tr>
        <td>${f.mes}</td>
        <td>${fmtARS(f.cuotaUva)}</td>
        <td>${fmtARS(f.cuotaFrances)}</td>
        <td>${fmtARS(f.diferencia)}</td>
      </tr>
    `
    )
    .join("");

  cont.innerHTML = `
    <h3>Comparación UVA vs Tradicional</h3>
    <p><strong>${mensaje}</strong></p>
    <p>Cuota pura tradicional: ${fmtARS(data.cuotaPuraFrances)}</p>
    <p>1ra cuota tradicional: ${fmtARS(cuotaFrances)}</p>

    <table>
      <thead>
        <tr>
          <th>Mes</th>
          <th>UVA</th>
          <th>Tradicional</th>
          <th>Diferencia</th>
        </tr>
      </thead>
      <tbody>
        ${filasHtml}
      </tbody>
    </table>
  `;
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
const comparar = $("compararFrances")?.checked;
const tnaTradicional = Number($("tnaTradicional")?.value || 0);

if (comparar && tnaTradicional > 0) {
  const comparacion = buildComparacionFrances({
    rowsUva: rows,
    montoFinanciado: gastos.montoFinanciado,
    plazo,
    tnaPct: tnaTradicional,
  });

  renderComparacionFrances(comparacion);
} else {
  const cont = $("resultadoComparacionFrances");
  if (cont) cont.innerHTML = "";
}
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
$("compararFrances")?.addEventListener("change", () => {
  const activo = $("compararFrances").checked;
  $("bloqueComparacionFrances").style.display = activo ? "block" : "none";

  if (activo) {
    calcular();
  }
});

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

// 👇 estado inicial del bloque comparación
const activoInicial = $("compararFrances")?.checked;
if ($("bloqueComparacionFrances")) {
  $("bloqueComparacionFrances").style.display = activoInicial ? "block" : "none";
}

setStatus("Ingresá los datos y presioná Calcular.");
