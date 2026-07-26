const https = require('https')
const http = require('http')

// ── Descarga imagen desde URL pública y retorna buffer ────────
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ── Enviar imagen con caption ─────────────────────────────────
// jid: número@s.whatsapp.net
// imageUrl: URL pública de la imagen (Cloudflare, Drive, Imgur, etc.)
// caption: texto que acompaña la imagen
async function sendImage(sock, connectionStatus, jid, imageUrl, caption) {
  if (!sock || connectionStatus !== 'connected') return
  try {
    const buffer = await downloadFile(imageUrl)
    await sock.sendMessage(jid, {
      image: buffer,
      mimetype: 'image/jpeg',
      caption: caption || ''
    })
    console.log('Imagen enviada a ' + jid)
  } catch (err) {
    console.error('Error enviando imagen:', err.message)
    // Fallback: manda el link como texto si falla la imagen
    await sock.sendMessage(jid, { text: (caption || '') + '\n\n' + imageUrl })
  }
}

// ── Enviar video con caption ──────────────────────────────────
async function sendVideo(sock, connectionStatus, jid, videoUrl, caption) {
  if (!sock || connectionStatus !== 'connected') return
  try {
    const buffer = await downloadFile(videoUrl)
    await sock.sendMessage(jid, {
      video: buffer,
      mimetype: 'video/mp4',
      caption: caption || ''
    })
    console.log('Video enviado a ' + jid)
  } catch (err) {
    console.error('Error enviando video:', err.message)
    if (caption) await sock.sendMessage(jid, { text: caption })
  }
}

module.exports = { sendImage, sendVideo, downloadFile }
