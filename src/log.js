const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const level = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info

function ts() {
  return new Date().toISOString().slice(11, 23)
}

function debug(...args) {
  if (level <= LEVELS.debug) console.log(`[${ts()}] [DEBUG]`, ...args)
}

function info(...args) {
  if (level <= LEVELS.info) console.log(`[${ts()}]`, ...args)
}

function warn(...args) {
  if (level <= LEVELS.warn) console.warn(`[${ts()}] [WARN]`, ...args)
}

function error(...args) {
  if (level <= LEVELS.error) console.error(`[${ts()}] [ERROR]`, ...args)
}

module.exports = { debug, info, warn, error }
