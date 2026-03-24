const { EndBehaviorType } = require('@discordjs/voice')
const { createWriteStream, mkdirSync, existsSync } = require('fs')
const { join } = require('path')
const { transcribe } = require('./transcribe')
const { playAudio } = require('./tts')

const TMP_DIR = join(__dirname, '..', 'tmp')

// Ensure tmp directory exists
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })

/**
 * Start listening to voice in a connection.
 * Calls onTranscript(text) when speech is detected and transcribed.
 */
function startListening(connection, onTranscript) {
  const receiver = connection.receiver

  receiver.speaking.on('start', (userId) => {
    // Only listen to specific user if configured, otherwise listen to all
    const listenTo = process.env.LISTEN_TO_USER_ID
    if (listenTo && userId !== listenTo) return

    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500, // ms of silence before we consider speech done
      },
    })

    const filename = `${userId}-${Date.now()}.pcm`
    const filepath = join(TMP_DIR, filename)
    const writeStream = createWriteStream(filepath)

    const opusDecoder = new (require('prism-media').opus.Decoder)({
      rate: 48000,
      channels: 1,
      frameSize: 960,
    })

    audioStream.pipe(opusDecoder).pipe(writeStream)

    writeStream.on('finish', async () => {
      try {
        // Convert PCM to WAV for Whisper
        const wavPath = filepath.replace('.pcm', '.wav')
        await pcmToWav(filepath, wavPath)

        const text = await transcribe(wavPath)
        if (text && text.trim().length > 0) {
          await onTranscript(text.trim())
        }

        // Cleanup
        const fs = require('fs')
        fs.unlinkSync(filepath)
        fs.unlinkSync(wavPath)
      } catch (err) {
        console.error('Transcription error:', err)
      }
    })
  })

  console.log('Listening for speech...')
}

/**
 * Convert raw PCM (48kHz, 16-bit, mono) to WAV file using ffmpeg.
 */
function pcmToWav(pcmPath, wavPath) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '1',
      '-i', pcmPath,
      '-ar', '16000', // Whisper expects 16kHz
      '-ac', '1',
      wavPath,
    ])

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })

    ffmpeg.on('error', reject)
  })
}

module.exports = { startListening }
