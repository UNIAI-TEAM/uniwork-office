<<<<<<< ours
use std::collections::VecDeque;
use std::io::{self, BufWriter, Write};
#[cfg(not(target_os = "wasi"))]
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(target_os = "wasi"))]
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
#[cfg(not(target_os = "wasi"))]
=======
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::sync::{Arc, Mutex, mpsc};
>>>>>>> theirs
use std::thread;

use xlsx_sidecar::THREADS;
use xlsx_sidecar::WorkbookSessions;
use xlsx_sidecar::protocol::{
    CancelledRequests, Command, Engine, InFlightRequest, PROTOCOL_VERSION, RecalcWorker, Request,
    Response, SharedOutput, handle_request, write_response,
};
<<<<<<< ours
use xlsx_sidecar::find::FindCellsRequest;
use xlsx_sidecar::recalc::{RecalcCache, RecalcEdit, RecalcRead, recalc_cells};
use xlsx_sidecar::{CellRange, SidecarError, WorkbookSessions};

const PROTOCOL_VERSION: u8 = 1;

fn default_locale() -> String {
    "zh".to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum Command {
    Open {
        path: PathBuf,
        #[serde(default = "default_locale")]
        locale: String,
        #[serde(default, rename = "shortDateFormat")]
        short_date_format: Option<String>,
    },
    ReadRange {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
        range: CellRange,
    },
    Close {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    ReadMedia {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "visualId")]
        visual_id: String,
    },
    ReadFormulaCells {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
    },
    FindCells(FindCellsRequest),
    ReadRowOutline {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
    },
    Cancel {
        #[serde(rename = "targetRequestId")]
        target_request_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ArchiveManifest {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ReadEntries {
        path: PathBuf,
        entries: Vec<String>,
        output_dir: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ScanEntries {
        path: PathBuf,
        entries: Vec<String>,
        needle: String,
    },
    #[serde(rename_all = "camelCase")]
    ConvertWorkbook {
        path: PathBuf,
        target_path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    SaveArchive {
        source_path: PathBuf,
        target_path: PathBuf,
        replacements: Vec<EntryContent>,
        removals: Vec<String>,
        additions: Vec<EntryContent>,
    },
    #[serde(rename_all = "camelCase")]
    RecalcCells {
        path: PathBuf,
        edits: Vec<RecalcEdit>,
        reads: Vec<RecalcRead>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    version: u8,
    request_id: String,
    #[serde(flatten)]
    command: Command,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    version: u8,
    request_id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

type SharedOutput = Arc<Mutex<BufWriter<io::Stdout>>>;

fn write_response(output: &SharedOutput, response: &Response) -> Result<(), ()> {
    let mut output = output
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if serde_json::to_writer(&mut *output, response).is_err()
        || output.write_all(b"\n").is_err()
        || output.flush().is_err()
    {
        return Err(());
    }
    Ok(())
}

/// Owns the formula-engine state so recalc_cells can run off the request
/// loop: a cold IronCalc import of a formula-heavy workbook takes minutes,
/// and running it inline starved every interactive read_range behind it
/// (each timing out client-side while the sheet rendered blank).
struct RecalcWorker {
    cache: Arc<Mutex<RecalcCache>>,
    /// Purges arrive from the request loop while a recalc may hold the cache
    /// lock for minutes; they queue here and apply at the next recalc. Safe
    /// to defer: recalc_cells re-imports on mtime+size mismatch anyway.
    pending_purges: Arc<Mutex<Vec<PathBuf>>>,
    busy: Arc<AtomicBool>,
}

/// Clears the busy flag even when recalc_cells panics mid-import.
struct BusyReset(Arc<AtomicBool>);

impl Drop for BusyReset {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl RecalcWorker {
    fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(RecalcCache::new())),
            pending_purges: Arc::new(Mutex::new(Vec::new())),
            busy: Arc::new(AtomicBool::new(false)),
        }
    }

    fn queue_purge(&self, path: &PathBuf) {
        self.pending_purges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(path.clone());
    }

    /// Close must reclaim the resident model right away when it can: a queued
    /// purge only applies at the next recalc, and a closed workbook may never
    /// be recalced again. Falls back to the queue while a recalc holds the
    /// cache lock.
    fn purge_now_or_queue(&self, path: &PathBuf) {
        match self.cache.try_lock() {
            Ok(mut cache) => cache.purge(path),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner().purge(path),
            Err(std::sync::TryLockError::WouldBlock) => self.queue_purge(path),
        }
    }

    fn drain_purges(&self, cache: &mut RecalcCache) {
        let purges: Vec<PathBuf> = self
            .pending_purges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect();
        for purge in &purges {
            cache.purge(purge);
        }
    }

    /// The synchronous recalc body (also the unit-test entry point).
    fn run(
        &self,
        request_id: String,
        path: &PathBuf,
        edits: &[RecalcEdit],
        reads: &[RecalcRead],
    ) -> Response {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.drain_purges(&mut cache);
        let response = match recalc_cells(&mut cache, path, edits, reads).and_then(to_json_value) {
            Ok(value) => Response::success(request_id, value),
            Err(error) => Response::from_error(request_id, error),
        };
        // A Close racing this recalc queued its purge after the drain above;
        // apply it before releasing the lock so the just-inserted model does
        // not outlive its session.
        self.drain_purges(&mut cache);
        response
    }

    /// Runs the recalc on a worker thread, writing the response when done.
    /// Returns an immediate failure response when one is already in flight —
    /// callers fail soft to cached values and retry later.
    fn dispatch(
        &self,
        request_id: String,
        path: PathBuf,
        edits: Vec<RecalcEdit>,
        reads: Vec<RecalcRead>,
        output: &SharedOutput,
    ) -> Option<Response> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Some(Response::failure(
                request_id,
                "recalc_busy",
                "Formula engine is busy with another recalculation.".into(),
            ));
        }
        let worker = Self {
            cache: Arc::clone(&self.cache),
            pending_purges: Arc::clone(&self.pending_purges),
            busy: Arc::clone(&self.busy),
        };
        // wasm32-wasip1 has no threads: recalculate inline, same reply path
        #[cfg(target_os = "wasi")]
        {
            let reset = BusyReset(Arc::clone(&worker.busy));
            let response = worker.run(request_id, &path, &edits, &reads);
            drop(reset);
            let _ = write_response(output, &response);
            None
        }
        #[cfg(not(target_os = "wasi"))]
        {
            let output = Arc::clone(output);
            let reply_id = request_id.clone();
            let spawned = thread::Builder::new()
                .name("xlsx-recalc".into())
                .spawn(move || {
                    let reset = BusyReset(Arc::clone(&worker.busy));
                    let response = worker.run(request_id, &path, &edits, &reads);
                    // Clear busy before replying: a sequential caller issues its
                    // next recalc the moment the response lands, and hitting the
                    // still-set flag bounced it with recalc_busy.
                    drop(reset);
                    let _ = write_response(&output, &response);
                });
            match spawned {
                Ok(_) => None,
                Err(error) => {
                    self.busy.store(false, Ordering::Release);
                    Some(Response::failure(
                        reply_id,
                        "io_error",
                        format!("Unable to start the recalc worker: {error}"),
                    ))
                }
            }
        }
    }
}

/// Request ids cancelled out of band by the reader thread, awaiting their
/// turn in the request queue. A cancel that lands after its target already
/// replied would pin the id here forever (ids are never reused), so the list
/// is capped — forgetting an id merely lets that request run as before.
#[derive(Clone)]
struct CancelledRequests(Arc<Mutex<VecDeque<String>>>);

const MAX_CANCELLED_REQUESTS: usize = 256;

impl CancelledRequests {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(VecDeque::new())))
    }

    fn insert(&self, request_id: String) {
        let mut ids = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if ids.len() >= MAX_CANCELLED_REQUESTS {
            ids.pop_front();
        }
        ids.push_back(request_id);
    }

    fn take(&self, request_id: &str) -> bool {
        let mut ids = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match ids.iter().position(|id| id == request_id) {
            Some(index) => {
                ids.remove(index);
                true
            }
            None => false,
        }
    }
}

