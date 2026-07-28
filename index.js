// Fix: Baileys necesita "crypto" como variable global — en algunas versiones
// de Node no está disponible por defecto y causa "crypto is not defined"
global.crypto = require('crypto').webcrypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const { sendImage } = require('./whatsapp');

const GROQ_KEY = process.env.GROQ_KEY || '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';
const GOOGLE_VISION_KEY = process.env.GOOGLE_VISION_KEY || '';
const LIDER_NUM = process.env.LIDER_NUM || '573052297432@s.whatsapp.net';
const REF_FOTO_URL = process.env.REF_FOTO_URL || 'https://i.imgur.com/dCDqboi.jpeg';
const ALERTA_TOKEN = process.env.ALERTA_TOKEN || 'CAMBIA_ESTE_TOKEN';
const PORT = process.env.PORT || 3000;

// Convierte un numero de celular colombiano a JID de WhatsApp
function numeroToJid(numero) {
  let digits = String(numero).replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) digits = '57' + digits;
  return digits + '@s.whatsapp.net';
}

let sock;
let ultimoQR = null;
let connectionStatus = 'disconnected';
const sessions = {};

function norm(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

// ═══ DETECCION POR PAUTA (texto pre-cargado desde Meta) ═══
const PAUTAS = {
  'balayage': 'balayage',
  'corte_blower': 'corte',
  'corte': 'corte',
  'blower': 'corte',
  'novia': 'novia',
  'terapias': 'terapias',
  'terapia': 'terapias',
  'asesoria_color': 'asesoria_color',
  'asesoria': 'asesoria_color',
  'tonalizado': 'tonalizado',
  'extraccion': 'extraccion',
  'extraccion_color': 'extraccion',
  'crecimiento': 'crecimiento',
  'crecimiento_preaclarado': 'crecimiento',
  'ondas': 'ondas',
  'pre_aclaracion': 'pre_aclaracion',
  'super_aclaracion': 'pre_aclaracion',
};

// ═══ DETECCION POR TEXTO LIBRE ═══
function detectService(msg) {
  const m = norm(msg);
  if (m.includes('balayage')||m.includes('ligth')||m.includes('bronde')||m.includes('brunette')||m.includes('rubio')||m.includes('luces')||m.includes('mechas')) return 'balayage';
  if (m.includes('novia')||m.includes('boda')||m.includes('maquillaje')) return 'novia';
  if (m.includes('terapia')||m.includes('keratina')||m.includes('hidrat')||m.includes('glicoprot')||m.includes('hair spa')||m.includes('ampolleta')) return 'terapias';
  if (m.includes('corte')||m.includes('blower')||m.includes('secado')||m.includes('cepillado')) return 'corte';
  if (m.includes('asesoria')||m.includes('asesor')||m.includes('que color me queda')) return 'asesoria_color';
  if (m.includes('tonaliz')||m.includes('matiz')) return 'tonalizado';
  if (m.includes('extraccion')||m.includes('quitar color')||m.includes('sacar color')) return 'extraccion';
  if (m.includes('crecimiento')||m.includes('raiz')||m.includes('raices')||m.includes('retoque')) return 'crecimiento';
  if (m.includes('onda')||m.includes('rizo')||m.includes('permanente')) return 'ondas';
  if (m.includes('pre aclar')||m.includes('preaclar')||m.includes('super aclar')||m.includes('aclaracion')) return 'pre_aclaracion';
  if (m.includes('tinte')||m.includes('color')) return 'asesoria_color';
  return null;
}

async function detectWithGroq(msg) {
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 15,
      messages: [{ role: 'user', content: `Eres un clasificador de servicios de salon de belleza. Clasifica este mensaje en UNA categoria: corte, balayage, novia, terapias, asesoria_color, tonalizado, extraccion, crecimiento, ondas, pre_aclaracion, otro. Mensaje: "${msg}". Responde SOLO la categoria, sin explicacion.` }]
    }, { headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' } });
    const r = res.data.choices[0].message.content.trim().toLowerCase();
    return r === 'otro' ? null : r;
  } catch(e) { return null; }
}

