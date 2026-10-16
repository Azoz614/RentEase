# Admin setup

1. Create a normal RentEase account using the email address you want to use as the administrator.
2. In `server/.env`, set `ADMIN_EMAIL` to that exact email address. Keep the existing `OTP_SECRET` configured (it is used to sign login sessions when `SESSION_SECRET` is not set). For a separate session key, set a long random `SESSION_SECRET`.
3. Restart the server and sign in with that account. After the password is checked, the server grants the configured account the `admin` role.

Only the account whose email matches `ADMIN_EMAIL` is elevated automatically. Do not expose the admin address or either secret in client code. Product records are stored in MongoDB; uploaded image files live in `server/uploads/products`. Back up that uploads folder along with the database.
