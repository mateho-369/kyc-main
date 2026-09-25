# Sharegram ↔ KYC with an unchanged Sharegram (origin master)

Sharegram is not modified. No new table, route or setting is added on the Sharegram side.
KYC follows the contract in [`API_DOCUMENTATION_SHAREGRAM.md`](../API_DOCUMENTATION_SHAREGRAM.md).

## How a performer reaches Sharegram

```
Sharegram FE :3000 ──redirect──▶ KYC FE :3300 /sso?token=<Firebase ID token>&action=create|edit
                                               &performer_id=<id>&come_back_url=<Sharegram URL>
KYC FE ──after saving──▶ come_back_url?performer_id=<id>&status=created   (action=create)
                         come_back_url?performer_id=<id>&status=updated   (action=edit)

Sharegram API :8000 ──GET {KYC_URL_API}/performers?user_id=<Firebase UID>──▶ KYC API :5002
                    ──GET {KYC_URL_API}/performers/<id>────────────────────▶
                    Authorization: Bearer {AUTHORIZED_KYC_KEY}
```

Sharegram **reads** performers from KYC. KYC never writes into Sharegram's database, so there is no
`kyc_performers` table and nothing to push. The optional webhook in
[`SHAREGRAM_KYC_WEBHOOK.md`](SHAREGRAM_KYC_WEBHOOK.md) needs Sharegram changes and stays off
(`KYC_WEBHOOK_URL` unset).

## Settings that must match

| Sharegram backend `.env` | KYC |
|---|---|
| `KYC_URL_API=http://localhost:5002/api` | API runs on `PORT=5002` |
| `AUTHORIZED_KYC_KEY=<key>` | `server/.env` → `SYSTEM_API_KEYS=<the same key>` |
| `REACT_APP_KYC_URL=http://localhost:3300/sso` | frontend `.env` → `PORT=3300` |
| `FIREBASE_PROJECT_ID=demo-kyc-local` | `server/.env` → `FIREBASE_PROJECT_ID=demo-kyc-local`, frontend → `REACT_APP_FIREBASE_PROJECT_ID=demo-kyc-local` |
| `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` | `server/.env` → the same; frontend → `REACT_APP_USE_FIREBASE_EMULATOR=true` |

The KYC Admin SDK does not need a real service-account key with the emulator:
`cd server && npm run secrets:local` prints an emulator-only key plus fresh JWT/session secrets.

## What KYC answers (pinned by `server/tests/sso/sharegram-pull-contract.test.js`)

- `GET /api/performers` → `{ success: true, data: [ {id, external_id, lastName, firstName, lastNameRoman,
  firstNameRoman, status, kycStatus, kycVerifiedAt, riskScore, createdAt, updatedAt, …} ] }`
  - `user_id` is the creator's **Firebase UID**. It matches the KYC user that was created when that creator
    first came through `/sso`. An unknown UID gives `[]`.
  - With the Sharegram key, `status=` is ignored: pending performers are always included.
  - 20 per page (`limit` up to 100, `page`).
- `GET /api/performers/:id` → the performer's fields directly under `data` (as in the spec) **and** the same
  object under `data.performer` (what the KYC screens read). `documents` is always an object.
- A performer becomes `status: active` when an admin verifies agreementFile + idFront + selfie, or approves it.
  Whether Sharegram lists pending performers is Sharegram's own rule.

## Checking it from Windows without touching Sharegram

KYC API log while Sharegram opens its page:

```
2026-09-25T10:00:00.000Z - GET /api/performers?user_id=jeV3farXEowM1r60tv5Wr7QoPZ31
[sharegram-api] GET /api/performers?user_id=jeV3farXEowM1r60tv5Wr7QoPZ31 → 1 of 1 performer(s): #2 pending
```

| What you see | Meaning |
|---|---|
| no `/api/performers` line at all | Sharegram did not call KYC. Look at Sharegram's `storage/logs/laravel.log` and its `KYC_URL_API` |
| a `/api/performers` line but no `[sharegram-api]` line, HTTP 401 | `AUTHORIZED_KYC_KEY` ≠ `SYSTEM_API_KEYS` |
| `0 performers: no KYC user has firebaseUid=…` | The UID Sharegram sent is not in KYC `Users.firebaseUid` (e.g. emulator data was reset) |
| `→ N performer(s): #2 pending …` | KYC answered. If Sharegram still shows nothing, it filters them (e.g. pending) |

The same calls by hand (PowerShell, `curl.exe` ships with Windows 10/11):

```powershell
$KEY = "<value of SYSTEM_API_KEYS>"
curl.exe -s -H "Authorization: Bearer $KEY" "http://localhost:5002/api/performers"
curl.exe -s -H "Authorization: Bearer $KEY" "http://localhost:5002/api/performers?user_id=<Firebase UID>"
curl.exe -s -H "Authorization: Bearer $KEY" "http://localhost:5002/api/performers/2"
```

Who owns which performer (KYC database `safevideo`):

```sql
SELECT p.id, p.status, p.userId, u.email, u.firebaseUid
FROM performers p LEFT JOIN Users u ON u.id = p.userId
ORDER BY p.id;
```
