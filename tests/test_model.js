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

function charge(overrides) {
  return Object.assign({
    device: battery(50, Charging),
    onBattery: false,
    dischargingState: Discharging,
    fullyChargedState: FullyCharged,
    notifiedLow: false,
    notifiedFull: false
  }, overrides)
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
  const input = charge({
    device: battery(9, Discharging),
    onBattery: true
  })
  const first = Model.chargeUpdate(input)
  assert.deepStrictEqual(first.events, ["battery-low"])
  const second = Model.chargeUpdate(Object.assign({}, input, { notifiedLow: first.notifiedLow }))
  assert.deepStrictEqual(second.events, [])
}

function lowResetsOnCharge() {
  const afterPlug = Model.chargeUpdate(charge({
    device: battery(9, Charging),
    onBattery: false,
    notifiedLow: true
  }))
  assert.strictEqual(afterPlug.notifiedLow, false)
  assert.deepStrictEqual(afterPlug.events, [])
}

function fullOnce() {
  const input = charge({
    device: battery(100, FullyCharged)
  })
  const first = Model.chargeUpdate(input)
  assert.deepStrictEqual(first.events, ["battery-full"])
  const second = Model.chargeUpdate(Object.assign({}, input, { notifiedFull: first.notifiedFull }))
  assert.deepStrictEqual(second.events, [])
}

function unplugIsNotFull() {
  const result = Model.chargeUpdate(charge({
    device: battery(100, Discharging),
    onBattery: true,
    notifiedFull: true
  }))
  assert.ok(!result.events.includes("battery-full"))
  assert.strictEqual(result.notifiedFull, false)
}

function chargeLimitFull() {
  const atCap = Model.chargeUpdate(charge({
    device: battery(80, Charging),
    fullPercent: 80
  }))
  assert.deepStrictEqual(atCap.events, ["battery-full"])

  const below = Model.chargeUpdate(charge({
    device: battery(79, Charging),
    fullPercent: 80
  }))
  assert.deepStrictEqual(below.events, [])

  const defaultThreshold = Model.chargeUpdate(charge({
    device: battery(80, Charging)
  }))
  assert.deepStrictEqual(defaultThreshold.events, [])
}

function alreadyFullOnStart() {
  assert.strictEqual(Model.isFull(battery(80, Charging), false, FullyCharged, 80), true)
  assert.strictEqual(Model.isFull(battery(80, Charging), false, FullyCharged, 100), false)
}

function soundMap() {
  assert.strictEqual(Model.soundFile("ac-online"), "sounds/ac-online.wav")
  assert.strictEqual(Model.soundFile("usb-add"), "")
  assert.strictEqual(Model.soundFile("__proto__"), "")
  assert.strictEqual(Model.soundFile("constructor"), "")
  assert.strictEqual(Model.soundFile("toString"), "")
}

function noBattery() {
  const result = Model.chargeUpdate(charge({
    device: { isPresent: false }
  }))
  assert.deepStrictEqual(result.events, [])
}

function configAndMute() {
  const def = Model.parseConfig("")
  assert.strictEqual(def.enabled, true)
  assert.strictEqual(def.followSystemMute, true)
  assert.strictEqual(def.fullPercent, 100)
  assert.strictEqual(Model.shouldPlay(def, false), true)
  assert.strictEqual(Model.shouldPlay(def, true), false)
  assert.strictEqual(Model.silenceReason(def, false), "")
  assert.strictEqual(Model.silenceReason(def, true), "system muted")
  assert.strictEqual(Model.silenceReason(Model.parseConfig("enabled=false\n"), false), "disabled")
  assert.strictEqual(Model.silenceReason(Model.parseConfig("volume=0\n"), false), "volume=0")

  const independent = Model.parseConfig("follow_system_mute=false\n")
  assert.strictEqual(independent.followSystemMute, false)
  assert.strictEqual(Model.shouldPlay(independent, true), true)

  const off = Model.parseConfig("enabled=false\nfollow_system_mute=false\n")
  assert.strictEqual(Model.shouldPlay(off, false), false)

  const quiet = Model.parseConfig("volume=0\n")
  assert.strictEqual(Model.shouldPlay(quiet, false), false)

  const limited = Model.parseConfig("full_percent=80\n")
  assert.strictEqual(limited.fullPercent, 80)
  assert.strictEqual(Model.parseConfig("full_percent=150\n").fullPercent, 100)
  assert.strictEqual(Model.parseConfig("full_percent=0\n").fullPercent, 1)

  assert.strictEqual(Model.systemIsSilent(false, true, 1), false)
  assert.strictEqual(Model.systemIsSilent(true, true, 1), true)
  assert.strictEqual(Model.systemIsSilent(true, false, 0), true)
  assert.strictEqual(Model.systemIsSilent(true, false, 0.5), false)
  assert.strictEqual(Model.systemIsSilent(true, false, Number.NaN), false)
}

ac()
lowOnce()
lowResetsOnCharge()
fullOnce()
unplugIsNotFull()
chargeLimitFull()
alreadyFullOnStart()
noBattery()
soundMap()
configAndMute()
console.log("ok")
