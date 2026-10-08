# UniWork — VietQR payment (NAPAS 247)

Desktop Settings → **Account** hosts:

1. **Receiving account** (merchant STK UniWork) — bank BIN + account number + account name  
2. **Checkout** — plan + month/year → dynamic VietQR with amount + transfer content = order id  
3. **Orders** — local pending / submitted / confirmed (server reconciliation later)

## Payload

Built in `apps/shell/src/renderer/src/vietqr.ts`:

- GUID `A000000727`, service `QRIBFTTA`  
- Currency `704` (VND), country `VN`  
- Dynamic (`01`=`12`) when amount is set  
- Field `62.08` = order id (ASCII, max 25)  
- CRC-16/CCITT-FALSE on `…6304`

## Production checklist

1. Set real UniWork receiving STK in Settings (persisted `uniwork.payment.account`).  
2. Host webhook / admin to match bank statement content `UW…` → activate entitlement.  
3. Replace DEV “Confirm & activate” with server-signed entitlement push.  
4. Do not put payment secrets in deep links or git.

## Related

- Plans: `UNIWORK_PLANS.md`  
- License devices: `LICENSE_ENTITLEMENTS.md`  
