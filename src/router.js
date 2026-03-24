const { speakInChannel } = require('./tts')

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
    console.error('No agent ID configured for routing')
    return
  }

  // Post transcript to text channel with @mention
  const message = await textChannel.send(
    `<@${agentId}> [voice] ${transcript}`
  )
  console.log(`Routed to ${name} (${agentId}): "${transcript}"`)

  // Wait for the agent's reply
  const reply = await waitForReply(textChannel, agentId)
  if (!reply) {
    console.log('No reply received within timeout')
    return
  }

  console.log(`${name} replied: "${reply}"`)

  // Speak the reply in the voice channel
  try {
    await speakInChannel(reply, voiceConnection)
  } catch (err) {
    console.error('TTS playback error:', err)
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

module.exports = { routeTranscript, detectAgent }
