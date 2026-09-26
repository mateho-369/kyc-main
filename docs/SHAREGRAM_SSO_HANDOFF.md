
## Firebase account profile requirement
The Firebase ID token must identify a Firebase account with an email address. Custom-auth tokens may omit the email claim; KYC now looks up the Firebase Auth user record by UID, and returns `422 FIREBASE_EMAIL_REQUIRED` rather than creating a fabricated/incomplete KYC user if no email is available. Ensure the Sharegram Firebase user record has its email populated before opening the KYC SSO URL.

## Mandatory performer list ownership scope
Sharegram must send `GET /api/performers?user_id=<Firebase uid>` or `GET /api/sharegram/performers?user_id=<Sharegram account id>`. Omitting the scope is now an error by design: the API returns HTTP 400 and never exposes a global list. `external_ids` can be used as an explicit scope on `/api/sharegram/performers`.
