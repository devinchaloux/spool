// ── Note ids ──
// The notation view lights each note as it sounds, finding it by xml:id: the
// native reader names a note by its id, and Verovio keeps the file's ids in
// the notation it draws. A note the file gives no id would get a different
// made-up one from each, so before either reads the file, every note without
// one gets "spool-note-1", "spool-note-2"… in document order.

const XML_NS = 'http://www.w3.org/XML/1998/namespace'

/** The file with an id on every note; unchanged if every note has one, or if it isn't XML. */
export function withNoteIds(xmlText: string): string {
  const doc = new DOMParser().parseFromString(xmlText.trim(), 'application/xml')
  if (doc.querySelector('parsererror')) return xmlText
  const notes = Array.from(doc.getElementsByTagNameNS('*', 'note'))
  const missing = notes.filter((n) => !n.getAttribute('xml:id'))
  if (!missing.length) return xmlText
  // Every id in the file, so a made-up one never repeats one already there.
  const taken = new Set<string>()
  const walker = doc.createTreeWalker(doc, 1 /* NodeFilter.SHOW_ELEMENT */)
  while (walker.nextNode()) {
    const id = (walker.currentNode as Element).getAttribute('xml:id')
    if (id) taken.add(id)
  }
  let n = 0
  for (const note of missing) {
    let id: string
    do id = `spool-note-${++n}`
    while (taken.has(id))
    note.setAttributeNS(XML_NS, 'xml:id', id)
  }
  return doc.documentElement.outerHTML
}
