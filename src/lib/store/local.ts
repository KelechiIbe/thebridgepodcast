// Demo mode: everything lives in this browser's IndexedDB. Used when Supabase isn't configured.

import type { AssetRef, Character, Comment, Episode, Fact, JobState, Profile, Pronunciation, Show } from "../../shared/types";
import type { DataStore, Version } from "./types";

const DB = "bridge-studio";
const DOCS = "docs";
const FILES = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS);
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open());

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

interface Doc<T> {
  table: string;
  showId: string;
  data: T;
}

async function all<T>(table: string, showId?: string): Promise<T[]> {
  const rows = (await tx<Doc<T>[]>(DOCS, "readonly", (s) => s.getAll() as IDBRequest<Doc<T>[]>)) ?? [];
  return rows.filter((r) => r.table === table && (!showId || r.showId === showId)).map((r) => r.data);
}
const get = async <T>(table: string, id: string) => ((await tx<Doc<T> | undefined>(DOCS, "readonly", (s) => s.get(`${table}:${id}`))) ?? null)?.data ?? null;
const put = <T>(table: string, id: string, showId: string, data: T) => tx(DOCS, "readwrite", (s) => s.put({ table, showId, data }, `${table}:${id}`)).then(() => undefined);
const del = (table: string, id: string) => tx(DOCS, "readwrite", (s) => s.delete(`${table}:${id}`)).then(() => undefined);

const DEMO_USER: Profile = { id: "local-user", email: "you@this-browser", fullName: "Demo producer", role: "admin" };

export class LocalStore implements DataStore {
  readonly mode = "local" as const;
  private urls = new Map<string, string>();

  async currentUser() {
    return DEMO_USER;
  }
  async signIn() {}
  async sendMagicLink() {}
  async sendPasswordReset() {}
  async updatePassword() {}
  async signOut() {}
  onAuthChange() {
    return () => {};
  }
  async token() {
    return null;
  }

  getShow = (id: string) => get<Show>("show", id);
  listShows = () => all<Show>("show");
  saveShow = (s: Show) => put("show", s.id, s.id, { ...s, updatedAt: new Date().toISOString() });
  async listCharacters(showId: string) {
    return (await all<Character>("character", showId)).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  saveCharacter = (c: Character) => put("character", c.id, c.showId, c);
  deleteCharacter = (id: string) => del("character", id);
  listPronunciations = (showId: string) => all<Pronunciation>("pron", showId);
  savePronunciation = (showId: string, p: Pronunciation) => put("pron", p.id, showId, p);
  deletePronunciation = (id: string) => del("pron", id);
  listFacts = (showId: string) => all<Fact>("fact", showId);
  saveFact = (showId: string, f: Fact) => put("fact", f.id, showId, f);
  deleteFact = (id: string) => del("fact", id);
  listAssets = (showId: string) => all<AssetRef>("asset", showId);
  saveAsset = (showId: string, a: AssetRef) => put("asset", a.id, showId, a);
  deleteAsset = (id: string) => del("asset", id);

  async listEpisodes(showId: string) {
    return (await all<Episode>("episode", showId)).sort((a, b) => b.number - a.number);
  }
  getEpisode = (id: string) => get<Episode>("episode", id);
  saveEpisode = (e: Episode) => put("episode", e.id, e.showId, { ...e, updatedAt: new Date().toISOString() });
  async deleteEpisode(id: string) {
    await del("episode", id);
  }
  async snapshot(ep: Episode, note: string) {
    const id = `${ep.id}-${Date.now()}`;
    await put<Version>("version", id, ep.id, { id, note, createdAt: new Date().toISOString(), episode: structuredClone(ep) });
  }
  async listVersions(episodeId: string) {
    return (await all<Version>("version", episodeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  }
  async listComments(episodeId: string) {
    return (await all<Comment>("comment", episodeId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  saveComment = (c: Comment) => put("comment", c.id, c.episodeId, c);
  deleteComment = (id: string) => del("comment", id);
  async getJob(): Promise<JobState | null> {
    return null;
  }

  async upload(path: string, file: Blob) {
    await tx(FILES, "readwrite", (s) => s.put(file, path));
    const old = this.urls.get(path);
    if (old) URL.revokeObjectURL(old);
    this.urls.delete(path);
    return path;
  }
  async download(path: string) {
    const b = await tx<Blob | undefined>(FILES, "readonly", (s) => s.get(path));
    if (!b) {
      // built-in assets ship with the app
      if (path.startsWith("/")) return (await fetch(path)).blob();
      throw new Error(`File not found: ${path}`);
    }
    return b;
  }
  async fileUrl(path: string) {
    if (path.startsWith("/")) return path;
    const hit = this.urls.get(path);
    if (hit) return hit;
    const url = URL.createObjectURL(await this.download(path));
    this.urls.set(path, url);
    return url;
  }
  async remove(path: string) {
    await tx(FILES, "readwrite", (s) => s.delete(path));
  }
}
