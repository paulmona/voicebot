const { createAudioResource, createAudioPlayer, AudioPlayerStatus } = require('@discordjs/voice')
const { Readable } = require('stream')

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'DbwWo4rVEd5NrejHYUnm'
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1'

/**
 * Strip markdown formatting that TTS would read literally.
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/__(.+?)__/g, '$1')        // __underline__
    .replace(/_(.+?)_/g, '$1')          // _italic_
    .replace(/~~(.+?)~~/g, '$1')        // ~~strikethrough~~
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/```[\s\S]*?```/g, '')     // ```code blocks```
    .replace(/^#{1,6}\s+/gm, '')        // # headings
    .replace(/^[-*]\s+/gm, '')          // - bullet points
    .replace(/^\d+\.\s+/gm, '')         // 1. numbered lists
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [links](url)
    .replace(/\n{2,}/g, '. ')           // multiple newlines to pause
    .trim()
}

/**
 * Convert text to speech using ElevenLabs and play it in the voice channel.
 */
async function speakInChannel(text, connection) {
  const cleaned = stripMarkdown(text)
  const audioStream = await textToSpeech(cleaned)
  await playAudio(audioStream, connection)
}

/**
 * Call ElevenLabs TTS API and return an audio stream.
 */
async function textToSpeech(text) {
  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`ElevenLabs API error: ${response.status} ${err}`)
  }

  // Convert web ReadableStream to Node Readable
  const reader = response.body.getReader()
  return new Readable({
    async read() {
      const { done, value } = await reader.read()
      if (done) {
        this.push(null)
      } else {
        this.push(Buffer.from(value))
      }
    },
  })
}

/**
 * Play a Node Readable audio stream (mp3) in a Discord voice connection.
 */
function playAudio(audioStream, connection) {
  return new Promise((resolve, reject) => {
    // Use ffmpeg to convert mp3 stream to opus for Discord
    const { spawn } = require('child_process')
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    audioStream.pipe(ffmpeg.stdin)

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: require('@discordjs/voice').StreamType.Raw,
    })

    const player = createAudioPlayer()
    connection.subscribe(player)
    player.play(resource)

    player.on(AudioPlayerStatus.Idle, resolve)
    player.on('error', reject)
  })
}

module.exports = { speakInChannel, textToSpeech, playAudio }
