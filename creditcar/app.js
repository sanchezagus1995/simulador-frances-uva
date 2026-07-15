import {
  planesCreditcar,
  calcularCuotasCreditcar
} from "./simulator.js";

const montoInput = document.querySelector("#montoSolicitado");
const categoriaSelect = document.querySelector("#categoriaVehiculo");

const ltvMaximo = document.querySelector("#ltvMaximo");
const categoriaMostrada = document.querySelector("#categoriaMostrada");
const montoMostrado = document.querySelector("#montoMostrado");

const tablaCuotas = document.querySelector("#tablaCuotas");
const mensajeError = document.querySelector("#mensajeError");

const copiarResultadoButton = document.querySelector("#copiarResultado");
const mensajeCopiado = document.querySelector("#mensajeCopiado");

let ultimoResultado = null;

const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const formatoPorcentaje = new Intl.NumberFormat("es-AR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function mostrarInformacionPlan() {
  const categoria = categoriaSelect.value;
  const plan = planesCreditcar[categoria];

  if (!plan) {
    return;
  }

  ltvMaximo.textContent = formatoPorcentaje.format(plan.ltvMaximo);
  categoriaMostrada.textContent = plan.nombre;
}

function mostrarEstadoInicial() {
  ultimoResultado = null;

  montoMostrado.textContent = "$0";

  tablaCuotas.innerHTML = `
    <tr>
      <td colspan="2" class="empty-state">
        Ingresá un monto para consultar las cuotas.
      </td>
    </tr>
  `;

  copiarResultadoButton.disabled = true;
}

function mostrarError(mensaje) {
  mensajeError.textContent = mensaje;
  mensajeError.hidden = false;
}

function ocultarError() {
  mensajeError.textContent = "";
  mensajeError.hidden = true;
}

function generarFilasCuotas(cuotas) {
  return cuotas
    .map(({ plazo, cuota }) => {
      return `
        <tr>
          <td>
            <strong>${plazo}</strong> cuotas
          </td>

          <td class="amount">
            ${formatoMoneda.format(cuota)}
          </td>
        </tr>
      `;
    })
    .join("");
}

function actualizarSimulacion() {
  ocultarError();
  mensajeCopiado.textContent = "";
  mostrarInformacionPlan();

  const monto = Number(montoInput.value);
  const categoria = categoriaSelect.value;

  if (!montoInput.value || !Number.isFinite(monto) || monto <= 0) {
    mostrarEstadoInicial();
    return;
  }

  try {
    const resultado = calcularCuotasCreditcar(monto, categoria);

    ultimoResultado = resultado;

    montoMostrado.textContent = formatoMoneda.format(
      resultado.montoSolicitado
    );

    tablaCuotas.innerHTML = generarFilasCuotas(resultado.cuotas);

    copiarResultadoButton.disabled = false;
  } catch (error) {
    mostrarEstadoInicial();
    mostrarError(error.message);
  }
}

function generarTextoParaCopiar(resultado) {
  const encabezado = [
    "COTIZACIÓN CREDITCAR",
    `Modelo del vehículo: ${resultado.nombreCategoria}`,
    `LTV máximo: ${formatoPorcentaje.format(resultado.ltvMaximo)}`,
    "",
    "Cuotas disponibles:"
  ];

  const detalleCuotas = resultado.cuotas.map(({ plazo, cuota }) => {
    return `${plazo} cuotas: ${formatoMoneda.format(cuota)}`;
  });

  return [...encabezado, ...detalleCuotas].join("\n");
}

async function copiarResultado() {
  if (!ultimoResultado) {
    return;
  }

  const texto = generarTextoParaCopiar(ultimoResultado);

  try {
    await navigator.clipboard.writeText(texto);

    mensajeCopiado.textContent = "Resultado copiado.";
  } catch {
    copiarTextoAlternativo(texto);
  }
}

function copiarTextoAlternativo(texto) {
  const textarea = document.createElement("textarea");

  textarea.value = texto;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copiado = document.execCommand("copy");

  document.body.removeChild(textarea);

  mensajeCopiado.textContent = copiado
    ? "Resultado copiado."
    : "No se pudo copiar el resultado.";
}

montoInput.addEventListener("input", actualizarSimulacion);
categoriaSelect.addEventListener("change", actualizarSimulacion);
copiarResultadoButton.addEventListener("click", copiarResultado);

mostrarInformacionPlan();
mostrarEstadoInicial();
