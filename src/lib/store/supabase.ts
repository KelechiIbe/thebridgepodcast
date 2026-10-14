import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AssetRef, Character, Comment, Episode, Fact, JobState, Profile, Pronunciation, Show } from "../../shared/types";
import type { DataStore, Version } from "./types";

const BUCKET = "media";

export class SupabaseStore implements DataStore {
  readonly mode = "supabase" as const;
  readonly sb: SupabaseClient;
  private signed = new Map<string, { url: string; exp: number }>();

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }

  private check<T>(r: { data: T; error: { message: string } | null } | { data: any; error: any }): T {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  }

  // ---- auth
  async currentUser(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const p = await this.sb.from("profiles").select("id, email, full_name, role").eq("id", user.id).maybeSingle();
    if (!p.data) return { id: user.id, email: user.email ?? "", fullName: "", role: "reviewer", outsider: true };
    return { id: p.data.id, email: p.data.email, fullName: p.data.full_name, role: p.data.role };
  }
  async signIn(email: string, password: string) {
    this.check(await this.sb.auth.signInWithPassword({ email, password }));
  }
  async sendMagicLink(email: string) {
    this.check(await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin } }));
  }
  async sendPasswordReset(email: string) {
    // the app routes with the URL hash, which Supabase also uses for its tokens, so land on the root
    // and move to the account page once the recovery session arrives (see onAuthChange)
    this.check(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` }));
  }
  async updatePassword(password: string) {
    this.check(await this.sb.auth.updateUser({ password }));
  }
  async signOut() {
    await this.sb.auth.signOut();
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") location.hash = "#/account";
      cb();
    });
    return () => data.subscription.unsubscribe();
  }
  async token() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // ---- generic JSON documents
  private async listDocs<T>(table: string, showId?: string): Promise<T[]> {
    let q = this.sb.from(table).select("data");
    if (showId) q = q.eq("show_id", showId);
    return (this.check(await q) ?? []).map((r: any) => r.data as T);
  }
  private async getDoc<T>(table: string, id: string): Promise<T | null> {
    const r = this.check(await this.sb.from(table).select("data").eq("id", id).maybeSingle());
    return (r as any)?.data ?? null;
  }
  private async putDoc(table: string, row: Record<string, unknown>) {
    this.check(await this.sb.from(table).upsert({ ...row, updated_at: new Date().toISOString() }));
  }
  private async delDoc(table: string, id: string) {
    this.check(await this.sb.from(table).delete().eq("id", id));
  }

  getShow = (id: string) => this.getDoc<Show>("shows", id);
  listShows = () => this.listDocs<Show>("shows");
  saveShow = (s: Show) => this.putDoc("shows", { id: s.id, data: { ...s, updatedAt: new Date().toISOString() } });
  async listCharacters(showId: string) {
    return (await this.listDocs<Character>("characters", showId)).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  saveCharacter = (c: Character) => this.putDoc("characters", { id: c.id, show_id: c.showId, data: c });
  deleteCharacter = (id: string) => this.delDoc("characters", id);
  listPronunciations = (showId: string) => this.listDocs<Pronunciation>("pronunciations", showId);
  savePronunciation = (showId: string, p: Pronunciation) => this.putDoc("pronunciations", { id: p.id, show_id: showId, data: p });
  deletePronunciation = (id: string) => this.delDoc("pronunciations", id);
  listFacts = (showId: string) => this.listDocs<Fact>("facts", showId);
  saveFact = (showId: string, f: Fact) => this.putDoc("facts", { id: f.id, show_id: showId, data: f });
  deleteFact = (id: string) => this.delDoc("facts", id);
  listAssets = (showId: string) => this.listDocs<AssetRef>("assets", showId);
  saveAsset = (showId: string, a: AssetRef) => this.putDoc("assets", { id: a.id, show_id: showId, data: a });
  deleteAsset = (id: string) => this.delDoc("assets", id);

  async listEpisodes(showId: string) {
    const rows = this.check(await this.sb.from("episodes").select("data").eq("show_id", showId).order("number", { ascending: false }));
    return (rows ?? []).map((r: any) => r.data as Episode);
  }
  getEpisode = (id: string) => this.getDoc<Episode>("episodes", id);
  async saveEpisode(ep: Episode) {
    const data = { ...ep, updatedAt: new Date().toISOString() };
    this.check(
      await this.sb.from("episodes").upsert({ id: ep.id, show_id: ep.showId, number: ep.number, title: ep.title, status: ep.status, data }),
    );
  }
  deleteEpisode = (id: string) => this.delDoc("episodes", id);
  async snapshot(ep: Episode, note: string) {
    this.check(await this.sb.from("episode_versions").insert({ episode_id: ep.id, data: ep, note }));
  }
  async listVersions(episodeId: string): Promise<Version[]> {
    const rows = this.check(
      await this.sb.from("episode_versions").select("id, note, created_at, data").eq("episode_id", episodeId).order("created_at", { ascending: false }).limit(30),
    );
    return (rows ?? []).map((r: any) => ({ id: String(r.id), note: r.note, createdAt: r.created_at, episode: r.data }));
  }
  async listComments(episodeId: string) {
    const rows = this.check(await this.sb.from("comments").select("data").eq("episode_id", episodeId).order("created_at"));
    return (rows ?? []).map((r: any) => r.data as Comment);
  }
  async saveComment(c: Comment) {
    this.check(await this.sb.from("comments").upsert({ id: c.id, episode_id: c.episodeId, data: c }));
  }
  deleteComment = (id: string) => this.delDoc("comments", id);
  async getJob(id: string): Promise<JobState | null> {
    const r: any = this.check(await this.sb.from("jobs").select("id, kind, status, message, progress, result, updated_at").eq("id", id).maybeSingle());
    if (!r) return null;
    return { id: r.id, kind: r.kind, status: r.status, message: r.message, progress: r.progress, updatedAt: r.updated_at, ...(r.result ? { result: r.result } : {}) } as JobState;
  }

  // ---- files
  async upload(path: string, file: Blob, contentType?: string) {
    this.check(await this.sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: contentType || file.type || undefined }));
    this.signed.delete(path);
    return path;
  }
  async fileUrl(path: string) {
    if (path.startsWith("/")) return path;
    const hit = this.signed.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    const r = this.check<{ signedUrl: string } | null>(await this.sb.storage.from(BUCKET).createSignedUrl(path, 3600));
    if (!r) throw new Error(`No link for ${path}`);
    this.signed.set(path, { url: r.signedUrl, exp: Date.now() + 50 * 60_000 });
    return r.signedUrl;
  }
  async download(path: string) {
    if (path.startsWith("/")) return (await fetch(path)).blob();
    return this.check(await this.sb.storage.from(BUCKET).download(path)) as Blob;
  }
  async remove(path: string) {
    if (path.startsWith("/")) return;
    this.check(await this.sb.storage.from(BUCKET).remove([path]));
  }
}
