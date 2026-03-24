const { spawn } = require('child_process')

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base.en'

/**
 * Transcribe a WAV file using Faster Whisper CLI.
 * Returns the transcribed text.
 */
function transcribe(wavPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'faster_whisper_cli',
      '--model_size_or_path', WHISPER_MODEL,
      '--language', 'en',
      '--output_format', 'text',
      wavPath,
    ]

    const proc = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper exited with code ${code}: ${stderr}`))
        return
      }
      // Faster Whisper outputs text with timestamps, extract just the text
      const text = stdout
        .split('\n')
        .map((line) => line.replace(/^\[.*?\]\s*/, '').trim())
        .filter(Boolean)
        .join(' ')
      resolve(text)
    })

    proc.on('error', reject)
  })
}

module.exports = { transcribe }
