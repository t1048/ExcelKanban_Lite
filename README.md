Investigate the repository at D:\Document\repo\ExcelKanban_Lite to extract high-signal facts for an AGENTS.md file. Do NOT write any files. Return your findings as structured notes.

Read these sources in order of priority:
1. README.md, any root manifests (package.json, pyproject.toml, setup.py, setup.cfg, Makefile, etc.)
2. Build, test, lint, formatter, typecheck config
3. CI workflows (.github/workflows/), pre-commit config, task runner config
4. Existing instruction files (AGENTS.md, CLAUDE.md, .cursor/rules/, .cursorrules, .github/copilot-instructions.md)
5. Repo-local OpenCode config (opencode.json, .kilo/ config)
6. .gitattributes, .editorconfig, .gitignore

Then inspect a small number of representative code files to understand:
- Real entrypoints and package boundaries
- How the system is wired together
- Framework or toolchain quirks
- Testing setup and how to run tests
- Any code generation, migrations, or build artifacts

Return:
1. Exact developer commands (run, test, lint, format, typecheck, build) — especially non-obvious ones
2. Required command order if it matters
3. Monorepo/multi-package boundaries and directory ownership
4. Real app/library entrypoints
5. Framework or toolchain quirks
6. Repo-specific style or workflow conventions
7. Testing quirks (fixtures, prerequisites, flaky suites)
8. Important constraints from existing instruction files
9. Line ending / encoding conventions
10. Any other high-signal facts an agent would likely miss without help <environment_details>
Current time = 2026-05-21T19:54:38+09:00
Working directory: D:\Document\repo\ExcelKanban_Lite