# Contributing

Keep changes focused and describe the problem, the resulting behavior and how it was tested. Open an issue before a substantial redesign or data-format change.

## Development

The integration is in `custom_components/ha_wartung`. The dashboard uses native Web Components and has no frontend build step. Pure domain logic lives in `engine.py`.

Run the Python and frontend regression suites:

```sh
python3 -m unittest discover -s tests -q
for testfile in tests/test_frontend_*.cjs; do node "$testfile"; done
node --check custom_components/ha_wartung/frontend/panel.js
```

Use a separate, disposable Home Assistant instance for integration tests and browser checks. Do not point tests at a household instance. GitHub Actions runs the release validation, Python and frontend checks, and the Home Assistant lifecycle tests configured in the workflow files.

Preserve the `ha_wartung` domain and existing storage compatibility. New settings need defaults that preserve existing installations. Avoid changing device, entity or helper identifiers automatically.

## Test data and reports

Use synthetic names, example identifiers and reserved example URLs. Do not commit real exports, `.storage`, authentication tokens, device photos or household screenshots. Tests should cover behavior rather than copy the implementation.

Check both a narrow phone layout and a desktop layout when changing the dashboard. Controls must work with keyboard navigation and touch; destructive changes need a clear confirmation.

## Releases

The tag, manifest version and runtime version must agree. Run HACS and hassfest checks without ignored validations before proposing catalog inclusion. Publish a full GitHub release rather than only a tag. See `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contribution is distributed under the repository's MIT license. Keep copyright and license notices for any third-party material.
