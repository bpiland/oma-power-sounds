# oma-power-sounds

Short analog cues for charger plug/unplug, low battery, and battery full on [Omarchy](https://omarchy.org/).

This is an Omarchy **shell plugin**, not a theme and not a standalone daemon. It is a headless `service` inside `omarchy-shell`: it watches UPower and plays four bundled cues through PipeWire's `pw-play`. No extra systemd unit.

## Install

```bash
omarchy plugin add https://github.com/bpiland/oma-power-sounds.git --enable
```

Update and remove:

```bash
omarchy plugin update oma-power-sounds
omarchy plugin remove oma-power-sounds
```

Removal deletes the plugin checkout. It does **not** delete `~/.config/omarchy/oma-power-sounds.conf`. Remove that yourself if you want it gone.

## Events

| Event | When | Cue |
|---|---|---|
| `ac-online` | Charger connected | Two-step up (E then G), filter opens |
| `ac-offline` | Charger removed | One drop (G to E), filter shuts |
| `battery-low` | ≤10% while discharging (same threshold as Omarchy) | Dry double stab |
| `battery-full` | On AC at `full_percent` (default 100), or UPower `FullyCharged` | Sung E–G–C cadence |

Startup does not play `ac-online` / `ac-offline` just because you are already plugged in. Already-full at login is latched so login does not chime. Already-low at login may play, matching the stock battery warning.

Charge-limited laptops often never report 100% or `FullyCharged`. Set `full_percent` to the cap (80, 60, …) so the full chime still fires when you reach it.

There is no USB insert/remove event.

## Config

`~/.config/omarchy/oma-power-sounds.conf` is created on first run if it is missing. Existing files are never overwritten. Edits apply as soon as the file is saved.

```ini
enabled=true
follow_system_mute=true
volume=0.45
full_percent=100
```

| Key | Default | What it does |
|---|---|---|
| `enabled` | `true` | Master on/off for this plugin. |
| `follow_system_mute` | `true` | When `true`, a muted speaker (or volume 0) silences the plugin; unmuting brings the cues back. When `false`, only `enabled` mutes the plugin — system audio can stay up. Independent mode cannot *override* a muted speaker: `pw-play` still goes to that sink. |
| `volume` | `0.45` | Stream gain from `0` to `1`. PipeWire still applies the system output slider, so this is not multiplied by it. |
| `full_percent` | `100` | On-AC percentage that counts as charged. Set this to your charge limit so `battery-full` still plays. |

## Control

```bash
omarchy-shell oma-power-sounds list
omarchy-shell oma-power-sounds status
omarchy-shell oma-power-sounds play ac-online
omarchy-shell oma-power-sounds play ac-offline
omarchy-shell oma-power-sounds play battery-low
omarchy-shell oma-power-sounds play battery-full
```

`play` of an unknown name prints the event list. While the speaker is muted (and `follow_system_mute` is on), `play` returns `silent` and does not spawn `pw-play`.

## Requirements

Omarchy with `omarchy-shell` (Quickshell) and PipeWire's `pw-play`. Both ship with current Omarchy.

## Regenerating the cues

The four WAVs in `sounds/` are synthesized by `scripts/generate_sounds.py`. Runtime does not need Python.

```bash
python3 scripts/generate_sounds.py
```

Event policy (when a cue fires, not how it sounds) is in `PowerSoundsModel.js` and can be checked without QML:

```bash
node tests/test_model.js
```

## License

MIT. See [LICENSE](LICENSE). The cues are original synthesis for this plugin, not sampled from another work.
