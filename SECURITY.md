# Security policy

## Supported versions

Only the latest release of the Google Find My Device integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version        | Supported |
| -------------- | --------- |
| latest release | Yes       |
| older          | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-googlefindmydevice](https://github.com/prohand/gladys-googlefindmydevice/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, `secrets.json` content, e-mail addresses and
  coordinates first).

You should get a first answer within 7 days. A fix is released as a new version of the
integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes — in particular the
handling of `secrets.json`, the Google tokens, the push channel and the decryption of locations.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), Google's services,
and the GoogleFindMyTools project used to generate `secrets.json` (report to
[leonboe1/GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools)).

## What the integration does with your data

- `secrets.json` gives access to the devices of your Google account and to their **decrypted
  locations**. Keep it private; paste it only in the integration's secret field.
- The integration talks to Google only (`android.clients.google.com`, `android.googleapis.com`,
  `mtalk.google.com:5228`). Locations are decrypted inside the container and sent to your Gladys,
  nowhere else.
- The last known positions are cached in `/data/positions.json`, inside the integration's volume.
- Tokens and `secrets.json` fields are never written to the logs; the account e-mail is masked.

## Good practices for users

- Use a `secrets.json` dedicated to Gladys, and keep no copy lying around once pasted.
- If you think `secrets.json` leaked: change your Google password (this revokes the master
  token), check [your Google devices](https://myaccount.google.com/device-activity), and generate
  a new file.
- Keep Gladys and the integration up to date.
