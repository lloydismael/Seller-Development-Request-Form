# Independent API package procedure (not a publish script)

This document authorizes nothing. Packaging is local artifact generation; publish, provisioning, linking and secrets each remain behind their respective approval gates.

1. Confirm `api/package-lock.json` exists and matches `api/package.json`; stop if absent. Do not generate a lockfile or change application code as a packaging workaround.
	Before staging, run `npm run build` from `api/` in the full repository. This generates ignored
	`api/src/form-assets/form-config.js` and `form-schema.js` from canonical `app/` sources.
	Verify the copies match those sources and rebuild after any shared asset change. The API-only
	package cannot regenerate them: it contains neither `app/` nor `scripts/`. Azure's remote build
	runs `npm run build`; in an API-only package this validates the prebuilt assets and fails if
	either is missing or cannot load. In the full repository the same command regenerates them.
2. Resolve the active-session pointer. Use a fresh staging directory **inside that ignored active session only**; never overwrite prior packages or source. Reject reparse points/symlinks in `api/`, every source ancestor, every copied file/directory and the destination.
3. Copy only `host.json`, `package.json`, `package-lock.json`, and the complete `src/` tree from `api/`. Review `src/` locally for unexpected backups/secrets before copying; a directory allowlist is not a secret scanner.
4. Do not include `local.settings*`, `.env*`, `.migration/`, `.data/`, `scripts/`, `test/`, `node_modules/`, frontend, infrastructure or session files. Do not archive all of `api/` or the repository. No local dependency install is needed for this source-only remote-build package, but the shared-assets build in step 1 is mandatory. Include its generated copies within `src/`; stop if either is missing. Coordinate matching frontend/backend releases for shared schema and transport changes; packaging does not publish a form or overwrite stored draft/published settings.
5. Create ZIP entries from that explicit inventory using forward slashes, no absolute paths, `..`, duplicate/case-colliding names, backslashes or parent folder prefix. `host.json` must be at ZIP root. Re-open the ZIP and compare its exact entry set and uncompressed file hashes with the inventory. Stop on any mismatch.
6. Record only relative entry names, file count, SHA256 and package byte size in the ignored session. Never display file contents, credentials or personal data. Close streams in `finally`; preserve prior artifacts on failure.
7. Only after separate publish approval use the documented Node22 Flex OneDeploy/remote-build channel. No publishing credentials/key retrieval, SCM toggles or code upload occurs during preflight/packaging. Keep frontend `api_location` empty and backend source separate.

See [Functions deployment technologies](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies) and the private deployment checklist. No package was created or uploaded by the artifact-fix task.