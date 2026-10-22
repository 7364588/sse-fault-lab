# Maintenance

Review concrete issues, pull requests, current-HEAD CI and dependency advisories.
Run the build, meaningful tests, loopback smoke and deterministic demo checks.
An audit with no actionable finding does not require a commit or release.

Preserve Node 22/24 support and the v1 fixture/report formats until a deliberate
compatibility decision. Validate installable tarballs when packaging or runtime
behavior changes. Keep synthetic examples and avoid collecting user traffic.

Release artifacts are built from the reviewed source revision. CI is evidence
for that revision, not a blanket guarantee of network or browser compatibility.
