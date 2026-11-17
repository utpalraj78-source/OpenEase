// OpenEase - PostgreSQL Data Access Model Engine
// Provides high-performance, ACID-compliant persistence backed by PostgreSQL
// Supports both embedded zero-config PGlite and external PostgreSQL servers.

const crypto = require('crypto');
const { getPostgresClient } = require('./postgres');

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = val;
}

function matchValue(actual, expected) {
  if (expected === undefined) return true;
  if (expected === null) return actual === null || actual === undefined;

  // Handle Mongoose / ObjectId / String matching
  const actualStr = actual ? (actual._id ? String(actual._id) : String(actual)) : '';
  const expectedStr = expected ? (expected._id ? String(expected._id) : String(expected)) : '';

  if (expected instanceof RegExp) {
    return expected.test(String(actual || ''));
  }

  const isOperator = typeof expected === 'object' && !(expected instanceof Date) &&
    Object.keys(expected).some(k => k.startsWith('$'));

  if (isOperator) {
    for (const op of Object.keys(expected)) {
      const val = expected[op];
      if (op === '$in') {
        const inVals = Array.isArray(val) ? val.map(v => (v && v._id ? String(v._id) : String(v))) : [];
        if (!inVals.includes(actualStr)) return false;
      } else if (op === '$nin') {
        const inVals = Array.isArray(val) ? val.map(v => (v && v._id ? String(v._id) : String(v))) : [];
        if (inVals.includes(actualStr)) return false;
      } else if (op === '$ne') {
        const neStr = val ? (val._id ? String(val._id) : String(val)) : '';
        if (actualStr === neStr) return false;
      } else if (op === '$exists') {
        const exists = actual !== undefined && actual !== null;
        if (Boolean(val) !== exists) return false;
      } else if (op === '$gt') {
        if (actual <= val) return false;
      } else if (op === '$gte') {
        const a = actual instanceof Date ? actual.getTime() : actual;
        const b = val instanceof Date ? val.getTime() : val;
        if (a < b) return false;
      } else if (op === '$lt') {
        if (actual >= val) return false;
      } else if (op === '$lte') {
        const a = actual instanceof Date ? actual.getTime() : actual;
        const b = val instanceof Date ? val.getTime() : val;
        if (a > b) return false;
      } else if (op === '$regex') {
        const flags = expected.$options || '';
        const re = new RegExp(val, flags);
        if (!re.test(String(actual || ''))) return false;
      }
    }
    return true;
  }

  // Exact comparison (supporting ObjectId / string equivalence)
  if (actualStr === expectedStr) return true;
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

function filterMatch(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some(subFilter => filterMatch(doc, subFilter));
  }
  if (filter.$and && Array.isArray(filter.$and)) {
    return filter.$and.every(subFilter => filterMatch(doc, subFilter));
  }

  for (const key of Object.keys(filter)) {
    if (key === '$or' || key === '$and') continue;
    let actual;
    if (key === '_id' || key === 'id') {
      actual = doc._id || doc.id;
    } else {
      actual = getByPath(doc, key);
    }
    const expected = filter[key];
    if (!matchValue(actual, expected)) return false;
  }
  return true;
}

class PgQuery {
  constructor(model, filter = {}, single = false) {
    this.model = model;
    this.filter = filter;
    this.single = single;
    this._sort = null;
    this._populates = [];
    this._limit = null;
    this._skip = 0;
    this._lean = false;
    this._select = null;
  }

  sort(sortObj) {
    this._sort = sortObj;
    return this;
  }

