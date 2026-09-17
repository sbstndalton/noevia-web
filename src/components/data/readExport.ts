/** Pulls conversations.json out of what the user picked: the export ZIP itself (stored or
 *  deflated entries) or the JSON file. Runs in the browser; nothing is uploaded until parsed. */
export async function readConversationsFile(file: Blob & { name?: string }): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isZip) return new TextDecoder().decode(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Walk the central directory: sizes in local headers can be zero when a tool streamed the archive.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Error('That ZIP could not be read.');
  let at = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true), compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (name === 'conversations.json' || name.endsWith('/conversations.json')) {
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      throw Error('That ZIP uses a compression method noevia cannot read. Extract conversations.json and choose it instead.');
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw Error('That ZIP has no conversations.json. Choose a noevia conversations export.');
}
