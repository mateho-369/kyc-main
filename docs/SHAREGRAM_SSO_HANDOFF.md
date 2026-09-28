
## Firebase account and Sharegram owner claims
The Firebase ID token must identify a Firebase account with an email address. Custom-auth tokens may omit the email claim; KYC looks up the Firebase Auth user record by UID and returns `422 FIREBASE_EMAIL_REQUIRED` if no email is available.

To create performers under the correct Sharegram account, Sharegram must also include the canonical Sharegram account ID (the same value its performer picker sends as `user_id`, e.g. the API `account_id`) in a Firebase-signed custom claim named `sharegramUserId`. KYC trusts this only after Firebase verifies the ID token, then persists it on the KYC user row. It does not infer the Sharegram ID from email, Firebase UID, or request-body data. Without the claim, KYC returns `409 SHAREGRAM_ACCOUNT_ID_REQUIRED` rather than create an unscopable performer. If that claim is already associated with a different KYC user, KYC rejects it with `409 FIREBASE_SHAREGRAM_UID_CONFLICT`.

## Mandatory performer list ownership scope
Sharegram must send `GET /api/performers?user_id=<Firebase uid>` or `GET /api/sharegram/performers?user_id=<Sharegram account id>`. Omitting the scope is now an error by design: the API returns HTTP 400 and never exposes a global list. `external_ids` can be used as an explicit scope on `/api/sharegram/performers`.
