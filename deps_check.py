#!/usr/bin/env python3
"""Check that every third-party import in this folder is declared and installed.

The build scripts run in two places: on the workstation, where every library
anyone has ever needed is already installed, and on a GitHub runner, where
nothing is installed but the standard library. That asymmetry is how a script
can import something for months on the workstation and fail on the runner the
first night it is used — which is exactly what happened when companion.py
began importing `markdown` at module level and the nightly refresh stopped
being able to write a sitemap.

So the dependency list is not a convention here, it is checked. This script
parses every .py file in the folder, works out which imported names are neither
standard library nor a module of this folder, and reports any that are missing
from requirements.txt or missing from the environment. validate.py calls it as
one of its checks, which means a missing dependency stops a publish before the
push rather than on the runner afterwards.

    python3 deps_check.py           # → the audit, non-zero on any problem
    python3 deps_check.py --quiet   # → only the verdict
"""

import argparse
import ast
import importlib.metadata
import importlib.util
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
REQUIREMENTS = ROOT / 'requirements.txt'

# Import names that do not match the distribution that provides them. The
# mapping is only needed for a distribution that is *not* installed, because
# importlib.metadata can answer for anything that is.
IMPORT_TO_DISTRIBUTION = {
    'PIL': 'pillow',
    'yaml': 'pyyaml',
    'bs4': 'beautifulsoup4',
    'dateutil': 'python-dateutil',
}


def normalise(name):
    """PEP 503 normalisation, so Markdown, markdown and MARKDOWN are one name."""
    return re.sub(r'[-_.]+', '-', name).strip().lower()


def declared():
    """The distributions pinned in requirements.txt, normalised."""
    if not REQUIREMENTS.exists():
        return {}
    pins = {}
    for line in REQUIREMENTS.read_text(encoding='utf-8').splitlines():
        line = line.split('#', 1)[0].strip()
        if not line or line.startswith('-'):
            continue
        name = re.split(r'[<>=!~\[;]', line, 1)[0].strip()
        if name:
            pins[normalise(name)] = line
    return pins


def imports():
    """Every third-party import name in the folder, mapped to the files using it.

    Imports inside a function body count: `import companion` and `from PIL
    import Image` are both written that way here, and a deferred import fails
    just as hard as a top-level one, only later and further from the cause.
    """
    local = {p.stem for p in ROOT.glob('*.py')}
    standard = set(sys.stdlib_module_names)
    found = {}
    for path in sorted(ROOT.glob('*.py')):
        try:
            tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
        except SyntaxError as err:
            raise SystemExit('deps_check: %s does not parse: %s' % (path.name, err))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name.split('.')[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names = [(node.module or '').split('.')[0]]
            else:
                continue
            for name in names:
                if name and name not in standard and name not in local:
                    found.setdefault(name, set()).add(path.name)
    return found


def distribution_for(module):
    """The distribution that provides an import name, normalised.

    Asks the installed metadata first, since that is authoritative and covers
    anything the static table does not know about, and falls back to the table
    and then to the import name itself.
    """
    try:
        mapping = importlib.metadata.packages_distributions()
    except Exception:
        mapping = {}
    if module in mapping and mapping[module]:
        return normalise(sorted(mapping[module])[0])
    return normalise(IMPORT_TO_DISTRIBUTION.get(module, module))


def installed(module):
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def audit():
    """Return a list of (module, files, problem) for everything that is wrong."""
    pins = declared()
    problems = []
    for module, files in sorted(imports().items()):
        dist = distribution_for(module)
        if dist not in pins:
            problems.append((module, files,
                             'imported by %s but not declared in requirements.txt '
                             '(add the distribution that provides it, likely "%s")'
                             % (', '.join(sorted(files)), dist)))
        elif not installed(module):
            problems.append((module, files,
                             'declared in requirements.txt as "%s" but not installed '
                             '(run: python3 -m pip install -r requirements.txt)'
                             % pins[dist]))
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--quiet', action='store_true',
                        help='print only the verdict')
    args = parser.parse_args()

    pins = declared()
    used = imports()
    problems = audit()

    if not args.quiet:
        print('deps_check: %d .py files, %d third-party imports, %d pinned'
              % (len(list(ROOT.glob('*.py'))), len(used), len(pins)))
        for module, files in sorted(used.items()):
            print('  %-12s %s' % (module, ', '.join(sorted(files))))
        unused = set(pins) - {distribution_for(m) for m in used}
        for dist in sorted(unused):
            print('  note: "%s" is pinned but nothing imports it' % pins[dist])
    for module, _files, problem in problems:
        print('  FAIL [%s] %s' % (module, problem))
    print('deps_check: %d problems' % len(problems))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
