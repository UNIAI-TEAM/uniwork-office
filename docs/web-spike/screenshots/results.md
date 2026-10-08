# W7 Playwright results (headless Chromium, last run)

Rerun: `npx playwright test -c web/e2e` (starts web/server on :4181 itself; needs web/docs/dist built)

| doc | step | result | ms | detail |
|---|---|---|---|---|
| simple | open | PASS | 1939 | text visible in 1939ms; fully loaded (3 blocks, editable) after 1250ms; tables=0 |
| simple | editable | PASS | 57 |  |
| simple | type-marker | PASS | 991 | 4 blocks; last: docHeading:"标题" / docParagraph:"第一段。" / docParagraph:"第二段。" / docParagraph:"E2EMARKSIMPLEMUZL9NO7" sel=38-38 hasMarker=true |
| simple | bold | PASS | 219 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| simple | insert-table | PASS | 921 | tables 0 -> 1 |
| simple | save | PASS | 209 | 2373 bytes |
| simple | saved-xml | PASS | 10 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKSIMPLEMUZL9NO7</w:t></w:r> / w:tbl=1 |
| simple | reopen | PASS | 877 | marker bold={"inStrong":true,"weight":"700"}; tables 0 -> 1 |
| kitchen-sink | open | PASS | 1977 | text visible in 1977ms; fully loaded (11 blocks, editable) after 1243ms; tables=1 |
| kitchen-sink | editable | PASS | 72 |  |
| kitchen-sink | type-marker | PASS | 1111 | 12 blocks; last: docProtected:"" / docProtected:"" / docParagraph:"尾段。" / docParagraph:"E2EMARKKITCHENSINKMUZL9RRC" sel=148-148 hasMarker=true |
| kitchen-sink | bold | PASS | 103 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| kitchen-sink | insert-table | PASS | 900 | tables 1 -> 2 |
| kitchen-sink | save | PASS | 209 | 3611 bytes |
| kitchen-sink | saved-xml | PASS | 4 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKKITCHENSINKMUZL9RRC</w:t></w:r> / w:tbl=2 |
| kitchen-sink | reopen | PASS | 915 | marker bold={"inStrong":true,"weight":"700"}; tables 1 -> 2 |
| long | open | PASS | 2768 | text visible in 2768ms; fully loaded (460 blocks, editable) after 1219ms; tables=5 |
| long | editable | PASS | 57 |  |
| long | type-marker | PASS | 1119 | 461 blocks; last: docParagraph:"Lorem ipsum dolor sit amet, co" / docTable:"T5 R1C1T5 R1C2T5 R1C3T5 R2C1T5" / docParagraph:"" / docParagraph:"E2EMARKLONGMUZL9VW4" sel=139259-139259 hasMarker=true |
| long | bold | PASS | 151 | Ctrl+B: {"inStrong":true,"weight":"700","tag":"STRONG"} |
| long | insert-table | PASS | 967 | tables 5 -> 6 |
| long | save | PASS | 394 | 4846 bytes |
| long | saved-xml | PASS | 11 | run=<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">E2EMARKLONGMUZL9VW4</w:t></w:r> / w:tbl=6 |
| long | reopen | PASS | 1605 | marker bold={"inStrong":true,"weight":"700"}; tables 5 -> 6 |
