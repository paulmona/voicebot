require('dotenv').config({ override: true })
const http = require('http')
const { Client, GatewayIntentBits, Events } = require('discord.js')
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice')
const { startListening } = require('./voice')
const { routeTranscript, registerTtsControl } = require('./router')
const log = require('./log')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID
const TEXT_CHANNEL_ID = process.env.DISCORD_TEXT_CHANNEL_ID
const GUILD_ID = process.env.DISCORD_GUILD_ID
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '8080', 10)

// --- Health check server ---
let botReady = false

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const connected = client.ws.status === 0 // 0 = READY
    const voiceConn = getVoiceConnection(GUILD_ID)
    const status = {
      ok: botReady && connected,
      discord: connected ? 'connected' : 'disconnected',
      voice: voiceConn ? 'joined' : 'not joined',
      uptime: Math.floor(process.uptime()),
    }
    const code = status.ok ? 200 : 503
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(status))
  } else {
    res.writeHead(404)
    res.end()
  }
})

healthServer.listen(HEALTH_PORT, () => {
  log.info(`Health check listening on port ${HEALTH_PORT}`)
})

// --- Discord bot ---
client.once(Events.ClientReady, async (c) => {
  log.info(`Voice bot connected as ${c.user.tag}`)
  botReady = true

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null)
  if (!guild) {
    log.error(`Guild ${GUILD_ID} not found`)
    process.exit(1)
  }

  const voiceChannel = await guild.channels.fetch(VOICE_CHANNEL_ID).catch(() => null)
  if (!voiceChannel) {
    log.error(`Voice channel ${VOICE_CHANNEL_ID} not found`)
    process.exit(1)
  }

  const textChannel = await guild.channels.fetch(TEXT_CHANNEL_ID).catch(() => null)
  if (!textChannel) {
    log.error(`Text channel ${TEXT_CHANNEL_ID} not found`)
    process.exit(1)
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  })

  log.info(`Joined voice: ${voiceChannel.name} | Text: ${textChannel.name}`)

  const { setTtsPlaying } = startListening(connection, async (transcript) => {
    log.info(`Transcript: "${transcript}"`)
    await routeTranscript(transcript, textChannel, connection)
  })
  registerTtsControl(setTtsPlaying)
})

// Handle !join and !leave commands
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return

  if (msg.content === '!join') {
    const voiceChannel = msg.member?.voice?.channel
    if (!voiceChannel) {
      await msg.reply('You need to be in a voice channel.')
      return
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: msg.guild.id,
      adapterCreator: msg.guild.voiceAdapterCreator,
      selfDeaf: false,
    })

    const textChannel = msg.channel
    log.info(`Joined voice channel: ${voiceChannel.name} (via !join)`)

    const { setTtsPlaying } = startListening(connection, async (transcript) => {
      log.info(`Transcript: "${transcript}"`)
      await routeTranscript(transcript, textChannel, connection)
    })
    registerTtsControl(setTtsPlaying)

    await msg.reply(`Joined **${voiceChannel.name}**. Listening...`)
  }

  if (msg.content === '!leave') {
    const connection = getVoiceConnection(msg.guild.id)
    if (connection) {
      connection.destroy()
      await msg.reply('Left voice channel.')
    } else {
      await msg.reply('Not in a voice channel.')
    }
  }
})

// --- Graceful shutdown ---
function shutdown(signal) {
  log.info(`${signal} received, shutting down...`)

  // Disconnect from voice
  const connection = getVoiceConnection(GUILD_ID)
  if (connection) connection.destroy()

  // Close health server
  healthServer.close()

  // Destroy Discord client
  client.destroy()

  log.info('Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// No model to preload - ElevenLabs STT connects on demand
client.login(process.env.DISCORD_BOT_TOKEN)
