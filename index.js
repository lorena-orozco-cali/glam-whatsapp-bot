const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const http = require('http');
const QRCode = require('qrcode');

const GROQ_KEY = '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';
const LIDER_NUM = '573052297432@s.whatsapp.net'; // numero de prueba
const PORT = process.env.PORT || 8080;

let currentQR = null;
let botStatus = 'Iniciando...';
const sessions = {};

// SERVIDOR WEB para mostrar QR
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr' || req.url === '/') {
    if (currentQR) {
      try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="10">
  <title>Glam Bot - QR</title>
  <style>
    body{font-family:Arial,sans-serif;background:#1A1410;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    h1{color:#C9A96E;font-size:24px;margin-bottom:8px;}
    p{color:#aaa;font-size:14px;margin-bottom:24px;}
    img{border:8px solid #C9A96E;border-radius:12px;width:280px;height:280px;}
    .status{margin-top:16px;background:#C9A96E;color:#1A1410;padding:8px 20px;border-radius:20px;font-weight:bold;}
  </style>
</head>
<body>
  <h1>Glam Color Studio</h1>
  <p>Escanea este QR con WhatsApp para conectar el bot</p>
  <img src="${qrImage}" alt="QR Code"/>
  <div class="status">Estado: ${botStatus}</div>
  <p style="font-size:12px;color:#666;margin-top:12px;">La pagina se actualiza cada 10 segundos</p>
</body>
</html>`);
      } catch(e) {
        res.writeHead(500); res.end('Error generando QR');
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="5">
  <title>Glam Bot</title>
  <style>body{font-family:Arial,sans-serif;background:#1A1410;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;}h1{color:#C9A96E;}p{color:#aaa;}</style>
</head>
<body>
  <h1>Glam Color Studio Bot</h1>
  <p>Estado: ${botStatus}</p>
  <p>La pagina se actualiza cada 5 segundos...</p>
</body>
</html>`);
    }
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log('Servidor QR en puerto ' + PORT));

// DETECCION DE SERVICIO
function detectService(msg) {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (m.includes('balayage')||m.includes('ligth')||m.includes('bronde')||m.includes('brunette')||m.includes('rubio')||m.includes('aclaracion')||m.includes('luces')) return 'balayage';
  if (m.includes('novia')||m.includes('boda')||m.includes('maquillaje')) return 'novia';
  if (m.includes('terapia')||m.includes('keratina')||m.includes('brillo')||m.includes('hidrat')||m.includes('hair spa')||m.includes('glicoprot')) return 'terapias';
  if (m.includes('corte')||m.includes('blower')||m.includes('secado')||m.includes('cepillado')) return 'corte';
  if (m.includes('color')||m.includes('tinte')||m.includes('asesoria')||m.includes('asesor')) return 'asesoria_color';
  if (m.includes('tonaliz')||m.includes('matiz')||m.includes('tono')) return 'tonalizado';
  if (m.includes('extraccion')||m.includes('quitar color')||m.includes('sacar color')) return 'extraccion';
  if (m.includes('crecimiento')||m.includes('raiz')||m.includes('raices')) return 'crecimiento';
  if (m.includes('onda')||m.includes('rizo')||m.includes('permanente')) return 'ondas';
  if (m.includes('pre aclar')||m.includes('preaclar')) return 'pre_aclaracion';
  return null;
}

const BIENVENIDA = {
  corte: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Corte & Blower. Queremos darte la mejor asesoria personalizada.',
  balayage: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en Balayage/Diseno de color. Queremos darte la mejor asesoria personalizada.',
  novia: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Novia. Queremos que ese dia estes absolutamente radiante.',
  terapias: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestras Terapias Capilares. Queremos darte la mejor asesoria personalizada.',
  asesoria_color: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestra Asesoria de Color. Queremos ayudarte a encontrar el color perfecto para ti.',
  tonalizado: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Tonalizado. Queremos darte la mejor asesoria personalizada.',
  extraccion: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en Extraccion de Color. Queremos darte la mejor asesoria personalizada.',
  crecimiento: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en Crecimiento Preaclarado. Queremos darte la mejor asesoria personalizada.',
  ondas: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Ondas. Queremos darte la mejor asesoria personalizada.',
  pre_aclaracion: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en Pre Aclaracion. Queremos darte la mejor asesoria personalizada.',
};

async function detectWithGroq(msg) {
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 20,
      messages: [{ role: 'user', content: `Clasifica este mensaje en UNA categoria: corte, balayage, novia, terapias, asesoria_color, tonalizado, extraccion, crecimiento, ondas, pre_aclaracion, otro. Mensaje: "${msg}". Responde SOLO la categoria.` }]
    }, { headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' } });
    return res.data.content[0].text.trim().toLowerCase();
  } catch(e) { return null; }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      botStatus = 'Esperando escaneo del QR';
      console.log('QR generado - visita la URL del servicio para escanearlo');
    }
    if (connection === 'close') {
      currentQR = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      botStatus = shouldReconnect ? 'Reconectando...' : 'Desconectado';
      if (shouldReconnect) setTimeout(startBot, 3000);
    }
    if (connection === 'open') {
      currentQR = null;
      botStatus = 'Conectado y activo';
      console.log('Bot Glam conectado!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const hasImage = !!(msg.message?.imageMessage);
    if (!body && !hasImage) return;

    if (!sessions[from]) sessions[from] = { paso: 'inicio' };
    const s = sessions[from];

    if (s.paso === 'inicio') {
      let servicio = detectService(body);
      if (!servicio) servicio = await detectWithGroq(body);
      if (!servicio || servicio === 'otro') {
        await sock.sendMessage(from, { text: 'Hola, hermosa! Bienvenida a Glam Color Studio. En que servicio podemos ayudarte hoy? Tenemos Corte & Blower, Balayage, Terapias, Novia, Asesoria de Color, Tonalizado, Ondas y mas.' });
        return;
      }
      s.servicio = servicio;
      s.paso = servicio === 'novia' ? 'foto' : 'quimicos';
      await sock.sendMessage(from, { text: BIENVENIDA[servicio] || BIENVENIDA.corte });
      await new Promise(r => setTimeout(r, 1500));
      if (servicio === 'novia') {
        await sock.sendMessage(from, { text: 'Preciosa, para asesorarte mejor necesitamos una foto de tu rostro con buena iluminacion.' });
      } else {
        await sock.sendMessage(from, { text: 'Carino, tienes algun proceso quimico anterior en tu cabello? Por ejemplo alisado, decoloracion, tinte u otro tratamiento. Si es asi, cual y hace cuanto tiempo?' });
      }
      return;
    }

    if (s.paso === 'quimicos') {
      s.quimicos = body;
      s.paso = 'foto';
      await sock.sendMessage(from, { text: 'Muchas gracias por contarnos, hermosa! Esa informacion nos ayuda muchisimo.' });
      await new Promise(r => setTimeout(r, 1000));
      await sock.sendMessage(from, { text: 'Ahora necesitamos una foto de espalda de tu cabello con buena iluminacion para ver el largo y estado actual.' });
      return;
    }

    if (s.paso === 'foto') {
      if (hasImage) {
        s.foto = true;
        s.paso = 'nombre';
        await sock.sendMessage(from, { text: 'Hermosa foto! Ya la recibimos, carino. Cual es tu nombre?' });
      } else {
        await sock.sendMessage(from, { text: 'Preciosa, necesitamos la foto de tu cabello para continuar. Por favor enviala cuando puedas.' });
      }
      return;
    }

    if (s.paso === 'nombre') {
      let nombre = body.trim().split(' ')[0];
      nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
      s.nombre = nombre;
      s.paso = 'fin';
      await sock.sendMessage(from, { text: nombre + ', muchas gracias por confiar en nosotros! Ya tenemos toda tu informacion.' });
      await new Promise(r => setTimeout(r, 1000));
      await sock.sendMessage(from, { text: 'En breve una de nuestras asesoras te contactara personalmente para acompanarte y agendar tu cita.' });
      await sock.sendMessage(LIDER_NUM, {
        text: 'Nueva clienta interesada en Glam!\n\nNombre: ' + nombre + '\nServicio: ' + s.servicio + '\nProcesos quimicos: ' + (s.quimicos || 'Ninguno') + '\nNumero: ' + from.replace('@s.whatsapp.net','')
      });
      return;
    }

    if (s.paso === 'fin') {
      await sock.sendMessage(from, { text: 'Gracias por escribirnos, preciosa! Una asesora te contactara muy pronto.' });
    }
  });
}

startBot().catch(console.error);
