# GitHub Actions

This repo has three workflows:

- `CI`: runs on pushes to `main` and pull requests.
- `Publish npm Package`: publishes the `checklist-ledger` CLI package.
- `Deploy Cloudflare Worker`: applies D1 migrations and deploys the hosted app.

## Required Secrets

Create these in GitHub under repository settings:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

### npm publish

`NPM_TOKEN`

Use an npm automation token for the `checklist-ledger` package. Automation
tokens are the right fit for CI publishing because normal interactive publish
can require a one-time password.

### Cloudflare deploy

`CLOUDFLARE_API_TOKEN`

Token needs permission to deploy Workers and apply D1 migrations for the account
that owns:

```text
checklist-ledger / 4094cd40-9c59-4434-915e-dd95cd63ab54
```

`CLOUDFLARE_ACCOUNT_ID`

Current account ID:

```text
d1b7434a57ef02507a45e4f50b746827
```

The Worker secret `ADMIN_TOKEN` is not set by the workflow. It is already stored
in Cloudflare for the deployed Worker, and should only be rotated intentionally.

## Release Flow

1. Update the package version:

   ```powershell
   npm version patch
   ```

2. Push the commit and tag:

   ```powershell
   git push origin main
   git push origin --tags
   ```

3. The `Publish npm Package` workflow publishes the tagged version to npm.

To publish manually from GitHub, run the workflow with `workflow_dispatch` after
the version in `package.json` has been bumped to an unpublished version.

## Deploy Flow

Every push to `main` that changes app, Worker, migration, or deploy config files
runs the Cloudflare deploy workflow.

The deploy job does this in order:

```text
npm ci
npm run check
npm test
npm run db:migrate:remote
npm run deploy
```

Use the manual `workflow_dispatch` button when you need to redeploy without a
source change.

## Notes

CI uses `npm pack --dry-run` instead of `npm publish --dry-run` because npm
publish dry-runs can fail once the current package version already exists in
the registry. The publish workflow is the only workflow that calls
`npm publish`.
