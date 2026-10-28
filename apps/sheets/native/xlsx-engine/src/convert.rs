//! Legacy-format import: reads an .xls (or anything calamine understands)
//! and writes a minimal .xlsx with values, formulas, and date number formats.
//! Styles beyond date formats are not carried over — the converted file is a
//! fresh workbook, not a byte-preserving edit.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use calamine::{Data, Reader, Sheets, open_workbook_auto};

use crate::SidecarError;
use crate::spreadsheetml;
use crate::xlsx_package::{
    SheetSpec, cell_reference, escape_xml, worksheet_document, write_package,
};

pub struct ConvertResult {
    pub sheets: usize,
    pub cells: usize,
}

/// Why the reader refused a file, when the refusal is about the container and
/// a friendlier sentence helps. `None` keeps the reader's own error.
///
/// Legacy workbooks are OLE2/CFB containers; a file that starts with anything
/// else was renamed rather than exported. Excel sniffs content over extension
/// and opens plenty of those happily, so the reader's `Invalid OLE (signature
/// ...)` tells the person holding the file nothing they can act on.
///
/// An XML spreadsheet is not one of these: genoffice#2044 reads it directly,
/// and this only has to speak about files no reader should open at all.
fn unreadable_container_hint(source: &Path) -> Option<String> {
    let mut head = [0u8; 1024];
    let read = File::open(source).ok()?.read(&mut head).ok()?;
    let head = &head[..read];
    if head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        // a real CFB container: whatever is wrong inside is the reader's to explain
        return None;
    }
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim_start_matches('\u{FEFF}').trim_start();
    if !trimmed.starts_with("<?xml") && !trimmed.starts_with('<') {
        return None;
    }
    let first_line = trimmed.lines().next().unwrap_or("").trim();
    let first_line = if first_line.chars().count() > 60 {
        let cut: String = first_line.chars().take(60).collect();
        format!("{cut}…")
    } else {
        first_line.to_string()
    };
    Some(format!(
        "This file is not a workbook container: its content is text or XML rather than \
         an Excel workbook package, and it begins with \"{first_line}\"."
    ))
}

pub fn convert_to_xlsx(source: &Path, target: &Path) -> Result<ConvertResult, SidecarError> {
    let mut workbook = match open_workbook_auto(source) {
        Ok(workbook) => workbook,
        Err(error) => {
            // Excel opens an XML spreadsheet saved under a legacy name by
            // sniffing content rather than extension, so one reaches here with
            // nothing in its header for calamine to go on. The SpreadsheetML
            // importer is the only reader that can still make sense of it;
            // the container hint below covers everything left over.
            if spreadsheetml::probe(source) {
                return spreadsheetml::convert_to_xlsx(source, target);
            }
            return Err(SidecarError::Workbook(
                match unreadable_container_hint(source) {
                    Some(hint) => hint,
                    None => format!("Unable to read the workbook: {error}"),
                },
            ));
        }
    };
    let names: Vec<String> = workbook.sheet_names().to_vec();
    if names.is_empty() {
        return Err(SidecarError::Workbook("The workbook has no sheets.".into()));
    }

    let is_xls = matches!(workbook, Sheets::Xls(_));
    let mut sheet_xmls: Vec<String> = Vec::new();
    let mut cells = 0usize;
    for name in &names {
        let range = workbook
            .worksheet_range(name)
            .map_err(|error| SidecarError::Workbook(format!("Sheet {name}: {error}")))?;
        // calamine 0.36.0's BIFF8 (`Sheets::Xls`) formula parser fails to mask
        // `ColRelU` flag bits (`0xC000`) on `PtgArea` (`SUM(B2:B4)` ->
        // `SUM($USN$2:$USN$4)`), corrupts `PtgRef3d` columns with `colu << 2`
        // and omits quotes around sheet names with spaces/diacritics, and emits
        // literal `"Unrecognised formula ..."` strings on unsupported tokens.
        // Keep the cached cell values from `worksheet_range` and omit `<f>` for
        // `.xls` so converted workbooks never carry corrupted formulas.
        let formulas = if is_xls {
            None
        } else {
            workbook.worksheet_formula(name).ok()
        };
        let mut formula_map: HashMap<(u32, u32), String> = HashMap::new();
        if let Some(formula_range) = formulas {
            let (start_row, start_col) = formula_range.start().unwrap_or((0, 0));
            for (row, column, formula) in formula_range.used_cells() {
                if !formula.is_empty() {
                    formula_map.insert(
                        (start_row + row as u32, start_col + column as u32),
                        formula.clone(),
                    );
                }
            }
        }
        let (xml, sheet_cells) = worksheet_xml(&range, &formula_map);
        cells += sheet_cells;
        sheet_xmls.push(xml);
    }

    let sheets: Vec<SheetSpec> = names
        .iter()
        .map(|name| SheetSpec {
            name: name.clone(),
            state: None,
        })
        .collect();
    write_package(target, &sheets, "", &sheet_xmls)?;
    Ok(ConvertResult {
        sheets: names.len(),
        cells,
    })
}

