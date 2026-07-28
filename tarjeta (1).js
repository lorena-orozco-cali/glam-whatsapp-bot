const sharp = require('sharp');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'Tarjeta de cumpleaños Glam (1).png');

/**
 * Genera la tarjeta de cumpleaños con el nombre de la clienta superpuesto.
 * Devuelve un Buffer PNG listo para enviar por WhatsApp.
 */
async function generarTarjetaCumple(nombre) {
  const meta = await sharp(TEMPLATE_PATH).metadata();
  const W = meta.width, H = meta.height;

  const nombreEscapado = String(nombre)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Tamaño de fuente dinámico: nombres largos se achican para no desbordar la tarjeta
  let fontSize = 64;
  if (nombre.length > 14) fontSize = 52;
  if (nombre.length > 20) fontSize = 42;
  if (nombre.length > 28) fontSize = 34;

  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .nombre {
        font-family: Georgia, 'Times New Roman', serif;
        font-style: italic;
        font-size: ${fontSize}px;
        fill: #C9A96E;
        text-anchor: middle;
      }
    </style>
    <text x="${W / 2}" y="880" class="nombre">${nombreEscapado}</text>
  </svg>`;

  return sharp(TEMPLATE_PATH)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

module.exports = { generarTarjetaCumple };
