# Google Find My Device

## Overview

This integration brings the devices of your Google **Find My Device** (Find Hub) account into
Gladys: Android phones and tablets, and the Bluetooth trackers of the Find Hub network (Chipolo,
Pebblebee, Moto Tag, earbuds…).

For each device, Gladys gets:

- **Location**: the place name or the coordinates of the last position;
- **At home**: 1 when the device is within the home radius, 0 otherwise;
- **Distance from home** (km) and **Position accuracy** (m);
- **Ring**: a switch that makes the device ring at full volume, even in silent mode.

It also adds:

- three **scene triggers**: _A device has a new position_, _A device arrives home_, _A device
  leaves home_ (with the device name, coordinates, distance and a Google Maps link as variables);
- three **scene actions**: _Locate a device_ (returns the position), _Ring a device_, _Stop a
  device ringing_;
- a **dashboard widget** listing your devices with Locate and Ring buttons.

Positions are end-to-end encrypted by Google: the integration decrypts them inside your Gladys,
with your own keys. They never go anywhere else.

## Prerequisites

Google offers **no public API** for Find My Device. This integration uses the same private API as
the Find My Device app, as reverse-engineered by the open-source project
[GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools). Google can change it at any
time.

Signing in needs a real Chrome window, so it is done **once, on a computer**:

1. Install Python 3 and Google Chrome on a computer.
2. Download GoogleFindMyTools, then in its folder run `pip install -r requirements.txt` and
   `python main.py`.
3. Sign in to your Google account in the Chrome window that opens.
4. When the device list appears, **choose a device to locate**: the tool asks for the screen lock
   PIN (or pattern) of one of your Android devices. This unlocks the encryption key of your
   locations (`owner_key`). Without this step, the positions cannot be decrypted.
5. The tool writes the file `Auth/secrets.json`. Open it with a text editor and copy **all** of
   its content.

Your Gladys house must have a location (Settings → Houses) for presence and distance.

## Configuration

1. In Gladys, install the integration, then open its **Configuration** tab.
2. Paste the content of `secrets.json` in **Content of secrets.json** and save.
3. Optional: choose the **Home** house, the **Home radius** (150 m by default) and how often to
   **Locate every** (15 minutes by default, `0` = only on demand). Each locate request wakes the
   devices: very short intervals cost battery.
4. Click **Test the connection**: it shows the account, the number of devices and the push channel
   state.
5. Go to the **Devices** tab and add the devices you want.

`secrets.json` gives access to the devices of your Google account: keep it private. It is stored
in a secret field of Gladys (hidden in the interface) and never written to the logs. Use a dedicated
`secrets.json` for Gladys: if the same file runs elsewhere (Home Assistant…), both compete for the
same push channel.

## Troubleshooting

- **"secrets.json is incomplete"**: run GoogleFindMyTools again until it lists your devices, then
  paste the new file.
- **"Positions cannot be decrypted: secrets.json has no owner_key"**: in GoogleFindMyTools, locate
  one device (step 4 above), then paste the updated file.
- **"Google refused the account token (BadAuthentication)"**: the token was revoked (password
  change, account security check). Delete `Auth/secrets.json`, run GoogleFindMyTools again and
  paste the new file.
- **A device never answers**: it must be switched on, online, with Find My Device enabled. A
  tracker is only located when an Android phone passes nearby.
- **"Push channel down" badge**: Gladys cannot reach `mtalk.google.com` on port 5228 (TCP). Open
  this outgoing port on your firewall.
- **No presence nor distance**: give your Gladys house a location, or pick it in **Home**.
