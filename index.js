const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');

const GROQ_KEY = process.env.GROQ_KEY || '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';
const LIDER_NUM = process.env.LIDER_NUM || '573052297432@s.whatsapp.net';
const PORT = process.env.PORT || 3000;

let sock;
let ultimoQR = null;
const sessions = {};

// ═══ DETECCION DE SERVICIO ═══
function norm(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function detectService(msg) {
  const m = norm(msg);
  if (m.includes('balayage')||m.includes('ligth')||m.includes('bronde')||m.includes('brunette')||m.includes('rubio')||m.includes('luces')||m.includes('mechas')) return 'balayage';
  if (m.includes('novia')||m.includes('boda')||m.includes('maquillaje')) return 'novia';
  if (m.includes('terapia')||m.includes('keratina')||m.includes('hidrat')||m.includes('glicoprot')||m.includes('hair spa')||m.includes('ampolleta')) return 'terapias';
  if (m.includes('corte')||m.includes('blower')||m.includes('secado')||m.includes('cepillado')) return 'corte';
  if (m.includes('asesoria')||m.includes('asesor')||m.includes('que color')) return 'asesoria_color';
  if (m.includes('tonaliz')||m.includes('matiz')) return 'tonalizado';
  if (m.includes('extraccion')||m.includes('quitar color')||m.includes('sacar color')) return 'extraccion';
  if (m.includes('crecimiento')||m.includes('raiz')||m.includes('raices')||m.includes('retoqu')) return 'crecimiento';
  if (m.includes('onda')||m.includes('rizo')||m.includes('permanente')) return 'ondas';
  if (m.includes('pre aclar')||m.includes('preaclar')||m.includes('super aclar')) return 'pre_aclaracion';
  if (m.includes('tinte')||m.includes('color')) return 'asesoria_color';
  return null;
}

// ═══ MENSAJES POR SERVICIO ═══
const BIENVENIDA = {
  corte: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestro servicio de *Corte & Blower* ✂️\nQueremos darte la mejor asesoría personalizada 😊',
  balayage: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestro servicio de *Diseño de Color / Balayage* 🎨\nQueremos darte la mejor asesoría personalizada 😊',
  novia: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestro servicio de *Novia* 💍\nQueremos que ese día estés absolutamente radiante 💛',
  terapias: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestras *Terapias Capilares* 💆‍♀️\nQueremos darte la mejor asesoría personalizada 😊',
  asesoria_color: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestra *Asesoría de Color* 🎨\nQueremos ayudarte a encontrar el color perfecto para ti 😊',
  tonalizado: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestro servicio de *Tonalizado* ✨\nQueremos darte la mejor asesoría personalizada 😊',
  extraccion: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en *Extracción de Color* 🎭\nQueremos darte la mejor asesoría personalizada 😊',
  crecimiento: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en *Crecimiento Preaclarado* 🌱\nQueremos darte la mejor asesoría personalizada 😊',
  ondas: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en nuestro servicio de *Ondas* 🌊\nQueremos darte la mejor asesoría personalizada 😊',
  pre_aclaracion: '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\nVimos que estás interesada en *Pre Aclaración / Super Aclaración* ⚡\nQueremos darte la mejor asesoría personalizada 😊',
};

const PREGUNTA_QUIMICOS = 'Cariño, ¿tienes algún proceso químico anterior en tu cabello? Por ejemplo alisado, decoloración, tinte u otro tratamiento.\n\nSi es así, ¿nos podrías indicar cuál o cuáles y hace cuánto tiempo? 😊';
const PREGUNTA_FOTO = 'Muchas gracias por contarnos, hermosa ✨ Esa información nos ayuda muchísimo.\n\nAhora necesitamos una *foto de espalda de tu cabello* con buena iluminación 📸\n\nTe enviamos una imagen de referencia para guiarte 💛';
const PREGUNTA_FOTO_NOVIA = 'Preciosa, para asesorarte mejor necesitamos una *foto de tu rostro* con buena iluminación 📸\n\nAsí nuestro equipo puede recomendarte el mejor estilo para ese día tan especial 💛';
const PREGUNTA_NOMBRE = '¡Hermosa foto! ✨ Ya la recibimos, cariño.\n\n¿Cuál es tu nombre? 😊';

const MENU_GENERAL = '¡Hola, hermosa! ✨ Bienvenida a *Glam Color Studio*.\n\n¿En cuál de nuestros servicios podemos ayudarte hoy?\n\n✂️ Corte & Blower\n✨ Balayage / Diseño de Color\n💆 Terapias Capilares\n💍 Novia\n🎨 Asesoría de Color\n🌈 Tonalizado\n🌱 Crecimiento Preaclarado\n🌊 Ondas\n⚡ Super Aclaración\n🎭 Extracción de Color\n\nEscríbenos el servicio que te interesa 💛';

async function detectWithGroq(msg) {
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 15,
      messages: [{ role: 'user', content: `Clasifica este mensaje en UNA categoria: corte, balayage, novia, terapias, asesoria_color, tonalizado, extraccion, crecimiento, ondas, pre_aclaracion, otro. Mensaje: "${msg}". Responde SOLO la categoria.` }]
    }, { headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' } });
    const r = res.data.choices[0].message.content.trim().toLowerCase();
    return r === 'otro' ? null : r;
  } catch(e) { return null; }
}

