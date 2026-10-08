# UniWork Office — license & device entitlement

Commercial model: **account-bound license**, not a per-machine serial key.  
Companion to `UNIWORK_PLANS.md`.

## Client flow

```
Install Office
  → ensure deviceId (stable on this install)
  → user signs in
  → GET /api/license/entitlements  (Bearer user)
  → cache signed entitlement locally
  → refresh every 24–72h when online
  → offline: local edit allowed through graceUntil
```

## Entitlement payload (server → client)

```json
{
  "version": 1,
  "planId": "personal",
  "status": "active",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "graceUntil": "2027-01-08T00:00:00.000Z",
  "maxDevices": 2,
  "bridge": true,
  "tokensMonth": 50000,
  "devices": [
    {
      "deviceId": "dev_…",
      "label": "MacBook Pro",
      "platform": "darwin",
      "lastSeenAt": "2026-10-04T05:00:00.000Z",
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "refreshedAt": "2026-10-04T05:00:00.000Z",
  "source": "server"
}
```

| Field | Meaning |
| --- | --- |
| `planId` | `free` \| `personal` \| `pro` \| `team` |
| `status` | `active` \| `grace` \| `expired` \| `none` |
| `maxDevices` | Concurrent signed-in installs allowed |
| `bridge` | May create Office Bridge cloud sessions |
| `graceUntil` | After expiry, local edit still OK until this time; Bridge/AI denied |

## Device APIs (future server)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/license/entitlements` | Current plan + device list |
| POST | `/api/license/devices/register` | `{ deviceId, label, platform }` — may 409 if over limit |
| DELETE | `/api/license/devices/:deviceId` | Revoke a device (user or admin) |

## Client enforcement (desktop)

| Capability | Rule |
| --- | --- |
| Open/edit local files | Always (even expired → Free capabilities) |
| `uniwork://office/app` | Always |
| Office Bridge save/open cloud | `bridge && status ∈ {active, grace?}` — **deny in grace** for save; open may be read-only later |
| AI Token Hub | Quota from entitlement / separate meter |
| Over device limit | Block new register; show “Devices” UI to revoke |

## Local cache keys (renderer MVP)

- `uniwork.license.deviceId` — stable install id  
- `uniwork.license.entitlement` — cached payload (`source: local|server`, optional `simulated`)

## UI

Settings → **Account**: plan summary + **Devices signed in** (this device highlighted; revoke others; DEV simulate plan).
