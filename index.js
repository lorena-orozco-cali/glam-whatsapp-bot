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
async function procesarMensaje(jid, texto, hasImage) {
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
    } else if (connection === 'open') { ultimoQR = null; console.log('✅ Bot Glam conectado'); }
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
<body style="background:#1A1410;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:2rem;">
<h2 style="color:#C9A96E;margin-bottom:1rem;">Glam Color Studio · Escanea con WhatsApp</h2>
<img src="${img}" style="width:300px;border-radius:12px;border:6px solid #C9A96E"/>
<p style="color:#888;margin-top:1rem;font-size:13px;">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
<p style="color:#555;font-size:11px;margin-top:.5rem;">Se actualiza cada 30 segundos</p>
</body></html>`);
  } catch(e) { res.send('Error: ' + e.message); }
});
app.listen(PORT, () => console.log(`🚀 Glam Bot en puerto ${PORT}`));
