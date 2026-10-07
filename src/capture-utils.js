function sampleHash(jpegBuffer) {
  let h = 0
  for (let i = 0; i < jpegBuffer.length; i += 500) {
    h = (h * 31 + jpegBuffer[i]) >>> 0
  }
  return h.toString(16)
}

function samplePixels(bitmap, pixelStride) {
  if (pixelStride === undefined) pixelStride = 1000
  const samples = []
  const pixelCount = Math.floor(bitmap.length / 4)
  for (let p = 0; p < pixelCount; p += pixelStride) {
    const i = p * 4
    samples.push((bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3)
  }
  return samples
}

function diffRatio(prev, curr, channelThreshold) {
  if (channelThreshold === undefined) channelThreshold = 15
  if (!prev || prev.length !== curr.length) return 1
  let changed = 0
  for (let i = 0; i < curr.length; i++) {
    if (Math.abs(curr[i] - prev[i]) > channelThreshold) changed++
  }
  return changed / curr.length
}

module.exports = { sampleHash, samplePixels, diffRatio }