// ═══ VALIDACIÓN DE FOTO (Google Vision) ═══
// Detecta si la imagen muestra cabello (evita que la clienta mande cualquier foto:
// paisajes, memes, capturas de pantalla, selfies de frente sin cabello visible, etc.)
async function analizarFotoCabello(imageBuffer) {
  if (!GOOGLE_VISION_KEY) {
    console.log('⚠️ GOOGLE_VISION_KEY no configurada — aceptando foto sin validar');
    return true;
  }
  try {
    const base64 = imageBuffer.toString('base64');
    const res = await axios.post(
      'https://vision.googleapis.com/v1/images:annotate?key=' + GOOGLE_VISION_KEY,
      {
        requests: [{
          image: { content: base64 },
          features: [
            { type: 'LABEL_DETECTION', maxResults: 15 },
            { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
          ]
        }]
      }
    );
    const labels = res.data.responses[0].labelAnnotations || [];
    const objects = res.data.responses[0].localizedObjectAnnotations || [];
    const allLabels = [
      ...labels.map(l => l.description.toLowerCase()),
      ...objects.map(o => o.name.toLowerCase())
    ];
    console.log('Google Vision labels:', allLabels.join(', '));

    const hairWords = ['hair', 'hairstyle', 'long hair', 'black hair', 'brown hair', 'hair coloring', 'hair care', 'blond', 'blonde', 'hair extensions', 'wig', 'step cutting'];
    const faceWords = ['selfie', 'face', 'chin', 'cheek', 'forehead', 'eyebrow', 'eyelash', 'lips', 'facial expression', 'jaw', 'nose', 'mouth', 'portrait', 'smile'];

    const hasHair = hairWords.some(w => allLabels.some(l => l.includes(w)));
    const hasFace = faceWords.some(w => allLabels.some(l => l.includes(w)));

    // Solo es válida si muestra cabello Y NO muestra rasgos de rostro/selfie
    // (evita que una selfie de frente pase solo porque también detecta "hairstyle")
    return hasHair && !hasFace;
  } catch(e) {
    console.log('Error Google Vision:', e.message);
    return true; // si falla el servicio, no bloqueamos a la clienta
  }
}

// ═══ MENSAJES ═══
const BIENVENIDA = {
  corte: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu servicio de *Corte & Blower* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  balayage: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu *Diseño de Color* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  novia: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nQueremos que ese día estés absolutamente radiante 💍\n\nSerá un placer acompañarte en este día tan especial 💛',
  terapias: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tus *Terapias Capilares* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  asesoria_color: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer ayudarte a encontrar el color perfecto para ti 💛\n\nQueremos darte la mejor asesoría de color 😊',
  tonalizado: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu *Tonalizado* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  extraccion: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu *Extracción de Color* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  crecimiento: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu *Crecimiento Preaclarado* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  ondas: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu servicio de *Ondas* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
  pre_aclaracion: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nSerá para nosotros un placer acompañarte en tu *Pre Aclaración* 💛\n\nQueremos darte la mejor asesoría personalizada 😊',
};

const PREGUNTA_QUIMICOS = 'Cariño, ¿tienes algún proceso químico anterior en tu cabello? Por ejemplo alisado, decoloración, tinte u otro tratamiento.\n\nSi es así, ¿nos podrías indicar cuál o cuáles y hace cuánto tiempo? 😊';
const PREGUNTA_FOTO = 'Muchas gracias por contarnos, hermosa ✨\n\nAhora necesitamos una *foto de espalda de tu cabello* con buena iluminación 📸\n\nTe enviamos una imagen de referencia para guiarte 💛';
const PREGUNTA_FOTO_NOVIA = 'Preciosa, para asesorarte mejor necesitamos una *foto de tu rostro* con buena iluminación 📸\n\nAsí nuestro equipo puede recomendarte el mejor estilo para ese día tan especial 💛';
const PREGUNTA_NOMBRE = '¡Hermosa foto! ✨ Ya la recibimos, cariño.\n\n¿Cuál es tu nombre? 😊';

// ═══ PROCESADOR ═══
// NOTA: se agrega el parámetro `msg` (el mensaje original de Baileys) porque
// analizarFotoCabello necesita el objeto completo para downloadMediaMessage.
async function procesarMensaje(jid, texto, hasImage, msg) {
  if (!sessions[jid]) sessions[jid] = { paso: 'inicio' };
  const s = sessions[jid];

  // FAQ rapido - responde siempre sin romper el flujo
  const m = norm(texto);
  if (s.paso !== 'nombre' && (m.includes('precio')||m.includes('cuanto cuesta')||m.includes('valor')||m.includes('cuanto vale'))) {
    await sock.sendMessage(jid, { text: 'Nuestros precios varían según el servicio y el largo del cabello 💛\n\nUna de nuestras asesoras te cotizará personalmente con mucho gusto 😊\n\n¿Seguimos con tu asesoría?' });
    return;
  }
  if (s.paso !== 'nombre' && (m.includes('horario')||m.includes('que hora')||m.includes('atienden'))) {
    await sock.sendMessage(jid, { text: 'Atendemos con mucho cariño 💛\n\nLunes a Viernes: 10:00am – 8:00pm\nSábados: 10:00am – 7:00pm' });
    return;
  }
  if (s.paso !== 'nombre' && (m.includes('direcci')||m.includes('ubicaci')||m.includes('donde estan')||m.includes('donde quedan'))) {
    await sock.sendMessage(jid, { text: 'Nos encuentras en 📍\n\n*Calle 5 # 56-26 Local 14*\nCañaveralejo Mall, Cali\n\n¡Te esperamos, hermosa! 💛' });
    return;
  }

  if (s.paso === 'inicio') {
    // Primero chequear si viene de pauta (texto exacto)
    const textoNorm = norm(texto).trim().replace(/\s+/g,'_');
    let servicio = PAUTAS[textoNorm] || PAUTAS[norm(texto).trim()] || null;

    // Si no es pauta, detectar por palabras clave
    if (!servicio) servicio = detectService(texto);

    // Si tampoco, usar Groq
    if (!servicio && texto.length > 2) servicio = await detectWithGroq(texto);

    if (!servicio) {
      await sock.sendMessage(jid, { text: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\n\nSerá un placer atenderte 💛\n\n¿En qué servicio podemos ayudarte hoy? Cuéntanos 😊' });
      return;
    }

    s.servicio = servicio;
    s.paso = servicio === 'novia' ? 'foto' : 'quimicos';
    await sock.sendMessage(jid, { text: BIENVENIDA[servicio] || BIENVENIDA.corte });
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendMessage(jid, { text: servicio === 'novia' ? PREGUNTA_FOTO_NOVIA : PREGUNTA_QUIMICOS });
    return;
  }

  if (s.paso === 'quimicos') {
    s.quimicos = texto;
    s.paso = 'foto';
    await sock.sendMessage(jid, { text: 'Muchas gracias por contarnos, hermosa ✨' });
    await new Promise(r => setTimeout(r, 1000));
    await sock.sendMessage(jid, { text: PREGUNTA_FOTO });
    await sendImage(sock, connectionStatus, jid, REF_FOTO_URL, 'Así necesitamos la foto: de espalda, buena iluminación ✨');
    return;
  }

  if (s.paso === 'foto') {
    if (hasImage) {
      await sock.sendMessage(jid, { text: 'Un momento, hermosa... revisando tu foto ✨' });
      try {
        const stream = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        const esValida = await analizarFotoCabello(stream);
        if (esValida) {
          s.foto = true;
          s.paso = 'nombre';
          await sock.sendMessage(jid, { text: PREGUNTA_NOMBRE });
        } else {
          if (!s.foto_intentos) s.foto_intentos = 0;
          s.foto_intentos++;
          await sock.sendMessage(jid, { text: 'Preciosa, necesitamos una foto de *espalda* donde se vea claramente el *largo y color* de tu cabello con buena iluminación 📸\n\nSigue la imagen de referencia que te compartimos 💛' });
          await sendImage(sock, connectionStatus, jid, REF_FOTO_URL, 'Así debe verse la foto ✨');
          // Después de 3 intentos fallidos, dejamos pasar para no frustrar a la clienta
          if (s.foto_intentos >= 3) {
            s.foto = true;
            s.paso = 'nombre';
            await sock.sendMessage(jid, { text: 'No te preocupes, hermosa, seguimos con tu asesoría 💛' });
            await sock.sendMessage(jid, { text: PREGUNTA_NOMBRE });
          }
        }
      } catch(e) {
        console.log('Error analizando foto:', e.message);
        s.foto = true;
        s.paso = 'nombre';
        await sock.sendMessage(jid, { text: PREGUNTA_NOMBRE });
      }
    } else {
      await sock.sendMessage(jid, { text: 'Preciosa, necesitamos la foto de tu cabello para continuar. Por favor envíala cuando puedas 📸' });
    }
    return;
  }

  if (s.paso === 'nombre') {
    let nombre = texto.trim().split(' ')[0];
    nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
    s.nombre = nombre;
    s.paso = 'fin';
    await sock.sendMessage(jid, { text: `¡*${nombre}*, muchas gracias por confiar en nosotros! 💛\n\nYa tenemos toda tu información.` });
    await new Promise(r => setTimeout(r, 1000));
    await sock.sendMessage(jid, { text: 'En breve una de nuestras asesoras te contactará personalmente para acompañarte y agendar tu cita ✨' });
    try {
      await sock.sendMessage(LIDER_NUM, {
        text: `NUEVA CLIENTA INTERESADA EN GLAM\n\n*Nombre:* ${nombre}\n*Servicio:* ${s.servicio}\n*Procesos químicos:* ${s.quimicos || 'Ninguno'}\n*Número:* ${jid.replace('@s.whatsapp.net','')}`
      });
    } catch(e) { console.log('Error notificando lider:', e.message); }
    return;
  }

  if (s.paso === 'fin') {
    await sock.sendMessage(jid, { text: 'Gracias por escribirnos, preciosa ✨ Una asesora te contactará muy pronto 💛' });
  }
}

// ═══ BAILEYS ═══
async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();
  console.log('📶 Usando version de WhatsApp Web:', version.join('.'));
  sock = makeWASocket({ auth: state, version, printQRInTerminal: true, logger: pino({ level: 'silent' }) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { ultimoQR = qr; console.log('📱 QR listo — visita /qr'); }
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const razon = (lastDisconnect?.error)?.message || 'desconocida';
      console.log(`❌ Conexión cerrada — código: ${statusCode} — razón: ${razon}`);
      const r = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'disconnected'; if (r) { console.log('🔄 Reconectando...'); setTimeout(conectar, 3000); }
    } else if (connection === 'open') { ultimoQR = null; connectionStatus = 'connected'; console.log('✅ Bot Glam conectado'); }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (jid === 'status@broadcast') continue;
      const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const hasImage = !!(msg.message?.imageMessage);
      if (!texto && !hasImage) continue;
      console.log(`📩 [${jid}]: ${texto}`);
      try { await procesarMensaje(jid, texto, hasImage, msg); }
      catch(e) { console.log('Error:', e.message); }
    }
  });
}

