# W7 Playwright results (headless Chromium, last run)

Rerun: `npx playwright test -c web/e2e && node web/e2e/make-results-md.mjs` (starts web/server on :4181 itself; needs web/docs/dist built).
The marker string is random per run, so saved byte sizes vary by a few bytes between runs.

| doc | step | result | ms | detail |
|---|---|---|---|---|
| simple | open | PASS | 1924 | text visible in 1924ms; fully loaded (3 blocks, editable) after 1241ms; tables=0 |
| simple | editable | PASS | 53 |  |
| simple | type-marker | PASS | 978 | 4 blocks; last: docHeading:"标题" / docParagraph:"第一段。" / docParagraph:"第二段。" / docParagraph:"E2EMARKSIMPLEMUZLK661" sel=38-38 hasMarker=true |
| simple | bold | PASS | 217 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| simple | insert-table | PASS | 785 | tables 0 -> 1 |
| simple | save | PASS | 181 | 2373 bytes |
| simple | saved-xml | PASS | 10 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKSIMPLEMUZLK661</w:t></w:r> \| w:tbl=1 |
| simple | reopen | PASS | 896 | marker bold={"inStrong":true,"weight":"700"}; tables 0 -> 1 |
| kitchen-sink | open | PASS | 2047 | text visible in 2047ms; fully loaded (11 blocks, editable) after 1238ms; tables=1 |
| kitchen-sink | editable | PASS | 86 |  |
| kitchen-sink | type-marker | PASS | 1114 | 12 blocks; last: docProtected:"" / docProtected:"" / docParagraph:"尾段。" / docParagraph:"E2EMARKKITCHENSINKMUZLKA4H" sel=148-148 hasMarker=true |
| kitchen-sink | bold | PASS | 119 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| kitchen-sink | insert-table | PASS | 904 | tables 1 -> 2 |
| kitchen-sink | save | PASS | 217 | 3610 bytes |
| kitchen-sink | saved-xml | PASS | 5 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKKITCHENSINKMUZLKA4H</w:t></w:r> \| w:tbl=2 |
| kitchen-sink | reopen | PASS | 934 | marker bold={"inStrong":true,"weight":"700"}; tables 1 -> 2 |
| long | open | PASS | 2370 | text visible in 2370ms; fully loaded (460 blocks, editable) after 1218ms; tables=5 |
| long | editable | PASS | 56 |  |
| long | type-marker | PASS | 1253 | 461 blocks; last: docParagraph:"Lorem ipsum dolor sit amet, co" / docTable:"T5 R1C1T5 R1C2T5 R1C3T5 R2C1T5" / docParagraph:"" / docParagraph:"E2EMARKLONGMUZLKED0" sel=139259-139259 hasMarker=true |
| long | bold | PASS | 149 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| long | insert-table | PASS | 829 | tables 5 -> 6 |
| long | save | PASS | 377 | 4845 bytes |
| long | saved-xml | PASS | 14 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKLONGMUZLKED0</w:t></w:r> \| w:tbl=6 |
| long | reopen | PASS | 1586 | marker bold={"inStrong":true,"weight":"700"}; tables 5 -> 6 |
