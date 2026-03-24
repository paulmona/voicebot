const { Client, GatewayIntentBits, Events } = require('discord.js')
const { joinVoiceChannel } = require('@discordjs/voice')
const { startListening } = require('./voice')
const { routeTranscript } = require('./router')

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

client.once(Events.ClientReady, async (c) => {
  console.log(`Voice bot connected as ${c.user.tag}`)

  const guild = client.guilds.cache.get(GUILD_ID)
  if (!guild) {
    console.error(`Guild ${GUILD_ID} not found`)
    process.exit(1)
  }

  const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID)
  if (!voiceChannel) {
    console.error(`Voice channel ${VOICE_CHANNEL_ID} not found`)
    process.exit(1)
  }

  const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID)
  if (!textChannel) {
    console.error(`Text channel ${TEXT_CHANNEL_ID} not found`)
    process.exit(1)
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  })

  console.log(`Joined voice channel: ${voiceChannel.name}`)
  console.log(`Text channel: ${textChannel.name}`)

  startListening(connection, async (transcript) => {
    console.log(`Transcript: "${transcript}"`)
    await routeTranscript(transcript, textChannel, connection)
  })
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
    console.log(`Joined voice channel: ${voiceChannel.name} (via !join)`)

    startListening(connection, async (transcript) => {
      console.log(`Transcript: "${transcript}"`)
      await routeTranscript(transcript, textChannel, connection)
    })

    await msg.reply(`Joined **${voiceChannel.name}**. Listening...`)
  }

  if (msg.content === '!leave') {
    const connection = require('@discordjs/voice').getVoiceConnection(msg.guild.id)
    if (connection) {
      connection.destroy()
      await msg.reply('Left voice channel.')
    } else {
      await msg.reply('Not in a voice channel.')
    }
  }
})

client.login(process.env.DISCORD_BOT_TOKEN)
