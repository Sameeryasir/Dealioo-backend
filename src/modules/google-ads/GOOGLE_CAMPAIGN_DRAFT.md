# Google Campaign Draft — Production Save System

PostgreSQL is the source of truth. On wizard open the client loads the draft **once** (`GET .../drafts/:draftId`), keeps the full `draft_data` in React memory, and navigates Back/Next without re-fetching. localStorage is recovery only. Step fingerprints live in a React ref. Each step has its own POST save endpoint (called only when the fingerprint changed).

---

## Production upgrades

### Optimistic concurrency (`version`)

Every update (except first create) must send:

```json
{
  "draftId": "...",
  "expectedVersion": 7
}
```

Backend updates with:

```sql
UPDATE google_campaign_drafts
SET version = version + 1, ...
WHERE id = :draftId AND version = :expectedVersion;
```

If no row updates → **HTTP 409** with:

`This draft has been modified elsewhere. Please refresh.`

Successful responses always return the new `version`.

### Transactional step saves

Each step save runs inside a TypeORM transaction and updates together:

- `draft_data`
- `current_step`
- `completed_steps` (server-owned)
- `version`
- `last_saved_at`
- indexed fields (`campaign_name`, `daily_budget`, etc.)
- `updated_by`

Failure rolls back the whole save.

### `completed_steps`

Frontend never sends `completed_steps`. Backend appends the completed step number after validation + save.

### Draft statuses

| Status | Meaning |
|--------|---------|
| `DRAFT` | Editable |
| `VALIDATING` | Pre-publish validation |
| `PUBLISHING` | Job queued / in progress |
| `PUBLISHED` | Live (blocks edits) |
| `FAILED` | Editable again |
| `ARCHIVED` | Not editable |

### Publish flow (stub queue)

`POST /drafts/publish`

1. Load draft  
2. Validate **all steps** (does not trust `completed_steps`)  
3. Transaction: `VALIDATING` → `PUBLISHING` + stub `publishJobId`  
4. Real Google Ads create is **not wired yet**  

### Client navigation (in-session)

| Action | Network |
|--------|---------|
| Open wizard | Paint localStorage instantly → background `GET` reconciles `formData` / step / version / fingerprints |
| Back | In-memory only (`currentStep--`) |
| Next (unchanged fingerprint) | In-memory only |
| Next (changed) | Step POST save → update memory + version + fingerprint |
| Close | Best-effort `PUT .../progress` (bookmark step for resume) |

### Progress saves

Primary persistence is **step POST** on Next when data changed.

`PUT .../progress` is best-effort on wizard close (resume bookmark), not on every Back/Next.

### Fingerprints

Normalized before compare:

- trim strings  
- sort object keys  
- sort primitive arrays  
- `undefined` → `null`  

Skips API when Back → Next with no real changes.

### localStorage (lightweight)

Stores only:

- `draftId`
- `serverVersion`
- temporary recovery backup
- timestamp  

Never stores OAuth/tokens. If local is newer than server → “Restore unsaved local changes?”

### Duplicate save protection

- UI disables Next/Back/Close while saving  
- `Idempotency-Key` header on save/progress requests  
- Backend can return cached response for the same key  

### Audit

- `created_by` / `created_at`
- `updated_by` / `updated_at`

---

## APIs

Base: `/api/google-ads/business/:businessId/drafts`

| Method | Path |
|--------|------|
| POST | `/goal-step` |
| POST | `/goal-details-step` |
| POST | `/campaign-info-step` |
| POST | `/budget-step` |
| POST | `/locations-step` |
| POST | `/languages-step` |
| POST | `/audience-step` |
| POST | `/keywords-step` |
| POST | `/ads-step` |
| POST | `/extras-step` |
| POST | `/publish` |
| GET | `/:draftId` |
| PUT | `/:draftId/progress` |

Header (recommended): `Idempotency-Key: <uuid>`

---

## Key files

| Area | Path |
|------|------|
| Entity | `src/db/entities/google-campaign-draft.entity.ts` |
| Migration | `src/db/migrations/1779920000000-HardenGoogleCampaignDrafts.ts` |
| Service | `src/modules/google-ads/google-campaign-draft.service.ts` |
| Validation | `src/modules/google-ads/google-campaign-draft-validation.ts` |
| Constants | `src/modules/google-ads/google-campaign-draft.constants.ts` |
| Wizard | `retention-frontend/.../CampaignBuilderWizard.tsx` |
| Fingerprints | `retention-frontend/.../step-snapshots.ts` |
| Local storage | `retention-frontend/.../draft-storage.ts` |
| FE API | `retention-frontend/app/services/google-ads/google-campaign-draft.ts` |

---

## Not wired yet

- Real Google Ads mutate/create pipeline after `PUBLISHING`
- Multi-draft picker UI
