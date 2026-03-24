const { EndBehaviorType } = require('@discordjs/voice')
const { createTranscriptionSession } = require('./transcribe')

/**
 * Start listening to voice in a connection.
 * Streams audio to ElevenLabs Scribe Realtime for transcription.
 * Calls onTranscript(text) when a committed transcript is received.
 */
function startListening(connection, onTranscript) {
  const receiver = connection.receiver
  const activeListeners = new Set()

  // Create a persistent STT session
  let sttSession = null

  async function ensureSession() {
    if (sttSession) return sttSession

    sttSession = createTranscriptionSession()
    sttSession.onTranscript = (text) => {
      console.log(`Committed transcript: "${text}"`)
      onTranscript(text)
    }
    sttSession.onPartial = (text) => {
      // Could display partial transcripts in text channel later
      process.stdout.write(`\r  [partial] ${text}          `)
    }
    sttSession.onError = (err) => {
      console.error('STT session error, will reconnect on next speech:', err.message_type || err.message || err)
      sttSession = null
    }

    await sttSession.ready
    return sttSession
  }

  receiver.speaking.on('start', async (userId) => {
    // Only listen to specific user if configured
    const listenTo = process.env.LISTEN_TO_USER_ID
    if (listenTo && userId !== listenTo) return

    // Prevent duplicate listeners for the same user
    if (activeListeners.has(userId)) return
    activeListeners.add(userId)

    try {
      const session = await ensureSession()

      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 2000, // Discord-level silence cutoff (longer than VAD - let ElevenLabs handle the real detection)
        },
      })

      const OpusScript = require('opusscript')
      const { Transform } = require('stream')

      const decoder = new OpusScript(48000, 1)
      const opusDecoder = new Transform({
        transform(chunk, _encoding, callback) {
          try {
            const decoded = decoder.decode(chunk)
            // Stream PCM directly to ElevenLabs
            session.send(Buffer.from(decoded))
            callback()
          } catch (err) {
            callback(err)
          }
        },
      })

      audioStream.pipe(opusDecoder)

      audioStream.on('end', () => {
        activeListeners.delete(userId)
      })

      audioStream.on('error', (err) => {
        console.error('Audio stream error:', err)
        activeListeners.delete(userId)
      })
    } catch (err) {
      console.error('Failed to start STT session:', err)
      activeListeners.delete(userId)
    }
  })

  console.log('Listening for speech (ElevenLabs Scribe Realtime)...')
}

module.exports = { startListening }
