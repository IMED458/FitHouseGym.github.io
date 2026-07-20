'use strict';

/**
 * Minimal in-memory Firestore double: enough for the payment service
 * (get/create/update/set, where+limit queries, runTransaction).
 * Keeps the suite offline — no emulator, no network.
 */

let autoId = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeDocRef {
  constructor(store, path, id) {
    this.store = store;
    this.path = path;
    this.id = id;
  }

  async get() {
    const data = this.store.get(this.path);
    return {
      exists: data !== undefined,
      id: this.id,
      data: () => clone(data),
    };
  }

  async create(data) {
    if (this.store.has(this.path)) {
      const err = new Error(`Document already exists: ${this.path}`);
      err.code = 6; // ALREADY_EXISTS
      throw err;
    }
    this.store.set(this.path, clone(data));
  }

  async set(data) {
    this.store.set(this.path, clone(data));
  }

  async update(patch) {
    const current = this.store.get(this.path);
    if (current === undefined) throw new Error(`No document to update: ${this.path}`);
    this.store.set(this.path, { ...current, ...clone(patch) });
  }
}

class FakeQuery {
  constructor(store, collectionPath, filters = [], limitCount = null) {
    this.store = store;
    this.collectionPath = collectionPath;
    this.filters = filters;
    this.limitCount = limitCount;
  }

  where(field, op, value) {
    if (op !== '==') throw new Error(`FakeFirestore only supports '==', got '${op}'`);
    return new FakeQuery(this.store, this.collectionPath, [...this.filters, { field, value }], this.limitCount);
  }

  limit(n) {
    return new FakeQuery(this.store, this.collectionPath, this.filters, n);
  }

  async get() {
    const prefix = `${this.collectionPath}/`;
    let docs = [];
    for (const [path, data] of this.store.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes('/')) continue;
      if (this.filters.every((f) => data[f.field] === f.value)) {
        docs.push({ id: path.slice(prefix.length), data: () => clone(data) });
      }
    }
    if (this.limitCount !== null) docs = docs.slice(0, this.limitCount);
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(store, path) {
    super(store, path);
    this.pathValue = path;
  }

  doc(id) {
    const docId = id || `auto-${++autoId}`;
    return new FakeDocRef(this.store, `${this.pathValue}/${docId}`, docId);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.writes = [];
  }

  async get(ref) {
    return ref.get();
  }

  update(ref, patch) {
    this.writes.push({ type: 'update', ref, patch });
  }

  set(ref, data) {
    this.writes.push({ type: 'set', ref, data });
  }

  async _commit() {
    for (const write of this.writes) {
      if (write.type === 'update') await write.ref.update(write.patch);
      else await write.ref.set(write.data);
    }
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.store = new Map();
    for (const [collection, docs] of Object.entries(seed)) {
      for (const [id, data] of Object.entries(docs)) {
        this.store.set(`${collection}/${id}`, clone(data));
      }
    }
  }

  collection(path) {
    return new FakeCollectionRef(this.store, path);
  }

  /** Buffers writes and commits only on success, so a throw rolls everything back. */
  async runTransaction(fn) {
    const tx = new FakeTransaction(this.store);
    const result = await fn(tx);
    await tx._commit();
    return result;
  }

  // ---- test helpers ----
  dump(collection) {
    const prefix = `${collection}/`;
    const out = {};
    for (const [path, data] of this.store.entries()) {
      if (path.startsWith(prefix)) out[path.slice(prefix.length)] = clone(data);
    }
    return out;
  }

  getDoc(collection, id) {
    return clone(this.store.get(`${collection}/${id}`));
  }
}

export { FakeFirestore };
