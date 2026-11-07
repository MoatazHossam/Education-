# Word guides for a handover package

Two Word files for whoever installs a package of Midad on one Ubuntu server and opens it to schools for a free
pilot, with student accounts and payment turned off:

| File | Language |
| --- | --- |
| [Midad-Deployment-Guide-AR.docx](Midad-Deployment-Guide-AR.docx) | Arabic (right to left), button names as in the Arabic interface |
| [Midad-Deployment-Guide-EN.docx](Midad-Deployment-Guide-EN.docx) | English, button names as in the English interface |

Both say the same thing: what was tested and the conditions for the pilot (above all, no real students' data before
a legal review), the server, Docker, the settings file, the first start, the platform admin, giving schools a plan
with no end date and student accounts, backups, daily operation, upgrades, troubleshooting and a checklist. They
are a short path through [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) (Arabic:
[DEPLOYMENT_GUIDE.ar.md](../DEPLOYMENT_GUIDE.ar.md)), which stays the full reference.

The files in this folder are built for package `midad-4d92a28.zip`. Their steps were run on that package on
2026-11-07, in the Arabic interface and then in the English one ([TEST_REPORT.md](../TEST_REPORT.md), "Handover
package and its deployment guides").

## Making a package

From a clean checkout of the commit to hand over:

```bash
git archive --format=zip --prefix=midad/ -o midad-$(git rev-parse --short HEAD).zip HEAD
```

The package holds only files committed to the repository: no settings file, no secrets.

## Rebuilding the guides

After a change to the commands, the settings, the ops scripts or the interface labels the guides name, update
`scripts/deployment-guide/guide-ar.mjs` and `guide-en.mjs` together (the settings commands are in `settings.sh`,
shown word for word in both), then:

```bash
npm i --no-save docx@9.7.1
node scripts/deployment-guide/build.mjs ar <version> docs/deployment/Midad-Deployment-Guide-AR.docx
node scripts/deployment-guide/build.mjs en <version> docs/deployment/Midad-Deployment-Guide-EN.docx
```

`<version>` is the package's short commit. A guide built for a package other than the one last tested says so in its
section 1; after running the steps again on the new package, update `TESTED` and `TESTED_ON` in `build.mjs`.
