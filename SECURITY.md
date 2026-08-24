# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: [Security > Report a
vulnerability](https://github.com/only-cli/oc/security/advisories/new).
Please do not open a public issue for anything exploitable.

Expect an acknowledgement within a week. Fixes ship as a patch release,
and the advisory is published once the fix is out.

## Scope

oc fetches untrusted web pages by design, so the interesting bugs are the
ones where page content escapes its role as data: rendered text that can
alter what an agent executes, URLs that reach private or internal hosts
despite the SSRF guard, or a crafted page that breaks the distiller. Bugs
in the experiments/ directory are out of scope; nothing there ships in
the package.

## Supported versions

Only the latest release on npm is supported. There is no backporting; a
security fix means a new release.
