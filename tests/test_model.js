const assert = require("assert")
const Model = require("../PowerSoundsModel.js")

const Discharging = "discharging"
const FullyCharged = "fully-charged"
const Charging = "charging"

function battery(percentage, state, present) {
  return {
    isPresent: present !== false,
    percentage: percentage / 100,
    state: state
  }
}

function ac() {
  assert.strictEqual(Model.acEvent(null, false), null)
  assert.strictEqual(Model.acEvent(undefined, true), null)
  assert.strictEqual(Model.acEvent(false, false), null)
  assert.strictEqual(Model.acEvent(true, true), null)
  assert.strictEqual(Model.acEvent(true, false), "ac-online")
  assert.strictEqual(Model.acEvent(false, true), "ac-offline")
}

function lowOnce() {
  const input = {
    device: battery(9, Discharging),
    onBattery: true,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: false,
    notifiedFull: false
  }
  const first = Model.chargeUpdate(input)
  assert.deepStrictEqual(first.events, ["battery-low"])
  const second = Model.chargeUpdate(Object.assign({}, input, { notifiedLow: first.notifiedLow }))
  assert.deepStrictEqual(second.events, [])
}

function lowResetsOnCharge() {
  const afterPlug = Model.chargeUpdate({
    device: battery(9, Charging),
    onBattery: false,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: true,
    notifiedFull: false
  })
  assert.strictEqual(afterPlug.notifiedLow, false)
  assert.deepStrictEqual(afterPlug.events, [])
}

function fullOnce() {
  const input = {
    device: battery(100, FullyCharged),
    onBattery: false,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: false,
    notifiedFull: false
  }
  const first = Model.chargeUpdate(input)
  assert.deepStrictEqual(first.events, ["battery-full"])
  const second = Model.chargeUpdate(Object.assign({}, input, { notifiedFull: first.notifiedFull }))
  assert.deepStrictEqual(second.events, [])
}

function unplugIsNotFull() {
  const result = Model.chargeUpdate({
    device: battery(100, Discharging),
    onBattery: true,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: false,
    notifiedFull: true
  })
  assert.ok(!result.events.includes("battery-full"))
  assert.strictEqual(result.notifiedFull, false)
}

function startupSuppressesFull() {
  const latches = Model.startupLatches({
    device: battery(100, FullyCharged),
    onBattery: false,
    fullyChargedState: FullyCharged
  })
  assert.strictEqual(latches.notifiedFull, true)
  assert.strictEqual(latches.notifiedLow, false)
}

function soundMap() {
  assert.strictEqual(Model.soundFile("ac-online"), "sounds/ac-online.wav")
  assert.strictEqual(
    Model.soundFile("ac-online", "/plugins/oma-power-sounds"),
    "/plugins/oma-power-sounds/sounds/ac-online.wav"
  )
  assert.strictEqual(Model.soundFile("ac-offline").endsWith("ac-offline.wav"), true)
  assert.strictEqual(Model.soundFile("battery-low").endsWith("battery-low.wav"), true)
  assert.strictEqual(Model.soundFile("battery-full").endsWith("battery-full.wav"), true)
  assert.strictEqual(Model.soundFile("usb-add"), "")
}

function noBattery() {
  const result = Model.chargeUpdate({
    device: { isPresent: false },
    onBattery: false,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: false,
    notifiedFull: false
  })
  assert.deepStrictEqual(result.events, [])
}

ac()
lowOnce()
lowResetsOnCharge()
fullOnce()
unplugIsNotFull()
startupSuppressesFull()
function configAndMute() {
  const def = Model.parseConfig("")
  assert.strictEqual(def.enabled, true)
  assert.strictEqual(def.followSystemMute, true)
  assert.strictEqual(Model.shouldPlay(def, false), true)
  assert.strictEqual(Model.shouldPlay(def, true), false)

  const independent = Model.parseConfig("follow_system_mute=false\n")
  assert.strictEqual(independent.followSystemMute, false)
  assert.strictEqual(Model.shouldPlay(independent, true), true)
  assert.strictEqual(Model.shouldPlay(independent, false), true)

  const off = Model.parseConfig("enabled=false\nfollow_system_mute=false\n")
  assert.strictEqual(Model.shouldPlay(off, false), false)

  const quiet = Model.parseConfig("volume=0\n")
  assert.strictEqual(Model.shouldPlay(quiet, false), false)

  assert.strictEqual(Model.systemIsSilent(true, 1), true)
  assert.strictEqual(Model.systemIsSilent(false, 0), true)
  assert.strictEqual(Model.systemIsSilent(false, 0.5), false)
}

ac()
lowOnce()
lowResetsOnCharge()
fullOnce()
unplugIsNotFull()
startupSuppressesFull()
noBattery()
soundMap()
configAndMute()
console.log("ok")
