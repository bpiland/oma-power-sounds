// Event policy for oma-power-sounds. QML calls this; Node can too (see tests/).
// Sounds are not here — this file only decides *whether* an event fired.

var EVENTS = ["ac-online", "ac-offline", "battery-low", "battery-full"]
var DEFAULT_LOW_THRESHOLD = 10
var SOUND_FILES = {
  "ac-online": "sounds/ac-online.wav",
  "ac-offline": "sounds/ac-offline.wav",
  "battery-low": "sounds/battery-low.wav",
  "battery-full": "sounds/battery-full.wav"
}

function eventNames() {
  return EVENTS.slice()
}

function soundFile(event, pluginDir) {
  var rel = SOUND_FILES[event]
  if (!rel) return ""
  if (!pluginDir) return rel
  return String(pluginDir).replace(/\/$/, "") + "/" + rel
}

function batteryPercentage(device) {
  if (!device || !device.isPresent) return -1
  return Math.round(Number(device.percentage || 0) * 100)
}

function isDischarging(device, onBattery, dischargingState) {
  return !!(device && device.isPresent && onBattery && device.state === dischargingState)
}

function isFull(device, onBattery, fullyChargedState) {
  if (!device || !device.isPresent || onBattery) return false
  if (device.state === fullyChargedState) return true
  return batteryPercentage(device) >= 100
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
  var full = isFull(device, onBattery, input.fullyChargedState)

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
    notifiedFull: notifiedFull,
    level: level,
    low: low,
    full: full
  }
}

// Call once when listening starts. Already-full must not chime.
// Already-low *may* chime, matching omarchy.battery's first check.
function startupLatches(input) {
  var full = isFull(input.device, input.onBattery, input.fullyChargedState)
  return { notifiedLow: false, notifiedFull: full }
}

var DEFAULT_VOLUME = 0.45
var DEFAULT_CONFIG_TEXT = [
  "# oma-power-sounds",
  "# Default: follow the system speaker mute and volume=0.",
  "# Set follow_system_mute=false to mute this plugin on its own",
  "# (enabled=false) without tying it to the speaker mute key.",
  "enabled=true",
  "follow_system_mute=true",
  "volume=0.45",
  ""
].join("\n")

function defaultConfig() {
  return {
    enabled: true,
    followSystemMute: true,
    volume: DEFAULT_VOLUME
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
    }
  }
  return cfg
}

function systemIsSilent(sinkMuted, sinkVolume) {
  if (sinkMuted) return true
  var vol = Number(sinkVolume)
  if (!isFinite(vol)) return true
  return vol <= 0.001
}

function shouldPlay(config, systemSilent) {
  if (!config || !config.enabled) return false
  if (Number(config.volume) <= 0) return false
  if (config.followSystemMute && systemSilent) return false
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    EVENTS: EVENTS,
    DEFAULT_LOW_THRESHOLD: DEFAULT_LOW_THRESHOLD,
    SOUND_FILES: SOUND_FILES,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    DEFAULT_CONFIG_TEXT: DEFAULT_CONFIG_TEXT,
    eventNames: eventNames,
    soundFile: soundFile,
    batteryPercentage: batteryPercentage,
    isDischarging: isDischarging,
    isFull: isFull,
    acEvent: acEvent,
    chargeUpdate: chargeUpdate,
    startupLatches: startupLatches,
    defaultConfig: defaultConfig,
    parseConfig: parseConfig,
    systemIsSilent: systemIsSilent,
    shouldPlay: shouldPlay
  }
}
