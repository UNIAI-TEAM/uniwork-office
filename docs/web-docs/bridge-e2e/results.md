# Docs web e2e results (headless Chromium, last run)

Rerun: `npm run build:web && E2E_SHOTS=docs/web-docs/bridge-e2e npx playwright test -c web/e2e` (starts web/server itself).
GO-B3: the editor runs in an iframe inside the protocol test host (web/server/test-host); open and save go through the frame protocol.
The marker string is random per run, so saved byte sizes vary by a few bytes between runs.

| doc | step | result | ms | detail |
|---|---|---|---|---|
| simple | open | PASS | 2600 | text visible in 2600ms; fully loaded (3 blocks, editable) after 1356ms; tables=0 |
| simple | editable | PASS | 132 |  |
| simple | type-marker | PASS | 1182 | 4 blocks; last: docHeading:"标题" / docParagraph:"第一段。" / docParagraph:"第二段。" / docParagraph:"E2EMARKSIMPLEMUZODYLV" sel=38-38 hasMarker=true |
| simple | bold | PASS | 246 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| simple | insert-table | PASS | 1046 | tables 0 -> 1 |
| simple | save | PASS | 403 | 2373 bytes |
| simple | saved-xml | PASS | 11 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKSIMPLEMUZODYLV</w:t></w:r> \| w:tbl=1 |
| simple | reopen | PASS | 1372 | marker bold={"inStrong":true,"weight":"700"}; tables 0 -> 1 |
| simple | host-events | PASS | 28 | events: ready,title,dirty,saved; dirty false>true>false; saved {"fileId":"f1","name":"simple.docx","versionId":"v2","etag":"\"f1-v2\"","sizeBytes":2373} |
| simple | save-conflict | PASS | 2243 | stale etag refused (412 conflict), editor stays dirty |
| kitchen-sink | open | PASS | 2517 | text visible in 2517ms; fully loaded (11 blocks, editable) after 1237ms; tables=1 |
| kitchen-sink | editable | PASS | 95 |  |
| kitchen-sink | type-marker | PASS | 1199 | 12 blocks; last: docProtected:"" / docProtected:"" / docParagraph:"尾段。" / docParagraph:"E2EMARKKITCHENSINKMUZOE5UE" sel=148-148 hasMarker=true |
| kitchen-sink | bold | PASS | 126 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| kitchen-sink | insert-table | PASS | 998 | tables 1 -> 2 |
| kitchen-sink | save | PASS | 427 | 3611 bytes |
| kitchen-sink | saved-xml | PASS | 4 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKKITCHENSINKMUZOE5UE</w:t></w:r> \| w:tbl=2 |
| kitchen-sink | reopen | PASS | 1113 | marker bold={"inStrong":true,"weight":"700"}; tables 1 -> 2 |
| kitchen-sink | host-events | PASS | 20 | events: ready,title,dirty,saved; dirty false>true>false; saved {"fileId":"f1","name":"kitchen-sink.docx","versionId":"v2","etag":"\"f1-v2\"","sizeBytes":3611} |
| kitchen-sink | save-conflict | PASS | 2246 | stale etag refused (412 conflict), editor stays dirty |
| long | open | PASS | 2641 | text visible in 2641ms; fully loaded (460 blocks, editable) after 1224ms; tables=5 |
| long | editable | PASS | 139 |  |
| long | type-marker | PASS | 1183 | 461 blocks; last: docParagraph:"Lorem ipsum dolor sit amet, co" / docTable:"T5 R1C1T5 R1C2T5 R1C3T5 R2C1T5" / docParagraph:"" / docParagraph:"E2EMARKLONGMUZOECNV" sel=139259-139259 hasMarker=true |
| long | bold | PASS | 207 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| long | insert-table | PASS | 1013 | tables 5 -> 6 |
| long | save | PASS | 629 | 4843 bytes |
| long | saved-xml | PASS | 13 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKLONGMUZOECNV</w:t></w:r> \| w:tbl=6 |
| long | reopen | PASS | 2096 | marker bold={"inStrong":true,"weight":"700"}; tables 5 -> 6 |
| long | host-events | PASS | 37 | events: ready,title,dirty,saved; dirty true>false; saved {"fileId":"f1","name":"long.docx","versionId":"v2","etag":"\"f1-v2\"","sizeBytes":4843} |
| long | save-conflict | PASS | 2334 | stale etag refused (412 conflict), editor stays dirty |
