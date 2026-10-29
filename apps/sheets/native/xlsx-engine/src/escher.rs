//! The Escher drawing format .xls embeds inside BIFF records (MS-ODRAW): the
//! container tree, the pictures of the workbook drawing group, and the
//! per-sheet picture anchors. Only what the conversion needs is parsed —
//! containers are walked recursively, leaf records are opaque bytes.

/// One embedded picture from the drawing group's BStore container.
pub(crate) struct Blip {
    pub(crate) kind: BlipKind,
    /// The image file bytes, ready for an OOXML media part.
    pub(crate) bytes: Vec<u8>,
}

pub(crate) enum BlipKind {
    Png,
    Jpeg,
    /// WMF/EMF/DIB and friends: the conversion skips these for now.
    Other,
}

impl BlipKind {
    /// The media extension the converted package writes for this kind.
    pub(crate) fn extension(&self) -> &'static str {
        match self {
            BlipKind::Png => "png",
            BlipKind::Jpeg => "jpg",
            BlipKind::Other => "bin",
        }
    }
}

/// One picture shape on a sheet.
pub(crate) struct Picture {
    /// `[colL, dxL, rowT, dyT, colR, dxR, rowB, dyB]`, all zero-based;
    /// the dx/dy offsets are 1/1024 of the column width / row height, and
    /// 0xFFFF in colR/rowB means the object runs to the sheet's edge.
    pub(crate) anchor: [u16; 8],
    /// 1-based index into the drawing group's BSE list.
    pub(crate) blip: u32,
}

/// One record in an Escher stream. Container records carry their children in
/// `data`; leaf records carry opaque bytes.
struct Node<'a> {
    ver_inst: u16,
    kind: u16,
    data: &'a [u8],
}

fn u16le(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32le(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Parses one level of the Escher tree. A stream fragment that ends mid-record
/// ends the level; everything parsed so far stays usable.
fn children(data: &[u8]) -> Vec<Node<'_>> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let ver_inst = u16le(data, pos);
        let kind = u16le(data, pos + 2);
        let len = u32le(data, pos + 4);
        if kind == 0 {
            break;
        }
        let start = pos + 8;
        let end = record_end(start, len, data.len());
        out.push(Node {
            ver_inst,
            kind,
            data: &data[start..end],
        });
        pos = end;
    }
    out
}

/// End of a record's body, clamped to the stream. The sum is done in u64 so a
/// declared length near `u32::MAX` cannot wrap a 32-bit `usize` (wasm32) into
/// a small value and panic on the slice; the wasm reactor aborts on panic.
fn record_end(start: usize, len: u32, limit: usize) -> usize {
    (start as u64 + u64::from(len)).min(limit as u64) as usize
}

/// Real drawing trees nest four or five containers deep; anything deeper is a
/// hostile file, and each level costs only eight bytes of input.
const MAX_DEPTH: usize = 16;

fn is_container(ver_inst: u16) -> bool {
    ver_inst & 0xF == 0xF
}

/// Container and record kinds this parser cares about (MS-ODRAW).
const BSTORE_CONTAINER: u16 = 0xF001;
const SP_CONTAINER: u16 = 0xF004;
const BSE: u16 = 0xF007;
const OPT: u16 = 0xF00B;
const CLIENT_ANCHOR: u16 = 0xF010;
const BLIP_PNG: u16 = 0xF01E;
const BLIP_JPEG: u16 = 0xF01D;
/// OPT property `blipPib`: which BSE the shape's picture comes from.
const PROP_BLIP_PIB: u16 = 0x0104;

/// Extracts the pictures of the drawing group: BStoreContainer → BSE records,
/// each carrying one image after a fixed header and an optional name.
pub(crate) fn parse_blips(dgg: &[u8]) -> Vec<Blip> {
    let mut out = Vec::new();
    for store in containers_of(dgg, BSTORE_CONTAINER, 0) {
        for entry in children(store.data) {
            if entry.kind != BSE || entry.data.len() < 36 {
                continue;
            }
            let bytes = entry.data;
            // BSE: btWin32, btMacOS, rgbUid(16), tag(2), cRef(4), foDelay(4),
            // cUsage, cbName, two unused bytes — then the named image.
            let name_len = bytes[29] as usize;
            let Some(blip) = bytes.get(36 + name_len..) else {
                continue;
            };
            if blip.len() < 8 {
                continue;
            }
            let kind = u16le(blip, 2);
            let kind = match kind {
                BLIP_PNG => BlipKind::Png,
                BLIP_JPEG => BlipKind::Jpeg,
                _ => BlipKind::Other,
            };
            // after the blip's own 8-byte record header: rgbUid(16) — doubled
            // when the instance's low bit is set — then a 0xFF tag byte, then
            // the image bytes.
            let skip = 8 + 16 + if u16le(blip, 0) & 0x1 == 1 { 16 } else { 0 } + 1;
            let image = blip.get(skip..).unwrap_or(&[]).to_vec();
            out.push(Blip { kind, bytes: image });
        }
    }
    out
}

