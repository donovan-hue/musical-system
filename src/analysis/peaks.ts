export function mixChannels(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0
  const mixed = new Float32Array(length)
  if (length === 0 || channels.length === 0) return mixed
  const scale = 1 / channels.length
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      mixed[index] += (channel[index] ?? 0) * scale
    }
  }
  return mixed
}

export function mixAudioBuffer(buffer: AudioBuffer): Float32Array {
  const channels: Float32Array[] = []
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index))
  }
  return mixChannels(channels)
}

/** Interleaved min/max peaks from the decoded PCM. Not a live oscilloscope. */
export function computePeaks(channel: Float32Array, buckets: number): Float32Array {
  const count = Math.max(0, Math.floor(buckets))
  const peaks = new Float32Array(count * 2)
  if (count === 0 || channel.length === 0) return peaks
  const block = channel.length / count
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * block)
    const end = Math.max(start + 1, Math.min(channel.length, Math.floor((bucket + 1) * block)))
    let min = 0
    let max = 0
    for (let index = start; index < end; index += 1) {
      const sample = channel[index] ?? 0
      if (sample < min) min = sample
      if (sample > max) max = sample
    }
    peaks[bucket * 2] = min
    peaks[bucket * 2 + 1] = max
  }
  return peaks
}
