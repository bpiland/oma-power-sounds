import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire
import Quickshell.Services.UPower
import "PowerSoundsModel.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property int lowThreshold: Model.DEFAULT_LOW_THRESHOLD
  readonly property int startupGraceMs: 600
  readonly property string configPath: Quickshell.env("HOME") + "/.config/omarchy/oma-power-sounds.conf"
  readonly property string pluginDir: manifest && manifest.__sourceDir ? String(manifest.__sourceDir) : ""

  property var config: Model.defaultConfig()
  property bool listening: false
  property var lastOnBattery: null
  property var playQueue: []
  property bool stoppingPlayer: false

  readonly property var sink: Pipewire.defaultAudioSink
  readonly property bool sinkKnown: !!(sink && sink.audio)
  readonly property bool systemSilent: Model.systemIsSilent(
    root.sinkKnown,
    root.sinkKnown && sink.audio.muted,
    root.sinkKnown ? sink.audio.volume : 0
  )
  readonly property bool shouldPlay: Model.shouldPlay(root.config, root.systemSilent)
  readonly property real volume: {
    var value = Number(root.config.volume)
    return isFinite(value) ? Math.max(0, Math.min(1, value)) : Model.DEFAULT_VOLUME
  }

  PersistentProperties {
    id: persisted
    reloadableId: "oma-power-sounds"
    property bool notifiedLow: false
    property bool notifiedFull: false
  }

  function applyConfig(text) {
    root.config = Model.parseConfig(text)
    if (!root.listening && !startupGrace.running)
      startupGrace.start()
  }

  function emitEvent(name) {
    if (!name || !root.shouldPlay) return
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
      device: UPower.displayDevice,
      onBattery: UPower.onBattery,
      dischargingState: UPowerDeviceState.Discharging,
      fullyChargedState: UPowerDeviceState.FullyCharged,
      lowThreshold: root.lowThreshold,
      fullPercent: root.config.fullPercent,
      notifiedLow: persisted.notifiedLow,
      notifiedFull: persisted.notifiedFull
    })
    persisted.notifiedLow = result.notifiedLow
    persisted.notifiedFull = result.notifiedFull
    for (var i = 0; i < result.events.length; i++)
      root.emitEvent(result.events[i])
  }

  function startListening() {
    persisted.notifiedFull = persisted.notifiedFull || Model.isFull(
      UPower.displayDevice,
      UPower.onBattery,
      UPowerDeviceState.FullyCharged,
      root.config.fullPercent
    )
    root.lastOnBattery = UPower.onBattery
    root.listening = true
    root.handleChargeChange()
  }

  onShouldPlayChanged: {
    if (!root.shouldPlay)
      root.silence()
  }

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
      return [
        "enabled=" + root.config.enabled,
        "follow_system_mute=" + root.config.followSystemMute,
        "full_percent=" + root.config.fullPercent,
        "system_silent=" + root.systemSilent,
        "should_play=" + root.shouldPlay,
        "volume=" + root.volume,
        "config=" + root.configPath
      ].join("\n")
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
}