/// The request the loop is currently executing, plus the flag a cancel sets
/// to reach it. `CancelledRequests` only covers requests still waiting their
/// turn: once the loop dequeues one, its queue entry is never consulted
/// again, so an in-flight open would run to completion — creating a cache
/// directory and registering a session for a host that already discarded the
/// snapshot it was going to open.
#[derive(Clone)]
struct InFlightRequest(Arc<InFlightState>);

struct InFlightState {
    id: Mutex<String>,
    cancelled: Arc<AtomicBool>,
}

impl InFlightRequest {
    fn new() -> Self {
        Self(Arc::new(InFlightState {
            id: Mutex::new(String::new()),
            cancelled: Arc::new(AtomicBool::new(false)),
        }))
    }

    /// Registers the request about to run and clears the flag the previous
    /// request may have left set. Called before the queue check, so the two
    /// cover opposite sides of the dequeue: a cancel naming a still-queued
    /// request is caught by the queue, one naming the request now running is
    /// caught by the flag.
    fn begin(&self, request_id: &str) {
        *self
            .0
            .id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = request_id.to_owned();
        self.0.cancelled.store(false, Ordering::Release);
    }

    /// The reader thread's half of a cancel that names the running request. A
    /// target that is not the one running is left entirely to
    /// `CancelledRequests`, whose cap and forget-on-overflow semantics are
    /// unchanged.
    fn cancel(&self, target_request_id: &str) {
        let id = self
            .0
            .id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *id == target_request_id {
            self.0.cancelled.store(true, Ordering::Release);
        }
    }