/// Every container of `kind` anywhere in the tree, outermost first.
fn containers_of<'a>(data: &'a [u8], kind: u16, depth: usize) -> Vec<Node<'a>> {
    let mut out = Vec::new();
    for node in children(data) {
        if node.kind == kind {
            out.push(node);
            continue;
        }
        if is_container(node.ver_inst) && depth < MAX_DEPTH {
            out.extend(containers_of(node.data, kind, depth + 1));
        }
    }
    out
}

/// Collects the picture anchors of one sheet's drawing: every shape container
/// that pairs a client anchor with a blip reference.
pub(crate) fn parse_pictures(drawing: &[u8]) -> Vec<Picture> {
    let mut out = Vec::new();
    for node in children(drawing) {
        visit(&node, 0, &mut out);
    }
    out
}

fn visit(node: &Node<'_>, depth: usize, out: &mut Vec<Picture>) {
    if node.kind == SP_CONTAINER {
        let mut anchor: Option<[u16; 8]> = None;
        let mut blip: Option<u32> = None;
        for child in children(node.data) {
            match child.kind {
                CLIENT_ANCHOR if child.data.len() >= 18 => {
                    // flags(2), then the eight anchor fields
                    let bytes = child.data;
                    anchor = Some([
                        u16le(bytes, 2),
                        u16le(bytes, 4),
                        u16le(bytes, 6),
                        u16le(bytes, 8),
                        u16le(bytes, 10),
                        u16le(bytes, 12),
                        u16le(bytes, 14),
                        u16le(bytes, 16),
                    ]);
                }
                OPT => blip = blip_pib(child.data),
                _ => {}
            }
        }
        if let (Some(anchor), Some(blip)) = (anchor, blip) {
            out.push(Picture { anchor, blip });
        }
        return;
    }
    if is_container(node.ver_inst) && depth < MAX_DEPTH {
        for child in children(node.data) {
            visit(&child, depth + 1, out);
        }
    }
}

/// Reads the `blipPib` property out of an OPT record: a run of 6-byte
/// properties written in ascending id order. Excel and LibreOffice both store
/// the picture reference as a plain value ahead of the complex geometry
/// properties, so the run is read front to back and a complex pib — which
/// would point through the pool stream — is skipped for now.
fn blip_pib(data: &[u8]) -> Option<u32> {
    let mut at = 0usize;
    while at + 6 <= data.len() {
        let attr = u16le(data, at);
        if attr & 0x3FFF == PROP_BLIP_PIB {
            return if attr & 0x8000 == 0 {
                Some(u32le(data, at + 2))
            } else {
                None
            };
        }
        at += 6;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(ver_inst: u16, kind: u16, len: u32, body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&ver_inst.to_le_bytes());
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn record_end_does_not_wrap_for_a_declared_length_near_u32_max() {
        // On wasm32 `start + len` in usize would wrap to 4 here; the u64 sum
        // clamps to the stream instead.
        assert_eq!(record_end(8, u32::MAX, 100), 100);
        assert_eq!(record_end(0xFFFF_FFF0, 0x20, 0xFFFF_FFF8), 0xFFFF_FFF8);
        assert_eq!(record_end(8, 4, 100), 12);
    }

    #[test]
    fn children_survives_a_record_declaring_a_length_near_u32_max() {
        let data = record(0x0, SP_CONTAINER, u32::MAX, &[1, 2, 3]);
        let nodes = children(&data);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].data, &[1, 2, 3]);
        assert!(parse_pictures(&data).is_empty());
        assert!(parse_blips(&data).is_empty());
    }

    #[test]
    fn deeply_nested_containers_return_without_overflowing_the_stack() {
        // Each container declares a length longer than the rest, so it nests
        // the remainder: 100 000 levels for 800 KB of input.
        let mut data = Vec::new();
        for _ in 0..100_000 {
            data.extend(record(0xF, 0xF002, u32::MAX, &[]));
        }
        assert!(parse_pictures(&data).is_empty());

        let mut store = Vec::new();
        for _ in 0..100_000 {
            store.extend(record(0xF, 0xF000, u32::MAX, &[]));
        }
        assert!(parse_blips(&store).is_empty());
    }

    #[test]
    fn a_bstore_inside_the_depth_cap_is_still_found() {
        let bse = record(0x2, BSE, 4, &[0; 4]);
        let mut data = record(0xF, BSTORE_CONTAINER, bse.len() as u32, &bse);
        for _ in 0..4 {
            data = record(0xF, 0xF000, data.len() as u32, &data);
        }
        assert_eq!(containers_of(&data, BSTORE_CONTAINER, 0).len(), 1);
    }
}