// ═══ PROCESADOR DE MENSAJES ═══
async function procesarMensaje(jid, texto, hasImage) {
  if (!sessions[jid]) sessions[jid] = { paso: 'inicio' };
  const s = sessions[jid];

  // FAQ rapido
  const m = norm(texto);
  if (m.includes('precio')||m.includes('cuanto cuesta')||m.includes('valor')||m.includes('cuanto vale')) {
    await sock.sendMessage(jid, { text: 'Nuestros precios varían según el servicio y el largo del cabello 💛\n\nAlgunos ejemplos:\n✂️ Corte & Blower: desde $70.000\n✨ Tonalizado: $60.000\n💆 Terapias: desde $5.000\n\n¿Te gustaría que una asesora te cotice personalmente? 😊' });
    return;
  }
  if (m.includes('horario')||m.includes('hora')||m.includes('atienden')) {
    await sock.sendMessage(jid, { text: 'Atendemos 💛\n\nLunes a Viernes: 10:00am – 8:00pm\nSábados: 10:00am – 7:00pm\n\nNo tenemos servicio domingos ni festivos 😊' });
    return;
  }
  if (m.includes('direcci')||m.includes('ubicaci')||m.includes('donde')) {
    await sock.sendMessage(jid, { text: 'Estamos en 📍\n\n*Calle 5 # 56-26 Local 14*\nCañaveralejo Mall, Cali\n\n¡Te esperamos, hermosa! 💛' });
    return;
  }

  // FLUJO PRINCIPAL
  if (s.paso === 'inicio') {
    let servicio = detectService(texto);
    if (!servicio && texto.length > 2) servicio = await detectWithGroq(texto);
    if (!servicio) {
      await sock.sendMessage(jid, { text: MENU_GENERAL });
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
    return;
  }

  if (s.paso === 'foto') {
    if (hasImage) {
      s.foto = true;
      s.paso = 'nombre';
      await sock.sendMessage(jid, { text: PREGUNTA_NOMBRE });
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
        text: `🔔 *Nueva clienta interesada en Glam!*\n\n*Nombre:* ${nombre}\n*Servicio:* ${s.servicio}\n*Procesos químicos:* ${s.quimicos || 'Ninguno'}\n*Número:* ${jid.replace('@s.whatsapp.net','')}`
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
  sock = makeWASocket({ auth: state, printQRInTerminal: true, logger: pino({ level: 'silent' }) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { ultimoQR = qr; console.log('📱 QR listo — visita /qr'); }
    if (connection === 'close') {
      const r = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (r) { console.log('🔄 Reconectando...'); setTimeout(conectar, 3000); }
    } else if (connection === 'open') { ultimoQR = null; console.log('✅ Bot Glam Color Studio conectado'); }
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
      try { await procesarMensaje(jid, texto, hasImage); }
      catch(e) { console.log('Error:', e.message); }
    }
  });
}

conectar();

// ═══ EXPRESS ═══
const app = express();
app.get('/', (req, res) => res.json({ status: '✅ Glam Color Studio Bot activo', qr: '/qr' }));
app.get('/qr', async (req, res) => {
  if (!ultimoQR) return res.send(`<body style="background:#1A1410;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><h2 style="color:#C9A96E">✅ Glam Bot conectado y activo</h2></body>`);
  try {
    const img = await qrcode.toDataURL(ultimoQR);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>QR Glam Bot</title></head>
<body style="background:#1A1410;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;text-align:center;">
<h2 style="color:#C9A96E;margin-bottom:1rem;">Glam Color Studio — Escanea con WhatsApp</h2>
<img src="${img}" style="width:300px;border-radius:12px;border:6px solid #C9A96E"/>
<p style="color:#888;margin-top:1rem;font-size:13px;">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
<p style="color:#555;font-size:11px;margin-top:.5rem;">Se actualiza cada 30 segundos</p>
</body></html>`);
  } catch(e) { res.send('Error: ' + e.message); }
});
app.listen(PORT, () => console.log(`🚀 Glam Bot en puerto ${PORT}`));
