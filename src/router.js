const { speakInChannel } = require('./tts')
const log = require('./log')

const FRIDAY_BOT_USER_ID = process.env.FRIDAY_BOT_USER_ID
const SUNDAY_BOT_USER_ID = process.env.SUNDAY_BOT_USER_ID
const DEFAULT_AGENT_ID = process.env.DEFAULT_AGENT_ID

// Wake word patterns (case insensitive)
const WAKE_WORDS = [
  { pattern: /\bhey friday\b/i, agentId: FRIDAY_BOT_USER_ID, name: 'Friday' },
  { pattern: /\bhey sunday\b/i, agentId: SUNDAY_BOT_USER_ID, name: 'Sunday' },
  { pattern: /\bfriday\b/i, agentId: FRIDAY_BOT_USER_ID, name: 'Friday' },
  { pattern: /\bsunday\b/i, agentId: SUNDAY_BOT_USER_ID, name: 'Sunday' },
]

// Timeout for waiting for agent reply (ms)
const REPLY_TIMEOUT = 30000

// Set by index.js to control TTS muting
let setTtsPlaying = null
function registerTtsControl(fn) { setTtsPlaying = fn }

/**
 * Detect which agent to route to based on wake words in the transcript.
 * Falls back to DEFAULT_AGENT_ID if no wake word found.
 */
function detectAgent(transcript) {
  for (const { pattern, agentId, name } of WAKE_WORDS) {
    if (pattern.test(transcript)) {
      return { agentId, name }
    }
  }
  return { agentId: DEFAULT_AGENT_ID, name: 'default' }
}

/**
 * Route a transcript to the appropriate agent via text channel,
 * wait for their reply, and speak it back.
 */
async function routeTranscript(transcript, textChannel, voiceConnection) {
  const { agentId, name } = detectAgent(transcript)

  if (!agentId) {
    log.error('No agent ID configured for routing')
    return
  }

  log.info(`Routed to ${name}: "${transcript}"`)
  const message = await textChannel.send(
    `<@${agentId}> [voice] ${transcript}`
  )
  log.debug('Message sent, waiting for reply...')

  // Wait for the agent's reply
  const reply = await waitForReply(textChannel, agentId)
  if (!reply) {
    log.warn('No reply received within timeout')
    return
  }

  log.info(`${name} replied: "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`)

  // Speak the reply in the voice channel
  try {
    log.debug('Starting TTS playback')
    if (setTtsPlaying) setTtsPlaying(true)
    await speakInChannel(reply, voiceConnection)
    log.debug('TTS playback complete')
  } catch (err) {
    log.error('TTS playback error:', err)
  } finally {
    if (setTtsPlaying) setTtsPlaying(false)
  }
}

/**
 * Wait for a reply from a specific bot in the text channel.
 */
function waitForReply(textChannel, agentId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      textChannel.client.off('messageCreate', handler)
      resolve(null)
    }, REPLY_TIMEOUT)

    const handler = (msg) => {
      if (msg.channelId !== textChannel.id) return
      if (msg.author.id !== agentId) return

      clearTimeout(timeout)
      textChannel.client.off('messageCreate', handler)
      resolve(msg.content)
    }

    textChannel.client.on('messageCreate', handler)
  })
}

module.exports = { routeTranscript, detectAgent, registerTtsControl }
