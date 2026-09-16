// Event policy for oma-power-sounds. QML calls this; Node can too (see tests/).
// Sounds are not here — this file only decides *whether* an event fired.

var EVENTS = ["ac-online", "ac-offline", "battery-low", "battery-full"]
var DEFAULT_LOW_THRESHOLD = 10
var DEFAULT_FULL_PERCENT = 100
var DEFAULT_VOLUME = 0.45
var SOUND_FILES = {
  "ac-online": "sounds/ac-online.wav",
  "ac-offline": "sounds/ac-offline.wav",
  "battery-low": "sounds/battery-low.wav",
  "battery-full": "sounds/battery-full.wav"
}

var DEFAULT_CONFIG_TEXT = [
  "# oma-power-sounds",
  "# Default: follow the system speaker mute and volume=0.",
  "# Set follow_system_mute=false to mute this plugin on its own",
  "# (enabled=false) without tying it to the speaker mute key.",
  "# full_percent is the on-AC level that counts as charged. Set it to your",
  "# charge limit (80, 60, …) so the full chime still fires.",
  "enabled=true",
  "follow_system_mute=true",
  "volume=" + DEFAULT_VOLUME,
  "full_percent=" + DEFAULT_FULL_PERCENT,
  ""
].join("\n")

function eventNames() {
  return EVENTS.slice()
}

function soundFile(event) {
  if (!Object.prototype.hasOwnProperty.call(SOUND_FILES, event))
    return ""
  return SOUND_FILES[event]
}

function clampPercent(n, fallback) {
  var v = Number(n)
  if (!isFinite(v)) return fallback
  return Math.max(1, Math.min(100, Math.round(v)))
}

function batteryPercentage(device) {
  if (!device || !device.isPresent) return -1
  return Math.round(Number(device.percentage || 0) * 100)
}

function isDischarging(device, onBattery, dischargingState) {
  return !!(device && device.isPresent && onBattery && device.state === dischargingState)
}

function isFull(device, onBattery, fullyChargedState, fullPercent) {
  if (!device || !device.isPresent || onBattery) return false
  if (device.state === fullyChargedState) return true
  var level = batteryPercentage(device)
  var threshold = clampPercent(fullPercent, DEFAULT_FULL_PERCENT)
  return level >= 0 && level >= threshold
}

// previousOnBattery must be a real boolean from a prior sample.
// null/undefined means "we have not started listening yet" — no AC event.
function acEvent(previousOnBattery, onBattery) {
  if (typeof previousOnBattery !== "boolean") return null
  if (previousOnBattery === onBattery) return null
  return onBattery ? "ac-offline" : "ac-online"
}

function chargeUpdate(input) {
  var device = input.device
  var onBattery = input.onBattery
  var level = batteryPercentage(device)
  var low = isDischarging(device, onBattery, input.dischargingState)
    && level >= 0
    && level <= (input.lowThreshold || DEFAULT_LOW_THRESHOLD)
  var full = isFull(device, onBattery, input.fullyChargedState, input.fullPercent)

  var events = []
  var notifiedLow = !!input.notifiedLow
  var notifiedFull = !!input.notifiedFull

  if (low) {
    if (!notifiedLow) {
      events.push("battery-low")
      notifiedLow = true
    }
  } else {
    notifiedLow = false
  }

  if (full) {
    if (!notifiedFull) {
      events.push("battery-full")
      notifiedFull = true
    }
  } else {
    notifiedFull = false
  }

  return {
    events: events,
    notifiedLow: notifiedLow,
    notifiedFull: notifiedFull
  }
}

function defaultConfig() {
  return {
    enabled: true,
    followSystemMute: true,
    volume: DEFAULT_VOLUME,
    fullPercent: DEFAULT_FULL_PERCENT
  }
}

function parseBool(raw, fallback) {
  var v = String(raw || "").trim().toLowerCase()
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true
  if (v === "false" || v === "0" || v === "no" || v === "off") return false
  return fallback
}

function parseConfig(text) {
  var cfg = defaultConfig()
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/#.*$/, "").trim()
    if (!line) continue
    var eq = line.indexOf("=")
    if (eq < 1) continue
    var key = line.slice(0, eq).trim().toLowerCase().replace(/-/g, "_")
    var val = line.slice(eq + 1).trim()
    if (key === "enabled")
      cfg.enabled = parseBool(val, cfg.enabled)
    else if (key === "follow_system_mute")
      cfg.followSystemMute = parseBool(val, cfg.followSystemMute)
    else if (key === "volume") {
      var n = Number(val)
      if (isFinite(n))
        cfg.volume = Math.max(0, Math.min(1, n))
    } else if (key === "full_percent")
      cfg.fullPercent = clampPercent(val, cfg.fullPercent)
  }
  return cfg
}

// Unknown sink is not silent. Volume 0 on a known sink is.
function systemIsSilent(sinkKnown, sinkMuted, sinkVolume) {
  if (!sinkKnown) return false
  if (sinkMuted) return true
  var vol = Number(sinkVolume)
  if (!isFinite(vol)) return false
  return vol <= 0.001
}

function shouldPlay(config, systemSilent) {
  return silenceReason(config, systemSilent) === ""
}

function silenceReason(config, systemSilent) {
  if (!config || !config.enabled) return "disabled"
  if (Number(config.volume) <= 0) return "volume=0"
  if (config.followSystemMute && systemSilent) return "system muted"
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    EVENTS: EVENTS,
    DEFAULT_LOW_THRESHOLD: DEFAULT_LOW_THRESHOLD,
    DEFAULT_FULL_PERCENT: DEFAULT_FULL_PERCENT,
    SOUND_FILES: SOUND_FILES,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    DEFAULT_CONFIG_TEXT: DEFAULT_CONFIG_TEXT,
    eventNames: eventNames,
    soundFile: soundFile,
    clampPercent: clampPercent,
    batteryPercentage: batteryPercentage,
    isDischarging: isDischarging,
    isFull: isFull,
    acEvent: acEvent,
    chargeUpdate: chargeUpdate,
    defaultConfig: defaultConfig,
    parseConfig: parseConfig,
    systemIsSilent: systemIsSilent,
    shouldPlay: shouldPlay,
    silenceReason: silenceReason
  }
}
