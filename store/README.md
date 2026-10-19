# Store assets

Listing artwork for app stores. Kept here, not in `public/`, so it is not shipped inside the app.

| Folder | Used by |
|---|---|
| `zapstore/` | Zapstore listing posters, in listing order (`zapstore.yaml` → `images`) |
| `alby-hub/` | Alby Hub app store listing: the 200 px logo, the entry for `SuggestedAppData.tsx` and the pull request text for getAlby/hub. Sent after a release (`docs/APP_UPDATES.md`, step 4; issue #389) |
| `screens/` | Raw app screens of v1.11.0, source material for posters and the GitHub README |
| `playstore/` | Play Store listing artwork |
| `app-icon/` | Owl app-icon artwork (1024 and 500 px) |

The icon the app itself uses lives in `public/` (`zapstore.yaml` → `icon`).
