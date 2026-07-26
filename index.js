const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');

const GROQ_KEY = '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';
const LIDER_NUM = '573235834099@s.whatsapp.net'; // mismo numero por ahora

// Estado de cada conversacion
const sessions = {};

// DETECCION DE SERVICIO por primer mensaje
function detectService(msg) {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (m.includes('balayage') || m.includes('ligth') || m.includes('bronde') || m.includes('brunette') || m.includes('rubio') || m.includes('aclaracion') || m.includes('luces')) return 'balayage';
  if (m.includes('novia') || m.includes('boda') || m.includes('maquillaje')) return 'novia';
  if (m.includes('terapia') || m.includes('keratina') || m.includes('brillo') || m.includes('hidrat') || m.includes('hair spa') || m.includes('glicoprot')) return 'terapias';
  if (m.includes('corte') || m.includes('blower') || m.includes('secado') || m.includes('cepillado')) return 'corte';
  if (m.includes('color') || m.includes('tinte') || m.includes('asesoria') || m.includes('asesor')) return 'asesoria_color';
  if (m.includes('tonaliz') || m.includes('matiz') || m.includes('tono')) return 'tonalizado';
  if (m.includes('extraccion') || m.includes('quitar color') || m.includes('sacar color')) return 'extraccion';
  if (m.includes('crecimiento') || m.includes('raiz') || m.includes('raices')) return 'crecimiento';
  if (m.includes('onda') || m.includes('rizo') || m.includes('permanente')) return 'ondas';
  if (m.includes('pre aclar') || m.includes('preaclar')) return 'pre_aclaracion';
  return null;
}

// MENSAJES DE BIENVENIDA por servicio
const BIENVENIDA = {
  corte: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Corte & Blower. Queremos darte la mejor asesoria personalizada.',
  balayage: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Balayage/Diseno de color. Queremos darte la mejor asesoria personalizada.',
  novia: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Novia. Queremos que ese dia estes absolutamente radiante.',
  terapias: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestras Terapias Capilares. Queremos darte la mejor asesoria personalizada.',
  asesoria_color: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestra Asesoria de Color. Queremos ayudarte a encontrar el color perfecto para ti.',
  tonalizado: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Tonalizado. Queremos darte la mejor asesoria personalizada.',
  extraccion: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Extraccion de Color. Queremos darte la mejor asesoria personalizada.',
  crecimiento: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Crecimiento Preaclarado. Queremos darte la mejor asesoria personalizada.',
  ondas: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Ondas. Queremos darte la mejor asesoria personalizada.',
  pre_aclaracion: 'Hola, hermosa! Bienvenida a Glam Color Studio. Vimos que estas interesada en nuestro servicio de Pre Aclaracion. Queremos darte la mejor asesoria personalizada.',
};

const PREGUNTA_QUIMICOS = 'Carino, tienes algun proceso quimico anterior en tu cabello? Por ejemplo alisado, decoloracion, tinte u otro tratamiento. Si es asi, nos podrias indicar cual y hace cuanto tiempo?';
const PREGUNTA_FOTO = 'Muchas gracias por contarnos, hermosa! Ahora necesitamos una foto de espalda de tu cabello con buena iluminacion para ver el largo y estado actual.';
const PREGUNTA_NOMBRE = 'Hermosa foto! Ya la recibimos, carino. Cual es tu nombre?';

async function detectWithGroq(msg) {
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Clasifica este mensaje en UNA de estas categorias: corte, balayage, novia, terapias, asesoria_color, tonalizado, extraccion, crecimiento, ondas, pre_aclaracion, otro. Mensaje: "${msg}". Responde SOLO con la categoria.`
      }]
    }, { headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' } });
    return res.data.content[0].text.trim().toLowerCase();
  } catch(e) {
    return null;
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n=== ESCANEA ESTE QR CON WHATSAPP DE GLAM ===\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    }
    if (connection === 'open') {
      console.log('Bot Glam conectado y listo!');
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

    // Inicializar sesion
    if (!sessions[from]) sessions[from] = { paso: 'inicio' };
    const s = sessions[from];

    // PASO INICIO - detectar servicio
    if (s.paso === 'inicio') {
      let servicio = detectService(body);
      if (!servicio) servicio = await detectWithGroq(body);
      if (!servicio || servicio === 'otro') {
        await sock.sendMessage(from, { text: 'Hola, hermosa! Bienvenida a Glam Color Studio. En que servicio podemos ayudarte hoy? Tenemos Corte & Blower, Balayage, Terapias, Novia, Asesoria de Color, Tonalizado, Ondas y mas.' });
        return;
      }
      s.servicio = servicio;
      s.paso = servicio === 'novia' ? 'foto' : 'quimicos';
      const bienvenida = BIENVENIDA[servicio] || BIENVENIDA.corte;
      await sock.sendMessage(from, { text: bienvenida });
      await new Promise(r => setTimeout(r, 1500));
      if (servicio === 'novia') {
        await sock.sendMessage(from, { text: 'Preciosa, para asesorarte mejor necesitamos una foto de tu rostro con buena iluminacion para recomendarte el mejor estilo para ese dia tan especial.' });
      } else {
        await sock.sendMessage(from, { text: PREGUNTA_QUIMICOS });
      }
      return;
    }

    // PASO QUIMICOS
    if (s.paso === 'quimicos') {
      s.quimicos = body;
      s.paso = 'foto';
      await sock.sendMessage(from, { text: 'Muchas gracias por contarnos, hermosa! Esa informacion nos ayuda muchisimo.' });
      await new Promise(r => setTimeout(r, 1000));
      await sock.sendMessage(from, { text: PREGUNTA_FOTO });
      return;
    }

    // PASO FOTO
    if (s.paso === 'foto') {
      if (hasImage) {
        s.foto = true;
        s.paso = 'nombre';
        await sock.sendMessage(from, { text: PREGUNTA_NOMBRE });
      } else {
        await sock.sendMessage(from, { text: 'Preciosa, necesitamos la foto de tu cabello para continuar. Por favor enviala cuando puedas.' });
      }
      return;
    }

    // PASO NOMBRE
    if (s.paso === 'nombre') {
      s.nombre = body.trim().split(' ')[0];
      s.nombre = s.nombre.charAt(0).toUpperCase() + s.nombre.slice(1).toLowerCase();
      s.paso = 'fin';
      await sock.sendMessage(from, { text: s.nombre + ', muchas gracias por confiar en nosotros! Ya tenemos toda tu informacion.' });
      await new Promise(r => setTimeout(r, 1000));
      await sock.sendMessage(from, { text: 'En breve una de nuestras asesoras te contactara personalmente para acompanarte y agendar tu cita.' });
      // Notificar a la lider
      await sock.sendMessage(LIDER_NUM, {
        text: 'Nueva clienta interesada!\n\nNombre: ' + s.nombre + '\nServicio: ' + s.servicio + '\nProcesos quimicos: ' + (s.quimicos || 'Ninguno') + '\nNumero: ' + from.replace('@s.whatsapp.net','')
      });
      return;
    }

    // FIN - respuesta generica
    if (s.paso === 'fin') {
      await sock.sendMessage(from, { text: 'Gracias por escribirnos, preciosa! Una asesora te contactara muy pronto.' });
    }
  });
}

startBot().catch(console.error);
