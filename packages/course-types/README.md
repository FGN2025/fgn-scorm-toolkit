# @fgn/course-types

Shared TypeScript types for the FGN SCORM toolkit. The `CourseManifest` type ties together four packages:

| Package | Role |
|---|---|
| `@fgn/scorm-builder.transform()` | Produces `CourseManifest` from play.fgn.gg challenges |
| `@fgn/scorm-builder.package()` | Consumes `CourseManifest`, emits SCORM 1.2 ZIP |
| `@fgn/academy-publisher` | Consumes `CourseManifest`, writes fgn.academy native rows |
| `@fgn/scorm-player` | Consumes `CourseManifest` at runtime (loaded from `course.json`) |

Keeping the shape in one package keeps the contract honest and makes schema migrations a single-file change. Bump `CourseManifest.schemaVersion` whenever the shape changes — the Player rejects unsupported versions explicitly.

## Build

```bash
pnpm --filter @fgn/course-types build
```

## Versioning

`schemaVersion` is for the `course.json` runtime contract — bump for any change consumers must adapt to. Package version is for tooling lifecycle.
