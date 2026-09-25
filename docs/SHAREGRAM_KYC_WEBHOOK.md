# KYC → Sharegram performer webhook

> **Optional — not used with Sharegram master.** This push needs a receiver (table + route) inside the
> Sharegram repo, which master does not have. With an unchanged Sharegram, leave `KYC_WEBHOOK_URL` unset:
> Sharegram reads performers from KYC instead — see [`SHAREGRAM_INTEGRATION.md`](SHAREGRAM_INTEGRATION.md).

The KYC database (`safevideo`) and the Sharegram database (`fansite_dev_new`) are
separate. Sharegram master reads performers from the KYC API. A Sharegram that adds the
receiver below can instead be **notified** by KYC with a signed webhook when performers change.

```
KYC frontend :3300 → KYC API :5002 (creates performer in safevideo)
                         │  POST signed JSON (background, 3 attempts)
                         ▼
              Sharegram API :8000  /v2/kyc/webhook  → kyc_performers (fansite_dev_new)
                         ▼
              Sharegram UI :3000 lists performers from its own DB
```

KYC side: implemented in `server/services/sharegram/sharegramWebhook.js` and called
from `server/routes/performers.js`. **The Sharegram side (receiver) must be added to
the Sharegram Laravel repo** — reference implementation below.

## 1. Environment (4 files)

Generate ONE new secret (do not reuse any value that was ever pasted in chat):

```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| File | Add |
| --- | --- |
| KYC backend `server/.env` | `KYC_WEBHOOK_URL`, `KYC_WEBHOOK_SECRET` (+ optional events/timeout) |
| Sharegram backend `.env` | `KYC_WEBHOOK_SECRET` (same value), `KYC_WEBHOOK_TOLERANCE_SECONDS` |
| KYC frontend `.env` | **nothing** — `REACT_APP_*` is compiled into public JavaScript |
| Sharegram frontend `.env` | **nothing** — `VITE_*` is compiled into public JavaScript |

KYC backend `server/.env`:

```dotenv
# KYC → Sharegram webhook (KYC sends performer events to Sharegram)
KYC_WEBHOOK_URL=http://api.local-og.com:8000/v2/kyc/webhook
KYC_WEBHOOK_SECRET=<new secret, identical in Sharegram .env>
# optional (default = all events)
KYC_WEBHOOK_EVENTS=performer.created,performer.updated,performer.approved,performer.deleted,document.verified
KYC_WEBHOOK_TIMEOUT_MS=5000
```

Sharegram backend `.env`:

```dotenv
# KYC → Sharegram webhook (verify requests coming from KYC)
KYC_WEBHOOK_SECRET=<same value as KYC server/.env>
KYC_WEBHOOK_TOLERANCE_SECONDS=300
```

Notes

- Use the `api.local-og.com` host (not `127.0.0.1`): Sharegram picks the site from
  the host name (`SITE_1_API`).
- `SHAREGRAM_WEBHOOK_SECRET` in KYC is the **opposite** direction (Sharegram → KYC).
  `SYSTEM_API_KEYS` / `AUTHORIZED_KYC_KEY` are Sharegram → KYC API keys. The webhook
  uses neither.
- Restart both backends after editing `.env`; on Laravel also run `php artisan config:clear`.
- KYC prints the state at startup:
  `[env] Sharegram webhook: enabled → http://api.local-og.com:8000/v2/kyc/webhook | events: …`

## 2. Contract

`POST {KYC_WEBHOOK_URL}` with `Content-Type: application/json`

| Header | Value |
| --- | --- |
| `X-KYC-Event` | event name |
| `X-KYC-Delivery` | UUID, identical across retries of the same event |
| `X-KYC-Timestamp` | UNIX seconds |
| `X-KYC-Signature` | `sha256=` + hex(HMAC-SHA256(secret, `"{timestamp}.{raw body}"`)) |

Verify against the **raw** request body, compare in constant time, and reject
timestamps older than the tolerance. Any 2xx = delivered. 5xx/429/network errors are
retried (after 1 s and 3 s); other 4xx are not retried.

Events: `performer.created`, `performer.updated`, `document.verified`,
`performer.approved` (all required documents verified, or `POST /:id/approve`),
`performer.deleted`.

Body:

