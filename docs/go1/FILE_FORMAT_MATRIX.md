# GO-1 file format matrix

Evidence: shell file associations (`apps/shell/electron-builder.cjs`), unsupported regex in `apps/shell/src/main/index.ts` (`UNSUPPORTED_DOC_RE`), and upstream README engine descriptions. Smoke results for round-trip are recorded in `GO1_ACCEPTANCE_REPORT.md`.

| Format | OPEN | EDIT | SAVE | EXPORT | VIEW_ONLY | UNSUPPORTED |
| --- | --- | --- | --- | --- | --- | --- |
| DOCX | OPEN | EDIT | SAVE | EXPORT (to PDF via app) | | |
| XLSX | OPEN | EDIT | SAVE | | | |
| XLSM | OPEN (association) | REVIEW_REQUIRED | REVIEW_REQUIRED | | | macros are not a UniWork claim |
| PPTX | OPEN | EDIT | SAVE | | | |
| PDF | OPEN | EDIT (in-place text/annot where supported) | SAVE | EXPORT to DOCX/XLSX/PPTX (on-device converter) | | |
| XLS | OPEN (association) | REVIEW_REQUIRED | | | | legacy binary; association exists, fidelity not GO-1-certified |
| CSV | OPEN (association) | EDIT (Sheets) | | | | |
| MD | OPEN | EDIT | SAVE | | | |
| HTML / HTM | OPEN | EDIT | SAVE | EXPORT as Word | | |
| TXT | | | | | | UNSUPPORTED as a first-class app type (may attach for AI parse) |
| DOC | | | | | | UNSUPPORTED (`UNSUPPORTED_DOC_RE`) |
| PPT / PPS | | | | | | UNSUPPORTED |
| ODT / ODS / ODP | | | | | | UNSUPPORTED |
| RTF | | | | | | UNSUPPORTED |
| XLSB | | | | | | UNSUPPORTED |
| Apple iWork (pages/key/numbers) | | | | | | UNSUPPORTED |

Byte-preserving round trip for DOCX/XLSX/PPTX is an upstream engine property. GO-1 did not change those engines.
