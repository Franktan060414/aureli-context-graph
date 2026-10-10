// Serialize writes per map, coalescing changes made while a request is in flight.
// A late response never writes the visible map's zoom or changes request ownership.
export function createMapZoomSaver(onError) {
  const entries = new Map();
  return {
    discard(key) {
      const entry = entries.get(key);
      if (entry) { entry.discarded = true; entry.pending = null; entries.delete(key); }
    },
    pending(key) { return entries.get(key)?.latest; },
    save(key, zoom, send) {
      let entry = entries.get(key);
      if (!entry) { entry = { pending: null, latest: zoom, running: null }; entries.set(key, entry); }
      entry.latest = zoom;
      entry.pending = { zoom, send };
      if (!entry.running) {
        entry.running = (async () => {
          while (entry.pending) {
            const request = entry.pending;
            entry.pending = null;
            try { await request.send(request.zoom); }
            catch (error) { if (!entry.discarded) onError(error); }
          }
          if (entries.get(key) === entry) entries.delete(key);
        })();
      }
      return entry.running;
    },
  };
}
