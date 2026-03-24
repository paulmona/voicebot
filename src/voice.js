const { EndBehaviorType } = require('@discordjs/voice')
const { createTranscriptionSession } = require('./transcribe')
const log = require('./log')

// Minimum duration (ms) of audio before we bother committing.
// Prevents ghost transcripts from ambient noise or TTS echo.
const MIN_AUDIO_DURATION_MS = 1500

/**
 * Start listening to voice in a connection.
 * Streams audio to ElevenLabs Scribe Realtime for transcription.
 * Calls onTranscript(text) when a committed transcript is received.
 */
function startListening(connection, onTranscript) {
  const receiver = connection.receiver
  const activeListeners = new Set()

  // Track whether TTS is currently playing so we can ignore echo
  let ttsPlaying = false

  // Create a persistent STT session
  let sttSession = null

  async function ensureSession() {
    if (sttSession && sttSession.alive) return sttSession

    sttSession = createTranscriptionSession()
    sttSession.onTranscript = (text) => {
      log.info(`COMMITTED: "${text}"`)
      onTranscript(text)
    }
    sttSession.onPartial = (text) => {
      log.debug(`partial: ${text}`)
    }
    sttSession.onError = (err) => {
      log.error('STT error, will reconnect:', err.message_type || err.message || err)
      sttSession = null
    }
    sttSession.onClose = () => {
      log.debug('STT session closed, will reconnect on next speech')
      sttSession = null
    }

    await sttSession.ready
    return sttSession
  }

  receiver.speaking.on('start', async (userId) => {
    // Only listen to specific user if configured
    const listenTo = process.env.LISTEN_TO_USER_ID
    if (listenTo && userId !== listenTo) return

    // Ignore speech events while TTS is playing (bot hearing its own output)
    if (ttsPlaying) return

    // Prevent duplicate listeners for the same user
    if (activeListeners.has(userId)) return
    activeListeners.add(userId)
    log.debug(`Speech detected from ${userId}`)

    const streamStartTime = Date.now()
    let gotPartial = false

    try {
      const session = await ensureSession()
      log.debug('STT session ready, streaming audio')

      // Track partials so we know if real speech was detected
      const origOnPartial = session.onPartial
      session.onPartial = (text) => {
        gotPartial = true
        if (origOnPartial) origOnPartial(text)
      }

      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1500, // Discord silence cutoff
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
        const duration = Date.now() - streamStartTime
        activeListeners.delete(userId)

        // Only commit if we got meaningful audio
        if (duration < MIN_AUDIO_DURATION_MS && !gotPartial) {
          log.debug(`Audio too short (${duration}ms) with no partial, skipping`)
          return
        }

        log.debug(`Audio stream ended (${duration}ms), sending commit`)
        session.commit()
      })

      audioStream.on('error', (err) => {
        log.error('Audio stream error:', err)
        activeListeners.delete(userId)
      })
    } catch (err) {
      log.error('Failed to start STT session:', err)
      activeListeners.delete(userId)
    }
  })

  log.info('Listening for speech (ElevenLabs Scribe Realtime)')

  return { setTtsPlaying: (playing) => { ttsPlaying = playing } }
}

module.exports = { startListening }