```json
{
  "id": "5d7c0c0e-6a55-4b0b-9a57-0f7a1b2c3d4e",
  "event": "performer.created",
  "occurredAt": "2026-09-25T08:00:00.000Z",
  "data": {
    "performer": {
      "id": 2,
      "externalId": null,
      "userId": 7,
      "sharegramUserId": null,
      "lastName": "山田", "firstName": "花子",
      "lastNameRoman": "Yamada", "firstNameRoman": "Hanako",
      "status": "pending",
      "kycStatus": "not_started",
      "documents": {
        "agreementFile": { "uploaded": true, "verified": false, "verifiedAt": null },
        "idFront":       { "uploaded": true, "verified": false, "verifiedAt": null },
        "idBack":        { "uploaded": false, "verified": false, "verifiedAt": null },
        "selfie":        { "uploaded": true, "verified": false, "verifiedAt": null },
        "selfieWithId":  { "uploaded": false, "verified": false, "verifiedAt": null }
      },
      "createdAt": "2026-09-25T08:00:00.000Z",
      "updatedAt": "2026-09-25T08:00:00.000Z"
    },
    "owner": {
      "id": 7,
      "email": "fbcreator2@gmail.com",
      "firebaseUid": "jeV3farXEowM1r60tv5Wr7QoPZ31",
      "sharegramUserId": null
    }
  }
}
```

`performer.id` is the same `performer_id` KYC puts in the redirect
(`/posts/new?performer_id=2&status=created`). `owner` is the account that SSO'd from
Sharegram — link it to the Sharegram user by `email` (or `firebaseUid`).
File paths, file names, address and birth date are never sent. `document.verified`
also carries `data.document.type`; `performer.updated` carries `data.updatedDocuments`.

## 3. Sharegram receiver (Laravel reference — add to the Sharegram repo)

Written for Laravel 8+; not executed in this repo. Adjust names to the Sharegram codebase.

`config/services.php`

```php
'kyc' => [
    'webhook_secret' => env('KYC_WEBHOOK_SECRET'),
    'webhook_tolerance' => (int) env('KYC_WEBHOOK_TOLERANCE_SECONDS', 300),
],
```

`routes/api.php` — outside any `auth:*` group (the signature is the authentication).
Do **not** put it in `routes/web.php` (CSRF → HTTP 419).

```php
use App\Http\Controllers\KycWebhookController;

Route::post('kyc/webhook', [KycWebhookController::class, 'handle'])->middleware('throttle:120,1');
```

Check the final URL with `php artisan route:list --path=kyc` — it must match `KYC_WEBHOOK_URL`.

