"""Prevent private configuration and live source links from entering a release."""
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'custom_components' / 'ha_wartung'
TEXT_SUFFIXES = {'.py', '.cjs', '.js', '.json', '.md', '.yaml', '.yml', '.txt'}
EXAMPLE_NOTE_ID = '00000000-0000-4000-8000-000000000001'


def public_text_files():
    """Only source content; local environments and Git objects are not release files."""
    for folder in (PACKAGE, ROOT / 'tests', ROOT / 'scripts', ROOT / 'docs', ROOT / '.github'):
        if not folder.exists():
            continue
        for path in folder.rglob('*'):
            if (path.is_file() and path.suffix in TEXT_SUFFIXES
                    and not any(part in {'__pycache__', '.venv', '.pytest_cache'} for part in path.parts)):
                yield path
    for path in ROOT.iterdir():
        if path.is_file() and (path.suffix in TEXT_SUFFIXES or path.name == 'LICENSE'):
            yield path


class ReleasePrivacy(unittest.TestCase):
    def test_initial_directory_contains_no_household_records(self):
        seed = json.loads((PACKAGE / 'seed.json').read_text())
        self.assertEqual(seed, {'records': [], 'review': []})

    def test_shared_note_links_use_explicitly_fictitious_identifiers(self):
        shared_note = re.compile(r'https?://share\.evernote\.com/note/([0-9a-fA-F-]{36})')
        failures = []
        for path in public_text_files():
            if any(identity != EXAMPLE_NOTE_ID for identity in shared_note.findall(path.read_text())):
                failures.append(str(path.relative_to(ROOT)))
        self.assertEqual(failures, [], 'Use the documented dummy ID for shared-note fixtures.')

    def test_no_private_user_home_paths_are_published(self):
        home_path = re.compile('/' + r'Users/[a-zA-Z0-9_. -]+/')
        failures = [str(path.relative_to(ROOT)) for path in public_text_files()
                    if home_path.search(path.read_text())]
        self.assertEqual(failures, [], 'Use repository-relative paths in release content.')

    def test_no_recognizable_private_keys_or_access_tokens_are_published(self):
        secret = re.compile(r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----'
                            r'|gh[pousr]_[a-zA-Z0-9_]{30,}'
                            r'|github_pat_[a-zA-Z0-9_]{30,}'
                            r'|Bearer [a-zA-Z0-9_.-]{40,}')
        failures = [str(path.relative_to(ROOT)) for path in public_text_files()
                    if secret.search(path.read_text())]
        self.assertEqual(failures, [], 'Release source must not contain credentials.')

    def test_integration_does_not_bundle_runtime_storage_or_exports(self):
        private_parts = {'.storage', 'exports', 'backups', 'ha_wartung_images'}
        private_names = {'secrets.yaml', '.env', 'home-assistant.log'}
        failures = [str(path.relative_to(ROOT)) for path in PACKAGE.rglob('*')
                    if any(part in private_parts for part in path.relative_to(PACKAGE).parts)
                    or path.name in private_names]
        self.assertEqual(failures, [], 'Runtime user data belongs outside the integration package.')


if __name__ == '__main__':
    unittest.main()
