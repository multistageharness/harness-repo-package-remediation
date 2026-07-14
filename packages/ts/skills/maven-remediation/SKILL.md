---
name: maven-remediation
description: Remediate vulnerable Java/Maven/Gradle dependencies by bumping a parent BOM or version property, or by pinning a transitive artifact through dependencyManagement.
---

# Java / Maven / Gradle remediation

For each vulnerable Java artifact (`groupId:artifactId`):

- **Root upgrade**: bump the parent BOM (e.g. `spring-boot-starter-parent`) or a
  managed version property in `pom.xml` so the whole managed set moves to the
  patched line.
- **Transitive pin**: add a `dependencyManagement` entry forcing the patched
  version of the vulnerable artifact, leaving the parent starter at its current
  version.
- Gradle: edit the declared version or add a constraint in
  `build.gradle` / `build.gradle.kts`; prefer the wrapper (`./gradlew`).

Available tools: `maven-version-bump`, `maven-dependency-pin`,
`gradle-version-bump`. Prefer `maven-version-bump` for root upgrades and
`maven-dependency-pin` for transitive pins.