// Si RESET_SESSION=true, borra la sesión guardada UNA SOLA VEZ al arrancar
// (necesario cuando se desvinculó el dispositivo desde el celular)
// IMPORTANTE: esto se ejecuta solo aquí, no dentro de conectar(), para que
// los reintentos de reconexión no borren el QR recién generado antes de que
// alcances a escanearlo.
if (process.env.RESET_SESSION === 'true') {
  try {
    fs.rmSync('auth_info', { recursive: true, force: true });
    console.log('🗑️ Sesión anterior borrada — se generará un QR nuevo');
  } catch (e) {
    console.log('No había sesión previa para borrar:', e.message);
  }
}

conectar();

// ═══ EXPRESS ═══
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => res.json({ status: '✅ Glam Color Studio Bot activo', qr: '/qr' }));

// ═══ ENDPOINT PARA N8N ═══
// n8n llama aquí para disparar cada mensaje/alerta.
// Body esperado:
// { "numero": "3001234567", "mensaje": "...", "imagenBase64": "..." }  (opcional imagenBase64)
// o { "numero": "...", "mensaje": "...", "imagenUrl": "https://..." }  (opcional imagenUrl)
// Si no viene imagenBase64 ni imagenUrl, se manda solo texto.
app.post('/enviar-alerta', async (req, res) => {
  // Seguridad: solo n8n con el token correcto puede llamar este endpoint
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${ALERTA_TOKEN}`) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }

  if (connectionStatus !== 'connected') {
    return res.status(503).json({ ok: false, error: 'Bot de WhatsApp no está conectado' });
  }

  const { numero, mensaje, imagenBase64, imagenUrl } = req.body || {};
  if (!numero || !mensaje) {
    return res.status(400).json({ ok: false, error: 'Faltan campos: numero y mensaje son obligatorios' });
  }

  const jid = numeroToJid(numero);

  try {
    if (imagenBase64) {
      const buffer = Buffer.from(imagenBase64, 'base64');
      await sock.sendMessage(jid, { image: buffer, caption: mensaje });
    } else if (imagenUrl) {
      await sendImage(sock, connectionStatus, jid, imagenUrl, mensaje);
    } else {
      await sock.sendMessage(jid, { text: mensaje });
    }
    console.log(`✅ Alerta enviada a ${jid}`);
    return res.json({ ok: true });
  } catch (e) {
    console.log('❌ Error enviando alerta:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.get('/qr', async (req, res) => {
  if (connectionStatus === 'connected') {
    return res.send(`<body style="background:#1A1410;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><h2 style="color:#C9A96E">✅ Glam Bot conectado y activo</h2></body>`);
  }
  if (!ultimoQR) {
    return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5"></head><body style="background:#1A1410;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><h2 style="color:#C9A96E">⏳ Generando QR, espera unos segundos... (se actualiza solo)</h2></body></html>`);
  }
  try {
    const img = await qrcode.toDataURL(ultimoQR);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>QR Glam Bot</title></head>
<body style="background:#1A1410;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:2rem;">
<h2 style="color:#C9A96E;margin-bottom:1rem;">Glam Color Studio · Escanea con WhatsApp</h2>
<img src="${img}" style="width:300px;border-radius:12px;border:6px solid #C9A96E"/>
<p style="color:#888;margin-top:1rem;font-size:13px;">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
<p style="color:#555;font-size:11px;margin-top:.5rem;">Se actualiza cada 30 segundos</p>
</body></html>`);
  } catch(e) { res.send('Error: ' + e.message); }
});
app.listen(PORT, () => console.log(`🚀 Glam Bot en puerto ${PORT}`));
