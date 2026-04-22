# How to file a bug report that gets resolved

Before filing, make sure you are testing against the latest relevant Treegress package version and check for duplicate issues.

## Use the issue template

When opening a bug:

- fill all required fields
- provide exact reproduction steps
- include expected vs actual behavior
- include environment details (OS, Node version, package versions)

## Keep repro minimal

Reduce the problem to the smallest reproducible case:

- start from a clean project
- include only code and data needed to reproduce
- avoid unrelated dependencies

## Why this matters

- most unresolved reports are not reproducible
- maintainers cannot debug private full-scale projects
- reproducible bugs are fixed much faster

## Useful references

- [Minimal Reproducible Example](https://stackoverflow.com/help/minimal-reproducible-example)
- [Playwright Debug Guide](https://playwright.dev/docs/debug)

## Bottom line

Minimal public repro + clear steps = fastest path to a fix.