fn worksheet_xml(
    range: &calamine::Range<Data>,
    formulas: &HashMap<(u32, u32), String>,
) -> (String, usize) {
    // Rows carrying values plus rows carrying only formulas.
    let mut rows: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    let mut cells = 0usize;
    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    for (row, column, value) in range.used_cells() {
        let absolute = (start_row + row as u32, start_col + column as u32);
        let formula = formulas.get(&absolute).map(String::as_str);
        if let Some(cell) = cell_xml(absolute, value, formula) {
            cells += 1;
            rows.entry(absolute.0).or_default().push((absolute.1, cell));
        }
    }
    for (position, formula) in formulas {
        let covered = range
            .get_value((position.0, position.1))
            .is_some_and(|v| *v != Data::Empty);
        if !covered {
            cells += 1;
            rows.entry(position.0).or_default().push((
                position.1,
                format!(
                    r#"<c r="{}"><f>{}</f></c>"#,
                    cell_reference(position.0, position.1),
                    escape_xml(formula),
                ),
            ));
        }
    }

    let mut row_numbers: Vec<u32> = rows.keys().copied().collect();
    row_numbers.sort_unstable();
    let mut body = String::new();
    for row in row_numbers {
        let mut line = rows.remove(&row).unwrap_or_default();
        line.sort_unstable_by_key(|(column, _)| *column);
        body.push_str(&format!(r#"<row r="{}">"#, row + 1));
        for (_, cell) in line {
            body.push_str(&cell);
        }
        body.push_str("</row>");
    }

    let dimension = match (range.start(), range.end()) {
        (Some(start), Some(end)) => format!(
            "{}:{}",
            cell_reference(start.0, start.1),
            cell_reference(end.0, end.1),
        ),
        _ => "A1:A1".into(),
    };
    (worksheet_document(&dimension, "", &body, ""), cells)
}

fn cell_xml(position: (u32, u32), value: &Data, formula: Option<&str>) -> Option<String> {
    let reference = cell_reference(position.0, position.1);
    let formula_xml = formula
        .map(|text| format!("<f>{}</f>", escape_xml(text)))
        .unwrap_or_default();
    let cell = match value {
        Data::Empty => {
            if formula.is_none() {
                return None;
            }
            format!(r#"<c r="{reference}">{formula_xml}</c>"#)
        }
        Data::String(text) => format!(
            r#"<c r="{reference}" t="inlineStr">{formula_xml}<is><t xml:space="preserve">{}</t></is></c>"#,
            escape_xml(text),
        ),
        Data::Float(number) => format!(r#"<c r="{reference}">{formula_xml}<v>{number}</v></c>"#),
        Data::Int(number) => format!(r#"<c r="{reference}">{formula_xml}<v>{number}</v></c>"#),
        Data::Bool(flag) => format!(
            r#"<c r="{reference}" t="b">{formula_xml}<v>{}</v></c>"#,
            if *flag { 1 } else { 0 },
        ),
        Data::DateTime(datetime) => {
            let serial = datetime.as_f64();
            let style = if serial.fract() == 0.0 { 1 } else { 2 };
            format!(r#"<c r="{reference}" s="{style}">{formula_xml}<v>{serial}</v></c>"#)
        }
        Data::Error(error) => format!(
            r#"<c r="{reference}" t="e">{formula_xml}<v>{}</v></c>"#,
            escape_xml(&error.to_string()),
        ),
        Data::DateTimeIso(text) | Data::DurationIso(text) => format!(
            r#"<c r="{reference}" t="inlineStr">{formula_xml}<is><t xml:space="preserve">{}</t></is></c>"#,
            escape_xml(text),
        ),
    };
    Some(cell)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::{Read, Write};
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    fn read_entry(path: &Path, name: &str) -> String {
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        content
    }

    #[test]
    fn converts_a_calamine_readable_workbook_into_minimal_xlsx() {
        // calamine reads xlsx through the same auto-detect path as xls, so a
        // generated xlsx fixture exercises the converter end to end.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.xlsx");
        convert_fixture(&source);
        let target = dir.path().join("converted.xlsx");

        let result = convert_to_xlsx(&source, &target).unwrap();
        assert_eq!(result.sheets, 1);
        assert!(result.cells >= 4);

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(
            r#"<c r="A1" t="inlineStr"><is><t xml:space="preserve">Name &amp; Co</t></is></c>"#
        ));
        assert!(sheet.contains(r#"<c r="B1"><v>42</v></c>"#));
        assert!(sheet.contains(r#"<c r="B2"><f>B1*2</f>"#));
        let workbook = read_entry(&target, "xl/workbook.xml");
        assert!(workbook.contains(r#"<sheet name="Data" sheetId="1" r:id="rId1"/>"#));
    }

    #[test]
    fn biff8_xls_conversion_drops_corrupted_calamine_formulas_and_preserves_cached_values() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vn-budget.xls");
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("vn-budget.xlsx");

        let result = convert_to_xlsx(&source, &target).unwrap();
        assert_eq!(result.sheets, 3);

        let sheet1 = read_entry(&target, "xl/worksheets/sheet1.xml");
        let sheet2 = read_entry(&target, "xl/worksheets/sheet2.xml");
        let sheet3 = read_entry(&target, "xl/worksheets/sheet3.xml");

        // Never emit corrupted calamine BIFF8 formulas ($USN, $USO, unquoted 3D ref)
        for xml in [&sheet1, &sheet2, &sheet3] {
            assert!(
                !xml.contains("<f>"),
                "expected no <f> in BIFF8 conversion, got: {xml}"
            );
            assert!(!xml.contains("USN"));
            assert!(!xml.contains("USO"));
            assert!(!xml.contains("USP"));
            assert!(!xml.contains("Unrecognised formula"));
        }

        // Cached numeric values in formula cells are preserved intact
        assert!(sheet1.contains(r#"<c r="B6"><v>4908000000</v></c>"#));
        assert!(sheet1.contains(r#"<c r="C6"><v>5408000000</v></c>"#));
        assert!(sheet2.contains(r#"<c r="D2"><v>270</v></c>"#));
        assert!(sheet2.contains(r#"<c r="B5"><v>415</v></c>"#));
        assert!(sheet2.contains(r#"<c r="D5"><v>900</v></c>"#));
        assert!(sheet3.contains(r#"<c r="B1"><v>990</v></c>"#));
    }

    fn convert_fixture(path: &Path) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        let mut add = |name: &str, content: &str| {
            writer.start_file(name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        };
        add(
            "[Content_Types].xml",
            r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        );
        add(
            "_rels/.rels",
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        );
        add(
            "xl/workbook.xml",
            r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        );
        add(
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        );
        add(
            "xl/worksheets/sheet1.xml",
            r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name &amp; Co</t></is></c><c r="B1"><v>42</v></c></row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>B1*2</f><v>84</v></c></row></sheetData></worksheet>"#,
        );
        writer.finish().unwrap();
    }

    #[test]
    fn an_xml_spreadsheet_is_the_converter_s_business_not_a_dead_end() {
        // genoffice#2044 opens this shape instead of refusing it: the XML
        // spreadsheet converts, and the container hint keeps speaking only
        // for text a reader cannot open at all.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("report.xls");
        std::fs::write(
            &source,
            r#"<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Data">
  <Table><Row><Cell><Data ss:Type="Number">42</Data></Cell></Row></Table>
 </Worksheet>
</Workbook>
"#,
        )
        .unwrap();
        let result = convert_to_xlsx(&source, &dir.path().join("out.xlsx"))
            .expect("an XML spreadsheet under a legacy name converts (genoffice#2044)");
        assert_eq!(result.sheets, 1, "sheets: {}", result.sheets);
        assert_eq!(result.cells, 1, "cells: {}", result.cells);
    }

    #[test]
    fn a_binary_file_that_is_no_container_at_all_keeps_the_reader_error() {
        // Neither a CFB nor anything text-shaped. Guessing what it might have
        // been would be worse than the reader's own message, and this is the
        // branch that keeps it.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("blob.xls");
        std::fs::write(&source, [0x00u8, 0x01, 0x02, 0x03, 0xFE, 0xFF]).unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("a binary blob must not convert");
        };
        let message = error.to_string();
        assert!(message.contains("Unable to read the workbook"), "{message}");
    }

    #[test]
    fn other_text_content_says_what_the_file_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("page.xls");
        std::fs::write(
            &source,
            "<html><body><table><tr><td>1</td></tr></table></body></html>\n",
        )
        .unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("html is not a workbook");
        };
        let message = error.to_string();
        assert!(message.contains("not a workbook container"), "{message}");
        assert!(message.contains("<html>"), "{message}");
    }

    #[test]
    fn a_real_container_keeps_the_reader_error() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("broken.xls");
        let mut bytes = vec![0xD0u8, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        bytes.extend(vec![0u8; 600]);
        std::fs::write(&source, &bytes).unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("a truncated container must not convert");
        };
        let message = error.to_string();
        assert!(message.contains("Unable to read the workbook"), "{message}");
    }
}