`database/migrations/2026_09_25_000000_create_kyc_performers_table.php`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateKycPerformersTable extends Migration
{
    public function up()
    {
        Schema::create('kyc_performers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('kyc_performer_id')->unique();
            $table->string('owner_email')->nullable()->index();
            $table->string('owner_firebase_uid')->nullable()->index();
            $table->string('sharegram_user_id')->nullable()->index();
            $table->string('last_name')->nullable();
            $table->string('first_name')->nullable();
            $table->string('last_name_roman')->nullable();
            $table->string('first_name_roman')->nullable();
            $table->string('status', 32)->default('pending')->index();
            $table->string('kyc_status', 32)->nullable();
            $table->json('documents')->nullable();
            $table->string('last_event', 64)->nullable();
            $table->timestamp('last_event_at', 3)->nullable();
            $table->timestamp('deleted_in_kyc_at')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('kyc_performers');
    }
}
```

`app/Http/Controllers/KycWebhookController.php`

```php
<?php

namespace App\Http\Controllers;

use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class KycWebhookController extends Controller
{
    public function handle(Request $request)
    {
        $secret = (string) config('services.kyc.webhook_secret');
        if ($secret === '') {
            Log::error('KYC webhook: KYC_WEBHOOK_SECRET is not configured');
            return response()->json(['message' => 'KYC webhook is not configured'], 503);
        }

        $timestamp = (string) $request->header('X-KYC-Timestamp', '');
        $signature = (string) $request->header('X-KYC-Signature', '');
        $rawBody = $request->getContent();

        if (!ctype_digit($timestamp) || $signature === '') {
            return response()->json(['message' => 'Missing signature'], 401);
        }
        if (abs(time() - (int) $timestamp) > (int) config('services.kyc.webhook_tolerance', 300)) {
            return response()->json(['message' => 'Signature expired'], 401);
        }
        $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
        if (!hash_equals($expected, $signature)) {
            return response()->json(['message' => 'Invalid signature'], 401);
        }

        $payload = json_decode($rawBody, true);
        $event = $payload['event'] ?? null;
        $performer = $payload['data']['performer'] ?? null;
        $owner = $payload['data']['owner'] ?? [];
        if (!is_string($event) || !is_array($performer) || empty($performer['id'])) {
            return response()->json(['message' => 'Invalid payload'], 422);
        }

        $kycId = (int) $performer['id'];
        $occurredAt = Carbon::parse($payload['occurredAt'] ?? 'now')->setTimezone(config('app.timezone'));

        $existing = DB::table('kyc_performers')->where('kyc_performer_id', $kycId)->first();
        if ($existing && $existing->last_event_at && Carbon::parse($existing->last_event_at)->gt($occurredAt)) {
            // a newer event is already stored (retries can arrive out of order)
            return response()->json(['received' => true, 'ignored' => 'stale']);
        }

        $values = [
            'owner_email' => $owner['email'] ?? null,
            'owner_firebase_uid' => $owner['firebaseUid'] ?? null,
            'sharegram_user_id' => $owner['sharegramUserId'] ?? ($performer['sharegramUserId'] ?? null),
            'last_name' => $performer['lastName'] ?? null,
            'first_name' => $performer['firstName'] ?? null,
            'last_name_roman' => $performer['lastNameRoman'] ?? null,
            'first_name_roman' => $performer['firstNameRoman'] ?? null,
            'status' => $performer['status'] ?? 'pending',
            'kyc_status' => $performer['kycStatus'] ?? null,
            'documents' => json_encode($performer['documents'] ?? []),
            'last_event' => $event,
            'last_event_at' => $occurredAt->format('Y-m-d H:i:s.v'),
            'deleted_in_kyc_at' => $event === 'performer.deleted' ? now() : null,
            'updated_at' => now(),
        ];

        if ($existing) {
            DB::table('kyc_performers')->where('id', $existing->id)->update($values);
        } else {
            DB::table('kyc_performers')->insert($values + ['kyc_performer_id' => $kycId, 'created_at' => now()]);
        }

        Log::info('KYC webhook applied', ['event' => $event, 'kyc_performer_id' => $kycId]);
        return response()->json(['received' => true]);
    }
}
```

Then `php artisan migrate`.

### Showing them in Sharegram

The endpoint behind `/posts/new` must read the new table, e.g. for the logged-in creator:

```php
DB::table('kyc_performers')
    ->where('owner_email', $request->user()->email)
    ->whereNull('deleted_in_kyc_at')
    ->where('status', 'active')   // only performers whose ID was verified in KYC
    ->orderByDesc('id')
    ->get();
```

Drop the `status` filter if pending performers should be listed (e.g. greyed out).

## 4. Verify end to end

1. Start KYC backend → log shows `[env] Sharegram webhook: enabled → …`.
2. Create a performer in KYC (SSO from Sharegram → Add performer).
3. KYC log: `[sharegram-webhook] performer.created performer=3 → HTTP 200 (attempt 1)`.
4. Sharegram DB: `SELECT kyc_performer_id, owner_email, status, last_event FROM kyc_performers;`
5. Admin verifies agreement / ID front / selfie in KYC → `document.verified` ×3 and
   `performer.approved` (`status = active`).

Performers created **before** the webhook was enabled are not sent retroactively; any
later update/verification of them sends their full current state.

| KYC log | Meaning / fix |
| --- | --- |
| `disabled (KYC_WEBHOOK_URL is not set)` | `.env` not loaded or variable missing |
| `NOT SENDING: KYC_WEBHOOK_SECRET is not set` | add the secret; unsigned webhooks are never sent |
| `→ HTTP 401` | secrets differ between the two `.env` files, or clocks differ > 300 s |
| `→ HTTP 404` | URL/prefix wrong or route not added — `php artisan route:list --path=kyc` |
| `→ HTTP 419` | route is in `routes/web.php`; move it to `routes/api.php` |
| `→ HTTP 500` | see `storage/logs/laravel.log` (migration not run?) |
| `ECONNREFUSED` / `ENOTFOUND` | Sharegram API not running, or `api.local-og.com` missing from the hosts file |
