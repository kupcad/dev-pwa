// A stand-in for the origin private file system, in memory, for the tests in Node: the handles'
// methods the IDE uses, failing as a browser's do (NotFoundError, TypeMismatchError,
// InvalidModificationError).

/** @param {string} what @param {string} name */
const failure = (what, name) => new DOMException(what, name);

export class MemoryFile {
  kind = /** @type {const} */ ('file');
  bytes = new Uint8Array();
  /** When it was written last: one more each write, as a clock would say later. */
  modified = 0;

  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }

  async getFile() {
    return new File([this.bytes], this.name, { lastModified: this.modified });
  }

  async createWritable() {
    /** @type {BlobPart[]} */
    const chunks = [];
    return {
      /** @param {string | Uint8Array<ArrayBuffer>} data */
      write: async (data) => void chunks.push(data),
      close: async () => {
        this.bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        this.modified += 1;
      },
    };
  }
}

export class MemoryFolder {
  kind = /** @type {const} */ ('directory');
  /** @type {Map<string, MemoryFolder | MemoryFile>} */
  children = new Map();

  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }

  /** @param {string} name @param {{ create?: boolean }} [options] */
  async getDirectoryHandle(name, { create = false } = {}) {
    const child = this.children.get(name);
    if (child instanceof MemoryFile) throw failure(`${name} is a file`, 'TypeMismatchError');
    if (child) return child;
    if (!create) throw failure(`No ${name}`, 'NotFoundError');
    const made = new MemoryFolder(name);
    this.children.set(name, made);
    return made;
  }

  /** @param {string} name @param {{ create?: boolean }} [options] */
  async getFileHandle(name, { create = false } = {}) {
    const child = this.children.get(name);
    if (child instanceof MemoryFolder) throw failure(`${name} is a folder`, 'TypeMismatchError');
    if (child) return child;
    if (!create) throw failure(`No ${name}`, 'NotFoundError');
    const made = new MemoryFile(name);
    this.children.set(name, made);
    return made;
  }

  /** @param {string} name @param {{ recursive?: boolean }} [options] */
  async removeEntry(name, { recursive = false } = {}) {
    const child = this.children.get(name);
    if (!child) throw failure(`No ${name}`, 'NotFoundError');
    if (child instanceof MemoryFolder && child.children.size > 0 && !recursive) {
      throw failure(`${name} isn't empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *values() {
    yield* this.children.values();
  }
}

/** A project's folder in memory, as the IDE takes one. */
export const memoryFolder = () =>
  /** @type {FileSystemDirectoryHandle} */ (/** @type {unknown} */ (new MemoryFolder('project')));