  populate(pathOrObj, select) {
    if (typeof pathOrObj === 'string') {
      this._populates.push({ path: pathOrObj, select });
    } else if (pathOrObj && typeof pathOrObj === 'object') {
      this._populates.push(pathOrObj);
    }
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  skip(n) {
    this._skip = n;
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  async exec() {
    const pg = await getPostgresClient();
    const table = this.model.tableName;

    // Fast indexed path for findById or findOne by _id / id
    const exactId = this.filter._id || this.filter.id;
    let rows;
    if (typeof exactId === 'string' && Object.keys(this.filter).length === 1) {
      const res = await pg.query(`SELECT doc FROM "${table}" WHERE id = $1 LIMIT 1;`, [exactId]);
      rows = res.rows;
    } else {
      const res = await pg.query(`SELECT doc FROM "${table}";`);
      rows = res.rows;
    }

    let docs = rows.map(r => {
      const d = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc;
      if (!d._id && d.id) d._id = d.id;
      if (!d.id && d._id) d.id = d._id;
      return d;
    });

    // Apply filtering
    docs = docs.filter(d => filterMatch(d, this.filter));

    // Apply sorting
    if (this._sort) {
      docs.sort((a, b) => {
        let sortFields = [];
        if (typeof this._sort === 'string') {
          sortFields = this._sort.split(/\s+/).filter(Boolean).map(f => {
            const desc = f.startsWith('-');
            return { key: desc ? f.slice(1) : f, dir: desc ? -1 : 1 };
          });
        } else if (typeof this._sort === 'object') {
          sortFields = Object.keys(this._sort).map(k => ({ key: k, dir: this._sort[k] }));
        }

        for (const { key, dir } of sortFields) {
          const va = getByPath(a, key);
          const vb = getByPath(b, key);
          if (va === vb) continue;
          if (va === undefined || va === null) return 1;
          if (vb === undefined || vb === null) return -1;
          return va > vb ? dir : -dir;
        }
        return 0;
      });
    }

    // Apply skip and limit
    if (this._skip) {
      docs = docs.slice(this._skip);
    }
    if (this._limit !== null && this._limit !== undefined) {
      docs = docs.slice(0, this._limit);
    }

    // Wrap in Model instances
    let results = docs.map(d => (this._lean ? d : this.model.hydrate(d)));

    // Apply populates
    for (const pop of this._populates) {
      results = await this.model.applyPopulate(results, pop);
    }

    if (this.single) {
      return results.length > 0 ? results[0] : null;
    }
    return results;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

if (!String.prototype.toHexString) {
  String.prototype.toHexString = function() { return this.toString(); };
}

function createModel(tableName, methods = {}, statics = {}, virtuals = {}, defaults = {}) {
  class Model {
    constructor(data = {}) {
      this._id = data._id || data.id || generateId();
      this.id = this._id;
      this._doc = { ...defaults, ...data, _id: this._id, id: this._id };

      for (const k of Object.keys(this._doc)) {
        this[k] = this._doc[k];
      }

      return new Proxy(this, {
        get(target, prop, receiver) {
          if (typeof prop === 'symbol') return target[prop];
          if (prop in virtuals) return virtuals[prop].get ? virtuals[prop].get.call(receiver) : undefined;
          if (prop in target) return target[prop];
          return target._doc ? target._doc[prop] : undefined;
        },
        set(target, prop, value) {
          if (typeof prop === 'symbol') {
            target[prop] = value;
            return true;
          }
          if (target._doc) target._doc[prop] = value;
          target[prop] = value;
          return true;
        }
      });
    }

    static get tableName() {
      return tableName;
    }

    static hydrate(data) {
      const inst = new Model(data);
      inst._isNew = false;
      return inst;
    }

    static find(filter) {
      return new PgQuery(Model, filter, false);
    }

    static findOne(filter) {
      return new PgQuery(Model, filter, true);
    }

    static findById(id) {
      return new PgQuery(Model, { _id: id }, true);
    }

    static async exists(filter) {
      const doc = await Model.findOne(filter);
      return doc ? { _id: doc._id } : null;
    }

    static async create(data) {
      if (Array.isArray(data)) {
        const items = [];
        for (const d of data) items.push(await Model.create(d));
        return items;
      }
      const inst = new Model(data);
      await inst.save();
      return inst;
    }

    static async insertMany(data) {
      return Model.create(data);
    }

    static async countDocuments(filter = {}) {
      const items = await Model.find(filter);
      return items.length;
    }

    static async distinct(field, filter = {}) {
      const items = await Model.find(filter);
      const set = new Set();
      for (const it of items) {
        const val = getByPath(it._doc || it, field);
        if (val !== undefined && val !== null) set.add(val);
      }
      return Array.from(set);
    }

    static async deleteOne(filter) {
      const doc = await Model.findOne(filter);
      if (!doc) return { deletedCount: 0 };
      const pg = await getPostgresClient();
      await pg.query(`DELETE FROM "${tableName}" WHERE id = $1;`, [doc._id]);
      return { deletedCount: 1 };
    }

    static async deleteMany(filter = {}) {
      const items = await Model.find(filter);
      if (items.length === 0) return { deletedCount: 0 };
      const pg = await getPostgresClient();
      for (const item of items) {
        await pg.query(`DELETE FROM "${tableName}" WHERE id = $1;`, [item._id]);
      }
      return { deletedCount: items.length };
    }

    static async updateOne(filter, update, options = {}) {
      const doc = await Model.findOne(filter);
      if (!doc) {
        if (options.upsert) {
          const insertData = { ...filter };
          if (update.$set) Object.assign(insertData, update.$set);
          return Model.create(insertData);
        }
        return { modifiedCount: 0 };
      }
      applyMongoUpdate(doc, update);
      await doc.save();
      return { modifiedCount: 1, doc };
    }

    static async updateMany(filter, update, options = {}) {
      const items = await Model.find(filter);
      for (const item of items) {
        applyMongoUpdate(item, update);
        await item.save();
      }
      return { modifiedCount: items.length };
    }

    static async findOneAndUpdate(filter, update, options = {}) {
      let doc = await Model.findOne(filter);
      if (!doc) {
        if (options.upsert) {
          const insertData = { ...filter };
          if (update.$set) Object.assign(insertData, update.$set);
          if (update.$inc) {
            for (const k of Object.keys(update.$inc)) {
              insertData[k] = (insertData[k] || 0) + update.$inc[k];
            }
          }
          doc = new Model(insertData);
          await doc.save();
          return doc;
        }
        return null;
      }
      applyMongoUpdate(doc, update);
      await doc.save();
      return doc;
    }

    static async aggregate(pipeline = []) {
      const allDocs = await Model.find({}).lean();
      let cur = allDocs;

      for (const stage of pipeline) {
        if (stage.$match) {
          cur = cur.filter(d => filterMatch(d, stage.$match));
        } else if (stage.$group) {
          const groups = {};
          const groupKey = stage.$group._id;
          for (const d of cur) {
            let keyVal;
            if (groupKey === null) {
              keyVal = '__all__';
            } else if (typeof groupKey === 'string' && groupKey.startsWith('$')) {
              keyVal = getByPath(d, groupKey.slice(1));
            } else {
              keyVal = groupKey;
            }
            const keyStr = keyVal !== undefined ? String(keyVal) : 'null';
            if (!groups[keyStr]) {
              groups[keyStr] = { _id: keyVal, _items: [] };
            }
            groups[keyStr]._items.push(d);
          }

          cur = Object.values(groups).map(g => {
            const out = { _id: g._id };
            for (const aggKey of Object.keys(stage.$group)) {
              if (aggKey === '_id') continue;
              const opObj = stage.$group[aggKey];
              if (opObj.$sum !== undefined) {
                if (opObj.$sum === 1) {
                  out[aggKey] = g._items.length;
                } else if (typeof opObj.$sum === 'string' && opObj.$sum.startsWith('$')) {
                  const field = opObj.$sum.slice(1);
                  out[aggKey] = g._items.reduce((acc, it) => acc + (Number(getByPath(it, field)) || 0), 0);
                } else {
                  out[aggKey] = g._items.length * (Number(opObj.$sum) || 1);
                }
              } else if (opObj.$avg !== undefined && typeof opObj.$avg === 'string') {
                const field = opObj.$avg.slice(1);
                const sum = g._items.reduce((acc, it) => acc + (Number(getByPath(it, field)) || 0), 0);
                out[aggKey] = g._items.length ? Number((sum / g._items.length).toFixed(1)) : 0;
              } else if (opObj.$count !== undefined) {
                out[aggKey] = g._items.length;
              }
            }
            return out;
          });
        } else if (stage.$sort) {
          cur.sort((a, b) => {
            for (const k of Object.keys(stage.$sort)) {
              const dir = stage.$sort[k];
              const va = getByPath(a, k);
              const vb = getByPath(b, k);
              if (va === vb) continue;
              return va > vb ? dir : -dir;
            }
            return 0;
          });
        }
      }
      return cur;
    }

    static async applyPopulate(results, pop) {
      if (!results || results.length === 0) return results;
      const path = pop.path;
      const targetModel = pop.model || getRegisteredModel(path);
      if (!targetModel) return results;

      for (const item of results) {
        const rawVal = getByPath(item._doc || item, path);
        if (!rawVal) continue;
        const refId = rawVal._id ? String(rawVal._id) : String(rawVal);
        const related = await targetModel.findById(refId);
        if (related) {
          if (pop.populate) {
            await targetModel.applyPopulate([related], pop.populate);
          }
          if (item._doc) {
            item._doc[path] = related;
          }
          item[path] = related;
        }
      }
      return results;
    }

    toObject() {
      return JSON.parse(JSON.stringify(this._doc));
    }

    toJSON() {
      return this.toObject();
    }

    async deleteOne() {
      const pg = await getPostgresClient();
      await pg.query(`DELETE FROM "${tableName}" WHERE id = $1;`, [this._id]);
      return { deletedCount: 1 };
    }

    async remove() {
      return this.deleteOne();
    }

    async save() {
      const pg = await getPostgresClient();
      this._doc.updatedAt = new Date();
      if (!this._doc.createdAt) this._doc.createdAt = new Date();
      this.updatedAt = this._doc.updatedAt;
      this.createdAt = this._doc.createdAt;

      for (const k of Object.keys(this)) {
        if (!k.startsWith('_') && k !== 'id' && typeof this[k] !== 'function') {
          this._doc[k] = this[k];
        }
      }

      const docJson = JSON.stringify(this._doc);
      const id = String(this._id);

      // Persist to PostgreSQL with ON CONFLICT DO UPDATE
      await pg.query(
        `INSERT INTO "${tableName}" (id, doc, created_at, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET doc = $2, updated_at = $4;`,
        [id, docJson, this.createdAt, this.updatedAt]
      );
      return this;
    }
  }

  // Attach instance methods
  for (const mName of Object.keys(methods)) {
    Model.prototype[mName] = methods[mName];
  }

  // Attach static methods
  for (const sName of Object.keys(statics)) {
    Model[sName] = statics[sName];
  }

  registerModel(tableName, Model);
  return Model;
}

function applyMongoUpdate(target, update) {
  const doc = target._doc || target;
  if (update.$set) {
    for (const k of Object.keys(update.$set)) {
      setByPath(doc, k, update.$set[k]);
      target[k] = update.$set[k];
    }
  }
  if (update.$inc) {
    for (const k of Object.keys(update.$inc)) {
      const cur = Number(getByPath(doc, k)) || 0;
      const next = cur + update.$inc[k];
      setByPath(doc, k, next);
      target[k] = next;
    }
  }
  if (update.$push) {
    for (const k of Object.keys(update.$push)) {
      const arr = getByPath(doc, k) || [];
      arr.push(update.$push[k]);
      setByPath(doc, k, arr);
      target[k] = arr;
    }
  }
}

// Global model registry for populate lookups
const modelAliases = {
  participant: 'users',
  coordinator: 'users',
  reviewer: 'users',
  recordedbyuserid: 'users',
  actor: 'users',
  user: 'users',
  category: 'event_categories',
  eventcategory: 'event_categories',
  venue: 'venues',
  event: 'events',
  session: 'sessions',
  registration: 'registrations',
  attendance: 'attendance',
  feedback: 'feedback',
  notification: 'notifications',
  auditlog: 'audit_logs'
};

const modelRegistry = {};
function registerModel(name, model) {
  modelRegistry[name.toLowerCase()] = model;
}
function getRegisteredModel(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  const alias = modelAliases[key];
  if (alias && modelRegistry[alias]) return modelRegistry[alias];
  return modelRegistry[key] || modelRegistry[key + 's'] || modelRegistry[key.replace(/s$/, '')] || null;
}

module.exports = {
  createModel,
  filterMatch,
  registerModel,
  getRegisteredModel,
  generateId
};
