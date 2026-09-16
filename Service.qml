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
  readonly property int acDebounceMs: 250
  readonly property int maxQueue: 2
  readonly property int maxLogBytes: 32768
  readonly property string home: Quickshell.env("HOME")
  readonly property string configPath: home + "/.config/omarchy/oma-power-sounds.conf"
  readonly property string stateDir: home + "/.local/state/omarchy"
  readonly property string logPath: stateDir + "/oma-power-sounds.log"
  readonly property string logPrevPath: stateDir + "/oma-power-sounds.log.1"

  property var config: Model.defaultConfig()
  property bool listening: false
  property var lastOnBattery: null
  property var playQueue: []
  property bool stoppingPlayer: false
  property string playingPath: ""
  property string lastError: ""

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

  function fail(msg) {
    var line = Qt.formatDateTime(new Date(), "yyyy-MM-dd hh:mm:ss") + " ERROR " + msg
    root.lastError = line
    console.warn("oma-power-sounds:", msg)
    root.appendLog(line)
  }

  function warn(msg) {
    var line = Qt.formatDateTime(new Date(), "yyyy-MM-dd hh:mm:ss") + " WARN  " + msg
    console.warn("oma-power-sounds:", msg)
    root.appendLog(line)
  }

  function appendLog(line) {
    var body = ""
    try {
      body = String(logFile.text() || "")
    } catch (e) {
      body = ""
    }
    if (body.length && body.charAt(body.length - 1) !== "\n")
      body += "\n"
    body += line + "\n"
    if (body.length > root.maxLogBytes) {
      logPrev.setText(body)
      body = line + "\n"
    }
    logFile.setText(body)
  }

  function emitEvent(name) {
    if (!name) return
    root.playNamed(name)
  }

  function playNamed(name) {
    var quiet = Model.silenceReason(root.config, root.systemSilent)
    if (quiet)
      return "silent: " + quiet
    if (root.playQueue.length >= root.maxQueue) {
      root.warn("queue full, drop " + name)
      return "error: queue full"
    }
    var path = root.resolvedSound(name)
    if (!path || path.charAt(0) !== "/") {
      root.fail("no sound file for " + name + (path ? " (" + path + ")" : ""))
      return "error: no sound file for " + name
    }
    root.playQueue = root.playQueue.concat([path])
    root.kickPlayer()
    return "ok " + name
  }

  function resolvedSound(name) {
    var rel = Model.soundFile(name)
    if (!rel) return ""
    var url = String(Qt.resolvedUrl(rel))
    if (url.indexOf("file://") === 0)
      return url.slice(7)
    return url
  }

  function kickPlayer() {
    if (player.running || root.playQueue.length === 0) return
    if (!root.shouldPlay) {
      root.playQueue = []
      return
    }
    var path = root.playQueue[0]
    root.playQueue = root.playQueue.slice(1)
    root.playingPath = path
    player.command = [
      "/usr/bin/pw-play",
      "--latency", "20ms",
      "--volume", String(root.volume),
      "--media-role", "Notification",
      "--",
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
    acDebounce.restart()
  }

  function commitAcChange() {
    var next = UPower.onBattery
    var name = Model.acEvent(root.lastOnBattery, next)
    root.lastOnBattery = next
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

  Process {
    id: ensureStateDir
    command: ["mkdir", "-p", root.stateDir]
  }

  FileView {
    id: logFile
    path: root.logPath
    watchChanges: false
    printErrors: false
    onLoadFailed: setText("")
  }

  FileView {
    id: logPrev
    path: root.logPrevPath
    watchChanges: false
    printErrors: false
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

  Timer {
    id: acDebounce
    interval: root.acDebounceMs
    repeat: false
    onTriggered: root.commitAcChange()
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
    stderr: StdioCollector {
      id: playerErr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (root.stoppingPlayer) {
        root.stoppingPlayer = false
        return
      }
      if (exitCode !== 0) {
        var err = String(playerErr.text || "").trim()
        root.fail("pw-play exited " + exitCode + " " + root.playingPath + (err ? ": " + err : ""))
      }
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
        "config=" + root.configPath,
        "log=" + root.logPath,
        "last_error=" + (root.lastError || "")
      ].join("\n")
    }

    function log(): string {
      var prev = ""
      var cur = ""
      try { prev = String(logPrev.text() || "") } catch (e) {}
      try { cur = String(logFile.text() || "") } catch (e) {}
      return (prev + cur) || "(empty)"
    }

    function play(event: string): string {
      var name = String(event || "").trim()
      if (Model.eventNames().indexOf(name) < 0)
        return "unknown event: " + name + "\n" + Model.eventNames().join("\n")
      return root.playNamed(name)
    }
  }

  Component.onCompleted: ensureStateDir.running = true
}
