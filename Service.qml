import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire
import Quickshell.Services.UPower
import "PowerSoundsModel.js" as Model

// Headless listener. Plays bundled cues through pw-play.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property int lowThreshold: Model.DEFAULT_LOW_THRESHOLD
  readonly property int startupGraceMs: 600
  readonly property string home: Quickshell.env("HOME")
  readonly property string configPath: home + "/.config/omarchy/oma-power-sounds.conf"
  readonly property string pluginDir: {
    if (manifest && manifest.__sourceDir)
      return String(manifest.__sourceDir)
    var id = manifest && manifest.id ? String(manifest.id) : "oma-power-sounds"
    return home + "/.config/omarchy/plugins/" + id
  }

  property var config: Model.defaultConfig()
  property bool configLoaded: false
  property bool listening: false
  property var lastOnBattery: null
  property bool notifiedLow: false
  property bool notifiedFull: false
  property var playQueue: []
  property bool stoppingPlayer: false

  readonly property var sink: Pipewire.defaultAudioSink
  readonly property bool systemSilent: Model.systemIsSilent(
    !!(sink && sink.audio && sink.audio.muted),
    sink && sink.audio ? sink.audio.volume : 0
  )
  readonly property bool shouldPlay: Model.shouldPlay(root.config, root.systemSilent)
  readonly property real volume: {
    var value = Number(root.config.volume)
    return isFinite(value) ? Math.max(0, Math.min(1, value)) : Model.DEFAULT_VOLUME
  }

  function device() {
    return UPower.displayDevice
  }

  function applyConfig(text) {
    root.config = Model.parseConfig(text)
    root.configLoaded = true
  }

  function emitEvent(name) {
    if (!name) return
    if (!root.shouldPlay) {
      console.info("oma-power-sounds:", name, "(silent)")
      return
    }
    console.info("oma-power-sounds:", name)
    root.enqueue(name)
  }

  function enqueue(name) {
    var path = Model.soundFile(name, root.pluginDir)
    if (!path) return
    root.playQueue = root.playQueue.concat([path])
    root.kickPlayer()
  }

  function kickPlayer() {
    if (player.running || root.playQueue.length === 0) return
    if (!root.shouldPlay) {
      root.playQueue = []
      return
    }
    var path = root.playQueue[0]
    root.playQueue = root.playQueue.slice(1)
    player.command = [
      "/usr/bin/pw-play",
      "--latency", "20ms",
      "--volume", String(root.volume),
      "--media-role", "Notification",
      path
    ]
    player.running = true
  }

  function silence() {
    root.playQueue = []
    if (player.running) {
      root.stoppingPlayer = true
      player.running = false
    }
  }

  function handleAcChange() {
    var onBattery = UPower.onBattery
    var name = Model.acEvent(root.lastOnBattery, onBattery)
    root.lastOnBattery = onBattery
    if (root.listening) root.emitEvent(name)
  }

  function handleChargeChange() {
    if (!root.listening) return
    var result = Model.chargeUpdate({
      device: root.device(),
      onBattery: UPower.onBattery,
      dischargingState: UPowerDeviceState.Discharging,
      fullyChargedState: UPowerDeviceState.FullyCharged,
      lowThreshold: root.lowThreshold,
      notifiedLow: root.notifiedLow,
      notifiedFull: root.notifiedFull
    })
    root.notifiedLow = result.notifiedLow
    root.notifiedFull = result.notifiedFull
    for (var i = 0; i < result.events.length; i++)
      root.emitEvent(result.events[i])
  }

  function startListening() {
    var latches = Model.startupLatches({
      device: root.device(),
      onBattery: UPower.onBattery,
      fullyChargedState: UPowerDeviceState.FullyCharged
    })
    root.notifiedLow = latches.notifiedLow
    root.notifiedFull = latches.notifiedFull
    root.lastOnBattery = UPower.onBattery
    root.listening = true
    root.handleChargeChange()
    console.info("oma-power-sounds: listening")
  }

  function statusText() {
    return [
      "enabled=" + root.config.enabled,
      "follow_system_mute=" + root.config.followSystemMute,
      "system_silent=" + root.systemSilent,
      "should_play=" + root.shouldPlay,
      "volume=" + root.volume,
      "config=" + root.configPath
    ].join("\n")
  }

  onShouldPlayChanged: {
    if (!root.shouldPlay)
      root.silence()
  }

  // Without this, sink.audio.muted never updates after first read.
  PwObjectTracker {
    objects: root.sink ? [root.sink] : []
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text())
    onLoadFailed: function() {
      var seed = Model.DEFAULT_CONFIG_TEXT
      setText(seed)
      root.applyConfig(seed)
    }
    onFileChanged: reload()
  }

  Timer {
    id: startupGrace
    interval: root.startupGraceMs
    repeat: false
    onTriggered: root.startListening()
  }

  Connections {
    target: UPower
    function onOnBatteryChanged() {
      root.handleAcChange()
      root.handleChargeChange()
    }
  }

  Connections {
    target: UPower.displayDevice
    enabled: !!(UPower.displayDevice && UPower.displayDevice.isPresent)
    function onPercentageChanged() { root.handleChargeChange() }
    function onStateChanged() { root.handleChargeChange() }
  }

  Process {
    id: player
    onExited: function(exitCode) {
      if (root.stoppingPlayer) {
        root.stoppingPlayer = false
        return
      }
      if (exitCode !== 0)
        console.warn("oma-power-sounds: pw-play exited", exitCode)
      root.kickPlayer()
    }
  }

  IpcHandler {
    target: "oma-power-sounds"

    function list(): string {
      return Model.eventNames().join("\n")
    }

    function status(): string {
      return root.statusText()
    }

    function play(event: string): string {
      var name = String(event || "").trim()
      if (Model.eventNames().indexOf(name) < 0)
        return "unknown event: " + name + "\n" + Model.eventNames().join("\n")
      root.emitEvent(name)
      if (!root.shouldPlay)
        return "silent"
      return name
    }
  }

  Component.onCompleted: startupGrace.start()
}
