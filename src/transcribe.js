const WebSocket = require('ws')

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const STT_ENDPOINT = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'

// VAD settings - tuned for voice assistant use
const VAD_SILENCE_THRESHOLD = 1.0 // seconds of silence before commit
const VAD_THRESHOLD = 0.5 // voice detection sensitivity (0-1)
const MIN_SPEECH_DURATION_MS = 250 // ignore speech shorter than this
const MIN_SILENCE_DURATION_MS = 200 // minimum pause between segments

/**
 * Create a streaming transcription session using ElevenLabs Scribe Realtime.
 * Returns an object with:
 *   - send(pcmBuffer): feed raw PCM audio (48kHz, 16-bit, mono)
 *   - close(): end the session
 *   - onTranscript: callback for committed transcripts
 *   - onPartial: callback for partial transcripts (optional)
 *   - ready: promise that resolves when session is connected
 */
function createTranscriptionSession() {
  let ws = null
  let readyResolve = null
  let readyReject = null

  const session = {
    onTranscript: null,
    onPartial: null,
    onError: null,
    ready: new Promise((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    }),

    send(pcmBuffer) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const base64 = pcmBuffer.toString('base64')
      ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64,
        commit: false,
        sample_rate: 48000,
      }))
    },

    close() {
      if (ws) {
        ws.close()
        ws = null
      }
    },
  }

  const params = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: 'pcm_48000',
    language_code: 'en',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: String(VAD_SILENCE_THRESHOLD),
    vad_threshold: String(VAD_THRESHOLD),
    min_speech_duration_ms: String(MIN_SPEECH_DURATION_MS),
    min_silence_duration_ms: String(MIN_SILENCE_DURATION_MS),
  })

  ws = new WebSocket(`${STT_ENDPOINT}?${params}`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  })

  ws.on('open', () => {
    console.log('ElevenLabs STT WebSocket connected')
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data)

      switch (msg.message_type) {
        case 'session_started':
          console.log('STT session started:', msg.session_id)
          readyResolve()
          break

        case 'partial_transcript':
          if (msg.text && msg.text.trim() && session.onPartial) {
            session.onPartial(msg.text.trim())
          }
          break

        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          if (msg.text && msg.text.trim() && session.onTranscript) {
            session.onTranscript(msg.text.trim())
          }
          break

        case 'auth_error':
        case 'quota_exceeded':
        case 'rate_limited':
        case 'resource_exhausted':
        case 'transcriber_error':
        case 'input_error':
        case 'chunk_size_exceeded':
        case 'session_time_limit_exceeded':
          console.error(`STT error (${msg.message_type}):`, msg.error || msg)
          if (session.onError) session.onError(msg)
          break

        case 'insufficient_audio_activity':
          // Expected when no speech detected - not a real error
          break

        default:
          console.log('STT message:', msg.message_type)
      }
    } catch (err) {
      console.error('Failed to parse STT message:', err)
    }
  })

  ws.on('error', (err) => {
    console.error('STT WebSocket error:', err.message)
    readyReject(err)
    if (session.onError) session.onError(err)
  })

  ws.on('close', (code, reason) => {
    console.log(`STT WebSocket closed: ${code} ${reason}`)
    ws = null
  })

  return session
}

module.exports = { createTranscriptionSession }
