# Google Find My Device for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that brings the devices
of your Google **Find My Device** (Find Hub) account into Gladys: Android phones and tablets, and
the Bluetooth trackers of the Find Hub network (Chipolo, Pebblebee, Moto Tag, earbuds…).

Built from the official
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js) with the
SDK [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0** or newer.

> Google offers no public API for Find My Device. This integration uses the private API of the
> Find My Device app, as reverse-engineered by
> [GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools). Google can change it at any
> time. Not affiliated with Google.

## What you get

| Surface                | Content                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| Devices (one per item) | Location (text), At home (presence), Distance from home (km), Accuracy (m)   |
|                        | Ring switch (1 = ring at full volume, 0 = stop)                              |
| Scene triggers         | `location_updated`, `arrived_home`, `left_home`                              |
| Scene actions          | `locate_device` (outputs the position), `ring_device`, `stop_ringing_device` |
| Dashboard widget       | `find_my_devices`: every device (list) or one device, Locate / Ring          |
| Configuration buttons  | Test the connection, Locate a device, Ring a device                          |
| Transport badge        | `cloud`; degraded when the push channel is down                              |

Locations are **end-to-end encrypted** by Google and decrypted inside the container with your own
keys (own reports: AES-GCM; crowd-sourced tracker reports: SECP160R1 + HKDF + AES-EAX).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## How it works

```
GoogleFindMyTools (once, on a computer) ──> secrets.json ──> pasted in Gladys
                                                               │
           ┌───────────────────────────────────────────────────┘
           ▼
  aas_token ──> android.clients.google.com/auth ──> OAuth token (android_device_manager)
           │
           ├──> android.googleapis.com/nova/nbe_list_devices    device list (+ last reports)
           ├──> android.googleapis.com/nova/nbe_execute_action  locate / ring / stop
           │
  fcm_credentials ──> mtalk.google.com:5228 (MCS push) ──> pushed DeviceUpdate
                                                              │ owner_key → identity key
                                                              ▼ → decrypted position
                                       Gladys states + scene events + widget refresh
```

Outgoing access needed: HTTPS (443) to `android.clients.google.com` and
`android.googleapis.com`, TCP 5228 to `mtalk.google.com`.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no business logic)
├─ src/
│  ├─ service.js                     # the Find My Device service (devices, positions, orders)
│  ├─ devices.js                     # Gladys device of a Google device
│  ├─ actions.js                     # Configuration buttons
│  ├─ capabilities/scenes.js         # scene actions
│  ├─ capabilities/widget.js         # dashboard widget
│  ├─ config.js, geo.js, store.js    # config defaults, distance/presence, /data cache
│  ├─ i18n.js, messages.js           # { en, fr, de, es } texts
│  └─ google/                        # protobuf, auth, Nova API, FCM push, crypto
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/                          # CI, release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test               # unit tests (node --test), never touch the network
npm run lint           # ESLint
npm run format:check   # Prettier
```

Run against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="google-find-my-device" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the first release:
   `major` gives `1.0.0`).
3. The workflow bumps `package.json` and the manifest (`version` + `docker_image`), rolls the
   changelog, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64` image to `ghcr.io`
   (`:X.Y.Z` and `:latest`), publishes the GitHub Release and runs the store checks.

Before the first publication: make the GHCR package public, add the GitHub topic
`gladys-assistant-integration`, and turn on **Private vulnerability reporting** (see
[`SECURITY.md`](SECURITY.md)).

## Credits

Protocol and cryptography knowledge: [GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools)
by Leon Böttger, and the
[firebase-messaging](https://github.com/sdb9696/firebase-messaging) push client. This project is a
clean JavaScript implementation; it bundles none of their code.

## License

Apache-2.0