    /// The live flag an in-flight request polls.
    fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0.cancelled)
    }
}
=======
>>>>>>> theirs

/// The wasm32-wasip1 build is a reactor driven by the web frame's Worker
/// (web/modules/sheets/engine): no stdin loop and no threads. The host writes
/// one NDJSON request line into wasm memory and calls `xlsx_sidecar_handle`;
/// the response line is written to stdout (fd 1) before the call returns,
/// exactly as the desktop process answers on its stdout. Between requests the
/// host calls `xlsx_sidecar_index_step` to continue worksheet indexes.
#[cfg(target_os = "wasi")]
pub mod wasm_reactor {
    use super::*;
    use std::cell::RefCell;

    struct State {
        sessions: WorkbookSessions,
        recalc: RecalcWorker,
        cancelled: CancelledRequests,
        in_flight: InFlightRequest,
        output: SharedOutput,
    }

    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> T {
        STATE.with(|cell| {
            let mut slot = cell.borrow_mut();
            let state = slot.get_or_insert_with(|| State {
                sessions: WorkbookSessions::new(),
                recalc: RecalcWorker::new(),
                cancelled: CancelledRequests::new(),
                in_flight: InFlightRequest::new(),
                output: Arc::new(Mutex::new(BufWriter::new(io::stdout()))),
            });
            f(state)
        })
    }

    /// A buffer of `len` bytes in wasm memory for the next request line.
    #[unsafe(no_mangle)]
    pub extern "C" fn xlsx_sidecar_alloc(len: usize) -> *mut u8 {
        let mut buffer = Vec::<u8>::with_capacity(len.max(1));
        let pointer = buffer.as_mut_ptr();
        std::mem::forget(buffer);
        pointer
    }

