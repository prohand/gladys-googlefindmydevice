# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Google Find My Device** (Find Hub): Android
phones and tablets and the Find Hub network trackers become Gladys devices (location, presence,
distance from home, accuracy, ring switch). Requires Gladys 5.3+. Scene triggers (new position,
arrived home, left home), scene actions (locate, ring, stop ringing) and a "Find My Device"
dashboard widget. Started from the official template
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js).

Google has **no public API** for it: the integration speaks the private API of the Find My Device
app, as reverse-engineered by [GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools).
The user runs GoogleFindMyTools once on a computer (Chrome sign-in + screen-lock PIN for the
end-to-end keys) and pastes its `secrets.json` into the `secrets_json` secret field.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/crypto.test.js             # one file
node --test --test-name-pattern "locate"    # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store checks and a Docker build. Releases: **Actions → Release** only (bumps
`package.json`, manifest `version` + `docker_image`, rolls the changelog, re-runs Prettier, tags,
builds the multi-arch image, publishes the GitHub Release).

## Architecture

```
index.js                  SDK wiring only: handlers registered before connect(), restarts
src/config.js             DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/service.js            FindMyService: secrets -> clients, device list, positions -> states,
                          scene events, transports, connection status, locate / ring orders
src/devices.js            the Gladys device of a Google device (features, external ids)
src/actions.js            Configuration buttons (test_connection, locate, ring)
src/capabilities/         scene actions (scenes.js) and the dashboard widget (widget.js)
src/messages.js, i18n.js  user-facing sentences, { en, fr, de, es }
src/geo.js                haversine distance, presence, map links
src/store.js              last positions in /data/positions.json (cache across restarts)
src/google/protobuf.js    minimal protobuf wire codec (no dependency)
src/google/messages.js    Nova messages: list request/answer, locate/ring requests, DeviceUpdate
src/google/auth.js        master token (aas_token) -> android_device_manager OAuth token
src/google/http.js        HTTPS POST on node:https (Google refuses ALPN on its auth endpoint)
src/google/nova.js        android.googleapis.com/nova: nbe_list_devices, nbe_execute_action
src/google/fcm.js         FCM push receiver (MCS over TLS to mtalk.google.com:5228)
src/google/ece.js         Web Push "aesgcm" decryption of the pushed messages
src/google/crypto.js      E2EE: identity key, own reports (AES-GCM), crowd-sourced reports
                          (SECP160R1 ECDH + HKDF + AES-EAX), CMAC/EAX and the curve written here
src/google/locations.js   decrypt the reports of a device, pick the newest position
docs/{en,fr,de,es}.md     user documentation, re-hosted by Gladys
```

### Invariants worth knowing

- **A locate answer is pushed, not returned.** `nbe_execute_action` only acks the order; the
  position arrives over FCM tagged with the request UUID. The service registers the pending UUID
  BEFORE sending (a fast push could beat the HTTP answer) and resolves `null` after 60 s.
- **External ids come from the Google canonic id**, never from the device name (users rename
  devices in the app). Changing the scheme orphans every device, its history and its scenes.
- **Positions only move forward**: an older report (late push, list cache) never replaces a newer
  one; scene events fire once per new position and once per presence TRANSITION (never on the
  first position known, which has nothing to compare with — the store keeps the last presence
  across restarts so a change while Gladys was down still fires).
- **Presence gives the accuracy the benefit of the doubt, up to the radius** (`geo.isAtHome`):
  indoor fixes are fuzzy and flapping would fire scenes for nothing.
- **Crypto is tested against reference vectors** (pycryptodome, python-ecdsa, http_ece) in
  `test/crypto.test.js` and `test/protocol.test.js`: change it only with those tests green.
- **Never log secrets**: `secrets.json` fields (aas_token, security_token, keys, owner_key) and
  OAuth tokens. The account e-mail is shown masked (`maskEmail`).
- **Every feature carries `name`, `min`, `max`, `read_only` and `has_feedback`** (NOT NULL in
  Gladys); the fake Gladys of the SDK refuses a device missing one.
- **The container rootfs is read-only**: write only under `/data` (`DATA_DIR`).
- **The house coordinates** come from `getHouses()` (manifest `"location": true`); without a
  located house, presence and distance are simply not published.

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code: config defaults
and limits, Configuration actions, scene trigger / action keys, widget key, `>=5.3.0` floor
(`keywords` and the houses select), `transports: ["cloud"]`, every text in `en`/`fr`/`de`/`es`,
catalog description 10–100 characters, keywords and categories rules, docs in four languages.
**No `countries`**: Find My Device works worldwide, and declaring the field would hide the
integration from every other country's catalog (a test enforces it).

## Rules

- **Keys are forever**: config keys, action / scene / widget keys, feature keys, external ids.
- **Versions belong to the Release workflow**: never edit `version` (package.json, manifest) nor
  the `docker_image` tag by hand.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **User-facing text** is `{ en, fr, de, es }` (built with `src/i18n.js`), manifest included; the
  four `docs/*.md` are kept in sync.
- **Tests never touch the network**: `test/helpers/fakeGoogle.js` builds real protobuf payloads
  with really encrypted locations, and fake Nova / push clients.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in English.