    /// Handle one request line (takes ownership of the `xlsx_sidecar_alloc`
    /// buffer); the response is written to stdout before this returns.
    ///
    /// # Safety
    /// `pointer` must come from `xlsx_sidecar_alloc(len)` and hold `len` bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn xlsx_sidecar_handle(pointer: *mut u8, len: usize) {
        // SAFETY: the host passes back the buffer xlsx_sidecar_alloc(len) returned
        let bytes = unsafe { Vec::from_raw_parts(pointer, len, len.max(1)) };
        with_state(|state| {
            let response = match serde_json::from_slice::<Request>(&bytes) {
                Ok(request) => {
                    // single-threaded: a cancel is its own request, so the flag only resets here
                    state.in_flight.begin(&request.request_id);
                    handle_request(
                        request,
                        &mut state.sessions,
                        &state.recalc,
                        &state.cancelled,
                        &state.in_flight,
                        &state.output,
                    )
                }
                Err(error) => Some(Response::failure(
                    String::new(),
                    "invalid_json",
                    format!("Invalid sidecar request: {error}"),
                )),
            };
            if let Some(response) = response {
                let _ = write_response(&state.output, &response);
            }
        });
    }

    /// Continue one pending worksheet index by one pass; 1 while more remains.
    #[unsafe(no_mangle)]
    pub extern "C" fn xlsx_sidecar_index_step() -> u32 {
        with_state(|state| u32::from(state.sessions.index_step().unwrap_or(false)))
    }
}

/// The bin target on wasm32-wasip1 does nothing: the frame loads the reactor
/// (apps/sheets/native/xlsx-engine/wasm), not this command module.
#[cfg(target_os = "wasi")]
fn main() {}

#[cfg(not(target_os = "wasi"))]
fn main() {
    if !THREADS {
        serve_sequentially();
        return;
    }
    let stdin = io::stdin();
    let output: SharedOutput = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    let mut sessions = WorkbookSessions::new();
    let recalc = RecalcWorker::new();
    let cancelled = CancelledRequests::new();
    let in_flight = InFlightRequest::new();

    // Requests execute on this thread in arrival order; a dedicated reader
    // drains stdin so a cancel can jump the queue while earlier requests are
    // still pending. The small bound keeps stdin backpressure close to the
    // old read-one-handle-one loop.
    let (queue, requests) = mpsc::sync_channel::<Request>(8);
    let reader_output = Arc::clone(&output);
    let reader_cancelled = cancelled.clone();
    let reader_in_flight = in_flight.clone();
    let reader = thread::Builder::new()
        .name("xlsx-reader".into())
        .spawn(move || {
            for line in BufReader::new(stdin.lock()).lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        let _ = write_response(
                            &reader_output,
                            &Response::failure(
                                String::new(),
                                "stdin_error",
                                format!("Unable to read sidecar request: {error}"),
                            ),
                        );
                        break;
                    }
                };
                let request: Request = match serde_json::from_str(&line) {
                    Ok(request) => request,
                    Err(error) => {
                        if write_response(
                            &reader_output,
                            &Response::failure(
                                String::new(),
                                "invalid_json",
                                format!("Invalid sidecar request: {error}"),
                            ),
                        )
                        .is_err()
                        {
                            break;
                        }
                        continue;
                    }
                };
                if let Command::Cancel { target_request_id } = request.command {
                    let response = if request.version == PROTOCOL_VERSION {
                        reader_cancelled.insert(target_request_id.clone());
                        // A target already running is past the queue's reach;
                        // trip the flag its open is polling.
                        reader_in_flight.cancel(&target_request_id);
                        Response::success(
                            request.request_id,
                            serde_json::json!({ "cancelled": true }),
                        )
                    } else {
                        Response::failure(
                            request.request_id,
                            "unsupported_version",
                            "Unsupported sidecar protocol version.".into(),
                        )
                    };
                    if write_response(&reader_output, &response).is_err() {
                        break;
                    }
                    continue;
                }
                if queue.send(request).is_err() {
                    break;
                }
            }
        });
    if reader.is_err() {
        return;
    }

    for request in requests {
        in_flight.begin(&request.request_id);
        let response = handle_request(
            request,
            &mut sessions,
            &recalc,
            &cancelled,
            &in_flight,
            &output,
        );
        if let Some(response) = response
            && write_response(&output, &response).is_err()
        {
            break;
        }
    }
}

/// Without threads there is no reader to let a cancel jump the queue: each
/// request runs to completion before the next line is read.
fn serve_sequentially() {
    let mut engine = Engine::new();
    let mut output = BufWriter::new(io::stdout());
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if let Some(response) = engine.handle_line(&line)
            && (writeln!(output, "{response}").is_err() || output.flush().is_err())
        {
            break;
        }
    }
}
